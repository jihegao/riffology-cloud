import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedPreviewHttp } from '../../services/preview/authorized-http.ts';

const previewOrigin = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';
const controlOrigin = 'https://app.example.test';
const now = 1000;
const okLease = { expiresAt: 100000 };

function request(path: string, init: RequestInit = {}) {
  return new Request(previewOrigin + path, init);
}
function ports(options: {
  authorizes?: Array<{ expiresAt: number }>;
  forward?: (request: Request) => Promise<Response>;
} = {}) {
  const authorizes = [...(options.authorizes ?? [okLease, okLease, okLease, okLease])];
  let authorizeCalls = 0, forwardCalls = 0, forwarded: Request | undefined;
  return {
    get authorizeCalls() { return authorizeCalls; }, get forwardCalls() { return forwardCalls; }, get forwarded() { return forwarded; },
    authorize: async () => { authorizeCalls++; return authorizes.shift() ?? okLease; },
    forward: async (value: Request) => { forwardCalls++; forwarded = value; return options.forward?.(value) ?? new Response('ok'); },
  };
}

test('unsafe origin and upgrade are rejected before authorize or forward', async () => {
  for (const value of [
    request('/ok', { headers: { origin: controlOrigin } }),
    request('/ok', { headers: { origin: previewOrigin, 'sec-fetch-site': 'cross-site' } }),
    request('/ok', { method: 'POST', headers: { origin: 'null' }, body: 'opaque without browser same-origin signal' }),
    request('/ok', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: 'missing origin' }),
    request('/ok', { headers: { origin: previewOrigin, upgrade: 'websocket' } }),
    { url: previewOrigin + '/ok', method: 'TRACE', headers: new Headers({ origin: previewOrigin }) } as unknown as Request,
  ]) {
    const f = ports();
    await assert.rejects(authorizedPreviewHttp(value, controlOrigin, f, () => now), /preview-http-/);
    assert.equal(f.authorizeCalls, 0);
    assert.equal(f.forwardCalls, 0);
  }
});

test('sandboxed same-origin form POST forwards only with opaque origin and same-origin fetch metadata', async () => {
  const f = ports();
  const response = await authorizedPreviewHttp(request('/run', {
    method: 'POST',
    headers: { origin: 'null', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'servers=2',
  }), controlOrigin, f, () => now);
  assert.equal(response.status, 200);
  assert.equal(f.forwardCalls, 1);
  assert.equal(f.forwarded?.url, 'http://localhost:8080/run');
  assert.equal(await f.forwarded!.text(), 'servers=2');
  assert.equal(f.forwarded!.headers.get('origin'), null);
  assert.equal(f.forwarded!.headers.get('sec-fetch-site'), null);
});

test('authorization failure does not forward', async () => {
  const f = ports({ authorizes: [{ expiresAt: now }] });
  await assert.rejects(authorizedPreviewHttp(request('/ok', { headers: { origin: previewOrigin } }), controlOrigin, f, () => now), /preview-http-access-denied/);
  assert.equal(f.authorizeCalls, 1);
  assert.equal(f.forwardCalls, 0);
});

test('normal request forwards a fixed, cleaned request and authorizes around body consumption', async () => {
  const chunks = [new TextEncoder().encode('first'), new TextEncoder().encode('second')];
  let pulls = 0, authAtPull: number[] = [];
  const f = ports();
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    authAtPull.push(f.authorizeCalls);
    const chunk = chunks[pulls++];
    if (chunk) controller.enqueue(chunk); else controller.close();
  } }, { highWaterMark: 0 });
  const response = await authorizedPreviewHttp(request('/nested?q=1', {
    method: 'POST', body, duplex: 'half', headers: {
      origin: previewOrigin, accept: 'text/plain', 'content-type': 'text/plain',
      cookie: 'secret=1', authorization: 'Bearer secret', 'x-riffology-sandbox-id': 'forged',
    },
  } as RequestInit), controlOrigin, f, () => now);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.equal(f.forwardCalls, 1);
  assert.equal(f.forwarded?.url, 'http://localhost:8080/nested?q=1');
  assert.equal(await f.forwarded!.text(), 'firstsecond');
  assert.equal(f.forwarded!.headers.get('accept'), 'text/plain');
  assert.equal(f.forwarded!.headers.get('content-type'), 'text/plain');
  for (const header of ['cookie', 'authorization', 'x-riffology-sandbox-id', 'origin']) assert.equal(f.forwarded!.headers.get(header), null);
  assert.ok(authAtPull.every((value, index) => index === 0 ? value >= 1 : value > authAtPull[index - 1]!), `expected fresh auth for each body chunk: calls=${f.authorizeCalls}, authAtPull=${authAtPull}`);
});

test('revocation after a waiting upload read drops the arriving data and cancels the source', async () => {
  let cancelled = 0, sent = false, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) { if (sent) await new Promise<void>(() => {}); else { await waiting; sent = true; controller.enqueue(new TextEncoder().encode('late upload')); } },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const f = ports({ authorizes: [okLease, okLease, { expiresAt: now }], forward: async () => new Response('must-not-forward') });
  const pending = authorizedPreviewHttp(request('/upload', { method: 'POST', body: source, duplex: 'half', headers: { origin: previewOrigin, 'content-type': 'text/plain' } } as RequestInit), controlOrigin, f, () => now);
  await new Promise(resolve => setTimeout(resolve, 5));
  release();
  await assert.rejects(pending, /preview-http-access-denied/);
  assert.equal(f.forwardCalls, 0);
  assert.equal(cancelled, 1);
});

test('request cancellation while an upload read waits cancels the source and does not forward', async () => {
  const abort = new AbortController();
  let cancelled = 0, sent = false, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) { if (sent) await new Promise<void>(() => {}); else { await waiting; sent = true; controller.enqueue(new TextEncoder().encode('cancelled upload')); } },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const f = ports({ forward: async () => new Response('must-not-forward') });
  const pending = authorizedPreviewHttp(request('/upload', { method: 'POST', body: source, signal: abort.signal, duplex: 'half', headers: { origin: previewOrigin, 'content-type': 'text/plain' } } as RequestInit), controlOrigin, f, () => now);
  await new Promise(resolve => setTimeout(resolve, 5));
  abort.abort();
  await assert.rejects(pending, /preview-http-aborted/);
  release();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.forwardCalls, 0);
  assert.equal(cancelled, 1);
});

test('revocation after forwarding rejects the response and cancels its body', async () => {
  let cancelled = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode('secret')); },
    cancel() { cancelled++; },
  });
  const f = ports({ authorizes: [okLease, okLease, okLease, { expiresAt: now }] , forward: async () => new Response(source) });
  const response = await authorizedPreviewHttp(request('/ok', { headers: { origin: previewOrigin } }), controlOrigin, f, () => now);
  await assert.rejects(response.arrayBuffer(), /preview-http-access-denied/);
  assert.equal(cancelled, 1);
});

test('revocation while upstream reader waits drops the arriving chunk and cancels', async () => {
  let cancelled = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) { await waiting; controller.enqueue(new TextEncoder().encode('late')); },
    cancel() { cancelled++; },
  });
  const f = ports({ authorizes: [okLease, okLease, okLease, okLease, { expiresAt: now }], forward: async () => new Response(source) });
  const response = await authorizedPreviewHttp(request('/ok', { headers: { origin: previewOrigin } }), controlOrigin, f, () => now);
  const reading = response.arrayBuffer();
  await new Promise(resolve => setTimeout(resolve, 5));
  release();
  await assert.rejects(reading, /preview-http-access-denied/);
  assert.equal(cancelled, 1);
});

test('request cancellation aborts a pending forward without retrying', async () => {
  const controller = new AbortController();
  let resolveForward!: (response: Response) => void, cancelled = 0;
  const source = new ReadableStream({ cancel() { cancelled++; } });
  const f = ports({ forward: async () => new Promise<Response>(resolve => { resolveForward = resolve; }) });
  const pending = authorizedPreviewHttp(request('/ok', { signal: controller.signal, headers: { origin: previewOrigin } }), controlOrigin, f, () => now);
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(pending, /preview-http-aborted/);
  resolveForward(new Response(source));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.forwardCalls, 1);
  assert.equal(cancelled, 1);
});
