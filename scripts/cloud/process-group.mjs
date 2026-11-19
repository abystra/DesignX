import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
export async function requireFreePorts(ports) {
  for (const port of ports) {
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', () => reject(new Error(`Port ${port} is already occupied; reuse or stop the verified existing development session`))); server.listen(port, '0.0.0.0', resolve); });
    await new Promise(resolve => server.close(resolve));
  }
}
export function spawnGroup(command, args, options = {}) {
  return spawn(command, args, { ...options, detached: true });
}
// The new group belongs only to this launcher, including children of corepack/pnpm.
export async function stopGroup(child) {
  if (!child?.pid) return;
  const alive = () => { try { process.kill(-child.pid, 0); return true; } catch (e) { if (e.code !== 'ESRCH') throw e; return false; } };
  if (!alive()) return;
  process.kill(-child.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (alive() && Date.now() < deadline) await delay(50);
  if (alive()) process.kill(-child.pid, 'SIGKILL');
}
