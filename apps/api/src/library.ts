import { normalizeBrand } from "../../../packages/server-domain/src/materials.js";
import {preferenceKeys,setKeys,readPreference,lockPreference,normalizePreference,storePreference,validateItems} from '../../../packages/server-domain/src/preferences.js';
import {idempotent} from '../../../packages/server-domain/src/idempotency.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTransaction } from '../../../packages/server-infra/src/db.js';
import { id,notFound,HttpError,emit } from '../../../packages/server-domain/src/common.js';
import { templates } from '../../../src/data/templates.js';
import { readFile } from 'node:fs/promises';
export async function libraryRoutes(app:FastifyInstance) {
 app.get('/api/templates',async()=>templates);
 app.get('/api/catalog',async()=>JSON.parse(await readFile(new URL('../../../src/data/catalog.json',import.meta.url),'utf8')));
 app.get('/api/folders',async(req:any)=>tenantTransaction(req.identity.workspace.id,async tx=>(await tx.query('SELECT f.id,f.name,f.color,(SELECT count(*)::int FROM projects p WHERE p.folder_id=f.id AND p.deleted_at IS NULL) AS "projectCount" FROM folders f ORDER BY f.created_at')).rows));
 app.post('/api/folders',async(req:any,reply)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  const body=z.object({name:z.string().trim().min(1).max(100),color:z.string().regex(/^#[0-9a-f]{6}$/i).default('#e6b49b')}).parse(req.body);
  const result=(await tx.query('INSERT INTO folders(id,workspace_id,name,color) VALUES($1,$2,$3,$4) RETURNING id,name,color',[id(),req.identity.workspace.id,body.name,body.color])).rows[0];reply.code(201);return result;
 }));
 app.patch('/api/folders/:id',async(req:any)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  const body=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);
  const row=(await tx.query('UPDATE folders SET name=$1 WHERE id=$2 RETURNING id,name,color',[body.name,req.params.id])).rows[0];if(!row)notFound();return row;
 }));
 app.delete('/api/folders/:id',async(req:any)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  if(!(await tx.query('DELETE FROM folders WHERE id=$1',[req.params.id])).rowCount)notFound();return {ok:true};
 }));
 app.get('/api/preferences/:key',async(req:any,reply)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  if(!preferenceKeys.has(req.params.key))notFound();
  const current=await readPreference(tx,req.params.key);
  if(req.params.key==='brand'&&current.value)current.value=await normalizeBrand(tx,current.value);
  reply.header('ETag','"'+current.revision+'"');
  return req.query?.meta==='1'?current:current.value;
 }));
 app.put('/api/preferences/:key',async(req:any,reply)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  const key=req.params.key,workspace=req.identity.workspace.id;if(!preferenceKeys.has(key))notFound();
  const condition=req.headers['if-match'];
  if(typeof condition!=='string'||!/^"\d+"$/.test(condition))throw new HttpError(428,'PREFERENCE_VERSION_REQUIRED','请刷新页面后重试，设置需要读取时的版本');
  const expected=Number(condition.slice(1,-1));
  await idempotent(tx,workspace,req.headers['idempotency-key'],{route:'preference.replace',key,expected,body:req.body},async()=>{
   await lockPreference(tx,workspace,key);const current=await readPreference(tx,key);
   if(current.revision!==expected)throw new HttpError(409,'PREFERENCE_CONFLICT','另一端已更新，本次输入已保留，请先查看最新内容',{current});
   const saved=await storePreference(tx,workspace,key,await normalizePreference(tx,key,req.body));return {revision:saved.revision};
  });
  const current=await readPreference(tx,key);reply.header('ETag','"'+current.revision+'"');return req.query?.meta==='1'?current:current.value;
 }));
 app.patch('/api/preferences/:key/items',async(req:any)=>tenantTransaction(req.identity.workspace.id,async tx=>{
  const key=req.params.key,workspace=req.identity.workspace.id;
  if(!setKeys.has(key)&&key!=='studio-skills'&&key!=='recent')notFound();
  if(!req.headers['idempotency-key'])throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED','请提供操作标识');
  const body=z.object({item:z.string().min(1).max(200),present:z.boolean().default(true)}).strict().parse(req.body);
  await idempotent(tx,workspace,req.headers['idempotency-key'],{route:'preference.item',key,body},async()=>{
   await lockPreference(tx,workspace,key);const current=await readPreference(tx,key);
   const list=Array.isArray(current.value)?current.value.filter((item:any)=>typeof item==='string'):[];
   if(body.present)await validateItems(tx,key,[body.item]);
   let next=[...new Set(list.filter((item:string)=>item!==body.item))];
   if(body.present){if(setKeys.has(key))next=list.includes(body.item)?[...new Set(list)]:[...next,body.item];else next.unshift(body.item);}
   if(!setKeys.has(key))next=next.slice(0,key==='studio-skills'?12:100);
   if(next.length>5000)throw new HttpError(400,'PREFERENCE_LIMIT','收藏数量已达上限');
   const saved=await storePreference(tx,workspace,key,next);return {revision:saved.revision};
  });
  return readPreference(tx,key); // A replay reports current state without repeating its old write.
 }));
}
