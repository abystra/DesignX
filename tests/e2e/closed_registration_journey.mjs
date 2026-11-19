// Real isolated API/browser checks; the config change models a server closing registration.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {config} from '../../packages/server-infra/src/config.ts';
import {pool} from '../../packages/server-infra/src/db.ts';
assert.equal(process.env.DESIGNX_TEST_ENV,'true');
const enabled=config.registrationEnabled,base=process.env.DESIGNX_E2E_URL;
const output=new URL('./.artifacts/registration-closed-'+Date.now()+'/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),seed=await browser.newContext(),page=await context.newPage();
page.setDefaultTimeout(20000);const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
const username='existing_'+randomUUID().slice(0,8),password='existing-account-password';
const check=name=>{checks.push(name);console.log('PASS '+name)};
try {
  assert.equal(enabled,true);
  const fixture=await seed.request.post(base+'/api/auth/register',{data:{username,password}});assert.equal(fixture.status(),201);const identity=await fixture.json();
  await page.goto(base);await page.getByRole('button',{name:'第一次来？创建账户',exact:true}).click();
  await page.getByLabel('你的名字',{exact:true}).fill('过期注册页面');await page.getByLabel('账号',{exact:true}).fill('stale_'+randomUUID().slice(0,8));await page.getByLabel('密码',{exact:true}).fill(password);await page.getByLabel('确认密码',{exact:true}).fill(password);
  const before=(await pool.query('SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM workspaces) AS workspaces')).rows[0];
  config.registrationEnabled=false;
  await page.getByRole('button',{name:'创建账户',exact:true}).click();await page.getByRole('alert').filter({hasText:'当前暂不开放注册'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'创建账户',exact:true}).count(),0);await page.getByRole('button',{name:'进入创作空间',exact:true}).waitFor();
  for(const body of [{username:'blocked_'+randomUUID().slice(0,8),password},{email:randomUUID()+'@example.test',password}]){const response=await context.request.post(base+'/api/auth/register',{data:body});assert.equal(response.status(),403);assert.equal((await response.json()).error,'REGISTRATION_CLOSED')}
  assert.deepEqual((await pool.query('SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM workspaces) AS workspaces')).rows[0],before);
  check('stale registration form and direct username/email requests are rejected without creating accounts or workspaces');
  await page.reload();await page.getByText('当前暂不开放注册，请使用已有账号登录。',{exact:true}).waitFor();
  for(const [width,height] of [[1440,1000],[1024,768],[390,844],[320,568]]){
    await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.getByRole('button',{name:'第一次来？创建账户',exact:true}).count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const notice=await page.locator('.auth-registration-status').boundingBox(),submit=await page.getByRole('button',{name:'进入创作空间',exact:true}).boundingBox();assert.ok(notice.y>=submit.y+submit.height,'Registration notice must not overlap login button');
    await page.screenshot({path:new URL('closed-'+width+'.png',output).pathname,fullPage:true,animations:'disabled'});
  }
  await page.getByLabel('登录账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入创作空间',exact:true}).click();await page.locator('.app-shell[aria-busy=false]').waitFor();
  assert.equal((await(await context.request.get(base+'/api/auth/me')).json()).user.id,identity.user.id);
  await page.goto(base+'/#account');await page.getByRole('button',{name:'退出登录',exact:true}).click();await page.getByRole('button',{name:'进入创作空间',exact:true}).waitFor();
  check('closed login page remains usable at desktop/tablet/390px/320px; existing account signs in and out');
  await page.route('**/api/auth/options',route=>route.abort('failed'));await page.reload();await page.getByText('请使用已有账号登录。',{exact:true}).waitFor();await page.getByRole('button',{name:'进入创作空间',exact:true}).waitFor();assert.equal(await page.locator('.auth-switch').count(),0);
  await page.getByLabel('登录账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'进入创作空间',exact:true}).click();await page.locator('.app-shell[aria-busy=false]').waitFor();
  check('unavailable public auth options keep registration hidden while existing login still works');
  assert.deepEqual(errors,[]);
} catch(error){await page.screenshot({path:new URL('failure.png',output).pathname,fullPage:true}).catch(()=>{});throw error}
finally{config.registrationEnabled=enabled;await writeFile(new URL('evidence.json',output),JSON.stringify({checks,errors,data:'isolated local database and synthetic account; no production mutation'},null,2));await browser.close()}
console.log('Closed registration browser evidence: '+output.pathname);
