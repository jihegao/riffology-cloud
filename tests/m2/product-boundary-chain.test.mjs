import assert from 'node:assert/strict';
import test from 'node:test';
import { handleModelProxyRequest } from '../../services/model-proxy/http.ts';
import { sandboxActorIds, trustedPiOutbound } from '../../services/sandbox/policy.ts';
import { handleToolBridgeRequest } from '../../services/tools/http.ts';
import { toolCommandDigest } from '../../services/tools/protocol.ts';
import { createProductModelTransport, PRODUCT_MODEL_PROXY_URL } from '../../services/trusted-pi/product-model-transport.mjs';
import { createProductToolBridge } from '../../services/trusted-pi/product-tool-bridge.mjs';

const now=1_800_000_000_000;
const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:3};
const requestKey='test-only-model-request-key-with-32-bytes',toolKey='test-only-tool-request-key-with-32-bytes',capabilityKey='test-only-model-capability-key-with-32-bytes';
const idFor=name=>`id-${name}`;
const namespace={idFromName:name=>({toString:()=>idFor(name)})};
async function containerId(){return idFor((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).trustedPi);}

function budget(log){let saved=null,dispatched=false;return {getByName:name=>{log.budgetActors.push(name);return {
  async reserve(_tenant,request){saved=request;log.reservations.push(request);return {record:{identity:request.identity,callId:request.callId,requestId:request.requestId,digest:'d'.repeat(64),reservationId:'reservation-a',status:'reserved'},replayed:false};},
  async dispatch(){assert.equal(dispatched,false);dispatched=true;return {authorized:true,observeOnly:false,record:{...saved,status:'dispatched'}};},
  async markUnknown(){throw Error('must-not-be-unknown');},
  async finish(_tenant,_reference,terminal){log.terminals.push(terminal);return {...saved,status:terminal.outcome,terminal};},
};}};}

test('Pi model transport, Sandbox outbound, capability, tenant budget and provider form one closed request chain',async()=>{
  const log={budgetActors:[],reservations:[],provider:[],terminals:[]},modelEnv={
    TRUSTED_PI_SANDBOX:namespace,TENANT_MODEL_BUDGET:budget(log),M2_MODEL_PROXY_REQUEST_KEY:requestKey,M2_MODEL_TURN_CAPABILITY_KEY:capabilityKey,
  };
  const provider={async dispatch(input){log.provider.push(input);return {status:200,providerRequestId:'provider-request-a',inputTokens:9,outputTokens:4,responseContentType:'text/event-stream',responseBody:new TextEncoder().encode('event: response.completed\ndata: {"type":"response.completed"}\n\ndata: [DONE]\n\n')};}};
  const services={
    MODEL_PROXY:{fetch:request=>handleModelProxyRequest(request,modelEnv,provider,()=>now)},TOOL_BRIDGE:{fetch(){throw Error('wrong-service');}},TRUSTED_PI_SANDBOX:namespace,
    M2_MODEL_PROXY_REQUEST_KEY:requestKey,M2_TOOL_BRIDGE_REQUEST_KEY:toolKey,M2_MODEL_TURN_CAPABILITY_KEY:capabilityKey,M2_MODEL_BUDGET_POLICY_VERSION:'m2-token-v1',M2_MODEL_PROVIDER:'opencode-go',M2_MODEL_ID:'gpt-5.6-luna',M2_MODEL_MAX_INPUT_TOKENS_PER_CALL:'262144',M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL:'4096',M2_MODEL_CAPABILITY_TTL_MS:'120000',
  };
  const transport=createProductModelTransport({identity,actor,provider:'riffology-product',model:'gpt-5.6-luna',maxInputTokensPerCall:262144,maxOutputTokensPerCall:4096,requestTimeoutMs:120000},{clock:()=>now,fetchImpl:(input,init)=>trustedPiOutbound(new Request(input,init),services,awaitedContainer,()=>now)}),awaitedContainer=await containerId();
  const selected={provider:'riffology-product',id:'gpt-5.6-luna',api:'openai-responses',baseUrl:'https://model-proxy.riffology.internal/v1'},approved=transport.onProviderPayload({payload:{model:'gpt-5.6-luna',input:[{role:'user',content:'hello'}],stream:true,store:false},model:selected});
  const response=await transport.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer placeholder'},body:JSON.stringify(approved)});
  assert.equal(response.status,200);assert.match(await response.text(),/response\.completed/);assert.deepEqual(log.budgetActors,['tenant-model-budget:tenant-a']);assert.equal(log.reservations.length,1);assert.equal(log.provider.length,1);assert.equal(log.provider[0].provider,'opencode-go');assert.equal(log.provider[0].model,'gpt-5.6-luna');assert.equal(log.provider[0].payload.model,undefined);assert.equal(log.terminals[0].usage.kind,'verified');
});

test('Pi remote tool crosses the signed Sandbox boundary and reaches only the derived Tool Bridge actor',async()=>{
  const actors=[],commands=[],toolEnv={TRUSTED_PI_SANDBOX:namespace,TOOL_BRIDGE_AGENT:{getByName(name){actors.push(name);return {async run(command){commands.push(command);const digest=await toolCommandDigest(command);return {schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,digest,deadlineAt:command.deadlineAt,operation:command.operation,status:'completed',effectId:'effect-a',acceptedAt:now,updatedAt:now,dispatchedAt:now,unknownAt:null,finishedAt:now,lastObservedAt:now,outcome:'completed',errorCode:null,result:{entries:['model/main.py']},command:null};}};}},M2_TOOL_BRIDGE_REQUEST_KEY:toolKey};
  const services={MODEL_PROXY:{fetch(){throw Error('wrong-service');}},TOOL_BRIDGE:{fetch:request=>handleToolBridgeRequest(request,toolEnv,()=>now)},TRUSTED_PI_SANDBOX:namespace,M2_MODEL_PROXY_REQUEST_KEY:requestKey,M2_TOOL_BRIDGE_REQUEST_KEY:toolKey,M2_MODEL_TURN_CAPABILITY_KEY:capabilityKey,M2_MODEL_BUDGET_POLICY_VERSION:'m2-token-v1',M2_MODEL_PROVIDER:'opencode-go',M2_MODEL_ID:'gpt-5.6-luna',M2_MODEL_MAX_INPUT_TOKENS_PER_CALL:'262144',M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL:'4096',M2_MODEL_CAPABILITY_TTL_MS:'120000'};
  const trustedContainer=await containerId(),bridge=createProductToolBridge(identity,{clock:()=>now,fetchImpl:(input,init)=>trustedPiOutbound(new Request(input,init),services,trustedContainer,()=>now)}),result=await bridge.execute({scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},name:'project_list',toolCallId:'provider-call-a',args:{path:''}});
  assert.deepEqual(result.content,[{type:'text',text:'{"entries":["model/main.py"]}'}]);assert.equal(actors.length,1);assert.match(actors[0],/^m2-b-/);assert.equal(commands.length,1);assert.equal(commands[0].operation,'list');assert.deepEqual(commands[0].scope,identity.scope);
});
