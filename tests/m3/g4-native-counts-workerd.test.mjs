import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('real Workerd attempt counters are read-only when absent, rollback atomically and survive restart without native calls',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'g4-native-counts-'));
 const entry=`import {DurableObject} from 'cloudflare:workers';
 import {recordNativeAttempt,nativeAttemptSnapshot,NATIVE_ATTEMPT_KEY} from './services/g4-native-counts.ts';
 import {ToolBridgeAgent} from './services/tools/durable.ts';
 import {ProjectRuntime} from './services/runtime/durable.ts';
 import {SqlToolLedger} from './services/tools/ledger.ts';
 import {toolBridgeActorName} from './services/tools/identity.ts';
 export {ProjectRuntime};
 export class LedgerCounts extends ToolBridgeAgent{
  async seed(identity){const ledger=new SqlToolLedger(this.ctx.storage);await ledger.accept({schemaVersion:1,scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:'command',deadlineAt:Date.now()+60000,operation:'read',arguments:{path:'model/model.py'}});}
  reorder(){const r=this.ctx.storage.sql.exec('SELECT scope_json FROM tool_commands').toArray()[0],v=JSON.parse(r.scope_json);this.ctx.storage.sql.exec('UPDATE tool_commands SET scope_json=?',JSON.stringify({workspaceGeneration:v.workspaceGeneration,workspaceId:v.workspaceId,projectId:v.projectId,tenantId:v.tenantId}));}
 }
 export class Counts extends DurableObject{
  act(body){
   if(body.action==='record')recordNativeAttempt(this.ctx.storage,body.tag);
   if(body.action==='rollback'){try{this.ctx.storage.transactionSync(()=>{recordNativeAttempt(this.ctx.storage,'execFilework');throw Error('rollback');});}catch{}}
   return {snapshot:nativeAttemptSnapshot(this.ctx.storage,this.ctx.id.toString()),keys:Array.from(this.ctx.storage.kv.list()).length,tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray()};
  }
 }
 export default {async fetch(req,env){const b=await req.json();
 if(['bridge','ledger','reorder'].includes(b.action)){const name=await toolBridgeActorName(b.identity.scope,b.identity.turnId,b.identity.dispatchId);const actor=env.TOOL_BRIDGE_AGENT.getByName(name);if(b.action==='ledger')await actor.seed(b.identity);if(b.action==='reorder')await actor.reorder();return Response.json(await actor.nativeAttemptSnapshot(b.identity));}
 if(b.action==='runtime')return Response.json(await env.PROJECT_RUNTIME.getByName(b.actor??b.identity.runtimeId).nativeAttemptSnapshot(b.identity));
 return Response.json(await env.COUNTS.getByName('counts').act(b));}};`;
 const out=await build({stdin:{contents:entry,sourcefile:'g4-counts.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const name='g4-native-counts',options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:out.outputFiles[0].text}}},env:{COUNTS:{type:'durable-object',worker:name,exportName:'Counts'},TOOL_BRIDGE_AGENT:{type:'durable-object',worker:name,exportName:'LedgerCounts'},PROJECT_RUNTIME:{type:'durable-object',worker:name,exportName:'ProjectRuntime'}},exports:{Counts:{type:'durable-object',storage:'sqlite'},LedgerCounts:{type:'durable-object',storage:'sqlite'},ProjectRuntime:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{throw Error('no-added-native-calls');}}}}]};
 let mf;const act=async body=>{const r=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  mf=new Miniflare(options);
  const absent=await act({action:'read'});assert.equal(absent.snapshot.attempts,null);assert.equal(absent.snapshot.supported,false);assert.equal(absent.snapshot.noAddedCalls,true);assert.equal(absent.keys,0);
  assert.deepEqual(await act({action:'read'}),absent);
  const rollback=await act({action:'rollback'});assert.equal(rollback.snapshot.attempts,null);assert.equal(rollback.keys,0);
  const bridge=await act({action:'bridge',identity:{scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1}});assert.deepEqual(bridge,{supported:false,noAddedCalls:true,admitted:null,dispatched:null});
  const turnIdentity={scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1};
  const genuine=await act({action:'ledger',identity:turnIdentity});assert.deepEqual(genuine,{supported:true,noAddedCalls:true,admitted:1,dispatched:0});
  assert.deepEqual(await act({action:'reorder',identity:turnIdentity}),genuine,'semantically identical legacy scope key order is accepted');
  const runtime={taskId:'task',tenantId:'tenant',projectId:'project',workspaceId:'workspace',generation:1,runtimeId:'runtime',leaseId:'lease'};
  const snap=await act({action:'runtime',identity:runtime});assert.equal(snap.attempts,null);assert.equal(snap.noAddedCalls,true);
  const denied=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({action:'runtime',identity:runtime,actor:'other'})});assert.equal(denied.status,500);
  const recorded=await act({action:'record',tag:'startProcess'});assert.equal(recorded.snapshot.attempts.startProcess,1);assert.equal(recorded.snapshot.semantics,'attempt-before-call');
  const failed=await act({action:'rollback'});assert.deepEqual(failed.snapshot,recorded.snapshot);
  await mf.dispose();mf=new Miniflare(options);
  assert.deepEqual((await act({action:'read'})).snapshot,recorded.snapshot);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
