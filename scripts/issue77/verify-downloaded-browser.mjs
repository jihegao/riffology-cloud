// Real production blob Worker + Pyodide. No Worker/HTTP/Python route fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

import {canonicalPreviewJson, previewSha256} from '../../services/browser-preview/contract.ts';
const root = process.cwd();
const out = resolve(process.env.OUTPUT_DIR ?? resolve(root,'.local/issue77-internal-v1/browser'));
const profiles = JSON.parse(await readFile(resolve(root,'services/browser-preview/runtime/assets/profiles.json')));
const staticIndex = JSON.parse(await readFile(resolve(root,'.local/browser-preview/static-index.json')));
const delivery = staticIndex.versions[profiles[0].runtime.assetSha256];
if(!delivery?.frameDocument)throw Error('browser-preview-frame-delivery-missing');
const executionFrames=new Map(staticIndex.assets.filter(a=>a.kind==='frame').map(a=>[a.url,a]));
const fixtures = new Map();
for(const n of [2,3]) fixtures.set(String(n),JSON.parse(await readFile(resolve(root,`.local/issue77-internal-v1/turn-${n}-preview-package.json`))));
const logs = {app:[],execution:[],trap:[],browser:[],console:[]};
const listen = async handler => {const server=createServer(handler);await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));return server;};
const send = (res,body,type='text/javascript',headers={}) => {res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store',...headers});res.end(body);};
const execution = await listen(async(req,res)=>{
  logs.execution.push({url:req.url,cookie:req.headers.cookie??null});
  try {
    const asset=executionFrames.get(req.url);
    if(asset) {
      const csp=`default-src 'none'; script-src 'sha256-${Buffer.from(asset.scriptSha256,'hex').toString('base64')}' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'`;
      return send(res,await readFile(resolve(root,'.local/browser-preview/execution-assets',req.url.slice(1))),'text/html',{'Content-Security-Policy':csp,'Permissions-Policy':'camera=(), microphone=(), geolocation=(), usb=(), storage-access=()'});
    }
    res.writeHead(404);res.end('denied');
  }catch(error){res.writeHead(500);res.end(String(error));}
});
const trap = await listen((req,res)=>{logs.trap.push({url:req.url,cookie:req.headers.cookie??null});res.writeHead(200,{'Access-Control-Allow-Origin':'*'});res.end('trap');});
const executionOrigin = `http://127.0.0.1:${execution.address().port}`, trapOrigin = `http://127.0.0.1:${trap.address().port}`;
const app = await listen(async(req,res)=>{
  logs.app.push({url:req.url});
  try {
    if(req.url==='/') return send(res,`<!doctype html><html><head><meta charset="utf-8"><title>Browser runtime acceptance</title><style>#visual{max-width:600px}.preview-cell{height:20px;text-align:center}.preview-lane{padding:10px}button{padding:12px}</style></head><body><h1>Local preview acceptance</h1><div id="visual"></div><div id="metrics"></div><button id="play">Play</button><button id="pause">Pause</button><button id="step">Step</button><button id="restart">Restart</button><script type="module" src="/acceptance-host.mjs"></script></body></html>`,'text/html',{'Set-Cookie':'app_session=sentinel; Path=/; SameSite=Lax'});
    if(req.url==='/host.bundle.mjs') return send(res,await readFile(resolve(root,'.local/browser-preview/host.bundle.mjs')));
    if(req.url==='/renderer.mjs') return send(res,await readFile(resolve(root,'services/browser-preview/runtime/renderer.mjs')));
    if(req.url==='/protocol.mjs') return send(res,await readFile(resolve(root,'services/browser-preview/runtime/protocol.mjs')));
    if(req.url==='/acceptance-host.mjs') return send(res,`import {BrowserPreviewRuntime} from '/host.bundle.mjs';import {PreviewPlayer} from '/renderer.mjs';window.diagnostics=[];window.player=new PreviewPlayer(document.querySelector('#visual'),document.querySelector('#metrics'));const runtimeOptions={executionOrigin:${JSON.stringify(executionOrigin)},frameUrl:${JSON.stringify(delivery.frameDocument.url)},assetLoader:async profile=>Promise.all(profile.assetManifest.map(async a=>({path:a.path,bytes:new Uint8Array(await(await fetch('/fixed/'+a.path)).arrayBuffer())}))),onStarted:r=>{window.started=r},onDiagnostic:d=>window.diagnostics.push(d)};window.makeRuntime=()=>new BrowserPreviewRuntime(runtimeOptions);window.runtime=makeRuntime();window.loadFixture=async name=>runtime.load(new Uint8Array(await(await fetch('/package/'+name)).arrayBuffer()));window.runFixture=async input=>{window.started=null;const trace=await runtime.run(input);window.trace=trace;player.load(trace,runtime.loaded.visualization);return trace};for(const action of ['play','pause','step','restart'])document.querySelector('#'+action).onclick=()=>player[action]();window.acceptanceReady=true;`);
    if(req.url.startsWith('/package/')){const value=fixtures.get(req.url.slice(9));if(!value)throw Error('missing fixture');return send(res,canonicalPreviewJson(value),'application/json');}
    if(req.url.startsWith('/fixed/')){const path=req.url.slice(7);const allowed=profiles.some(p=>p.assetManifest.some(a=>a.path===path));if(!allowed)throw Error('asset denied');const file=path.startsWith('assets/')?resolve(root,'.local/browser-preview',path):path.startsWith('delivery/')?resolve(root,'.local/browser-preview',path.slice(9)):path.startsWith('source/')?resolve(root,({'contract.ts':'services/browser-preview/contract.ts','model-spec.ts':'services/simulation/model-spec.ts','package-lock.json':'package-lock.json','prepare-assets.mjs':'services/browser-preview/runtime/prepare-assets.mjs'})[path.slice(7)]):resolve(root,'services/browser-preview/runtime',path.slice(8));return send(res,await readFile(file),'application/octet-stream');}
    res.writeHead(404);res.end('denied');
  }catch(error){res.writeHead(500);res.end(String(error));}
});
const appOrigin = `http://localhost:${app.address().port}`;
await mkdir(out,{recursive:true});
let browser; const evidence={environment:'local-browser-actual-downloaded-candidates',productionE2E:false,profiles:profiles.map(p=>p.runtime),cases:[]};
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-proxy-server']});
  const page=await browser.newPage({viewport:{width:1000,height:850}});
  page.on('request',r=>logs.browser.push({url:r.url(),method:r.method()}));page.on('console',m=>logs.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>logs.console.push({type:'pageerror',text:String(e)}));
  await page.goto(appOrigin);await page.waitForFunction(()=>window.acceptanceReady);
  const load=async name=>page.evaluate(name=>loadFixture(name),name);
  const run=async input=>page.evaluate(input=>runFixture(input),input);
  for(const n of [2,3]){
    await load(String(n));
    for(const seed of [1,2,3])for(const service_time of [2,3]){
      const input={parameters:{customers:5,service_time},seed},trace=await run(input);
      const native=JSON.parse(await readFile(resolve(root,`.local/issue77-internal-v1/issue77-native-${n}-${seed}-${service_time}.json`)));
      const expected=JSON.parse(Buffer.from(native.result.result.outputs.find(o=>o.path==='trace.json').data,'base64'));
      assert.deepEqual(trace,expected);
      evidence.cases.push({ordinal:n,seed,service_time,packageIdentity:fixtures.get(String(n)).manifest.packageIdentity,nativeTraceExact:true});
    }
    await page.click('#step');assert.equal(await page.locator('#visual').getAttribute('data-frame'),'1');
    await page.click('#play');await page.waitForTimeout(250);await page.click('#pause');
    const index=await page.locator('#visual').getAttribute('data-frame');await page.waitForTimeout(250);assert.equal(await page.locator('#visual').getAttribute('data-frame'),index);
    await page.click('#restart');assert.equal(await page.locator('#visual').getAttribute('data-frame'),'0');
    await page.screenshot({path:resolve(out,`turn-${n}.png`)});
    await page.reload();await page.waitForFunction(()=>window.acceptanceReady);await load(String(n));
    const restored=await run({parameters:{customers:5,service_time:3},seed:3});assert.equal(restored.snapshots.at(-1).metrics.mean_wait,2);
  }
  assert.deepEqual(logs.trap,[]);assert.equal(logs.app.some(r=>r.url.startsWith('/api/')),false);
  const allowedOrigins=new Set([appOrigin,executionOrigin]);assert.equal(logs.browser.some(r=>/^https?:/.test(r.url)&&!allowedOrigins.has(new URL(r.url).origin)),false);
  evidence.playbackAndRefresh=true;evidence.noRemoteHttp=true;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error?.stack??error);throw error;}finally{
  await writeFile(resolve(out,'acceptance.json'),JSON.stringify(evidence,null,2));await writeFile(resolve(out,'logs.json'),JSON.stringify(logs,null,2));
  await browser?.close();for(const server of[app,execution,trap])await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({passed:evidence.passed,cases:evidence.cases.length,productionE2E:false}));
