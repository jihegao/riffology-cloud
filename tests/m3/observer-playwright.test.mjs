import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {observeWithPlaywright} from '../../services/observer-browser/playwright.mjs';
const pageUrl='https://p-'+ 'a'.repeat(40)+'.preview.example.test/observe';
async function fixture(t){const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome'});t.after(()=>browser.close());return browser;}
const html=text=>new Response(text,{headers:{'content-type':'text/html; charset=utf-8'}});
// Actual Chrome, in-process authorized resource fixture. This is not a native
// container egress proof or a Workspace/Runtime integration test.
test('Chrome observer snapshot clips UTF-8, uses isolated context and strips credentials',{timeout:20000},async t=>{
 const browser=await fixture(t);const user=await browser.newContext();await user.addCookies([{name:'secret',value:'hidden',url:pageUrl}]);
 const requests=[];
 const result=await observeWithPlaywright(browser,{operation:'snapshot',pageUrl,timeoutMs:15000,fetchResource:async req=>{requests.push(req);assert.equal(req.url,pageUrl);return html('<body>'+ '中'.repeat(20000)+'</body>');}});
 assert.equal(result.stopped,true);assert.equal(result.payload.truncated,true);assert.equal(Buffer.byteLength(result.payload.text),32766);assert.ok(!result.payload.text.includes('�'));assert.equal(requests[0].headers.get('cookie'),null);assert.equal(browser.contexts().length,1);assert.equal((await user.cookies())[0].value,'hidden');
});
test('Chrome observer captures viewport PNG, console ceilings and reloads its own page',{timeout:20000},async t=>{
 const browser=await fixture(t);
 const shot=await observeWithPlaywright(browser,{operation:'screenshot',pageUrl,timeoutMs:15000,fetchResource:async()=>html('<h1>Simulation state</h1>')});
 const bytes=Buffer.from(shot.payload.bytes);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1280);assert.equal(bytes.readUInt32BE(20),720);assert.ok(bytes.length<=2*1024*1024);
 const logs=await observeWithPlaywright(browser,{operation:'console',pageUrl,timeoutMs:15000,fetchResource:async()=>html('<script>for(let i=0;i<150;i++)console.log("中".repeat(1000));</script>')});
 assert.ok(logs.payload.entries.length<=100);assert.ok(logs.payload.entries.every(e=>Buffer.byteLength(e.text)<=2048));assert.ok(logs.payload.entries.reduce((n,e)=>n+Buffer.byteLength(e.text),0)<=65536);assert.equal(logs.payload.truncated,true);assert.ok(logs.payload.dropped>0);
 let navigations=0;const reload=await observeWithPlaywright(browser,{operation:'reload',pageUrl,timeoutMs:15000,fetchResource:async()=>{navigations++;return html('<h1>Loaded</h1>');}});assert.equal(reload.payload.reloaded,true);assert.equal(navigations,2);assert.equal(browser.contexts().length,0);
});
test('Chrome observer cancellation aborts a pending resource and closes its context',{timeout:20000},async t=>{
 const browser=await fixture(t),controller=new AbortController();let requested;const started=new Promise(resolve=>requested=resolve);let requestSignal;
 const task=observeWithPlaywright(browser,{operation:'snapshot',pageUrl,signal:controller.signal,timeoutMs:15000,fetchResource:async req=>{requestSignal=req.signal;requested();return new Promise((resolve,reject)=>req.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
 await started;controller.abort();await assert.rejects(task,/observer-cancelled/);assert.equal(requestSignal.aborted,true);assert.equal(browser.contexts().length,0);
});
test('Chrome observer rejects unapproved resources and WebSockets without connecting',{timeout:20000},async t=>{
 const browser=await fixture(t);let rejected=0;
 await assert.rejects(observeWithPlaywright(browser,{operation:'snapshot',pageUrl,timeoutMs:15000,fetchResource:async req=>{if(req.url!==pageUrl){rejected++;throw Error('denied');}return html('<img src="https://other.example.test/image">');}}),/observer-http-denied/);assert.equal(rejected,1);assert.equal(browser.contexts().length,0);
 await assert.rejects(observeWithPlaywright(browser,{operation:'snapshot',pageUrl,timeoutMs:15000,fetchResource:async()=>html('<script>new WebSocket("wss://other.example.test/socket")</script>')}),/observer-http-denied/);assert.equal(browser.contexts().length,0);
});
test('Chrome observer enforces streamed resource budget and timeout',{timeout:20000},async t=>{
 const browser=await fixture(t);
 await assert.rejects(observeWithPlaywright(browser,{operation:'snapshot',pageUrl,timeoutMs:15000,fetchResource:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));}}))}),/observer-resource-limit/);assert.equal(browser.contexts().length,0);
 await assert.rejects(observeWithPlaywright(browser,{operation:'snapshot',pageUrl,timeoutMs:100,fetchResource:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))}),/observer-timeout/);assert.equal(browser.contexts().length,0);
});
test('late context creation after cancellation is reclaimed and cannot navigate',async()=>{
 let resolveContext,closed=0;const pending=new Promise(resolve=>resolveContext=resolve);const controller=new AbortController();
 const task=observeWithPlaywright({newContext:()=>pending},{operation:'snapshot',pageUrl,signal:controller.signal,timeoutMs:15000,fetchResource:async()=>{throw Error('must not fetch');}});
 controller.abort();await assert.rejects(task,/observer-cancelled/);resolveContext({close:async()=>{closed++;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);
});
