// No source writes. Restores can only publish into a fresh recovery namespace.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { storage, getObject, stagingBucket } from '../packages/server-infra/src/storage.ts';
import { config } from '../packages/server-infra/src/config.ts';
import { backupKey, backupPrefix, backupRunPattern, retainedBackups, restorePrefix } from './backup-policy.ts';
const sha = data => createHash('sha256').update(data).digest('hex');
async function digest(stream) { const hash = createHash('sha256'); for await (const data of stream) hash.update(data); return hash.digest('hex'); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function captureObjects(directory) {
  const catalog = await json(join(directory, 'catalog.json'));
  if (catalog.version !== 1 || !Array.isArray(catalog.objects)) throw new Error('Invalid backup catalog');
  await mkdir(join(directory, 'blobs'), { mode: 0o700 });
  const objects = [];
  for (const item of catalog.objects) {
    if (typeof item.bucket !== 'string' || typeof item.key !== 'string') throw new Error('Invalid object reference');
    const object = await getObject(item.key, { bucket: item.bucket, maxBytes: 128 * 1024 * 1024, signal: AbortSignal.timeout(120000) });
    const hash = sha(object.bytes);
    if (item.sha256 && hash !== item.sha256 || item.bytes !== null && Number(item.bytes) !== object.bytes.length) throw new Error('Source object checksum or length mismatch');
    const blob = 'blobs/' + hash;
    try { await writeFile(join(directory, blob), object.bytes, { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (await digest(createReadStream(join(directory, blob))) !== hash) throw new Error('Existing backup blob differs'); }
    objects.push({ bucket: item.bucket, key: item.key, sha256: hash, bytes: object.bytes.length, contentType: object.contentType, blob });
  }
  const dump = join(directory, 'database.dump');
  const manifest = { version: 1, runId: catalog.runId, createdAt: catalog.createdAt, database: catalog.database, counts: catalog.counts, release: catalog.release, buckets: [...new Set([config.s3Bucket, stagingBucket(), ...objects.map(o => o.bucket)])], databaseDump: { bytes: (await stat(dump)).size, sha256: await digest(createReadStream(dump)) }, objects };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  return { objectCount: objects.length, objectBytes: objects.reduce((n, o) => n + o.bytes, 0) };
}
export async function publishBackup(directory) {
  const manifest = await json(join(directory, 'manifest.json'));
  const Key = backupKey(manifest.runId), file = join(directory, 'snapshot.tar.gz');
  const bytes = (await stat(file)).size, hash = await digest(createReadStream(file));
  await storage.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key, Body: createReadStream(file), ContentLength: bytes, ContentType: 'application/gzip', IfNoneMatch: '*', Metadata: { purpose: 'designx-backup-v1', sha256: hash } }));
  const remote = await storage.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key }));
  if (Number(remote.ContentLength) !== bytes || await digest(remote.Body) !== hash) throw new Error('Remote backup readback failed');
  return { runId: manifest.runId, archiveBytes: bytes, sha256: hash, backupBucket: config.s3Bucket, backupKey: Key, offhostVerified: true };
}
export async function pruneBackups() {
  const entries = [];
  let cursor;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: config.s3Bucket, Prefix: backupPrefix, ContinuationToken: cursor }));
    for (const row of page.Contents || []) {
      const run = row.Key?.slice(backupPrefix.length).split('/')[0];
      if (run && backupRunPattern.test(run) && row.Key === backupKey(run)) {
        const metadata = await storage.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: row.Key }));
        if (metadata.Metadata?.purpose !== 'designx-backup-v1') throw new Error('Unregistered object at backup retention target');
        entries.push(run);
      }
    }
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (cursor);
  const retained = retainedBackups(entries), removed = [];
  for (const run of entries) if (!retained.has(run)) {
    const Key = backupKey(run);
    await storage.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key })); removed.push(run);
  }
  return { retained: [...retained], removed };
}
export async function restoreObjects(directory, prefix) {
  restorePrefix(prefix);
  const manifest = await json(join(directory, 'manifest.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.objects)) throw new Error('Invalid restore manifest');
  const dump = join(directory, 'database.dump');
  if (await digest(createReadStream(dump)) !== manifest.databaseDump.sha256 || (await stat(dump)).size !== manifest.databaseDump.bytes) throw new Error('Database dump checksum mismatch');
  const existing = await storage.send(new ListObjectsV2Command({ Bucket: config.s3Bucket, Prefix: prefix, MaxKeys: 1 }));
  if (existing.Contents?.length) throw new Error('Restore target must be empty');
  /** @type {Record<string, {bucket: string, prefix: string}>} */
  const aliases = {};
  const targets = new Set();
  for (const bucket of new Set([config.s3Bucket, stagingBucket(), ...(manifest.buckets || []), ...manifest.objects.map(o => o.bucket)])) {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Unsafe restore bucket');
    aliases[bucket] = { bucket: config.s3Bucket, prefix: prefix + bucket + '/' };
  }
  // Check the whole local package before any storage mutation.
  for (const item of manifest.objects) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || item.blob !== 'blobs/' + item.sha256 || typeof item.key !== 'string' || item.key.startsWith('/') || /[\\\p{Cc}]/u.test(item.key) || item.key.split('/').some(x => x === '..' || x === '.') || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(item.bucket)) throw new Error('Unsafe restore entry');
    const file = join(directory, item.blob);
    if ((await stat(file)).size !== item.bytes || await digest(createReadStream(file)) !== item.sha256) throw new Error('Backup blob checksum mismatch');
    const Key = prefix + item.bucket + '/' + item.key;
    if (targets.has(Key)) throw new Error('Duplicate restore address'); targets.add(Key);
  }
  for (const item of manifest.objects) {
    const Key = prefix + item.bucket + '/' + item.key;
    await storage.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key, Body: createReadStream(join(directory, item.blob)), ContentLength: item.bytes, ContentType: item.contentType, IfNoneMatch: '*', Metadata: { purpose: 'designx-recovery-drill', sha256: item.sha256 } }));
    const remote = await storage.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key }));
    if (await digest(remote.Body) !== item.sha256) throw new Error('Restored bytes differ');
    aliases[item.bucket] = { bucket: config.s3Bucket, prefix: prefix + item.bucket + '/' };
  }
  const result = { runId: manifest.runId, prefix, objects: targets.size, aliases };
  await writeFile(join(directory, 'restore-receipt.json'), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
  return result;
}
export async function downloadBackup(run, directory) {
  const Key = backupKey(run);
  const result = await storage.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key }));
  if (result.Metadata?.purpose !== 'designx-backup-v1' || !/^[a-f0-9]{64}$/.test(result.Metadata?.sha256 || '')) throw new Error('Unregistered remote backup');
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');
  const file = join(directory, 'snapshot.tar.gz');
  await pipeline(result.Body, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  if (await digest(createReadStream(file)) !== result.Metadata.sha256) throw new Error('Downloaded backup checksum mismatch');
  return { runId: run, verified: true, bytes: (await stat(file)).size };
}
export async function cleanRestore(directory, apply = false) {
  const receipt = await json(join(directory, 'drill.json'));
  const prefix = restorePrefix(receipt.prefix), keys = [];
  if (receipt.database !== 'designx_restore_' + prefix.split('/')[1].replaceAll('-', '')) throw new Error('Restore receipt scope mismatch');
  let cursor;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: config.s3Bucket, Prefix: prefix, ContinuationToken: cursor }));
    for (const item of page.Contents || []) { if (!item.Key?.startsWith(prefix)) throw new Error('Restore cleanup escaped namespace'); keys.push(item.Key); }
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (cursor);
  // A durable, exact inventory precedes deletion. Never inspect unrelated bucket keys.
  await writeFile(join(directory, 'cleanup-inventory.json'), JSON.stringify({ prefix, keys }, null, 2), { mode: 0o600 });
  if (apply) for (const Key of keys) await storage.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key }));
  return { prefix, objects: keys.length, applied: apply };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, path, argument] = process.argv.slice(2), directory = resolve(path || '.');
  try {
    let result;
    if (mode === 'capture') result = await captureObjects(directory);
    else if (mode === 'publish') result = await publishBackup(directory);
    else if (mode === 'prune') result = await pruneBackups();
    else if (mode === 'restore-objects') result = await restoreObjects(directory, argument);
    else if (mode === 'download') result = await downloadBackup(argument, directory);
    else if (mode === 'clean-restore') result = await cleanRestore(directory, argument === '--apply');
    else throw new Error('Choose capture, publish, prune, restore-objects, download or clean-restore');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({ stage: mode, error: error.name, message: error.$metadata ? 'Storage request failed: HTTP ' + error.$metadata.httpStatusCode : error.message })); process.exitCode = 1; }
  finally { storage.destroy(); }
}
