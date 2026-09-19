import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {profile} from './production-profile-fixture.ts';
import {modelCallReference} from '../../services/model-budget/core.ts';

// Real SQLite DO, including restart and lost acknowledgements; no provider calls.
test('Pi developer accounting survives restart, admits terminal unknown fees, blocks unknown execution across workspaces',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-dev-'));
 const policy={schemaVersion:1,policyId:'developer-v1',tenantId:'tenant',userId:'owner',enabled:true,billingMode:'observe'};
 const bundled=await build({stdin:{contents:`
 export {PiDeveloperBudget} from './services/model-budget/pi-developer-durable.ts';
 export default {async fetch(r,env){const {method,args,loseAck}=await r.json();try {const value=await env.PI_DEVELOPER_BUDGET.getByName('tenant-model-budget:tenant')[method](...args);if(loseAck)throw Error('lost-ack');return Response.json({value});}catch(e){return Response.json({error:e.message});}}};`,resolveDir:process.cwd(),sourcefile:'pi-dev-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'pi-dev-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{PI_DEVELOPER_POLICY_JSON:{type:'text',value:JSON.stringify(policy)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(profile)},M2_MODEL_BUDGET_POLICY_VERSION:{type:'text',value:'developer-token-v1'},PI_DEVELOPER_BUDGET:{type:'durable-object',worker:'pi-dev-test',exportName:'PiDeveloperBudget'}},exports:{PiDeveloperBudget:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 let mf;
 const rpc=async(method,args,loseAck=false)=>{const r=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args,loseAck})})).json();if(r.error)throw Error(r.error);return r.value;};
 const request=(n,workspace='workspace')=>({schemaVersion:1,identity:{scope:{tenantId:'tenant',projectId:'project',workspaceId:workspace,workspaceGeneration:1},sessionId:'session',turnId:'turn-'+n,dispatchId:'dispatch-'+n,generation:1},actor:{userId:'owner',authVersion:1},callId:'call-'+n,requestId:'request-'+n,deadlineAt:Date.now()+60000,provider:'openai',model:profile.model,payloadSha256:'a'.repeat(64),inputTokenUpperBound:8192,maxOutputTokens:100,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:'developer-token-v1'});
 const terminal=(overrides={})=>({outcome:'completed',errorCode:null,providerRequestId:'req-ended',usage:{kind:'unknown',observedAt:Date.now()},...overrides});
 try{
  mf=new Miniflare(options);await mf.ready;
  const first=request(1);
  await assert.rejects(rpc('reserve',['tenant',{...first,actor:{userId:'other',authVersion:1}}]),/admission-denied/);
  await assert.rejects(rpc('reserve',['tenant',{...first,model:'other'}]),/profile-denied/);
  await assert.rejects(rpc('reserve',['tenant',first],true),/lost-ack/);
  const saved=await rpc('reserve',['tenant',first]),ref=modelCallReference(saved.record);
  assert.equal(saved.replayed,true);
  await assert.rejects(rpc('reserve',['tenant',request(2,'other-workspace')]),/execution-unconfirmed/);
  assert.equal((await rpc('dispatch',['tenant',ref])).authorized,true);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  assert.equal((await rpc('dispatch',['tenant',ref])).authorized,false);
  await rpc('finish',['tenant',ref,terminal()]);
  await rpc('closeTurnAdmission',['tenant',first.identity]);
  const snapshot=await rpc('snapshot',['tenant',first.identity]);
  assert.equal(snapshot.records[0].reconciliation,'pending');
  assert.equal(snapshot.usage[0].billingStatus,'unknown');assert.equal(snapshot.usage[0].observedNanodollars,null);assert.equal(snapshot.usage[0].invoiceVerified,false);assert.ok(snapshot.usage[0].reservedNanodollars>0);
  // A subsequent independent task can proceed when only fees remain unknown.
  const second=request(2),secondRef=modelCallReference((await rpc('reserve',['tenant',second])).record);
  await rpc('dispatch',['tenant',secondRef]);
  await rpc('finish',['tenant',secondRef,terminal({usage:{kind:'verified',source:'provider-usage',inputTokens:40,outputTokens:16,observedAt:Date.now()}})]);
  const paid=await rpc('snapshot',['tenant',second.identity]);assert.equal(paid.usage[0].billingStatus,'observed');assert.equal(paid.usage[0].observedNanodollars,40*profile.rates.inputNanodollarsPerToken+16*profile.rates.outputNanodollarsPerToken);
  // Serialize reservations from separate workspaces to avoid check-then-reserve races.
  const a=request(3,'a'),b=request(4,'b');const results=await Promise.allSettled([rpc('reserve',['tenant',a]),rpc('reserve',['tenant',b])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const index=results.findIndex(r=>r.status==='fulfilled'),winner=[a,b][index],winnerRef=modelCallReference(results[index].value.record);
  await rpc('dispatch',['tenant',winnerRef]);
  // 502/504, generic provider errors and deadlines all use this failed category.
  await rpc('finish',['tenant',winnerRef,terminal({outcome:'failed',errorCode:'provider-failure'})]);
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(rpc('reserve',['tenant',request(5,'brand-new')]),/execution-unconfirmed/);
  assert.deepEqual(await rpc('snapshot',['tenant',first.identity]),snapshot);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
