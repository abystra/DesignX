import {z} from 'zod';
import type {Tx} from '../../server-infra/src/db.js';
import {HttpError,emit,notFound} from './common.js';
import {canonical} from './idempotency.js';
import {normalizeBrand,resolveMaterial} from './materials.js';
import {templates} from '../../../src/data/templates.js';
export const preferenceKeys=new Set(['favorites','template-favorites','asset-favorites','catalog-favorites','studio-skills','references','brand','ui','recent']);
export const setKeys=new Set(['favorites','template-favorites','asset-favorites','catalog-favorites']);
export async function readPreference(tx:Tx,key:string) {
 const row=(await tx.query('SELECT value,revision FROM preferences WHERE key=$1',[key])).rows[0];
 return {value:row?.value??null,revision:row?.revision??0};
}
export async function lockPreference(tx:Tx,workspace:string,key:string){await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[workspace+':preference:'+key]);}
export async function validateItems(tx:Tx,key:string,items:string[]) {
 if(key==='template-favorites'&&items.some(item=>!templates.some(t=>t.id===item)))throw new HttpError(400,'INVALID_TEMPLATE','模板不存在');
 if(key==='favorites'){
  const rows=await tx.query('SELECT id FROM projects WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[items]);if(rows.rowCount!==new Set(items).size)notFound();
 }
 if(key==='asset-favorites'){
  const refs=(await readPreference(tx,'references')).value;
  const builtins=new Set(['stock-coffee','stock-skincare','stock-interior','stock-fashion',...(Array.isArray(refs)?refs.map(r=>r.id):[])]);
  const ids=[...new Set(items.filter(item=>!builtins.has(item)))];
  const rows=await tx.query("SELECT id FROM assets WHERE id=ANY($1::text[]) AND deleted_at IS NULL AND status='ready'",[ids]);if(rows.rowCount!==ids.length)notFound();
 }
}
export async function normalizePreference(tx:Tx,key:string,input:any) {
 let value=input;
 if(setKeys.has(key)){value=[...new Set(z.array(z.string().min(1).max(200)).max(5000).parse(value))];await validateItems(tx,key,value);}
 if(key==='studio-skills'||key==='recent')value=[...new Set(z.array(z.string().min(1).max(200)).max(5000).parse(value))].slice(0,key==='studio-skills'?12:100);
 if(key==='references'){
  value=z.array(z.object({id:z.string().min(1).max(100),title:z.string().min(1).max(200),prompt:z.string().max(10000).optional(),image:z.string().max(2048).optional()}).passthrough()).max(500).parse(value);
  if(new Set(value.map((r:any)=>r.id)).size!==value.length)throw new HttpError(400,'DUPLICATE_REFERENCE','创作参考不能有重复标识');
  value=await Promise.all(value.map(async(reference:any)=>{
   const legacy=reference.image?.match(/^\/api\/assets\/([^/]+)(?:\/versions\/([^/]+))?\/file$/);
   const material=reference.material||(legacy?{kind:'asset',id:legacy[1],versionId:legacy[2]}:undefined);
   if(!material)return reference;
   const resolved=await resolveMaterial(tx,material);
   return {...reference,image:resolved.src,material:resolved.assetId?{kind:'asset',id:resolved.assetId,versionId:resolved.versionId}:material};
  }));
 }
 if(key==='brand')value=await normalizeBrand(tx,value);
 if(value===undefined||Buffer.byteLength(JSON.stringify(value))>1000000)throw new HttpError(400,'INVALID_PREFERENCE','设置数据超出限制');
 return value;
}
export async function storePreference(tx:Tx,workspace:string,key:string,value:any){
 const current=await readPreference(tx,key);
 if(canonical(current.value)===canonical(value))return current;
 const row=(await tx.query('INSERT INTO preferences(workspace_id,key,value) VALUES($1,$2,$3) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,revision=preferences.revision+1,updated_at=now() RETURNING value,revision',[workspace,key,JSON.stringify(value)])).rows[0];
 await emit(tx,workspace,'preference.updated',{key,revision:row.revision});return row;
}
