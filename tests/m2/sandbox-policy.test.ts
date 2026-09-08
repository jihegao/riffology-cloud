import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyModelTurnCapability } from '../../services/model-proxy/capability.ts';
import { MODEL_PROXY_HOST, TOOL_BRIDGE_HOST, projectSandboxOutbound, sandboxActorIds, trustedPiOutbound, type InternalSandboxServices } from '../../services/sandbox/policy.ts';

const now=1_800_000_000_000,scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},identity={scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},actor={userId:'user-a',authVersion:2};
const capabilityKey='test-only-model-capability-key-with-32-bytes';
const idFor=(name:string)=>`id-${name}`;
function services(log:{binding:string;request:Request}[]):InternalSandboxServices{
  const binding=(name:string)=>({fetch:async(request:Request)=>{log.push({binding:name,request});return Response.json({binding:name});},connect(){throw Error('connect-disabled');}} as Fetcher);
  return {MODEL_PROXY:binding('MODEL_PROXY'),TOOL_BRIDGE:binding('TOOL_BRIDGE'),TRUSTED_PI_SANDBOX:{idFromName:name=>({toString:()=>idFor(name)})},M2_MODEL_PROXY_REQUEST_KEY:'test-only-model-proxy-request-key-32-bytes',M2_TOOL_BRIDGE_REQUEST_KEY:'test-only-tool-bridge-request-key-32-bytes',M2_MODEL_TURN_CAPABILITY_KEY:capabilityKey,M2_MODEL_BUDGET_POLICY_VERSION:'policy-v1',M2_MODEL_PROVIDER:'provider-a',M2_MODEL_ID:'model-a',M2_MODEL_MAX_INPUT_TOKENS_PER_CALL:'4096',M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL:'512',M2_MODEL_CAPABILITY_TTL_MS:'60000'};
}
function invocation(overrides:Record<string,unknown>={}){return {schemaVersion:1,identity,actor,callId:'call-a',requestId:'request-a',deadlineAt:now+30_000,inputTokenUpperBound:100,inputBoundVersion:'utf8-bytes-v1',maxOutputTokens:20,payload:{input:'hello',stream:true},...overrides};}
async function container(){return idFor((await sandboxActorIds(scope,'turn-a','dispatch-a')).trustedPi);}

test('actor ids are deterministic, role separated, SDK-safe and bind scope plus dispatch',async()=>{
  const a=await sandboxActorIds(scope,'turn-a','dispatch-a'),again=await sandboxActorIds(scope,'turn-a','dispatch-a'),changed=await sandboxActorIds({...scope,workspaceGeneration:2},'turn-a','dispatch-a');
  assert.deepEqual(a,again);assert.notEqual(a.trustedPi,a.project);assert.notDeepEqual(a,changed);for(const id of Object.values(a))assert.match(id,/^[a-z0-9-]{1,63}$/);
});
test('platform boundary issues a short capability, strips identity and rebuilds the model request',async()=>{
  const log:{binding:string;request:Request}[]=[],env=services(log),containerId=await container(),response=await trustedPiOutbound(new Request(`https://${MODEL_PROXY_HOST}/v1/responses`,{method:'POST',headers:{authorization:'Bearer caller-controlled',cookie:'x=y','x-riffology-sandbox-role':'project','x-riffology-request-mac':'forged'},body:JSON.stringify(invocation())}),env,containerId,()=>now);
  assert.equal(response.status,200);assert.equal(log.length,1);const sent=log[0]!,capability=sent.request.headers.get('x-riffology-model-capability')!;assert.equal(sent.binding,'MODEL_PROXY');assert.equal(sent.request.headers.get('authorization'),null);assert.equal(sent.request.headers.get('cookie'),null);assert.equal(sent.request.headers.get('x-riffology-sandbox-id'),containerId);assert.equal(sent.request.headers.get('x-riffology-sandbox-role'),'trusted-pi');assert.equal(sent.request.headers.get('x-riffology-request-at'),String(now));assert.match(sent.request.headers.get('x-riffology-request-mac')??'',/^[a-f0-9]{64}$/);
  const claims=await verifyModelTurnCapability(capabilityKey,capability,(await sandboxActorIds(scope,'turn-a','dispatch-a')).trustedPi,now);assert.deepEqual(claims.identity,identity);assert.deepEqual(claims.actor,actor);assert.equal(claims.provider,'provider-a');assert.equal(claims.model,'model-a');assert.equal(claims.budgetPolicyVersion,'policy-v1');
  const forwarded=await sent.request.json() as Record<string,unknown>;assert.deepEqual(Object.keys(forwarded),['schemaVersion','callId','requestId','deadlineAt','inputTokenUpperBound','inputBoundVersion','maxOutputTokens','payload']);assert.equal('identity' in forwarded,false);assert.equal('actor' in forwarded,false);assert.deepEqual(forwarded.payload,{input:'hello',stream:true});
});
test('tool requests retain their signed payload but no caller headers',async()=>{
  const log:{binding:string;request:Request}[]=[],env=services(log),containerId=await container(),response=await trustedPiOutbound(new Request(`https://${TOOL_BRIDGE_HOST}/v1/tool`,{method:'POST',headers:{authorization:'Bearer forged',cookie:'x=y'},body:'{"tool":1}'}),env,containerId,()=>now);
  assert.equal(response.status,200);const sent=log[0]!;assert.equal(sent.binding,'TOOL_BRIDGE');assert.equal(sent.request.headers.get('authorization'),null);assert.equal(sent.request.headers.get('cookie'),null);assert.equal(sent.request.headers.get('x-riffology-model-capability'),null);assert.match(sent.request.headers.get('x-riffology-request-mac')??'',/^[a-f0-9]{64}$/);assert.deepEqual(await sent.request.json(),{tool:1});
});
test('trusted outbound rejects route variants, oversized bodies, forged Turn identity and excessive model bounds before dispatch',async()=>{
  const log:{binding:string;request:Request}[]=[],env=services(log),containerId=await container(),bad=[
    new Request('https://example.com/v1/tool',{method:'POST',body:'{}'}),new Request(`https://${TOOL_BRIDGE_HOST}/admin`,{method:'POST',body:'{}'}),new Request(`https://${TOOL_BRIDGE_HOST}/v1/tool?x=1`,{method:'POST',body:'{}'}),new Request(`https://${TOOL_BRIDGE_HOST}/v1/tool`,{method:'GET'}),new Request(`https://${TOOL_BRIDGE_HOST}/v1/tool`,{method:'POST',headers:{'content-length':'2000000'},body:'{}'}),
    new Request(`https://${MODEL_PROXY_HOST}/v1/responses`,{method:'POST',body:JSON.stringify(invocation({identity:{...identity,dispatchId:'dispatch-b'}}))}),new Request(`https://${MODEL_PROXY_HOST}/v1/responses`,{method:'POST',body:JSON.stringify(invocation({maxOutputTokens:513}))}),new Request(`https://${MODEL_PROXY_HOST}/v1/responses`,{method:'POST',body:JSON.stringify({...invocation(),provider:'attacker'})}),
  ];
  for(const request of bad)await assert.rejects(trustedPiOutbound(request,env,containerId,()=>now),/denied|too-large|invalid-model-invocation|limit-denied/);assert.equal(log.length,0);
});
test('invalid release policy fails before issuing a capability or contacting the model service',async()=>{
  const log:{binding:string;request:Request}[]=[],env={...services(log),M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL:'0'};
  await assert.rejects(trustedPiOutbound(new Request(`https://${MODEL_PROXY_HOST}/v1/responses`,{method:'POST',body:JSON.stringify(invocation())}),env,await container(),()=>now),/release-policy/);assert.equal(log.length,0);
});
test('project Sandbox outbound is always denied without contacting an internal service',()=>{const response=projectSandboxOutbound();assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');});
