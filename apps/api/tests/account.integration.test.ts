import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { migrate } from '../../../db/migrate.js';
import { pool } from '../../../packages/server-infra/src/db.js';
import { stopQueue } from '../../../packages/server-infra/src/queue.js';

await migrate();
const app = await buildApp({ logger: false });
const secret = 'ordinary-account-password';
let actorIndex = 0;
const cookieOf = (r: any) => String(r.headers['set-cookie']).split(';')[0];
const call = (method: any, url: string, payload?: any, cookie = '', headers = {}) => app.inject({ method, url: '/api/auth' + url, payload, remoteAddress: '127.0.0.11', headers: { cookie, ...headers } });
async function actor() {
  const username = 'u_' + randomUUID().replaceAll('-', '').slice(0, 24);
  const response = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: '10.1.0.' + ++actorIndex, payload: { username, password: secret, name: '创作者' } });
  assert.equal(response.statusCode, 201, response.body);
  return { username, cookie: cookieOf(response), ...response.json() };
}
test.after(async () => { await app.close(); await stopQueue(); await pool.end(); });

test('username registration needs no email, normalizes case and persists only password/session hashes', async () => {
  const account = 'Creator_' + randomUUID().slice(0, 8);
  const registered = await call('POST', '/register', { username: '  ' + account + '  ', password: secret });
  assert.equal(registered.statusCode, 201, registered.body);
  assert.equal(registered.json().user.username, account.toLowerCase()); assert.equal(registered.json().user.email, null);
  assert.match(String(registered.headers['set-cookie']), /HttpOnly/); assert.match(String(registered.headers['set-cookie']), /SameSite=Lax/);
  const stored = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [registered.json().user.id])).rows[0];
  assert.notEqual(stored.password_hash, secret); assert.ok(!JSON.stringify(registered.json()).includes(stored.password_hash));
  const login = await call('POST', '/login', { account: account.toUpperCase(), password: secret });
  assert.equal(login.statusCode, 200);
  const me = await call('GET', '/me', undefined, cookieOf(login));
  assert.equal(me.json().workspace.id, registered.json().workspace.id);
  const sessions = (await pool.query('SELECT token_hash FROM sessions WHERE user_id=$1', [me.json().user.id])).rows;
  assert.ok(sessions.every(s => s.token_hash.length === 64 && !cookieOf(login).includes(s.token_hash)));
});
test('legacy email identifiers and existing sessions remain usable', async () => {
  const email = 'legacy-' + randomUUID() + '@example.test';
  const registered = await call('POST', '/register', { email, password: secret, name: '旧账户' });
  assert.equal(registered.statusCode, 201); assert.equal(registered.json().user.username, null);
  assert.equal((await call('GET', '/me', undefined, cookieOf(registered))).statusCode, 200);
  const login = await call('POST', '/login', { account: email.toUpperCase(), password: secret });
  assert.equal(login.statusCode, 200); assert.equal(login.json().workspace.id, registered.json().workspace.id);
  assert.equal((await call('POST', '/login', { email, password: secret })).statusCode, 200);
});
test('invalid/duplicate usernames and unknown credentials are rejected without orphan workspaces', async () => {
  const a = await actor();
  assert.equal((await call('POST', '/register', { username: a.username.toUpperCase(), password: secret })).statusCode, 409);
  for (const username of ['ab', 'a@b.com', '1creator', '中文账号', 'a'.repeat(33)]) {
    assert.equal((await call('POST', '/register', { username, password: secret })).statusCode, 400);
  }
  assert.equal((await pool.query('SELECT count(*)::int n FROM users WHERE username=$1', [a.username])).rows[0].n, 1);
  const wrong = await call('POST', '/login', { account: a.username, password: 'wrong-password' });
  const absent = await call('POST', '/login', { account: 'nobody_' + randomUUID(), password: 'wrong-password' });
  assert.equal(wrong.statusCode, 401); assert.deepEqual(wrong.json(), absent.json());
});
test('profile changes persist across sessions and cannot select another account', async () => {
  const a = await actor(), b = await actor();
  const second = await call('POST', '/login', { account: a.username, password: secret });
  const updated = await call('PATCH', '/profile', { name: '  新昵称  ', workspaceName: '  海报工坊  ' }, a.cookie);
  assert.equal(updated.statusCode, 200, updated.body);
  const me = (await call('GET', '/me', undefined, cookieOf(second))).json();
  assert.equal(me.user.name, '新昵称'); assert.equal(me.workspace.name, '海报工坊');
  assert.equal((await call('PATCH', '/profile', { name: '越权', workspaceName: '越权', userId: b.user.id }, a.cookie)).statusCode, 400);
  assert.equal((await call('GET', '/me', undefined, b.cookie)).json().user.name, '创作者');
  assert.equal((await call('PATCH', '/profile', { name: '拒绝', workspaceName: '拒绝' }, a.cookie, { origin: 'https://untrusted.example' })).statusCode, 403);
});
test('wrong current password preserves session; valid change rotates cookie and revokes all old sessions', async () => {
  const a = await actor();
  const other = await call('POST', '/login', { account: a.username, password: secret });
  const wrong = await call('POST', '/password', { currentPassword: 'wrong-password', newPassword: 'a-new-account-password' }, a.cookie);
  assert.equal(wrong.statusCode, 400); assert.equal(wrong.json().error, 'INVALID_CURRENT_PASSWORD');
  assert.equal((await call('GET', '/me', undefined, a.cookie)).statusCode, 200);
  const changed = await call('POST', '/password', { currentPassword: secret, newPassword: 'a-new-account-password' }, a.cookie);
  assert.equal(changed.statusCode, 200, changed.body); assert.notEqual(cookieOf(changed), a.cookie);
  for (const cookie of [a.cookie, cookieOf(other)]) assert.equal((await call('GET', '/me', undefined, cookie)).statusCode, 401);
  assert.equal((await call('GET', '/me', undefined, cookieOf(changed))).statusCode, 200);
  assert.equal((await call('POST', '/login', { account: a.username, password: secret })).statusCode, 401);
  assert.equal((await call('POST', '/login', { account: a.username, password: 'a-new-account-password' })).statusCode, 200);
});
test('concurrent password changes cannot reuse a revoked session or leave multiple valid credentials', async () => {
  const a = await actor();
  const attempts = await Promise.all(['concurrent-password-one','concurrent-password-two'].map(newPassword => call('POST', '/password', { currentPassword: secret, newPassword }, a.cookie)));
  assert.deepEqual(attempts.map(r => r.statusCode).sort(), [200, 401]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1', [a.user.id])).rows[0].n, 1);
  const winner = attempts.find(r => r.statusCode === 200)!;
  assert.equal((await call('GET', '/me', undefined, cookieOf(winner))).statusCode, 200);
});
test('device revocation retains current session; logout and expiry reject further changes', async () => {
  const a = await actor(), b = await actor();
  const other = await call('POST', '/login', { account: a.username, password: secret });
  const revoked = await call('POST', '/sessions/revoke-others', undefined, a.cookie);
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.json().revoked, 1);
  assert.equal((await call('GET', '/me', undefined, cookieOf(other))).statusCode, 401);
  assert.equal((await call('GET', '/me', undefined, b.cookie)).statusCode, 200);
  await call('POST', '/logout', undefined, a.cookie);
  assert.equal((await call('PATCH', '/profile', { name: '过期', workspaceName: '过期' }, a.cookie)).statusCode, 401);
  const hash = createHash('sha256').update(b.cookie.split('=')[1]).digest('hex');
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [hash]);
  assert.equal((await call('POST', '/sessions/revoke-others', undefined, b.cookie)).statusCode, 401);
});
test('password changes retain real per-user attempt limits', async () => {
  const a = await actor();
  for (let n = 0; n < 10; n++) assert.equal((await call('POST', '/password', { currentPassword: 'bad-password', newPassword: 'a-new-account-password' }, a.cookie)).statusCode, 400);
  assert.equal((await call('POST', '/password', { currentPassword: secret, newPassword: 'a-new-account-password' }, a.cookie)).statusCode, 429);
});
