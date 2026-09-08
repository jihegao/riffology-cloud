import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

const PROVIDER = 'opencode-go';
const MODEL = 'deepseek-v4-flash';
// Retain the logical production URL because the real SDK uses it for compat
// detection. It is NEVER a socket destination: fixtureFetch below can only open
// a socket to the numeric loopback address and this test's randomly bound port.
const BASE_URL = 'https://opencode.ai/zen/go/v1';
const LOGICAL_ENDPOINT = `${BASE_URL}/chat/completions`;
const SYNTHETIC_KEY = 'offline-wire-fixture-not-a-provider-key';
const context = {
  systemPrompt: 'Fixed offline wire fixture. No tools.',
  messages: [{ role: 'user', content: 'Reply OK.', timestamp: 1 }],
};

function customModel(compat = { maxTokensField: 'max_tokens' }) {
  return {
    provider: PROVIDER, id: MODEL, name: 'Offline Go wire fixture',
    api: 'openai-completions', baseUrl: BASE_URL, reasoning: false,
    input: ['text'], contextWindow: 16384, maxTokens: 256, compat,
    // Required SDK metadata for synthetic responses; never a billing receipt.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function fixture(t, { redirect = false } = {}) {
  let unexpectedDefaultFetch = 0;
  t.mock.method(globalThis, 'fetch', () => {
    unexpectedDefaultFetch += 1;
    throw new Error('Default fetch forbidden in offline wire test');
  });
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/wire');
      assert.equal(req.headers.authorization, `Bearer ${SYNTHETIC_KEY}`);
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        assert.ok(size <= 16 * 1024, 'fixture request byte limit');
        chunks.push(chunk);
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (redirect) {
        res.writeHead(307, { location: LOGICAL_ENDPOINT, 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'offline redirect fixture' } }));
        return;
      }
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({
        id: 'chatcmpl-offline-wire-fixture', object: 'chat.completion.chunk',
        created: 1, model: MODEL,
        choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
      })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'offline-fixture-request' });
      res.end(chunk({ role: 'assistant', content: 'OK' })
        + chunk({}, 'stop', { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 })
        + 'data: [DONE]\n\n');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'offline fixture rejected request' } }));
    }
  });
  server.requestTimeout = 2000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(unexpectedDefaultFetch, 0, 'real SDK must use the supplied loopback-only transport');
  });
  let transportAttempts = 0;
  let socketsOpened = 0;
  const rejections = [];
  const fixtureFetch = async (input, init) => {
    transportAttempts += 1;
    const request = new Request(input, init);
    if (request.url !== LOGICAL_ENDPOINT) {
      rejections.push('destination-denied');
      throw new Error('unapproved logical destination rejected before socket creation');
    }
    assert.equal(request.method, 'POST');
    request.signal.throwIfAborted();
    const body = new Uint8Array(await request.arrayBuffer());
    assert.ok(body.byteLength <= 16 * 1024, 'fixture transport byte limit, not a token estimate');
    request.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const headers = Object.fromEntries(request.headers);
      delete headers.host;
      delete headers['content-length'];
      // No source URL, DNS, proxy, global fetch, or redirect-following transport
      // is used here. This is the sole outgoing socket construction in the file.
      const outgoing = httpRequest({ hostname: '127.0.0.1', port, path: '/wire', method: 'POST', headers,
        agent: false, signal: request.signal }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 16 * 1024) outgoing.destroy(new Error('fixture response byte limit'));
          else chunks.push(chunk);
        });
        response.once('error', finishError);
        response.once('aborted', () => finishError(new Error('fixture response aborted')));
        response.once('end', () => {
          clearTimeout(timer);
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
        });
      });
      socketsOpened += 1;
      const timer = setTimeout(() => outgoing.destroy(new Error('fixture total deadline')), 2000);
      function finishError(error) { clearTimeout(timer); reject(error); }
      outgoing.once('error', finishError);
      outgoing.end(body);
    });
  };
  const run = async (model = customModel(), options = {}) => {
    const stream = streamSimple(model, context, {
      ...options, apiKey: SYNTHETIC_KEY, env: {}, maxRetries: 0,
      signal: AbortSignal.timeout(3000), fetch: fixtureFetch,
    });
    return stream.result();
  };
  return { requests, rejections, run, counts: () => ({ transportAttempts, socketsOpened }) };
}

test('real Pi custom Go wire uses explicit max_tokens 256 and omits thinking by default', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.stopReason, 'stop');
  assert.equal(result.responseId, 'chatcmpl-offline-wire-fixture');
  assert.equal(result.usage.totalTokens, 11);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0], {
    model: MODEL, messages: [{ role: 'system', content: context.systemPrompt }, { role: 'user', content: 'Reply OK.' }],
    stream: true, stream_options: { include_usage: true }, max_tokens: 256,
  });
  assert.deepEqual(f.counts(), { transportAttempts: 1, socketsOpened: 1 });
  t.diagnostic(JSON.stringify({ environment: 'local-loopback-fixture', fields: Object.keys(f.requests[0]).sort(),
    max_tokens: 256, thinkingPresent: false, supplierCalls: 0 }));
});

test('real Pi default Go compat sends max_completion_tokens, not the documented max_tokens', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const unconfigured = customModel();
  delete unconfigured.compat;
  assert.equal((await f.run(unconfigured)).stopReason, 'stop');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].max_completion_tokens, 256);
  assert.equal(Object.hasOwn(f.requests[0], 'max_tokens'), false);
  assert.equal(Object.hasOwn(f.requests[0], 'thinking'), false);
});

test('trusted onPayload can enforce the final protocol after caller sampling overrides', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  let hookCalls = 0;
  const result = await f.run(customModel(), {
    maxTokens: 999,
    samplingParams: { max_tokens: 888, max_completion_tokens: 777, thinking: { type: 'enabled' } },
    onPayload: (payload, model) => {
      hookCalls += 1;
      assert.equal(model.id, MODEL);
      assert.equal(payload.max_tokens, 888, 'hook receives payload after sampling overrides');
      const bounded = { ...payload, model: MODEL, max_tokens: 256, thinking: { type: 'disabled' } };
      delete bounded.max_completion_tokens;
      return bounded;
    },
  });
  assert.equal(result.stopReason, 'stop');
  assert.equal(hookCalls, 1);
  assert.equal(f.requests[0].max_tokens, 256);
  assert.deepEqual(f.requests[0].thinking, { type: 'disabled' });
  assert.equal(Object.hasOwn(f.requests[0], 'max_completion_tokens'), false);
});

test('trusted onPayload rejection dispatches zero requests', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const result = await f.run(customModel(), {
    onPayload: () => { throw new Error('input token upper bound not established'); },
  });
  assert.equal(result.stopReason, 'error');
  assert.match(result.errorMessage, /input token upper bound not established/);
  assert.deepEqual(f.counts(), { transportAttempts: 0, socketsOpened: 0 });
  assert.equal(f.requests.length, 0);
});

test('offline transport blocks an unapproved logical target before opening any socket', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const result = await f.run({ ...customModel(), baseUrl: 'https://forbidden.invalid/v1' });
  assert.equal(result.stopReason, 'error');
  // OpenAI 6.40.0 normalizes a fetch rejection to this generic message. The
  // transport record and zero socket count prove the actual rejection cause.
  assert.equal(result.errorMessage, 'Connection error.');
  assert.deepEqual(f.rejections, ['destination-denied']);
  assert.deepEqual(f.counts(), { transportAttempts: 1, socketsOpened: 0 });
  assert.equal(f.requests.length, 0);
});

test('offline transport never follows a fixture redirect to the native Go endpoint', { timeout: 5000 }, async (t) => {
  const f = await fixture(t, { redirect: true });
  assert.equal((await f.run()).stopReason, 'error');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.counts(), { transportAttempts: 1, socketsOpened: 1 });
});

test('installed Go registry defaults to 384000 tokens; configuration read only, no built-in wire invocation', async () => {
  const dataPath = new URL('providers/data/opencode-go.json', import.meta.resolve('@earendil-works/pi-ai'));
  const registry = JSON.parse(await readFile(dataPath, 'utf8'));
  const model = registry['openai-completions'][MODEL];
  assert.equal(model.baseUrl, BASE_URL);
  assert.equal(model.maxTokens, 384000);
  assert.equal(model.compat.maxTokensField, 'max_tokens');
});
