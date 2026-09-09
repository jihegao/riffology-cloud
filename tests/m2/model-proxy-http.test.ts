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

type Log = { reserves: ModelCallRequest[]; dispatches: number; unknown: number; terminals: ModelCallTerminal[] };
function record(request: ModelCallRequest): ModelCallRecord {
  return {
    identity: request.identity, callId: request.callId, requestId: request.requestId,
    digest: 'd'.repeat(64), reservationId: 'reservation-a', status: 'reserved',
  } as ModelCallRecord;
}
function environment(log: Log): ModelProxyHttpEnv {
  let dispatched = false;
  return {
    M2_MODEL_PROXY_REQUEST_KEY: requestKey,
    M2_MODEL_TURN_CAPABILITY_KEY: capabilityKey,
    TRUSTED_PI_SANDBOX: { idFromName: name => ({ toString: () => idFor(name) }) },
    TENANT_MODEL_BUDGET: { getByName: () => ({
      async reserve(_tenantId, request) { log.reserves.push(request); return { record: record(request), replayed: dispatched }; },
      async dispatch(_tenantId, reference) {
        log.dispatches++;
        if (dispatched) return { authorized: false, observeOnly: true, record: { ...record(log.reserves.at(-1)!), ...reference, status: 'dispatched' } };
        dispatched = true;
        return { authorized: true, observeOnly: false, record: { ...record(log.reserves.at(-1)!), ...reference, status: 'dispatched' } };
      },
      async markUnknown() { log.unknown++; return { ...record(log.reserves.at(-1)!), status: 'unknown' }; },
      async finish(_tenantId, _reference, terminal) { log.terminals.push(terminal); return { ...record(log.reserves.at(-1)!), status: terminal.outcome, terminal }; },
    }) },
  };
}
function log(): Log { return { reserves: [], dispatches: 0, unknown: 0, terminals: [] }; }
async function signedRequest(overrides: { body?: Record<string, unknown>; at?: number; containerId?: string; mac?: string; capability?: string; path?: string } = {}): Promise<Request> {
  const trustedPiActorId = (await sandboxActorIds(identity.scope, identity.turnId, identity.dispatchId)).trustedPi;
  const capability = overrides.capability ?? await issueModelTurnCapability(capabilityKey, {
    schemaVersion: 1, purpose: 'product-model-turn', capabilityId: 'capability-a', identity, actor, trustedPiActorId,
    budgetPolicyVersion: 'policy-v1', provider: 'provider-a', model: 'model-a', maxInputTokensPerCall: 100, maxOutputTokensPerCall: 20,
    issuedAt: now - 1_000, expiresAt: now + 60_000,
  }, now);
  const input = overrides.body ?? { schemaVersion: 1, callId: 'call-a', requestId: 'request-a', deadlineAt: now + 30_000, inputTokenUpperBound: 60, inputBoundVersion: 'bound-v1', maxOutputTokens: 20, payload: { input: 'hello', tools: [] } };
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

test('private model endpoint binds MAC, capability, container and tenant budget before provider dispatch', async () => {
  const ledger = log(), calls: unknown[] = [];
  const response = await handleModelProxyRequest(await signedRequest(), environment(ledger), provider(calls), () => now);
  assert.equal(response.status, 200); assert.match(await response.text(),/response\.completed/);assert.equal(response.headers.get('content-type'),'text/event-stream');
  assert.equal(calls.length, 1); assert.equal(ledger.reserves.length, 1); assert.equal(ledger.dispatches, 1);
  assert.deepEqual(Object.keys(calls[0] as Record<string, unknown>).sort(), ['deadlineAt','idempotencyKey','inputTokenUpperBound','maxOutputTokens','model','payload','provider','providerSessionId','signal']);
  assert.match((calls[0] as {providerSessionId:string}).providerSessionId,/^ses_[a-f0-9]{26}$/);
  assert.equal(ledger.reserves[0]!.provider, 'provider-a'); assert.equal(ledger.reserves[0]!.model, 'model-a');
  assert.equal(ledger.reserves[0]!.budgetPolicyVersion, 'policy-v1'); assert.equal(ledger.terminals[0]!.usage.kind, 'verified');
});

test('replay after dispatch is observe-only and never invokes the provider twice', async () => {
  const ledger = log(), calls: unknown[] = [], env = environment(ledger);
  assert.equal((await handleModelProxyRequest(await signedRequest(), env, provider(calls), () => now)).status, 200);
  const replay = await handleModelProxyRequest(await signedRequest(), env, provider(calls), () => now);
  assert.equal(replay.status, 409); assert.deepEqual(await replay.json(), { error: 'model_call_observe_only', status: 'dispatched' });
  assert.equal(calls.length, 1);
});

test('concurrent signed replay reaches the durable fence but invokes the provider once', async () => {
  const ledger = log(), calls: unknown[] = [], env = environment(ledger), model = provider(calls);
  const responses = await Promise.all([
    handleModelProxyRequest(await signedRequest(), env, model, () => now),
    handleModelProxyRequest(await signedRequest(), env, model, () => now),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(calls.length, 1);
});

test('forged, stale, cross-container and caller-selected model requests fail before budget or provider', async () => {
  const candidates = [
    await signedRequest({ mac: '0'.repeat(64) }),
    await signedRequest({ at: now - 30_001 }),
    await signedRequest({ containerId: 'id-wrong-container' }),
    await signedRequest({ body: { schemaVersion: 1, callId: 'call-a', requestId: 'request-a', deadlineAt: now + 30_000, inputTokenUpperBound: 60, inputBoundVersion: 'bound-v1', maxOutputTokens: 20, payload: { model: 'attacker-model' } } }),
  ];
  for (const candidate of candidates) {
    const ledger = log(), calls: unknown[] = [], response = await handleModelProxyRequest(candidate, environment(ledger), provider(calls), () => now);
    assert.equal(response.status, 403); assert.equal(ledger.reserves.length, 0); assert.equal(calls.length, 0);
  }
});

test('unconfigured provider fails before reservation and provider uncertainty is durably marked unknown', async () => {
  const noProviderLedger = log();
  assert.equal((await handleModelProxyRequest(await signedRequest(), environment(noProviderLedger), null, () => now)).status, 503);
  assert.equal(noProviderLedger.reserves.length, 0);

  const ledger = log(), calls: unknown[] = [], env = environment(ledger);
  assert.equal((await handleModelProxyRequest(await signedRequest(), env, provider(calls, true), () => now)).status, 503);
  assert.equal(ledger.unknown, 1);
  assert.equal((await handleModelProxyRequest(await signedRequest(), env, provider(calls), () => now)).status, 409);
  assert.equal(calls.length, 1);
});

test('vertical telemetry distinguishes provider dispatch from budget finish failure without request content',async()=>{
  const ledger=log(),calls:unknown[]=[],events:Record<string,unknown>[]=[],env=environment(ledger),original=env.TENANT_MODEL_BUDGET.getByName;
  env.TENANT_MODEL_BUDGET={getByName(name){const budget=original(name);return {...budget,async finish(){throw Error('model-call-finish-unavailable');}};}};
  const response=await handleModelProxyRequest(await signedRequest(),env,provider(calls),()=>now,event=>events.push(event));assert.equal(response.status,503);assert.equal(ledger.unknown,1);
  assert.deepEqual(events.map(event=>event.event),['provider-dispatch-result','model-call-failure']);assert.equal(events[0]!.status,200);assert.equal(events[1]!.stage,'budget-finish');assert.equal(events[1]!.errorCode,'model-call-finish-unavailable');assert.doesNotMatch(JSON.stringify(events),/hello|capability|request-a/);
});

test('route variants are absent and capability bounds reject before the budget', async () => {
  const ledger = log(), calls: unknown[] = [];
  assert.equal((await handleModelProxyRequest(await signedRequest({ path: '/v1/responses?x=1' }), environment(ledger), provider(calls), () => now)).status, 404);
  const oversized = await signedRequest({ body: { schemaVersion: 1, callId: 'call-a', requestId: 'request-a', deadlineAt: now + 30_000, inputTokenUpperBound: 101, inputBoundVersion: 'bound-v1', maxOutputTokens: 20, payload: { input: 'hello' } } });
  assert.equal((await handleModelProxyRequest(oversized, environment(ledger), provider(calls), () => now)).status, 403);
  assert.equal(ledger.reserves.length, 0); assert.equal(calls.length, 0);
});
