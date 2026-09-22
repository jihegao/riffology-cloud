import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const files = Object.fromEntries(await Promise.all(['admin.html','admin.js', 'i18n.js', 'i18n-bindings.js', 'locale-preference.js','publication.js','styles.css','admin.css'].map(async name => [name, await readFile(new URL(`../../services/web/${name}`, import.meta.url), 'utf8')])));
let browser;
before(async()=>{browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});});
after(async()=>{await browser?.close();});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const overview={tenants:1,activeTenants:1,projects:2,provisioningProjects:1,failedProjects:0,pendingInvitations:0,unknownOutbox:0,updatedAt:1_800_000_000_000};
async function fixture(t,handle,{mobile=false}={}){
  const context=await browser.newContext({locale:'zh-CN',viewport:mobile?{width:390,height:844}:{width:1200,height:800}});t.after(()=>context.close());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,'https://admin.test');
    if(url.pathname.startsWith('/api/')){
      if(await handle(route,url.pathname))return;
      if(url.pathname==='/api/auth/get-session')return json(route,{user:{id:'operator'}});
      if(url.pathname==='/api/me/locale')return json(route,{locale:null});
      if(url.pathname==='/api/admin/overview')return json(route,overview);
      if(url.pathname==='/api/admin/tenants')return json(route,{tenants:[]});
      if(url.pathname==='/api/admin/invitations')return json(route,{invitations:[]});
      if(url.pathname==='/api/admin/models')return json(route,{models:[]});
      if(url.pathname==='/api/admin/private-beta')return json(route,{error:'private-beta-unconfigured'},503);
      if(url.pathname==='/api/admin/audit')return json(route,{events:[]});
      throw Error(`unexpected admin request ${url.pathname}`);
    }
    const name=url.pathname==='/admin'?'admin.html':url.pathname.slice(1);
    return route.fulfill({status:files[name]?200:404,contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html',body:files[name]||''});
  });
  return page;
}
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.ok(check(),'condition timed out');}

test('authenticated tenant owner without operator role sees no management data',async t=>{
  let adminReads=0;
  const page=await fixture(t,async(route,path)=>{
    if(path==='/api/admin/overview'){adminReads++;await json(route,{error:'not_found'},404);return true;}
  });
  await page.goto('https://admin.test/admin');await page.locator('#admin-denied:not([hidden])').waitFor();
  assert.equal(adminReads,1);assert.equal(await page.locator('#admin-app').isVisible(),false);assert.match(await page.locator('#notice').innerText(),/没有平台管理权限/);
});

test('operator retries one invitation intent, sees one-time token, revokes it, and reads metadata only',async t=>{
  const attempts=[],paths=[];let invitation=null,issueCalls=0,revokeCalls=0;
  const page=await fixture(t,async(route,path)=>{
    paths.push(path);
    if(path==='/api/admin/invitations'&&route.request().method()==='POST'){
      issueCalls++;attempts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
      if(issueCalls<=2){await route.abort('failed');return true;}
      invitation={id:'invite-one',normalized_email:'alice@example.test',state:'pending',created_at:1_800_000_000_000,expires_at:1_800_604_800_000,accepted_at:null,revoked_at:null};
      await json(route,{invitation,token:'a'.repeat(64),replayed:false},201);return true;
    }
    if(path==='/api/admin/invitations'&&route.request().method()==='GET'){await json(route,{invitations:invitation?[invitation]:[]});return true;}
    if(path==='/api/admin/tenants'){await json(route,{tenants:[{id:'tenant-a',status:'active',projects:2,provisioning:1,ready:1,failed:0,created_at:1_800_000_000_000}]});return true;}
    if(path==='/api/admin/audit'){await json(route,{events:[{id:'event-a',actor_user_id:'operator',tenant_id:null,action:'invitation.issue',target_type:'invitation',target_id:'invite-one',reason_code:'operator_requested',outcome:'completed',request_id:'request-a',created_at:1_800_000_000_000}]});return true;}
    if(path==='/api/admin/invitations/invite-one/revoke'){
      revokeCalls++;invitation={...invitation,state:'revoked',revoked_at:1_800_000_000_100};await json(route,invitation);return true;
    }
  },{mobile:true});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('https://admin.test/admin');await page.locator('#admin-app:not([hidden])').waitFor();
  await page.locator('#issue-email').fill('alice@example.test');await page.locator('#issue-submit').click();
  await page.locator('#issue-submit:not([disabled])').waitFor();assert.equal(await page.locator('#issue-email').isDisabled(),true);assert.equal(await page.locator('#issue-reset').isVisible(),true);
  await page.locator('#issue-submit').click();await page.locator('#issue-submit:not([disabled])').waitFor();
  await page.locator('#issue-submit').click();await page.locator('#token-panel:not([hidden])').waitFor();
  assert.equal(attempts.length,3);assert.deepEqual(attempts[0],attempts[1]);assert.deepEqual(attempts[1],attempts[2]);
  assert.deepEqual(JSON.parse(attempts[0].body),{email:'alice@example.test',expiresInDays:7});
  assert.equal(await page.locator('#issued-token').inputValue(),'a'.repeat(64));assert.match(await page.locator('#token-title').innerText(),/立即保存/);
  await page.getByRole('button',{name:'撤销'}).click();await waitFor(()=>revokeCalls===1);await page.locator('#invitations').getByText('已撤销').waitFor();
  assert.equal(paths.some(path=>path.startsWith('/api/tenants/')),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('replayed invitation response never invents a plaintext token',async t=>{
  const page=await fixture(t,async(route,path)=>{
    if(path==='/api/admin/invitations'&&route.request().method()==='POST'){
      await json(route,{invitation:{id:'invite-replayed',normalized_email:'lost@example.test',state:'pending',created_at:1,expires_at:2},token:null,replayed:true},201);return true;
    }
  });
  await page.goto('https://admin.test/admin');await page.locator('#admin-app:not([hidden])').waitFor();
  await page.locator('#issue-email').fill('lost@example.test');await page.locator('#issue-submit').click();await page.locator('#token-panel:not([hidden])').waitFor();
  assert.equal(await page.locator('#issued-token').inputValue(),'');assert.match(await page.locator('#token-title').innerText(),/不会再次显示/);
});

test('operator revokes and restores accepted invitation access without changing invitation history',async t=>{
  let access='active';const calls=[];
  const invitation=()=>({id:'accepted-one',normalized_email:'accepted@example.test',state:'accepted',access_state:access,created_at:1_800_000_000_000,expires_at:1_800_604_800_000,accepted_at:1_800_000_000_100,revoked_at:null});
  const page=await fixture(t,async(route,path)=>{
    if(path==='/api/admin/invitations'&&route.request().method()==='GET'){await json(route,{invitations:[invitation()]});return true;}
    if(path==='/api/admin/invitations/accepted-one/access'){
      const body=JSON.parse(route.request().postData());calls.push(body);access=body.action==='revoke'?'revoked':'active';await json(route,invitation());return true;
    }
  },{mobile:true});
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('https://admin.test/admin');await page.locator('#admin-app:not([hidden])').waitFor();
  await page.getByRole('button',{name:'撤销访问'}).click();await waitFor(()=>calls.length===1);await page.getByRole('button',{name:'恢复访问'}).waitFor();
  await page.getByRole('button',{name:'恢复访问'}).click();await waitFor(()=>calls.length===2);await page.getByRole('button',{name:'撤销访问'}).waitFor();
  assert.deepEqual(calls,[{action:'revoke'},{action:'restore'}]);
  assert.equal(await page.locator('#invitations').getByText('已接受').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('operator manages published model metadata with safe text and idempotent lifecycle actions', async t => {
  const calls = [], actionKeys = [], states = new Map([['model-a', 'draft']]); let createAttempts = 0, validateAttempts = 0;
  const page = await fixture(t, async (route, path) => {
    if (path === '/api/admin/models' && route.request().method() === 'GET') { await json(route, { models: [{ id: 'model-a', model_id: 'queue', version: '1.0.0', title: '<b>模型</b>', description: '<img src=x onerror=alert(1)>', status: states.get('model-a') }] }); return true; }
    if (path === '/api/admin/models' && route.request().method() === 'POST') { createAttempts++; calls.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() }); if (createAttempts === 1) { await route.abort('failed'); return true; } await json(route, { model: { id: 'model-a' } }, 201); return true; }
    if (path === '/api/admin/models/model-a/validate') { validateAttempts++; actionKeys.push(route.request().headers()['idempotency-key']); if (validateAttempts === 1) { await json(route, { error: 'not_ready' }, 409); return true; } states.set('model-a', 'validated'); await json(route, {}); return true; }
    if (path === '/api/admin/models/model-a/publish') { states.set('model-a', 'published'); await json(route, {}); return true; }
  }, { mobile: true });
  await page.goto('https://admin.test/admin'); await page.locator('#admin-app:not([hidden])').waitFor();
  assert.equal(await page.locator('#models td').count() > 0, true); assert.equal(await page.locator('#models img').count(), 0); assert.equal(await page.locator('#models').innerText().then(text => text.includes('<b>模型</b>')), true);
  await page.locator('#model-id').fill('queue'); await page.locator('#model-version').fill('1.0.0'); await page.locator('#model-title').fill('模型'); await page.locator('#model-description').fill('说明'); await page.locator('#model-starter').fill('blank-v1'); await page.locator('#model-content-ref').fill('r2://models/queue'); await page.locator('#model-content-sha').fill('a'.repeat(64)); await page.locator('#model-submit').click();
  await page.locator('#model-submit:not([disabled])').waitFor(); assert.equal(await page.locator('#model-submit').innerText(), '重试同一请求'); await page.locator('#model-submit').click(); await page.locator('#models .status').filter({ hasText: '草稿' }).waitFor(); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(JSON.parse(calls[0].body), { modelId: 'queue', version: '1.0.0', title: '模型', description: '说明', starterVersion: 'blank-v1', contentRef: 'r2://models/queue', contentSha256: 'a'.repeat(64) });
  await page.locator('#models button').click(); await page.locator('#notice').filter({ hasText: '模型内容包尚未通过验证，请核对上传内容和摘要后重试' }).waitFor(); assert.equal(await page.locator('#models .status').innerText(), '草稿');
  await page.locator('#models button').click(); await page.locator('#models .status').filter({ hasText: '已验证' }).waitFor(); assert.equal(validateAttempts, 2); assert.equal(actionKeys[0], actionKeys[1]); await page.locator('#models button').click(); await page.locator('#models .status').filter({ hasText: '已发布' }).waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('operator uploads canonical model content with client checks and idempotent retry', async t => {
  const bytes = Buffer.from('{"model":"queue","version":1}\n');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  const page = await fixture(t, async (route, path) => {
    if (path === '/api/admin/models' && route.request().method() === 'GET') { await json(route, { models: [{ id: 'model-upload', model_id: 'queue', version: '1.0.0', title: '模型', description: '说明', status: 'draft', content_sha256: sha }] }); return true; }
    if (path === '/api/admin/models/model-upload/content') {
      calls.push({ key: route.request().headers()['idempotency-key'], body: Buffer.from(await route.request().postDataBuffer() || Buffer.alloc(0)) });
      if (calls.length === 1) { await route.abort('failed'); return true; }
      await json(route, {}); return true;
    }
  });
  await page.goto('https://admin.test/admin'); await page.locator('#admin-app:not([hidden])').waitFor();
  const input = page.getByLabel('上传规范包');
  await input.setInputFiles({ name: 'model.json', mimeType: 'application/json', buffer: bytes });
  await input.waitFor({ state: 'attached' }); await page.locator('#notice').filter({ hasText: '重试会保持相同请求' }).waitFor();
  await input.setInputFiles({ name: 'model.json', mimeType: 'application/json', buffer: bytes });
  await page.locator('#notice').filter({ hasText: '内容包已上传，可以验证。' }).waitFor();
  assert.equal(calls.length, 2); assert.match(calls[0].key, /^[A-Za-z0-9_-]{1,128}$/); assert.equal(calls[0].key, calls[1].key); assert.deepEqual(calls[0].body, bytes); assert.deepEqual(calls[1].body, bytes); assert.equal(await page.locator('#models .status').innerText(), '草稿');
  const before = calls.length;
  await input.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await page.locator('#notice').filter({ hasText: '不能超过 8 MiB' }).waitFor(); assert.equal(calls.length, before);
  await input.setInputFiles({ name: 'wrong.json', mimeType: 'application/json', buffer: Buffer.from('wrong') });
  await page.locator('#notice').filter({ hasText: 'SHA-256 与模型摘要不一致' }).waitFor(); assert.equal(calls.length, before);
});


test('operator Beta panel shows capacity and conservative exposure, pauses once and cannot resume while resources remain',async t=>{
 let paused=false,posts=0;
 const page=await fixture(t,async(route,path)=>{
  if(path!=='/api/admin/private-beta')return false;
  if(route.request().method()==='POST'){posts++;assert.deepEqual(JSON.parse(route.request().postData()),{action:'pause'});paused=true;await json(route,{paused:true});}
  else await json(route,{enabled:true,paused,active:1,quarantined:0,limits:{maxActiveTurns:2,maxNanodollarsTotal:20000000000},usage:[{reservedNanodollars:600000000}],alerts:[]});
  return true;
 });
 await page.goto('https://admin.test/admin');await page.waitForFunction(()=>document.querySelector('#private-beta-status').textContent.includes('$0.60'));
 assert.match(await page.locator('#private-beta-status').innerText(),/占用 1\/2/);
 await page.locator('#private-beta-pause').click();await page.waitForFunction(()=>document.querySelector('#private-beta-pause').disabled);
 assert.equal(posts,1);assert.equal(await page.locator('#private-beta-resume').isDisabled(),true);
});

test('locale switch updates admin platform labels and display formatting without rebuilding user metadata or an in-flight form', async t => {
  const writes = [];
  const page = await fixture(t, async (route, path) => {
    if (route.request().method() !== 'GET') writes.push({path, method:route.request().method()});
    if (path === '/api/admin/invitations' && route.request().method() === 'POST') { await route.abort('failed'); return true; }
    if (path === '/api/admin/invitations' && route.request().method() === 'GET') { await json(route, {invitations:[{id:'invite-locale', normalized_email:'owner@example.test', state:'pending', created_at:1_800_000_000_000, expires_at:1_800_604_800_000}]}); return true; }
    if (path === '/api/admin/models' && route.request().method() === 'GET') { await json(route, {models:[{id:'model-locale', model_id:'queue', version:'1.0.0', title:'用户模型标题', description:'User supplied description', status:'draft'}]}); return true; }
  });
  await page.goto('https://admin.test/admin'); await page.locator('#admin-app:not([hidden])').waitFor();
  await page.locator('#issue-email').fill('draft@example.test');
  await page.locator('#issue-submit').click(); await page.locator('#issue-submit:not([disabled])').waitFor();
  const writesBeforeLocale = [...writes];
  const row = page.locator('#models tr').first();
  await page.locator('[data-locale-select]').selectOption('en');
  await page.getByRole('heading', {name:'Platform status'}).waitFor();
  assert.equal(await page.locator('#issue-email').inputValue(), 'draft@example.test');
  assert.equal(await page.locator('#issue-email').isDisabled(), true);
  assert.equal(await page.getByRole('button', {name:'Retry same request'}).count(), 1);
  assert.equal(await row.innerText().then(value => value.includes('用户模型标题')), true);
  assert.equal(await row.innerText().then(value => value.includes('User supplied description')), true);
  assert.equal(await page.getByRole('button', {name:'Revoke'}).count(), 1);
  assert.match(await page.locator('#private-beta-status').innerText(), /Beta capacity status is unavailable/);
  assert.match(await page.locator('#invitations tr').first().innerText(), /Pending/);
  assert.deepEqual(writes, [...writesBeforeLocale, {path:'/api/me/locale', method:'PUT'}]);
});
