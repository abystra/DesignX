#!/usr/bin/env python3
"""Build the committed workspace version and deploy it to aws-1."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT.parent / "work"
ACCESS = ROOT / "scripts/cloud/access.py"
COMPOSE_URL = "https://github.com/docker/compose/releases/download/v2.39.4/docker-compose-linux-x86_64"
COMPOSE_SHA256 = "7af95166a730b87e172d4fc9aefea8725d3c6c7327d59149267b452114ddb7d4"


def ssh(command, **kwargs):
    return subprocess.run([sys.executable, str(ACCESS), "ssh", command],
                          cwd=ROOT, check=True, **kwargs)


def runtime_configuration():
    env = os.environ
    required = ["DATABASE_URL", "PGPASSWORD"]
    for name in required:
        if not env.get(name):
            raise RuntimeError("Missing deployment binding: " + name)
    values = {
        "NODE_ENV": "production",
        "DATABASE_URL": env["DATABASE_URL"],
        "PGPASSWORD": env["PGPASSWORD"],
        "API_HOST": "127.0.0.1",
        "PORT": "3100",
        "WEB_ORIGIN": "https://designx.velax.cn",
        "S3_ENDPOINT": env.get("S3_ENDPOINT", "https://358f047a3eb6ccf29a49370b1693e54a.r2.cloudflarestorage.com"),
        "S3_REGION": env.get("S3_REGION", "auto"),
        "S3_BUCKET": env.get("S3_BUCKET", "designx"),
        "S3_STAGING_BUCKET": env.get("S3_STAGING_BUCKET", env.get("S3_BUCKET", "designx")),
        "S3_ACCESS_KEY_ID": env.get("S3_ACCESS_KEY_ID", env.get("WORKX_R2_PARENT_ACCESS_KEY_ID", "")),
        "S3_SECRET_ACCESS_KEY": env.get("S3_SECRET_ACCESS_KEY", env.get("WORKX_R2_PARENT_SECRET_ACCESS_KEY", "")),
        "STORAGE_DIRECT_UPLOADS_ENABLED": "false",
        "AI_ENABLED": env.get("AI_ENABLED", "false"),
        "IMAGE_GENERATION_ENABLED": env.get("IMAGE_GENERATION_ENABLED", "false"),
    }
    if not values["S3_ACCESS_KEY_ID"] or not values["S3_SECRET_ACCESS_KEY"]:
        raise RuntimeError("Missing deployment storage credentials")
    for name in ("S3_BUCKET_ALIASES_JSON", "E2B_TEMPLATE_ID", "DESIGNX_E2B_TEMPLATE",
                 "DESIGNX_RUNNER_V2", "DEEPSEEK_MODEL"):
        if env.get(name):
            values[name] = env[name]
    if values["AI_ENABLED"] == "true":
        for name in ("E2B_API_KEY", "DEEPSEEK_API_KEY"):
            if not env.get(name):
                raise RuntimeError("Missing deployment binding: " + name)
            values[name] = env[name]
    if values["IMAGE_GENERATION_ENABLED"] == "true":
        values["OPENAI_API_KEY"] = env["OPENAI_API_KEY"]
    if any("\n" in value or "\r" in value for value in values.values()):
        raise RuntimeError("Deployment environment values must be single-line")
    return values


def main():
    os.chdir(ROOT)
    WORK.mkdir(exist_ok=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if subprocess.run(["git", "diff", "--quiet", "HEAD"]).returncode:
        raise RuntimeError("Commit the version to deploy before creating the release")
    env = os.environ.copy()
    env.setdefault("COREPACK_HOME", str(WORK / "corepack"))
    subprocess.run(["corepack", "pnpm", "build"], env=env, check=True)
    binary = WORK / "bin/docker-compose"
    binary.parent.mkdir(exist_ok=True)
    if not binary.exists() or hashlib.sha256(binary.read_bytes()).hexdigest() != COMPOSE_SHA256:
        subprocess.run(["curl", "-fsSL", "--retry", "2", "--max-time", "180",
                        COMPOSE_URL, "-o", str(binary)], check=True)
    if hashlib.sha256(binary.read_bytes()).hexdigest() != COMPOSE_SHA256:
        raise RuntimeError("Docker Compose checksum mismatch")
    binary.chmod(0o755)
    release_id = commit[:12] + "-" + time.strftime("%Y%m%d%H%M%S", time.gmtime())
    archive = WORK / (release_id + ".tar")
    subprocess.run(["git", "archive", "--format=tar", "-o", str(archive), commit], check=True)
    with tarfile.open(archive, "a") as bundle:
        bundle.add(ROOT / "dist", arcname="dist")
        bundle.add(binary, arcname=".deployment/docker-compose")
    remote = "/srv/designx/releases/" + release_id
    ssh("sudo -n install -d -m 755 /srv/designx/releases /etc/designx " + shlex.quote(remote))
    with archive.open("rb") as source:
        ssh("sudo -n tar -xf - -C " + shlex.quote(remote), stdin=source)
    installer = """
import json, os
from pathlib import Path
import sys
values=json.load(sys.stdin)
path=Path('/etc/designx/app.env')
try:
 descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
except FileExistsError:
 print('Preserved existing server runtime configuration')
else:
 with os.fdopen(descriptor,'w') as output:
  output.write(''.join(key+'='+value+'\\n' for key,value in values.items()))
 print('Created server runtime configuration')
"""
    ssh("sudo -n python3 -c " + shlex.quote(installer),
        input=json.dumps(runtime_configuration()), text=True)
    ssh("sudo -n python3 " + shlex.quote(remote + "/scripts/cloud/deploy-release.py") +
        " " + shlex.quote(remote))
    print("Server deployment complete: https://designx.velax.cn")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(1)
