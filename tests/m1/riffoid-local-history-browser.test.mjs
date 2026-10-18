import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {legacyRecovery} from '../../services/gateway/recovery.ts';

const origin='https://old.example.test',canonical='https://app.riffoid.com';
test('expired recovery still exports synthetic original-origin Runs bytes without storage writes, upload, execution or replay',{timeout:30000},async t=>{
  let identities=0;
  const services={origin,canonical,until:1,database:{},identity:async()=>{identities++;throw Error('unexpected identity read');},snapshot:async()=>{throw Error('unexpected server read');},receipt:async()=>{throw Error('unexpected receipt');}};
  for(const path of ['/api/me','/api/auth/get-session','/api/workspaces/w','/api/workspaces/w/sessions/s/turns/receipt'])assert.equal((await legacyRecovery(new Request(origin+path),services)).status,410);
  const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||undefined,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost']});t.after(()=>browser.close());
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true}),requests=[],unexpected=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());requests.push({url:request.url(),method:request.method()});
    if(request.method()!=='GET'){unexpected.push(request.url());return route.abort();}
    if(request.url()===origin+'/seed'||request.url()===canonical+'/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Fixture</title>'});
    if(url.origin!==origin){unexpected.push(request.url());return route.abort();}
    const response=await legacyRecovery(new Request(request.url(),{headers:request.headers()}),services);
    if(response.status!==200||url.pathname.startsWith('/api/'))unexpected.push(request.url());
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const page=await context.newPage();await page.goto(origin+'/seed');
  const key='riffology:local-runs:v1:tenant-a:project-a:workspace-a',bad='riffology:local-runs:v1:tenant-a:project-a:workspace-b';
  const raw=JSON.stringify({schemaVersion:1,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a'},records:[{id:'completed',status:'completed',label:'<img src="https://unwanted.test/leak" onerror="fetch(1)">'},{id:'active',status:'running'}]});
  const saved={[key]:raw,[bad]:'{damaged original','riffology:pending-intent:private':'{"draft":"synthetic do not replay"}','unrelated':'preserve'};
  await page.evaluate(values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);},saved);
  await context.addInitScript(()=>{
    window.storageAccess={reads:0,writes:0};const read=Storage.prototype.getItem;
    Storage.prototype.getItem=function(key){window.storageAccess.reads++;return read.call(this,key);};
    for(const method of ['setItem','removeItem','clear'])Storage.prototype[method]=function(){window.storageAccess.writes++;throw Error('storage mutation denied by test');};
  });
  await page.goto(origin+'/');assert.equal(await page.locator('form').count(),0);assert.match(await page.textContent('body'),/window has ended/);
  await page.getByRole('link',{name:'View/export saved browser-local Runs'}).click();
  assert.equal(await page.locator('textarea').inputValue(),'');assert.deepEqual(await page.evaluate(()=>window.storageAccess),{reads:0,writes:0});
  const response=await legacyRecovery(new Request(origin+'/legacy-local-runs/'),services);assert.match(response.headers.get('content-security-policy'),/connect-src 'none'/);
  await page.getByRole('button',{name:'Find saved local histories'}).click();assert.equal(await page.locator('#histories button').count(),2);assert.equal(await page.evaluate(()=>window.storageAccess.reads),0);
  await page.getByRole('button',{name:'tenant-a / project-a / workspace-a',exact:true}).click();assert.equal(await page.locator('textarea').inputValue(),raw);assert.match(await page.textContent('#notice'),/2 records/);assert.equal(await page.locator('img,iframe').count(),0);
  const exported=page.waitForEvent('download');await page.getByRole('button',{name:'Export original snapshot'}).click();const download=await exported;assert.equal(download.suggestedFilename(),'riffology-local-runs-workspace-a.json');const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);assert.equal(Buffer.concat(chunks).toString(),raw);
  await page.getByRole('button',{name:'tenant-a / project-a / workspace-b',exact:true}).click();assert.match(await page.textContent('#notice'),/damaged/);assert.equal(await page.locator('textarea').inputValue(),saved[bad]);
  const damaged=page.waitForEvent('download');await page.getByRole('button',{name:'Export original snapshot'}).click();const damagedDownload=await damaged,badChunks=[];for await(const chunk of await damagedDownload.createReadStream())badChunks.push(chunk);assert.equal(damagedDownload.suggestedFilename(),'riffology-local-runs-workspace-b.txt');assert.equal(Buffer.concat(badChunks).toString(),saved[bad]);
  assert.equal(await page.evaluate(()=>window.storageAccess.writes),0);assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]))),saved);
  await page.evaluate(()=>{Storage.prototype.getItem=()=>{throw Error('denied');};});await page.getByRole('button',{name:'tenant-a / project-a / workspace-a',exact:true}).click();assert.match(await page.textContent('#notice'),/storage is unavailable/);assert.equal(await page.getByRole('button',{name:'Export original snapshot'}).isDisabled(),true);
  await page.goto(canonical+'/');assert.equal(await page.evaluate(()=>localStorage.length),0);
  await page.goto(origin+'/legacy-local-runs/');assert.deepEqual(await page.evaluate(()=>window.storageAccess),{reads:0,writes:0});assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(key=>[key,localStorage.getItem(key)]))),saved);
  assert.deepEqual(unexpected,[]);assert.equal(identities,0);assert.ok(requests.every(request=>request.method==='GET'&&!request.url.includes('/api/')));
});
