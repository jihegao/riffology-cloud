import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {scope} from './run-fixture.ts';

// Real DO/SQLite/R2/RPC. Completion is a seeded backend fixture, not a browser.
async function setup(t){
 const dir=await mkdtemp(join(tmpdir(),'observer-artifact-read-'));
 const code=`import {ObserverExecutor as Base} from './services/preview/observer-executor-durable.ts';
 import {observerExecutorActorName} from './services/preview/observer-executor-protocol.ts';
 import {ObserverArtifactReadCapability} from './services/preview/observer-executor-rpc.ts';
 import {observerRpcData} from './services/preview/observer-rpc-data.ts';
 import {SqlObserverExecutorSupervisor} from './services/preview/observer-executor-supervisor.ts';
 import {R2ObserverArtifacts} from './services/preview/observer-artifacts.ts';
 import {SqlObserverArtifactInventory} from './services/preview/observer-artifact-inventory.ts';
 export class Executor extends Base{
  async seed(command,mode){this.env.M3_OBSERVER_ENABLED='false';
   const content=new TextEncoder().encode(JSON.stringify({simulation_state_id:'historical-state',sequence:1,state:{queue:3}}));
   const receipt=await new R2ObserverArtifacts(this.env.OBSERVER_ARTIFACTS,new SqlObserverArtifactInventory(this.ctx.storage,command)).save(command,'state',content);
   if(mode!=='orphan'){
    const supervisor=new SqlObserverExecutorSupervisor(this.ctx.storage,command,{execute:async()=>({stopped:true,result:{state:{artifact:receipt}}}),fenceAndStop:async()=>true},()=>command.deadlineAt-1);
    if(mode==='unknown'){this.ctx.storage.sql.exec('UPDATE observer_executor SET attempted=1');}
    else {await supervisor.execute();if(mode==='fenced')await supervisor.stop();}
   }
   return receipt;
  }
  async diagnostics(){return {tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'observer_executor%'").toArray(),cancelled:await this.ctx.storage.get('cancelled')??false};}
  async readFixture(command,receipt,cap,mode){
   const original=this.env.OBSERVER_ARTIFACTS;
   if(mode==='slow'||mode==='tamper'||mode==='delay')this.env.OBSERVER_ARTIFACTS={put:(...a)=>original.put(...a),get:async(...a)=>{
    const object=await original.get(...a);if(!object)return null;
    if(mode==='tamper'){const bytes=new Uint8Array(await object.arrayBuffer());bytes[bytes.length-2]^=1;return {size:bytes.length,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};}
    if(mode==='delay'){await new Promise(r=>setTimeout(r,50));return object;}
    return {size:object.size,body:new ReadableStream({cancel:()=>this.ctx.storage.put('cancelled',true)})};
   }};
   try{return await this.readArtifact(command,receipt,cap);}finally{this.env.OBSERVER_ARTIFACTS=original;}
  }
 }
 export default {async fetch(request,env){try{
  const {op,command,receipt,mode,grantMode,grantCommand}=await request.json();
  const ex=env.EXECUTOR.getByName(await observerExecutorActorName(command));let value;
  if(op==='seed')value=await ex.seed(command,mode);
  else if(op==='diagnostics')value=await ex.diagnostics();
  else if(op==='read'){
   let count=0;const expiresAt=Date.now()+(grantMode==='short'?150:5000);
   const cap=new ObserverArtifactReadCapability(async()=>{
    count++;
    if(grantMode==='hang')await new Promise(r=>setTimeout(r,6000));
    if(grantMode==='revoke'&&count>1)throw Error('fixture-revoked');
    return {schemaVersion:1,purpose:'observer-artifact-read',command:grantCommand??command,receipt,expiresAt:grantMode==='expired'?1:grantMode==='long'?Date.now()+6000:expiresAt};
   });
   const result=observerRpcData(await ex.readFixture(command,receipt,cap,mode));value={receipt:result.receipt,text:new TextDecoder().decode(result.content),authorizations:count};
  }else throw Error('fixture-op');
  return Response.json({value});
 }catch(error){return Response.json({error:error.message},{status:500});}}};`;
 const built=await build({stdin:{contents:code,resolveDir:process.cwd(),sourcefile:'observer-artifact-read-fixture.ts'},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
 const worker='observer-artifact-read';
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-05',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:built.outputFiles[0].text}}},env:{EXECUTOR:{type:'durable-object',worker,exportName:'Executor'},OBSERVER_ARTIFACTS:{type:'r2',name:'artifacts'}},exports:{Executor:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});await mf.ready;
 const command={schemaVersion:1,purpose:'observer',scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',previewId:'preview-a',operation:'snapshot',deadlineAt:Date.now()-1000};
 const call=async(op,extra={})=>{const response=await mf.dispatchFetch('https://fixture.test',{method:'POST',body:JSON.stringify({op,command,...extra})});const body=await response.json();if(body.error)throw Error(body.error);return body.value;};
 return {call,command};
}

test('historical completed and fenced artifact reads work with execution gate off and no browser binding',async t=>{
 const f=await setup(t),receipt=await f.call('seed',{mode:'fenced'});
 const read=await f.call('read',{receipt});assert.deepEqual(read.receipt,receipt);assert.equal(read.authorizations,2);
 assert.deepEqual(JSON.parse(read.text),{simulation_state_id:'historical-state',sequence:1,state:{queue:3}});
 await assert.rejects(f.call('read',{receipt:{...receipt,sha256:'b'.repeat(64)}}),/observer-artifact-not-completed/);
 await assert.rejects(f.call('read',{receipt,command:{...f.command,operation:'console'}}),/observer-artifact-not-completed/);
 await assert.rejects(f.call('read',{receipt,grantCommand:{...f.command,previewId:'other-preview'}}),/observer-artifact-authority-denied/);
 await assert.rejects(f.call('read',{receipt,mode:'tamper'}),/observer-artifact-invalid/);
});

test('orphan and unknown reads cannot publish bytes and a miss creates no execution table',async t=>{
 const f=await setup(t),receipt=await f.call('seed',{mode:'orphan'});
 await assert.rejects(f.call('read',{receipt}),/observer-artifact-not-completed/);
 assert.deepEqual((await f.call('diagnostics')).tables,[]);
 await f.call('seed',{mode:'unknown'});await assert.rejects(f.call('read',{receipt}),/observer-artifact-not-completed/);
});

test('read rechecks authority after content and cancels stalled bodies at retained grant deadline',async t=>{
 const f=await setup(t),receipt=await f.call('seed');
 await assert.rejects(f.call('read',{receipt,mode:'delay',grantMode:'revoke'}),/fixture-revoked/);
 await assert.rejects(f.call('read',{receipt,grantMode:'expired'}),/observer-artifact-authority-denied/);
 await assert.rejects(f.call('read',{receipt,grantMode:'long'}),/observer-artifact-authority-denied/);
 const start=Date.now();await assert.rejects(f.call('read',{receipt,mode:'slow',grantMode:'short'}),/observer-artifact-read-(timeout|cancelled)/);assert.ok(Date.now()-start<2000);
 assert.equal((await f.call('diagnostics')).cancelled,true);
});

test('read has an absolute five second limit even when capability authorization hangs',{timeout:15000},async t=>{
 const f=await setup(t),receipt=await f.call('seed'),start=Date.now();
 await assert.rejects(f.call('read',{receipt,grantMode:'hang'}),/observer-artifact-read-timeout/);
 assert.ok(Date.now()-start>=4900);assert.ok(Date.now()-start<8000);
});
