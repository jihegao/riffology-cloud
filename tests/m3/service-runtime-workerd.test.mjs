import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// The Sandbox below models only the private RPC transport. Native process,
// filesystem and descendant fencing proofs belong to the Docker evidence suite.
test('ServiceRuntime Workerd wiring checks dispatched leases and preserves stop across restart and gate closure',{timeout:30000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'m3-runtime-'));
 const runtimeImage='registry.example/service@sha256:'+'f'.repeat(64);
 const entry=`
 import {DurableObject} from 'cloudflare:workers';
 import {ServiceRuntime,serviceSandboxActorName} from './services/run/runtime-durable.ts';
 import {serviceRuntimeActorName} from './services/run/durable.ts';
 import {leaseReference} from './services/quota/core.ts';
 import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
 export {ServiceRuntime};
 export {TenantQuota} from './services/quota/durable.ts';
 export {RevisionStore} from './services/turn-runtime/revision-store.ts';
 export class SandboxFixture extends DurableObject {
  async writeFile(path,content){await this.ctx.storage.put('file:'+path,content);if(path.endsWith('.input.json'))await this.ctx.storage.put('control',{path,content});}
  async diagnostics(){return {commands:await this.ctx.storage.get('commands')??[],control:await this.ctx.storage.get('control')??null};}
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
    if(action==='start'&&!stop)await this.ctx.storage.put('started',true);
    result={schemaVersion:1,token,status:stop?'stopped':await this.ctx.storage.get('started')?'healthy':'absent',stop:stop??null};
   }
   return {success:true,exitCode:0,stdout:JSON.stringify(result)};
  }
 }
 export default {async fetch(req,env){
  if(req.method!=='POST')return new Response(null,{status:404});
  try{
   const b=await req.json();let value;
   if(b.method==='seed'){
    const identity=b.identity,encode=s=>new TextEncoder().encode(s),filesArchive=initialWorkspaceArchive({
     'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/main.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/healthz'})),
     'app/main.py':encode('print(1)'), 'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages:{}}))});
    const store=env.REVISION_STORE.getByName('workspace-revisions-v1');
    const receipt=await store.commit({identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null},snapshot:{identity,filesArchive,piSession:encode('private-pi-session')}});
    value=await store.previewPlan(identity,receipt);
   }else if(b.method==='acquire'){
    const result=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.request.tenantId).acquire(b.request);
    if(!result.lease)throw Error('fixture-acquire-denied');value=leaseReference(result.lease);
   }else if(b.method==='dispatch')value=await env.TENANT_QUOTA.getByName('tenant-quota:'+b.lease.tenantId).dispatch(b.lease);
   else if(b.method==='diagnostics')value=await env.SERVICE_SANDBOX.getByName(await serviceSandboxActorName(b.input)).diagnostics();
   else if(['start','observe','stop'].includes(b.method))value=await env.SERVICE_RUNTIME.getByName(b.name??await serviceRuntimeActorName(b.input))[b.method](b.input);
   else return new Response(null,{status:404});
   return Response.json({ok:true,value});
  }catch(e){return Response.json({ok:false,error:e.message});}
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'service-runtime-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const worker='service-runtime-test';
 const options=enabled=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{
  M3_SERVICE_ENABLED:{type:'text',value:enabled},M3_SERVICE_IMAGE:{type:'text',value:runtimeImage},TENANT_QUOTA_CAPACITY:{type:'text',value:'8'},TENANT_QUOTA_POLICY_VERSION:{type:'text',value:'test-v1'},
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
  const input=await make('a');
  await assert.rejects(call('start',{input}),/lease-denied/);
  assert.deepEqual(await call('diagnostics',{input}),{commands:[],control:null});
  await assert.rejects(call('start',{input,name:'wrong-actor'}),/actor-scope-denied/);
  await assert.rejects(call('start',{input:{...input,lease:{...input.lease,runId:'other-run'}}}),/scope-denied/);
  const missing={...input,lease:{...input.lease,operationId:'missing'},reference:{...input.reference,dispatchId:'missing'}};
  await assert.rejects(call('start',{input:missing}),/lease-denied/);assert.deepEqual(await call('diagnostics',{input:missing}),{commands:[],control:null});
  await call('dispatch',{lease:input.lease});
  const wrongLease={...input,lease:{...input.lease,leaseId:'incorrect'},reference:{...input.reference,leaseId:'incorrect'}};
  await assert.rejects(call('start',{input:wrongLease}),/lease-denied/);
  assert.deepEqual(await call('diagnostics',{input:wrongLease}),{commands:[],control:null});
  const wrongImage={...input,spec:{...input.spec,runtimeImage:'registry.example/other@sha256:'+'e'.repeat(64)}};
  await assert.rejects(call('start',{input:wrongImage}),/start-disabled/);
  assert.deepEqual(await call('diagnostics',{input:wrongImage}),{commands:[],control:null});
  assert.equal((await call('start',{input})).status,'healthy');
  const diagnostic=await call('diagnostics',{input});
  assert.equal(diagnostic.commands.filter(c=>c.command.includes('service_upload.py')).length,1);
  assert.equal(diagnostic.commands.filter(c=>c.command.includes('service_process.py start')).length,1);
  const upload=diagnostic.commands.find(c=>c.upload).upload,archive=Buffer.from(upload.data,'base64');
  const archiveHash=Buffer.from(await crypto.subtle.digest('SHA-256',archive)).toString('hex');
  assert.equal(archiveHash,plan.revision.filesSha256);assert.equal(archive.includes(Buffer.from('private-pi-session')),false);
  assert.equal(JSON.parse(diagnostic.control.content).filesSha256,plan.revision.filesSha256);
  for(const command of diagnostic.commands){assert.equal(Object.hasOwn(command.options,'stdin'),false);assert.equal(command.options.cwd,'/var/lib/riffology');assert.deepEqual(command.options.env,{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'});}
  assert.equal((await call('start',{input})).status,'healthy');
  await mf.dispose();mf=new Miniflare(options('true'));
  assert.equal((await call('start',{input})).status,'healthy');
  assert.equal((await call('diagnostics',{input})).commands.filter(c=>c.command.includes('service_process.py start')).length,1);
  const before=await make('b');await call('dispatch',{lease:before.lease});
  const stoppedBefore=await call('stop',{input:before});assert.equal(stoppedBefore.status,'stopped');
  assert.deepEqual(await call('start',{input:before}),stoppedBefore);
  const fenced=await call('diagnostics',{input:before});assert.equal(fenced.control,null);assert.equal(fenced.commands.length,1);assert.match(fenced.commands[0].command,/service_process.py stop/);
  await mf.dispose();mf=new Miniflare(options('false'));
  await assert.rejects(call('start',{input}),/start-disabled/);
  assert.equal((await call('observe',{input})).status,'healthy');
  const stopped=await call('stop',{input});assert.equal(stopped.status,'stopped');assert.equal(stopped.stop.fenced,true);
  assert.deepEqual(await call('stop',{input}),stopped);assert.deepEqual(await call('observe',{input}),stopped);
  assert.equal((await mf.dispatchFetch('http://test/')).status,404);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
