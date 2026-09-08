import assert from 'node:assert/strict';
import test from 'node:test';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';
import { createModelProxy, type InputTokenBound, type ProxyDependencies } from '../../spikes/m0-model-proxy/index.ts';
import { RunReservationAuthority, type AtomicRunStore, type RunApproval, type RunLedger, type TrustedInvocation } from '../../spikes/m0-model-proxy/authority.ts';
import { boundedCompletionBody, fixedPolicy, HISTORICAL_PROFILE, type ModelProxyPolicy } from '../../spikes/m0-model-proxy/policy.ts';
import { CompletionStreamObserver } from '../../spikes/m0-model-proxy/stream.ts';

const NOW = 1_000_000;
const policy: ModelProxyPolicy = { ...HISTORICAL_PROFILE, proxyOrigin: 'https://proxy.example.test', callerPrincipal: 'fixed-trusted-pi', mapper: 'deepseek-thinking-disabled', maxBodyBytes: 4096, maxInputTokens: 1024, maxOutputTokens: 256, maxResponseBytes: 16384, maxFrameBytes: 4096, timeoutMs: 1000 };
const invocation: TrustedInvocation = { kind: 'trusted-pi', principal: policy.callerPrincipal, tenantId: 'tenant-a', workspaceId: 'workspace-a', runId: 'approved-run-a', callId: 'call-one', expiresAtMs: NOW + 60_000 };
const approval: RunApproval = {
  ...invocation, provider: policy.provider, model: policy.model, maxRunMicrousd: 1_000_000,
  // Deliberately synthetic rates: fixture arithmetic must never be used as a provider quote.
  rate: { provider: policy.provider, model: policy.model, version: 'synthetic-test-only', source: 'https://rates.example.test/fixture', verifiedAtMs: NOW - 1, expiresAtMs: NOW + 60_000, inputMicrousdPerMillion: 1_000_000, outputMicrousdPerMillion: 2_000_000, boundsAllBillableTokens: true },
};
const body = () => ({ model: policy.model, messages: [{ role: 'user', content: 'Reply 简短' }], stream: true });
function request(value: unknown = body(), extra: RequestInit = {}, url = policy.proxyOrigin + '/v1/chat/completions') { return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), ...extra }); }
function storeFixture() {
  let state: RunLedger | null = null; let tail: Promise<unknown> = Promise.resolve();
  const store: AtomicRunStore = { transact<T>(operation: (state: RunLedger | null) => { state: RunLedger; value: T }) {
    const next = tail.then(() => { const result = operation(structuredClone(state)); state = structuredClone(result.state); return structuredClone(result.value); });
    tail = next.catch(() => {}); return next;
  } };
  return { store, state: () => structuredClone(state) };
}
const encode = (value: string) => new TextEncoder().encode(value);
function chunk(fields: Record<string, unknown> = {}) { return { id: 'response-actual-123', object: 'chat.completion.chunk', model: policy.model, choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }], ...fields }; }
function sse(value: unknown) { return `data: ${JSON.stringify(value)}\r\n\r\n`; }
const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
function completedSSE(extra: Record<string, unknown> = {}) { return sse(chunk()) + sse(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage, ...extra })) + 'data: [DONE]\r\n\r\n'; }
function streamResponse(text = completedSSE(), headers: Record<string, string> = {}) { return new Response(text, { headers: { 'content-type': 'text/event-stream', ...headers } }); }
function fixture(options: { config?: Partial<ModelProxyPolicy>; approval?: RunApproval; dependencies?: Partial<ProxyDependencies> } = {}) {
  const storage = storeFixture(); const config = { ...policy, ...options.config }; let identity = structuredClone(invocation);
  const boundProvider = config.provider; const boundModel = config.model;
  const dispatches: { url: string; init: RequestInit }[] = [];
  const authority = new RunReservationAuthority(options.approval ?? approval, storage.store, () => NOW);
  const dependencies: ProxyDependencies = {
    authenticate: async () => identity,
    inputTokenBound: async (): Promise<InputTokenBound> => ({ provider: boundProvider, model: boundModel, version: 'synthetic-test-token-bound', kind: 'verified-upper-bound', tokens: 20 }),
    authority, resolveSecret: async () => 'synthetic-provider-secret',
    fetch: async (url, init) => { dispatches.push({ url, init }); return streamResponse(); }, now: () => NOW,
    ...options.dependencies,
  };
  return { ...storage, authority, config, dependencies, dispatches, nextCall: (callId: string) => { identity = { ...identity, callId }; }, setIdentity: (next: TrustedInvocation) => { identity = next; }, proxy: createModelProxy(config, dependencies) };
}

test('fixed server mapper enforces max_tokens and disabled thinking independently of SDK defaults', () => {
  const normalized = JSON.parse(boundedCompletionBody(body(), fixedPolicy(policy)).encoded);
  assert.equal(normalized.max_tokens, 256); assert.deepEqual(normalized.thinking, { type: 'disabled' }); assert.deepEqual(normalized.stream_options, { include_usage: true });
  for (const fields of [{ max_completion_tokens: 256 }, { max_tokens: 20, max_completion_tokens: 20 }, { max_tokens: 384000 }, { max_tokens: 0 }, { max_tokens: 2.5 }, { reasoning: false }, { thinking: { type: 'enabled' } }, { model: 'different' }, { stream: false }, { url: 'https://evil.test' }, { budget: 1000 }, { stream_options: { include_usage: false } }, { tools: [] }, { max_output_tokens: 256 }]) assert.throws(() => boundedCompletionBody({ ...body(), ...fields }, policy));
  assert.throws(() => fixedPolicy({ ...policy, maxInputTokens: 8193 })); assert.throws(() => fixedPolicy({ ...policy, maxOutputTokens: 257 }));
  for (const upstreamOrigin of ['http://opencode.ai', 'https://user:secret@opencode.ai', 'https://opencode.ai:443', 'https://opencode.ai/path', 'https://opencode.ai?url=evil']) assert.throws(() => fixedPolicy({ ...policy, upstreamOrigin }));
  assert.throws(() => fixedPolicy({ ...policy, upstreamPath: '/responses' }));
});

test('only the exact origin, streaming completion route and POST method are accepted', async () => {
  const f = fixture();
  for (const url of ['https://evil.test/v1/chat/completions', policy.proxyOrigin + '/v1/responses', policy.proxyOrigin + '/recharge', policy.proxyOrigin + '/settlement', policy.proxyOrigin + '/pricing', policy.proxyOrigin + '/v1/chat/completions?url=https://evil.test']) {
    assert.equal((await f.proxy.handle(request(body(), {}, url))).response.status, 404);
  }
  assert.equal((await f.proxy.handle(new Request(policy.proxyOrigin + '/v1/chat/completions'))).response.status, 405);
  assert.equal((await f.proxy.handle(request(body(), { headers: { 'content-type': 'text/plain' } }))).response.status, 415);
  assert.equal(f.dispatches.length, 0); assert.equal(f.state(), null);
});

test('headers cannot grant scope, change upstream, supply a provider key or create budget', async () => {
  const f = fixture();
  for (const key of ['x-upstream-url', 'x-provider', 'x-model', 'x-api-key', 'x-endpoint', 'x-budget', 'x-role', 'x-run-id', 'x-reservation-id', 'x-tenant-id', 'x-workspace-id', 'x-call-id']) {
    const exchange = await f.proxy.handle(request(body(), { headers: { 'content-type': 'application/json', [key]: 'attacker-controlled' } })); assert.equal(exchange.response.status, 403);
  }
  for (const patch of [{ principal: 'project' }, { runId: 'unapproved-run' }, { tenantId: 'tenant-b' }, { workspaceId: 'workspace-b' }, { expiresAtMs: NOW }, { callId: '__proto__' }]) {
    f.setIdentity({ ...invocation, ...patch }); assert.equal((await f.proxy.handle(request())).response.status, 403);
  }
  assert.equal(f.dispatches.length, 0);
  const noCaller = fixture({ dependencies: { authenticate: async () => null } }); assert.equal((await noCaller.proxy.handle(request())).response.status, 403);
});

test('provider request is rebuilt from server configuration and an exact header whitelist', async () => {
  const f = fixture(); f.config.upstreamOrigin = 'https://evil.test'; f.config.model = 'mutated-after-create';
  const exchange = await f.proxy.handle(request(body(), { headers: { 'content-type': 'application/json', authorization: 'caller-capability', cookie: 'private-project', 'x-arbitrary-header': 'do-not-forward' } }));
  assert.equal(exchange.response.status, 200); assert.equal(await exchange.response.text(), completedSSE());
  const sent = f.dispatches[0]!; assert.equal(sent.url, 'https://opencode.ai/zen/go/v1/chat/completions'); assert.equal(sent.init.redirect, 'manual'); assert.equal(sent.init.method, 'POST');
  assert.deepEqual(Object.fromEntries(new Headers(sent.init.headers).entries()), { accept: 'text/event-stream', authorization: 'Bearer synthetic-provider-secret', 'content-type': 'application/json' });
  assert.equal(JSON.parse(sent.init.body as string).model, policy.model);
  const saved = await exchange.completion; assert.equal(saved.persistence, 'saved'); assert.equal(saved.receipt?.facts?.usage.status, 'known');
  assert.equal(saved.receipt?.facts?.upstreamRequestId, null); assert.equal(saved.receipt?.facts?.upstreamResponseId, 'response-actual-123');
  assert.notEqual(saved.receipt?.platformRequestId, saved.receipt?.facts?.upstreamResponseId);
  assert.equal(saved.receipt?.billingAmount, null); assert.equal(saved.receipt?.facts?.usage.observedTokens.cacheRead, null);
});

test('provider header request ID is preserved separately from SSE response ID and platform ID', async () => {
  const f = fixture({ dependencies: { fetch: async () => streamResponse(completedSSE(), { 'x-request-id': 'provider-request-456', 'set-cookie': 'do-not-forward', 'x-secret': 'no' }) } });
  const exchange = await f.proxy.handle(request()); await exchange.response.text(); const saved = await exchange.completion;
  assert.equal(saved.receipt?.facts?.upstreamRequestId, 'provider-request-456'); assert.equal(saved.receipt?.facts?.upstreamRequestIdHeader, 'x-request-id');
  assert.equal(saved.receipt?.facts?.upstreamResponseId, 'response-actual-123'); assert.equal(exchange.response.headers.get('set-cookie'), null); assert.equal(exchange.response.headers.get('x-secret'), null);
  assert.equal(exchange.response.headers.get('x-riffology-request-id'), saved.receipt?.platformRequestId);
});

test('body bytes and trusted token bounds must both pass before reservation or transport', async () => {
  const f = fixture(); assert.equal((await f.proxy.handle(request({ ...body(), messages: [{ role: 'user', content: '大'.repeat(2000) }] }))).response.status, 413); assert.equal(f.state(), null);
  for (const inputTokenBound of [undefined, async () => ({ provider: 'wrong', model: policy.model, kind: 'verified-upper-bound', version: 'test', tokens: 20 } as InputTokenBound), async () => ({ provider: policy.provider, model: policy.model, kind: 'verified-upper-bound', version: 'test', tokens: 1025 } as InputTokenBound)]) {
    const bad = fixture({ dependencies: { inputTokenBound } }); const exchange = await bad.proxy.handle(request()); assert.ok([413, 503].includes(exchange.response.status)); assert.equal(bad.dispatches.length, 0); assert.equal(bad.state(), null);
  }
  const hanging = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); } });
  const smallDeadline = fixture({ config: { timeoutMs: 20 } });
  const empty = await smallDeadline.proxy.handle(request(undefined, { body: hanging, duplex: 'half' } as RequestInit)); assert.equal(empty.response.status, 504); assert.equal(smallDeadline.dispatches.length, 0);
});

test('missing/expired/unverified rates or invalid budgets deny dispatch, never interpreting SDK cost zero as approval', async () => {
  for (const patch of [{ rate: null }, { expiresAtMs: NaN }, { expiresAtMs: Infinity }, { expiresAtMs: NOW + 0.5 }, { maxRunMicrousd: 0 }, { maxRunMicrousd: 1_000_001 }, { rate: { ...approval.rate!, expiresAtMs: NOW } }, { rate: { ...approval.rate!, inputMicrousdPerMillion: 0 } }, { rate: { ...approval.rate!, boundsAllBillableTokens: false } }]) {
    const f = fixture({ approval: { ...approval, ...patch } as RunApproval }); const exchange = await f.proxy.handle(request()); assert.ok(exchange.response.status >= 400); assert.equal(f.dispatches.length, 0);
  }
  const exhausted = fixture({ approval: { ...approval, maxRunMicrousd: 531 } }); assert.equal((await exhausted.proxy.handle(request())).response.status, 402); assert.equal(exhausted.dispatches.length, 0);
});

test('same trusted call and payload never refetch after completion; different payload conflicts', async () => {
  const f = fixture(); const first = await f.proxy.handle(request()); await first.response.text(); const before = f.state();
  const replay = await f.proxy.handle(request()); assert.equal(replay.response.status, 409); assert.deepEqual((await replay.completion).receipt, (await first.completion).receipt);
  assert.equal((await f.proxy.handle(request({ ...body(), messages: [{ role: 'user', content: 'changed' }] }))).response.status, 409);
  assert.equal(f.dispatches.length, 1); assert.deepEqual(f.state(), before);
});

test('concurrent duplicates dispatch at most once; three different calls exhaust the run ceiling', async () => {
  const f = fixture(); const pair = await Promise.all([f.proxy.handle(request()), f.proxy.handle(request())]);
  assert.deepEqual(pair.map(row => row.response.status).sort(), [200, 409]); for (const row of pair) await row.response.text(); assert.equal(f.dispatches.length, 1);
  for (const id of ['call-two', 'call-three']) { f.nextCall(id); const exchange = await f.proxy.handle(request()); assert.equal(exchange.response.status, 200); await exchange.response.text(); }
  f.nextCall('call-four'); assert.equal((await f.proxy.handle(request())).response.status, 429);
  assert.equal(f.dispatches.length, 3); assert.equal(f.state()?.dispatchCount, 3); assert.equal(f.state()?.heldMicrousd, 1596);
});

test('upstream redirect, HTTP error and unknown transport outcomes each consume one attempt without automatic replay', async () => {
  for (const implementation of [async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/token' } }), async () => new Response('sensitive-provider-error', { status: 429 }), async () => { throw new Error('network-unknown-with-secret'); }]) {
    let calls = 0; const f = fixture({ dependencies: { fetch: async () => { calls++; return implementation(); } } });
    const first = await f.proxy.handle(request()); assert.equal(first.response.status, 502); assert.doesNotMatch(await first.response.text(), /sensitive|secret/);
    const record = await first.completion; assert.equal(record.receipt?.facts?.usage.status, 'unknown'); assert.equal(record.receipt?.billingStatus, 'held-for-review');
    assert.equal((await f.proxy.handle(request())).response.status, 409); assert.equal(calls, 1); assert.equal(f.state()?.dispatchCount, 1); assert.equal(f.state()?.heldMicrousd, 532);
  }
});

test('client stream cancellation propagates abort and holds the reservation even after partial usage', async () => {
  let upstreamSignal: AbortSignal | undefined; let cancelled = false;
  const f = fixture({ dependencies: { fetch: async (_url, init) => {
    upstreamSignal = init.signal!; return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode(sse(chunk({ usage })))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } } });
  const exchange = await f.proxy.handle(request()); const reader = exchange.response.body!.getReader(); await reader.read(); await reader.cancel(); const saved = await exchange.completion;
  assert.equal(upstreamSignal?.aborted, true); assert.equal(cancelled, true); assert.equal(saved.receipt?.facts?.outcome, 'cancelled'); assert.equal(saved.receipt?.facts?.usage.status, 'unknown'); assert.equal(saved.receipt?.facts?.usage.observedTokens.input, 10); assert.equal(f.state()?.heldMicrousd, 532);
});

test('request abort and absolute timeout terminate unconsumed or hanging streams and never replay', async () => {
  for (const mode of ['request-abort', 'absolute-timeout'] as const) {
    let signal: AbortSignal | undefined; let calls = 0; let cancelled = false;
    const f = fixture({ config: { timeoutMs: 25 }, dependencies: { fetch: async (_url, init) => { calls++; signal = init.signal!; return new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }); } } });
    const cancel = new AbortController(); const exchange = await f.proxy.handle(request(body(), { signal: cancel.signal }));
    if (mode === 'request-abort') cancel.abort();
    const result = await exchange.completion; assert.equal(result.receipt?.facts?.outcome, mode === 'request-abort' ? 'cancelled' : 'timeout'); assert.equal(signal?.aborted, true); assert.equal(cancelled, true);
    await assert.rejects(exchange.response.text()); assert.equal((await f.proxy.handle(request())).response.status, 409); assert.equal(calls, 1);
  }
});

test('terminal persistence failure is explicit and never converted into confirmed completion', async () => {
  const f = fixture(); const authority = { ...f.authority, reserve: f.authority.reserve.bind(f.authority), markDispatched: f.authority.markDispatched.bind(f.authority), finish: async () => { throw new Error('storage-down'); } };
  const proxy = createModelProxy(policy, { ...f.dependencies, authority }); const exchange = await proxy.handle(request()); await exchange.response.text();
  assert.equal((await exchange.completion).persistence, 'unconfirmed'); assert.equal(f.state()?.calls['call-one']?.state, 'dispatched'); assert.equal((await proxy.handle(request())).response.status, 409); assert.equal(f.dispatches.length, 1);
});

test('recreated authority uses the persisted ledger and rejects altered server budget instead of resetting it', async () => {
  const f = fixture(); const first = await f.proxy.handle(request()); await first.response.text();
  const recreated = createModelProxy(policy, { ...f.dependencies, authority: new RunReservationAuthority(approval, f.store, () => NOW) });
  assert.equal((await recreated.handle(request())).response.status, 409); assert.equal(f.dispatches.length, 1);
  const changed = createModelProxy(policy, { ...f.dependencies, authority: new RunReservationAuthority({ ...approval, maxRunMicrousd: 999_999 }, f.store, () => NOW) });
  assert.equal((await changed.handle(request())).response.status, 409); assert.equal(f.dispatches.length, 1);
});

test('expiry after durable dispatch commit but before transport prevents sending without releasing intent', async () => {
  const f = fixture(); let clock = NOW;
  const authority = { reserve: f.authority.reserve.bind(f.authority), finish: f.authority.finish.bind(f.authority), markDispatched: async (callId: string, requestId: string) => {
    const receipt = await f.authority.markDispatched(callId, requestId); clock = invocation.expiresAtMs; return receipt;
  } };
  const proxy = createModelProxy(policy, { ...f.dependencies, authority, now: () => clock });
  const exchange = await proxy.handle(request()); assert.equal(exchange.response.status, 403); assert.equal(f.dispatches.length, 0);
  assert.equal(f.state()?.dispatchCount, 1); assert.equal(f.state()?.heldMicrousd, 532); assert.equal((await exchange.completion).receipt?.facts?.usage.status, 'unknown');
});

test('SSE observer preserves UTF8 across every byte split and accepts only real correlation evidence', () => {
  const observer = new CompletionStreamObserver(policy, 256, 20); const bytes = encode(completedSSE());
  for (const byte of bytes) observer.push(new Uint8Array([byte])); observer.end();
  assert.equal(observer.evidence('completed').status, 'known'); assert.equal(observer.totalBytes, bytes.byteLength); assert.equal(observer.upstreamResponseId, 'response-actual-123');
  const noId = new CompletionStreamObserver(policy, 256, 20); noId.push(encode(completedSSE({ id: undefined } ).replaceAll('"id":"response-actual-123",', ''))); noId.end(); assert.equal(noId.upstreamResponseId, null);
});

test('missing and malformed usage remain unknown; duplicate/conflicting usage cannot wash away uncertainty', () => {
  const final = (value: unknown) => sse(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: value }));
  for (const text of [completedSSE({ usage: undefined }), completedSSE({ usage: { prompt_tokens: 10, completion_tokens: 2 } }), sse(chunk({ usage: 'bad' })) + completedSSE(), sse(chunk({ usage })) + final({ ...usage, completion_tokens: 1, total_tokens: 11 }) + 'data: [DONE]\n\n', sse(chunk({ usage: { ...usage, total_tokens: 99 } })) + completedSSE()]) {
    const observer = new CompletionStreamObserver(policy, 256, 20); observer.push(encode(text)); observer.end(); assert.equal(observer.evidence('completed').status, 'unknown'); assert.equal(observer.evidence('completed').billingAmount, null);
  }
  const duplicate = new CompletionStreamObserver(policy, 256, 20); duplicate.push(encode(sse(chunk({ usage })) + completedSSE())); duplicate.end(); assert.equal(duplicate.evidence('completed').status, 'known');
});

test('early usage is not terminal evidence; finish ordering and post-finish content are enforced', () => {
  const finish = sse(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
  const early = new CompletionStreamObserver(policy, 256, 20); early.push(encode(sse(chunk({ usage })) + finish + 'data: [DONE]\n\n')); early.end();
  assert.equal(early.evidence('completed').status, 'unknown'); assert.equal(early.evidence('completed').reason, 'usage-not-confirmed-after-final-finish');
  const final = new CompletionStreamObserver(policy, 256, 20); final.push(encode(finish + sse(chunk({ choices: [], usage })) + 'data: [DONE]\n\n')); final.end(); assert.equal(final.evidence('completed').status, 'known');
  for (const frame of [sse(chunk()), sse(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }))]) {
    const bad = new CompletionStreamObserver(policy, 256, 20); bad.push(encode(finish)); assert.throws(() => bad.push(encode(frame)));
  }
});

test('protocol/model/ID drift, oversized frames/total bytes, and provider token overruns terminate observation', () => {
  for (const changed of [{ model: 'different-model' }, { object: 'response.output_text.delta' }, { error: { message: 'upstream-error' } }, { usage: { prompt_tokens: 21, completion_tokens: 2, total_tokens: 23 } }, { usage: { prompt_tokens: 10, completion_tokens: 257, total_tokens: 267 } }]) {
    const observer = new CompletionStreamObserver(policy, 256, 20); assert.throws(() => observer.push(encode(sse(chunk(changed)))));
  }
  const changedId = new CompletionStreamObserver(policy, 256); changedId.push(encode(sse(chunk()))); assert.throws(() => changedId.push(encode(sse(chunk({ id: 'another-response' })))));
  const bigFrame = new CompletionStreamObserver({ ...policy, maxFrameBytes: 8 }, 256); assert.throws(() => bigFrame.push(encode('data: ' + 'x'.repeat(9))));
  const bigTotal = new CompletionStreamObserver({ ...policy, maxResponseBytes: 5 }, 256); assert.throws(() => bigTotal.push(encode(':12345\n\n')));
  const invalidUtf8 = new CompletionStreamObserver(policy, 256); assert.throws(() => invalidUtf8.push(new Uint8Array([255])));
  const incomplete = new CompletionStreamObserver(policy, 256); incomplete.push(encode(sse(chunk()))); assert.throws(() => incomplete.end());
});

test('protocol rejection during a real proxy stream aborts transport and saves unknown rather than successful usage', async () => {
  let signal: AbortSignal | undefined; const f = fixture({ dependencies: { fetch: async (_url, init) => { signal = init.signal!; return streamResponse(completedSSE({ model: 'drifted' })); } } });
  const exchange = await f.proxy.handle(request()); await assert.rejects(exchange.response.text()); const saved = await exchange.completion;
  assert.equal(signal?.aborted, true); assert.equal(saved.receipt?.facts?.outcome, 'failed'); assert.equal(saved.receipt?.facts?.usage.status, 'unknown'); assert.equal(f.state()?.heldMicrousd, 532);
});

test('locked real Pi SDK builds a compatible text request only with explicit server-selected compatibility and limits', async () => {
  const f = fixture(); const payloads: Record<string, unknown>[] = []; const exchanges: Awaited<ReturnType<typeof f.proxy.handle>>[] = [];
  const model: Model<'openai-completions'> = {
    id: policy.model, name: 'Offline fixed backend fixture', api: 'openai-completions', provider: policy.provider, baseUrl: policy.proxyOrigin + '/v1', reasoning: true, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: 384000,
    compat: { maxTokensField: 'max_tokens', supportsStore: false, supportsDeveloperRole: false, thinkingFormat: 'deepseek', requiresReasoningContentOnAssistantMessages: true },
  };
  const transport: typeof globalThis.fetch = async (input, init) => {
    const outbound = new Request(input, init); assert.equal(outbound.url, policy.proxyOrigin + '/v1/chat/completions');
    payloads.push(await outbound.clone().json() as Record<string, unknown>); const exchange = await f.proxy.handle(outbound); exchanges.push(exchange); return exchange.response;
  };
  const options = { apiKey: 'synthetic-caller-capability', maxRetries: 0, maxTokens: 256, fetch: transport };
  const context = { systemPrompt: 'Offline text fixture.', messages: [{ role: 'user' as const, content: 'Hello', timestamp: NOW }] };
  const first = await streamSimple(model, context, options).result(); assert.equal(first.stopReason, 'stop'); assert.equal(first.responseId, 'response-actual-123');
  assert.equal(payloads[0]?.max_tokens, 256); assert.equal(payloads[0]?.max_completion_tokens, undefined); assert.deepEqual(payloads[0]?.thinking, { type: 'disabled' });
  assert.equal((await exchanges[0]!.completion).receipt?.facts?.usage.status, 'known');
  f.nextCall('restored-text-call'); const restored = await streamSimple(model, { ...context, messages: [...context.messages, first, { role: 'user', content: 'Continue', timestamp: NOW + 1 }] }, options).result();
  assert.equal(restored.stopReason, 'stop'); assert.ok((payloads[1]?.messages as { role: string }[]).some(message => message.role === 'assistant')); assert.equal(f.dispatches.length, 2);
  f.nextCall('unsafe-sdk-default'); const unsafe = await streamSimple({ ...model, reasoning: false, compat: { ...model.compat, maxTokensField: 'max_completion_tokens' } }, context, options).result();
  assert.equal(unsafe.stopReason, 'error'); assert.equal(payloads[2]?.max_completion_tokens, 256); assert.equal(f.dispatches.length, 2);
});
