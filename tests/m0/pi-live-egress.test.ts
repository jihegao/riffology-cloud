import assert from 'node:assert/strict';
import test from 'node:test';
import { DEPENDENCY_PIN, MODEL_PROXY_ORIGIN, projectOutbound, projectTarget, trustedOutbound, trustedTarget } from '../../spikes/m0-pi-live/egress.ts';
const capability = `m0p.synthetic-run.${'a'.repeat(64)}.${'b'.repeat(64)}`;
const chat = MODEL_PROXY_ORIGIN + '/v1/chat/completions';
const cancel = MODEL_PROXY_ORIGIN + '/v1/cancel';
const make = (url = chat, headers: Record<string, string> = {}, body = '{}') => new Request(url, { method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json', ...headers }, body });

test('trusted fixed proxy uses only the injected service fetch and rebuilds safe headers', async () => {
  let calls = 0;
  const response = await trustedOutbound(make(chat, { accept: 'unsafe-accept', 'user-agent': 'untrusted-agent' }), async request => {
    calls++; assert.equal(request.url, chat); assert.equal(request.redirect, 'manual');
    assert.equal(request.headers.get('authorization'), `Bearer ${capability}`);
    assert.equal(request.headers.get('accept'), 'text/event-stream');
    assert.equal(request.headers.get('user-agent'), null);
    assert.equal(await request.text(), '{}');
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-riffology-m0-mode': 'go-live-only', 'set-cookie': 'unsafe', authorization: 'unsafe' } });
  });
  assert.equal(calls, 1); assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('authorization'), null);
  assert.equal(response.headers.get('x-riffology-m0-mode'), 'go-live-only');
  assert.equal(await response.text(), 'data: [DONE]\n\n');
});

test('cancel permits the cloud empty-body stream but not a request payload', async () => {
  let calls = 0;
  const empty = new ReadableStream({ start(controller) { controller.close(); } });
  const request = new Request(cancel, { method: 'POST', headers: { authorization: `Bearer ${capability}` }, body: empty, duplex: 'half' } as RequestInit);
  assert.equal((await trustedOutbound(request, async outgoing => { calls++; assert.equal(outgoing.body, null); return Response.json({ cancelled: true }); })).status, 200);
  assert.equal((await trustedOutbound(make(cancel), async () => { calls++; return new Response(); })).status, 403);
  assert.equal(calls, 1); assert.equal(empty.locked, false);
});

test('both policies reject arbitrary hosts, IPs, DoH, URL overrides and management paths before fetch', async () => {
  const urls = ['http://example.com/', 'https://example.com/', 'https://1.1.1.1/dns-query', 'http://169.254.169.254/latest/meta-data/',
    'https://[::1]/', 'https://opencode.ai/zen/go/v1/chat/completions', MODEL_PROXY_ORIGIN + '/v1/recharge', MODEL_PROXY_ORIGIN + '/v1/prices',
    MODEL_PROXY_ORIGIN + '/v1/settle', MODEL_PROXY_ORIGIN + '/probe/go-live-g0-20260906/initialize', chat + '?url=https://example.com', chat + '#override',
    MODEL_PROXY_ORIGIN + ':8443/v1/chat/completions', MODEL_PROXY_ORIGIN + '/v1%2fchat/completions', DEPENDENCY_PIN.url + '?x=1',
    'https://pypi.org/simple/simpy/', DEPENDENCY_PIN.url.replace('4.1.1', '4.1.2')];
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(); };
  for (const url of urls) {
    assert.equal((await trustedOutbound(make(url), fetcher)).status, 403, url);
    assert.equal((await projectOutbound(new Request(url), fetcher)).status, 403, url);
  }
  assert.equal(calls, 0);
});

test('operator credentials and arbitrary headers cannot cross the model service boundary', async () => {
  const cases: Record<string, string>[] = [{ authorization: 'Bearer synthetic-operator-key' }, { authorization: `Bearer ${capability},extra` },
    { host: 'example.com' }, { 'x-upstream-url': 'https://example.com' }, { 'x-api-key': 'secret' }, { 'x-budget': 'unlimited' },
    { 'x-forwarded-host': 'example.com' }, { cookie: 'principal=secret' }, { 'x-arbitrary-override': 'value' }, { 'content-type': 'text/plain' }];
  for (const headers of cases) {
    assert.equal(trustedTarget(make(chat, headers)), null);
  }
  for (const key of ['base_url', 'headers', 'upstream_url', 'api_key']) {
    let calls = 0;
    const response = await trustedOutbound(make(chat, {}, JSON.stringify({ [key]: 'untrusted' })), async () => { calls++; return new Response(); });
    assert.equal(response.status, 403); assert.equal(calls, 0); assert.ok(!(await response.text()).includes('untrusted'));
  }
});

test('dependency transport selects one pinned file and strips all request/response extras', async () => {
  assert.equal(DEPENDENCY_PIN.bytes, 27224);
  assert.match(DEPENDENCY_PIN.sha256, /^[a-f0-9]{64}$/);
  const result = await projectOutbound(new Request(DEPENDENCY_PIN.url, { headers: { 'user-agent': 'caller', accept: '*/*' } }), async request => {
    assert.equal(request.url, DEPENDENCY_PIN.url); assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'manual');
    assert.deepEqual([...request.headers], [['accept', 'application/octet-stream']]);
    return new Response('synthetic-transport-body-not-wheel-evidence', { headers: { 'set-cookie': 'unsafe', 'x-private': 'unsafe' } });
  });
  assert.equal(result.status, 200); assert.equal(result.headers.get('set-cookie'), null); assert.equal(result.headers.get('x-private'), null);
  assert.equal(projectTarget(new Request(DEPENDENCY_PIN.url, { headers: { authorization: `Bearer ${capability}` } })), null);
  assert.equal(projectTarget(new Request(DEPENDENCY_PIN.url, { headers: { range: 'bytes=0-1' } })), null);
});

test('neither fetcher can return a redirect or silently follow to another destination', async () => {
  const responses = [() => new Response(null, { status: 302, headers: { location: 'https://example.com/' } }),
    () => { const r = new Response('unsafe'); Object.defineProperty(r, 'redirected', { value: true }); return r; },
    () => { const r = new Response('unsafe'); Object.defineProperty(r, 'url', { value: 'https://example.com/' }); return r; },
    () => new Response('unsafe', { headers: { location: 'https://example.com/' } })];
  for (const response of responses) {
    assert.equal((await trustedOutbound(make(), async () => response())).status, 502);
    assert.equal((await projectOutbound(new Request(DEPENDENCY_PIN.url), async () => response())).status, 502);
  }
});

test('oversize and stalled request bodies cannot dispatch; late cancel is not awaited', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(); };
  assert.equal((await trustedOutbound(make(chat, {}, ' '.repeat(8193)), fetcher)).status, 403);
  const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
  const request = new Request(chat, { method: 'POST', headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
  assert.equal((await trustedOutbound(request, fetcher)).status, 403);
  assert.equal(calls, 0); assert.equal(body.locked, false);
});
