#!/usr/bin/env python3
"""Initialize or run DesignX development in the Codex cloud environment."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ACCESS = ROOT / "scripts/cloud/access.py"
CACHE = ROOT.parent / "work"
R2_ENDPOINT = "https://358f047a3eb6ccf29a49370b1693e54a.r2.cloudflarestorage.com"


def configuration():
    env = os.environ.copy()
    for name in ("AWS1_SSH_KEY", "DATABASE_URL", "REDIS_URL"):
        if not env.get(name):
            raise RuntimeError(f"Missing environment binding: {name}")
    credentials = {
        "S3_ACCESS_KEY_ID": "WORKX_R2_PARENT_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY": "WORKX_R2_PARENT_SECRET_ACCESS_KEY",
    }
    for target, source in credentials.items():
        if not env.get(target):
            env[target] = env.get(source, "")
        if not env[target]:
            raise RuntimeError(f"Missing environment binding: {target} or {source}")
    defaults = {
        "COREPACK_HOME": str(CACHE / "corepack"),
        "PLAYWRIGHT_BROWSERS_PATH": str(CACHE / "ms-playwright"),
        "S3_ENDPOINT": R2_ENDPOINT,
        "S3_REGION": "auto",
        "S3_BUCKET": "designx",
        "WEB_ORIGIN": "http://127.0.0.1:5173",
        "API_HOST": "127.0.0.1",
        "DEV_HOST": "0.0.0.0",
        "PORT": "3001",
        "AI_ENABLED": "false",
        "IMAGE_GENERATION_ENABLED": "false",
    }
    for key, value in defaults.items():
        env.setdefault(key, value)
    env.setdefault("S3_STAGING_BUCKET", env["S3_BUCKET"])
    return env


def execute(command, env, **kwargs):
    subprocess.run(command, cwd=ROOT, env=env, check=True, **kwargs)


def setup(env, provider):
    execute(["corepack", "pnpm", "install", "--frozen-lockfile",
             "--store-dir", str(CACHE / "pnpm-store")], env)
    execute(["corepack", "pnpm", "exec", "playwright", "install", "chromium"], env)
    install = "import('./scripts/cloud/tunnel.mjs').then(m => m.installTunnelBinary(process.argv[1]));"
    execute(["node", "--input-type=module", "-e", install, provider], env)
    sql = (ROOT / "scripts/cloud/bootstrap.sql").read_text()
    execute([sys.executable, str(ACCESS), "ssh",
             "sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d designx"],
            env, input=sql, text=True)
    execute([sys.executable, str(ACCESS), "run", "--",
             "corepack", "pnpm", "db:migrate"], env)
    storage_check = """
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { storage } from './packages/server-infra/src/storage.ts';
for (const bucket of new Set([process.env.S3_BUCKET, process.env.S3_STAGING_BUCKET])) {
  await storage.send(new HeadBucketCommand({Bucket: bucket}));
  console.log('Storage bucket accessible:', bucket);
}
storage.destroy();
"""
    execute(["node", "--import", "tsx", "--input-type=module", "-e", storage_check], env)
    execute([sys.executable, str(ACCESS), "check"], env)
    print("Cloud development initialization complete", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "start"])
    parser.add_argument("--tunnel-provider", choices=["chisel", "cloudflared"],
                        default=os.environ.get("DESIGNX_TUNNEL_PROVIDER", "chisel"))
    args = parser.parse_args()
    env = configuration()
    if args.tunnel_provider == "cloudflared":
        env.setdefault("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", ".trycloudflare.com")
    if args.action == "setup":
        setup(env, args.tunnel_provider)
    else:
        os.chdir(ROOT)
        os.execvpe(sys.executable, [sys.executable, str(ACCESS), "run", "--",
                   "node", "scripts/cloud/start.mjs",
                   "--tunnel-provider", args.tunnel_provider], env)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Cloud development failed: {error}", file=sys.stderr)
        sys.exit(1)
