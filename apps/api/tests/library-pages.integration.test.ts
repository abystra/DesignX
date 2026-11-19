import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/server.js';
import { migrate } from '../../../db/migrate.js';
import { pool, tenantTransaction } from '../../../packages/server-infra/src/db.js';
import { stopQueue } from '../../../packages/server-infra/src/queue.js';

await migrate();
const app = await buildApp({ logger: false });
const actors: { cookie: string, workspaceId: string }[] = [];
const folderId = randomUUID(), otherFolderId = randomUUID();
const projectId = (n: number) => `page-project-${String(n).padStart(4, '0')}`;
const assetId = (n: number) => `page-asset-${String(n).padStart(4, '0')}`;
async function get(url: string, actor = 0) {
  return app.inject({ method: 'GET', url, headers: { cookie: actors[actor].cookie } });
}
async function page(url: string, actor = 0) {
  const response = await get(url, actor); assert.equal(response.statusCode, 200, response.body); return response.json();
}
test.before(async () => {
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: `pages-${randomUUID()}@example.test`, password: 'library-regression-password' } });
    assert.equal(response.statusCode, 201, response.body);
    actors.push({ cookie: String(response.headers['set-cookie']).split(';')[0], workspaceId: response.json().workspace.id });
  }
  await tenantTransaction(actors[0].workspaceId, async tx => {
    await tx.query("INSERT INTO folders(id,workspace_id,name) VALUES($1,$3,'远期归档'),($2,$3,'其他')", [folderId, otherFolderId, actors[0].workspaceId]);
    await tx.query(`INSERT INTO projects(id,workspace_id,title,folder_id,workspace_mode,creation_note,updated_at,last_opened_at,deleted_at)
      SELECT 'page-project-'||lpad(n::text,4,'0'),$1,
        CASE WHEN n=0 THEN '深处海报 100%_\\收藏' ELSE '海报 '||lpad(n::text,4,'0') END,
        CASE WHEN n<10 THEN $2 ELSE $3 END,'editor',repeat('不要返回长需求',1000),
        '2020-01-01'::timestamptz+(n/5)*interval '1 microsecond',
        CASE WHEN n<10 THEN '2025-01-01'::timestamptz+n*interval '1 microsecond' ELSE NULL END,
        CASE WHEN n>=1105 THEN now() ELSE NULL END
      FROM generate_series(0,1109) n`, [actors[0].workspaceId, folderId, otherFolderId]);
    await tx.query(`INSERT INTO documents(id,workspace_id,project_id,kind,title,content)
      SELECT 'page-document-'||p.id,p.workspace_id,p.id,'artboard',p.title,
        '{"width":600,"height":800,"background":"#ffffff","nodes":[]}'::jsonb
      FROM projects p`);
    await tx.query("UPDATE projects SET primary_artboard_id='page-document-'||id");
    await tx.query(`INSERT INTO assets(id,workspace_id,title,mime,bytes,object_key,created_at)
      SELECT 'page-asset-'||lpad(n::text,4,'0'),$1,CASE WHEN n=0 THEN '深处素材 100%_\\收藏' ELSE '素材 '||lpad(n::text,4,'0') END,
      'image/png',12,'fixture/'||n,'2020-01-01'::timestamptz+(n/5)*interval '1 microsecond' FROM generate_series(0,1104) n`, [actors[0].workspaceId]);
    // Only two assets are ready; immutable metadata is enough for listing tests.
    for (const n of [0, 1104]) {
      const versionId = randomUUID();
      await tx.query("INSERT INTO asset_versions(id,workspace_id,asset_id,object_key,bucket,bytes,sha256,mime) VALUES($1,$2,$3,$4,'fixture',12,$5,'image/png')", [versionId, actors[0].workspaceId, assetId(n), `fixture/${n}`, 'a'.repeat(64)]);
      await tx.query("UPDATE assets SET status='ready',current_version_id=$2 WHERE id=$1", [assetId(n), versionId]);
    }
    await tx.query("INSERT INTO preferences(workspace_id,key,value) VALUES($1,'asset-favorites',$2)", [actors[0].workspaceId, JSON.stringify([assetId(0), 'stock-coffee'])]);
  });
  await tenantTransaction(actors[1].workspaceId, tx => tx.query("INSERT INTO projects(id,workspace_id,title) VALUES($1,$2,'深处海报 100%_\\收藏')", [randomUUID(), actors[1].workspaceId]));
});
test.after(async () => { await app.close(); await stopQueue(); await pool.end(); });

test('bounded project metadata pages traverse more than 1000 rows without losing tied microsecond timestamps', async () => {
  const first = await get('/api/projects/page');
  assert.equal(first.statusCode, 200); assert.equal(first.json().items.length, 24); assert.equal(first.json().total, 1105);
  assert.ok(Buffer.byteLength(first.body) < 24000, 'List response must remain bounded metadata');
  assert.ok(first.json().items.every((p: any) => !('design' in p) && !('brief' in p) && p.workspaceMode === 'editor'));
  const seen = new Set<string>(); let cursor: string | null = null;
  do {
    const result = await page('/api/projects/page?limit=100' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
    for (const item of result.items) { assert.ok(!seen.has(item.id), `Duplicate ${item.id}`); seen.add(item.id); }
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 1105); assert.ok(seen.has(projectId(0)));
});
test('server search is literal, tenant scoped, and independent of the first thousand records', async () => {
  for (const q of ['深处海报', '100%_', '\\收藏']) {
    const result = await page('/api/projects/page?q=' + encodeURIComponent(q));
    assert.equal(result.total, 1); assert.equal(result.items[0].id, projectId(0));
  }
  assert.equal((await page('/api/projects/page?q=' + encodeURIComponent("' OR 1=1 --"))).total, 0);
  assert.equal((await page('/api/projects/page', 1)).total, 1);
  const found = await page('/api/projects/page?q=深处海报');
  const full = (await get(`/api/projects/${found.items[0].id}`)).json();
  assert.equal(full.design.width, 600);
  assert.equal((await get(`/api/projects/${found.items[0].id}`, 1)).statusCode, 404);
});
test('filters, folder counts, recent name sorting and trash are computed across the complete tenant library', async () => {
  assert.equal((await page(`/api/projects/page?folderId=${folderId}`)).total, 10);
  const folders = await page('/api/folders');
  assert.equal(folders.find((f: any) => f.id === otherFolderId).projectCount, 1095);
  assert.equal((await page('/api/projects/page?trash=1')).total, 5);
  const recent = await page('/api/projects/page?recent=1&sort=name');
  assert.equal(recent.total, 10);
  assert.ok(recent.items.every((p: any) => p.lastOpenedAt));
  const nameFirst = await page('/api/projects/page?sort=name&limit=6');
  const nameSecond = await page('/api/projects/page?sort=name&limit=6&cursor=' + encodeURIComponent(nameFirst.nextCursor));
  assert.equal(new Set([...nameFirst.items, ...nameSecond.items].map((p: any) => p.id)).size, 12);
});
test('cursor is filter/tenant bound and new leading records do not shift the next page', async () => {
  const first = await page('/api/projects/page?limit=12');
  for (const suffix of ['&q=changed', '&sort=name', '&trash=1']) assert.equal((await get('/api/projects/page?limit=12&cursor=' + encodeURIComponent(first.nextCursor) + suffix)).statusCode, 400);
  assert.equal((await get('/api/projects/page?limit=12&cursor=' + encodeURIComponent(first.nextCursor), 1)).statusCode, 400);
  await tenantTransaction(actors[0].workspaceId, tx => tx.query("INSERT INTO projects(id,workspace_id,title) VALUES($1,$2,'新到的作品')", [randomUUID(), actors[0].workspaceId]));
  const second = await page('/api/projects/page?limit=12&cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(second.items.length, 12); assert.equal(new Set([...first.items, ...second.items].map((p: any) => p.id)).size, 24);
});
test('assets paginate beyond 1000 and search/favorites/ready pickers include the oldest versioned material', async () => {
  const seen = new Set<string>(); let cursor: string | null = null;
  do {
    const result = await page('/api/assets/page?limit=100' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
    assert.equal(result.total, 1105);
    for (const item of result.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
    cursor = result.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 1105); assert.ok(seen.has(assetId(0)));
  const oldest = await page('/api/assets/page?q=深处素材&status=ready');
  assert.equal(oldest.total, 1); assert.ok(oldest.items[0].versionId);
  assert.equal((await page('/api/assets/page?favorites=1')).items[0].id, assetId(0));
  assert.equal((await page('/api/assets/page?status=ready')).total, 2);
  assert.equal((await page('/api/assets/page', 1)).total, 0);
  assert.equal((await get('/api/assets/' + assetId(0), 1)).statusCode, 404);
  assert.equal((await page('/api/assets/' + assetId(0))).versionId, oldest.items[0].versionId);
});
test('malformed page inputs return actionable validation errors', async () => {
  for (const query of ['limit=0', 'limit=101', 'limit=nope', 'cursor=broken', 'q=' + 'a'.repeat(201), 'folderId=bad']) {
    assert.equal((await get('/api/projects/page?' + query)).statusCode, 400, query);
  }
  assert.equal((await app.inject('/api/projects/page')).statusCode, 401);
  assert.equal((await app.inject('/api/assets/page')).statusCode, 401);
});
