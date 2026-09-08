import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProxyPiSession } from '../../../services/runtime/proxy-pi.mjs';
import { createModelProxy } from '../../../spikes/m0-model-proxy/index.ts';
import { RunReservationAuthority } from '../../../spikes/m0-model-proxy/authority.ts';
import { issueCapability, verifyCapability, TRUSTED_PI_PRINCIPAL } from '../../../spikes/m0-model-proxy/capability.ts';
import { unwrapGatewayAuthorization, wrapGatewayCapability } from '../../../spikes/m0-model-proxy/gateway-auth.ts';

const ORIGIN = 'https://proxy.riffology.invalid';
const MODEL = 'm0-text-fixture';
const scope = { tenantId: 'm0-alpha', projectId: 'project-alpha', sessionId: '11111111-1111-4111-8111-111111111111' };

async function fixture(t, { mode = 'normal', hangingCancel = false } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'riffology-proxy-pi-'));
  const nativeFetch = globalThis.fetch;
  let defaultFetchCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { defaultFetchCalls++; throw new Error('unexpected default fetch'); });
  const now = Date.now(), runId = 'proxy-pi-local-test', expiresAtMs = now + 60000;
  const operator = 'local-operator-fixture-aaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const base = { kind: 'trusted-pi', principal: TRUSTED_PI_PRINCIPAL, tenantId: scope.tenantId, workspaceId: 'workspace-alpha', runId, expiresAtMs };
  const issued = [1, 2, 3].map(n => ({ callId: `call-${n}`, ...issueCapability({ ...base, callId: `call-${n}` }, now) }));
  const leases = issued.map(item => ({ runId, callId: item.callId, token: wrapGatewayCapability(item.token, operator), expiresAtMs, scope }));
  let ledger = null, tail = Promise.resolve();
  const store = { transact(operation) {
    const next = tail.then(() => { const result = operation(structuredClone(ledger)); ledger = structuredClone(result.state); return structuredClone(result.value); });
    tail = next.catch(() => {}); return next;
  } };
  const authority = new RunReservationAuthority({ ...base, provider: 'm0-fixture', model: MODEL, maxRunMicrousd: 50000,
    rate: { provider: 'm0-fixture', model: MODEL, version: 'local-synthetic-not-money', source: 'https://rates.invalid/fixture',
      verifiedAtMs: now, expiresAtMs, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000, boundsAllBillableTokens: true } }, store);
  const requests = [], cancelled = new Set(), controllers = new Map(), completions = [];
  let fixtureDispatches = 0;
  const authenticate = request => {
    const outer = unwrapGatewayAuthorization(request.headers.get('authorization'), operator);
    if (!outer) return null;
    for (const item of issued) {
      const result = verifyCapability(outer.innerToken, item.record);
      if (result) return result;
    }
    return null;
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes <= 8192); chunks.push(chunk); }
      const text = Buffer.concat(chunks).toString('utf8');
      const request = new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, ...(text ? { body: text } : {}) });
      const invocation = authenticate(request);
      if (!invocation) { res.writeHead(401); res.end(); return; }
      requests.push({ path: req.url, callId: invocation.callId, body: text ? JSON.parse(text) : null });
      if (req.url === '/v1/cancel') {
        if (hangingCancel) return;
        cancelled.add(invocation.callId); controllers.get(invocation.callId)?.abort();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ runId, callId: invocation.callId, cancelled: true })); return;
      }
      assert.equal(req.url, '/v1/chat/completions');
      if (mode === 'http-error' || mode === 'redirect') {
        res.writeHead(mode === 'redirect' ? 307 : 503, { 'content-type': 'application/json', location: 'https://forbidden.invalid/steal' });
        res.end(JSON.stringify({ error: { message: leases[0].token } })); return;
      }
      const controller = new AbortController(); controllers.set(invocation.callId, controller);
      // Deliberately do not infer server cancellation from the Node client socket closing.
      const proxy = createModelProxy({ proxyOrigin: ORIGIN, upstreamOrigin: 'https://provider.invalid', upstreamPath: '/v1/chat/completions',
        provider: 'm0-fixture', model: MODEL, callerPrincipal: TRUSTED_PI_PRINCIPAL, mapper: 'deepseek-thinking-disabled',
        maxBodyBytes: 8192, maxInputTokens: 128, maxOutputTokens: 32, maxResponseBytes: 65536, maxFrameBytes: 8192, timeoutMs: 2000 }, {
        authenticate: async r => cancelled.has(invocation.callId) ? null : authenticate(r), authority,
        inputTokenBound: async () => ({ kind: 'verified-upper-bound', provider: 'm0-fixture', model: MODEL, version: 'fixed-fixture-only', tokens: 128 }),
        resolveSecret: async () => 'synthetic-provider-key',
        fetch: async (target, init) => {
          assert.equal(target, 'https://provider.invalid/v1/chat/completions'); fixtureDispatches++;
          const frame = (content, finish, usage) => `data: ${JSON.stringify({ id: `fixture-${invocation.callId}`, object: 'chat.completion.chunk',
            model: MODEL, choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;
          const middle = Math.floor(leases[0].token.length / 2);
          const start = mode === 'split-capability'
            ? frame(leases[0].token.slice(0, middle), null) + frame(leases[0].token.slice(middle), null)
            : frame(mode === 'echo-capability' ? leases[0].token
              : mode === 'ordinary-prefix' ? `ordinary text ${leases[0].token.slice(0, 3)}` : 'fixture-response', null);
          if (invocation.callId !== 'call-3') return new Response(start + frame('', 'stop', { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
          const stream = new ReadableStream({ start(sink) {
            sink.enqueue(new TextEncoder().encode(start));
            init.signal.addEventListener('abort', () => { try { sink.error(new Error('synthetic-cancel')); } catch {} }, { once: true });
          } });
          return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
        },
      });
      const exchange = await proxy.handle(new Request(request, { signal: controller.signal }));
      completions.push(exchange.completion.finally(() => controllers.delete(invocation.callId)));
      res.writeHead(exchange.response.status, Object.fromEntries(exchange.response.headers));
      const reader = exchange.response.body.getReader();
      try { while (true) { const part = await reader.read(); if (part.done) break; res.write(part.value); } res.end(); }
      catch { res.destroy(); }
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = request => {
    const url = new URL(request.url);
    assert.equal(url.origin, ORIGIN);
    assert.ok(['/v1/chat/completions', '/v1/cancel'].includes(url.pathname));
    assert.equal(request.redirect, 'manual');
    return nativeFetch(new Request(`http://127.0.0.1:${server.address().port}${url.pathname}`, request));
  };
  // The logical URL is checked above; normalize only the loopback fixture response URL.
  const mappedTransport = async request => {
    const response = await transport(request);
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const hosts = [];
  const create = async (index = 0, extra = {}) => {
    const host = await createProxyPiSession({ trustedCwd: cwd, scope, systemPrompt: 'Fixed platform simulation prompt.',
      fixedSkills: [{ name: 'simulation', content: 'Fixed platform skill.' }], proxyOrigin: ORIGIN, modelId: MODEL,
      invocation: leases[index], transport: mappedTransport, callTimeoutMs: 2500, cancelTimeoutMs: 200, ...extra });
    hosts.push(host); return host;
  };
  t.after(async () => {
    await Promise.all(hosts.map(host => host.dispose()));
    for (const controller of controllers.values()) controller.abort();
    await Promise.allSettled(completions);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
    assert.equal(defaultFetchCalls, 0, 'the real SDK used only the supplied proxy transport');
  });
  return { create, leases, requests, ledger: () => structuredClone(ledger), fixtureDispatches: () => fixtureDispatches, completions, controllers };
}

test('controlled Pi sends full Session through the proxy and restores history with a different capability', { timeout: 8000 }, async t => {
  const f = await fixture(t); const first = await f.create(); const events = [];
  first.subscribe(event => events.push(event));
  assert.equal((await first.prompt('Remember marker-abc-123.')).outcome, 'completed');
  await assert.rejects(first.prompt('do not spend another call'), /consumed/);
  const checkpoint = first.snapshot(); await first.dispose();
  const restored = await f.create(1, { snapshot: checkpoint });
  assert.equal((await restored.prompt('Continue the previous discussion.')).outcome, 'completed');
  assert.deepEqual(f.requests.map(r => r.callId), ['call-1', 'call-2']);
  const history = f.requests[1].body.messages;
  assert.match(history[0].content, /Fixed platform simulation prompt/);
  assert.match(history[0].content, /Fixed platform skill/);
  assert.equal(history.find(m => m.role === 'user').content, 'Remember marker-abc-123.');
  assert.equal(history.find(m => m.role === 'assistant').content, 'fixture-response');
  assert.equal(history.at(-1).content, 'Continue the previous discussion.');
  for (const r of f.requests) { assert.equal(r.body.max_tokens, 32); assert.deepEqual(r.body.thinking, { type: 'disabled' }); }
  assert.equal(f.fixtureDispatches(), 2); assert.equal(f.ledger().dispatchCount, 2);
  for (const lease of f.leases) assert.ok(!JSON.stringify([events, checkpoint, restored.snapshot(), first.inspect()]).includes(lease.token));
});

test('explicit same-call cancel is sent once and a parallel invocation completes independently', { timeout: 8000 }, async t => {
  const f = await fixture(t); const waiting = await f.create(2), other = await f.create(0);
  let started; const observed = new Promise(resolve => { started = resolve; });
  waiting.subscribe(event => { if (event.type === 'message_update') started(); });
  const pending = waiting.prompt('Stream a diagnostic.'); await observed;
  const [receipt, duplicate, result] = await Promise.all([waiting.cancel(), waiting.cancel(), other.prompt('Finish another call.')]);
  assert.deepEqual(receipt, duplicate); assert.equal(receipt.remote, 'acknowledged');
  assert.equal(receipt.serverTerminalConfirmed, false); assert.equal((await pending).outcome, 'aborted');
  assert.equal(result.outcome, 'completed'); await waiting.dispose(); await Promise.all(f.completions);
  assert.equal(f.requests.filter(r => r.path === '/v1/cancel').length, 1);
  assert.equal(f.ledger().calls['call-3'].facts.outcome, 'cancelled');
  assert.equal(f.ledger().calls['call-3'].facts.usage.status, 'unknown');
  assert.equal(f.ledger().heldMicrousd, 384); assert.equal(f.ledger().calls['call-1'].facts.outcome, 'completed');
});

test('pre-cancel consumes the lease without a model request and dispose does not repeat the cancellation', { timeout: 8000 }, async t => {
  const f = await fixture(t); const host = await f.create();
  assert.equal((await host.cancel()).remote, 'acknowledged');
  await assert.rejects(host.prompt('too late'), /consumed/); await host.dispose();
  assert.deepEqual(f.requests.map(r => r.path), ['/v1/cancel']); assert.equal(f.ledger(), null);
});

for (const mode of ['http-error', 'redirect']) test(`${mode} never retries or exposes a capability in Pi errors and checkpoints`, { timeout: 8000 }, async t => {
  const f = await fixture(t, { mode }); const host = await f.create(), events = [];
  host.subscribe(event => events.push(event)); const result = await host.prompt('Controlled failure.');
  assert.equal(result.outcome, 'failed');
  assert.equal(host.inspect().modelTransportAttempts, 1); assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify([result, host.inspect(), host.snapshot(), events]).includes(f.leases[0].token));
});

test('transport timeout and unknown cancel remain bounded with no retry', { timeout: 8000 }, async t => {
  const f = await fixture(t); let modelAttempts = 0, cancelAttempts = 0;
  const host = await f.create(0, { callTimeoutMs: 30, cancelTimeoutMs: 30, transport: async request => {
    if (request.url.endsWith('/cancel')) cancelAttempts++; else modelAttempts++;
    return new Promise(() => {});
  } });
  assert.equal((await host.prompt('Uncooperative transport.')).outcome, 'failed');
  const result = await host.cancel(); assert.equal(result.remote, 'unconfirmed'); assert.equal(result.serverTerminalConfirmed, false);
  await host.dispose(); assert.equal(modelAttempts, 1); assert.equal(cancelAttempts, 1);
});

test('a 200 SSE body that ignores abort still terminates at the whole-call deadline', { timeout: 8000 }, async t => {
  const f = await fixture(t); let modelAttempts = 0, cancelAttempts = 0, bodyCancelled = false;
  const host = await f.create(0, { callTimeoutMs: 40, transport: async request => {
    if (request.url.endsWith('/cancel')) {
      cancelAttempts++;
      return Response.json({ runId: f.leases[0].runId, callId: f.leases[0].callId, cancelled: true });
    }
    modelAttempts++;
    return new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => { bodyCancelled = true; } }),
      { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.equal((await host.prompt('Headers arrived but body hangs.')).outcome, 'failed');
  await host.dispose(); assert.equal(bodyCancelled, true); assert.equal(modelAttempts, 1); assert.equal(cancelAttempts, 1);
});

test('bound text conversion rejects oversized Session input before any model HTTP request', { timeout: 8000 }, async t => {
  const f = await fixture(t); const host = await f.create();
  assert.equal((await host.prompt('x'.repeat(8192))).outcome, 'failed');
  assert.equal(host.inspect().modelTransportAttempts, 0); assert.equal(f.requests.length, 0);
});

test('known capability echoed by a fixture is removed from exported checkpoint and events', { timeout: 8000 }, async t => {
  const f = await fixture(t, { mode: 'echo-capability' }); const host = await f.create(); const events = [];
  host.subscribe(event => events.push(event)); await host.prompt('Synthetic echo response.');
  assert.ok(!JSON.stringify([host.snapshot(), host.inspect(), events]).includes(f.leases[0].token));
  assert.match(JSON.stringify(host.snapshot()), /redacted-model-capability/);
});

test('split SSE capability deltas and live inspect cannot reconstruct the credential', { timeout: 8000 }, async t => {
  const f = await fixture(t, { mode: 'split-capability' }); const host = await f.create(); const deltas = [], inspections = [], events = [];
  host.subscribe(event => {
    events.push(event);
    if (event.assistantMessageEvent?.type === 'text_delta') deltas.push(event.assistantMessageEvent.delta);
    inspections.push(host.inspect());
  });
  assert.equal((await host.prompt('Split diagnostic chunks.')).outcome, 'completed');
  assert.equal(deltas.join(''), '[redacted-model-capability]');
  const prefix = f.leases[0].token.slice(0, Math.floor(f.leases[0].token.length / 2));
  const leakedPaths = [];
  const locate = (value, path) => {
    if (typeof value === 'string' && value.includes(prefix)) leakedPaths.push(path);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) locate(child, `${path}.${key}`);
  };
  locate([inspections, events], 'exports');
  assert.deepEqual(leakedPaths, [], 'no capability fragment in cumulative SDK fields');
  assert.ok(!JSON.stringify(host.snapshot()).includes(f.leases[0].token));
});

test('image checkpoint restoration is refused before the SDK can silently replace image content', { timeout: 8000 }, async t => {
  const f = await fixture(t); const host = await f.create();
  await host.prompt('Create original text checkpoint.'); const snapshot = host.snapshot();
  snapshot.entries.find(e => e.type === 'message' && e.message.role === 'user').message.content.push({ type: 'image', data: 'AA==', mimeType: 'image/png' });
  await assert.rejects(f.create(1, { snapshot }), /checkpoint-text-only/);
  assert.equal(f.requests.length, 1); assert.equal(f.fixtureDispatches(), 1);
});

test('ordinary text ending in a capability prefix is flushed intact when the text completes', { timeout: 8000 }, async t => {
  const f = await fixture(t, { mode: 'ordinary-prefix' }); const host = await f.create(); const deltas = [];
  host.subscribe(event => { if (event.assistantMessageEvent?.type === 'text_delta') deltas.push(event.assistantMessageEvent.delta); });
  assert.equal((await host.prompt('Ordinary output.')).outcome, 'completed');
  assert.equal(deltas.join(''), `ordinary text ${f.leases[0].token.slice(0, 3)}`);
  assert.equal(host.inspect().messages.at(-1).content[0].text, deltas.join(''));
});

test('cancellation between Request construction and the transport microtask dispatches no model request', { timeout: 8000 }, async t => {
  const f = await fixture(t); const host = await f.create(); const OriginalRequest = globalThis.Request;
  let queued = false;
  globalThis.Request = class extends OriginalRequest {
    constructor(input, init) {
      super(input, init);
      if (!queued && input === `${ORIGIN}/v1/chat/completions` && init?.redirect === 'manual' && init?.headers?.accept === 'text/event-stream') {
        queued = true; queueMicrotask(() => { void host.cancel(); });
      }
    }
  };
  t.after(() => { globalThis.Request = OriginalRequest; });
  assert.equal((await host.prompt('Cancel immediately before transport.')).outcome, 'aborted');
  await host.cancel(); assert.equal(queued, true);
  assert.deepEqual(f.requests.map(r => r.path), ['/v1/cancel']); assert.equal(f.ledger(), null);
});
