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
  if(process.env.DESIGNX_PERFORMANCE_ONLY==='true'){
    const {preview}=await import('vite');
    const server=await preview({configFile:false,root:process.env.DESIGNX_PERF_ROOT||process.cwd(),preview:{host:'127.0.0.1',port:webPort,strictPort:true,proxy:{'/api':`http://127.0.0.1:${apiPort}`}}});
    web={close:()=>new Promise(resolve=>server.httpServer.close(resolve))};
  }else{
    web = await viteServer({ configFile: false, server: { watch: { ignored: ['**/tests/e2e/.artifacts/**'] }, host: '127.0.0.1', port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
    await web.listen();
  }
  await child('apps/worker/src/main.ts', { WORKER_ROLE: 'media' });
  await child('apps/worker/src/main.ts', { WORKER_ROLE: 'import' });
  const renderer=await child('apps/renderer/src/main.ts');
  // Control only this suite's isolated renderer; no production fault hooks.
  globalThis.DESIGNX_RENDERER_FIXTURE={pause:()=>renderer.kill('SIGSTOP'),resume:()=>renderer.kill('SIGCONT')};
  if(process.env.DESIGNX_REGISTRATION_ONLY==='true'){
    await import('./account_journey.mjs');
    await import('./closed_registration_journey.mjs');
  }else if(process.env.DESIGNX_FEEDBACK_ONLY==='true'){
    await import('./feedback_journey.mjs');
  }else if(process.env.DESIGNX_UI_ONLY==='true'){
    await import('./ui_journey.mjs');
    await import('./library_journey.mjs');
  }else if(process.env.DESIGNX_PERFORMANCE_ONLY==='true'){
    await import('../perf/library-performance.mjs');
  }else if(process.env.DESIGNX_PREVIEWS_ONLY==='true'){
    await import('./previews_journey.mjs');
    await import('./library_journey.mjs');
    await import('./render_consistency.mjs');
  }else if (process.env.DESIGNX_TEMPLATES_ONLY === 'true') {
    await import('./templates_journey.mjs');
    await import('./render_consistency.mjs');
  }
  else if (process.env.DESIGNX_PREFERENCES_ONLY === 'true') {
    await import('./preferences_journey.mjs');
  }
  else if (process.env.DESIGNX_RECOVERY_ONLY === 'true') {
    await import('./recovery_journey.mjs');
    await import('./large_import_journey.mjs');
  }
  else {
    await import('./account_journey.mjs');
    await import('./poster_journey.mjs');
    await import('./library_journey.mjs');
    await import('./preferences_journey.mjs');
    await import('./previews_journey.mjs');
    await import('./templates_journey.mjs');
    await import('./ui_journey.mjs');
    // Each feature batch exercises the real registration limit. Start a fresh
    // isolated API for the added feedback batch so accumulated anonymous test
    // registrations do not consume later journeys' 15-minute IP budget.
    // Database, sessions, workers and real storage remain durable across restart.
    await app.close();app=await buildApp({logger:false});
    await app.listen({port:apiPort,host:'127.0.0.1'});
    await import('./feedback_journey.mjs');
    await import('./recovery_journey.mjs');
    await import('./large_import_journey.mjs');
    await import('./render_consistency.mjs');
    await import('./closed_registration_journey.mjs');
  }
} catch (error) {
  console.error(error); console.error(logs.slice(-5000)); process.exitCode = 1;
} finally {
  globalThis.DESIGNX_RENDERER_FIXTURE?.resume();
  for (const processHandle of children) processHandle.kill('SIGTERM');
  for (let n = 0; n < 40 && children.some(processHandle => processHandle.exitCode === null); n++) await delay(100);
  for (const processHandle of children) if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  await Promise.all(children.filter(processHandle => processHandle.exitCode === null).map(processHandle => new Promise(resolve => processHandle.once('exit', resolve))));
  await web?.close(); await app?.close(); await stopQueue(); await pool.end();
}
