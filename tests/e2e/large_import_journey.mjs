// Real HTTP/Import Worker and image bytes; large payloads use isolated storage.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { request } from 'playwright';
import sharp from 'sharp';
assert.equal(process.env.DESIGNX_TEST_ENV, 'true');
const base = process.env.DESIGNX_E2E_URL;
const client = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base }, timeout: 120000 });
const output = new URL('./.artifacts/large-import-' + Date.now() + '/', import.meta.url);
await mkdir(output, { recursive: true });
const checks = [];
async function api(path, data) {
  const response = await client.fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', data });
  assert.ok(response.ok(), path + ': ' + response.status() + ' ' + await response.text()); return response.json();
}
try {
  await api('/auth/register', { username: 'import_' + randomUUID().slice(0, 8), password: 'large-import-password', name: '大项目导入' });
  const packet = { format: 'designx.project', schemaVersion: 1, title: '大文件导入验收', primaryArtboardId: 'poster', documents: [{ id: 'poster', kind: 'artboard', title: '真实图片海报', content: { width: 600, height: 800, background: '#ffffff', nodes: [] } }], assets: {} };
  for (let i = 0; i < 3; i++) {
    const buffer = await sharp(randomBytes(1800 * 1850 * 3), { raw: { width: 1800, height: 1850, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    assert.ok(buffer.length < 10 * 1024 * 1024);
    const source = '/api/assets/import-original-' + i + '/file';
    packet.assets[source] = 'data:image/png;base64,' + buffer.toString('base64');
    packet.documents[0].content.nodes.push({ id: 'image-' + i, type: 'image', src: source, x: i * 100, y: i * 100, w: 300, h: 300, fit: 'contain' });
    if (i === 1) continue;
    const bytes = Buffer.from(JSON.stringify(packet));
    assert.ok(bytes.length > (i === 0 ? 12 : 37) * 1024 * 1024 && bytes.length < 40 * 1024 * 1024);
    const response = await client.post('/api/projects/import', { headers: { 'Idempotency-Key': randomUUID() }, multipart: { file: { name: 'large.dxproj', mimeType: 'application/json', buffer: bytes } } });
    assert.equal(response.status(), 202, await response.text());
    let job = await response.json(); const deadline = Date.now() + 120000;
    do { job = await api('/jobs/' + job.id); if (['succeeded', 'failed', 'cancelled'].includes(job.status)) break; await delay(500); } while (Date.now() < deadline);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    const project = await api('/projects/' + job.result.projectId);
    assert.equal(project.design.nodes.length, i + 1);
    const file = await client.get(project.design.nodes[0].src);
    assert.ok(file.ok());
    const metadata = await sharp(await file.body()).metadata();
    assert.equal(metadata.width, 1800); assert.equal(metadata.height, 1850);
    checks.push({ sourceBytes: bytes.length, imageCount: i + 1, status: 'imported and immutable image downloaded' });
    console.log('PASS valid import', bytes.length, 'bytes,', i + 1, 'real images');
  }
  const before = (await api('/projects/page')).total;
  const invalid = await client.post('/api/projects/import', { multipart: { file: { name: 'too-large.dxproj', mimeType: 'application/json', buffer: Buffer.alloc(40 * 1024 * 1024 + 1, 32) } } });
  assert.equal(invalid.status(), 413); assert.equal((await api('/projects/page')).total, before);
  checks.push({ sourceBytes: 40 * 1024 * 1024 + 1, status: '413; no project created' });
  console.log('PASS oversized import rejected without changing existing projects');
} finally {
  await writeFile(new URL('evidence.json', output), JSON.stringify({ base, data: 'isolated database and storage; synthetic random-pixel PNG fixtures', checks }, null, 2));
  await client.dispose();
}
