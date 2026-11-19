import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream} from 'node:fs';
import {stat,mkdir,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {config} from '../packages/server-infra/src/config.js';
import pg from 'pg';
const arg=(key:string)=>{const i=process.argv.indexOf(key);return i<0?undefined:process.argv[i+1];};
const mode=process.argv[2],file=arg('--file'),container=arg('--container'),database=arg('--database');
if(!['backup','restore'].includes(mode)||!file)throw new Error('Usage: database-backup.ts backup|restore --file PATH [--database EMPTY_DB] [--container LOCAL_PG_CONTAINER]');
const url=new URL(config.databaseUrl);if(database){if(!/^[a-z][a-z0-9_]{0,62}$/.test(database))throw new Error('Invalid database name');url.pathname='/'+database;}
if(mode==='restore'){
 if(!database||database===new URL(config.databaseUrl).pathname.slice(1))throw new Error('Restore requires a separate empty database');
 const client=new pg.Client({connectionString:url.toString(),password:decodeURIComponent(url.password)||process.env.PGPASSWORD});await client.connect();try{const tables=await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','S','f')");if(tables.rows[0].n)throw new Error('Refusing to restore over existing objects');}finally{await client.end();}
}
const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password)||process.env.PGPASSWORD,PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
const tool=mode==='backup'?'pg_dump':'pg_restore',args=mode==='backup'?['--format=custom','--no-owner']:['--no-owner','--exit-on-error','--single-transaction','--dbname',env.PGDATABASE];
const command=container?'docker':tool,argv=container?['exec','-i',container,tool,'-U',env.PGUSER,...args,...(mode==='backup'?['--dbname',env.PGDATABASE]:[])]:args;
await mkdir(dirname(resolve(file)),{recursive:true});
const child=spawn(command,argv,{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
const completed=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${tool} failed (${code}); inspect database connectivity and tool version`)));});
const temporary=file+'.partial-'+randomUUID();
try {
 await Promise.all([completed,(async()=>{
  if(mode==='backup'){child.stdin.end();await pipeline(child.stdout,createWriteStream(temporary,{mode:0o600,flags:'wx'}));}
  else{child.stdout.resume();await pipeline(createReadStream(file),child.stdin);}
 })()]);
 if(mode==='backup')await link(temporary,file); // Exclusive publication; never replace an existing backup.
 console.log(JSON.stringify({mode,database:env.PGDATABASE,file:resolve(file),bytes:(await stat(file)).size,status:'completed'}));
} finally { if(child.exitCode===null)child.kill('SIGTERM');if(mode==='backup')await unlink(temporary).catch(()=>{}); }
