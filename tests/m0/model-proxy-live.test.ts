import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test, { beforeEach } from 'node:test';
import { GO_LIVE_BUDGET, HISTORICAL_PROFILE } from '../../spikes/m0-model-proxy/policy.ts';
import type { RunLedger } from '../../spikes/m0-model-proxy/authority.ts';

// Real Worker, capability, policy, and ledger code; only DO construction/storage
// and outbound fetch are injected. These tests are not Workerd or provider proof.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'cloudflare:workers' ? { shortCircuit: true,
    url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }') }
    : nextResolve(specifier, context);
} });
const { default: worker, M0ModelProxyRun } = await import('../../spikes/m0-model-proxy/cloud.ts');
hooks.deregister();
const NOW = GO_LIVE_BUDGET.verifiedAtMs + 60000;
const OPERATOR = 'test-operator-not-a-real-secret-1234567890';
const PROVIDER = 'test-provider-not-a-real-secret';
beforeEach(t => {
  if (!('mock' in t)) throw new Error('test-context-required');
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected-network-forbidden'); });
});
type Capability = { callId: string; token: string };
function harness(mode: 'fixture-only' | 'go-live-only' = 'go-live-only') {
  let values = new Map<string, unknown>(); const owned: Promise<unknown>[] = []; let lookups = 0;
  const runId = mode === 'go-live-only' ? GO_LIVE_BUDGET.runId : 'fixture-regression';
  const origin = mode === 'go-live-only' ? GO_LIVE_BUDGET.origin : 'https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev';
  const id = (name: string) => ({ toString: () => name, equals: (other: { toString(): string }) => other.toString() === name });
  const kv = {
    get: <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
  };
  const storage = { kv, sync: async () => {}, transactionSync<T>(fn: () => T) {
    const previous = structuredClone(values); try { return fn(); } catch (error) { values = previous; throw error; }
  } };
  let run: InstanceType<typeof M0ModelProxyRun>;
  const env = { M0_MODEL_MODE: mode, M0_CONTROL_ORIGIN: origin, PROTOCOL_VERSION: 'm0-model-proxy-v1',
    M0_PROBE_TOKEN: OPERATOR, M0_GO_API_KEY: PROVIDER,
    MODEL_RUNS: { idFromName: id, getByName: (name: string) => {
      lookups++; assert.equal(name, `m0-model-${runId}`, 'unknown run must fail before DO lookup'); return run;
    } },
  } as unknown as M0ModelProxyEnv;
  const ctx = { storage, id: id(`m0-model-${runId}`), waitUntil: (promise: Promise<unknown>) => owned.push(promise), abort() { throw new Error('test-only-do-abort'); } };
  const rebuild = () => { run = new M0ModelProxyRun(ctx as unknown as DurableObjectState, env); }; rebuild();
  const control = (action: string, method = action === 'status' ? 'GET' : 'POST', selectedRun = runId) =>
    worker.fetch(new Request(`${origin}/probe/${selectedRun}/${action}`, { method, headers: { authorization: `Bearer ${OPERATOR}` } }), env);
  const invoke = (capability: Capability, body: unknown = payload(mode), extra: Record<string, string> = {}) => worker.fetch(new Request(`${origin}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${capability.token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
  }), env);
  const cancel = (capability: Capability) => worker.fetch(new Request(`${origin}/v1/cancel`, { method: 'POST', headers: { authorization: `Bearer ${capability.token}` } }), env);
  const initialize = async () => { const response = await control('init/alpha'); assert.equal(response.status, 200); return await response.json() as { capabilities: Capability[]; mode: string; liveEnabled: boolean }; };
  return { runId, origin, env, kv, storage, rebuild, control, invoke, cancel, initialize,
    lookups: () => lookups, drain: () => Promise.all(owned), ledger: () => kv.get<RunLedger>('m0:model:ledger'), state: () => run.status(runId) };
}
function payload(mode = 'go-live-only') { return { model: mode === 'go-live-only' ? HISTORICAL_PROFILE.model : 'm0-text-fixture',
  messages: [{ role: 'user', content: 'Return the short diagnostic marker.' }], stream: true, max_tokens: mode === 'go-live-only' ? 256 : 32 }; }
function frame(content: string, finish: string | null = null, usage?: object) {
  return `data: ${JSON.stringify({ id: 'provider-response-from-test', model: HISTORICAL_PROFILE.model, object: 'chat.completion.chunk', choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
}
function completed() { return new Response(frame('marker') + frame('', 'stop', { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 }) + 'data: [DONE]\n\n',
  { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'provider-header-from-test' } }); }
async function consume(response: Response) { await response.text(); }

test('live uses an exact deployment profile and one run; fixture retains three synthetic calls even with a provider secret', async t => {
  const f = harness();
  for (const action of ['init/alpha', 'status', 'revoke']) assert.equal((await f.control(action, action === 'status' ? 'GET' : 'POST', 'other-run')).status, 404);
  assert.equal(f.lookups(), 0);
  assert.equal((await f.control('init/bravo')).status, 403); assert.equal((await f.control('arm-abort')).status, 403);
  const live = await f.initialize(); assert.equal(live.mode, 'go-live-only'); assert.equal(live.liveEnabled, true);
  assert.deepEqual(live.capabilities.map(c => c.callId), ['call-1', 'call-2']);
  assert.equal((await f.control('init/alpha')).status, 409, 'initialization cannot reset the same budget');
  const disabledEnv = { ...f.env, M0_CONTROL_ORIGIN: 'https://evil.invalid' } as unknown as M0ModelProxyEnv;
  assert.equal((await worker.fetch(new Request(f.origin + '/health'), disabledEnv)).status, 503);
  const fixture = harness('fixture-only'); const initial = await fixture.initialize();
  assert.equal(initial.liveEnabled, false); assert.equal(initial.capabilities.length, 3);
  const outbound = t.mock.method(globalThis, 'fetch', async () => { throw new Error('fixture-must-not-fetch'); });
  const first = await fixture.invoke(initial.capabilities[0]!); assert.equal(first.status, 200); await consume(first);
  // Consume a second call to exercise full terminal fixture behavior, not merely HTTP headers.
  await consume(await fixture.invoke(initial.capabilities[1]!)); await fixture.drain();
  assert.equal(outbound.mock.callCount(), 0); assert.equal(fixture.state().realProviderCalls, 0);
});

test('two live calls use fixed wire limits, full reservations and a shared ledger across reconstruction without replay', async t => {
  const f = harness(), { capabilities: caps } = await f.initialize();
  const transport = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(url, 'https://opencode.ai/zen/go/v1/chat/completions'); assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'manual');
    const headers = new Headers(options?.headers); assert.equal(headers.get('authorization'), `Bearer ${PROVIDER}`);
    assert.equal(headers.get('x-opencode-session'), 'm0-' + GO_LIVE_BUDGET.runId); assert.match(headers.get('user-agent')!, /^riffology-m0-controlled-pi\//);
    assert.equal(headers.has('x-budget'), false); assert.equal(headers.has('x-tenant-id'), false);
    const wire = JSON.parse(String(options?.body)); assert.equal(wire.max_tokens, 256); assert.deepEqual(wire.thinking, { type: 'disabled' });
    assert.deepEqual(wire.stream_options, { include_usage: true }); assert.ok(new TextEncoder().encode(String(options?.body)).byteLength <= 8192);
    return completed();
  });
  await consume(await f.invoke(caps[0]!)); await f.drain();
  assert.equal(f.ledger()?.heldMicrousd, 461712); assert.equal(f.ledger()?.calls['call-1']?.facts?.upstreamRequestId, 'provider-header-from-test');
  f.rebuild(); assert.equal((await f.invoke(caps[0]!)).status, 409); await f.drain();
  assert.equal((await f.invoke(caps[0]!, { ...payload(), temperature: 0.5 })).status, 409); await f.drain();
  await consume(await f.invoke(caps[1]!)); await f.drain();
  assert.equal(transport.mock.callCount(), 2); assert.equal(f.ledger()?.dispatchCount, 2); assert.equal(f.ledger()?.heldMicrousd, 923424);
  assert.ok(Object.values(f.ledger()!.calls).every(c => c.reservationMicrousd === 461712 && c.billingAmount === null && c.billingStatus === 'held-for-review'));
  const status = f.state(); assert.equal(status.GoQuotaDelta, null); assert.equal(status.cashCharge, null); assert.equal(status.absoluteCashCapProven, false);
  assert.equal(JSON.stringify(status).includes(PROVIDER), false); assert.equal(JSON.stringify(status).includes(caps[0]!.token), false);
});

test('invalid model, limits, URL/price headers, oversized input and early call-2 fail before provider dispatch', async t => {
  const f = harness(), { capabilities: caps } = await f.initialize();
  const transport = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must-not-dispatch'); });
  for (const extra of [{ model: 'different-model' }, { max_tokens: 255 }, { max_tokens: 257 }, { max_completion_tokens: 256 },
    { url: 'https://evil.invalid' }, { budget: 999 }, { tools: [] }, { thinking: { type: 'enabled' } },
    { messages: [{ role: 'user', content: 'x'.repeat(8193) }] }]) {
    assert.ok((await f.invoke(caps[0]!, { ...payload(), ...extra })).status >= 400); await f.drain();
  }
  for (const name of ['x-upstream-url', 'x-budget', 'x-tenant-id', 'x-api-key']) {
    assert.ok((await f.invoke(caps[0]!, payload(), { [name]: 'override' })).status >= 400); await f.drain();
  }
  assert.equal((await f.invoke(caps[1]!)).status, 409);
  assert.equal(transport.mock.callCount(), 0); assert.equal(f.ledger(), undefined);
});

test('unknown and redirect outcomes retain one full reservation, cannot replay and cannot advance to call-2', async t => {
  for (const response of ['throw', 'redirect'] as const) {
    const f = harness(), { capabilities: caps } = await f.initialize();
    const transport = t.mock.method(globalThis, 'fetch', async () => {
      if (response === 'throw') throw new Error('injected-unknown');
      return new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } });
    });
    assert.equal((await f.invoke(caps[0]!)).status, 502); await f.drain();
    assert.equal(f.ledger()?.heldMicrousd, 461712); assert.equal(f.ledger()?.dispatchCount, 1);
    f.rebuild(); assert.equal((await f.invoke(caps[0]!)).status, 409); await f.drain();
    assert.equal((await f.invoke(caps[1]!)).status, 409); assert.equal(transport.mock.callCount(), 1);
  }
});

test('explicit cancellation is call-scoped and preserves unknown terminal usage and the full two-call reservation', async t => {
  const f = harness(), { capabilities: caps } = await f.initialize(); let secondSignal: AbortSignal | undefined;
  let dispatches = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    if (++dispatches === 1) return completed();
    secondSignal = init!.signal!;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame('restored-marker'))); } }),
      { headers: { 'content-type': 'text/event-stream' } });
  });
  await consume(await f.invoke(caps[0]!)); await f.drain();
  const response = await f.invoke(caps[1]!); assert.equal(response.status, 200); const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  assert.equal((await (await f.cancel(caps[0]!)).json() as { activeRequestsAborted: number }).activeRequestsAborted, 0);
  assert.equal(secondSignal!.aborted, false);
  assert.equal((await (await f.cancel(caps[1]!)).json() as { activeRequestsAborted: number }).activeRequestsAborted, 1);
  assert.equal(secondSignal!.aborted, true); await f.drain();
  assert.equal(f.ledger()?.calls['call-2']?.facts?.outcome, 'cancelled');
  assert.equal(f.ledger()?.calls['call-2']?.facts?.usage.status, 'unknown'); assert.equal(f.ledger()?.heldMicrousd, 923424);
  assert.equal((await f.invoke(caps[1]!)).status, 403); assert.equal(dispatches, 2);
  await reader.cancel().catch(() => {}); reader.releaseLock();
});

test('cancel-before-start is durable and creates no reservation; revocation survives reconstruction', async t => {
  const f = harness(), { capabilities: caps } = await f.initialize();
  const transport = t.mock.method(globalThis, 'fetch', async () => completed());
  assert.equal((await f.cancel(caps[0]!)).status, 200); f.rebuild();
  assert.equal((await f.invoke(caps[0]!)).status, 403); assert.equal(f.ledger(), undefined);
  assert.equal((await f.control('revoke')).status, 200); f.rebuild();
  assert.equal((await f.invoke(caps[1]!)).status, 403); assert.equal((await f.control('init/alpha')).status, 409);
  assert.equal(transport.mock.callCount(), 0); assert.equal(f.state().revoked, true);
});

test('live authority refuses budget/price drift instead of replacing the persisted ledger', async t => {
  const f = harness(), { capabilities: caps } = await f.initialize();
  const transport = t.mock.method(globalThis, 'fetch', async () => completed());
  await consume(await f.invoke(caps[0]!)); await f.drain();
  const metadata = f.kv.get<{ approval: { maxRunMicrousd: number } }>('m0:model:metadata')!;
  metadata.approval.maxRunMicrousd = 1_000_000; f.kv.put('m0:model:metadata', metadata); f.rebuild();
  assert.equal((await f.invoke(caps[1]!)).status, 403); await f.drain();
  assert.equal(transport.mock.callCount(), 1); assert.equal(f.ledger()?.heldMicrousd, 461712);
});
