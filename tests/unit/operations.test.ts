import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { backupKey, retainedBackups, restorePrefix } from '../../scripts/backup-policy.js';
import { spawnGroup, stopGroup, requireFreePorts } from '../../scripts/cloud/process-group.mjs';
import { parseBucketAliases, resolveObjectLocation } from '../../packages/server-infra/src/storage-locations.js';

test('retention keeps seven daily points and four weekly points, never unrelated paths', () => {
 const runs = Array.from({length:50}, (_, i) => {
  const date = new Date(Date.UTC(2026,10,18-i)).toISOString().slice(0,10).replaceAll('-','');
  return date+'T043000Z-12345678';
 });
 const retained = retainedBackups([...runs, runs[0], '../not-a-backup', '20261118T023000Z-12345678']);
 assert.ok(runs.slice(0,7).every(r => retained.has(r)));
 assert.equal(retained.size,9); assert.ok(!retained.has(runs[49]));
 assert.throws(() => backupKey('../../source')); assert.throws(() => restorePrefix('_designx_restore/../../'));
 assert.throws(() => restorePrefix('designx/'));
});
test('restore aliases isolate both current and historical buckets with one-hop resolution', () => {
 const aliases = parseBucketAliases(JSON.stringify({current:{bucket:'current',prefix:'_designx_restore/id/current/'},old:{bucket:'current',prefix:'_designx_restore/id/old/'}}));
 assert.equal(resolveObjectLocation('current','asset',aliases).key,'_designx_restore/id/current/asset');
 assert.equal(resolveObjectLocation('old','asset',aliases).key,'_designx_restore/id/old/asset');
});
test('duplicate development start refuses occupied port; owned group shutdown releases grandchildren only', async () => {
 const foreign = createServer().listen(0,'127.0.0.1'); await once(foreign,'listening');
 const foreignPort = (foreign.address() as any).port;
 let child:any;
 try {
  await assert.rejects(requireFreePorts([foreignPort]),/already occupied/);
  const code = "require('node:child_process').spawn(process.execPath,['-e',\"const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>console.log(s.address().port))\"],{stdio:'inherit'});setInterval(()=>{},1000)";
  child=spawnGroup(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe']});
  const port = Number(String((await once(child.stdout,'data'))[0]).trim());
  await assert.rejects(requireFreePorts([port]),/already occupied/);
  await stopGroup(child); await delay(100); await requireFreePorts([port]);
  assert.ok(foreign.listening); await assert.rejects(requireFreePorts([foreignPort]),/already occupied/);
 } finally { await stopGroup(child); await new Promise<void>(resolve=>foreign.close(()=>resolve())); }
});
