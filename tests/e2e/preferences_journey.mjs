import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
assert.equal(process.env.DESIGNX_TEST_ENV,'true');
const base=process.env.DESIGNX_E2E_URL,output=new URL('./.artifacts/preferences-'+Date.now()+'/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),a=await browser.newContext({viewport:{width:1440,height:1000}}),b=await browser.newContext({viewport:{width:1440,height:1000}});
const first=await a.newPage(),second=await b.newPage(),errors=[],checks=[];for(const page of [first,second]){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));}
const check=name=>{checks.push({name,passed:true});console.log('PASS '+name);};
async function api(client,path,data,method=data===undefined?'GET':'POST',headers={}){const r=await client.request.fetch(base+'/api'+path,{method,data,headers:{Origin:base,...headers}});assert.ok(r.ok(),path+': '+r.status()+' '+await r.text());return r.json();}
async function home(page,route='assets'){const target=base+'/#'+route;if(page.url()===target)await page.reload();else await page.goto(target);await page.locator('.app-shell[aria-busy=false]').waitFor();if(route==='assets')await page.locator('.ws-page[aria-busy=false]').waitFor();}
async function brand(page){await home(page);await page.getByRole('tab',{name:'品牌套件',exact:true}).click();}
async function reference(page,name){await home(page);await page.getByRole('tab',{name:'创作参考',exact:true}).click();await page.getByRole('button',{name:'新建参考',exact:true}).click();const dialog=page.getByRole('dialog',{name:'把灵感存成创作参考'});await dialog.getByLabel('参考名称',{exact:true}).fill(name);await dialog.getByLabel('创作提示词',{exact:true}).fill('保留我的创作描述');return dialog;}
const username='pref_'+randomUUID().slice(0,8),password='preferences-browser-password';
try{
 await api(a,'/auth/register',{username,password,name:'偏好并发验收'});await api(b,'/auth/login',{account:username,password});
 const posters=await Promise.all(['收藏海报 A','收藏海报 B'].map(title=>api(a,'/projects',{title,workspaceMode:'editor'})));
 await home(first,'projects');await home(second,'projects');
 await first.getByRole('button',{name:'收藏海报 A 更多操作',exact:true}).click();await second.getByRole('button',{name:'收藏海报 B 更多操作',exact:true}).click();
 await Promise.all([first.getByRole('button',{name:'收藏作品',exact:true}).click(),second.getByRole('button',{name:'收藏作品',exact:true}).click()]);
 await first.locator('.ws-page[aria-busy=false]').waitFor();await second.locator('.ws-page[aria-busy=false]').waitFor();
 await first.getByRole('button',{name:'我的收藏',exact:true}).click();await first.locator('.ws-page[aria-busy=false]').waitFor();assert.equal(await first.locator('.ws-project-card').count(),2);
 assert.deepEqual(new Set(await api(a,'/preferences/favorites')),new Set(posters.map(p=>p.id)));
 check('project menu favorites from two sessions appear in the real server-filtered library');
 await home(first,'templates');await home(second,'templates');
 await Promise.all([first.locator('.template-card .favorite-button').nth(0).click(),second.locator('.template-card .favorite-button').nth(1).click()]);
 await first.locator('.template-card .favorite-button.is-favorite').nth(0).waitFor();await second.locator('.template-card .favorite-button.is-favorite').nth(0).waitFor();
 assert.deepEqual(new Set(await api(a,'/preferences/template-favorites')),new Set(['t1','t2']));
 check('two independent browser sessions keep different template favorites');
 let lost=false;
 await first.route('**/api/preferences/template-favorites/items',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await first.locator('.template-card .favorite-button').nth(2).click();await first.getByText('Failed to fetch',{exact:false}).waitFor();
 const savedFavorite=await api(a,'/preferences/template-favorites?meta=1');assert.equal(savedFavorite.value.length,3);
 await first.locator('.template-card .favorite-button').nth(2).click();await first.locator('.template-card .favorite-button.is-favorite').nth(2).waitFor();
 assert.equal((await api(a,'/preferences/template-favorites?meta=1')).revision,savedFavorite.revision);await first.unroute('**/api/preferences/template-favorites/items');
 check('lost favorite response retries once without a second revision');
 await brand(first);await first.getByLabel('品牌名称',{exact:true}).fill('共享品牌');await first.getByRole('button',{name:'保存品牌套件',exact:true}).click();await first.getByRole('button',{name:'已保存品牌套件',exact:true}).waitFor();
 await brand(first);await brand(second);await first.getByLabel('品牌名称',{exact:true}).fill('另一端的新名称');await second.getByLabel('品牌描述',{exact:true}).fill('我的品牌描述');
 await first.getByRole('button',{name:'保存品牌套件',exact:true}).click();await first.getByRole('button',{name:'已保存品牌套件',exact:true}).waitFor();
 await second.getByRole('button',{name:'保存品牌套件',exact:true}).click();await second.getByText('另一端保存了新的品牌内容',{exact:true}).waitFor();assert.equal(await second.getByLabel('品牌描述',{exact:true}).inputValue(),'我的品牌描述');
 await second.getByRole('button',{name:'合并后继续编辑',exact:true}).click();assert.equal(await second.getByLabel('品牌名称',{exact:true}).inputValue(),'另一端的新名称');await second.getByRole('button',{name:'保存品牌套件',exact:true}).click();await second.getByRole('button',{name:'已保存品牌套件',exact:true}).waitFor();
 let value=await api(a,'/preferences/brand');assert.equal(value.name,'另一端的新名称');assert.equal(value.description,'我的品牌描述');
 check('brand conflict keeps draft and explicitly merges different fields before saving');
 lost=false;await second.route('**/api/preferences/brand?meta=1',async route=>{if(route.request().method()==='PUT'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await second.getByLabel('品牌标语',{exact:true}).fill('丢响应仍只保存一次');await second.getByRole('button',{name:'保存品牌套件',exact:true}).click();await second.locator('.ws-brand-form .ws-error').waitFor();
 const savedBrand=await api(a,'/preferences/brand?meta=1');await second.getByRole('button',{name:'保存品牌套件',exact:true}).click();await second.getByRole('button',{name:'已保存品牌套件',exact:true}).waitFor();assert.equal((await api(a,'/preferences/brand?meta=1')).revision,savedBrand.revision);await second.unroute('**/api/preferences/brand?meta=1');
 check('lost conditional brand-save response replays without conflict or duplicate revision');
 const da=await reference(first,'客户端 A 的参考'),db=await reference(second,'客户端 B 的参考');
 await da.getByRole('button',{name:'保存创作参考',exact:true}).click();await da.waitFor({state:'hidden'});await db.getByRole('button',{name:'保存创作参考',exact:true}).click();await db.getByRole('button',{name:'更新参考列表，保留输入',exact:true}).waitFor();assert.equal(await db.getByLabel('参考名称',{exact:true}).inputValue(),'客户端 B 的参考');
 await db.getByRole('button',{name:'更新参考列表，保留输入',exact:true}).click();await db.getByRole('button',{name:'保存创作参考',exact:true}).click();await db.waitFor({state:'hidden'});assert.equal((await api(a,'/preferences/references')).length,2);
 check('reference list conflict preserves form and retains both clients after explicit refresh');
 const dc=await reference(first,'丢响应的参考');lost=false;await first.route('**/api/preferences/references?meta=1',async route=>{if(route.request().method()==='PUT'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await dc.getByRole('button',{name:'保存创作参考',exact:true}).click();await dc.locator('.ws-error').waitFor();const savedRefs=await api(a,'/preferences/references?meta=1');assert.equal(savedRefs.value.length,3);await dc.getByRole('button',{name:'保存创作参考',exact:true}).click();await dc.waitFor({state:'hidden'});assert.equal((await api(a,'/preferences/references?meta=1')).revision,savedRefs.revision);await first.unroute('**/api/preferences/references?meta=1');
 check('reference retry preserves its item ID and request key without adding a duplicate');
 await brand(second);await second.getByLabel('品牌描述',{exact:true}).fill('窄屏保留的输入');
 const remote=await api(a,'/preferences/brand?meta=1');await api(a,'/preferences/brand',{...remote.value,name:'远端长名称用于检查布局'.repeat(5),description:'另一端的长内容。'.repeat(100)},'PUT',{'If-Match':'"'+remote.revision+'"','Idempotency-Key':randomUUID()});
 await second.getByRole('button',{name:'保存品牌套件',exact:true}).click();await second.getByText('另一端保存了新的品牌内容',{exact:true}).waitFor();await second.getByText('查看另一端的品牌内容',{exact:true}).click();
 for(const [width,height] of [[1440,1000],[1024,768],[390,844],[320,568],[600,844],[850,768],[1100,768],[720,500]]){
  await second.setViewportSize({width,height});assert.ok(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow at '+width);await second.getByRole('button',{name:'合并后继续编辑',exact:true}).scrollIntoViewIfNeeded();await second.screenshot({path:new URL('conflict-'+width+'.png',output).pathname});
 }
 await second.getByRole('button',{name:'合并后继续编辑',exact:true}).click();assert.equal(await second.getByLabel('品牌描述',{exact:true}).inputValue(),'窄屏保留的输入');
 check('long conflict content and explicit actions remain reachable at desktop, tablet, 390px, 320px and zoom-equivalent widths');
 assert.deepEqual(errors,[]);
}catch(error){await second.screenshot({path:new URL('failure.png',output).pathname});await writeFile(new URL('failure.html',output),await second.content());throw error;}
finally{await writeFile(new URL('results.json',output),JSON.stringify({base,checks,errors,data:'isolated real accounts and preferences; response-loss injection only'},null,2));await browser.close();}
