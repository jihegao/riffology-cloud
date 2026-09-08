import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runGoPiProbe } from '../../../services/runtime/go-pi-probe.mjs';

const ORIGIN = 'https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev';
const RUN = 'go-live-g0-20260906';
const MODEL = 'deepseek-v4-flash';
const MARKER = 'M0_GO_a12345678901234567890123456789bc';
const scope = { tenantId: 'm0-alpha', projectId: `m0-alpha-${RUN}`, sessionId: '11111111-1111-4111-8111-111111111111' };
const hash = value => createHash('sha256').update(value).digest('hex');
const token = call => `m0p.${RUN}.${String(call).repeat(64)}.${'a'.repeat(64)}`;
const frame = (id, content, finish_reason = null, usage) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL,
  choices: [{ index: 0, delta: content ? { content } : {}, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
const response = (body, extra = {}) => new Response(body, { headers: { 'content-type': 'text/event-stream',
  'x-riffology-m0-mode': 'go-live-only', 'x-riffology-request-id': 'platform-fixture-request', ...extra } });

async function fixture(t) {
  const trustedCwd = await realpath(await mkdtemp(join(tmpdir(), 'go-pi-offline-')));
  let fallbackCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { fallbackCalls++; throw new Error('network forbidden'); });
  t.after(async () => { await rm(trustedCwd, { recursive: true, force: true }); assert.equal(fallbackCalls, 0); });
  const inputs = (phase, snapshot) => ({ phase, scope, marker: MARKER, trustedCwd,
    invocation: { runId: RUN, callId: phase === 'initial' ? 'call-1' : 'call-2', token: token(phase === 'initial' ? 1 : 2), expiresAtMs: Date.now() + 60000, scope },
    ...(snapshot ? { snapshot } : {}) });
  const requests = [];
  let streamCancelled = false, modelSignalAborted = false;
  const transport = async request => {
    const raw = await request.clone().text(), call = request.headers.get('authorization') === `Bearer ${token(1)}` ? 1 : 2;
    assert.equal(request.url.startsWith(ORIGIN + '/v1/'), true); assert.equal(request.redirect, 'manual'); assert.equal(request.method, 'POST');
    requests.push({ url: request.url, raw, call, body: raw ? JSON.parse(raw) : null });
    if (request.url.endsWith('/cancel')) {
      assert.equal(raw, ''); assert.equal(call, 2);
      return Response.json({ runId: RUN, callId: `call-${call}`, cancelled: true }, { headers: { 'x-riffology-m0-mode': 'go-live-only' } });
    }
    assert.equal(request.url, ORIGIN + '/v1/chat/completions');
    assert.equal(requests.at(-1).body.max_tokens, 256); assert.equal(requests.at(-1).body.max_completion_tokens, undefined);
    assert.deepEqual(requests.at(-1).body.thinking, { type: 'disabled' });
    const id = `offline-SSE-response-${call}`;
    if (call === 1) return response(frame(id, MARKER) + frame(id, '', 'stop', { prompt_tokens: 37, completion_tokens: 12, total_tokens: 49 }) + 'data: [DONE]\n\n');
    request.signal.addEventListener('abort', () => { modelSignalAborted = true; }, { once: true });
    const pieces = ['Recall: ', MARKER.slice(0, 14), MARKER.slice(14), '\n1\n2\n'];
    return response(new ReadableStream({ async pull(sink) {
      if (!pieces.length) return new Promise(() => {});
      await new Promise(resolve => setTimeout(resolve, 4));
      try { sink.enqueue(new TextEncoder().encode(frame(id, pieces.shift()))); } catch {}
    }, cancel() { streamCancelled = true; } }));
  };
  return { inputs, transport, requests, cancelled: () => ({ streamCancelled, modelSignalAborted }) };
}

test('actual Pi SDK completes once, restores full checkpoint with call-2, then explicitly cancels on a split marker', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const first = await runGoPiProbe(f.inputs('initial'), { transport: f.transport });
  assert.equal(first.passed, true, JSON.stringify(first)); assert.equal(first.outcome, 'completed'); assert.equal(first.sdkVersion, '0.85.0');
  assert.equal(first.evidenceMode, 'offline-injected-transport'); assert.equal(first.realProviderCalls, null);
  assert.deepEqual(first.responseIds, ['offline-SSE-response-1']);
  assert.equal(first.requests[0].upstreamRequestId, null, 'an absent supplier header is not invented');
  const secondInput = f.inputs('restored', first.snapshot);
  const second = await runGoPiProbe(secondInput, { transport: f.transport });
  assert.equal(second.passed, true); assert.equal(second.outcome, 'aborted'); assert.equal(second.cancelledWhileActive, true);
  assert.equal(second.serverTerminalConfirmed, false); assert.equal(second.cancellation.serverTerminalConfirmed, false);
  assert.equal(second.cancellation.remote, 'acknowledged'); assert.equal(second.modelTransportAttempts, 1);
  assert.equal(second.proxyCancelTransportAttempts, 1); assert.deepEqual(second.responseIds, ['offline-SSE-response-2']);
  assert.ok(second.markerObservedAtMs <= second.cancelRequestedAtMs && second.cancelRequestedAtMs <= second.settledAtMs);
  assert.equal(second.inputSnapshotSha256, hash(JSON.stringify(first.snapshot)));
  assert.deepEqual(f.requests.map(row => [row.call, row.url.split('/').at(-1)]), [[1, 'completions'], [2, 'completions'], [2, 'cancel']]);
  const body = f.requests[1].body;
  assert.equal(body.messages.length, 4); assert.ok(!body.messages.at(-1).content.includes(MARKER));
  assert.equal(body.messages[1].content, f.requests[0].body.messages[1].content); assert.equal(body.messages[2].content, MARKER);
  assert.equal(second.requests[0].bodySha256, hash(f.requests[1].raw));
  assert.deepEqual(f.cancelled(), { streamCancelled: true, modelSignalAborted: true });
  for (const output of [first, second]) {
    assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 65536);
    assert.equal(output.duplicatePromptRejected, true); assert.equal(output.globalFetchCalls, 0);
    assert.equal(JSON.stringify(output).includes(token(1)), false); assert.equal(JSON.stringify(output).includes(token(2)), false);
  }
});

test('wrong phase/call, scope, token, arbitrary model/provider/URL and credential inputs fail before transport', async t => {
  const f = await fixture(t); let attempts = 0;
  const transport = () => { attempts++; throw new Error('must not dispatch'); };
  const base = f.inputs('initial');
  for (const patch of [{ phase: 'other' }, { scope: { ...scope, tenantId: 'm0-bravo' } },
    { invocation: { ...base.invocation, callId: 'call-2' } }, { invocation: { ...base.invocation, expiresAtMs: Infinity } },
    { invocation: { ...base.invocation, token: 'arbitrary-secret' } }, { snapshot: {} }, { marker: 'bad\nmarker' },
    { proxyOrigin: 'https://evil.invalid' }, { modelId: 'other' }, { providerApiKey: 'synthetic-secret' }, { prompt: 'arbitrary prompt' }]) {
    await assert.rejects(runGoPiProbe({ ...base, ...patch }, { transport }), /go-probe-/);
  }
  assert.equal(attempts, 0);
});

test('restoration refuses absent, nontext, changed-scope, corrupted or credential-bearing checkpoint before a second dispatch', async t => {
  const f = await fixture(t), first = await runGoPiProbe(f.inputs('initial'), { transport: f.transport });
  const missingMarker = structuredClone(first.snapshot);
  missingMarker.entries.find(e => e.type === 'message' && e.message.role === 'assistant').message.content = [{ type: 'text', text: 'forgot marker' }];
  const multimodal = structuredClone(first.snapshot);
  multimodal.entries.find(e => e.type === 'message').message.content = [{ type: 'image', data: 'abc', mimeType: 'image/png' }];
  const otherScope = structuredClone(first.snapshot); otherScope.scope.sessionId = '22222222-2222-4222-8222-222222222222';
  const leaked = structuredClone(first.snapshot); leaked.entries[0].leak = token(1);
  for (const snapshot of [undefined, missingMarker, multimodal, leaked]) await assert.rejects(runGoPiProbe(f.inputs('restored', snapshot), { transport: f.transport }));
  const mismatch = await runGoPiProbe(f.inputs('restored', otherScope), { transport: f.transport });
  assert.equal(mismatch.passed, false); assert.equal(mismatch.proxyModelTransportAttempts, 0);
  assert.equal(f.requests.length, 1);
});

test('HTTP errors, redirects, wrong response URL and fixture-only responses never retry or become live success', async t => {
  const f = await fixture(t);
  for (const mode of ['503', 'redirect', 'wrong-url', 'fixture-only']) {
    let models = 0, cancels = 0;
    const transport = async request => {
      if (request.url.endsWith('/cancel')) { cancels++; return Response.json({}, { headers: { 'x-riffology-m0-mode': 'go-live-only' } }); }
      models++;
      if (mode === '503') return new Response(token(1), { status: 503, headers: { 'x-riffology-m0-mode': 'go-live-only' } });
      if (mode === 'redirect') return new Response('', { status: 307, headers: { location: 'https://evil.invalid/', 'x-riffology-m0-mode': 'go-live-only' } });
      const value = response(frame('offline', MARKER) + frame('offline', '', 'stop') + 'data: [DONE]\n\n');
      if (mode === 'wrong-url') Object.defineProperty(value, 'url', { value: 'https://evil.invalid/v1/chat/completions' });
      if (mode === 'fixture-only') value.headers.set('x-riffology-m0-mode', 'fixture-only');
      return value;
    };
    const output = await runGoPiProbe(f.inputs('initial'), { transport });
    assert.equal(output.passed, false); assert.equal(models, 1); assert.ok(cancels <= 1);
    assert.equal(output.evidenceMode, 'offline-injected-transport'); assert.equal(JSON.stringify(output).includes(token(1)), false);
  }
});

test('marker-free completion is failed evidence, with no automatic third request or fabricated recall', async t => {
  const f = await fixture(t);
  const result = await runGoPiProbe(f.inputs('initial'), { transport: async () => response(frame('offline', 'forgotten') + frame('offline', '', 'stop') + 'data: [DONE]\n\n') });
  assert.equal(result.outcome, 'completed'); assert.equal(result.passed, false); assert.equal(result.markerObservedAtMs, null);
  assert.equal(result.proxyModelTransportAttempts, 1); assert.equal(result.proxyCancelTransportAttempts, 0);
});

test('a stalled model transport is bounded by capability expiry, remains unknown, and is never replayed', { timeout: 6000 }, async t => {
  const f = await fixture(t); const input = f.inputs('initial'); input.invocation.expiresAtMs = Date.now() + 200;
  let models = 0, cancels = 0;
  const start = Date.now();
  const output = await runGoPiProbe(input, { transport: async request => {
    if (request.url.endsWith('/cancel')) { cancels++; return Response.json({}, { headers: { 'x-riffology-m0-mode': 'go-live-only' } }); }
    models++; return new Promise(() => {});
  } });
  assert.ok(Date.now() - start < 3000); assert.equal(output.passed, false); assert.equal(models, 1); assert.equal(cancels, 1);
  assert.equal(output.realProviderCalls, null); assert.equal(output.serverTerminalConfirmed, false);
});

test('a complete upstream SSE buffered with the marker never proves server cancellation', async t => {
  const f = await fixture(t), first = await runGoPiProbe(f.inputs('initial'), { transport: f.transport });
  let attempts = 0, alreadyTerminal = false;
  const second = await runGoPiProbe(f.inputs('restored', first.snapshot), { transport: async request => {
    if (request.url.endsWith('/cancel')) {
      assert.equal(alreadyTerminal, true);
      return Response.json({ runId: RUN, callId: 'call-2', cancelled: true }, { headers: { 'x-riffology-m0-mode': 'go-live-only' } });
    }
    attempts++; alreadyTerminal = true;
    return response(frame('offline-completed-before-client-cancel', MARKER) + frame('offline-completed-before-client-cancel', '', 'stop') + 'data: [DONE]\n\n');
  } });
  assert.equal(attempts, 1); assert.equal(second.cancelledWhileActive, true);
  assert.equal(second.markerObservation.eventType, 'message_update'); assert.equal(second.markerObservation.deltaType, 'text_delta');
  assert.equal(second.serverTerminalConfirmed, false); assert.equal(second.cancellation.serverTerminalConfirmed, false);
  assert.equal(second.realProviderCalls, null, 'client cancellation never invents supplier or durable facts');
});

test('an uncooperative cancellation response remains bounded and cannot pass the restored phase', { timeout: 7000 }, async t => {
  const f = await fixture(t), first = await runGoPiProbe(f.inputs('initial'), { transport: f.transport });
  let cancels = 0;
  const start = Date.now();
  const second = await runGoPiProbe(f.inputs('restored', first.snapshot), { transport: request => {
    if (request.url.endsWith('/cancel')) { cancels++; return new Promise(() => {}); }
    return f.transport(request);
  } });
  assert.ok(Date.now() - start < 5000); assert.equal(second.passed, false); assert.equal(second.outcome, 'aborted');
  assert.equal(second.cancellation.remote, 'unconfirmed'); assert.equal(cancels, 1); assert.equal(second.serverTerminalConfirmed, false);
});

test('capabilities echoed across model deltas, headers or snapshot text are absent from the serialized result', async t => {
  const f = await fixture(t), capability = token(1), middle = Math.floor(capability.length / 2);
  const result = await runGoPiProbe(f.inputs('initial'), { transport: async () => response(
    frame('offline-secret-echo', capability.slice(0, middle)) + frame('offline-secret-echo', capability.slice(middle))
      + frame('offline-secret-echo', MARKER) + frame('offline-secret-echo', '', 'stop') + 'data: [DONE]\n\n',
    { 'x-riffology-request-id': capability }) });
  assert.equal(result.outcome, 'completed');
  const encoded = JSON.stringify(result);
  assert.ok(!encoded.includes(capability)); assert.ok(!encoded.includes(capability.slice(0, middle)));
  assert.ok(!encoded.includes('m0p.')); assert.ok(encoded.includes('[redacted-model-capability]'));
});
