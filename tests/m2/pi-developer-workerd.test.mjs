import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {profile} from './production-profile-fixture.ts';
import {modelCallReference} from '../../services/model-budget/core.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

// Real SQLite DO, including restart and lost acknowledgements; no provider calls.
test('Pi developer packet survives restart, admits fee-pending terminals and enforces exact project, time, Turn and call bounds',{timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-dev-'));
 const pricedProfile={...profile,rates:{...profile.rates,version:'fixture-rates-bounded',inputNanodollarsPerToken:600_000,outputNanodollarsPerToken:600_000}};
 const manifests=[{schemaVersion:1,ledger:'legacy',proofs:[{callKey:'a'.repeat(64),proofDigest:'1'.repeat(64)}]},{schemaVersion:1,ledger:'g5',proofs:['b','c','d','e','f','2'].map((key,index)=>({callKey:key.repeat(64),proofDigest:String(index+3).repeat(64)}))}];
 const historicalIsolation={schemaVersion:1,manifestId:'isolation-v1',manifests,manifestSha256:await turnDigest({schemaVersion:1,manifestId:'isolation-v1',manifests})};
 const startsAt=Date.now(),policy={schemaVersion:2,policyId:'developer-v2',tenantId:'tenant',userId:'owner',projectId:'project',enabled:true,billingMode:'observe',maxTurns:3,maxCalls:8,maxNanodollars:600_000_000,maxCallDurationMs:360_000,startsAt,expiresAt:startsAt+1_800_000,historicalIsolation};
 const bundled=await build({stdin:{contents:`
 import {DurableObject} from 'cloudflare:workers';
 export {PiDeveloperBudget} from './services/model-budget/pi-developer-durable.ts';
 export class Historical extends DurableObject {async assertExecutionIsolated(tenantId,manifest){if(tenantId!=='tenant'||manifest.ledger==='legacy'&&manifest.proofs.length!==1||manifest.ledger==='g5'&&manifest.proofs.length!==6)throw Error('fixture-isolation-mismatch');return {isolated:manifest.proofs.length};}}
 export default {async fetch(r,env){const {method,args,loseAck}=await r.json();try {const value=await env.PI_DEVELOPER_BUDGET.getByName('tenant-model-budget:tenant')[method](...args);if(loseAck)throw Error('lost-ack');return Response.json({value});}catch(e){return Response.json({error:e.message});}}};`,resolveDir:process.cwd(),sourcefile:'pi-dev-test.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},workers:[{config:{type:'worker',name:'pi-dev-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{PI_DEVELOPER_POLICY_JSON:{type:'text',value:JSON.stringify(policy)},PRODUCTION_MODEL_PROFILE_JSON:{type:'text',value:JSON.stringify(pricedProfile)},M2_MODEL_BUDGET_POLICY_VERSION:{type:'text',value:'developer-token-v1'},PI_DEVELOPER_BUDGET:{type:'durable-object',worker:'pi-dev-test',exportName:'PiDeveloperBudget'},TENANT_MODEL_BUDGET:{type:'durable-object',worker:'pi-dev-test',exportName:'Historical'},G5_TOKEN_BUDGET:{type:'durable-object',worker:'pi-dev-test',exportName:'Historical'}},exports:{PiDeveloperBudget:{type:'durable-object',storage:'sqlite'},Historical:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 let mf;
 const rpc=async(method,args,loseAck=false)=>{const r=await(await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify({method,args,loseAck})})).json();if(r.error)throw Error(r.error);return r.value;};
 const request=(n,workspace='workspace')=>({schemaVersion:1,identity:{scope:{tenantId:'tenant',projectId:'project',workspaceId:workspace,workspaceGeneration:1},sessionId:'session',turnId:'turn-'+n,dispatchId:'dispatch-'+n,generation:1},actor:{userId:'owner',authVersion:1},callId:'call-'+n,requestId:'request-'+n,deadlineAt:Date.now()+60000,provider:'openai',model:profile.model,payloadSha256:'a'.repeat(64),inputTokenUpperBound:100,maxOutputTokens:20,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:'developer-token-v1'});
 const terminal=(overrides={})=>({outcome:'completed',errorCode:null,providerRequestId:'req-ended',usage:{kind:'unknown',observedAt:Date.now()},...overrides});
 try{
  mf=new Miniflare(options);await mf.ready;
  const first=request(1);
  await assert.rejects(rpc('reserve',['tenant',{...first,actor:{userId:'other',authVersion:1}}]),/admission-denied/);
  await assert.rejects(rpc('reserve',['tenant',{...first,identity:{...first.identity,scope:{...first.identity.scope,projectId:'other'}}}]),/admission-denied/);
  await assert.rejects(rpc('reserve',['tenant',{...first,deadlineAt:Date.now()+400_000}]),/packet-limit/);
  await assert.rejects(rpc('reserve',['tenant',{...first,inputTokenUpperBound:10_000,maxOutputTokens:100}]),/packet-limit/);
  await assert.rejects(rpc('reserve',['tenant',{...first,model:'other'}]),/profile-denied/);
  await rpc('admitTurn',[first.identity.scope,'owner','session','human-1']);
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
  const second=request(2);await rpc('admitTurn',[second.identity.scope,'owner','session','human-2']);const secondRef=modelCallReference((await rpc('reserve',['tenant',second])).record);
  await rpc('dispatch',['tenant',secondRef]);
  await rpc('finish',['tenant',secondRef,terminal({usage:{kind:'verified',source:'provider-usage',inputTokens:40,outputTokens:16,observedAt:Date.now()}})]);
  const paid=await rpc('snapshot',['tenant',second.identity]);assert.equal(paid.usage[0].billingStatus,'observed');assert.equal(paid.usage[0].observedNanodollars,40*pricedProfile.rates.inputNanodollarsPerToken+16*pricedProfile.rates.outputNanodollarsPerToken);
  const winner=request(3,'a');await rpc('admitTurn',[winner.identity.scope,'owner','session','human-3']);
  await assert.rejects(rpc('admitTurn',[request(4,'b').identity.scope,'owner','session','human-4']),/packet-limit/);
  const winnerRef=modelCallReference((await rpc('reserve',['tenant',winner])).record);
  await rpc('dispatch',['tenant',winnerRef]);
  await rpc('finish',['tenant',winnerRef,terminal({usage:{kind:'verified',source:'provider-usage',inputTokens:1,outputTokens:1,observedAt:Date.now()}})]);
  // Fill the exact packet with five continuations of an existing Turn.
  for(let n=5;n<=9;n++){
   const next={...request(n),identity:second.identity,callId:'call-'+n,requestId:'request-'+n,payloadSha256:String(n).repeat(64)},nextRef=modelCallReference((await rpc('reserve',['tenant',next])).record);
   await rpc('dispatch',['tenant',nextRef]);await rpc('finish',['tenant',nextRef,terminal({providerRequestId:'req-'+n,usage:{kind:'verified',source:'provider-usage',inputTokens:1,outputTokens:1,observedAt:Date.now()}})]);
  }
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(rpc('reserve',['tenant',request(5,'brand-new')]),/packet-limit/);
  const after=await rpc('snapshot',['tenant',first.identity]);
  assert.deepEqual(after.records,snapshot.records);assert.deepEqual(after.usage,snapshot.usage);
  assert.equal(after.acceptancePolicy.usedTurns,3);assert.equal(after.acceptancePolicy.usedCalls,8);assert.ok(after.acceptancePolicy.reservedNanodollars<=policy.maxNanodollars);
  // The stable actor permanently pins the first exact packet.
  options.workers[0].config.env.PI_DEVELOPER_POLICY_JSON.value=JSON.stringify({...policy,policyId:'replacement-v2'});
  await mf.dispose();mf=new Miniflare(options);await mf.ready;
  await assert.rejects(rpc('reserve',['tenant',request(10)]),/policy-conflict/);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
