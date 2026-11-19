"""Root-owned aws-1 backup and monitoring. Never writes application rows or source objects."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path('/var/backups/designx')
CURRENT = Path('/srv/designx/current')
RUN = re.compile(r'^\d{8}T\d{6}Z-[a-f0-9]{8}$')

def run(args, **kwargs):
    result = subprocess.run(args, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if result.returncode:
        # Child errors may contain connection strings. Keep secrets out of the journal.
        if ROOT.is_dir():
            diagnostic = ROOT / 'last-error.log'
            diagnostic.write_bytes(result.stderr[-32768:])
            diagnostic.chmod(0o600)
        raise RuntimeError(f'{Path(args[0]).name} failed ({result.returncode}); stage recorded in status.json')
    return result.stdout.decode().strip()

def write_json(path, value):
    temporary = path.with_suffix('.new')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.chmod(0o600)
    os.replace(temporary, path)

def settings():
    values = {}
    for line in Path('/etc/designx/app.env').read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value
    database = urllib.parse.unquote(urllib.parse.urlsplit(values['DATABASE_URL']).path[1:])
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', database):
        raise RuntimeError('Invalid configured database name')
    image = (CURRENT / '.deployment/image.env').read_text().strip().removeprefix('DESIGNX_IMAGE=')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise RuntimeError('Release has no pinned image')
    return values, database, image

def psql(database, sql):
    return run(['sudo', '-u', 'postgres', 'psql', '-XqAt', '--set=ON_ERROR_STOP=1', '--dbname', database], input=sql.encode(), cwd='/tmp')

def objects(image, mode, directory, argument=None):
    container = 'designx-ops-' + uuid.uuid4().hex
    args = ['docker', 'run', '--rm', '--name', container, '--network', 'host', '--user', '0:0', '--env-file', '/etc/designx/app.env',
            '--read-only', '--tmpfs', '/tmp', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
            '--volume', str(directory) + ':/backup', image, 'node', '--import', 'tsx', 'scripts/backup-objects.mjs', mode, '/backup']
    if argument:
        args.append(argument)
    try:
        return json.loads(run(args, timeout=3600))
    finally:
        # A timed-out Docker client does not stop its daemon-owned container.
        subprocess.run(['docker', 'rm', '--force', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)

def backup():
    values, database, image = settings()
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / '.backup.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        started = time.time()
        run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
        directory = ROOT / run_id
        directory.mkdir(mode=0o700)
        previous = json.loads((ROOT / 'status.json').read_text()) if (ROOT / 'status.json').exists() else {}
        state = {'runId': run_id, 'status': 'running', 'startedAt': started, 'lastSuccessAt': previous.get('lastSuccessAt'), 'stage': 'snapshot'}
        write_json(ROOT / 'status.json', state)
        session = None
        try:
            session = subprocess.Popen(['sudo', '-u', 'postgres', 'psql', '-XqAt', '--set=ON_ERROR_STOP=1', '--set=default_bucket=' + values['S3_BUCKET'], '--dbname', database], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd='/tmp')
            session.stdin.write((CURRENT / 'scripts/cloud/backup-catalog.sql').read_text() + '\n')
            session.stdin.flush()
            catalog = json.loads(session.stdout.readline())
            catalog.update(runId=run_id, release=CURRENT.resolve().name)
            write_json(directory / 'catalog.json', catalog)
            with (directory / 'database.dump').open('xb') as output:
                dumped = subprocess.run(['sudo', '-u', 'postgres', 'pg_dump', '--format=custom', '--no-owner', '--snapshot=' + catalog['snapshot'], '--dbname', database], stdout=output, stderr=subprocess.DEVNULL, cwd='/tmp', timeout=1800)
            if dumped.returncode:
                raise RuntimeError('Database snapshot dump failed')
            session.stdin.write('ROLLBACK;\n\\q\n'); session.stdin.flush(); session.wait(timeout=10); session = None
            state['stage'] = 'objects'; write_json(ROOT / 'status.json', state)
            captured = objects(image, 'capture', directory)
            with tarfile.open(directory / 'snapshot.tar.gz', 'w:gz') as archive:
                for name in ['catalog.json', 'database.dump', 'manifest.json', 'blobs']:
                    archive.add(directory / name, arcname=name, recursive=True)
            state['stage'] = 'offhost-readback'; write_json(ROOT / 'status.json', state)
            published = objects(image, 'publish', directory)
            receipt = {**published, **captured, 'database': database, 'counts': catalog['counts'], 'release': catalog['release'], 'seconds': round(time.time() - started, 2)}
            write_json(directory / 'receipt.json', receipt)
            # Keep the complete archive and receipt, not a second uncompressed copy.
            for name in ['catalog.json', 'database.dump', 'manifest.json']:
                (directory / name).unlink()
            shutil.rmtree(directory / 'blobs')
            state['stage'] = 'retention'; write_json(ROOT / 'status.json', state)
            retention = objects(image, 'prune', directory)
            # Only successfully published, registered backup directories are candidates.
            for entry in ROOT.iterdir():
                if RUN.fullmatch(entry.name) and entry.is_dir() and not entry.is_symlink() and (entry / 'receipt.json').is_file() and entry.name not in retention['retained']:
                    old = json.loads((entry / 'receipt.json').read_text())
                    if old.get('runId') == entry.name and old.get('offhostVerified') is True:
                        shutil.rmtree(entry)
            state.update(status='ok', stage='complete', lastSuccessAt=time.time(), receipt=receipt, retention=retention)
            write_json(ROOT / 'status.json', state)
            print(json.dumps(state))
        except BaseException:
            state.update(status='failed', failedAt=time.time())
            write_json(ROOT / 'status.json', state)
            raise
        finally:
            if session:
                session.terminate(); session.wait(timeout=10)

def health():
    _, database, _ = settings()
    problems, services = [], {}
    for name in ['api', 'worker', 'renderer']:
        data = json.loads(run(['docker', 'inspect', '--format', '{{json .State}}', 'designx-' + name + '-1']))
        services[name] = {'running': data['Running'], 'health': data.get('Health', {}).get('Status'), 'startedAt': data['StartedAt']}
        if not data['Running'] or data.get('Health', {}).get('Status') == 'unhealthy':
            problems.append(name + '-unhealthy')
    try:
        with urllib.request.urlopen('http://127.0.0.1:3100/api/health', timeout=5) as response:
            if response.status != 200:
                problems.append('api-http')
    except Exception:
        problems.append('api-http')
    queues = json.loads(psql(database, "SELECT coalesce(json_agg(q),'[]') FROM (SELECT kind,status,count(*)::int AS count,min(created_at) AS oldest FROM jobs WHERE (status='queued' AND created_at<now()-interval '10 minutes') OR (status='running' AND updated_at<now()-interval '30 minutes') OR (status='failed' AND updated_at>now()-interval '24 hours') GROUP BY kind,status) q;"))
    if queues:
        problems.append('stale-or-failed-jobs')
    backup_state = json.loads((ROOT / 'status.json').read_text()) if (ROOT / 'status.json').exists() else {}
    age = time.time() - (backup_state.get('lastSuccessAt') or 0)
    if age > 30 * 3600 or backup_state.get('status') == 'failed' or (backup_state.get('status') == 'running' and time.time() - backup_state.get('startedAt', 0) > 2 * 3600):
        problems.append('backup-stale-or-failed')
    retention_state = json.loads((ROOT / 'retention.json').read_text()) if (ROOT / 'retention.json').exists() else {}
    if (Path('/etc/systemd/system/designx-product-retention.timer').exists() and (retention_state.get('status') == 'failed' or time.time() - retention_state.get('completedAt', 0) > 48 * 3600)):
        problems.append('product-retention-stale-or-failed')
    report = {'retentionStatus': retention_state.get('status', 'not-configured'), 'at': time.time(), 'status': 'degraded' if problems else 'ok', 'problems': problems, 'services': services, 'queues': queues, 'backupAgeSeconds': round(age), 'externalNotificationConfigured': False}
    write_json(ROOT / 'health.json', report)
    print(json.dumps(report))
    return bool(problems)

def retention():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / '.retention.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'already-running'}))
            return
        _retention_locked()

def _retention_locked():
    _, _, image = settings()
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    previous = json.loads((ROOT / 'retention.json').read_text()) if (ROOT / 'retention.json').exists() else {}
    state = {'status': 'running', 'startedAt': time.time(), 'completedAt': previous.get('completedAt') or 0}
    write_json(ROOT / 'retention.json', state)
    container = 'designx-retention-' + uuid.uuid4().hex
    try:
        result = json.loads(run(['docker', 'run', '--rm', '--name', container, '--network', 'host', '--read-only', '--tmpfs', '/tmp', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--env-file', '/etc/designx/app.env', image, 'node', '--import', 'tsx', 'scripts/product-cli.ts', 'retention', '--all', '--apply'], timeout=900))
        state.update(status='ok', completedAt=time.time(), result=result)
    except BaseException:
        state.update(status='failed', failedAt=time.time())
        raise
    finally:
        subprocess.run(['docker', 'rm', '--force', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        write_json(ROOT / 'retention.json', state)
    print(json.dumps(state))

def install():
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in ['designx-backup.service', 'designx-backup.timer', 'designx-health.service', 'designx-health.timer', 'designx-product-retention.service', 'designx-product-retention.timer']:
        target = Path('/etc/systemd/system') / name
        if target.exists() and '# Managed by DesignX operations' not in target.read_text():
            raise RuntimeError('Refusing to replace an unmanaged unit: ' + name)
        target.write_text((CURRENT / 'infra/systemd' / name).read_text())
        target.chmod(0o644)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'designx-backup.timer', 'designx-health.timer', 'designx-product-retention.timer'])
    print(json.dumps({'installed': True, 'dailyUTC': '04:30', 'healthIntervalMinutes': 5, 'productRetentionDailyUTC': '06:00', 'externalNotificationConfigured': False}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['backup', 'health', 'install', 'retention'])
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run as root on aws-1')
    os.umask(0o077)
    try:
        if args.command == 'backup': backup()
        elif args.command == 'install': install()
        elif args.command == 'retention': retention()
        else: raise SystemExit(int(health()))
    except Exception as error:
        print(json.dumps({'command': args.command, 'error': type(error).__name__, 'message': str(error) if isinstance(error, RuntimeError) else 'Operation failed; inspect private status and connectivity'}))
        raise SystemExit(1)
