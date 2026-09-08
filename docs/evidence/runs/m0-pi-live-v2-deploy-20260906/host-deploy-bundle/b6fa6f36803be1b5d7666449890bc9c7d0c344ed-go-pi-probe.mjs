import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { VERSION } from '@earendil-works/pi-coding-agent';
import { createProxyPiSession } from './proxy-pi.mjs';

const ORIGIN = 'https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev';
const RUN = 'go-live-g0-20260906';
const MODEL = 'deepseek-v4-flash';
const SYSTEM = 'You are running a short platform memory diagnostic. Reply only in plain text. Follow the requested output format exactly.';
const RESTORED_PROMPT = 'Recall the exact marker from our previous exchange. Output that marker first, then count from 1 to 200, one number per line. Keep going until interrupted.';
const bytes = value => Buffer.byteLength(value, 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const nativeFetch = globalThis.fetch;
let running = false;
const firstPrompt = marker => `Remember this exact marker for the next exchange: ${marker}\nReply with only the marker, then stop.`;
const textOf = message => typeof message.content === 'string' ? message.content
  : Array.isArray(message.content) && message.content.every(part => part?.type === 'text' && typeof part.text === 'string')
    ? message.content.map(part => part.text).join('') : fail('go-probe-text-history-required');
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));
const safeId = value => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value) ? value : null;
const discard = response => { void response?.body?.cancel().catch(() => {}); };

/** One phase per isolated, supervisor-owned child. No provider key, operator key,
 * URL, model or prompt is accepted. The caller supplies the same trusted scope
 * for both phases and distinct call capabilities. It owns process termination,
 * checkpoint persistence and directory cleanup. Injection is offline test
 * evidence only; this function never proves the proxy's durable terminal state
 * or supplier dispatch count. No automatic retry or third model invocation. */
export async function runGoPiProbe(input, options = {}) {
  if (running) fail('go-probe-already-running');
  if (!fields(options, ['transport']) || options.transport !== undefined && typeof options.transport !== 'function'
    || !fields(input, ['phase', 'scope', 'invocation', 'snapshot', 'marker', 'trustedCwd'])) fail('go-probe-invalid-input');
  const data = structuredClone(input);
  const { phase, scope, invocation, marker, trustedCwd, snapshot } = data;
  if (!['initial', 'restored'].includes(phase) || !fields(scope, ['tenantId', 'projectId', 'sessionId'])
    || scope.tenantId !== 'm0-alpha' || scope.projectId !== `m0-alpha-${RUN}`
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scope.sessionId ?? '')
    || !fields(invocation, ['runId', 'callId', 'token', 'expiresAtMs', 'scope'])
    || invocation.runId !== RUN || invocation.callId !== (phase === 'initial' ? 'call-1' : 'call-2')
    || !fields(invocation.scope, ['tenantId', 'projectId', 'sessionId'])
    || Object.keys(scope).some(key => scope[key] !== invocation.scope[key])
    || !new RegExp(`^m0p\\.${RUN}\\.[0-9a-f]{64}\\.[0-9a-f]{64}$`).test(invocation.token ?? '')
    || !Number.isSafeInteger(invocation.expiresAtMs) || invocation.expiresAtMs <= Date.now()
    || !/^[A-Za-z0-9_-]{16,96}$/.test(marker ?? '') || invocation.token.includes(marker)
    || typeof trustedCwd !== 'string' || !isAbsolute(trustedCwd) || resolve(trustedCwd) === '/'
    || phase === 'initial' && snapshot !== undefined || phase === 'restored' && !snapshot
    || bytes(JSON.stringify(data)) > 65536) fail('go-probe-invalid-input');
  const info = await lstat(trustedCwd);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(trustedCwd) !== resolve(trustedCwd)) fail('go-probe-invalid-directory');
  const token = invocation.token;
  if (snapshot && (bytes(JSON.stringify(snapshot)) > 32768 || JSON.stringify(snapshot).includes('m0p.'))) fail('go-probe-unsafe-checkpoint');
  const history = snapshot?.entries?.filter(entry => entry.type === 'message').map(entry => ({ role: entry.message?.role,
    content: textOf(entry.message), stopReason: entry.message.stopReason })) ?? [];
  if (phase === 'restored' && (history.length !== 2 || history[0].role !== 'user' || history[0].content !== firstPrompt(marker)
    || history[1].role !== 'assistant' || history[1].stopReason !== 'stop' || !history[1].content.includes(marker))) fail('go-probe-invalid-restored-history');
  const prompt = phase === 'initial' ? firstPrompt(marker) : RESTORED_PROMPT;
  if (phase === 'restored' && prompt.includes(marker)) fail('go-probe-marker-in-new-prompt');
  const transport = options.transport ?? nativeFetch;
  const evidenceMode = options.transport ? 'offline-injected-transport' : 'go-live-proxy';
  const requests = [], events = [], responseIds = new Set();
  const startedAtMs = Date.now();
  let host, cancellationPromise, cancellation = null, outcome = 'failed', failureCode = null, checkpoint = null;
  let text = '', eventCount = 0, droppedEvents = 0, globalFetchCalls = 0, modelSends = 0, cancelSends = 0;
  let markerObservedAtMs = null, cancelRequestedAtMs = null, cancelledWhileActive = false, settledAtMs = null;
  let assistantTerminalEventSeen = false, markerObservation = null;
  let wireHistoryMatches = false, duplicatePromptRejected = false, modelTransportAttempts = 0, restoredHistoryMatches = false;
  const previousFetch = globalThis.fetch;
  const redact = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string'
    ? item.replaceAll(token, '[redacted-model-capability]').replace(/m0p\.[A-Za-z0-9_-]+\.[0-9a-f]{64}(?:\.[0-9a-f]{64})?/g, '[redacted-model-capability]') : item));
  if (running) fail('go-probe-already-running');
  running = true;
  globalThis.fetch = () => { globalFetchCalls++; fail('go-probe-global-fetch-denied'); };
  try {
    host = await createProxyPiSession({ trustedCwd, scope, invocation, snapshot, systemPrompt: SYSTEM,
      proxyOrigin: ORIGIN, modelId: MODEL, maxOutputTokens: 256, maxBodyBytes: 8192, callTimeoutMs: 30000, cancelTimeoutMs: 3000,
      transport: async request => {
        const url = new URL(request.url), model = url.pathname === '/v1/chat/completions';
        if (url.origin !== ORIGIN || !['/v1/chat/completions', '/v1/cancel'].includes(url.pathname)
          || url.search || url.hash || request.method !== 'POST' || request.redirect !== 'manual'
          || request.headers.get('authorization') !== `Bearer ${token}`) fail('go-probe-transport-denied');
        if (model ? ++modelSends !== 1 : ++cancelSends !== 1) fail('go-probe-replay-denied');
        const raw = await request.clone().text();
        if (bytes(raw) > 8192 || !model && raw !== '') fail('go-probe-wire-limit');
        const body = model ? JSON.parse(raw) : null;
        const row = { path: url.pathname, callId: invocation.callId, body, bodyBytes: bytes(raw), bodySha256: sha(raw),
          attemptedAtMs: null, status: null, platformRequestId: null, upstreamRequestId: null, responseMode: null, responseAccepted: false };
        requests.push(row);
        if (model) {
          if (body.model !== MODEL || body.stream !== true || body.max_tokens !== 256 || body.max_completion_tokens !== undefined
            || JSON.stringify(body.thinking) !== '{"type":"disabled"}' || body.stream_options?.include_usage !== true
            || !Array.isArray(body.messages) || body.messages.length > 8) fail('go-probe-wire-policy');
          // Pi appends the trusted working-directory line to this fixed prompt.
          const expected = [{ role: 'system', content: host.inspect().systemPrompt }, ...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: prompt }];
          wireHistoryMatches = JSON.stringify(body.messages) === JSON.stringify(expected);
          if (!wireHistoryMatches) fail('go-probe-wire-history-mismatch');
        }
        request.signal.throwIfAborted(); row.attemptedAtMs = Date.now();
        const response = await transport(request);
        row.status = response.status;
        row.platformRequestId = safeId(response.headers.get('x-riffology-request-id'));
        row.upstreamRequestId = safeId(response.headers.get('x-riffology-upstream-request-id'));
        row.responseMode = safeId(response.headers.get('x-riffology-m0-mode'));
        if (response.redirected || response.url && response.url !== request.url
          || evidenceMode === 'go-live-proxy' && response.url !== request.url || row.responseMode !== 'go-live-only') {
          discard(response); fail('go-probe-live-response-required');
        }
        row.responseAccepted = response.status === 200;
        return response;
      },
    });
    const before = host.inspect();
    restoredHistoryMatches = JSON.stringify(before.messages.map(message => ({ role: message.role, content: textOf(message) })))
      === JSON.stringify(history.map(({ role, content }) => ({ role, content })));
    if (!restoredHistoryMatches) fail('go-probe-session-history-mismatch');
    host.subscribe(event => {
      eventCount++;
      const delta = event.assistantMessageEvent;
      const responseId = safeId(event.message?.responseId ?? delta?.partial?.responseId);
      if (responseId) responseIds.add(responseId);
      if (event.type === 'message_end' && event.message?.role === 'assistant') assistantTerminalEventSeen = true;
      if (events.length < 128) events.push({ type: event.type, deltaType: delta?.type ?? null, responseId,
        atMs: Date.now(), deltaChars: delta?.type === 'text_delta' ? delta.delta.length : 0 });
      else droppedEvents++;
      if (delta?.type !== 'text_delta') return;
      text += delta.delta;
      if (bytes(text) > 16384) { failureCode = 'go-probe-text-limit'; cancellationPromise ??= host.cancel(); return; }
      if (markerObservedAtMs === null && text.includes(marker)) {
        markerObservedAtMs = Date.now();
        markerObservation = { eventType: event.type, deltaType: delta.type, localActive: host.inspect().active === true,
          assistantTerminalEventSeen, partialStopReason: safeId(delta.partial?.stopReason) };
        if (phase === 'restored') {
          cancelledWhileActive = host.inspect().active === true;
          cancelRequestedAtMs = Date.now(); cancellationPromise = host.cancel();
        }
      }
    });
    const result = await host.prompt(prompt); outcome = result.outcome; settledAtMs = Date.now();
    if (cancellationPromise) cancellation = await cancellationPromise;
    try { await host.prompt('Duplicate diagnostic must not dispatch.'); } catch { duplicatePromptRejected = true; }
    modelTransportAttempts = host.inspect().modelTransportAttempts;
    checkpoint = host.snapshot();
  } catch { failureCode ??= 'go-probe-execution-failed'; }
  finally {
    try {
      try { await host?.dispose(); } catch { failureCode ??= 'go-probe-dispose-failed'; }
      if (host) {
        const final = host.inspect();
        modelTransportAttempts = final.modelTransportAttempts;
        cancellation ??= final.cancellation;
      }
    } catch { failureCode ??= 'go-probe-final-inspection-failed'; }
    finally { globalThis.fetch = previousFetch; running = false; }
  }
  const passed = !failureCode && VERSION === '0.85.0' && modelSends === 1 && modelTransportAttempts === 1 && globalFetchCalls === 0
    && wireHistoryMatches && restoredHistoryMatches && duplicatePromptRejected && markerObservedAtMs !== null
    && (phase === 'initial' ? outcome === 'completed' && cancelSends === 0
      : outcome === 'aborted' && cancelledWhileActive && cancellation?.local === 'settled'
        && cancellation.remote === 'acknowledged' && cancelSends === 1);
  const output = redact({ schemaVersion: 1, operation: 'G0-T01-controlled-Go-Pi', phase, evidenceMode, sdkVersion: VERSION,
    runId: RUN, callId: invocation.callId, scope, pid: process.pid, passed, outcome, failureCode,
    startedAtMs, settledAtMs, elapsedMs: Date.now() - startedAtMs, markerObservedAtMs, cancelRequestedAtMs, cancelledWhileActive,
    markerObservation,
    markerSha256: sha(marker), text, snapshot: checkpoint, inputSnapshotSha256: snapshot ? sha(JSON.stringify(snapshot)) : null,
    wireHistoryMatches, restoredHistoryMatches, duplicatePromptRejected, cancellation, requests, events, eventCount, droppedEvents,
    responseIds: [...responseIds], modelTransportAttempts, proxyModelTransportAttempts: modelSends, proxyCancelTransportAttempts: cancelSends,
    globalFetchCalls, realProviderCalls: null, billingAmount: null, serverTerminalConfirmed: false,
    limits: { maxOutputTokens: 256, maxBodyBytes: 8192, maxMessages: 8, modelDeadlineMs: 30000, cancelDeadlineMs: 3000, maxOutputBytes: 65536 },
    scopeLimit: 'Client evidence only. Read durable proxy receipt separately; injected transport is not a live provider result.' });
  if (bytes(JSON.stringify(output)) > 65536) fail('go-probe-output-limit');
  return output;
}
