import {profile} from './production-profile-fixture.ts';
import {profileDigest} from '../../services/model-proxy/production-profile.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelCallReference, type ModelCallRecord, type ModelCallRequest, type ModelCallTerminal } from '../../services/model-budget/core.ts';
import { issueModelTurnCapability } from '../../services/model-proxy/capability.ts';
import { handleModelProxyRequest, type ModelProxyHttpEnv, type ProductModelProvider } from '../../services/model-proxy/http.ts';
import { signTrustedModelRequest } from '../../services/model-proxy/internal-auth.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';

const now = 1_800_000_000_000;
const requestKey = 'test-only-model-request-key-with-32-bytes';
const capabilityKey = 'test-only-model-capability-key-with-32-bytes';
const identity = { scope: { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 2 }, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 2 };
const actor = { userId: 'user-a', authVersion: 3 };
const idFor = (name: string) => `id-${name}`;

type Log = { reserves: ModelCallRequest[]; dispatches: number; unknown: number; terminals: ModelCallTerminal[]; failures: unknown[] };
function record(request: ModelCallRequest): ModelCallRecord {
  return {
    identity: request.identity, callId: request.callId, requestId: request.requestId,
    digest: 'd'.repeat(64), reservationId: 'reservation-a', status: 'reserved',
  } as ModelCallRecord;
}
function environment(log: Log): ModelProxyHttpEnv {
  const dispatched=new Set<string>();
  return {
    M2_MODEL_PROXY_REQUEST_KEY: requestKey,
    M2_MODEL_TURN_CAPABILITY_KEY: capabilityKey,
    TRUSTED_PI_SANDBOX: { idFromName: name => ({ toString: () => idFor(name) }) },
    TENANT_MODEL_BUDGET: { getByName: () => ({
      async reserve(_tenantId, request) { log.reserves.push(request); return { record: record(request), replayed: dispatched.has(request.callId) }; },
      async dispatch(_tenantId, reference) {
        log.dispatches++;
        if (dispatched.has(reference.callId)) return { authorized: false, observeOnly: true, record: { ...record(log.reserves.at(-1)!), ...reference, status: 'dispatched' } };
        dispatched.add(reference.callId);
        return { authorized: true, observeOnly: false, record: { ...record(log.reserves.at(-1)!), ...reference, status: 'dispatched' } };
      },
      async markUnknown() { log.unknown++; return { ...record(log.reserves.at(-1)!), status: 'unknown' }; },
      async finish(_tenantId, _reference, terminal) { log.terminals.push(terminal); return { ...record(log.reserves.at(-1)!), status: terminal.outcome, terminal }; },
    }) },
  };
}
function log(): Log { return { reserves: [], dispatches: 0, unknown: 0, terminals: [], failures: [] }; }
async function signedRequest(overrides: { body?: Record<string, unknown>; at?: number; containerId?: string; mac?: string; capability?: string; path?: string } = {}): Promise<Request> {
  const trustedPiActorId = (await sandboxActorIds(identity.scope, identity.turnId, identity.dispatchId)).trustedPi;
  const capability = overrides.capability ?? await issueModelTurnCapability(capabilityKey, {
    schemaVersion: 1, purpose: 'product-model-turn', capabilityId: 'capability-a', identity, actor, trustedPiActorId,
    budgetPolicyVersion: 'policy-v1', provider: 'openai', model: profile.model, maxInputTokensPerCall: 8192, maxOutputTokensPerCall: 20,
    issuedAt: now - 1_000, expiresAt: now + 60_000,
  }, now);
  const input = overrides.body ?? { schemaVersion: 1, callId: 'call-a', requestId: 'request-a', deadlineAt: now + 30_000, inputTokenUpperBound: 8192, inputBoundVersion: 'utf8-provider-payload-plus-4096-v1', maxOutputTokens: 20, payload: { input: 'hello', tools: [] } };
  const body = new TextEncoder().encode(JSON.stringify(input)).buffer as ArrayBuffer;
  const containerId = overrides.containerId ?? idFor(trustedPiActorId), at = overrides.at ?? now;
  const mac = overrides.mac ?? await signTrustedModelRequest(requestKey, containerId, at, capability, body);
  return new Request(`https://model-proxy.riffology.internal${overrides.path ?? '/v1/responses'}`, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-riffology-sandbox-role': 'trusted-pi', 'x-riffology-sandbox-id': containerId,
    'x-riffology-request-at': String(at), 'x-riffology-request-mac': mac, 'x-riffology-model-capability': capability,
  }, body });
}
function provider(calls: unknown[], fail = false): ProductModelProvider { return { async dispatch(input) {
  calls.push(input); if (fail) throw Error('provider-response-unknown');
  return { status: 200, providerRequestId: 'provider-request-a', inputTokens: 7, outputTokens: 3, responseContentType:'text/event-stream',responseBody:new TextEncoder().encode('data: {"type":"response.completed"}\n\ndata: [DONE]\n\n') };
} }; }

async function g5Environment(ledger:Log,order:string[],failAt=''){
 const env=environment(ledger),legacy=env.TENANT_MODEL_BUDGET;
 env.TENANT_MODEL_BUDGET={getByName(){throw Error('legacy-namespace-must-not-be-used');}};
 const token=legacy.getByName('fixture');
 env.G5_TOKEN_BUDGET={getByName(){return {
 ...token,async reserve(t,r){order.push('token-reserve');return token.reserve(t,r);},
 async dispatch(t,r){order.push('token-dispatch');return token.dispatch(t,r);},
 async finish(t,r,u){order.push('token-finish');return token.finish(t,r,u);},
 };}};
 const step=(name:string)=>{order.push(name);if(name===failAt)throw Error('lost-private-ack');};
 env.G5_CONTROLLED_WINDOW_JSON='configured';
 env.G5_WINDOW_GUARD={getByName(){return {
 async lookupTrustedTurnRoute(){step('route');return {kind:'g5',taskKey:'a'.repeat(64),windowId:'window-a',profileSha256:await profileDigest(profile)};},
 async reserveTrustedCall(){step('global-reserve');return {callKey:'c'.repeat(64),windowId:'window-a',deadlineAt:now+20000,replayed:false,mayDispatch:false};},
 async bindTrustedMoney(){step('money-bind');},async claimTrustedDispatch(){step('global-claim');return {authorized:true,deadlineAt:now+20000};},
 async settleTrustedCall(){step('global-settle');},async markUnknown(_key,failure){order.push('global-unknown');ledger.failures.push(failure);},
 };}};
 env.PRODUCTION_MODEL_BUDGET={getByName(){return {
 async admit(){step('money-admit');return {accepted:true,record:{key:'m'.repeat(64),digest:'d'.repeat(64)}};},
 async dispatch(){step('money-dispatch');return {authorized:true};},
 async finish(){step('money-finish');},async markUnknown(){order.push('money-unknown');},
 } as never;}};
 return env;
}
test('real proxy gate chooses trusted G5 namespace and commits ordered chain before returning bytes',async()=>{
 const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order),calls:unknown[]=[];
 const model={...provider(calls),productionProfile:profile};
 assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,200);
 assert.deepEqual(order,['route','token-reserve','global-reserve','money-admit','money-dispatch','money-bind','global-claim','token-dispatch','money-finish','token-finish','global-settle']);
 assert.equal(calls.length,1);assert.equal((calls[0] as {dispatchAdmissionDeadlineAt:number}).dispatchAdmissionDeadlineAt,now+20000);
 const body={schemaVersion:1,callId:'call-b',requestId:'request-b',deadlineAt:now+30000,inputTokenUpperBound:8192,inputBoundVersion:'utf8-provider-payload-plus-4096-v1',maxOutputTokens:20,payload:{input:'continue',tools:[]}};
 assert.equal((await handleModelProxyRequest(await signedRequest({body}),env,model,()=>now)).status,200);assert.equal(calls.length,2);
});
test('private ACK loss before provider fences globally; lost settlement after provider is not replayed',async()=>{
 for(const stage of ['global-reserve','money-admit','money-dispatch','money-bind','global-claim','global-settle']){
  const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order,stage),calls:unknown[]=[];
  const response=await handleModelProxyRequest(await signedRequest(),env,{...provider(calls),productionProfile:profile},()=>now);
  assert.ok([409,503].includes(response.status));assert.equal(calls.length,stage==='global-settle'?1:0);assert.equal(ledger.unknown,1);
  if(stage!=='global-reserve'){assert.ok(order.includes('global-unknown'));assert.deepEqual(ledger.failures,[{schemaVersion:1,stage:stage==='global-settle'?'budget-finish':'admission',errorCode:'unclassified',observedAt:now}]);}
 }
});
test('route lookup loss refuses before reservation and legacy path remains untouched with no G5 config',async()=>{
 const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order,'route'),calls:unknown[]=[];
 assert.equal((await handleModelProxyRequest(await signedRequest(),env,{...provider(calls),productionProfile:profile},()=>now)).status,403);
 assert.equal(ledger.reserves.length,0);assert.equal(calls.length,0);
});
test('provider loss marks all existing fences unknown and same signed replay cannot resend',async()=>{
 const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order),calls:unknown[]=[];
 const model={...provider(calls,true),productionProfile:profile};
 assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,503);
 assert.ok(order.includes('global-unknown'));assert.ok(order.includes('money-unknown'));assert.equal(ledger.unknown,1);assert.deepEqual(ledger.failures,[{schemaVersion:1,stage:'provider-dispatch',errorCode:'unclassified',observedAt:now}]);
 assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,409);assert.equal(calls.length,1);
});
test('trusted registered route cannot select another profile or silently use legacy token authority',async()=>{
 const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order),calls:unknown[]=[];
 const original=env.G5_WINDOW_GUARD!.getByName('fixture');
 env.G5_WINDOW_GUARD={getByName(){return {...original,async lookupTrustedTurnRoute(){return {kind:'g5',taskKey:'a'.repeat(64),windowId:'window-a',profileSha256:'f'.repeat(64)};}};}};
 assert.equal((await handleModelProxyRequest(await signedRequest(),env,{...provider(calls),productionProfile:profile},()=>now)).status,403);
 assert.equal(ledger.reserves.length,0);assert.equal(calls.length,0);
});

test('upstream status survives settlement refusal without leaking bodies or replaying dispatch',async()=>{
 for(const status of [400,401,403,429,500,502,503]){
  const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order,'global-settle');
  let dispatches=0;
  const model:ProductModelProvider={productionProfile:profile,async dispatch(){
   dispatches++;
   return {status,providerRequestId:'private-provider-request',inputTokens:null,outputTokens:null,responseContentType:'application/json',responseBody:new TextEncoder().encode('{"error":"private-upstream-body"}')};
  }};
  assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,503);
  assert.deepEqual(ledger.failures,[{schemaVersion:1,stage:'budget-finish',errorCode:`upstream-http-${status}:unclassified`,observedAt:now}]);
  assert.equal(ledger.terminals[0]!.usage.kind,'unknown');
  assert.ok(order.includes('money-unknown'));assert.equal(ledger.unknown,1);
  assert.doesNotMatch(JSON.stringify(ledger.failures),/private-provider-request|private-upstream-body/);
  assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,409);
  assert.equal(dispatches,1);
 }
});
test('only allowlisted provider hints reach the private failure receipt',async()=>{
 for(const hint of ['unsupported_value:prompt_cache_retention','invalid_value:prompt_cache_options','private-secret',undefined]){
  const ledger=log(),order:string[]=[],env=await g5Environment(ledger,order,'global-settle');
  const model:ProductModelProvider={productionProfile:profile,async dispatch(){return {status:400,providerErrorHint:hint,providerRequestId:'private-request',inputTokens:null,outputTokens:null,responseContentType:'application/json',responseBody:new TextEncoder().encode('private-body')};}};
  assert.equal((await handleModelProxyRequest(await signedRequest(),env,model,()=>now)).status,503);
  const kept=hint?.includes(':prompt_cache_')?hint+':':'';
  assert.deepEqual(ledger.failures,[{schemaVersion:1,stage:'budget-finish',errorCode:`upstream-http-400:${kept}unclassified`,observedAt:now}]);
  assert.equal(ledger.terminals[0]!.usage.kind,'unknown');assert.ok(order.includes('money-unknown'));
  assert.doesNotMatch(JSON.stringify(ledger.failures),/private/);
 }
});
