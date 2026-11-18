#!/usr/bin/env python3
"""Access aws-1 through the managed Codex Tailscale proxy."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import select
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, unquote, urlsplit, urlunsplit

HERE = Path(__file__).resolve().parent
SERVER = "ubuntu@100.122.73.49"


def proxy():
    with socket.create_connection(("proxy", 8088), timeout=15) as connection:
        connection.sendall(
            b"CONNECT 100.122.73.49:22 HTTP/1.1\r\n"
            b"Host: 100.122.73.49:22\r\n\r\n"
        )
        headers = bytearray()
        while not headers.endswith(b"\r\n\r\n"):
            chunk = connection.recv(1)
            if not chunk or len(headers) >= 16384:
                raise RuntimeError("Incomplete proxy CONNECT response")
            headers.extend(chunk)
        status = headers.split(b"\r\n", 1)[0]
        if status.split()[1:2] != [b"200"]:
            raise RuntimeError(status.decode(errors="replace"))
        connection.settimeout(None)
        readers = [0, connection]
        while True:
            ready, _, _ = select.select(readers, [], [])
            if connection in ready:
                chunk = connection.recv(65536)
                if not chunk:
                    return
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            if 0 in ready:
                chunk = os.read(0, 65536)
                if chunk:
                    connection.sendall(chunk)
                else:
                    readers.remove(0)
                    connection.shutdown(socket.SHUT_WR)


@contextlib.contextmanager
def ssh_options():
    key_value = os.environ.get("AWS1_SSH_KEY", "").strip()
    if not key_value:
        raise RuntimeError("AWS1_SSH_KEY is missing. Check the environment variable binding.")
    with tempfile.TemporaryDirectory(prefix="aws1-access-") as directory:
        key = Path(directory) / "identity"
        key.touch(mode=0o600)
        key.write_text(key_value + "\n")
        yield [
            "ssh", "-F", "/dev/null",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            "-o", "IdentitiesOnly=yes",
            "-o", "IdentityAgent=none",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={HERE / 'aws1_known_hosts'}",
            "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", f"ProxyCommand={shlex.quote(sys.executable)} {shlex.quote(str(HERE / 'access.py'))} _proxy",
            "-i", str(key),
        ], Path(directory)


def check(options):
    # Credentials travel in SSH stdin, avoiding shell arguments and logs.
    remote = """
import json, os, subprocess, sys
settings = json.load(sys.stdin)
env = os.environ.copy()
env["PGPASSWORD"] = settings["pgpassword"]
env["PGCONNECT_TIMEOUT"] = "10"
postgres = subprocess.run(
    ["psql", "-X", "-w", settings["database_url"], "-Atqc",
     "SELECT current_database(), current_user;"],
    env=env, capture_output=True, text=True, timeout=20)
print("PostgreSQL:", postgres.stdout.strip() if postgres.returncode == 0
      else "connection failed (exit %s)" % postgres.returncode)
env["REDISCLI_AUTH"] = settings["redis_password"]
redis = subprocess.run(
    ["redis-cli", "-h", "127.0.0.1", "-p", "6379", "-n", "1", "PING"],
    env=env, capture_output=True, text=True, timeout=15)
redis_ok = redis.returncode == 0 and redis.stdout.strip() == "PONG"
print("Redis:", "PONG" if redis_ok else "connection failed")
sys.exit(0 if postgres.returncode == 0 and redis_ok else 1)
"""
    payload = {
        "database_url": os.environ["DATABASE_URL"],
        "pgpassword": os.environ.get("PGPASSWORD", ""),
        "redis_password": os.environ.get("REDIS_PASSWORD", ""),
    }
    identity = subprocess.run(options + [SERVER, "hostname && whoami"], check=False)
    if identity.returncode:
        return identity.returncode
    return subprocess.run(
        options + [SERVER, "python3 -c " + shlex.quote(remote)],
        input=json.dumps(payload), text=True, check=False,
    ).returncode


def unused_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def local_url(value, port, password=""):
    parsed = urlsplit(value)
    if parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise RuntimeError("Expected a loopback database URL for the aws-1 SSH tunnel")
    credentials = ""
    if parsed.username is not None or parsed.password is not None or password:
        credentials = quote(unquote(parsed.username or ""), safe="")
        secret = unquote(parsed.password) if parsed.password is not None else password
        if secret:
            credentials += ":" + quote(secret, safe="")
        credentials += "@"
    return urlunsplit(parsed._replace(netloc=f"{credentials}127.0.0.1:{port}"))


def run(options, directory, command):
    if not command:
        raise RuntimeError("Supply a command after run --")
    pg_port, redis_port = unused_port(), unused_port()
    while redis_port == pg_port:
        redis_port = unused_port()
    env = os.environ.copy()
    env["DATABASE_URL"] = local_url(env["DATABASE_URL"], pg_port)
    env["REDIS_URL"] = local_url(
        env["REDIS_URL"], redis_port, env.get("REDIS_PASSWORD", "")
    )
    env.update(PGHOST="127.0.0.1", PGPORT=str(pg_port))
    control = str(directory / "control")
    with subprocess.Popen(options + [
        "-M", "-S", control, "-o", "ExitOnForwardFailure=yes",
        "-L", f"127.0.0.1:{pg_port}:127.0.0.1:5432",
        "-L", f"127.0.0.1:{redis_port}:127.0.0.1:6379",
        "-N", SERVER,
    ]) as tunnel:
        child = None
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if tunnel.poll() is not None:
                    raise RuntimeError("SSH tunnel failed to start")
                if Path(control).exists():
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError("SSH tunnel startup timed out")
            print("aws-1 PostgreSQL and Redis tunnels ready", file=sys.stderr)
            child = subprocess.Popen(command, env=env, start_new_session=True)
            while child.poll() is None:
                if tunnel.poll() is not None:
                    raise RuntimeError("SSH tunnel disconnected")
                time.sleep(0.2)
            return child.returncode
        finally:
            if child is not None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["ssh", "check", "run", "_proxy"])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if args.action == "_proxy":
        proxy()
        return 0
    with ssh_options() as (options, directory):
        if args.action == "ssh":
            return subprocess.call(options + [SERVER] + command)
        if args.action == "check":
            return check(options)
        return run(options, directory, command)


if __name__ == "__main__":
    def terminate(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (RuntimeError, OSError, KeyError) as error:
        print(f"Cloud access failed: {error}", file=sys.stderr)
        sys.exit(1)
