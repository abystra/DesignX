import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildApp} from '../src/server.js';import {migrate} from '../../../db/migrate.js';import {pool,tenantTransaction} from '../../../packages/server-infra/src/db.js';import {stopQueue} from '../../../packages/server-infra/src/queue.js';
import {templates} from '../../../src/data/templates.js';
await migrate();const app=await buildApp({logger:false});let cookie='',workspace='',other='';
const request=(method:string,url:string,body?:any,headers:any={})=>app.inject({method:method as any,url:'/api'+url,payload:body,headers:{cookie,...headers}});
test.before(async()=>{for(let n=0;n<2;n++){const r=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'template_'+randomUUID().slice(0,8),password:'template-test-password'}});assert.equal(r.statusCode,201);if(!n){cookie=String(r.headers['set-cookie']).split(';')[0];workspace=r.json().workspace.id;}else other=String(r.headers['set-cookie']).split(';')[0];}});
test.after(async()=>{await app.close();await stopQueue();await pool.end();});
test('list, previewed version and created project freeze the same document and provenance; retry creates once',async()=>{
 const list=(await request('GET','/templates')).json();assert.equal(list.length,8);
 for(const template of list){
  const body={title:template.title,workspaceMode:'editor',templateId:template.id,templateVersion:template.version,templateDigest:template.digest},headers={'idempotency-key':randomUUID()};
  const first=await request('POST','/projects',body,headers);assert.equal(first.statusCode,201,first.body);const created=first.json();assert.deepEqual(created.design,template.design);assert.equal(created.creationSource.version,template.version);assert.deepEqual(created.creationSource.source,template.source);
  const replay=(await request('POST','/projects',body,headers)).json();assert.equal(created.id,replay.id);assert.equal((await request('GET','/projects/'+created.id,undefined,{cookie:other})).statusCode,404);
  await request('PATCH','/projects/'+created.id,{baseRevision:created.revision,design:{...created.design,background:'#112233'}});
  const saved=(await request('GET','/projects/'+created.id)).json();assert.deepEqual(saved.creationSource,created.creationSource);assert.notEqual(template.design.background,saved.design.background);
 }
});
test('stale versions, digest mismatches and unavailable templates fail before creating a project or Studio artboard',async()=>{
 const before=(await request('GET','/projects/page')).json().total;
 for(const body of [{templateId:'t1',templateVersion:1},{templateId:'t1',templateVersion:2,templateDigest:'changed'},{templateId:'withdrawn-template'}])assert.equal((await request('POST','/projects',body)).statusCode,409);
 assert.equal((await request('GET','/projects/page')).json().total,before);
 const project=(await request('POST','/projects',{title:'旧 Studio',workspaceMode:'studio'})).json();
 const body={templateId:'t2',templateVersion:2,templateDigest:templates.find(t=>t.id==='t2')!.digest};
 const created=await request('POST',`/projects/${project.id}/artboards`,body);assert.equal(created.statusCode,200,created.body);assert.equal(created.json().creationSource.kind,'template');assert.deepEqual(created.json().design,templates.find(t=>t.id==='t2')!.design);
 assert.equal((await request('POST',`/projects/${project.id}/artboards`,{...body,templateVersion:1})).statusCode,409);
});
test('creation class comes from server facts, old names and type strings cannot claim AI provenance',async()=>{
 const manual=(await request('POST','/projects',{title:'AI生成的海报',type:'AI生成',creationSource:{kind:'ai'},aiSource:{kind:'agent'}})).json();assert.equal(manual.creationSource.kind,'manual');assert.equal(manual.aiSource,null);
 const stock=(await request('POST','/projects',{title:'素材',material:{kind:'stock',id:'stock-coffee'}})).json();assert.equal(stock.creationSource.kind,'material');
 const legacy=randomUUID();await tenantTransaction(workspace,tx=>tx.query("INSERT INTO projects(id,workspace_id,title,type) VALUES($1,$2,'AI 旧标题','AI生成')",[legacy,workspace]));
 assert.equal((await request('GET','/projects/'+legacy)).json().creationSource.kind,'unknown');assert.equal((await request('GET','/projects/page?type=ai')).json().total,0);
 const all=(await request('GET','/projects/page?type=design')).json();assert.ok(all.items.some((p:any)=>p.id===manual.id));
});
