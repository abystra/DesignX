"""Restore a verified backup into a newly created drill database and object prefix.

Does not activate the restored deployment or run workers. Keep the printed private
receipt for validation and cleanup. No option accepts an existing target database.
"""
import argparse
import json
import os
from pathlib import Path
import re
import tarfile
import time
import urllib.parse
import uuid
from operations import ROOT, CURRENT, RUN, objects, psql, run, settings, write_json

def extract(directory):
    with tarfile.open(directory / 'snapshot.tar.gz', 'r:gz') as archive:
        members = archive.getmembers()
        names = set()
        for member in members:
            if member.name in names or not (member.isfile() or member.isdir()):
                raise RuntimeError('Unsafe archive member')
            names.add(member.name)
            if member.name not in ['catalog.json', 'database.dump', 'manifest.json', 'blobs'] and not re.fullmatch(r'blobs/[a-f0-9]{64}', member.name):
                raise RuntimeError('Unexpected archive path')
        archive.extractall(directory, members=members, filter='data')

def restore(run_id):
    if not RUN.fullmatch(run_id): raise RuntimeError('Invalid run ID')
    values, source, image = settings()
    token = str(uuid.uuid4())
    target = 'designx_restore_' + token.replace('-', '')
    prefix = '_designx_restore/' + token + '/'
    directory = ROOT / ('restore-' + token)
    directory.mkdir(mode=0o700)
    started = time.time()
    state = {'runId': run_id, 'directory': str(directory), 'database': target, 'prefix': prefix, 'status': 'preparing', 'sourceDatabase': source, 'release': CURRENT.resolve().name}
    write_json(directory / 'drill.json', state)
    try:
        objects(image, 'download', directory, run_id)
        extract(directory)
        restored = objects(image, 'restore-objects', directory, prefix)
        # No --if-exists or overwrite route: UUID name and CREATE DATABASE must succeed.
        psql('postgres', 'CREATE DATABASE "' + target + '" OWNER designx_app;')
        state['databaseCreated'] = True; write_json(directory / 'drill.json', state)
        with (directory / 'database.dump').open('rb') as source_file:
            run(['sudo', '-u', 'postgres', 'pg_restore', '--no-owner', '--role=designx_app', '--exit-on-error', '--single-transaction', '--dbname', target], stdin=source_file, cwd='/tmp', timeout=1800)
        manifest = json.loads((directory / 'manifest.json').read_text())
        counts = json.loads(psql(target, "SELECT json_build_object('users',(SELECT count(*) FROM users),'workspaces',(SELECT count(*) FROM workspaces),'projects',(SELECT count(*) FROM projects),'documents',(SELECT count(*) FROM documents),'versions',(SELECT count(*) FROM document_versions),'assetVersions',(SELECT count(*) FROM asset_versions));"))
        if counts != manifest['counts']: raise RuntimeError('Restored counts differ')
        # Restored sessions and queues are historical data. Revoke/stop them only in
        # the isolated database before starting an acceptance API/Renderer.
        psql(target, "TRUNCATE sessions; UPDATE pgboss.job SET state='cancelled' WHERE state NOT IN ('completed','failed','cancelled');")
        url = urllib.parse.urlsplit(values['DATABASE_URL'])
        values.update(DATABASE_URL=urllib.parse.urlunsplit(url._replace(path='/' + target)), S3_BUCKET_ALIASES_JSON=json.dumps(restored['aliases'], separators=(',', ':')), AI_ENABLED='false', IMAGE_GENERATION_ENABLED='false', STORAGE_DIRECT_UPLOADS_ENABLED='false', LEGACY_S3_BUCKET='', LEGACY_S3_ENDPOINT='', WEB_ORIGIN='http://127.0.0.1:33101', PORT='33101', API_HOST='127.0.0.1')
        (directory / 'restore.env').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
        (directory / 'restore.env').chmod(0o600)
        # An older archive may precede the currently pinned application's schema.
        # Verify its original counts first, then migrate only this UUID drill database.
        migration_container = 'designx-restore-migrate-' + token
        try:
            run(['docker', 'run', '--rm', '--name', migration_container, '--network', 'host', '--read-only', '--tmpfs', '/tmp', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--env-file', str(directory / 'restore.env'), image, 'node', '--import', 'tsx', 'db/migrate.ts'], timeout=900)
        finally:
            import subprocess
            subprocess.run(['docker', 'rm', '--force', migration_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        state.update(status='ready-for-validation', counts=counts, objects=restored['objects'], image=image, schemaMigratedToCurrentRelease=True, restoreSeconds=round(time.time() - started, 2))
        write_json(directory / 'drill.json', state)
        print(json.dumps(state))
    except BaseException:
        state['status'] = 'failed'; write_json(directory / 'drill.json', state)
        raise

def cleanup(path, apply):
    directory = Path(path).resolve()
    if directory.parent != ROOT or not re.fullmatch(r'restore-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', directory.name):
        raise RuntimeError('Cleanup requires the exact private drill directory')
    state = json.loads((directory / 'drill.json').read_text())
    token = directory.name.removeprefix('restore-')
    target = 'designx_restore_' + token.replace('-', '')
    _, source, image = settings()
    if state['database'] != target or state['prefix'] != '_designx_restore/' + token + '/' or target == source:
        raise RuntimeError('Cleanup receipt mismatch')
    # Must stop this drill's API/Renderer first; never force-disconnect other sessions.
    if psql('postgres', "SELECT count(*) FROM pg_stat_activity WHERE datname='" + target + "';") != '0':
        raise RuntimeError('Stop the drill processes before cleanup')
    inventory = objects(image, 'clean-restore', directory, '--apply' if apply else None)
    if apply:
        psql('postgres', 'DROP DATABASE IF EXISTS "' + target + '";')
        for name in ['restore.env', 'database.dump', 'snapshot.tar.gz', 'catalog.json', 'manifest.json']:
            (directory / name).unlink(missing_ok=True)
        import shutil
        shutil.rmtree(directory / 'blobs', ignore_errors=True)
        state.update(status='cleaned', cleanup=inventory)
        write_json(directory / 'drill.json', state)
    print(json.dumps({'database': target, **inventory}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--run'); choice.add_argument('--cleanup'); parser.add_argument('--apply', action='store_true'); args = parser.parse_args()
    if os.geteuid() != 0: raise SystemExit('Run as root on aws-1')
    os.umask(0o077)
    try:
        if args.run: restore(args.run)
        else: cleanup(args.cleanup, args.apply)
    except Exception as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error) if isinstance(error, RuntimeError) else 'Restore failed; inspect private drill.json'}))
        raise SystemExit(1)
