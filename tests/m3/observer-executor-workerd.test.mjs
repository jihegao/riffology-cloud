import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {spec,reference,scope} from './run-fixture.ts';

// Real Executor DO, SQLite, R2 and capability RPC. Browser process/authority are
// deliberately fixtures; these tests make no native browser isolation claim.
async function setup(t){
 const dir=await mkdtemp(join(tmpdir(),'observer-executor-'));
 const s=spec();s.plan.declaration.observation={pagePath:'/observe',statePath:'/state'};
 const code=`import {DurableObject,RpcTarget} from 'cloudflare:workers';
 import {ObserverExecutor as Base} from './services/preview/observer-executor-durable.ts';
 import {observerExecutorActorName} from './services/preview/observer-executor-protocol.ts';
 import {turnDigest} from './services/turn/protocol.ts';
 import {serviceRuntimeInput} from './services/run/runtime-protocol.ts';
 import {R2ObserverArtifacts} from './services/preview/observer-artifacts.ts';
 export class Executor extends Base{
  async gate(value){this.env.M3_OBSERVER_ENABLED=value?'true':'false';}
  async artifactInventory(){return {
   entries:this.ctx.storage.sql.exec('SELECT kind,receipt_json,write_state,content_verified FROM observer_artifact_inventory ORDER BY kind').toArray(),
   roots:this.ctx.storage.sql.exec('SELECT kind,receipt_json FROM observer_artifact_roots ORDER BY kind').toArray(),
  };}
 }
 export class BrowserFixture extends DurableObject{
  retained;pageUrl;
  async run(command,input,resources){
   if(await this.ctx.storage.get('fenced'))throw Error('fixture-fenced');
   await this.ctx.storage.put('runs',(await this.ctx.storage.get('runs')??0)+1);
   this.retained=resources.dup();this.pageUrl=input.pageUrl;
   if(input.timeoutMs<=0||input.timeoutMs>15000)throw Error('fixture-timeout-invalid');
   const html=await (await resources.fetch(new Request(input.pageUrl))).text();
   return {stopped:true,payload:{type:'snapshot',text:html,truncated:false}};
  }
  async fenceAndStop(){await this.ctx.storage.put('fenced',true);await this.ctx.storage.put('stops',(await this.ctx.storage.get('stops')??0)+1);return true;}
  async diagnostics(){return {runs:await this.ctx.storage.get('runs')??0,stops:await this.ctx.storage.get('stops')??0,fenced:await this.ctx.storage.get('fenced')??false};}
  async late(){let denied=false;try{await this.retained.fetch(new Request(this.pageUrl));}catch{denied=true;}const cancelled=await this.retained.cancelled();this.retained[Symbol.dispose]();this.retained=undefined;return {denied,cancelled};}
 }
 export class Authority extends DurableObject{
  async configure(value){await this.ctx.storage.put('mode',value);await this.ctx.storage.put('authorizations',0);}
  async revoke(){await this.ctx.storage.put('revoked',true);}
  async authorize(command){const mode=await this.ctx.storage.get('mode'),count=(await this.ctx.storage.get('authorizations')??0)+1;await this.ctx.storage.put('authorizations',count);if(mode==='hang')await new Promise(resolve=>setTimeout(resolve,3000));if(await this.ctx.storage.get('revoked'))throw Error('observer-authority-denied');
   const scope=command.scope,spec=${JSON.stringify(s)},reference={...${JSON.stringify(reference('run-a'))},deadlineAt:command.deadlineAt};
   const binding={previewId:command.previewId,scope,runId:reference.runId,source:spec.plan.source,runtime:reference,createdAt:1,expiresAt:command.deadlineAt,revokedAt:null,reason:null};
   const runtime=serviceRuntimeInput({reference,scope,spec,lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:reference.dispatchId,deadlineAt:reference.deadlineAt,runId:reference.runId,leaseId:reference.leaseId}});binding.source=runtime.spec.plan.source;binding.runtime=runtime.reference;
   return {binding,runtime,policy:{origin:'https://p-'+ (mode==='policy'||(mode==='switch'&&count>=2)?'b':'a').repeat(40)+'.preview.example.test',pagePath:'/observe',statePath:'/state'},targetDigest:await turnDigest({binding,plan:runtime.spec.plan}),expiresAt:command.deadlineAt};
  }
  async forward(request){if(await this.ctx.storage.get('revoked'))throw Error('observer-authority-denied');const u=new URL(request.url);if(u.origin!=='http://localhost:8080'||!['/observe','/state'].includes(u.pathname))throw Error('fixture-url-denied');
   const calls=await this.ctx.storage.get('calls')??[];calls.push({url:request.url,headers:Object.fromEntries(request.headers)});await this.ctx.storage.put('calls',calls);
   return u.pathname==='/state'?Response.json({simulation_state_id:'state-a',sequence:7,state:{queue:2}}):new Response('<h1>Fixture</h1>',{headers:{'content-type':'text/html'}});
  }
  async cancelled(){return await this.ctx.storage.get('revoked')??false;}
  async calls(){return await this.ctx.storage.get('calls')??[];}
 }
 class Capability extends RpcTarget{constructor(authority,command){super();this.authority=authority;this.command=command;}async authorize(){return this.authority.authorize(this.command);}async forward(r){return this.authority.forward(r);}async cancelled(){return this.authority.cancelled();}}
 export default {async fetch(request,env){try{const {op,command,value,wrong}=await request.json();const name=await observerExecutorActorName(command),ex=env.EXECUTOR.getByName(wrong?'wrong-actor':name),browser=env.OBSERVER_BROWSER_RUNTIME.getByName(name),authority=env.AUTHORITY.getByName(name);let result;
  if(op==='execute')result=await ex.execute(command,new Capability(authority,command));
  else if(op==='gate')result=await ex.gate(value);
  else if(op==='stop')result=await ex.stop(command);
  else if(op==='inventory')result=await ex.artifactInventory();
  else if(op==='diagnostics')result=await browser.diagnostics();
  else if(op==='late')result=await browser.late();
  else if(op==='configure')result=await authority.configure(value);
  else if(op==='revoke')result=await authority.revoke();
  else if(op==='calls')result=await authority.calls();
  else if(op==='read')result=JSON.parse(new TextDecoder().decode(await new R2ObserverArtifacts(env.OBSERVER_ARTIFACTS).read(command,value)));
  else throw Error('fixture-operation-invalid');
  return Response.json({value:result??null});}catch(e){return Response.json({error:String(e.message)},{status:500});}}};`;
 const built=await build({stdin:{contents:code,resolveDir:process.cwd(),sourcefile:'observer-executor-fixture.ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
 const worker='observer-executor-test';
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-05',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:built.outputFiles[0].text}}},env:{EXECUTOR:{type:'durable-object',worker,exportName:'Executor'},OBSERVER_BROWSER_RUNTIME:{type:'durable-object',worker,exportName:'BrowserFixture'},AUTHORITY:{type:'durable-object',worker,exportName:'Authority'},OBSERVER_ARTIFACTS:{type:'r2',name:'observer-artifacts'}},exports:Object.fromEntries(['Executor','BrowserFixture','Authority'].map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]};
 let mf=new Miniflare(options);t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});await mf.ready;
 const command={schemaVersion:1,purpose:'observer',scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',previewId:'preview-a',operation:'snapshot',deadlineAt:Date.now()+14000};
 const call=async(op,value,extra={})=>{const r=await mf.dispatchFetch('https://fixture.test',{method:'POST',body:JSON.stringify({op,command,value,...extra})});const body=await r.json();if(body.error)throw Error(body.error);return body.value;};
 return {command,call,bucket:()=>mf.getR2Bucket('OBSERVER_ARTIFACTS',worker),restart:async()=>{await mf.dispose();mf=new Miniflare(options);await mf.ready;}};
}

test('Executor rejects disabled gate and wrong actor before starting browser',{timeout:25000},async t=>{
 const f=await setup(t);await assert.rejects(f.call('execute'),/observer-disabled/);
 await f.call('gate',true,{wrong:true});await assert.rejects(f.call('execute',null,{wrong:true}),/observer-executor-identity-denied/);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:0,fenced:false});
});

test('Executor persists real R2 receipts, closes resource capability, and replays after restart',{timeout:25000},async t=>{
 const f=await setup(t);await f.call('gate',true);const result=await f.call('execute');
 assert.equal(result.stopped,true);assert.equal(result.result.state.sequence,7);assert.equal(result.result.filesSha256,'a'.repeat(64));
 assert.deepEqual(await f.call('read',result.result.state.artifact),{simulation_state_id:'state-a',sequence:7,state:{queue:2}});
 assert.deepEqual(await f.call('read',result.result.view.artifact),{type:'snapshot',text:'<h1>Fixture</h1>',truncated:false});
 assert.equal((await (await f.bucket()).list()).objects.length,2);
 const inventory=await f.call('inventory');
 assert.equal(inventory.entries.length,2);assert.equal(inventory.roots.length,2);
 for(const entry of inventory.entries){
  assert.equal(entry.write_state,'acknowledged');assert.equal(entry.content_verified,1);
  const expected=result.result[entry.kind==='state'?'state':'view'].artifact;
  assert.deepEqual(JSON.parse(entry.receipt_json),expected);
  assert.deepEqual(inventory.roots.find(root=>root.kind===entry.kind),{kind:entry.kind,receipt_json:entry.receipt_json});
 }
 assert.deepEqual(await f.call('late'),{denied:true,cancelled:true});
 const calls=await f.call('calls');assert.deepEqual(calls.map(c=>c.url),['http://localhost:8080/observe','http://localhost:8080/state']);assert.ok(calls.every(c=>c.headers['x-riff-observer']==='read-only'));
 await f.restart();await f.call('gate',true);assert.deepEqual(await f.call('execute'),result);
 assert.deepEqual(await f.call('inventory'),inventory);assert.equal((await (await f.bucket()).list()).objects.length,2);
 assert.deepEqual(await f.call('diagnostics'),{runs:1,stops:0,fenced:false});
 await f.call('configure','policy');await assert.rejects(f.call('execute'),/observer-target-stale/);
 await f.call('configure','normal');assert.deepEqual(await f.call('execute'),result);
 await f.call('revoke');await assert.rejects(f.call('execute'),/observer-authority-denied/);
 assert.deepEqual(await f.call('diagnostics'),{runs:1,stops:0,fenced:false});
});

test('Executor stop fences before execution and remains available when gate is closed',{timeout:25000},async t=>{
 const f=await setup(t);assert.equal(await f.call('stop'),true);await f.call('gate',true);
 await assert.rejects(f.call('execute'),/observer-execution-fenced/);await f.call('gate',false);assert.equal(await f.call('stop'),true);
 await f.restart();assert.equal(await f.call('stop'),true);await f.call('gate',true);await assert.rejects(f.call('execute'),/observer-execution-fenced/);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:1,fenced:true});
});


test('Executor bounds a hanging initial capability query by the absolute command deadline',{timeout:10000},async t=>{
 const f=await setup(t);f.command.deadlineAt=Date.now()+1000;await f.call('gate',true);await f.call('configure','hang');const started=Date.now();
 await assert.rejects(f.call('execute'),/observer-timeout/);assert.ok(Date.now()-started<2500);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:0,fenced:false});
 await f.call('gate',false);assert.equal(await f.call('stop'),true);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:1,fenced:true});
});


test('Executor refuses a policy switch between admission and inner execution',{timeout:10000},async t=>{
 const f=await setup(t);await f.call('gate',true);await f.call('configure','switch');
 await assert.rejects(f.call('execute'),/observer-target-stale/);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:0,fenced:false});
 assert.equal((await (await f.bucket()).list()).objects.length,0);
 await f.call('configure','normal');await assert.rejects(f.call('execute'),/observer-execution-unknown/);
 assert.deepEqual(await f.call('diagnostics'),{runs:0,stops:0,fenced:false});
});
