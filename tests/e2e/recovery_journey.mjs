// Real isolated services; only failed/lost HTTP responses are intercepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
assert.equal(process.env.DESIGNX_TEST_ENV, 'true');
const base = process.env.DESIGNX_E2E_URL;
const output = new URL('./.artifacts/recovery-' + Date.now() + '/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const other = await browser.newContext();
const page = await context.newPage(); page.setDefaultTimeout(12000);
page.on('dialog', dialog => dialog.accept());
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const account = 'recover_' + randomUUID().slice(0, 8), password = 'recovery-test-password';
async function api(path, data, method = data === undefined ? 'GET' : 'POST', client = context) {
  const response = await client.request.fetch(base + '/api' + path, { method, data, headers: { Origin: base } });
  assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`); return response.json();
}
const title = p => p.getByLabel('作品名称', { exact: true });
async function open(project, p = page) { await p.goto(base + '/#editor/' + project.id); await title(p).waitFor(); await p.locator('.ed-root[aria-busy=true]').waitFor({ state: 'hidden' }); }
async function saved(p = page) { await p.getByRole('button', { name: '保存', exact: true }).click(); await p.locator('.ed-save-state').filter({ hasText: '已保存' }).waitFor(); }
async function poll(fn, label) { const end = Date.now() + 12000; do { if (await fn()) return; await delay(80); } while (Date.now() < end); throw new Error(label); }
async function cached(text, p = page) {
  await poll(() => p.evaluate(async text => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('designx-pending-documents', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const entries = await new Promise(resolve => { const r = db.transaction('drafts').objectStore('drafts').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return entries.some(entry => entry.title === text);
  }, text), 'draft not persisted: ' + text);
}
function check(value) { checks.push(value); console.log('PASS', value); }
try {
  await api('/auth/register', { username: account, password, name: '恢复验收' });
  const project = await api('/projects', { title: '恢复基线', workspaceMode: 'editor', templateId: 't1' });
  await open(project);
  // Revoke this session from another device after the edit has been cached.
  await page.route('**/api/projects/' + project.id, route => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await title(page).fill('过期会话中的未保存作品'); await cached('过期会话中的未保存作品');
  await api('/auth/login', { account, password }, 'POST', other);
  await api('/auth/sessions/revoke-others', {}, 'POST', other);
  await page.unroute('**/api/projects/' + project.id);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor();
  await page.getByLabel('登录账号', { exact: true }).fill(account);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click();
  await page.waitForURL('**/#editor/' + project.id);
  await title(page).waitFor();
  await poll(async () => await title(page).inputValue() === '过期会话中的未保存作品', 'expired-session draft lost');
  await saved(); assert.equal((await api('/projects/' + project.id)).title, '过期会话中的未保存作品');
  check('session revoked → login → same editor and unsaved draft restored');
  // The server really commits; drop only its response and retry.
  const before = await api('/projects/' + project.id);
  let lost = false;
  await page.route('**/api/projects/' + project.id, async route => {
    if (route.request().method() === 'PATCH' && !lost) { lost = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await title(page).fill('响应丢失后只保存一次');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.locator('.ed-save-state').filter({ hasText: '已保存' }).waitFor();
  const retried = await api('/projects/' + project.id);
  assert.equal(retried.revision, before.revision + 1);
  assert.equal(retried.title, '响应丢失后只保存一次');
  await page.unroute('**/api/projects/' + project.id);
  check('lost save response retries without duplicate revision or false conflict');
  // Two tabs retain distinct drafts; saving one must not erase the other.
  const second = await context.newPage(); second.on('dialog', dialog => dialog.accept());
  await open(retried, second);
  await page.route('**/api/projects/' + project.id, route => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await title(page).fill('标签 A 离线修改'); await cached('标签 A 离线修改');
  await title(second).fill('标签 B 已保存修改'); await saved(second);
  await cached('标签 A 离线修改');
  await page.unroute('**/api/projects/' + project.id);
  await page.reload(); await title(page).waitFor();
  await page.getByRole('button', { name: '将我的修改另存副本', exact: true }).waitFor();
  assert.equal(await title(page).inputValue(), '标签 A 离线修改');
  const count = (await api('/projects/page')).total;
  let copyLost = false;
  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'POST' && !copyLost) { copyLost = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: '将我的修改另存副本', exact: true }).click();
  await page.getByRole('button', { name: '将我的修改另存副本', exact: true }).click();
  await page.waitForURL(url => url.hash.startsWith('#editor/') && url.hash !== '#editor/' + project.id);
  const copyId = new URL(page.url()).hash.slice(8);
  assert.equal((await api('/projects/page')).total, count + 1);
  await page.unroute('**/api/projects');
  await page.reload(); await title(page).waitFor();
  assert.equal(await title(page).inputValue(), '标签 A 离线修改 · 副本');
  assert.equal((await api('/projects/' + copyId)).workspaceMode, 'editor');
  assert.equal((await api('/projects/' + project.id)).title, '标签 B 已保存修改');
  await second.close();
  check('two tabs retain separate drafts; conflict copy is idempotent and reloads its own route');
  // Editing while an earlier request is in flight must keep the latest title.
  let acknowledge, began;
  const started = new Promise(resolve => { began = resolve; });
  const held = new Promise(resolve => { acknowledge = resolve; });
  let delayed = false;
  await page.route('**/api/projects/' + copyId, async route => {
    if (route.request().method() === 'PATCH' && !delayed) {
      delayed = true; const response = await route.fetch(); began(); await held; await route.fulfill({ response });
    } else await route.continue();
  });
  await title(page).fill('正在发送的标题');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await started;
  await title(page).fill('请求期间继续输入的标题');
  acknowledge();
  await page.locator('.ed-save-state').filter({ hasText: '已保存' }).waitFor();
  assert.equal((await api('/projects/' + copyId)).title, '请求期间继续输入的标题');
  await page.unroute('**/api/projects/' + copyId);
  check('edits during an in-flight save are persisted before saved/navigation');
  // Offline journal survives reload, then explicit latest-version choice clears it.
  await page.route('**/api/projects/' + copyId, route => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await title(page).fill('刷新保留的本机草稿'); await cached('刷新保留的本机草稿');
  await page.reload(); await title(page).waitFor();
  await poll(async () => await title(page).inputValue() === '刷新保留的本机草稿', 'refresh lost local draft');
  const remote = await api('/projects/' + copyId);
  await api('/projects/' + copyId, { title: '另一设备的新版本', design: remote.design, baseRevision: remote.revision }, 'PATCH');
  await page.unroute('**/api/projects/' + copyId);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '使用最新版本', exact: true }).click();
  await poll(async () => await title(page).inputValue() === '另一设备的新版本', 'latest version not applied');
  assert.equal(await title(page).inputValue(), '另一设备的新版本');
  await page.reload(); await title(page).waitFor();
  assert.equal(await title(page).inputValue(), '另一设备的新版本');
  check('offline draft survives reload; choosing latest clears only that draft');
  // A different account in the same browser cannot inherit route or draft data.
  await page.route('**/api/projects/' + copyId, route => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await title(page).fill('仅属于原账号的草稿'); await cached('仅属于原账号的草稿');
  await api('/auth/logout', {});
  await page.unroute('**/api/projects/' + copyId);
  await page.reload();
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor();
  const secondAccount = 'isolated_' + randomUUID().slice(0, 8);
  await api('/auth/register', { username: secondAccount, password, name: '另一个用户' }, 'POST', other);
  await page.getByLabel('登录账号', { exact: true }).fill(secondAccount);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click();
  await page.locator('.app-shell[aria-busy=false]').waitFor();
  assert.equal(new URL(page.url()).hash, '#home');
  assert.equal(await page.getByText('仅属于原账号的草稿', { exact: true }).count(), 0);
  assert.equal((await context.request.get(base + '/api/projects/' + copyId)).status(), 404);
  await api('/auth/logout', {});
  await api('/auth/login', { account, password });
  await page.reload();
  await open({ id: copyId });
  await poll(async () => await title(page).inputValue() === '仅属于原账号的草稿', 'original account cannot recover its draft');
  await saved();
  check('account switch isolates drafts and original account can recover its own edits');
  await page.route('**/api/projects/' + copyId, route => route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await title(page).fill('原作品删除后仍可恢复'); await cached('原作品删除后仍可恢复');
  await api('/projects/' + copyId, undefined, 'DELETE');
  await page.unroute('**/api/projects/' + copyId);
  await page.reload();
  await page.getByRole('alert').filter({ hasText: '作品已删除或当前账号无法访问' }).waitFor();
  assert.equal(await title(page).inputValue(), '原作品删除后仍可恢复');
  await page.getByRole('button', { name: '将我的修改另存副本', exact: true }).click();
  await page.waitForURL(url => url.hash.startsWith('#editor/') && url.hash !== '#editor/' + copyId);
  await title(page).waitFor();
  assert.equal(await title(page).inputValue(), '原作品删除后仍可恢复 · 副本');
  assert.equal((await context.request.get(base + '/api/projects/' + copyId)).status(), 404);
  check('deleted project keeps scoped local draft and can be explicitly copied without restoring the original');
  await page.screenshot({ path: new URL('recovered-editor.png', output).pathname });
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  await writeFile(new URL('failure-dom.txt', output), await page.content()).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL('evidence.json', output), JSON.stringify({ base, data: 'isolated DB/storage; real services with deliberate response failures', checks, errors }, null, 2));
  await browser.close();
}
