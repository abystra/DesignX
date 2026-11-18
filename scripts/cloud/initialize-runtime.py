"""Create the server-owned production runtime profile from deployment bindings."""
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

directory = Path("/etc/designx")
directory.mkdir(mode=0o700, exist_ok=True)
lock = (directory / ".runtime.lock").open("w")
fcntl.flock(lock, fcntl.LOCK_EX)
profile = directory / "app.env"
incoming = json.load(sys.stdin)
if profile.exists():
    print("Preserved existing server runtime configuration")
    raise SystemExit(0)


def query(sql):
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-v", "ON_ERROR_STOP=1",
         "-At", "-d", "postgres"],
        input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Production database initialization failed")
    return result.stdout.strip()


pending = directory / ".app.env.pending"
if pending.exists():
    values = json.loads(pending.read_text())
else:
    if query("SELECT 1 FROM pg_roles WHERE rolname='designx_app'") or query(
            "SELECT 1 FROM pg_database WHERE datname='designx_production'"):
        raise SystemExit("Production database or role already exists without its runtime profile")
    values = incoming
    values["DATABASE_URL"] = "postgresql://designx_app@127.0.0.1:5432/designx_production"
    values["PGPASSWORD"] = secrets.token_urlsafe(36)
    descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(values, output)
password = values["PGPASSWORD"]
if not query("SELECT 1 FROM pg_roles WHERE rolname='designx_app'"):
    query("CREATE ROLE designx_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '" + password + "'")
else:
    query("ALTER ROLE designx_app PASSWORD '" + password + "'")
if not query("SELECT 1 FROM pg_database WHERE datname='designx_production'"):
    query("CREATE DATABASE designx_production OWNER designx_app")
if not query("SELECT 1 FROM pg_roles WHERE rolname='designx_tenant'"):
    query("CREATE ROLE designx_tenant NOLOGIN")
query("GRANT designx_tenant TO designx_app WITH ADMIN OPTION")
temporary = directory / ".app.env.new"
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(descriptor, "w") as output:
    output.write("".join(key + "=" + value + "\n" for key, value in values.items()))
os.replace(temporary, profile)
pending.unlink()
print("Created isolated production database and server runtime configuration")
