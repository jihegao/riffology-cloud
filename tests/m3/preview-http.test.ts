import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVICE_HTTP_ORIGIN, serviceHttpRequest, serviceHttpResponse } from '../../services/preview/http.ts';

const publicOrigin = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';
const controlOrigin = 'https://app.example.test';

test('serviceHttpRequest fixes the sandbox origin, preserves request data, and forwards only the allowlist', async () => {
  const body = new TextEncoder().encode('真实请求体\n🙂');
  const request = new Request(publicOrigin + '/nested/page?x=1&y=two', {
    method: 'POST', body,
    headers: {
      accept: 'text/html', 'accept-language': 'zh-CN', 'content-type': 'text/plain',
      'if-match': 'etag-a', 'if-none-match': 'etag-b', 'if-modified-since': 'yesterday',
      'if-unmodified-since': 'today', range: 'bytes=0-9', 'if-range': 'etag-c', 'last-event-id': 'event-1',
      cookie: 'secret=1', authorization: 'Bearer secret', origin: publicOrigin,
      'x-forwarded-for': '127.0.0.1', 'x-riffology-sandbox-id': 'forged',
    },
  });
  const forwarded = await serviceHttpRequest(request);
  assert.equal(forwarded.url, SERVICE_HTTP_ORIGIN + '/nested/page?x=1&y=two');
  assert.equal(forwarded.method, 'POST');
  assert.deepEqual(new Uint8Array(await forwarded.arrayBuffer()), body);
  assert.deepEqual(Object.fromEntries(forwarded.headers), {
    accept: 'text/html', 'accept-language': 'zh-CN', 'content-type': 'text/plain',
    'if-match': 'etag-a', 'if-none-match': 'etag-b', 'if-modified-since': 'yesterday',
    'if-unmodified-since': 'today', range: 'bytes=0-9', 'if-range': 'etag-c', 'last-event-id': 'event-1',
  });
});

test('serviceHttpRequest rejects unsafe methods, reserved paths, multi-encoded traversal, and body limits', async () => {
  for (const method of ['TRACE', 'CONNECT']) {
    await assert.rejects(serviceHttpRequest({ url: publicOrigin + '/ok', method, headers: new Headers() } as unknown as Request), /preview-http-method-denied/);
  }
  await assert.rejects(serviceHttpRequest(new Request(publicOrigin + '/ok', { headers: { upgrade: 'websocket' } })), /preview-http-method-denied/);
  for (const path of ['/__riff', '/__riff/exchange', '/a/%252e%252e/b', '/a/%25252e%25252e/b', '/a/%2525252e%2525252e/b']) {
    await assert.rejects(serviceHttpRequest({ url: publicOrigin + path, method: 'GET', headers: new Headers() } as unknown as Request), /preview-path-denied/);
  }
  const declaredTooLarge = new Request(publicOrigin + '/upload', { method: 'POST', body: 'small', headers: { 'content-length': '1048577' } });
  await assert.rejects(serviceHttpRequest(declaredTooLarge), /preview-body-too-large/);
  const actualTooLarge = new Uint8Array(1048577);
  await assert.rejects(serviceHttpRequest(new Request(publicOrigin + '/upload', { method: 'POST', body: actualTooLarge })), /preview-body-too-large/);
});

test('serviceHttpResponse applies public sandbox policy and rewrites only internal redirects', async () => {
  const response = new Response('html', { status: 201, statusText: 'Created', headers: {
    'content-type': 'text/html', 'content-language': 'en', 'content-disposition': 'inline', etag: 'e',
    'set-cookie': 'session=secret', 'access-control-allow-origin': '*', 'content-security-policy': 'unsafe',
    'cache-control': 'public, max-age=3600', location: '/next?q=1#frag',
  } });
  const rewritten = serviceHttpResponse(response, publicOrigin + '/dir/index.html?old=1', controlOrigin);
  assert.equal(rewritten.status, 201);
  assert.equal(rewritten.statusText, 'Created');
  assert.equal(await rewritten.text(), 'html');
  assert.equal(rewritten.headers.get('location'), publicOrigin + '/next?q=1#frag');
  assert.equal(rewritten.headers.get('set-cookie'), null);
  assert.equal(rewritten.headers.get('access-control-allow-origin'), null);
  assert.equal(rewritten.headers.get('content-security-policy')?.includes(`frame-ancestors ${controlOrigin}`), true);
  assert.match(rewritten.headers.get('content-security-policy')!, /sandbox allow-scripts allow-same-origin allow-forms/);
  assert.equal(rewritten.headers.get('cache-control'), 'no-store');
  assert.equal(rewritten.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(rewritten.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(rewritten.headers.get('origin-agent-cluster'), '?1');
});

test('serviceHttpResponse rejects control or external redirects and same-origin framing', () => {
  for (const location of [controlOrigin + '/logout', 'https://other.example.test/out', 'https://user:pass@other.example.test/secret']) {
    assert.throws(() => serviceHttpResponse(new Response(null, { headers: { location } }), publicOrigin + '/index', controlOrigin), /preview-redirect-denied/);
  }
  assert.throws(() => serviceHttpResponse(new Response(), publicOrigin + '/index', publicOrigin), /preview-origin-denied/);
});
