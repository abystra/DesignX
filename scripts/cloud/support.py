#!/usr/bin/env python3
"""Run deployed product operations through saved aws-1 SSH. No HTTP admin route."""
from pathlib import Path
import shlex
import subprocess
import sys
from access import SERVER, ssh_options

def main():
    args = sys.argv[1:]
    if not args or args[0] not in ('report', 'list', 'show', 'update', 'exclude', 'retention'):
        raise SystemExit('Expected report/list/show/update/exclude/retention and explicit --workspace UUID or --all')
    reply = b''
    if '--reply-file' in args:
        index = args.index('--reply-file')
        reply = Path(args[index + 1]).read_bytes()
        if len(reply) > 16000:
            raise SystemExit('Reply exceeds limit')
        args[index:index + 2] = ['--reply-stdin']
    script = 'scripts/operations-report.ts' if args[0] == 'report' else 'scripts/product-cli.ts'
    cli_args = args[1:] if args[0] == 'report' else args
    # Credentials stay in the server's root-owned env file; use its pinned image.
    remote = '''import pathlib,re,subprocess,sys
image=pathlib.Path('/srv/designx/current/.deployment/image.env').read_text().strip().removeprefix('DESIGNX_IMAGE=')
assert re.fullmatch(r'sha256:[a-f0-9]{64}',image)
sys.exit(subprocess.run(['docker','run','--rm','-i','--network','host','--read-only','--tmpfs','/tmp','--security-opt','no-new-privileges','--cap-drop','ALL','--env-file','/etc/designx/app.env',image,'node','--import','tsx']+ARGS,stdin=sys.stdin.buffer).returncode)
'''.replace('ARGS', repr([script] + cli_args))
    with ssh_options() as (options, _):
        return subprocess.run(options + [SERVER, 'sudo python3 -c ' + shlex.quote(remote)], input=reply).returncode

if __name__ == '__main__':
    sys.exit(main())
