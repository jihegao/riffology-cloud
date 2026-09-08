import { DurableObject } from 'cloudflare:workers';
import { isRunId, isTenant, type ProbeTenant } from '../m0-cloud/auth.ts';
import { RunReservationAuthority, type AtomicRunStore, type RunApproval, type RunLedger, type TrustedInvocation } from './authority.ts';
import { issueCapability, parseCapabilityAuthorization, verifyCapability, TRUSTED_PI_PRINCIPAL, type CapabilityRecord } from './capability.ts';
import { DurableRunStore } from './durable-store.ts';
import { hasModelOperatorAuthorization, unwrapGatewayAuthorization, wrapGatewayCapability } from './gateway-auth.ts';
import { createModelProxy } from './index.ts';
import { GO_LIVE_BUDGET, HISTORICAL_PROFILE, ProxyRejected, readJsonBody, untilAbort, type ModelProxyPolicy } from './policy.ts';

const META_KEY = 'm0:model:metadata';
const REVOKED_KEY = 'm0:model:revoked';
const LEDGER_KEY = 'm0:model:ledger';
const PROXY_ORIGIN = 'https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev';
const FIXTURE_MODEL = 'm0-text-fixture';
const POLICY: ModelProxyPolicy = {
  proxyOrigin: PROXY_ORIGIN, upstreamOrigin: 'https://m0-model-provider.invalid', upstreamPath: '/v1/chat/completions',
  provider: 'm0-fixture', model: FIXTURE_MODEL, callerPrincipal: TRUSTED_PI_PRINCIPAL, mapper: 'deepseek-thinking-disabled',
  maxBodyBytes: 8192, maxInputTokens: 128, maxOutputTokens: 32, maxResponseBytes: 65536, maxFrameBytes: 8192, timeoutMs: 30000,
};
type ModelMode = 'fixture-only' | 'go-live-only';
const LIVE_POLICY: ModelProxyPolicy = { ...POLICY, ...HISTORICAL_PROFILE,
  proxyOrigin: GO_LIVE_BUDGET.origin, budgetProfile: GO_LIVE_BUDGET.id,
  maxInputTokens: GO_LIVE_BUDGET.inputTokens, maxOutputTokens: 256,
};
function modelProfile(env: Pick<M0ModelProxyEnv, 'M0_MODEL_MODE' | 'M0_CONTROL_ORIGIN'>) {
  if (env.M0_MODEL_MODE === 'fixture-only') return { mode: 'fixture-only' as const, policy: POLICY, live: false };
  if (env.M0_MODEL_MODE === 'go-live-only' && env.M0_CONTROL_ORIGIN === GO_LIVE_BUDGET.origin) return { mode: 'go-live-only' as const, policy: LIVE_POLICY, live: true };
  throw new ProxyRejected('model-profile-disabled', 503);
}
type InitializationResult = {
  runId: string; mode: ModelMode; expiresAtMs: number; capabilities: { callId: string; token: string }[];
  identitySource: string; liveEnabled: boolean;
};
type RunMetadata = {
  schema: 1; mode: ModelMode; runId: string; tenantId: string; workspaceId: string;
  approval: RunApproval; capabilities: CapabilityRecord[];
};
const json = (value: unknown, status = 200, mode: ModelMode = 'fixture-only') => Response.json(value, { status, headers: {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-riffology-m0-mode': mode,
} });

async function hasEmptyBody(request: Request) {
  if (!request.body) return true;
  const reader = request.body.getReader(); const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 1500);
  try { for (let count = 0; count < 16; count++) { const part = await untilAbort(reader.read(), abort.signal); if (part.done) return true; if (part.value.byteLength) return false; } return false; }
  catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Separate deployment profiles choose either fixture transport or one approved
 * two-call Go diagnostic. A credential's presence never selects the profile. */
export class M0ModelProxyRun extends DurableObject<M0ModelProxyEnv> {
  readonly #instanceNonce = crypto.randomUUID();
  readonly #active = new Map<string, AbortController>();
  readonly #activeCalls = new Map<string, string>();
  #removeRequest(key: string) { this.#active.delete(key); this.#activeCalls.delete(key); }
  #requireCall(invocation: TrustedInvocation) {
    const meta = this.#requireActive();
    if (this.ctx.storage.kv.get(`m0:model:cancel:${invocation.callId}`)) throw new ProxyRejected('call-cancelled', 403);
    if (meta.mode === 'go-live-only') {
      if (!['call-1', 'call-2'].includes(invocation.callId)) throw new ProxyRejected('fixed-live-call-required', 403);
      if (invocation.callId === 'call-2') {
        const first = this.ctx.storage.kv.get<RunLedger>(LEDGER_KEY)?.calls['call-1'];
        if (first?.state !== 'terminal' || first.facts?.outcome !== 'completed') throw new ProxyRejected('first-call-not-completed', 409);
      }
    }
  }
  #metadata() { return this.ctx.storage.kv.get<RunMetadata>(META_KEY); }
  #checkObject(runId: string) {
    if (modelProfile(this.env).live && runId !== GO_LIVE_BUDGET.runId) throw new ProxyRejected('fixed-live-run-required', 403);
    if (!isRunId(runId) || !this.ctx.id.equals(this.env.MODEL_RUNS.idFromName(`m0-model-${runId}`))) throw new ProxyRejected('run-object-mismatch', 403);
  }
  #requireActive() {
    const meta = this.#metadata();
    const profile = modelProfile(this.env);
    if (!meta || meta.schema !== 1 || meta.mode !== profile.mode
      || this.ctx.storage.kv.get(REVOKED_KEY) || meta.approval.expiresAtMs <= Date.now()) throw new ProxyRejected('run-unavailable', 403);
    this.#checkObject(meta.runId); return meta;
  }
  async initialize(runId: string, tenant: ProbeTenant): Promise<InitializationResult> {
    this.#checkObject(runId); const profile = modelProfile(this.env), policy = profile.policy;
    if (!isTenant(tenant) || profile.live && tenant !== 'alpha') throw new ProxyRejected('tenant-denied', 403);
    const now = Date.now(); const expiresAtMs = profile.live ? Math.min(now + 600000, GO_LIVE_BUDGET.expiresAtMs) : now + 600000;
    if (profile.live && (now < GO_LIVE_BUDGET.verifiedAtMs || expiresAtMs <= now)) throw new ProxyRejected('live-rate-review-expired', 403);
    const base = { kind: 'trusted-pi' as const, principal: TRUSTED_PI_PRINCIPAL, tenantId: `m0-${tenant}`, workspaceId: `m0-${tenant}-${runId}`, runId, expiresAtMs };
    const capabilities = (profile.live ? ['call-1', 'call-2'] : ['call-1', 'call-2', 'call-3']).map(callId => ({ callId, ...issueCapability({ ...base, callId }, now) }));
    const approval: RunApproval = profile.live ? { ...base, provider: policy.provider, model: policy.model,
      budgetProfile: GO_LIVE_BUDGET.id, maxRunMicrousd: GO_LIVE_BUDGET.maxRunMicrousd,
      rate: { provider: policy.provider, model: policy.model, version: 'go-peak-public-tariff-20260906', source: 'https://opencode.ai/docs/go/',
        verifiedAtMs: GO_LIVE_BUDGET.verifiedAtMs, expiresAtMs, inputMicrousdPerMillion: GO_LIVE_BUDGET.inputMicrousdPerMillion,
        outputMicrousdPerMillion: GO_LIVE_BUDGET.outputMicrousdPerMillion, boundsAllBillableTokens: true } }
      : { ...base, provider: policy.provider, model: policy.model, maxRunMicrousd: 50000,
      rate: { provider: policy.provider, model: policy.model, version: 'synthetic-fixture-not-money-v1', source: 'https://m0-model-provider.invalid/rate-fixture',
        verifiedAtMs: now, expiresAtMs, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000, boundsAllBillableTokens: true } };
    this.ctx.storage.transactionSync(() => {
      if (this.#metadata() || this.ctx.storage.kv.get(REVOKED_KEY)) throw new ProxyRejected('run-already-initialized-or-revoked', 409);
      const meta: RunMetadata = { schema: 1, mode: profile.mode, runId, tenantId: base.tenantId, workspaceId: base.workspaceId,
        approval, capabilities: capabilities.map(item => item.record) };
      this.ctx.storage.kv.put(META_KEY, meta);
    });
    await this.ctx.storage.sync();
    return { runId, mode: profile.mode, expiresAtMs, capabilities: capabilities.map(({ callId, token }) => ({ callId, token })),
      identitySource: profile.live ? 'operator-authorized-live-probe; not production user login' : 'operator-authorized-synthetic-probe; not production user login', liveEnabled: profile.live };
  }
  status(runId: string) {
    this.#checkObject(runId); const meta = this.#metadata(), profile = modelProfile(this.env);
    return { runId, mode: profile.mode, initialized: !!meta, tenantId: meta?.tenantId ?? null, workspaceId: meta?.workspaceId ?? null,
      revoked: this.ctx.storage.kv.get(REVOKED_KEY) === true, instanceNonce: this.#instanceNonce,
      ledger: this.ctx.storage.kv.get<RunLedger>(LEDGER_KEY) ?? null,
      fixtureDispatches: this.ctx.storage.kv.get<number>('m0:model:fixture-dispatches') ?? 0,
      cancelledCalls: meta?.capabilities.map(item => item.invocation.callId).filter(callId => this.ctx.storage.kv.get(`m0:model:cancel:${callId}`) === true) ?? [],
      activeRequests: this.#active.size, realProviderCalls: profile.live ? null : 0, liveEnabled: profile.live,
      ...(profile.live ? { budgetBasis: 'public-contract-token-value-upper-bound', budgetProfile: GO_LIVE_BUDGET.id,
        maxPlatformDispatches: 2, upstreamDispatchIntents: this.ctx.storage.kv.get<RunLedger>(LEDGER_KEY)?.dispatchCount ?? 0,
        rawTokenValueReservedMicrousd: this.ctx.storage.kv.get<RunLedger>(LEDGER_KEY)?.heldMicrousd ?? 0,
        GoQuotaDelta: null, cashCharge: null, absoluteCashCapProven: false } : {}) };
  }
  async revoke(runId: string) {
    this.#checkObject(runId); this.ctx.storage.kv.put(REVOKED_KEY, true); await this.ctx.storage.sync();
    const count = this.#active.size; for (const controller of this.#active.values()) controller.abort();
    return { runId, revoked: true, activeRequestsAborted: count };
  }
  async cancelCall(innerToken: string) {
    const invocation = this.#invocation(new Request(modelProfile(this.env).policy.proxyOrigin + '/v1/cancel', { headers: { authorization: `Bearer ${innerToken}` } }));
    if (!invocation) throw new ProxyRejected('invalid-call-capability', 401);
    this.ctx.storage.transactionSync(() => { this.#requireActive(); this.ctx.storage.kv.put(`m0:model:cancel:${invocation.callId}`, true); });
    await this.ctx.storage.sync();
    let count = 0;
    for (const [key, controller] of this.#active) if (this.#activeCalls.get(key) === invocation.callId) { controller.abort(); count++; }
    return { runId: invocation.runId, callId: invocation.callId, cancelled: true, activeRequestsAborted: count };
  }
  async armAbort(runId: string) {
    this.#checkObject(runId); this.#requireActive();
    if (modelProfile(this.env).live) throw new ProxyRejected('fixture-fault-disabled-in-live', 403);
    this.ctx.storage.kv.put('m0:model:abort-after-intent', true); await this.ctx.storage.sync();
    return { runId, armed: true, fault: 'after-durable-dispatch-intent-before-fixture' };
  }
  async restart(runId: string): Promise<void> {
    this.#checkObject(runId); this.#requireActive(); await this.ctx.storage.sync();
    if (modelProfile(this.env).live && this.#active.size) throw new ProxyRejected('active-live-restart-denied', 409);
    this.ctx.abort('M0 controlled model-proxy restart; no provider request');
  }
  #invocation(request: Request): TrustedInvocation | null {
    const parsed = parseCapabilityAuthorization(request.headers.get('authorization'));
    if (!parsed) return null;
    const meta = this.#requireActive(); if (parsed.runId !== meta.runId) return null;
    for (const record of meta.capabilities) {
      const invocation = verifyCapability(parsed.token, record);
      if (invocation && invocation.runId === meta.runId && invocation.tenantId === meta.tenantId && invocation.workspaceId === meta.workspaceId) return invocation;
    }
    return null;
  }
  async #fixture(invocation: TrustedInvocation, init: RequestInit): Promise<Response> {
    if (modelProfile(this.env).live) throw new ProxyRejected('fixture-transport-disabled', 403);
    this.#requireCall(invocation); init.signal?.throwIfAborted();
    if (this.ctx.storage.kv.get('m0:model:abort-after-intent') && !this.ctx.storage.kv.get('m0:model:abort-used')) {
      this.ctx.storage.kv.put('m0:model:abort-used', true); await this.ctx.storage.sync();
      this.ctx.abort('M0 intentional interruption after durable intent; no fixture/provider dispatch');
    }
    this.ctx.storage.transactionSync(() => {
      this.#requireCall(invocation);
      this.ctx.storage.kv.put('m0:model:fixture-dispatches', (this.ctx.storage.kv.get<number>('m0:model:fixture-dispatches') ?? 0) + 1);
    });
    await this.ctx.storage.sync(); this.#requireCall(invocation); init.signal?.throwIfAborted();
    const id = `fixture-${invocation.runId}-${invocation.callId}`;
    const frame = (content: string, finish: 'stop' | null, usage?: object) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: FIXTURE_MODEL,
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }], ...(usage ? { usage } : {}), synthetic: true })}\n\n`;
    const encoder = new TextEncoder();
    if (invocation.callId !== 'call-3') return new Response(frame('fixture-ok', null) + frame('', 'stop', { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }) + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream', 'x-request-id': `fixture-header-${invocation.callId}` } });
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => { try { controller.error(new Error('fixture-stream-cancelled')); } catch {} init.signal?.removeEventListener('abort', abort); };
    const body = new ReadableStream<Uint8Array>({ start(sink) { controller = sink; sink.enqueue(encoder.encode(frame('fixture-begin', null, { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }))); },
      cancel() { init.signal?.removeEventListener('abort', abort); } });
    init.signal?.addEventListener('abort', abort, { once: true }); if (init.signal?.aborted) abort();
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-header-call-3' } });
  }
  async fetch(request: Request): Promise<Response> {
    const profile = modelProfile(this.env), policy = profile.policy;
    if (this.#active.size >= (profile.live ? 1 : 8)) return json({ error: 'run-concurrency-limit' }, 429, profile.mode);
    const requestKey = crypto.randomUUID(); const controller = new AbortController(); this.#active.set(requestKey, controller);
    try {
      const meta = this.#requireActive(); const invocation = this.#invocation(request);
      if (!invocation) throw new ProxyRejected('invalid-call-capability', 401);
      this.#requireCall(invocation); this.#activeCalls.set(requestKey, invocation.callId);
      const store = new DurableRunStore(this.ctx.storage);
      const guardedStore: AtomicRunStore = { transact: operation => store.transact(current => { this.#requireCall(invocation); return operation(current); }) };
      const guardedAuthority = new RunReservationAuthority(meta.approval, guardedStore);
      const terminalAuthority = new RunReservationAuthority(meta.approval, store);
      const proxy = createModelProxy(policy, {
        authenticate: async () => { this.#requireCall(invocation); return this.#invocation(request); },
        authority: { reserve: input => guardedAuthority.reserve(input), markDispatched: (call, id) => guardedAuthority.markDispatched(call, id), finish: (call, id, facts) => terminalAuthority.finish(call, id, facts) },
        // Live reserves the entire public model context, NOT a measured input count.
        inputTokenBound: async () => ({ provider: policy.provider, model: policy.model,
          version: profile.live ? GO_LIVE_BUDGET.id : 'synthetic-response-fixed-10-tokens-v1', kind: 'verified-upper-bound', tokens: profile.live ? GO_LIVE_BUDGET.inputTokens : 128 }),
        resolveSecret: async () => profile.live ? this.env.M0_GO_API_KEY ?? '' : 'synthetic-fixture-not-a-provider-credential',
        fetch: async (target, init) => {
          if (profile.live) {
            if (target !== HISTORICAL_PROFILE.upstreamOrigin + HISTORICAL_PROFILE.upstreamPath || init.method !== 'POST' || init.redirect !== 'manual') throw new ProxyRejected('live-target-denied', 403);
            // No await or automatic retry exists between the final fences and fetch.
            this.#requireCall(invocation); init.signal?.throwIfAborted();
            const headers = new Headers(init.headers);
            headers.set('user-agent', 'riffology-m0-controlled-pi/1.0 (Pi/0.85.0)');
            headers.set('x-opencode-session', 'm0-' + GO_LIVE_BUDGET.runId);
            return fetch(target, { ...init, headers, redirect: 'manual' });
          }
          if (target !== 'https://m0-model-provider.invalid/v1/chat/completions') throw new ProxyRejected('fixture-target-denied', 403);
          return this.#fixture(invocation, init);
        },
      });
      const exchange = await proxy.handle(new Request(request, { signal: AbortSignal.any([request.signal, controller.signal]) }));
      this.ctx.waitUntil(exchange.completion.then(record => {
        if (record.persistence === 'unconfirmed') console.warn(JSON.stringify({ event: 'model-receipt-unconfirmed', runId: meta.runId, callId: invocation.callId }));
      }).finally(() => { this.#removeRequest(requestKey); }));
      const headers = new Headers(exchange.response.headers); headers.set('x-riffology-m0-mode', profile.mode);
      return new Response(exchange.response.body, { status: exchange.response.status, headers });
    } catch (error) {
      this.#removeRequest(requestKey); controller.abort();
      return json({ error: error instanceof ProxyRejected ? 'model-call-denied' : 'model-runtime-interrupted' }, error instanceof ProxyRejected ? error.status : 500, profile.mode);
    }
  }
}

export default {
  async fetch(request: Request, env: M0ModelProxyEnv): Promise<Response> {
    const url = new URL(request.url);
    let profile: ReturnType<typeof modelProfile>;
    try { profile = modelProfile(env); } catch { return json({ error: 'probe-disabled' }, 503); }
    const send = (value: unknown, status = 200) => json(value, status, profile.mode);
    if (env.PROTOCOL_VERSION !== 'm0-model-proxy-v1') return send({ error: 'probe-disabled' }, 503);
    if (url.origin !== env.M0_CONTROL_ORIGIN || url.search || url.hash || url.username || url.password) return send({ error: 'origin-or-route-denied' }, 404);
    if (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/cancel') {
      if (request.method !== 'POST') return send({ error: 'method-denied' }, 405);
      const capability = unwrapGatewayAuthorization(request.headers.get('authorization'), env.M0_PROBE_TOKEN);
      if (!capability || !isRunId(capability.runId) || profile.live && capability.runId !== GO_LIVE_BUDGET.runId) return send({ error: 'model-capability-required' }, 401);
      if (url.pathname === '/v1/cancel') {
        if (!await hasEmptyBody(request)) return send({ error: 'empty-body-required' }, 400);
        try { return send(await env.MODEL_RUNS.getByName(`m0-model-${capability.runId}`).cancelCall(capability.innerToken)); }
        catch { return send({ error: 'cancel-unconfirmed', next: 'read run status; do not blindly repeat cancellation' }, 500); }
      }
      // Consume the bounded upload before the DO may reject a cancelled/revoked call.
      // Otherwise forwarding its still-live body can outlast the early DO response.
      const uploadAbort = new AbortController(); const uploadTimer = setTimeout(() => uploadAbort.abort(), 1500);
      let body: string;
      try { body = JSON.stringify((await readJsonBody(request, profile.policy.maxBodyBytes, AbortSignal.any([request.signal, uploadAbort.signal]))).value); }
      catch (error) { return send({ error: 'invalid-or-incomplete-model-body' }, error instanceof ProxyRejected ? error.status : 400); }
      finally { clearTimeout(uploadTimer); }
      const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${capability.innerToken}`);
      headers.delete('content-length'); headers.delete('transfer-encoding');
      const input = new Request(profile.policy.proxyOrigin + url.pathname, { method: 'POST', headers, body, signal: request.signal, redirect: 'manual' });
      try { return await env.MODEL_RUNS.getByName(`m0-model-${capability.runId}`).fetch(input); }
      catch { return send({ error: 'model-runtime-interrupted', next: 'read run status; never replay an unknown call under a new ID' }, 500); }
    }
    if (!hasModelOperatorAuthorization(request, env.M0_PROBE_TOKEN)) return send({ error: 'operator-required' }, 401);
    if (url.pathname === '/health' && request.method === 'GET') return send({ mode: profile.mode, liveEnabled: profile.live, protocolVersion: env.PROTOCOL_VERSION, realProviderCalls: profile.live ? null : 0,
      ...(profile.live ? { fixedRunId: GO_LIVE_BUDGET.runId, maxPlatformDispatches: 2, absoluteCashCapProven: false } : {}) });
    const match = /^\/probe\/([a-z0-9-]+)\/(status|revoke|restart|arm-abort|init\/(alpha|bravo))$/.exec(url.pathname);
    if (!match || !isRunId(match[1]) || profile.live && match[1] !== GO_LIVE_BUDGET.runId) return send({ error: 'route-denied' }, 404);
    const runId = match[1], action = match[2];
    if (profile.live && (action === 'init/bravo' || action === 'arm-abort')) return send({ error: 'fixed-live-action-denied' }, 403);
    if (request.method !== (action === 'status' ? 'GET' : 'POST')) return send({ error: 'method-denied' }, 405);
    if (!await hasEmptyBody(request)) return send({ error: 'empty-body-required' }, 400);
    const run = env.MODEL_RUNS.getByName(`m0-model-${runId}`);
    try {
      if (action.startsWith('init/')) {
        const tenant = match[3]; if (!isTenant(tenant)) return send({ error: 'tenant-denied' }, 403);
        const result: InitializationResult = await run.initialize(runId, tenant);
        return send({ ...result, capabilities: result.capabilities.map(({ callId, token }) => ({ callId, token: wrapGatewayCapability(token, env.M0_PROBE_TOKEN) })) });
      }
      if (action === 'status') return send(await run.status(runId));
      if (action === 'revoke') return send(await run.revoke(runId));
      if (action === 'arm-abort') return send(await run.armAbort(runId));
      await run.restart(runId); return send({ error: 'restart-did-not-interrupt' }, 500);
    } catch (error) { return send({ error: 'control-operation-interrupted', next: 'read status; do not blindly repeat mutations' }, error instanceof ProxyRejected ? error.status : 500); }
  },
} satisfies ExportedHandler<M0ModelProxyEnv>;
