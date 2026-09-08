import { createControlledPiSession } from './controlled-pi.mjs';

const PROVIDER = 'riffology-model-proxy';
const reject = (code) => { throw new Error(code); };
const textBytes = (text) => new TextEncoder().encode(text).byteLength;
const discard = (body) => { void body?.cancel().catch(() => {}); };
const REDACTED = '[redacted-model-capability]';
function pendingPrefix(text, token) {
  for (let length = Math.min(text.length, token.length - 1); length > 0; length--) {
    if (text.endsWith(token.slice(0, length))) return length;
  }
  return 0;
}

function untilAborted(promise, signal) {
  return new Promise((resolve, fail) => {
    const abort = () => { signal.removeEventListener('abort', abort); fail(new Error('proxy-operation-aborted')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); fail(error);
    });
    if (signal.aborted) abort();
  });
}

function withDeadline(operation, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => { controller.abort(); fail(new Error('proxy-operation-timeout')); }, ms);
  });
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
    .finally(() => clearTimeout(timer));
}

/** One model invocation per trusted host. The coordinator owns the lease and checkpoint. */
export async function createProxyPiSession({
  trustedCwd, scope, snapshot, systemPrompt, fixedSkills = [],
  proxyOrigin, modelId, invocation, maxOutputTokens = 32, maxBodyBytes = 8192,
  callTimeoutMs = 30000, cancelTimeoutMs = 3000, transport = globalThis.fetch,
}) {
  const origin = new URL(proxyOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== proxyOrigin || origin.port
    || origin.username || origin.password || origin.search || origin.hash) reject('invalid-proxy-origin');
  if (!/^[a-zA-Z0-9._/-]{1,150}$/.test(modelId ?? '') || typeof transport !== 'function') reject('invalid-proxy-model-or-transport');
  for (const [value, maximum] of [[maxOutputTokens, 256], [maxBodyBytes, 8192], [callTimeoutMs, 30000], [cancelTimeoutMs, 5000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) reject('invalid-proxy-client-limit');
  }
  const lease = structuredClone(invocation);
  if (!lease || !/^[a-zA-Z0-9._-]{32,2048}$/.test(lease.token ?? '')
    || !/^[a-zA-Z0-9_-]{1,100}$/.test(lease.callId ?? '') || !/^[a-zA-Z0-9_-]{1,100}$/.test(lease.runId ?? '')
    || !Number.isSafeInteger(lease.expiresAtMs) || lease.expiresAtMs <= Date.now()
    || ['tenantId', 'projectId', 'sessionId'].some(key => !scope?.[key] || lease.scope?.[key] !== scope[key])) reject('invalid-proxy-invocation');
  for (const entry of snapshot?.entries ?? []) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (!message || !['user', 'assistant'].includes(message.role)) reject('proxy-checkpoint-text-only');
    if (typeof message.content !== 'string' && (!Array.isArray(message.content)
      || !message.content.every(part => part?.type === 'text' && typeof part.text === 'string'))) reject('proxy-checkpoint-text-only');
  }
  const token = lease.token;
  const model = { provider: PROVIDER, id: modelId };
  const endpoint = `${proxyOrigin}/v1/chat/completions`;
  let consumed = false, active = false, disposed = false, dispatches = 0;
  let transportController, cancelPromise, lastOutcome = null, lastCancellation = null;
  const redact = (value, partial = false) => JSON.parse(JSON.stringify(value, (key, item) => {
    if (typeof item !== 'string') return item;
    const safe = item.replaceAll(token, REDACTED);
    const held = partial && ['text', 'thinking', 'delta'].includes(key) ? pendingPrefix(safe, token) : 0;
    return held ? safe.slice(0, -held) : safe;
  }));
  const requireLease = () => { if (Date.now() >= lease.expiresAtMs) reject('proxy-invocation-expired'); };

  function payloadPolicy({ payload, model: wireModel, signal }) {
    signal?.throwIfAborted(); requireLease();
    if (!active || wireModel.provider !== PROVIDER || wireModel.id !== modelId || wireModel.baseUrl !== `${proxyOrigin}/v1`) reject('proxy-call-scope-mismatch');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) reject('proxy-text-payload-required');
    // SDK cache fields with undefined values are absent from the actual JSON wire body.
    if (Object.entries(payload).some(([key, value]) => value !== undefined
      && !['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'thinking', 'temperature'].includes(key))) reject('unsupported-proxy-payload-field');
    if (payload.model !== modelId || payload.stream !== true || !Array.isArray(payload.messages)
      || payload.messages.length < 1 || payload.messages.length > 32) reject('proxy-message-limit');
    const messages = payload.messages.map(message => {
      if (!message || !['system', 'user', 'assistant'].includes(message.role)
        || Object.keys(message).some(key => !['role', 'content', 'reasoning_content'].includes(key))) reject('proxy-text-messages-required');
      let content = message.content;
      if (Array.isArray(content)) {
        if (!content.every(part => part && part.type === 'text' && typeof part.text === 'string'
          && Object.keys(part).every(key => ['type', 'text'].includes(key)))) reject('proxy-text-messages-required');
        content = content.map(part => part.text).join('');
      }
      if (typeof content !== 'string' || message.reasoning_content !== undefined
        && (message.role !== 'assistant' || typeof message.reasoning_content !== 'string')) reject('proxy-text-messages-required');
      return { ...message, content };
    });
    const approved = { model: modelId, messages, stream: true, stream_options: { include_usage: true },
      max_tokens: maxOutputTokens, thinking: { type: 'disabled' } };
    if (textBytes(JSON.stringify(approved)) > maxBodyBytes) reject('proxy-request-byte-limit');
    return approved;
  }

  async function providerFetch(input, init) {
    // Occupy the slot before any await. This is an attempt fence, not proof of server dispatch.
    if (!active || disposed || dispatches !== 0 || lastCancellation) reject('proxy-call-already-consumed');
    const request = new Request(input, init);
    requireLease(); request.signal.throwIfAborted();
    if (request.url !== endpoint || request.method !== 'POST'
      || request.headers.get('authorization') !== `Bearer ${token}`) reject('proxy-transport-scope-mismatch');
    dispatches++;
    transportController = new AbortController();
    const timer = setTimeout(() => transportController.abort(), Math.min(callTimeoutMs, lease.expiresAtMs - Date.now()));
    const signal = AbortSignal.any([request.signal, transportController.signal]);
    try {
      const body = await untilAborted(request.text(), signal);
      if (textBytes(body) > maxBodyBytes) reject('proxy-request-byte-limit');
      signal.throwIfAborted();
      const outgoing = new Request(endpoint, { method: 'POST', body, signal, redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' } });
      const pending = Promise.resolve().then(() => { signal.throwIfAborted(); requireLease(); return transport(outgoing); });
      void pending.then(response => { if (signal.aborted) discard(response.body); }, () => {});
      const response = await untilAborted(pending, signal);
      if (signal.aborted) { discard(response.body); reject('proxy-model-request-aborted'); }
      if (response.status !== 200 || response.redirected || response.url && response.url !== endpoint
        || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
        discard(response.body);
        reject('proxy-response-rejected');
      }
      const reader = response.body.getReader();
      let ended = false, bytes = 0, sink;
      const finish = () => {
        ended = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        void reader.cancel().catch(() => {});
      };
      const abort = () => { if (!ended) { finish(); try { sink.error(new Error('proxy-model-stream-aborted')); } catch {} } };
      const bodyStream = new ReadableStream({
        start(controller) { sink = controller; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); },
        async pull(controller) {
          if (ended) return;
          try {
            const part = await untilAborted(reader.read(), signal); signal.throwIfAborted();
            if (ended) return;
            if (part.done) { finish(); controller.close(); return; }
            bytes += part.value.byteLength;
            if (bytes > 65536) reject('proxy-response-byte-limit');
            controller.enqueue(part.value);
          } catch { if (!ended) { finish(); controller.error(new Error('proxy-model-stream-failed')); } }
        },
        cancel() { finish(); transportController.abort(); },
      }, { highWaterMark: 0 });
      return new Response(bodyStream, { status: response.status, headers: response.headers });
    } catch {
      clearTimeout(timer);
      reject('proxy-model-transport-failed');
    }
  }

  const host = await createControlledPiSession({
    trustedCwd, scope, snapshot, systemPrompt, fixedSkills, allowedModels: [model], selectedModel: model,
    providerDefinitions: [{ provider: PROVIDER, config: { api: 'openai-completions', baseUrl: `${proxyOrigin}/v1`,
      models: [{ id: modelId, name: 'Platform model proxy', reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16384, maxTokens: maxOutputTokens,
        compat: { maxTokensField: 'max_tokens', supportsDeveloperRole: false, supportsStore: false } }],
    } }],
    resolveCredential: async () => { requireLease(); return token; },
    onProviderPayload: payloadPolicy, providerFetch,
  });

  function remoteCancel() {
    return withDeadline(async signal => {
      const response = await transport(new Request(`${proxyOrigin}/v1/cancel`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, signal, redirect: 'manual',
      }));
      if (signal.aborted || response.status !== 200 || response.redirected
        || response.url && response.url !== `${proxyOrigin}/v1/cancel`) { discard(response.body); return { status: 'unconfirmed' }; }
      let text = '', bytes = 0;
      const reader = response.body?.getReader();
      if (!reader) return { status: 'unconfirmed' };
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await untilAborted(reader.read(), signal);
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 4096) reject('proxy-cancel-response-too-large');
          text += new TextDecoder().decode(part.value);
        }
        const result = JSON.parse(text);
        return result.cancelled === true && result.runId === lease.runId && result.callId === lease.callId
          ? { status: 'acknowledged' } : { status: 'unconfirmed' };
      } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
    }, cancelTimeoutMs).catch(() => ({ status: 'unconfirmed' }));
  }

  function cancel() {
    if (cancelPromise) return cancelPromise;
    if (lastOutcome === 'completed') return Promise.resolve({ local: 'settled', remote: 'not-requested', serverTerminalConfirmed: false });
    consumed = true;
    lastCancellation = { local: 'pending', remote: 'pending', serverTerminalConfirmed: false };
    cancelPromise = Promise.allSettled([host.cancel(), remoteCancel()]).then(([local, remote]) => {
      lastCancellation = { local: local.status === 'fulfilled' ? 'settled' : 'unconfirmed',
        remote: remote.status === 'fulfilled' ? remote.value.status : 'unconfirmed', serverTerminalConfirmed: false };
      return { ...lastCancellation };
    });
    return cancelPromise;
  }
  return Object.freeze({
    inspect: () => redact({ ...host.inspect(), invocation: { runId: lease.runId, callId: lease.callId }, modelTransportAttempts: dispatches,
      consumed, cancellation: lastCancellation, billingAmount: null }, active),
    subscribe(listener) {
      let pending = '';
      return host.subscribe(event => {
        const delta = event.assistantMessageEvent;
        if (event.type === 'message_update' && delta?.type === 'text_delta') {
          const next = (pending + delta.delta).replaceAll(token, REDACTED);
          const held = pendingPrefix(next, token);
          pending = held ? next.slice(-held) : '';
          const safe = redact(event, true);
          safe.assistantMessageEvent.delta = held ? next.slice(0, -held) : next;
          listener(safe);
        } else {
          if (event.type === 'message_update' && delta?.type === 'text_end' && pending) {
            const flush = redact(event);
            flush.assistantMessageEvent = { type: 'text_delta', contentIndex: delta.contentIndex, delta: pending, partial: flush.assistantMessageEvent.partial };
            pending = ''; listener(flush);
          }
          // Pi may deliver message_start after the referenced message has already
          // accumulated a delta. Protect cumulative text on every nonterminal event.
          const terminal = ['message_end', 'turn_end', 'agent_end'].includes(event.type)
            || event.type === 'message_update' && delta?.type === 'text_end';
          listener(redact(event, !terminal));
        }
      });
    },
    snapshot: () => redact(host.snapshot()),
    async prompt(text) {
      if (consumed || disposed) reject('proxy-session-invocation-consumed');
      if (typeof text !== 'string' || !text.trim()) reject('proxy-prompt-required');
      consumed = true; active = true;
      try { const result = await host.prompt(text); lastOutcome = result.outcome; return redact(result); }
      finally { active = false; transportController?.abort(); }
    },
    cancel,
    async dispose() {
      disposed = true;
      try { if (lastOutcome !== 'completed') await cancel(); }
      finally { transportController?.abort(); await host.dispose(); }
    },
  });
}
