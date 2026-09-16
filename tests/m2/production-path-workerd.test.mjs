import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { profile } from './production-profile-fixture.ts';
import { profileDigest } from '../../services/model-proxy/production-profile.ts';
import { issueModelTurnCapability } from '../../services/model-proxy/capability.ts';
import { signTrustedModelRequest } from '../../services/model-proxy/internal-auth.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
const requestKey='test-only-model-request-key-with-32-bytes',capabilityKey='test-only-model-capability-key-with-32-bytes';
const identity=turnId=>({scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId,dispatchId:'dispatch-a',generation:1});
async function signed(turnId){const now=Date.now(),i=identity(turnId),trustedPiActorId=(await sandboxActorIds(i.scope,i.turnId,i.dispatchId)).trustedPi;const capability=await issueModelTurnCapability(capabilityKey,{schemaVersion:1,purpose:'product-model-turn',capabilityId:'capability-a',identity:i,actor:{userId:'user-a',authVersion:1},trustedPiActorId,budgetPolicyVersion:'tokens-v1',provider:'openai',model:profile.model,maxInputTokensPerCall:10000,maxOutputTokensPerCall:100,issuedAt:now-1000,expiresAt:now+60000},now);const body=new TextEncoder().encode(JSON.stringify({schemaVersion:1,callId:'call-a',requestId:`request-${turnId}`,deadlineAt:now+30000,inputTokenUpperBound:5000,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',maxOutputTokens:20,payload:{input:'fixture-prompt',stream:true,store:false}}));const containerId=`id-${trustedPiActorId}`,mac=await signTrustedModelRequest(requestKey,containerId,now,capability,body.buffer);return {body:new TextDecoder().decode(body),headers:{'content-type':'application/json','x-riffology-sandbox-role':'trusted-pi','x-riffology-sandbox-id':containerId,'x-riffology-request-at':String(now),'x-riffology-request-mac':mac,'x-riffology-model-capability':capability}};}

test('real Workerd money + token authorities preserve crash holds, explicit release, response loss and stop across restart',{timeout:60000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'production-money-workerd-'));let mf;
 const bundle=await build({stdin:{contents:`
 import {handleModelProxyRequest} from './services/model-proxy/http.ts';
 import {OpenAIGatewayResponsesProvider} from './services/model-proxy/openai-gateway-responses.ts';
 import {modelBudgetTenantName} from './services/model-budget/core.ts';
 import {PRODUCTION_MONEY_ACTOR,moneyReference} from './services/model-budget/production-money.ts';
 import {profile} from './tests/m2/production-profile-fixture.ts';
 export {TenantModelBudget} from './services/model-budget/durable.ts';
 export {ProductionModelBudget} from './services/model-budget/production-durable.ts';
 let calls=0;
 export default {async fetch(request,env){
  const {signed,mode,identity,reference}=await request.json();
  const money=env.PRODUCTION_MODEL_BUDGET.getByName(PRODUCTION_MONEY_ACTOR),tokens=env.TENANT_MODEL_BUDGET.getByName(modelBudgetTenantName('tenant-a'));
  if(mode==='lookup')return Response.json({money:await money.lookup(reference),tokens:await tokens.snapshot('tenant-a',identity),calls});
  let moneyRef;
  const m={
   async admit(v){const r=await money.admit(v);if(r.accepted)moneyRef=moneyReference(r.record);if(mode==='money-admit-loss')throw Error('lost money ACK');return r;},
   async dispatch(r){const out=await money.dispatch(r);if(mode==='money-dispatch-loss')throw Error('lost fence ACK');return out;},
   markUnknown:(...a)=>money.markUnknown(...a),finish:(...a)=>money.finish(...a),releaseUndispatched:(...a)=>money.releaseUndispatched(...a)
  };
  const t={reserve:(...a)=>tokens.reserve(...a),async dispatch(...a){
   if(mode==='token-denied')await tokens.releaseUndispatched(a[0],a[1],{confirmationId:'fixture-proof',reason:'cancelled-before-dispatch',observedAt:Date.now()});
   const out=await tokens.dispatch(...a);if(mode==='token-dispatch-loss')throw Error('lost token ACK');return out;},
   async finish(...a){const out=await tokens.finish(...a);if(mode==='finish-loss'||mode==='429-finish-loss')throw Error('lost finish ACK');return out;},markUnknown:(...a)=>tokens.markUnknown(...a),releaseUndispatched:(...a)=>tokens.releaseUndispatched(...a)
  };
  const provider=new OpenAIGatewayResponsesProvider({profile,providerKey:'fixture-provider-key',gatewayKey:'fixture-gateway-key',fetch:async()=>{calls++;if(mode==='upstream-loss')throw Error('delivery unknown');if(mode==='429'||mode==='429-finish-loss')return new Response('upstream secret',{status:429});if(mode==='missing-usage')return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp-fixture',status:'completed'}})+'\\n\\n',{headers:{'content-type':'text/event-stream'}});if(mode==='malformed-stream')return new Response('data: nope\\n\\n',{headers:{'content-type':'text/event-stream'}});return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp-fixture',status:'completed',usage:{input_tokens:10,output_tokens:16}}})+'\\n\\n',{headers:{'content-type':'text/event-stream'}});}});
  const response=await handleModelProxyRequest(new Request('https://model-proxy.riffology.internal/v1/responses',{method:'POST',headers:signed.headers,body:signed.body}),{...env,TRUSTED_PI_SANDBOX:{idFromName:name=>({toString:()=> 'id-'+name})},TENANT_MODEL_BUDGET:{getByName:()=>t},PRODUCTION_MODEL_BUDGET:{getByName:()=>m}},provider);
  return Response.json({status:response.status,body:await response.text(),reference:moneyRef,money:moneyRef?await money.lookup(moneyRef):null,tokens:await tokens.snapshot('tenant-a',identity),calls});
 }};`,resolveDir:fileURLToPath(new URL('../..',import.meta.url)),sourcefile:'production-workerd.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const hash=await profileDigest(profile);
 const options=(enabled=true,cap=100000)=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'production-fixture',compatibilityDate:'2026-09-06',manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{...Object.fromEntries(Object.entries({M2_MODEL_PROXY_REQUEST_KEY:requestKey,M2_MODEL_TURN_CAPABILITY_KEY:capabilityKey,MODEL_BUDGET_POLICY_VERSION:'tokens-v1',MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN:'8',MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN:'8',MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL:'10000',MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL:'100',MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN:'10000',PRODUCTION_MODEL_ENABLED:String(enabled),PRODUCTION_MONEY_POLICY_JSON:JSON.stringify({version:cap===100000?'policy-v1':'policy-cap',period:'2026-09',profileSha256:hash,caps:{turn:cap,user:cap,tenant:cap,global:cap}})}).map(([k,value])=>[k,{type:'text',value}])),TENANT_MODEL_BUDGET:{type:'durable-object',worker:'production-fixture',exportName:'TenantModelBudget'},PRODUCTION_MODEL_BUDGET:{type:'durable-object',worker:'production-fixture',exportName:'ProductionModelBudget'}},exports:{TenantModelBudget:{type:'durable-object',storage:'sqlite'},ProductionModelBudget:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound denied',{status:403})}}}]});
 const invoke=async(s,mode,turnId,reference)=>{const r=await mf.dispatchFetch('http://fixture.test/',{method:'POST',body:JSON.stringify({signed:s,mode,identity:identity(turnId),reference})});assert.equal(r.status,200);return r.json();};
 try{
  mf=new Miniflare(options());await mf.ready;let total=0;
  for(const [mode,state,delta,errorCategory] of [['money-admit-loss','reserved',0,null],['money-dispatch-loss','unknown',0,'outcome-unknown'],['token-dispatch-loss','unknown',0,'outcome-unknown'],['upstream-loss','unknown',1,'outcome-unknown'],['missing-usage','unknown',1,'missing-usage'],['malformed-stream','unknown',1,'malformed-stream'],['429','unknown',1,'rate-limited'],['429-finish-loss','unknown',1,'rate-limited'],['finish-loss','recorded',1,null],['token-denied','released',0,null]]){
   const s=await signed(mode),result=await invoke(s,mode,mode);total+=delta;assert.equal(result.calls,total,mode);assert.equal(result.money.state,state,mode);assert.equal(result.money.errorCategory,errorCategory,mode);assert.equal(result.money.accounted,state==='released'?0:state==='recorded'?100:10100,mode);
   const replay=await invoke(s,mode,mode);assert.equal(replay.calls,total,mode+' replay');assert.notEqual(replay.status,200);
  }
  const s=await signed('completed'),completed=await invoke(s,'ok','completed');assert.equal(completed.status,200);assert.equal(completed.money.accounted,100);assert.equal(completed.tokens.records[0].status,'completed');
  await mf.dispose();mf=new Miniflare(options(false));await mf.ready;
  const restored=await invoke(null,'lookup','completed',completed.reference);assert.equal(restored.money.state,'recorded');assert.equal(restored.tokens.records[0].status,'completed');
  const stopped=await invoke(await signed('stopped'),'ok','stopped');assert.equal(stopped.calls,0);assert.equal(stopped.tokens.records[0].status,'not-dispatched');assert.equal(stopped.tokens.accountedTokens,0);
  await mf.dispose();mf=new Miniflare(options(true,1));await mf.ready;
  const denied=await invoke(await signed('cap'),'ok','cap');assert.equal(denied.calls,0);assert.equal(denied.tokens.records[0].status,'not-dispatched');assert.equal(denied.tokens.accountedTokens,0);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
