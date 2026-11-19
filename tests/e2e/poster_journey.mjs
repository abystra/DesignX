// Personal poster release: real API, media ingestion, saved documents and download.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
const base = process.env.DESIGNX_E2E_URL || 'http://127.0.0.1:5173';
const output = new URL(`./.artifacts/poster-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await context.request.fetch(base + '/api' + path, { method, data, headers: { Origin: base } });
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
function check(name) { checks.push(name); console.log('PASS', name); }
async function home(route = 'home') { await page.goto(base + '/#' + route); await page.getByRole('navigation', { name: '主导航' }).waitFor(); await page.locator('.app-shell[aria-busy=false]').waitFor(); }
async function saved() { await page.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.ed-save-state').filter({ hasText: '已保存' }).waitFor(); }
try {
  await api('/auth/register', { email: `poster-${randomUUID()}@example.test`, password: 'poster-regression-password', name: '海报验收' });
  await home();
  assert.equal(await page.locator('.composer').count(), 0);
  await page.getByRole('button', { name: /^预览模板 / }).first().click();
  await page.getByRole('button', { name: '使用这个模板' }).click();
  await page.waitForURL('**/#editor/*');
  const posterId = page.url().split('#editor/')[1];
  await page.getByLabel('作品名称', { exact: true }).fill('我的咖啡海报');
  await page.getByLabel('文字内容', { exact: true }).fill('周末来一杯');
  await saved();
  const poster = await api(`/projects/${posterId}`);
  assert.equal(poster.workspaceMode, 'editor');
  assert.equal(poster.design.nodes.find(node => node.id === 'subtitle').text, '周末来一杯');
  await page.reload(); await page.getByLabel('作品名称', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('作品名称', { exact: true }).inputValue(), '我的咖啡海报');
  assert.equal(await page.getByLabel('文字内容', { exact: true }).inputValue(), '周末来一杯');
  await page.screenshot({ path: new URL('editor.png', output).pathname });
  check('template → direct Editor → edit text → save → reload');
  await home('projects'); await page.getByRole('button', { name: '打开作品 我的咖啡海报', exact: true }).click();
  await page.waitForURL(`**/#editor/${posterId}`);
  await home(); await page.getByRole('button', { name: '搜索灵感、工具或作品' }).click();
  await page.getByLabel('全局搜索').fill('我的咖啡海报');
  await page.locator('.search-result').filter({ hasText: '我的咖啡海报' }).click();
  await page.waitForURL(`**/#editor/${posterId}`);
  check('project list and global search reopen the same editor');
  await page.getByRole('button', { name: '导出作品', exact: true }).click();
  await page.getByLabel('导出尺寸', { exact: true }).selectOption('1');
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: '导出 PNG', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = new URL('poster.png', output).pathname;
  await download.saveAs(downloadPath);
  const meta = await sharp(await readFile(downloadPath)).metadata();
  assert.equal(meta.width, 600); assert.equal(meta.height, 800);
  check('real renderer job downloads a 600 × 800 PNG');
  await home('assets');
  const image = await sharp({ create: { width: 240, height: 160, channels: 3, background: '#356448' } }).png().toBuffer();
  await page.getByLabel('上传素材图片').setInputFiles({ name: 'poster-logo.png', mimeType: 'image/png', buffer: image });
  await page.getByRole('button', { name: '预览 poster-logo', exact: true }).waitFor();
  // Poll the actual response: waitForFunction treats an async predicate's Promise
  // as truthy in our Playwright version and can finish while the asset is pending.
  let asset;
  const uploadDeadline = Date.now() + 60000;
  do {
    asset = (await api('/assets')).find(item => item.title === 'poster-logo');
    assert.notEqual(asset?.status, 'failed', asset?.error || 'Upload failed');
    if (asset?.status === 'ready') break;
    await delay(250);
  } while (Date.now() < uploadDeadline);
  assert.equal(asset?.status, 'ready', 'Uploaded material did not become ready');
  assert.ok(asset.versionId, 'Ready material must already have its immutable version');
  assert.equal(asset.image, `/api/assets/${asset.id}/versions/${asset.versionId}/file`);
  await page.locator('.ws-page[aria-busy=false]').waitFor();
  await page.getByRole('tab', { name: '品牌套件' }).click();
  await page.getByLabel('品牌名称', { exact: true }).fill('周末咖啡');
  await page.evaluate(() => window.dispatchEvent(new Event('designx:refresh')));
  await page.locator('.ws-page[aria-busy=false]').waitFor();
  assert.equal(await page.getByLabel('品牌名称', { exact: true }).inputValue(), '周末咖啡');
  await page.screenshot({ path: new URL('brand-form.png', output).pathname });
  await page.getByLabel('品牌字体', { exact: true }).selectOption('Source Serif 4 Variable');
  await page.getByLabel('品牌 Logo', { exact: true }).selectOption(asset.id);
  await page.getByRole('button', { name: '保存品牌套件', exact: true }).click();
  await page.getByRole('button', { name: '已保存品牌套件', exact: true }).waitFor();
  const brand = await api('/preferences/brand'); assert.equal(brand.logo, asset.image);
  await page.goto(base + '/#editor/' + posterId); await page.getByLabel('作品名称', { exact: true }).waitFor();
  await page.locator('.ed-stage').click({ position: { x: 8, y: 8 } });
  await page.getByRole('button', { name: '应用品牌配色', exact: true }).click();
  await page.getByRole('button', { name: '加入品牌 Logo', exact: true }).click();
  await saved();
  const branded = await api(`/projects/${posterId}`);
  assert.ok(branded.design.nodes.some(node => node.label === '品牌 Logo' && node.src === asset.image));
  assert.ok(branded.design.nodes.filter(node => node.type === 'text').every(node => node.font === 'Source Serif 4 Variable'));
  check('upload → save brand → apply font/colors and immutable Logo in editor');
  await home('assets'); await page.getByRole('button', { name: '预览 poster-logo', exact: true }).click();
  await page.getByRole('button', { name: '用于新设计' }).click(); await page.waitForURL('**/#editor/*');
  const assetPoster = await api('/projects/' + page.url().split('#editor/')[1]);
  assert.equal(assetPoster.design.nodes[0].src, asset.image);
  check('uploaded material is placed into the editable poster');
  await home('assets'); await page.getByRole('tab', { name: '创作参考' }).click();
  await page.getByRole('button', { name: '新建参考', exact: true }).click();
  await page.getByLabel('参考名称', { exact: true }).fill('咖啡参考');
  await page.getByLabel('创作提示词', { exact: true }).fill('暖色海报参考');
  await page.getByRole('button', { name: '选择 一杯咖啡的慢时光', exact: true }).click();
  await page.getByRole('button', { name: '保存创作参考', exact: true }).click();
  await page.getByRole('button', { name: '预览 咖啡参考', exact: true }).click();
  await page.getByRole('button', { name: '用于新设计' }).click(); await page.waitForURL('**/#editor/*');
  assert.equal((await api('/projects/' + page.url().split('#editor/')[1])).design.nodes[0].src, '/assets/coffee.jpg');
  await page.getByText('创作参考', { exact: true }).click();
  await page.getByText('暖色海报参考', { exact: true }).waitFor();
  check('stock reference creates a poster without INVALID_ASSET');
  await home('assets'); await page.getByRole('tab', { name: '创作参考' }).click();
  await page.getByRole('button', { name: '新建参考', exact: true }).click();
  await page.getByLabel('参考名称', { exact: true }).fill('文字参考');
  await page.getByLabel('创作提示词', { exact: true }).fill('保留这份创作要求');
  await page.getByRole('button', { name: '不使用参考图片', exact: true }).click();
  await page.getByRole('button', { name: '保存创作参考', exact: true }).click();
  await page.getByRole('button', { name: '预览 文字参考', exact: true }).click();
  await page.getByRole('button', { name: '用于新设计' }).click(); await page.waitForURL('**/#editor/*');
  const textPoster = await api('/projects/' + page.url().split('#editor/')[1]);
  assert.equal(textPoster.design.nodes.length, 0); assert.equal(textPoster.brief, '保留这份创作要求');
  check('text-only reference keeps the brief and creates no bogus asset link');
  await home();
  const before = (await api('/projects')).length;
  let intercepted = false;
  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'POST' && !intercepted) { intercepted = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('作品名称', { exact: true }).fill('可重试海报');
  await page.getByRole('button', { name: '创建海报', exact: true }).click();
  await page.getByRole('button', { name: '重试创建', exact: true }).click();
  await page.waitForURL('**/#editor/*');
  assert.equal((await api('/projects')).length, before + 1);
  await page.unroute('**/api/projects');
  check('lost create response retries with the same idempotency key and no duplicate project');
  await home('tools');
  assert.equal(await page.getByRole('button', { name: '开始设计', exact: true }).count(), 4);
  assert.equal(await page.getByText('智能抠图', { exact: true }).count(), 0);
  const oldStudio = await api('/projects', { title: '旧工作区' });
  await home('projects'); await page.getByRole('button', { name: '打开作品 旧工作区', exact: true }).click();
  await page.waitForURL(`**/#studio/${oldStudio.id}`);
  check('tools reflect published operations and existing Studio projects retain their entry');
  for (const [width, height] of [[1440, 1000], [1024, 768], [390, 844], [320, 568], [600, 844], [850, 768], [1100, 768], [720, 500]]) {
    await page.setViewportSize({ width, height }); await home();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home overflow at ${width}`);
    await page.screenshot({ path: new URL(`home-${width}.png`, output).pathname, fullPage: true });
  }
  // 1440 viewport at 200% page zoom has the layout viewport of 720 CSS pixels.
  check('home reflows at desktop/tablet/mobile, 320px, breakpoints and 200% equivalent viewport');
  await page.setViewportSize({ width: 390, height: 844 }); await home('tools');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: new URL('tools-mobile.png', output).pathname, fullPage: true });
  await home();
  await page.getByLabel('作品名称', { exact: true }).fill('手机海报');
  await page.getByRole('button', { name: '创建海报', exact: true }).click();
  await page.waitForURL('**/#editor/*');
  const mobileId = page.url().split('#editor/')[1];
  await page.getByRole('navigation', { name: '编辑工具' }).getByRole('button', { name: '文字', exact: true }).click();
  await page.getByRole('button', { name: '添加大标题', exact: true }).click();
  const mobileSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/projects/' + mobileId) && response.ok());
  await page.getByLabel('文字内容', { exact: true }).fill('手机创作也能保存');
  await page.getByRole('button', { name: '收起属性面板', exact: true }).click();
  await mobileSaved;
  assert.ok((await api('/projects/' + mobileId)).design.nodes.some(node => node.text === '手机创作也能保存'));
  await page.screenshot({ path: new URL('editor-mobile.png', output).pathname });
  check('390px blank poster creation, add text, edit and save through mobile panels');
  assert.deepEqual(errors, []);
} catch (error) {
  await writeFile(new URL('failure-dom.txt', output), await page.content()).catch(() => {});
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL('evidence.json', output), JSON.stringify({ base, data: 'isolated local regression database and storage; real services, synthetic account', checks, errors }, null, 2));
  await browser.close();
}
