import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {productionHttpFailure} from '../../services/model-proxy/openai-gateway-responses.ts';
import {profile} from '../m2/production-profile-fixture.ts';
import {profileDigest} from '../../services/model-proxy/production-profile.ts';
import {modelCallReference} from '../../services/model-budget/core.ts';
import {moneyReference} from '../../services/model-budget/production-money.ts';
const key=n=>n.toString(16).padStart(64,'0');
const tokenPolicy={version:'g5-openai-luna-20260916-v1',maxReservationAttemptsPerTurn:8,maxDispatchedCallsPerTurn:8,maxInputTokensPerCall:262144,maxOutputTokensPerCall:4096,maxReservedTokensPerTurn:2129920};

for(const failureStatus of [502,504,null]) test('HTTP '+failureStatus+': real production Guard and ledgers isolate terminal billing uncertainty, retain holds and reject unknown execution after restart',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-bounded-billing-')),sha=await profileDigest(profile);
 const policy={schemaVersion:1,windowId:'g5-bounded-test',phase:'A',principals:[{tenantId:'tenant-a',userId:'user-a'}],profilePin:{provider:'openai',model:profile.model,profileSha256:sha,rateCardSha256:'b'.repeat(64),inputNanodollarsPerToken:profile.rates.inputNanodollarsPerToken,outputNanodollarsPerToken:profile.rates.outputNanodollarsPerToken},totalNanodollars:20000000000,turnNanodollars:5000000000,maxUpstreamDispatches:147,maxSimulationRuns:39,maxServiceRuns:0,maxTasks:66,durationMs:7200000,billingPolicy:{mode:'bounded-pending',maxUnknownCalls:3,maxUnknownNanodollars:1000000000}};
 const bundle=await build({stdin:{contents:`
 export {G5ControlledWindow} from './services/model-budget/g5-window-durable.ts';
 export {G5TenantModelBudget} from './services/model-budget/g5-token-durable.ts';
 export {ProductionModelBudget} from './services/model-budget/production-durable.ts';
 import {ToolBridgeAgent as RealToolBridgeAgent} from './services/tools/durable.ts';
 export class ToolBridgeAgent extends RealToolBridgeAgent {async fixturePending(identity,value){await this.turnSettlement(identity);this.ctx.storage.kv.put('fixture-pending',value);}async turnSettlement(identity){const r=await super.turnSettlement(identity);return this.ctx.storage.kv.get('fixture-pending')?{...r,total:r.total+1,active:1,pending:1,unknown:1}:r;}}
 import {toolBridgeActorName} from './services/tools/identity.ts';
 export default {async fetch(r,env){const {target,method,args,loseAck}=await r.json();try{
 const identity=args[0]?.scope?args[0]:null;
 const name=target==='G5_WINDOW_GUARD'?'g5-controlled-global-v1':target==='G5_TOKEN_BUDGET'?'tenant-model-budget:tenant-a':target==='PRODUCTION_MODEL_BUDGET'?'production-money-global-v1':await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId);
 const value=await env[target].getByName(name)[method](...args);if(loseAck)throw Error('lost-after-real-commit');return Response.json({ok:true,value});
 }catch(e){return Response.json({ok:false,error:e.message});}}};`,resolveDir:process.cwd(),sourcefile:'bounded-billing-fixture.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const classes={G5_WINDOW_GUARD:'G5ControlledWindow',G5_TOKEN_BUDGET:'G5TenantModelBudget',PRODUCTION_MODEL_BUDGET:'ProductionModelBudget',TOOL_BRIDGE_AGENT:'ToolBridgeAgent'};
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'bounded-billing-test',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{G5_CONTROLLED_WINDOW_JSON:{type:'text',value:JSON.stringify(policy)},G5_ADMISSION_ENABLED:{type:'text',value:'true'},G5_TOKEN_BUDGET_POLICY_JSON:{type:'text',value:JSON.stringify(tokenPolicy)},PRODUCTION_MODEL_ENABLED:{type:'text',value:'true'},PRODUCTION_MONEY_POLICY_JSON:{type:'text',value:JSON.stringify({version:'bounded-money-v1',period:'bounded-original-period',enabled:true,profileSha256:sha,caps:{turn:5000000000,user:20000000000,tenant:20000000000,global:20000000000}})},...Object.fromEntries(Object.entries(classes).map(([name,exportName])=>[name,{type:'durable-object',worker:'bounded-billing-test',exportName}]))},exports:Object.fromEntries(Object.values(classes).map(name=>[name,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 let mf;
 const rpc=async(target,method,args=[],loseAck=false)=>{const body=await (await mf.dispatchFetch('http://bounded-billing.local/',{method:'POST',body:JSON.stringify({target,method,args,loseAck})})).json();if(!body.ok)throw Error(body.error);return body.value;};
 const guard=(method,args=[],loseAck=false)=>rpc('G5_WINDOW_GUARD',method,args,loseAck);
 const task=n=>({tenantId:'tenant-a',userId:'user-a',kind:'turn',key:key(n),intentKeySha256:key(n+500),digest:key(n+1000)});
 async function start(n){
  const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:`turn-${n}`,dispatchId:`dispatch-${n}`,generation:1},t=task(n);
  await guard('registerTask',[t]);await guard('claimTaskCreate',[t.key]);await guard('bindTask',[t.key,identity.turnId]);const grant=await guard('claimTaskStart',[t.key,identity]);await guard('confirmTaskStartGrant',[t.key,grant.grantId]);
  const request={schemaVersion:1,identity,actor:{userId:'user-a',authVersion:1},callId:`call-${n}`,requestId:`request-${n}`,deadlineAt:Date.now()+60000,provider:'openai',model:profile.model,payloadSha256:key(n+200),inputTokenUpperBound:8192,maxOutputTokens:100,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',budgetPolicyVersion:tokenPolicy.version};
  const token=await rpc('G5_TOKEN_BUDGET','reserve',['tenant-a',request]),reference=modelCallReference(token.record),call=await guard('reserveTrustedCall',[{request,tokenReference:reference,profile}]);
  const money=await rpc('PRODUCTION_MODEL_BUDGET','admit',[{request,profile}]),moneyRef=moneyReference(money.record);await rpc('PRODUCTION_MODEL_BUDGET','dispatch',[moneyRef]);await guard('bindTrustedMoney',[call.callKey,moneyRef]);await guard('claimTrustedDispatch',[call.callKey]);await rpc('G5_TOKEN_BUDGET','dispatch',['tenant-a',reference]);
  return {identity,t,request,reference,call,moneyRef,reserved:money.record.reserved};
 }
 async function closeLedgers(c){await Promise.all([rpc('G5_TOKEN_BUDGET','closeTurnAdmission',['tenant-a',c.identity]),rpc('PRODUCTION_MODEL_BUDGET','closeTurnAdmission',[c.identity]),rpc('TOOL_BRIDGE_AGENT','closeTurnAdmission',[c.identity])]);}
 try{
  mf=new Miniflare(options);await mf.ready;const first=await start(1);
  await rpc('PRODUCTION_MODEL_BUDGET','markUnknown',[first.moneyRef,'provider-failure']);
  // A closed money reservation alone cannot release an unknown provider execution.
  await assert.rejects(guard('settleTrustedCall',[first.call.callKey]),/settlement-unconfirmed/);
  await rpc('G5_TOKEN_BUDGET','finish',['tenant-a',first.reference,{outcome:'failed',errorCode:'rejected-auth',providerRequestId:'req-ended-1',usage:{kind:'unknown',observedAt:Date.now()}}]);
  await rpc('TOOL_BRIDGE_AGENT','fixturePending',[first.identity,true]);
  await assert.rejects(guard('settleTrustedCall',[first.call.callKey]),/ledger-unsettled/);
  await rpc('TOOL_BRIDGE_AGENT','fixturePending',[first.identity,false]);
  await assert.rejects(guard('settleTrustedCall',[first.call.callKey],true),/lost-after-real-commit/);
  assert.equal((await guard('settleTrustedCall',[first.call.callKey])).billingSettled,false);
  await assert.rejects(guard('closeTrustedTurn',[first.t.key,first.identity]),/turn-unsettled/);
  await closeLedgers(first);await assert.rejects(guard('closeTrustedTurn',[first.t.key,first.identity],true),/lost-after-real-commit/);
  const before=await rpc('PRODUCTION_MODEL_BUDGET','lookup',[first.moneyRef]);assert.equal(before.accounted,first.reserved);assert.equal(before.state,'unknown');
  await mf.dispose();mf=null;mf=new Miniflare(options);await mf.ready;
  assert.equal((await guard('closeTrustedTurn',[first.t.key,first.identity])).billingSettled,false);
  assert.equal((await guard('claimTrustedDispatch',[first.call.callKey])).authorized,false);
  assert.deepEqual(await rpc('PRODUCTION_MODEL_BUDGET','lookup',[first.moneyRef]),before);
  await assert.rejects(guard('registerTask',[{...task(5),intentKeySha256:first.t.intentKeySha256}]),/intent-replay-denied/);
  const report=await guard('billingSnapshot');assert.equal(report.unknownCalls,1);assert.equal(report.unknownReservedNanodollars,first.reserved);assert.equal(report.invoiceVerified,false);assert.equal(report.billingSettled,false);
  const state=await guard('operatorSnapshot');assert.equal(state.billing.windowHeldCalls,1);assert.equal(state.billing.unknownReservedNanodollars,first.reserved);assert.equal(state.moneyUnknown,1);assert.equal(state.tokenPending,1);assert.equal(state.guardPending,0);
  const second=await start(2);assert.equal((await guard('snapshot')).calls.length,2);
  await rpc('G5_TOKEN_BUDGET','markUnknown',['tenant-a',second.reference]);await rpc('PRODUCTION_MODEL_BUDGET','markUnknown',[second.moneyRef,'outcome-unknown']);await guard('markUnknown',[second.call.callKey]);
  await closeLedgers(second);await assert.rejects(guard('closeTrustedTurn',[second.t.key,second.identity]),/turn-unsettled/);
  await assert.rejects(guard('registerTask',[task(3)]),/charge-unsettled/);
  // A gateway failure or local deadline does not prove remote execution ended.
  await rpc('G5_TOKEN_BUDGET','finish',['tenant-a',second.reference,{outcome:'failed',errorCode:failureStatus===null?'deadline':productionHttpFailure(failureStatus),providerRequestId:'req-not-confirmed-ended',usage:{kind:'unknown',observedAt:Date.now()}}]);
  await assert.rejects(guard('settleTrustedCall',[second.call.callKey]),/billing-terminal-unconfirmed/);
  await assert.rejects(guard('registerTask',[task(3)]),/charge-unsettled/);

  assert.deepEqual(await rpc('PRODUCTION_MODEL_BUDGET','lookup',[first.moneyRef]),before);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
