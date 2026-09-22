import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createPreviewVerticalFixture} from './preview-vertical-fixture.mjs';
import {PREVIEW_ACCESS_COOKIE,PREVIEW_NONCE_COOKIE} from '../../services/preview/browser.ts';
import {previewFrameSource} from '../../services/gateway/preview-services.ts';
const control='https://app.example.test';
// Real browser + production Gateway/Workspace/journals/D1/R2. Identity exchange,
// static control shell and the project Runtime are explicit local fixtures.
test('browser Preview opens through production Gateway and durable Workspace, recovers and rejects a revoked login',{timeout:45000},async t=>{
 const f=await createPreviewVerticalFixture();t.after(()=>f.dispose());
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 const requests=[],errors=[],responses=[];page.on('pageerror',e=>errors.push(e.message));
 const modules=Object.fromEntries(await Promise.all(['previews.js','i18n.js','i18n-bindings.js'].map(async name=>[name,await readFile(new URL(`../../services/web/${name}`,import.meta.url),'utf8')])));
 const client=`import {createPreviewPanel} from '/previews.js';import {setLocale} from '/i18n.js';setLocale('zh-CN');const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{'content-type':'application/json',...options.headers}});if(!r.ok)throw Object.assign(Error('http-error'),{status:r.status});return r.json();};window.panel=createPreviewPanel({root:document.querySelector('#root'),api});await window.panel.enter(${JSON.stringify({tenantId:f.scope.tenantId,workspaceId:f.scope.workspaceId,canOpen:true})});window.panel.selectRun(${JSON.stringify(f.runId)});window.panelReady=true;`;
 await page.route('**/*',async route=>{
  const incoming=route.request(),url=new URL(incoming.url()),headers=await incoming.allHeaders();requests.push({url:url.href,method:incoming.method(),headers});
  if(url.origin===control&&!url.pathname.startsWith('/api/')){
   if(Object.hasOwn(modules,url.pathname.slice(1)))return route.fulfill({contentType:'application/javascript',body:modules[url.pathname.slice(1)]});
   if(url.pathname==='/panel.js')return route.fulfill({contentType:'application/javascript',body:client});
   if(url.pathname==='/'){
    // The shell can outlive a gates-false foundation deployment. Its narrowly
    // configured frame source must still permit Preview after the API gate opens.
    const frameSource=previewFrameSource({APP_ORIGIN:control,M3_PREVIEW_ORIGIN:'https://preview.example.test',M3_PREVIEW_ENABLED:'false'});
    return route.fulfill({headers:{'content-type':'text/html','content-security-policy':`default-src 'self'; script-src 'self'; connect-src 'self'; frame-src ${frameSource}; frame-ancestors 'none'`},body:'<!doctype html><div id="root"></div><script type="module" src="/panel.js"></script>'});
   }
   return route.fulfill({status:404,body:''});
  }
  if(url.origin!==control&&!/^p-[a-f0-9]{40}\.preview\.example\.test$/.test(url.hostname))return route.abort();
  const response=await f.mf.dispatchFetch(url.href,{method:incoming.method(),headers,body:['GET','HEAD'].includes(incoming.method())?undefined:incoming.postDataBuffer()});
  const body=Buffer.from(await response.arrayBuffer()),outgoing=Object.fromEntries(response.headers);
  const cookies=response.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies.join('\n');
  responses.push({url:url.href,status:response.status,body:body.toString()});
  await route.fulfill({status:response.status,headers:outgoing,body});
 });
 await page.goto(control+'/');await page.waitForFunction(()=>window.panelReady);
 await page.getByRole('button',{name:'打开预览',exact:true}).click();
 await page.frameLocator('iframe[title="项目预览"]').getByRole('heading',{name:'Vertical project'}).waitFor({timeout:12000}).catch(error=>{throw Error('Preview chain failed: '+JSON.stringify({responses:responses.map(r=>({url:r.url,status:r.status})),errors})+' '+error.message);});
 const frame=page.frames().find(frame=>/^https:\/\/p-[a-f0-9]{40}\.preview\.example\.test\/$/.test(frame.url()));assert.ok(frame);
 const preview=new URL(frame.url()).origin;
 const cookie=(await context.cookies(preview)).find(c=>c.name===PREVIEW_ACCESS_COOKIE);assert.ok(cookie);
 assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.domain,new URL(preview).hostname);
 assert.equal((await context.cookies(preview)).some(c=>c.name===PREVIEW_NONCE_COOKIE),false);
 assert.equal((await context.cookies(control)).some(c=>c.name===PREVIEW_ACCESS_COOKIE),false);
 assert.equal(await frame.evaluate(()=>document.cookie),'');
 assert.equal(await frame.evaluate(async()=> (await fetch('/api/state')).status),200);
 let diagnostic=await f.diagnostics();assert.equal(diagnostic.starts,1);assert.ok(diagnostic.forwards.length>=2);
 for(const forwarded of diagnostic.forwards){assert.match(forwarded.url,/^http:\/\/localhost:8080\//);assert.equal(forwarded.hasCookie,false);assert.equal(forwarded.hasAuthorization,false);}
 const opensBefore=requests.filter(r=>r.method==='POST'&&r.url===control+`/api/workspaces/${f.scope.workspaceId}/previews`).length;
 assert.equal(opensBefore,1);
 await page.reload();await page.waitForFunction(()=>window.panelReady);
 await page.getByRole('button',{name:'恢复预览',exact:true}).click();
 await page.frameLocator('iframe[title="项目预览"]').getByRole('heading',{name:'Vertical project'}).waitFor({timeout:12000});
 assert.equal(requests.filter(r=>r.method==='POST'&&r.url===control+`/api/workspaces/${f.scope.workspaceId}/previews`).length,opensBefore);
 diagnostic=await f.diagnostics();assert.equal(diagnostic.starts,1);
 const forwardsBefore=diagnostic.forwards.length;await f.revokeSession();
 const recovered=page.frames().find(frame=>frame.url()===preview+'/');assert.ok(recovered);
 assert.equal(await recovered.evaluate(async()=> (await fetch('/api/state')).status),403);
 assert.equal((await f.diagnostics()).forwards.length,forwardsBefore);
 // Unauthenticated context cannot reuse an otherwise valid, registered hostname.
 const denied=await f.mf.dispatchFetch(preview+'/');assert.equal(denied.status,403);await denied.text();
 assert.equal((await f.diagnostics()).forwards.length,forwardsBefore);
 for(const r of requests){assert.equal(r.url.includes(cookie.value),false);if(r.url.startsWith(control))assert.equal((r.headers.cookie??'').includes(cookie.value),false);}
 for(const r of responses)assert.equal(r.body.includes(cookie.value),false);
 assert.deepEqual(errors,[]);
});
