import { boundedCompletionBody, correlationId, digest, fixedPolicy, ProxyRejected, readJsonBody, untilAbort, upstreamHeaders, validateRequestRoute, type ModelProxyPolicy } from './policy.ts';
import { validateInvocation, type ReservationAuthority, type ReservationReceipt, type TerminalFacts, type TrustedInvocation } from './authority.ts';
import { CompletionStreamObserver } from './stream.ts';

export type InputTokenBound = { provider: string; model: string; version: string; kind: 'verified-upper-bound'; tokens: number };
export type ProxyDependencies = {
  /** An adapter must verify a trusted service binding/capability; project headers are not identity. */
  authenticate(request: Request, signal: AbortSignal): Promise<TrustedInvocation | null>;
  /** Server-side tokenizer/approved conservative bound, including message framing and mapper overhead. */
  inputTokenBound?(encodedUpstreamBody: string, signal: AbortSignal): Promise<InputTokenBound>;
  authority: ReservationAuthority;
  resolveSecret(signal: AbortSignal): Promise<string>;
  fetch(input: string, init: RequestInit): Promise<Response>;
  now?: () => number;
};
export type CompletionRecord = { persistence: 'saved' | 'unconfirmed' | 'not-reserved'; receipt: ReservationReceipt | null; errorCode: string | null };
export type ProxyExchange = { response: Response; completion: Promise<CompletionRecord> };
const json = (status: number, value: unknown, id: string) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-riffology-request-id': id } });
function failureCode(error: unknown) {
  // Do not expose provider/adapter exception messages, response bodies, credential material or URLs.
  return error instanceof ProxyRejected ? 'proxy-policy-rejected' : 'proxy-upstream-or-adapter-failed';
}

/** Framework-free primitive: no default Worker export or unauthenticated deployment adapter. */
export function createModelProxy(configuration: ModelProxyPolicy, dependencies: ProxyDependencies) {
  const policy = fixedPolicy(configuration); const now = dependencies.now ?? Date.now;
  return {
    policy,
    async handle(request: Request): Promise<ProxyExchange> {
      const platformRequestId = crypto.randomUUID(); const cancellation = new AbortController();
      let abortedAs: 'cancelled' | 'timeout' | null = null;
      let receipt: ReservationReceipt | null = null; let reservationStarted = false;
      let observer = new CompletionStreamObserver(policy, policy.maxOutputTokens);
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let sink: ReadableStreamDefaultController<Uint8Array> | null = null; let streamActive = false;
      let upstreamHttpStatus: number | null = null; let upstreamRequestId: string | null = null; let upstreamRequestIdHeader: string | null = null;
      let finishPromise: Promise<CompletionRecord> | null = null; let resolveCompletion!: (record: CompletionRecord) => void;
      const completion = new Promise<CompletionRecord>(resolve => { resolveCompletion = resolve; });
      const clean = () => { clearTimeout(timer); request.signal.removeEventListener('abort', cancelRequest); };
      const cancelReader = () => { if (reader) { const active = reader; reader = null; void active.cancel().catch(() => {}); } };
      const finish = (outcome: TerminalFacts['outcome'], errorCode: string | null): Promise<CompletionRecord> => {
        if (finishPromise) return finishPromise;
        clean(); cancelReader();
        const facts: TerminalFacts = { outcome, errorCode, upstreamHttpStatus, upstreamRequestId, upstreamRequestIdHeader, upstreamResponseId: observer.upstreamResponseId, responseBytes: observer.totalBytes, usage: observer.evidence(outcome) };
        finishPromise = (async () => {
          if (!receipt) return { persistence: reservationStarted ? 'unconfirmed' as const : 'not-reserved' as const, receipt: null, errorCode };
          try {
            // A separate bounded persistence deadline does not restart the provider request.
            const storageAbort = new AbortController(); const deadline = setTimeout(() => storageAbort.abort(), Math.min(policy.timeoutMs, 5000));
            try { const saved = await untilAbort(dependencies.authority.finish(receipt.invocation.callId, receipt.platformRequestId, facts), storageAbort.signal); return { persistence: 'saved' as const, receipt: saved, errorCode }; }
            finally { clearTimeout(deadline); }
          } catch { return { persistence: 'unconfirmed' as const, receipt, errorCode: 'terminal-persistence-unconfirmed' }; }
        })();
        void finishPromise.then(resolveCompletion);
        return finishPromise;
      };
      const abort = (as: 'cancelled' | 'timeout') => {
        if (finishPromise || abortedAs) return;
        abortedAs = as; cancellation.abort(); cancelReader();
        if (streamActive) { try { sink?.error(new Error(`proxy-${as}`)); } catch { /* consumer already closed */ } void finish(as, `proxy-${as}`); }
      };
      const cancelRequest = () => abort('cancelled');
      const timer = setTimeout(() => abort('timeout'), policy.timeoutMs);
      request.signal.addEventListener('abort', cancelRequest, { once: true });
      if (request.signal.aborted) abort('cancelled');
      const checkAbort = () => { if (cancellation.signal.aborted) throw new ProxyRejected('request-aborted', abortedAs === 'timeout' ? 504 : 499); };
      try {
        checkAbort(); validateRequestRoute(request, policy);
        const authenticated = await untilAbort(dependencies.authenticate(request, cancellation.signal), cancellation.signal);
        const invocation = authenticated ? structuredClone(authenticated) : null;
        validateInvocation(invocation, policy.callerPrincipal, now());
        const body = await readJsonBody(request, policy.maxBodyBytes, cancellation.signal);
        const normalized = boundedCompletionBody(body.value, policy);
        if (!dependencies.inputTokenBound) throw new ProxyRejected('verified-input-token-bound-required', 503);
        const bound = await untilAbort(dependencies.inputTokenBound(normalized.encoded, cancellation.signal), cancellation.signal);
        if (bound.kind !== 'verified-upper-bound' || bound.provider !== policy.provider || bound.model !== policy.model || !/^[a-zA-Z0-9._/-]{1,100}$/.test(bound.version) || !Number.isSafeInteger(bound.tokens) || bound.tokens < 1 || bound.tokens > policy.maxInputTokens) throw new ProxyRejected('verified-input-token-bound-required', 413);
        observer = new CompletionStreamObserver(policy, normalized.maxOutputTokens, bound.tokens);
        const headers = upstreamHeaders(await untilAbort(dependencies.resolveSecret(cancellation.signal), cancellation.signal));
        const payloadHash = await untilAbort(digest(normalized.encoded), cancellation.signal);
        checkAbort(); reservationStarted = true;
        const reservation = await untilAbort(dependencies.authority.reserve({ invocation, platformRequestId, payloadHash, provider: policy.provider, model: policy.model, inputTokenUpperBound: bound.tokens, maxOutputTokens: normalized.maxOutputTokens, inputBoundVersion: bound.version }), cancellation.signal);
        receipt = reservation.receipt;
        if (!reservation.created) {
          clean(); const record: CompletionRecord = { persistence: 'saved', receipt, errorCode: 'call-already-recorded' }; resolveCompletion(record);
          return { response: json(409, { error: 'call-already-recorded', receipt }, platformRequestId), completion };
        }
        checkAbort(); receipt = await untilAbort(dependencies.authority.markDispatched(invocation.callId, platformRequestId), cancellation.signal);
        // Once the durable dispatch intent exists, all failures are uncertain and cannot be replayed.
        checkAbort(); validateInvocation(invocation, policy.callerPrincipal, now());
        const target = policy.upstreamOrigin + policy.upstreamPath;
        const pending = dependencies.fetch(target, { method: 'POST', headers, body: normalized.encoded, redirect: 'manual', signal: cancellation.signal });
        // Dispose a late ignored response if an injected transport does not honor abort.
        void pending.then(response => { if (cancellation.signal.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const upstream = await untilAbort(pending, cancellation.signal); checkAbort();
        upstreamHttpStatus = upstream.status;
        for (const name of ['x-request-id', 'request-id', 'x-amzn-requestid']) {
          const id = correlationId(upstream.headers.get(name)); if (id) { upstreamRequestId = id; upstreamRequestIdHeader = name; break; }
        }
        if (upstream.status !== 200 || upstream.url && upstream.url !== target || !/^text\/event-stream(?:\s*;[^\r\n]*)?$/i.test(upstream.headers.get('content-type') ?? '') || !upstream.body) {
          void upstream.body?.cancel().catch(() => {}); throw new ProxyRejected('upstream-http-or-protocol-rejected', 502);
        }
        reader = upstream.body.getReader(); let pulls = 0; let deliveredBytes = 0;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { sink = controller; },
          async pull(controller) {
            if (finishPromise) return;
            try {
              checkAbort(); if (!reader) throw new ProxyRejected('upstream-stream-unavailable', 502);
              const next = await untilAbort(reader.read(), cancellation.signal); checkAbort();
              if (++pulls > policy.maxResponseBytes + 1) throw new ProxyRejected('upstream-chunk-limit', 502);
              if (next.done) {
                observer.end(); await finish('completed', null); controller.close(); return;
              }
              observer.push(next.value);
              // Original SSE bytes are forwarded unchanged; the observer retains at most one frame.
              deliveredBytes += next.value.byteLength;
              if (deliveredBytes > policy.maxResponseBytes) throw new ProxyRejected('upstream-response-too-large', 502);
              if (next.value.byteLength) controller.enqueue(next.value);
              if (observer.done) { observer.end(); await finish('completed', null); controller.close(); }
            } catch (error) {
              const code = abortedAs ? `proxy-${abortedAs}` : failureCode(error);
              cancellation.abort(); await finish(abortedAs ?? 'failed', code);
              try { controller.error(new Error(code)); } catch { /* already cancelled */ }
            }
          },
          async cancel() { abort('cancelled'); await finish('cancelled', 'proxy-cancelled'); },
        }, { highWaterMark: 0 });
        const responseHeaders = new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-riffology-request-id': platformRequestId });
        if (upstreamRequestId) responseHeaders.set('x-riffology-upstream-request-id', upstreamRequestId);
        streamActive = true; checkAbort();
        return { response: new Response(stream, { headers: responseHeaders }), completion };
      } catch (error) {
        cancellation.abort(); const errorCode = abortedAs ? `proxy-${abortedAs}` : failureCode(error);
        await finish(abortedAs ?? 'failed', errorCode);
        return { response: json(abortedAs === 'timeout' ? 504 : abortedAs === 'cancelled' ? 499 : error instanceof ProxyRejected ? error.status : 502, { error: errorCode }, platformRequestId), completion };
      }
    },
  };
}
