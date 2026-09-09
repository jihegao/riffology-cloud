import assert from 'node:assert/strict';
import test from 'node:test';
import {observerHttpPolicy, observerHttpRequest, observerHttpResponse} from '../../services/preview/observer-http.ts';
import {SERVICE_HTTP_ORIGIN, serviceHttpRequest} from '../../services/preview/http.ts';

const origin = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';
const pagePath = '/index.html';
const statePath = '/__state.json';
const policy = {origin, pagePath, statePath};

function structural(url: string, method = 'GET', headers: HeadersInit = {}, body: BodyInit | null = null) {
  return {url, method, headers: new Headers(headers), body} as Pick<Request, 'url' | 'method' | 'headers' | 'body'>;
}

test('policy accepts only an exact public preview host and two distinct simple paths', () => {
  const result = observerHttpPolicy(policy);
  assert.deepEqual(result, policy);
  assert.equal(Object.isFrozen(result), true);

  for (const candidate of [
    {...policy, origin: 'https://127.0.0.1.preview.example.test'},
    {...policy, origin: 'https://control.example.test'},
    {...policy, origin: 'https://p-' + 'a'.repeat(39) + '.preview.example.test'},
    {...policy, pagePath: statePath},
    {...policy, pagePath: '/a/../b'},
    {...policy, statePath: '/a%2Fb'},
    {...policy, statePath: '/a?x=1'},
    {...policy, statePath: '/a#x'},
  ]) assert.throws(() => observerHttpPolicy(candidate), /observer-http-denied|invalid-preview-origin/);
});

test('extra keys and accessors are rejected without executing getters', () => {
  let getterCalls = 0;
  const extra = {...policy, extra: true};
  assert.throws(() => observerHttpPolicy(extra), /observer-http-denied/);
  const accessor = Object.defineProperties({}, {
    origin: {enumerable: true, get() { getterCalls++; return origin; }},
    pagePath: {enumerable: true, value: pagePath},
    statePath: {enumerable: true, value: statePath},
  }) as unknown as typeof policy;
  assert.throws(() => observerHttpPolicy(accessor), /observer-http-denied/);
  assert.equal(getterCalls, 0);
});

test('only fixed localhost GET and HEAD requests for page or state are forwarded', () => {
  for (const method of ['GET', 'HEAD']) {
    for (const selected of [pagePath, statePath]) {
      const result = observerHttpRequest(structural(origin + selected, method), policy);
      assert.equal(result.url, SERVICE_HTTP_ORIGIN + selected);
      assert.equal(result.method, method);
      assert.equal(result.headers.get('accept'), selected === statePath ? 'application/json' : 'text/html');
      assert.equal(result.headers.get('x-riff-observer'), 'read-only');
      assert.equal(result.body, null);
    }
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']) {
    assert.throws(() => observerHttpRequest(structural(origin + pagePath, method), policy), /observer-http-denied/);
  }
  assert.throws(() => observerHttpRequest(structural(origin + pagePath, 'GET', {upgrade: 'websocket'}), policy), /observer-http-denied/);
  assert.throws(() => observerHttpRequest(structural(origin + pagePath, 'GET', {}, 'body'), policy), /observer-http-denied/);
});

test('caller headers cannot forge identity or pass credentials, cookies, ranges, or arbitrary metadata', () => {
  const result = observerHttpRequest(structural(origin + pagePath, 'GET', {
    'x-riff-observer': 'forged', cookie: 'secret=1', authorization: 'Bearer secret', range: 'bytes=0-1',
    origin: origin, 'if-none-match': 'etag', 'x-arbitrary': 'value', accept: 'application/json',
  }), policy);
  assert.equal(result.headers.get('x-riff-observer'), 'read-only');
  for (const key of ['cookie', 'authorization', 'range', 'origin', 'if-none-match', 'x-arbitrary']) assert.equal(result.headers.get(key), null);
  assert.equal(result.headers.get('accept'), 'text/html');
});

test('other origins, control hosts, undeclared paths, and pre-normalization URL tricks are denied', () => {
  const denied = [
    'https://evil.example.test' + pagePath,
    'http://127.0.0.1:8080' + pagePath,
    'http://control.example.test:8080' + pagePath,
    origin + '/other.html',
    origin + '/index.html/../__state.json',
    origin + '/index%2ehtml',
    origin + '/index.html%2f..%2f__state.json',
    origin + '/index.html?x=1',
    origin + '/index.html#state',
    'https://user@' + origin.slice('https://'.length) + pagePath,
    'https://localhost:8080@evil.example.test' + pagePath,
    origin + '\\' + pagePath,
  ];
  for (const url of denied) assert.throws(() => observerHttpRequest(structural(url), policy), /observer-http-denied/);
});

test('response replaces headers and rewrites only exact page/state redirects', async () => {
  const upstream = new Response('ok', {status: 302, headers: {
    'content-type': 'text/html', 'set-cookie': 'secret=1', 'set-cookie2': 'secret=2', refresh: '0;url=/other',
    'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true', 'x-arbitrary': 'drop',
    location: SERVICE_HTTP_ORIGIN + statePath,
  }});
  const result = observerHttpResponse(upstream, policy);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('location'), origin + statePath);
  assert.equal(result.headers.get('content-type'), 'text/html');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('content-security-policy')?.includes("default-src 'none'"), true);
  for (const key of ['set-cookie', 'set-cookie2', 'refresh', 'access-control-allow-origin', 'access-control-allow-credentials', 'x-arbitrary']) assert.equal(result.headers.get(key), null);
  for (const selected of [pagePath, statePath]) {
    const redirected = observerHttpResponse(new Response(null, {status: 302, headers: {location: origin + selected}}), policy);
    assert.equal(redirected.headers.get('location'), origin + selected);
  }
  await assert.rejects(async () => observerHttpResponse(new Response(null, {status: 302, headers: {location: origin + '/other'}}), policy), /observer-http-denied/);
  await assert.rejects(async () => observerHttpResponse(new Response(null, {status: 302, headers: {location: 'https://evil.example.test' + pagePath}}), policy), /observer-http-denied/);
});

test('general serviceHttpRequest also discards caller forged observer identity', async () => {
  const result = await serviceHttpRequest(new Request(SERVICE_HTTP_ORIGIN + pagePath, {
    method: 'GET', headers: {'x-riff-observer': 'forged', cookie: 'secret=1', 'x-arbitrary': 'value'},
  }));
  assert.equal(result.headers.get('x-riff-observer'), null);
  assert.equal(result.headers.get('cookie'), null);
  assert.equal(result.headers.get('x-arbitrary'), null);
});
