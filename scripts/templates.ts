import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {ArtboardSchema} from '../packages/doc-core/src/index.js';
import {canonical} from '../packages/server-domain/src/idempotency.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const relative='src/data/template-registry.json',path=resolve(root,relative);
export const templateDigest=(item:any)=>{const {digest,...content}=item;return createHash('sha256').update(canonical(content)).digest('hex');};
export function validateCatalog(catalog:any,previous?:any){
 if(catalog.schemaVersion!==1||!Array.isArray(catalog.versions)||!catalog.releases)throw new Error('Invalid template catalog');
 const seen=new Set<string>();
 for(const item of catalog.versions){
  const key=item.id+':'+item.version;
  if(!/^[a-z0-9-]{1,100}$/.test(item.id)||!Number.isSafeInteger(item.version)||item.version<1||seen.has(key))throw new Error('Invalid/duplicate template version: '+key);
  seen.add(key);ArtboardSchema.parse(item.design);
  if(item.digest!==templateDigest(item))throw new Error('Template digest mismatch: '+key);
  if(!item.title||!item.category||!item.source?.layout?.basis||!item.source.images?.length||!item.source.fonts?.length)throw new Error('Missing source evidence: '+key);
  for(const image of item.source.images)if(!/^[a-f0-9]{64}$/.test(image.sha256)||image.file!=='/assets/templates/'+image.sha256+'.jpg'||!image.sourceUrl?.startsWith('https://')||!image.licenseUrl?.startsWith('https://')||!image.basis||!image.limitations)throw new Error('Missing image evidence: '+key);
  for(const node of item.design.nodes)if(node.type==='image'&&!item.source.images.some((image:any)=>image.file===node.src))throw new Error('Unregistered template image: '+key);
 }
 for(const [id,release] of Object.entries(catalog.releases) as [string,any][]){
  if(!seen.has(id+':'+release.version)||!['published','withdrawn'].includes(release.state)||!release.reason?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(release.changedOn))throw new Error('Invalid release: '+id);
 }
 for(const old of previous?.versions||[]){
  const current=catalog.versions.find((v:any)=>v.id===old.id&&v.version===old.version);
  if(!current||canonical(current)!==canonical(old))throw new Error('Immutable template version changed or removed: '+old.id+':'+old.version);
 }
}
async function main(){
 const args=process.argv.slice(2),operation=args.shift()||'validate';
 const catalog=JSON.parse(await readFile(path,'utf8')),old=structuredClone(catalog);
 let previous;
 const baseIndex=args.indexOf('--base'),base=baseIndex>=0?args[baseIndex+1]:'HEAD';
 try{previous=JSON.parse(execFileSync('git',['show',base+':'+relative],{cwd:root,stdio:['ignore','pipe','ignore'],encoding:'utf8'}));}
 catch{if(baseIndex>=0)throw new Error('Required immutable-version baseline is unavailable: '+base);}
 if(operation==='add'){
  const item=JSON.parse(await readFile(resolve(args[0]),'utf8'));
  if(catalog.versions.some((v:any)=>v.id===item.id&&v.version>=item.version))throw new Error('Add a new monotonically increasing version');
  item.digest=templateDigest(item);catalog.versions.push(item);
 }else if(operation==='publish'||operation==='withdraw'){
  const [id,versionText,...reasonParts]=args,version=Number(versionText),reason=reasonParts.join(' ').trim();
  if(!reason||!Number.isSafeInteger(version)||!catalog.versions.some((v:any)=>v.id===id&&v.version===version))throw new Error('Usage: publish|withdraw ID VERSION REASON');
  catalog.releases[id]={version,state:operation==='publish'?'published':'withdrawn',reason,changedOn:new Date().toISOString().slice(0,10)};
 }else if(operation!=='validate')throw new Error('Usage: templates.ts validate [--base COMMIT] | add JSON | publish|withdraw ID VERSION REASON');
 validateCatalog(catalog,previous);if(operation!=='validate')validateCatalog(catalog,old);
 for(const item of catalog.versions)for(const asset of item.source.images){
  for(const file of [asset.file,asset.legacyFile].filter(Boolean)){
   if(!/^\/assets\/[a-zA-Z0-9_./-]+$/.test(file)||file.includes('..'))throw new Error('Invalid bundled asset path');
   const hash=createHash('sha256').update(await readFile(resolve(root,'public'+file))).digest('hex');
   if(hash!==asset.sha256)throw new Error('Frozen asset bytes changed: '+file);
  }
 }
 if(operation!=='validate'){
  const temporary=path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});await rename(temporary,path);
 }
 console.log(`Template catalog valid: ${catalog.versions.length} immutable versions, ${Object.values(catalog.releases).filter((r:any)=>r.state==='published').length} published. ${operation==='validate'?'':'Commit, test and deploy to publish this change.'}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
