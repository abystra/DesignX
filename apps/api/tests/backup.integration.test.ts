import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from '../../../packages/server-infra/src/config.js';
import { storage, putObject, getObject, deleteObject } from '../../../packages/server-infra/src/storage.js';
import { captureObjects, publishBackup, downloadBackup, restoreObjects, pruneBackups } from '../../../scripts/backup-objects.mjs';
import { migrate } from '../../../db/migrate.js';
import { pool } from '../../../packages/server-infra/src/db.js';
const execute=promisify(execFile), directories:string[]=[];
async function directory(){const path=await mkdtemp(join(tmpdir(),'designx-backup-test-'));directories.push(path);return path;}
test.after(async()=>{for(const path of directories)await rm(path,{recursive:true,force:true});storage.destroy();await pool.end();});
test('snapshot catalog has one-line JSONB framing while its exported transaction stays open',async()=>{
 await migrate();const client=await pool.connect();
 try{
  const sql=(await readFile('scripts/cloud/backup-catalog.sql','utf8')).replaceAll(":'default_bucket'","'"+config.s3Bucket+"'");
  const results:any=await client.query({text:sql,types:{getTypeParser:()=>((text:string)=>text)}});
  const result=results.at(-1),raw=Object.values(result.rows[0])[0] as string;
  assert.equal(result.fields[0].dataTypeID,3802,'JSONB output avoids json_agg composite record newlines');
  assert.equal(raw.split('\n').length,1);assert.ok(JSON.parse(raw).snapshot);
 }finally{await client.query('ROLLBACK');client.release();}
});
test('object backup survives source loss, remote download restores bytes only into empty namespaces',async()=>{
 const path=await directory(), key='backup-test/'+randomUUID(), bytes=Buffer.from('immutable recovery fixture');
 await putObject(key,bytes,'image/png');
 await writeFile(join(path,'catalog.json'),JSON.stringify({version:1,runId:'20261118T043000Z-12345678',createdAt:new Date().toISOString(),database:'isolated',counts:{projects:1},objects:[{bucket:config.s3Bucket,key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
 await writeFile(join(path,'database.dump'),'dump checksum fixture');
 assert.equal((await captureObjects(path)).objectCount,1);
 await execute('tar',['-czf',join(path,'snapshot.tar.gz'),'-C',path,'catalog.json','manifest.json','database.dump','blobs']);
 const published=await publishBackup(path);assert.equal(published.offhostVerified,true);
 await deleteObject(key); // Only this isolated test's original; recovery must use archived bytes.
 const target=await directory();await downloadBackup(published.runId,target);
 await execute('tar',['-xzf',join(target,'snapshot.tar.gz'),'-C',target]);
 const prefix='_designx_restore/'+randomUUID()+'/',restored=await restoreObjects(target,prefix);
 assert.equal(restored.objects,1);assert.ok(restored.aliases[config.s3StagingBucket]);
 const remote=await storage.send(new GetObjectCommand({Bucket:config.s3Bucket,Key:prefix+config.s3Bucket+'/'+key}));
 assert.deepEqual(Buffer.from(await remote.Body!.transformToByteArray()),bytes);
 await assert.rejects(getObject(key),/NoSuchKey|specified key does not exist|not found/i);
 await assert.rejects(restoreObjects(target,prefix),/must be empty/);
 const bad=await directory();await execute('tar',['-xzf',join(target,'snapshot.tar.gz'),'-C',bad]);
 const manifest=JSON.parse(await readFile(join(bad,'manifest.json'),'utf8'));
 await writeFile(join(bad,manifest.objects[0].blob),'corrupt');
 const empty='_designx_restore/'+randomUUID()+'/';
 await assert.rejects(restoreObjects(bad,empty),/checksum mismatch/);
 assert.equal((await storage.send(new ListObjectsV2Command({Bucket:config.s3Bucket,Prefix:empty}))).Contents?.length||0,0);
 await assert.rejects(restoreObjects(target,'/'),/isolated/);
});
test('retention refuses unregistered backup-looking object and leaves original assets intact',async()=>{
 const Key='_designx_backups/v1/20000101T043000Z-12345678/snapshot.tar.gz';
 await storage.send(new PutObjectCommand({Bucket:config.s3Bucket,Key,Body:Buffer.from('unregistered')}));
 await assert.rejects(pruneBackups(),/Unregistered/);
 const response=await storage.send(new GetObjectCommand({Bucket:config.s3Bucket,Key}));assert.equal(await response.Body!.transformToString(),'unregistered');
});
