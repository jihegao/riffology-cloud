import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

// Only fixed fixture destinations. No provider URL/model or operator credential is accepted.
const logicalOrigin = 'https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev';
const localOrigin = 'http://127.0.0.1:8794';
const hash = value => createHash('sha256').update(value).digest('hex');
async function main() {
  if (process.argv.length !== 3 || !['--local-fixture', '--staging-fixture'].includes(process.argv[2])) throw new Error('fixture-mode-required');
  const targetOrigin = process.argv[2] === '--local-fixture' ? localOrigin : logicalOrigin;
  const chunks = []; let inputBytes = 0;
  const inputTimer = setTimeout(() => process.stdin.destroy(new Error('input-timeout')), 3000);
  try {
    for await (const chunk of process.stdin) {
      inputBytes += chunk.length;
      if (inputBytes > 65536) throw new Error('input-limit');
      chunks.push(chunk);
    }
  } finally { clearTimeout(inputTimer); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || Object.keys(input).some(key => !['scope', 'invocation', 'snapshot', 'prompt', 'cancelOnDelta', 'trustedCwd'].includes(key))
    || typeof input.prompt !== 'string' || typeof input.cancelOnDelta !== 'boolean'
    || typeof input.trustedCwd !== 'string' || !isAbsolute(input.trustedCwd)) throw new Error('invalid-input');
  const { createProxyPiSession } = await import('../../services/runtime/proxy-pi.mjs');
  const nativeFetch = globalThis.fetch;
  let defaultFetchCalls = 0;
  globalThis.fetch = () => { defaultFetchCalls++; throw new Error('default-fetch-denied'); };
  const requests = [], events = [];
  let host, cancelPromise, output;
  try {
    host = await createProxyPiSession({
      trustedCwd: input.trustedCwd, scope: input.scope, invocation: input.invocation, snapshot: input.snapshot,
      systemPrompt: 'Platform fixture diagnostic. Reply in plain text.',
      fixedSkills: [{ name: 'simulation', content: 'Fixed simulation diagnostic skill.' }],
      proxyOrigin: logicalOrigin, modelId: 'm0-text-fixture', callTimeoutMs: 10000,
      transport: async request => {
        const url = new URL(request.url);
        if (url.origin !== logicalOrigin || !['/v1/chat/completions', '/v1/cancel'].includes(url.pathname)
          || url.search || request.method !== 'POST' || request.redirect !== 'manual') throw new Error('transport-denied');
        const body = await request.clone().text();
        const record = { path: url.pathname, callId: input.invocation.callId, bodySha256: hash(body),
          body: body ? JSON.parse(body) : null, status: null, platformRequestId: null };
        requests.push(record);
        const response = await nativeFetch(new Request(targetOrigin + url.pathname, request));
        record.status = response.status;
        record.platformRequestId = response.headers.get('x-riffology-request-id');
        if (response.url !== targetOrigin + url.pathname || response.redirected
          || response.headers.get('x-riffology-m0-mode') !== 'fixture-only') {
          void response.body?.cancel().catch(() => {}); throw new Error('fixture-response-required');
        }
        // Local fixture mode alone maps HTTPS to loopback. Staging preserves HTTPS.
        return new Response(response.body, { status: response.status, headers: response.headers });
      },
    });
    host.subscribe(event => {
      if (events.length >= 128) throw new Error('event-limit');
      events.push({ type: event.type, deltaType: event.assistantMessageEvent?.type ?? null,
        responseId: event.type === 'message_end' ? event.message?.responseId ?? null : null });
      if (input.cancelOnDelta && !cancelPromise && event.assistantMessageEvent?.type === 'text_delta') cancelPromise = host.cancel();
    });
    const result = await host.prompt(input.prompt);
    const cancellation = cancelPromise ? await cancelPromise : null;
    let duplicatePromptRejected = false;
    try { await host.prompt('Duplicate diagnostic must not dispatch.'); } catch { duplicatePromptRejected = true; }
    output = { pid: process.pid, outcome: result.outcome, cancellation, duplicatePromptRejected,
      snapshot: host.snapshot(), requests, events, modelTransportAttempts: host.inspect().modelTransportAttempts,
      defaultFetchCalls, billingAmount: null };
  } finally {
    await host?.dispose();
  }
  const encoded = JSON.stringify(output);
  if (encoded.length > 131072 || encoded.includes(input.invocation.token)) throw new Error('unsafe-output');
  process.stdout.write(encoded + '\n');
}
try { await main(); }
catch { process.stderr.write('proxy-pi-child failed; no credentials or raw errors emitted\n'); process.exitCode = 1; }
