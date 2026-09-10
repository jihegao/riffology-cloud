import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// The Sandbox below models only the private RPC transport. Native process,
// filesystem and descendant fencing proofs belong to the Docker evidence suite.
test('ServiceRuntime Workerd wiring checks dispatched leases and preserves stop across restart and gate closure, including private Observer transport',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-runtime-'));
 const runtimeImage='registry.example/service@sha256:'+'f'.repeat(64);
 const entry=`
 import {DurableObject,RpcTarget} from 'cloudflare:workers';
 import {forwardRunningObserver} from './services/run/observer-forward.ts';
 class CancellationFixture extends RpcTarget {constructor(sandbox){super();this.sandbox=sandbox;}async cancelled(){return this.sandbox.upstreamCancelled();}}
 import {ServiceRuntime as BaseServiceRuntime,serviceSandboxActorName} from './services/run/runtime-durable.ts';
 import {serviceRuntimeActorName} from './services/run/durable.ts';
 import {leaseReference} from './services/quota/core.ts';
 import {privateWebSocketRequest,readPrivateWebSocketRequest} from './services/preview/websocket-protocol.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 export class ServiceRuntime extends BaseServiceRuntime {async wakeRelease(){await this.alarm();}}
 export {TenantQuota} from './services/quota/durable.ts';
 export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 export class SandboxFixture extends DurableObject {
  async fetch(request){const incoming=readPrivateWebSocketRequest(request,'sandbox');const pair=new WebSocketPair();pair[1].binaryType='arraybuffer';pair[1].accept();pair[1].addEventListener('message',e=>pair[1].send(e.data));return new Response(null,{status:101,webSocket:pair[0],headers:incoming.request.headers.has('sec-websocket-protocol')?{'sec-websocket-protocol':'fixture'}:{}});}
  releaseHeader=null;
  async releaseHeaders(){this.releaseHeader?.();this.releaseHeader=null;}
  observerBodyCancelled=false;
  cancelledByCaller=false;
  async upstreamCancelled(){return this.cancelledByCaller;}
  async cancelUpstream(){this.cancelledByCaller=true;}
  async observerDiagnostics(){return {calls:await this.ctx.storage.get('observer-forwards')??[],cancelled:this.observerBodyCancelled};}
  async holdObserver(){await this.ctx.storage.put('observer-hold',true);}
  async forwardObserverHttp(request,policy,deadlineAt,cancellation){
   const calls=await this.ctx.storage.get('observer-forwards')??[];calls.push({url:request.url,method:request.method,headers:Object.fromEntries(request.headers),policy,deadlineAt});await this.ctx.storage.put('observer-forwards',calls);
   const hold=await this.ctx.storage.get('observer-hold');
   const fetch=async()=>new Response(hold?new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('partial-secret'));},cancel:()=>{this.observerBodyCancelled=true;}}):'observer-response',{headers:{'content-type':'text/html','set-cookie':'must-not-escape'}});
   return forwardRunningObserver({running:true,getTcpPort(port){if(port!==8080)throw Error('wrong-port');return {fetch};}},request,policy,deadlineAt,cancellation);
  }
  async forwards(){return await this.ctx.storage.get('forwards')??[];}
  async forwardHttp(request){const calls=await this.forwards();const entry={url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()};calls.push(entry);await this.ctx.storage.put('forwards',calls);if(new URL(request.url).pathname==='/hold-headers')await new Promise(resolve=>{this.releaseHeader=resolve;});return new Response('fixture-response:'+entry.body,{status:201,headers:{'content-type':'text/plain'}});}

  async writeFile(path,content){await this.ctx.storage.put('file:'+path,content);if(path.endsWith('.input.json'))await this.ctx.storage.put('control',{path,content});}
  async diagnostics(){return {commands:await this.ctx.storage.get('commands')??[],control:await this.ctx.storage.get('control')??null};}
  async destroy(){await this.ctx.storage.put('destroy-count',(await this.ctx.storage.get('destroy-count')??0)+1);await this.ctx.storage.put('container-running',false);}
  async destroyCount(){return await this.ctx.storage.get('destroy-count')??0;}
  async releaseState(){return {running:await this.ctx.storage.get('container-running')===true};}
  async lateStart(){await this.ctx.storage.put('container-running',true);}
  async exec(command,options){
   const commands=await this.ctx.storage.get('commands')??[];commands.push({command,options});await this.ctx.storage.put('commands',commands);
   const parts=command.split(' '),token=parts[1]==='/opt/riffology/service_upload.py'?parts[2]:parts.at(-1);let result;
   if(parts[1]==='/opt/riffology/service_upload.py'){
    if(parts[3]!=='<'||parts.length!==5)throw Error('unexpected-upload-transport');
    const upload=JSON.parse(await this.ctx.storage.get('file:'+parts[4]));const bytes=atob(upload.data).length;
    commands[commands.length-1].upload=upload;await this.ctx.storage.put('commands',commands);
    if(parts[4]!=='/var/lib/riffology/archives/'+token+'.'+upload.offset+'.chunk.json')throw Error('unexpected-upload-path');
    result={schemaVersion:1,token,offset:upload.offset,bytes,total:upload.total,complete:upload.offset+bytes===upload.total};
   }else{
    if(parts[1]!=='/opt/riffology/service_process.py')throw Error('unexpected-native-program');
    const action=parts[2];let stop=await this.ctx.storage.get('stop');
    if(action==='stop'&&!stop){stop={confirmationId:'fixture-stop',observedAt:Date.now(),fenced:true};await this.ctx.storage.put('stop',stop);}
    if(action==='start'&&!stop){await this.ctx.storage.put('started',true);await this.ctx.storage.put('container-running',true);}
    result={schemaVersion:1,token,status:stop?'stopped':await this.ctx.storage.get('started')?'healthy':'absent',stop:stop??null};
   }
   return {success:true,exitCode:0,stdout:JSON.stringify(result)};
  }
 }
 export default {async fetch(req,env){
  if(new URL(req.url).pathname==='/ws'){const input=JSON.parse(req.headers.get('x-test-input'));return env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(input)).fetch(privateWebSocketRequest('runtime',input,req));}
  if(req.method!=='POST')return new Response(null,{status:404});
  try{
   const b=await req.json();let value;
   if(b.method==='seed'){
    const identity=b.identity,encode=s=>new TextEncoder().encode(s),filesArchive=initialWorkspaceArchive({
     'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/healthz',observation:{pagePath:'/observe',statePath:'/state'}})),
     'app/main.py':encode('print(1)'), 'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:{}}))});
    const store=env.REVISION_STORE.getByName('workspace-revisions-v1');
    const receipt=await store.commit({identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null},snapshot:{identity,filesArchive,piSession:encode('private-pi-session')}});
    value=await store.previewPlan({kind:'saved-turn',identity,revision:receipt});
   }else if(b.method==='acquire'){
    const result=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.request.tenantId).acquire(b.request);
    if(!result.lease)throw Error('fixture-acquire-denied');value=leaseReference(result.lease);
   }else if(b.method==='dispatch')value=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.lease.tenantId).dispatch(b.lease);
   else if(b.method==='forward'){const request=new Request(b.request?.url??'https://public.example/test?q=1',{method:b.request?.method??'POST',headers:b.request?.headers??{'cookie':'private-cookie','authorization':'Bearer private-auth','content-type':'text/plain','x-private':'secret'},body:b.request?.body??'fixture-body'});const response=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).forwardHttp(b.input,request);value={status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)};}
   else if(b.method==='observer'){
    const descriptor={purpose:'observer',runtime:b.input,policy:b.policy,deadlineAt:b.deadlineAt};
    const response=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).forwardObserverHttp(descriptor,new Request(b.url??'http://localhost:8080/observe',{headers:{cookie:'secret','x-riff-observer':'forged'}}),new CancellationFixture(env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input))));
    value={status:response.status,body:await response.text(),headers:Object.fromEntries(response.headers)};
   }else if(b.method==='quotaUnknown')value=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.lease.tenantId).markUnknown(b.lease);
   else if(['observerDiagnostics','holdObserver','cancelUpstream'].includes(b.method))value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input))[b.method]();
   else if(b.method==='releaseHeaders')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).releaseHeaders();
   else if(b.method==='forwards')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).forwards();
   else if(b.method==='diagnostics')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).diagnostics();
   else if(b.method==='destroyCount')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).destroyCount();
   else if(b.method==='lateStart')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).lateStart();
   else if(b.method==='wakeRelease')value=await env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(b.input)).wakeRelease();
   else if(['start','observe','stop'].includes(b.method))value=await env.SERVICE_RUNTIME.getByName(b.name??await serviceRuntimeActorName(b.input))[b.method](b.input);
   else return new Response(null,{status:404});
   return Response.json({ok:true,value});
  }catch(e){return Response.json({ok:false,error:e.message});}
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'service-runtime-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const worker='service-runtime-test';
 const options=(enabled,previewEnabled='true',observerEnabled='false')=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{
  M3_OBSERVER_ENABLED:{type:'text',value:observerEnabled},M3_PREVIEW_WS_ENABLED:{type:'text',value:'true'},M3_PREVIEW_ENABLED:{type:'text',value:previewEnabled},M3_SERVICE_ENABLED:{type:'text',value:enabled},M3_SERVICE_IMAGE:{type:'text',value:runtimeImage},TENANT_QUOTA_CAPACITY:{type:'text',value:'8'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'test-v1'},
  SERVICE_RUNTIME:{type:'durable-object',worker,exportName:'ServiceRuntime'},SERVICE_SANDBOX:{type:'durable-object',worker,exportName:'SandboxFixture'},TENANT_QUOTA:{type:'durable-object',worker,exportName:'TenantQuota'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'m3-runtime-revisions'}
 },exports:{ServiceRuntime:{type:'durable-object',storage:'sqlite'},SandboxFixture:{type:'durable-object',storage:'sqlite'},TenantQuota:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 let mf;
 const call=async(method,body={})=>{const response=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,...body})});assert.equal(response.status,200);const r=await response.json();if(!r.ok)throw Error(r.error);return r.value;};
 try{
  mf=new Miniflare(options('true'));
  const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
  const identity={scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'turn-dispatch',generation:1};
  const plan=await call('seed',{identity});
  const make=async id=>{
   const deadlineAt=Date.now()+120000,request={tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:'dispatch-'+id,runId:'run-'+id,deadlineAt};
   const lease=await call('acquire',{request});
   return {scope,spec:{plan,runtimeImage,maxDurationMs:120000},lease,reference:{runId:request.runId,runtimeId:'runtime-'+id,dispatchId:request.operationId,leaseId:lease.leaseId,generation:1,deadlineAt}};
  };
  const socket=input=>mf.dispatchFetch('http://test/ws',{headers:{upgrade:'websocket','x-test-input':JSON.stringify(input),'sec-websocket-protocol':'fixture'}});
  const input=await make('a');
  await assert.rejects(call('start',{input}),/lease-denied/);
  assert.deepEqual(await call('diagnostics',{input}),{commands:[],control:null});
  await assert.rejects(call('start',{input,name:'wrong-actor'}),/actor-scope-denied/);
  await assert.rejects(call('start',{input:{...input,lease:{...input.lease,runId:'other-run'}}}),/scope-denied/);
  const missing={...input,lease:{...input.lease,operationId:'missing'},reference:{...input.reference,dispatchId:'missing'}};
  await assert.rejects(call('start',{input:missing}),/lease-denied/);assert.deepEqual(await call('diagnostics',{input:missing}),{commands:[],control:null});
  await call('dispatch',{lease:input.lease});
  const unstartedSocket=await socket(input);assert.equal(unstartedSocket.status,403);await unstartedSocket.text();
  await assert.rejects(call('forward',{input}),/forward-denied/);assert.deepEqual(await call('forwards',{input}),[]);
  const wrongLease={...input,lease:{...input.lease,leaseId:'incorrect'},reference:{...input.reference,leaseId:'incorrect'}};
  await assert.rejects(call('start',{input:wrongLease}),/lease-denied/);
  assert.deepEqual(await call('diagnostics',{input:wrongLease}),{commands:[],control:null});await assert.rejects(call('forward',{input:wrongLease}),/lease-denied/);assert.deepEqual(await call('forwards',{input:wrongLease}),[]);
  const wrongImage={...input,spec:{...input.spec,runtimeImage:'registry.example/other@sha256:'+'e'.repeat(64)}};
  await assert.rejects(call('start',{input:wrongImage}),/start-disabled/);
  assert.deepEqual(await call('diagnostics',{input:wrongImage}),{commands:[],control:null});
  assert.equal((await call('start',{input})).status,'healthy');
  const forwarded=await call('forward',{input});assert.equal(forwarded.status,201);assert.equal(forwarded.body,'fixture-response:fixture-body');assert.deepEqual(await call('forwards',{input}),[{url:'http://localhost:8080/test?q=1',method:'POST',headers:{'content-type':'text/plain'},body:'fixture-body'}]);
  await mf.dispose();mf=new Miniflare(options('true','false'));await assert.rejects(call('forward',{input}),/forward-disabled/);assert.equal((await call('forwards',{input})).length,1);await mf.dispose();mf=new Miniflare(options('true'));
  const observerPolicy={origin:'https://p-'+'a'.repeat(40)+'.riff-demo.gaojihe.cn',pagePath:'/observe',statePath:'/state'};
  const observe=(target=input,extra={})=>call('observer',{input:target,policy:observerPolicy,deadlineAt:Date.now()+5000,...extra});
  await assert.rejects(observe(),/observer-runtime-disabled/);
  assert.deepEqual(await call('observerDiagnostics',{input}),{calls:[],cancelled:false});
  await mf.dispose();mf=new Miniflare(options('true','true','true'));
  const observation=await observe();assert.equal(observation.body,'observer-response');assert.equal(observation.headers['set-cookie'],undefined);
  let observerDiagnostic=await call('observerDiagnostics',{input});assert.equal(observerDiagnostic.calls.length,1);assert.equal(observerDiagnostic.calls[0].url,'http://localhost:8080/observe');assert.equal(observerDiagnostic.calls[0].headers['x-riff-observer'],'read-only');assert.equal(observerDiagnostic.calls[0].headers.cookie,undefined);assert.deepEqual(observerDiagnostic.calls[0].policy,observerPolicy);
  assert.equal((await call('forwards',{input})).length,1,'Observer must not use ordinary forwardHttp');
  await assert.rejects(observe(input,{policy:{...observerPolicy,pagePath:'/other'}}),/observer-runtime-denied/);
  await assert.rejects(observe(input,{deadlineAt:Date.now()-1}),/observer-runtime-denied/);
  await assert.rejects(observe(input,{url:'http://localhost:8080/other'}),/observer-runtime-denied/);
  assert.equal((await call('observerDiagnostics',{input})).calls.length,1);
  const revoked=await make('observer-revoked');await call('dispatch',{lease:revoked.lease});await call('start',{input:revoked});await call('quotaUnknown',{lease:revoked.lease});
  await assert.rejects(observe(revoked),/observer-runtime-lease-denied/);assert.equal((await call('observerDiagnostics',{input:revoked})).calls.length,0);
  const heldObserver=await make('observer-held');await call('dispatch',{lease:heldObserver.lease});await call('start',{input:heldObserver});await call('holdObserver',{input:heldObserver});
  const observerWaiting=observe(heldObserver),observerRejected=assert.rejects(observerWaiting,/observer-cancelled/);
  const observerUntil=Date.now()+3000;while((await call('observerDiagnostics',{input:heldObserver})).calls.length===0&&Date.now()<observerUntil)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await call('observerDiagnostics',{input:heldObserver})).calls.length,1);
  assert.equal((await call('stop',{input:heldObserver})).status,'stopped');await observerRejected;
  const cancelUntil=Date.now()+3000;while(!(await call('observerDiagnostics',{input:heldObserver})).cancelled&&Date.now()<cancelUntil)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await call('observerDiagnostics',{input:heldObserver})).cancelled,true);
  await assert.rejects(observe(heldObserver),/observer-http-failed/);assert.equal((await call('observerDiagnostics',{input:heldObserver})).calls.length,1);
  const cancelledObserver=await make('observer-cancelled');await call('dispatch',{lease:cancelledObserver.lease});await call('start',{input:cancelledObserver});await call('holdObserver',{input:cancelledObserver});
  const cancellationWaiting=observe(cancelledObserver),cancellationRejected=assert.rejects(cancellationWaiting,/observer-http-failed|observer-forward-expired/);
  const cancellationUntil=Date.now()+3000;while((await call('observerDiagnostics',{input:cancelledObserver})).calls.length===0&&Date.now()<cancellationUntil)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await call('observerDiagnostics',{input:cancelledObserver})).calls.length,1);
  await call('cancelUpstream',{input:cancelledObserver});await cancellationRejected;
  assert.equal((await call('observerDiagnostics',{input:cancelledObserver})).cancelled,true,'RPC cancellation must reach final native-port body');
  assert.equal((await call('observe',{input:cancelledObserver})).status,'healthy','caller cancellation does not stop the project service');
  const revokedWhileReading=await make('observer-live-revocation');await call('dispatch',{lease:revokedWhileReading.lease});await call('start',{input:revokedWhileReading});await call('holdObserver',{input:revokedWhileReading});
  // Keep the command deadline well beyond this assertion: a timeout alone
  // must not masquerade as lease-revocation propagation during a stalled read.
  const liveRevocationWaiting=observe(revokedWhileReading,{deadlineAt:Date.now()+14000});
  const liveRevocationRejected=assert.rejects(liveRevocationWaiting,/observer-http-failed|observer-forward-expired|observer-runtime-lease-denied/);
  const liveRevocationUntil=Date.now()+3000;while((await call('observerDiagnostics',{input:revokedWhileReading})).calls.length===0&&Date.now()<liveRevocationUntil)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await call('observerDiagnostics',{input:revokedWhileReading})).calls.length,1);
  const revokedAt=Date.now();await call('quotaUnknown',{lease:revokedWhileReading.lease});
  let revocationTimer;try{await Promise.race([liveRevocationRejected,new Promise((_,reject)=>{revocationTimer=setTimeout(()=>reject(Error('lease-revocation-not-propagated-within-five-seconds')),5000);})]);}finally{clearTimeout(revocationTimer);}
  assert.ok(Date.now()-revokedAt<5000,'revocation must interrupt the read before the 14-second command deadline');
  assert.equal((await call('observerDiagnostics',{input:revokedWhileReading})).cancelled,true,'lease revocation cancels the final native-port body');
  assert.equal((await call('observe',{input:revokedWhileReading})).status,'healthy','quota revocation does not claim the service has stopped');
  await mf.dispose();mf=new Miniflare(options('true'));
  const diagnostic=await call('diagnostics',{input});
  assert.equal(diagnostic.commands.filter(c=>c.command.includes('service_upload.py')).length,1);
  assert.equal(diagnostic.commands.filter(c=>c.command.includes('service_process.py start')).length,1);
  const upload=diagnostic.commands.find(c=>c.upload).upload,archive=Buffer.from(upload.data,'base64');
  const archiveHash=Buffer.from(await crypto.subtle.digest('SHA-256',archive)).toString('hex');
  assert.equal(archiveHash,plan.source.revision.filesSha256);assert.equal(archive.includes(Buffer.from('private-pi-session')),false);
  assert.equal(JSON.parse(diagnostic.control.content).filesSha256,plan.source.revision.filesSha256);
  for(const command of diagnostic.commands){assert.equal(Object.hasOwn(command.options,'stdin'),false);assert.equal(command.options.cwd,'/var/lib/riffology');assert.deepEqual(command.options.env,{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'});}
  assert.equal((await call('start',{input})).status,'healthy');
  await mf.dispose();mf=new Miniflare(options('true'));
  assert.equal((await call('start',{input})).status,'healthy');
  assert.equal((await call('diagnostics',{input})).commands.filter(c=>c.command.includes('service_process.py start')).length,1);
  const held=await make('headers');await call('dispatch',{lease:held.lease});await call('start',{input:held});
  const waiting=call('forward',{input:held,request:{url:'https://public.example/hold-headers'}});const rejected=assert.rejects(waiting,/forward-aborted/);
  const headerDeadline=Date.now()+3000;while((await call('forwards',{input:held})).length===0&&Date.now()<headerDeadline)await new Promise(resolve=>setTimeout(resolve,20));assert.equal((await call('forwards',{input:held})).length,1);
  assert.equal((await call('stop',{input:held})).status,'stopped');await rejected;await call('releaseHeaders',{input:held});
  await assert.rejects(call('forward',{input:held}),/forward-denied/);assert.equal((await call('forwards',{input:held})).length,1);
  const before=await make('b');await call('dispatch',{lease:before.lease});
  const stoppedBefore=await call('stop',{input:before});assert.equal(stoppedBefore.status,'stopped');
  assert.deepEqual(await call('start',{input:before}),stoppedBefore);
  const fenced=await call('diagnostics',{input:before});assert.equal(fenced.control,null);assert.equal(fenced.commands.length,1);assert.match(fenced.commands[0].command,/service_process.py stop/);
  await mf.dispose();mf=new Miniflare(options('false'));
  await assert.rejects(call('start',{input}),/start-disabled/);
  assert.equal((await call('observe',{input})).status,'healthy');
  const sockets=[];for(let i=0;i<8;i++){const r=await socket(input);assert.equal(r.status,101);assert.equal(r.headers.get('sec-websocket-protocol'),'fixture');r.webSocket.accept();sockets.push(r.webSocket);}
  const capacity=await socket(input);assert.equal(capacity.status,403);await capacity.text();
  const message=new Promise(resolve=>sockets[0].addEventListener('message',event=>resolve(event.data),{once:true}));sockets[0].send('runtime-ws');assert.equal(await message,'runtime-ws');
  const closed=Promise.all(sockets.map(ws=>new Promise(resolve=>ws.addEventListener('close',resolve,{once:true}))));
  const stopped=await call('stop',{input});assert.equal(stopped.status,'stopped');await assert.rejects(call('forward',{input}),/forward-denied/);assert.equal((await call('forwards',{input})).length,1);assert.equal(stopped.stop.fenced,true);await closed;const stoppedSocket=await socket(input);assert.equal(stoppedSocket.status,403);await stoppedSocket.text();
  assert.equal(await call('destroyCount',{input}),1);await call('lateStart',{input});await call('wakeRelease',{input});assert.equal(await call('destroyCount',{input}),2,'persistent release alarm destroys a late assignment');
  assert.deepEqual(await call('stop',{input}),stopped);assert.equal(await call('destroyCount',{input}),3);assert.deepEqual(await call('observe',{input}),stopped);
  assert.equal((await mf.dispatchFetch('http://test/')).status,404);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
