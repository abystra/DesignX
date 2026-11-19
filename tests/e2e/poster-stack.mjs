// Dedicated browser stack: no cloud credentials, application DB or shared storage.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as netServer } from 'node:net';
import { createServer as viteServer } from 'vite';
const reservation = netServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const webPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
process.env.WEB_ORIGIN = `http://127.0.0.1:${webPort}`;
process.env.STORAGE_DIRECT_UPLOADS_ENABLED = 'false';
process.env.DESIGNX_E2E_URL = process.env.WEB_ORIGIN;
const { migrate } = await import('../../db/migrate.ts');
const { buildApp } = await import('../../apps/api/src/server.ts');
const { stopQueue } = await import('../../packages/server-infra/src/queue.ts');
const { pool } = await import('../../packages/server-infra/src/db.ts');
let app, web, logs = '', children = [];
async function child(path, extra = {}) {
  const processHandle = spawn(process.execPath, ['--import', 'tsx', path], { env: { ...process.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(processHandle);
  processHandle.stdout.on('data', data => { logs += data; });
  processHandle.stderr.on('data', data => { logs += data; });
  return processHandle;
}
try {
  await migrate(); app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const apiPort = app.server.address().port;
  web = await viteServer({ configFile: false, server: { watch: { ignored: ['**/tests/e2e/.artifacts/**'] }, host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
  await web.listen();
  await child('apps/worker/src/main.ts', { WORKER_ROLE: 'media' });
  await child('apps/renderer/src/main.ts');
  await import('./poster_journey.mjs');
  await import('./render_consistency.mjs');
} catch (error) {
  console.error(error); console.error(logs.slice(-5000)); process.exitCode = 1;
} finally {
  for (const processHandle of children) processHandle.kill('SIGTERM');
  for (let n = 0; n < 40 && children.some(processHandle => processHandle.exitCode === null); n++) await delay(100);
  for (const processHandle of children) if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  await Promise.all(children.filter(processHandle => processHandle.exitCode === null).map(processHandle => new Promise(resolve => processHandle.once('exit', resolve))));
  await web?.close(); await app?.close(); await stopQueue(); await pool.end();
}
