"""Activate an uploaded DesignX release on aws-1. Run as root."""
from pathlib import Path
import os
import subprocess
import sys
import time

release = Path(sys.argv[1]).resolve()
base = Path("/srv/designx")
if release.parent != base / "releases":
    raise SystemExit("Unexpected release directory")
compose = release / ".deployment/docker-compose"
image_file = release / ".deployment/image.env"
current = base / "current"
if current.exists() and not current.is_symlink():
    raise SystemExit("The current release path is not a symlink")
previous = current.resolve() if current.is_symlink() else None
site = Path("/etc/nginx/sites-available/designx")
enabled = Path("/etc/nginx/sites-enabled/designx")
legacy = Path("/etc/nginx/sites-enabled/designx-development")
legacy_target = Path("/etc/nginx/sites-available/designx-development")
previous_site = site.read_bytes() if site.exists() else None
was_enabled = enabled.is_symlink()
was_legacy = legacy.is_symlink() and legacy.resolve() == legacy_target
if enabled.exists() and (not was_enabled or enabled.resolve() != site):
    raise SystemExit("Unexpected existing DesignX Nginx site")
if legacy.exists() and not was_legacy:
    raise SystemExit("Unexpected development Nginx site")


def compose_command(directory, *arguments):
    return [str(directory / ".deployment/docker-compose"),
            "--project-name", "designx",
            "--file", str(directory / "infra/compose/docker-compose.aws.yml"),
            "--env-file", str(directory / ".deployment/image.env"), *arguments]


def run(command, **kwargs):
    subprocess.run(command, check=True, **kwargs)


def point_current(target):
    temporary = base / ".current-new"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, current)


tag = "designx:" + release.name
run(["docker", "build", "--tag", tag, "--file", "infra/docker/Dockerfile", "."], cwd=release)
image = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", tag], text=True).strip()
image_file.write_text("DESIGNX_IMAGE=" + image + "\n")
for path in [release / "dist", *(release / "dist").rglob("*")]:
    path.chmod(0o755 if path.is_dir() else 0o644)
release.chmod(0o755)
run(compose_command(release, "run", "--rm", "--no-deps", "api",
                    "node", "--import", "tsx", "db/migrate.ts"))
try:
    run(compose_command(release, "up", "-d", "--wait", "--wait-timeout", "120"))
    for service, message in (("worker", "Design-X all worker ready"),
                             ("renderer", "Design-X renderer ready")):
        for attempt in range(30):
            logs = subprocess.check_output(
                compose_command(release, "logs", "--no-color", "--tail", "100", service),
                text=True, stderr=subprocess.STDOUT)
            if message in logs:
                break
            time.sleep(1)
        else:
            raise RuntimeError(service + " did not become ready")
    point_current(release)
    site.write_text((release / "infra/nginx/designx.conf").read_text())
    site.chmod(0o644)
    if not was_enabled:
        enabled.symlink_to(site)
    if was_legacy:
        legacy.unlink()
    run(["nginx", "-t"])
    active = subprocess.run(["systemctl", "is-active", "--quiet", "nginx"]).returncode == 0
    run(["systemctl", "reload" if active else "start", "nginx"])
    run(["systemctl", "enable", "nginx", "docker"])
except BaseException:
    if previous:
        point_current(previous)
    else:
        current.unlink(missing_ok=True)
    if previous_site is None:
        site.unlink(missing_ok=True)
    else:
        site.write_bytes(previous_site)
    if not was_enabled:
        enabled.unlink(missing_ok=True)
    if was_legacy and not legacy.exists():
        legacy.symlink_to(legacy_target)
    if previous and (previous / ".deployment/image.env").exists():
        subprocess.run(compose_command(previous, "up", "-d", "--wait", "--wait-timeout", "120"))
    else:
        subprocess.run(compose_command(release, "down"))
    raise
if was_legacy:
    legacy_target.unlink(missing_ok=True)
print("Deployed " + release.name + " at https://designx.velax.cn")
print("Application image " + image)
