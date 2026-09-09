import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {previewBrowser,PREVIEW_ACCESS_COOKIE,PREVIEW_NONCE_COOKIE} from '../../services/preview/browser.ts';
const control='https://app.example.test',preview='https://p.preview.example.test',ticket='41'.repeat(32),access='73'.repeat(32);
test('real Chrome iframe bootstrap exchanges ticket into host-only HttpOnly cookie without credential URL/body exposure',{timeout:20000},async t=>{
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 const errors=[],requests=[],responses=[],exchanges=[],consoleMessages=[];page.on('console',message=>consoleMessages.push(message.text()));page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const incoming=route.request(),url=new URL(incoming.url()),headers=await incoming.allHeaders();requests.push({url:incoming.url(),headers});
  if(url.origin===control){return route.fulfill({contentType:'text/html; charset=utf-8',body:url.pathname==='/helper'?'<p>control sibling</p>':`<!doctype html><script>window.ready=null;addEventListener('message',e=>{if(e.origin===${JSON.stringify(preview)}&&e.source===document.querySelector('#preview')?.contentWindow&&e.data?.type==='riffology-preview-ready')window.ready=e.data;});</script><iframe id="preview" src="${preview}/__riff/bootstrap"></iframe><iframe id="helper" src="/helper"></iframe>`});}
  assert.equal(url.origin,preview,'fixture blocks all unrelated outbound URLs');
  const response=await previewBrowser(new Request(incoming.url(),{method:incoming.method(),headers,body:incoming.method()==='POST'?incoming.postData():undefined}),{controlOrigin:control,previewOrigin:preview},{async exchange(received,nonce){exchanges.push({ticket:received,nonce});return {access,expiresAt:Date.now()+120000};}});
  if(response){const text=await response.text();responses.push({url:incoming.url(),text,headers:response.headers});const outgoing=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)outgoing['set-cookie']=cookies.join('\n');return route.fulfill({status:response.status,headers:outgoing,body:text});}
  return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><h1>项目预览已连接</h1><script>window.visibleCookies=document.cookie;</script>'});
 });
 await page.goto(control+'/');await page.waitForFunction(()=>Boolean(window.ready),null,{timeout:3000}).catch(error=>{throw Error('ready failed '+JSON.stringify({errors,requests:requests.map(r=>r.url),responses:responses.map(r=>({url:r.url,text:r.text}))})+' '+error.message);});
 const ready=await page.evaluate(()=>window.ready);assert.match(ready.nonce,/^[a-f0-9]{64}$/);
 const before=await context.cookies(preview);assert.equal(before.filter(c=>c.name===PREVIEW_NONCE_COOKIE).length,1);assert.equal(before.find(c=>c.name===PREVIEW_NONCE_COOKIE).value,ready.nonce);
 // A same-control-origin sibling has the right origin but the wrong source.
 const sibling=page.frames().find(f=>f.url()===control+'/helper');assert.ok(sibling);await sibling.evaluate(({preview,ticket})=>parent.document.querySelector('#preview').contentWindow.postMessage({type:'riffology-preview-ticket',ticket},preview),{preview,ticket});
 // Self-post has the wrong origin even though the message shape is valid.
 const bootstrap=page.frames().find(f=>f.url()===preview+'/__riff/bootstrap');assert.ok(bootstrap);await bootstrap.evaluate(ticket=>window.postMessage({type:'riffology-preview-ticket',ticket},location.origin),ticket);
 await page.waitForTimeout(100);assert.equal(exchanges.length,0);
 await page.evaluate(({preview,ticket})=>document.querySelector('#preview').contentWindow.postMessage({type:'riffology-preview-ticket',ticket},preview),{preview,ticket});
 await page.frameLocator('#preview').getByRole('heading',{name:'项目预览已连接'}).waitFor({timeout:3000}).catch(error=>{throw Error('exchange failed '+JSON.stringify({consoleMessages,requests:requests.map(r=>r.url),errors,exchanges,responses:responses.map(r=>({url:r.url,text:r.text}))})+' '+error.message);});assert.equal(exchanges.length,1);assert.deepEqual(exchanges[0],{ticket,nonce:ready.nonce});
 const cookies=await context.cookies(preview),credential=cookies.find(c=>c.name===PREVIEW_ACCESS_COOKIE);assert.ok(credential);assert.equal(credential.value,access);assert.equal(credential.domain,'p.preview.example.test');assert.equal(credential.path,'/');assert.equal(credential.secure,true);assert.equal(credential.httpOnly,true);assert.equal(credential.sameSite,'Strict');assert.equal(cookies.some(c=>c.name===PREVIEW_NONCE_COOKIE),false);
 assert.equal((await context.cookies(control)).some(c=>c.name===PREVIEW_ACCESS_COOKIE),false);assert.equal((await context.cookies('https://other.preview.example.test')).some(c=>c.name===PREVIEW_ACCESS_COOKIE),false);
 const frame=page.frames().find(f=>f.url()===preview+'/');assert.ok(frame);assert.equal(await frame.evaluate(()=>window.visibleCookies),'');
 for(const response of responses){assert.equal(response.text.includes(access),false);assert.equal(response.text.includes(ticket),false);for(const header of response.headers.getSetCookie())assert.doesNotMatch(header,/;\s*Domain=/i);}
 assert.equal(responses.find(r=>r.url.endsWith('/__riff/exchange')).text,'{"ok":true}');for(const request of requests){assert.equal(request.url.includes(access),false);assert.equal(request.url.includes(ticket),false);if(request.url.startsWith(control))assert.equal((request.headers.cookie??'').includes(access),false);}
 assert.deepEqual(errors,[]);
});
