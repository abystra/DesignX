import { spawnGroup, stopGroup, requireFreePorts } from './process-group.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { startTunnel } from './tunnel.mjs';

const providerArgument = process.argv.indexOf('--tunnel-provider');
const provider = providerArgument === -1
  ? process.env.DESIGNX_TUNNEL_PROVIDER || 'chisel'
  : process.argv[providerArgument + 1];
if (!['chisel', 'cloudflared'].includes(provider)) {
  throw new Error('Choose chisel or cloudflared with --tunnel-provider');
}
let stopping = false;
let applicationFailure;
let tunnel;
let application;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; });
}

try {
  await requireFreePorts([5173, 3001]);
  if (provider === 'cloudflared') tunnel = await startTunnel(provider);
  const env = { ...process.env };
  if (provider === 'cloudflared') env.WEB_ORIGIN = tunnel.webUrl;
  application = spawnGroup('corepack', ['pnpm', 'dev:v2'], { stdio: 'inherit', env });
  application.on('error', error => { applicationFailure = error; });
  application.on('exit', code => {
    if (!stopping) applicationFailure = new Error('Development processes exited with code ' + code);
  });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
    if (applicationFailure) throw applicationFailure;
    try {
      const response = await fetch('http://127.0.0.1:3001/api/health', {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!stopping && !ready) throw new Error('Development API did not become healthy');
  if (!stopping && !tunnel) tunnel = await startTunnel(provider);
  while (!stopping) {
    if (applicationFailure) throw applicationFailure;
    tunnel.check();
    await delay(500);
  }
} catch (error) {
  console.error('Cloud development failed:', error.message);
  process.exitCode = 1;
} finally {
  await tunnel?.cleanup();
  await stopGroup(application);
}
