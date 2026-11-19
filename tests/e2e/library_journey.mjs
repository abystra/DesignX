// B1: real API/browser with >1000 records. Only controlled failure/latency is mocked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { tenantTransaction } from '../../packages/server-infra/src/db.ts';
import { ingestBufferAsset } from '../../packages/server-domain/src/assets.ts';

assert.equal(process.env.DESIGNX_TEST_ENV, 'true', 'Scale fixtures require the isolated regression environment');
const base = process.env.DESIGNX_E2E_URL;
const output = new URL(`./.artifacts/library-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(); page.setDefaultTimeout(20000);
const errors = [], checks = [], requests = [], timings = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'GET') requests.push(new URL(request.url()).pathname); });
async function api(path, data, method = data === undefined ? 'GET' : 'POST', headers = {}) {
  const response = await context.request.fetch(base + '/api' + path, { method, data, headers: { Origin: base, ...headers } });
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`); return response.json();
}
async function home(route = 'projects') {
  const target = base + '/#' + route;
  if (page.url() === target) await page.reload();
  else await page.goto(target);
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  await page.locator('.app-shell[aria-busy=false]').waitFor();
}
async function ready() { await page.locator('.ws-page[aria-busy=false]').waitFor(); }
function check(name) { checks.push(name); console.log('PASS', name); }
try {
  const identity = await api('/auth/register', { email: `library-${randomUUID()}@example.test`, password: 'library-regression-password', name: '资料库验收' });
  const workspaceId = identity.workspace.id;
  const oldest = await api('/projects', { title: '藏在很早以前的作品', workspaceMode: 'editor', templateId: 't1' });
  const folder = await api('/folders', { name: '往期作品' });
  const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#346447' } }).png().toBuffer();
  const asset = await ingestBufferAsset(workspaceId, { bytes: image, mime: 'image/png', title: '藏在很早以前的素材', source: { kind: 'upload' }, attemptId: randomUUID() });
  await tenantTransaction(workspaceId, async tx => {
    await tx.query("UPDATE projects SET folder_id=$2,updated_at='2020-01-01',last_opened_at=now() WHERE id=$1", [oldest.id, folder.id]);
    await tx.query("UPDATE assets SET created_at='2020-01-01' WHERE id=$1", [asset.assetId]);
    await tx.query(`INSERT INTO projects(id,workspace_id,title,workspace_mode,updated_at)
      SELECT $1||'-project-'||n,$1,'资料库作品 '||lpad(n::text,4,'0'),'editor','2024-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,1005) n`, [workspaceId]);
    await tx.query(`INSERT INTO documents(id,workspace_id,project_id,kind,title,content)
      SELECT p.id||'-document',p.workspace_id,p.id,'artboard',p.title,
      '{"width":600,"height":800,"background":"#FFF0EA","nodes":[{"id":"text","type":"text","text":"真实作品预览","x":40,"y":60,"w":520,"h":120,"size":40,"color":"#292B2E"}]}'::jsonb
      FROM projects p WHERE p.primary_artboard_id IS NULL`);
    await tx.query("UPDATE projects SET primary_artboard_id=id||'-document' WHERE primary_artboard_id IS NULL");
    await tx.query(`INSERT INTO assets(id,workspace_id,title,mime,bytes,object_key,created_at)
      SELECT $1||'-asset-'||n,$1,'资料库素材 '||lpad(n::text,4,'0'),'image/png',12,'pending/'||n,
      '2024-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,1005) n`, [workspaceId]);
  });
  const start = performance.now();
  const bounded = await api('/projects/page');
  timings.push({ operation: '24 project metadata items among 1006', durationMs: Math.round(performance.now() - start), responseBytes: Buffer.byteLength(JSON.stringify(bounded)) });
  assert.equal(bounded.total, 1006); assert.equal(bounded.items.length, 24);
  assert.ok(bounded.items.every(p => !p.design && !p.brief));
  await home(); await ready();
  assert.equal(await page.locator('.ws-project-card').count(), 24);
  await page.locator('.ws-project-card .dx-artboard').first().waitFor();
  await page.screenshot({ path: new URL('projects-desktop.png', output).pathname, fullPage: true });
  let failNext = true;
  await page.route('**/api/projects/page?**', async route => {
    if (new URL(route.request().url()).searchParams.has('cursor') && failNext) {
      failNext = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '可恢复的分页故障' }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '加载更多作品', exact: true }).click();
  await page.getByRole('button', { name: '重试加载作品', exact: true }).waitFor();
  assert.equal(await page.locator('.ws-project-card').count(), 24, 'Failed next page keeps the visible page');
  await page.screenshot({ path: new URL('page-retry.png', output).pathname });
  await page.getByRole('button', { name: '重试加载作品', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ws-project-card').length === 48);
  await page.unroute('**/api/projects/page?**');
  check('bounded metadata, real visible previews, next-page failure keeps items and retry appends without duplicates');
  await page.getByLabel('搜索作品').fill('藏在很早以前'); await ready();
  await page.getByRole('button', { name: '打开作品 藏在很早以前的作品', exact: true }).waitFor();
  assert.equal(await page.locator('.ws-project-card').count(), 1);
  await page.getByRole('button', { name: '打开作品 藏在很早以前的作品', exact: true }).click();
  await page.waitForURL(`**/#editor/${oldest.id}`);
  assert.equal(await page.getByLabel('作品名称', { exact: true }).inputValue(), oldest.title);
  await home('home');
  await page.getByRole('button', { name: '搜索灵感、工具或作品' }).click();
  await page.getByLabel('全局搜索').fill('藏在很早以前的作品');
  await page.locator('.search-result').filter({ hasText: oldest.title }).click();
  await page.waitForURL(`**/#editor/${oldest.id}`);
  check('project list and global server search open the poster older than the legacy 1000-item cutoff');
  await home(); await ready();
  await page.getByRole('button', { name: /往期作品.*1 个作品/ }).click(); await ready();
  assert.equal(await page.locator('.ws-project-card').count(), 1);
  await home('recent'); await ready();
  await page.getByLabel('作品排序').selectOption('name'); await ready();
  assert.equal(await page.locator('.ws-project-card').count(), 1);
  check('folder count/filter and recently opened name sort use complete server state');
  await home(); await ready();
  let held = false;
  await page.route('**/api/projects/page?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === '资料库作品') {
      held = true;
      const response = await route.fetch(); await delay(600);
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  await page.getByLabel('搜索作品').fill('资料库作品');
  for (let n = 0; n < 40 && !held; n++) await delay(50);
  assert.ok(held); await page.getByLabel('搜索作品').fill('藏在很早以前');
  await page.getByRole('button', { name: '打开作品 藏在很早以前的作品', exact: true }).waitFor();
  await delay(700);
  assert.equal(await page.locator('.ws-project-card').count(), 1);
  await page.unroute('**/api/projects/page?**');
  check('late search response cannot replace the current query results');
  await home(); await ready();
  let failSearch = true;
  await page.route('**/api/projects/page?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === '藏在很早以前' && failSearch) {
      failSearch = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '搜索暂时不可用' }) });
    } else await route.continue();
  });
  await page.getByLabel('搜索作品').fill('藏在很早以前');
  await page.getByRole('button', { name: '重试加载作品', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('designx:refresh')));
  await delay(350);
  await page.getByRole('button', { name: '重试加载作品', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '没有找到相关作品', exact: true }).count(), 0);
  await page.getByRole('button', { name: '重试加载作品', exact: true }).click();
  await page.getByRole('button', { name: '打开作品 藏在很早以前的作品', exact: true }).waitFor();
  await page.unroute('**/api/projects/page?**');
  check('failed server search stays an error and retry restores the matching result');
  await home('assets'); await ready();
  assert.equal(await page.locator('.ws-asset-card').count(), 28);
  await page.getByLabel('搜索资产').fill('藏在很早以前'); await ready();
  await page.getByRole('button', { name: '预览 藏在很早以前的素材', exact: true }).waitFor();
  assert.equal(await page.locator('.ws-asset-card').count(), 1);
  await page.getByRole('button', { name: '预览 藏在很早以前的素材', exact: true }).click();
  await page.getByRole('button', { name: '用于新设计', exact: true }).click(); await page.waitForURL('**/#editor/*');
  const created = await api('/projects/' + page.url().split('#editor/')[1]);
  assert.equal(created.design.nodes[0].src, asset.image);
  check('old uploaded material found by server search is placed into a real saved poster');
  for (const item of [asset.assetId, 'stock-coffee']) await api('/preferences/asset-favorites/items', { item, present: true }, 'PATCH', { 'Idempotency-Key': randomUUID() });
  await home('assets'); await ready();
  await page.getByRole('tab', { name: '我的收藏' }).click(); await ready();
  await page.getByRole('button', { name: '预览 藏在很早以前的素材', exact: true }).waitFor();
  assert.equal(await page.locator('.ws-asset-card').count(), 2);
  check('favorite material outside the initial page remains visible alongside the built-in favorite');
  await page.getByRole('tab', { name: '品牌套件' }).click();
  await page.getByLabel('品牌名称', { exact: true }).fill('资料库品牌');
  await page.getByLabel('搜索品牌 Logo').fill('藏在很早以前');
  await page.getByLabel('品牌 Logo', { exact: true }).selectOption(asset.assetId);
  await page.getByRole('button', { name: '保存品牌套件', exact: true }).click();
  await page.getByRole('button', { name: '已保存品牌套件', exact: true }).waitFor();
  assert.equal((await api('/preferences/brand')).logo, asset.image);
  await page.getByRole('tab', { name: '创作参考' }).click();
  await page.getByRole('button', { name: '新建参考', exact: true }).click();
  await page.getByLabel('参考名称', { exact: true }).fill('老素材参考');
  await page.getByLabel('创作提示词', { exact: true }).fill('保留旧素材的不可变版本');
  await page.getByLabel('搜索参考图片').fill('藏在很早以前');
  await page.getByRole('button', { name: '选择 藏在很早以前的素材', exact: true }).click();
  await page.getByRole('button', { name: '保存创作参考', exact: true }).click();
  await page.getByRole('dialog', { name: '把灵感存成创作参考' }).waitFor({ state: 'hidden' });
  const reference = (await api('/preferences/references')).find(r => r.title === '老素材参考');
  assert.equal(reference.material.id, asset.assetId); assert.equal(reference.material.versionId, asset.assetVersionId);
  check('brand and reference pickers search the entire material library and pin immutable versions');
  const studio = await api('/projects', { title: '旧工作区素材分页' });
  await home('studio/' + studio.id);
  await page.getByRole('button', { name: '引用资产', exact: true }).click();
  await page.getByRole('button', { name: '我的资产', exact: true }).click();
  await page.getByLabel('搜索我的资产').fill('藏在很早以前');
  await page.locator('.st-library-item').filter({ hasText: '藏在很早以前的素材' }).waitFor();
  check('existing Studio material picker also uses paginated server search');
  for (const [width, height] of [[1440,1000],[1024,768],[390,844],[320,568],[600,844],[850,768],[1100,768],[720,500]]) {
    await page.setViewportSize({ width, height }); await home(); await ready();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Library overflow at ${width}`);
    if ([1440,390,320].includes(width)) await page.screenshot({ path: new URL(`projects-${width}.png`, output).pathname, fullPage: true });
  }
  check('paged project library reflows at desktop/tablet/mobile/breakpoints and 200% equivalent viewport');
  assert.equal(requests.filter(path => ['/api/projects', '/api/assets'].includes(path)).length, 0, 'Product library no longer requests unpaginated lists');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  await writeFile(new URL('failure-dom.txt', output), await page.content()).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL('evidence.json', output), JSON.stringify({ base, data: 'isolated local services; 1006 projects and 1006 materials, synthetic account', checks, timings, errors }, null, 2));
  await browser.close();
}
