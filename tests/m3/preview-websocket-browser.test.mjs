import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
import {createPreviewVerticalFixture} from './preview-vertical-fixture.mjs';
import {PREVIEW_ACCESS_COOKIE} from '../../services/preview/browser.ts';

// Chrome performs real HTTPS requests and WSS upgrades against a loopback TLS
// adapter. The adapter passes HTTP/Upgrade to production Gateway + Workspace in
// Workerd; identity and project Runtime are explicit fixtures. This does not
// prove a cloud TLS ingress or native Sandbox connection.
test('Chrome Preview uses actual WSS, enforces CSP and closes on session revocation',{timeout:45000},async t=>{
 const f=await createPreviewVerticalFixture();t.after(()=>f.dispose());
 const directory=await mkdtemp(join(tmpdir(),'riff-preview-wss-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=preview.example.test'],{stdio:'ignore',timeout:10000});
 const control='https://app.example.test',requests=[],upgrades=[],adapterErrors=[];
 const modules=Object.fromEntries(await Promise.all(['previews.js','i18n.js','i18n-bindings.js'].map(async name=>[name,await readFile(new URL(`../../services/web/${name}`,import.meta.url),'utf8')])));
 const client=`import {createPreviewPanel} from '/previews.js';import {setLocale} from '/i18n.js';setLocale('zh-CN');const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{'content-type':'application/json',...options.headers}});if(!r.ok)throw Object.assign(Error('http-error'),{status:r.status});return r.json();};window.panel=createPreviewPanel({root:document.querySelector('#root'),api});await window.panel.enter(${JSON.stringify({tenantId:f.scope.tenantId,workspaceId:f.scope.workspaceId,canOpen:true})});window.panel.selectRun(${JSON.stringify(f.runId)});window.panelReady=true;`;
 const server=createServer({key:await readFile(join(directory,'key.pem')),cert:await readFile(join(directory,'cert.pem'))},async(req,res)=>{
  try{
   const url=new URL(req.url,'https://'+req.headers.host);requests.push(url.href);
   if(url.origin===control&&!url.pathname.startsWith('/api/')){
    if(url.pathname==='/panel.js'||Object.hasOwn(modules,url.pathname.slice(1))){res.writeHead(200,{'content-type':'application/javascript'});return res.end(url.pathname==='/panel.js'?client:modules[url.pathname.slice(1)]);}
    if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html','content-security-policy':"default-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://*.preview.example.test; frame-ancestors 'none'"});return res.end('<!doctype html><div id="root"></div><script type="module" src="/panel.js"></script>');}
    res.writeHead(404);return res.end();
   }
   if(url.origin!==control&&!/^p-[a-f0-9]{40}\.preview\.example\.test$/.test(url.hostname)){res.writeHead(403);return res.end();}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await f.mf.dispatchFetch(url.href,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const headers=Object.fromEntries(response.headers);delete headers['transfer-encoding'];
   if(response.headers.getSetCookie().length)headers['set-cookie']=response.headers.getSetCookie();
   const body=Buffer.from(await response.arrayBuffer());res.writeHead(response.status,headers);res.end(body);
  }catch(error){adapterErrors.push(String(error));res.writeHead(500);res.end();}
 });
 const peers=new Set();
 const wss=new WebSocketServer({noServer:true,handleProtocols:(offers,req)=>req.selectedProtocol||false});
 server.on('upgrade',async(req,socket,head)=>{
  const url='https://'+req.headers.host+req.url;upgrades.push({url,headers:{...req.headers}});
  try{
   const response=await f.mf.dispatchFetch(url,{headers:req.headers});
   if(response.status!==101||!response.webSocket){await response.arrayBuffer();socket.end(`HTTP/1.1 ${response.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);return;}
   const upstream=response.webSocket;upstream.binaryType='arraybuffer';upstream.accept();req.selectedProtocol=response.headers.get('sec-websocket-protocol');
   wss.handleUpgrade(req,socket,head,downstream=>{
    peers.add(downstream);downstream.on('error',()=>{});
    downstream.on('message',(data,binary)=>{try{upstream.send(binary?new Uint8Array(data).buffer:data.toString());}catch{downstream.close(1011);}});
    downstream.on('close',(code,reason)=>{peers.delete(downstream);try{upstream.close(code===1005||code===1006?1000:code,reason.toString());}catch{}});
    upstream.addEventListener('message',event=>{if(downstream.readyState===1)downstream.send(event.data);});
    upstream.addEventListener('close',event=>{if(downstream.readyState===1)downstream.close(event.code===1005||event.code===1006?1000:event.code,event.reason);});
    upstream.addEventListener('error',()=>downstream.close(1011));
   });
  }catch(error){adapterErrors.push(String(error));socket.destroy();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{for(const peer of peers)peer.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const port=server.address().port;
 const browser=await chromium.launch({headless:true,channel:process.env.M1_BROWSER_CHANNEL||'chrome',args:['--no-proxy-server',`--host-resolver-rules=MAP *.example.test 127.0.0.1:${port}, EXCLUDE localhost`]});t.after(()=>browser.close());
 const context=await browser.newContext({ignoreHTTPSErrors:true});t.after(()=>context.close());const page=await context.newPage();
 await page.goto(control+'/');await page.waitForFunction(()=>window.panelReady);await page.getByRole('button',{name:'打开预览',exact:true}).click();
 await page.frameLocator('iframe[title="项目预览"]').getByRole('heading',{name:'Vertical project'}).waitFor({timeout:12000});
 const frame=page.frames().find(frame=>/^https:\/\/p-[a-f0-9]{40}\.preview\.example\.test\/$/.test(frame.url()));assert.ok(frame);
 const cookie=(await context.cookies(frame.url())).find(c=>c.name===PREVIEW_ACCESS_COOKIE);assert.ok(cookie);assert.equal(cookie.httpOnly,true);
 const result=await frame.evaluate(async()=>{
  window.socketEvents=[];window.socket=new WebSocket(location.origin.replace('https:','wss:')+'/socket?channel=chrome',['fixture.v1','fixture.v2']);socket.binaryType='arraybuffer';
  socket.addEventListener('close',e=>socketEvents.push({type:'close',code:e.code}));
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error('WSS failed'));});
  const next=()=>new Promise(resolve=>socket.addEventListener('message',e=>resolve(e.data),{once:true}));
  let echo=next();socket.send('chrome hello');const text=await echo;echo=next();socket.send(new Uint8Array([0,1,254,255]));const binary=Array.from(new Uint8Array(await echo));
  return {text,binary,protocol:socket.protocol};
 });
 assert.deepEqual(result,{text:'chrome hello',binary:[0,1,254,255],protocol:'fixture.v1'});
 assert.equal(upgrades.length,1);assert.equal(upgrades[0].headers.origin,new URL(frame.url()).origin);assert.ok(upgrades[0].headers.cookie.includes(PREVIEW_ACCESS_COOKIE+'='+cookie.value));assert.equal(upgrades[0].headers['sec-websocket-version'],'13');assert.ok(upgrades[0].headers['sec-websocket-key']);
 // This destination resolves to the same local adapter, so a missing CSP would
 // be visible as a second real upgrade. SecurityPolicyViolation is affirmative
 // evidence of browser policy rejection, independent of a network failure.
 const blocked=await frame.evaluate(()=>new Promise(resolve=>{
  document.addEventListener('securitypolicyviolation',e=>resolve({directive:e.effectiveDirective,uri:e.blockedURI}),{once:true});
  window.forbiddenSocket=new WebSocket('wss://forbidden.example.test/socket');
 }));
 assert.equal(blocked.directive,'connect-src');assert.equal(blocked.uri,'wss://forbidden.example.test/socket');assert.equal(upgrades.length,1);
 const diagnostic=await f.diagnostics();assert.equal(diagnostic.starts,1);assert.equal(diagnostic.wsMessages,2);assert.equal(diagnostic.wsForwards.length,1);assert.equal(diagnostic.wsForwards[0].headers.cookie,undefined);assert.equal(diagnostic.wsForwards[0].headers.origin,'http://localhost:8080');
 await f.revokeSession();await frame.waitForFunction(()=>socketEvents.some(e=>e.type==='close'&&e.code===1008),null,{timeout:5000});
 assert.equal(await frame.evaluate(()=>socket.readyState),3);assert.equal((await f.diagnostics()).wsMessages,2);assert.deepEqual(adapterErrors,[]);
});
