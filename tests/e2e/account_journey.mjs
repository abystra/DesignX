// Real browser/API account journey; deliberate failures are explicitly intercepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
assert.equal(process.env.DESIGNX_TEST_ENV, 'true');
const base = process.env.DESIGNX_E2E_URL;
const output = new URL('./.artifacts/account-' + Date.now() + '/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const other = await browser.newContext();
const page = await context.newPage(); page.setDefaultTimeout(20000);
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const username = 'creator_' + randomUUID().slice(0, 8), password = 'original-account-password', nextPassword = 'changed-account-password';
async function api(path, data, method = data === undefined ? 'GET' : 'POST', client = context) {
  const r = await client.request.fetch(base + '/api' + path, { method, data, headers: { Origin: base } });
  assert.ok(r.ok(), path + ': ' + r.status() + ' ' + await r.text()); return r.json();
}
function check(name) { checks.push(name); console.log('PASS', name); }
async function ready() { await page.locator('.app-shell[aria-busy=false]').waitFor(); }
async function screenshots(kind) {
  for (const [width,height] of [[1440,1000],[1024,768],[390,844],[320,568],[600,844],[850,768],[1100,768],[720,500]]) {
    await page.setViewportSize({ width,height }); await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), kind + ' overflows at ' + width);
    if ([1440,390,320].includes(width)) await page.screenshot({ path: new URL(kind + '-' + width + '.png', output).pathname, fullPage: true });
  }
  await page.setViewportSize({width:1440,height:1000});
}
try {
  await page.goto(base); await page.getByRole('button', { name: '第一次来？创建账户' }).click();
  await page.getByLabel('你的名字', { exact: true }).fill('普通账号创作者');
  await page.getByLabel('账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '两次输入的密码不一致' }).waitFor();
  assert.equal(await page.getByLabel('账号', { exact: true }).inputValue(), username);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await screenshots('register');
  await page.route('**/api/auth/register', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"暂时无法注册，请重试"}' }));
  await page.getByRole('button', { name: '创建账户', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '暂时无法注册' }).waitFor();
  assert.equal(await page.getByLabel('账号', { exact: true }).inputValue(), username);
  await page.unroute('**/api/auth/register');
  await page.getByRole('button', { name: '创建账户', exact: true }).click(); await ready();
  const identity = await api('/auth/me'); assert.equal(identity.user.username, username); assert.equal(identity.user.email, null);
  check('username-only registration, password confirmation and recoverable failure');
  const project = await api('/projects', { title: '账号持久化海报', workspaceMode: 'editor', templateId: 't1' });
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByRole('heading', { name: '账户设置', exact: true }).waitFor();
  await page.getByLabel('昵称', { exact: true }).fill('更新后的昵称');
  await page.getByLabel('空间名称', { exact: true }).fill('我的海报工作室');
  await page.route('**/api/auth/profile', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"资料保存失败，请重试"}' }));
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '资料保存失败' }).waitFor();
  assert.equal(await page.getByLabel('昵称', { exact: true }).inputValue(), '更新后的昵称');
  await page.unroute('**/api/auth/profile');
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '个人资料已保存' }).waitFor();
  await page.reload(); await page.getByLabel('昵称', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('昵称', { exact: true }).inputValue(), '更新后的昵称');
  assert.equal(await page.getByLabel('空间名称', { exact: true }).inputValue(), '我的海报工作室');
  assert.ok((await page.locator('.space-picker').innerText()).includes('我的海报工作室'));
  assert.equal((await page.getByRole('button', { name: '个人账户设置', exact: true }).innerText()).trim(), '更');
  check('profile draft survives failure and saved names survive reload');
  await screenshots('settings');
  await api('/auth/login', { account: username, password }, 'POST', other);
  await page.getByLabel('当前密码', { exact: true }).fill('wrong-password');
  await page.getByLabel('新密码', { exact: true }).fill(nextPassword);
  await page.getByLabel('确认新密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '当前密码不正确' }).waitFor();
  assert.equal((await api('/auth/me')).user.id, identity.user.id);
  await page.getByLabel('当前密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '更新密码', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '密码已修改' }).waitFor();
  assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), '');
  assert.equal((await other.request.get(base + '/api/auth/me')).status(), 401);
  assert.equal((await api('/auth/me')).user.id, identity.user.id);
  check('password update keeps current device, clears fields and revokes old sessions');
  await api('/auth/login', { account: username, password: nextPassword }, 'POST', other);
  await page.getByRole('button', { name: '退出其他设备', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '其他设备已退出登录，当前设备继续使用' }).waitFor();
  assert.equal((await other.request.get(base + '/api/auth/me')).status(), 401);
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"退出失败，请重试"}' }));
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '退出失败' }).waitFor();
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('heading', { name: '欢迎回来' }).waitFor();
  await page.getByLabel('登录账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '账号或密码不正确' }).waitFor();
  await page.getByLabel('密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click(); await ready();
  assert.equal((await api('/projects/' + project.id)).title, project.title);
  check('explicit logout reports failures; new password restores the same workspace and poster');
  await page.setViewportSize({ width:390,height:844 });
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByLabel('昵称', { exact: true }).fill('手机修改的昵称');
  await page.getByRole('button', { name: '保存个人资料', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '个人资料已保存' }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('登录账号', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click(); await ready();
  assert.equal((await api('/auth/me')).user.name, '手机修改的昵称');
  check('mobile account entry, profile save, logout and login are usable');
  // Legacy email accounts use the same visible login field.
  const legacyEmail = 'legacy-' + randomUUID() + '@example.test';
  await api('/auth/register', { email: legacyEmail, password, name: '已有邮箱账号' }, 'POST', other);
  await page.getByRole('button', { name: '账户设置', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('登录账号', { exact: true }).fill(legacyEmail);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入创作空间', exact: true }).click(); await ready();
  assert.equal((await api('/auth/me')).user.email, legacyEmail);
  check('existing email accounts log in through the conventional account field');
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  await writeFile(new URL('failure-dom.txt', output), await page.content()).catch(() => {});
  throw error;
} finally {
  await writeFile(new URL('evidence.json', output), JSON.stringify({ base, data: 'isolated services, synthetic accounts; no email delivery', checks, errors }, null, 2));
  await browser.close();
}
