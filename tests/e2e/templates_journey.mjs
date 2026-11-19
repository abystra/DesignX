// Frozen catalog, server creation and real PNG/PDF; no paid model calls.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';import {chromium} from 'playwright';import sharp from 'sharp';
const base=process.env.DESIGNX_E2E_URL,output=new URL(`./.artifacts/templates-${Date.now()}/`,import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),checks=[],errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
async function api(path,data,method=data===undefined?'GET':'POST'){const r=await context.request.fetch(base+'/api'+path,{method,data,headers:{Origin:base}});assert.ok(r.ok(),path+': '+r.status()+' '+await r.text());return r.json();}
async function open(route){await page.goto(base+'/#'+route);await page.locator('.app-shell[aria-busy=false]').waitFor();}
async function download(format,name){await page.getByRole('button',{name:'导出作品',exact:true}).click();if(format==='PDF')await page.getByRole('button',{name:'PDF 单页文档',exact:true}).click();await page.getByLabel('导出尺寸',{exact:true}).selectOption('1');const pending=page.waitForEvent('download',{timeout:60000});await page.getByRole('button',{name:'导出 '+format,exact:true}).click();const file=await pending;await file.saveAs(new URL(name,output).pathname);return readFile(new URL(name,output));}
function check(s){checks.push(s);console.log('PASS',s);}
try{
 await api('/auth/register',{username:'template_'+randomUUID().slice(0,8),password:'template-browser-password'});
 const catalog=await api('/templates');assert.equal(catalog.length,8);
 for(const template of catalog){
  await open('templates');await page.getByRole('button',{name:'预览模板 '+template.title,exact:true}).click();
  await page.getByText(`模板版本 ${template.version} · 来源与使用依据`,{exact:true}).click();await page.getByText('字体：Noto Sans SC / Source Serif 4，OFL-1.1 随包许可。此模板为单张可编辑海报。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'使用这个模板',exact:true}).click();await page.waitForURL('**/#editor/*');await page.locator('.ed-root[aria-busy=false]').waitFor();const id=page.url().split('#editor/')[1],project=await api('/projects/'+id);assert.deepEqual(project.design,template.design);assert.equal(project.creationSource.digest,template.digest);
  await page.getByText('作品来源',{exact:true}).click();await page.getByText(`模板：${template.title} · 版本 ${template.version}`,{exact:true}).waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.ed-artboard img')].map(i=>i.decode()));});
  await page.screenshot({path:new URL(template.id+'-editor.png',output).pathname});
  const png=await download('PNG',template.id+'.png'),metadata=await sharp(png).metadata();assert.equal(metadata.width,600);assert.equal(metadata.height,800);
  await page.locator('.ed-export-modal').waitFor({state:'hidden'});
  if(template.id==='t1'){
   const pdf=await download('PDF',template.id+'.pdf');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000);await page.locator('.ed-export-modal').waitFor({state:'hidden'});
   await page.getByLabel('文字内容',{exact:true}).fill('周末在这里遇见一杯温暖的咖啡');await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.ed-save-state').filter({hasText:'已保存'}).waitFor();await page.reload();await page.locator('.ed-root[aria-busy=false]').waitFor();assert.equal(await page.getByLabel('文字内容',{exact:true}).inputValue(),'周末在这里遇见一杯温暖的咖啡');
   const after=await api('/projects/'+id);assert.equal(after.creationSource.digest,template.digest);assert.notDeepEqual(after.design,template.design);await download('PNG','long-chinese.png');await page.locator('.ed-export-modal').waitFor({state:'hidden'});
  }
 }
 check('all 8 template previews create the exact frozen version with source evidence and real PNG exports');check('PDF download and long Chinese edit/save/reload retain original template provenance');
 await open('templates');await page.locator('.template-card .favorite-button').nth(0).click();await page.locator('.template-card .favorite-button.is-favorite').waitFor();await page.getByRole('button',{name:'我的收藏',exact:true}).click();assert.equal(await page.locator('.template-card').count(),1);check('versioned templates remain discoverable through favorites');
 await open('home');await page.getByRole('button',{name:'搜索灵感、工具或作品'}).click();await page.getByLabel('全局搜索').fill(catalog[0].title);await page.locator('.search-result').filter({hasText:catalog[0].title}).first().click();await page.getByText(`模板版本 ${catalog[0].version} · 来源与使用依据`,{exact:true}).waitFor();check('global search opens the same published template version');await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
 const legacy=await api('/projects',{title:'模板验收 Studio',workspaceMode:'studio'});await open('studio/'+legacy.id);await page.locator('.ai-studio').waitFor();await page.getByRole('button',{name:'添加设计模板',exact:true}).click();await page.getByRole('button',{name:'添加模板 '+catalog[1].title,exact:true}).click();
 let snapshot;for(let n=0;n<60;n++){snapshot=await api(`/projects/${legacy.id}/studio`);if(snapshot.snapshot.results.some(r=>r.creationSource?.kind==='template'))break;await delay(150);}const artboard=snapshot.snapshot.results.find(r=>r.creationSource?.kind==='template');assert.ok(artboard);assert.deepEqual(artboard.design,catalog[1].design);check('legacy Studio adds a server-resolved versioned template artboard');
 assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:new URL('failure.png',output).pathname}).catch(()=>{});errors.push(error.message);throw error;}finally{await writeFile(new URL('results.json',output),JSON.stringify({base,checks,errors},null,2));await browser.close();}
