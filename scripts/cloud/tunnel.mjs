import { Sandbox } from 'e2b';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = resolve(root, '../work/bin');
const statePath = resolve(root, '.env.cloud-tunnel.local');
const releases = {
  chisel: {
    url: 'https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz',
    sha256: '0525aa3c5d457f2a4075e66221d5125d434bedf15006d3271c213f5cd6ff2230',
    gzip: true,
  },
  cloudflared: {
    url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.11.1/cloudflared-linux-amd64',
    sha256: '97bb3b02d23a5980fc9c15a1a270e692da1923f103f920d5b16d4931d5ab55e7',
  },
};

export async function installTunnelBinary(provider) {
  const release = releases[provider];
  if (!release) throw new Error('Choose chisel or cloudflared explicitly');
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The Codex cloud tunnel installer requires Linux x86_64');
  }
  await mkdir(cache, { recursive: true });
  const binary = resolve(cache, provider);
  try {
    execFileSync(binary, ['--version'], { stdio: 'ignore' });
    return binary;
  } catch {}
  const temporary = await mkdtemp(resolve(cache, '.download-'));
  try {
    const archive = resolve(temporary, 'archive');
    execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '120', release.url, '-o', archive]);
    const bytes = await readFile(archive);
    if (createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
      throw new Error('Tunnel binary checksum mismatch');
    }
    await writeFile(binary, release.gzip ? gunzipSync(bytes) : bytes, { mode: 0o755 });
    await chmod(binary, 0o755);
    return binary;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function stopProcess(process) {
  if (!process || process.exitCode !== null || process.signalCode !== null) return;
  process.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => process.once('exit', resolve)),
    delay(5000),
  ]);
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL');
    await new Promise(resolve => process.once('exit', resolve));
  }
}

export async function startTunnel(provider = 'chisel') {
  const binary = await installTunnelBinary(provider);
  let child;
  let sandbox;
  let server;
  let renewal;
  let owned = false;
  let closed = false;
  let failure;
  let logs = '';
  let state = '';
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    clearInterval(renewal);
    await stopProcess(child);
    try {
      if (owned) await sandbox?.kill();
      else if (server) await server.kill();
    } finally {
      if (state && await readFile(statePath, 'utf8').catch(() => '') === state) {
        await rm(statePath, { force: true });
      }
    }
  };
  const observe = process => {
    child = process;
    process.stderr.on('data', chunk => {
      logs = (logs + chunk.toString()).slice(-12000);
    });
    process.on('error', error => { failure = error; });
    process.on('exit', code => {
      if (!closed) failure = new Error('Tunnel exited with code ' + code);
    });
  };
  try {
    let webUrl;
    if (provider === 'chisel') {
      const options = {
        apiKey: process.env.E2B_API_KEY,
        proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
        httpVersion: '1.1',
        requestTimeoutMs: 30000,
      };
      const sandboxId = process.env.DESIGNX_TUNNEL_SANDBOX_ID;
      sandbox = sandboxId
        ? await Sandbox.connect(sandboxId, options)
        : await Sandbox.create({ ...options, timeoutMs: 600000,
          network: { allowPublicTraffic: false },
          metadata: { purpose: 'designx-development-tunnel' } });
      owned = !sandboxId;
      const directory = '/tmp/designx-chisel-' + randomBytes(8).toString('hex');
      const auth = 'designx:' + randomBytes(32).toString('hex');
      await sandbox.commands.run('mkdir -m 700 ' + directory);
      const bytes = await readFile(binary);
      await sandbox.files.write(directory + '/chisel', new Uint8Array(bytes).buffer);
      await sandbox.files.write(directory + '/auth.json', JSON.stringify({
        [auth]: ['^R:127\\.0\\.0\\.1:(5173|3001)$'],
      }));
      await sandbox.commands.run('chmod 700 ' + directory + '/chisel; chmod 600 ' + directory + '/auth.json');
      server = await sandbox.commands.run(
        'exec ' + directory + '/chisel server --host 0.0.0.0 --port 8080 --reverse --authfile ' +
        directory + '/auth.json > ' + directory + '/server.log 2>&1',
        { background: true, timeoutMs: 0 });
      let fingerprint;
      for (let attempt = 0; attempt < 40; attempt++) {
        const log = await sandbox.files.read(directory + '/server.log');
        fingerprint = log.match(/Fingerprint ([A-Za-z0-9+/]+=)/)?.[1];
        if (fingerprint) break;
        await delay(250);
      }
      if (!fingerprint) throw new Error('Chisel server did not become ready');
      const args = ['client', '--fingerprint', fingerprint,
        '--keepalive', '15s', '--max-retry-interval', '5s'];
      if (options.proxy) args.push('--proxy', options.proxy);
      if (sandbox.trafficAccessToken) {
        args.push('--header', 'e2b-traffic-access-token: ' + sandbox.trafficAccessToken);
      }
      args.push('https://' + sandbox.getHost(8080),
        'R:127.0.0.1:5173:127.0.0.1:5173',
        'R:127.0.0.1:3001:127.0.0.1:3001');
      observe(spawn(binary, args, { env: { ...process.env, AUTH: auth },
        stdio: ['ignore', 'ignore', 'pipe'] }));
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (failure) throw failure;
        try {
          const result = await sandbox.commands.run(
            'curl --fail --silent --max-time 3 http://127.0.0.1:3001/api/health',
            { timeoutMs: 5000 });
          if (JSON.parse(result.stdout).status === 'ok') {
            ready = true;
            break;
          }
        } catch {}
        await delay(500);
      }
      if (!ready) throw new Error('E2B could not reach the local API through chisel');
      renewal = setInterval(() => {
        sandbox.setTimeout(600000).catch(error => { failure = error; });
      }, 60000);
      webUrl = 'http://127.0.0.1:5173';
      state = [
        'DESIGNX_TUNNEL_PROVIDER=chisel',
        'DESIGNX_TUNNEL_SANDBOX_ID=' + sandbox.sandboxId,
        'DESIGNX_E2B_WEB_URL=' + webUrl,
        'DESIGNX_E2B_API_URL=http://127.0.0.1:3001',
        '',
      ].join('\n');
      console.log('Chisel ready. E2B sandbox ' + sandbox.sandboxId + ' can access the development Web and API.');
    } else {
      observe(spawn(binary, ['tunnel', '--no-autoupdate', '--protocol', 'http2',
        '--url', 'http://127.0.0.1:5173'], { stdio: ['ignore', 'ignore', 'pipe'] }));
      for (let attempt = 0; attempt < 120; attempt++) {
        if (failure) throw failure;
        webUrl = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
        if (webUrl) break;
        await delay(500);
      }
      if (!webUrl) throw new Error('Cloudflared did not provide a tunnel URL');
      state = 'DESIGNX_TUNNEL_PROVIDER=cloudflared\nDESIGNX_REMOTE_WEB_URL=' + webUrl + '\n';
      console.log('Explicit cloudflared tunnel ready at ' + webUrl);
    }
    await writeFile(statePath, state, { mode: 0o600 });
    return { sandbox, webUrl, cleanup, check() { if (failure) throw failure; } };
  } catch (error) {
    await cleanup();
    if (provider === 'cloudflared' && logs) {
      const details = logs.trim().split('\n').slice(-3).join('\n');
      throw new Error(error.message + '\n' + details);
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv.indexOf('--provider');
  const provider = argument === -1
    ? process.env.DESIGNX_TUNNEL_PROVIDER || 'chisel'
    : process.argv[argument + 1];
  let tunnel;
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { stopping = true; });
  }
  try {
    tunnel = await startTunnel(provider);
    while (!stopping) {
      tunnel.check();
      await delay(500);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await tunnel?.cleanup();
  }
}
