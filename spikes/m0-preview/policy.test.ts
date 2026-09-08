import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, emptyBrowserState, ACCESS_COOKIE, CHALLENGE_COOKIE, SESSION_COOKIE, ACCESS_SECONDS, TICKET_SECONDS, type BrowserState } from './browser.ts';
import { handlePreviewRequest, previewPrefix, previewOrigin, sameScope, upstreamRequest, filterUpstreamResponse, type Scope, type Grant, type PreviewOperations } from './policy.ts';
import { projectService } from './runtime.ts';

const config = {
  ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1',
  M0_PROBE_TOKEN: 'synthetic-management-only-'.repeat(2),
  M0_PREVIEW_SIGNING_KEY: 'synthetic-cookie-signing-only-'.repeat(2),
  M0_CONTROL_ORIGIN: 'https://control.m0.test:8791', M0_PREVIEW_ORIGIN: 'https://preview.m0.test:8791',
};
const scope: Scope = { run_id: 'preview-test-0001', tenant: 'alpha', preview_id: 'fixture-alpha-preview', generation: '1'.repeat(32) };
const control = config.M0_CONTROL_ORIGIN;
const origin = previewOrigin(config.M0_PREVIEW_ORIGIN, scope);
const prefix = previewPrefix(scope);
const request = (url: string, cookie?: string, method = 'GET', headers: Record<string, string> = {}) => new Request(url, { method, headers: { ...(cookie ? { cookie } : {}), ...headers } });
const firstCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
function harness() {
  let now = 1800000000000;
  let state = emptyBrowserState();
  let current: Grant | null = { ...scope, expires_at: now / 1000 + 120 };
  let calls = 0, ended = 0, transactions = 0;
  const store = { read: () => structuredClone(state), write: (value: BrowserState) => { state = value; }, transaction: <T>(fn: () => T): T => { transactions++; return fn(); } };
  const operations: PreviewOperations = {
    start: async () => current!, revoke: async () => { current = null; return { access: 'revoked' }; },
    status: async () => ({ state: current && { ...current, status: 'active' } }),
    diagnostics: async () => ({ sdk_exposed_port_count: 0, sdk_exposed_ports: [], urls_redacted: true }),
    authorize: async supplied => !!current && sameScope(current, supplied) && current.expires_at > now / 1000,
    proxy: async () => { calls++; return Response.json({ synthetic: true }); },
    browser: async action => browserAction(store, action, now),
    endSession: async () => { ended++; },
  };
  const handle = (r: Request, overrides = {}) => handlePreviewRequest(r, { ...config, ...overrides }, operations, now);
  const manage = (action: string, tenant = 'alpha') => handle(request(`${control}/m0/preview/${scope.run_id}/${tenant}/${action}`, undefined, action === 'status' ? 'GET' : 'POST', { authorization: `Bearer ${config.M0_PROBE_TOKEN}` }));
  const login = async (tenant = 'alpha') => {
    const enrollment = await (await manage('enroll', tenant)).json() as { url: string };
    const response = await handle(request(enrollment.url));
    assert.equal(response.status, 303);
    assert.equal((await handle(request(enrollment.url))).status, 403, 'enrollment is one-use');
    return firstCookie(response);
  };
  const ticket = async (sid: string) => {
    const response = await handle(request(`${control}/m0/browser/${scope.run_id}/alpha/ticket`, sid, 'POST', { origin: control }));
    assert.equal(response.status, 200);
    return (await response.json() as { url: string }).url;
  };
  const begin = async (url: string) => {
    const response = await handle(request(url));
    assert.equal(response.status, 303);
    return { challenge: firstCookie(response), authorize: response.headers.get('location')! };
  };
  const flow = async (sid?: string) => {
    sid ??= await login();
    const url = await ticket(sid);
    const started = await begin(url);
    const authorized = await handle(request(started.authorize, sid));
    assert.equal(authorized.status, 303);
    const code = authorized.headers.get('location')!;
    const redeemed = await handle(request(code, started.challenge));
    assert.equal(redeemed.status, 303);
    return { sid, ticket: url, ...started, code, cookie: firstCookie(redeemed), page: redeemed.headers.get('location')!, response: redeemed };
  };
  return { handle, manage, login, ticket, begin, flow, operations, calls: () => calls, ended: () => ended, transactions: () => transactions, advance: (ms: number) => { now += ms; }, generation: () => { current = { ...current!, generation: '2'.repeat(32) }; } };
}

test('fixed diagnostic source uses platform origins and rejects source or URL injection', () => {
  const source = projectService(scope.generation, 'https://control.fixture-domain.com', 'https://preview.fixture-domain.com');
  assert.ok(source.includes('CONTROL_ORIGIN = "https://control.fixture-domain.com"'));
  assert.ok(source.includes('COOKIE_DOMAIN = "preview.fixture-domain.com"'));
  assert.ok(source.includes("'/redirect-control': CONTROL_ORIGIN + '/billing/credit'"));
  assert.ok(source.includes(`'fixture_instance_marker': '${scope.generation}'`));
  assert.equal(source.includes('m0.test'), false);
  for (const bad of ['http://control.fixture-domain.com', 'https://control.fixture-domain.com/path', 'https://user:secret@control.fixture-domain.com', 'https://control.fixture-domain.com\n', "https://evil.invalid/';import os"]) {
    assert.throws(() => projectService(scope.generation, bad, 'https://preview.fixture-domain.com'));
  }
  assert.throws(() => projectService('__proto__', control, config.M0_PREVIEW_ORIGIN));
});

test('read-only exposure diagnostic requires management bearer on exact control origin', async () => {
  const f = harness();
  let calls = 0;
  f.operations.diagnostics = async () => { calls++; return { sdk_exposed_port_count: 0, sdk_exposed_ports: [], urls_redacted: true }; };
  const path = `/m0/preview/${scope.run_id}/alpha/diagnostics`;
  const bearer = { authorization: `Bearer ${config.M0_PROBE_TOKEN}` };
  for (const input of [request(control + path), request(origin + path, undefined, 'GET', bearer), request(control + path, undefined, 'POST', bearer), request(control + path + '?hostname=evil.invalid', undefined, 'GET', bearer), request(control + path, undefined, 'GET', { ...bearer, origin })]) {
    assert.ok([400, 401, 403].includes((await f.handle(input)).status));
  }
  assert.equal(calls, 0);
  const response = await f.handle(request(control + path, undefined, 'GET', bearer));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sdk_exposed_port_count: 0, sdk_exposed_ports: [], urls_redacted: true });
  assert.equal(calls, 1);
});

test('configuration and environment fail closed before any browser or project operation', async () => {
  const f = harness();
  for (const invalid of [{ ENVIRONMENT: undefined }, { ENVIRONMENT: 'production' }, { PROTOCOL_VERSION: undefined }, { PROTOCOL_VERSION: 'm0-v2' }, { M0_PREVIEW_ORIGIN: control }, { M0_CONTROL_ORIGIN: 'http://control.m0.test:8791' }, { M0_PREVIEW_SIGNING_KEY: '' }, { M0_PROBE_TOKEN: undefined }, { M0_CONTROL_ORIGIN: origin }]) {
    assert.equal((await f.handle(request(`${control}/m0/browser/session`), invalid)).status, 503);
    assert.equal((await f.handle(request(`${origin}${prefix}/api/state`), invalid)).status, 503);
  }
  assert.equal(f.transactions(), 0);
  assert.equal(f.calls(), 0);
});

test('server-owned session is mandatory; management bearer and subject headers never establish browser identity', async () => {
  const f = harness();
  const url = `${control}/m0/browser/${scope.run_id}/alpha/ticket`;
  for (const headers of [{ origin: control }, { origin: control, 'x-user-id': 'fixture-alpha' }, { origin: control, authorization: `Bearer ${config.M0_PROBE_TOKEN}` }] as Record<string, string>[]) {
    assert.equal((await f.handle(request(url, undefined, 'POST', headers))).status, 403);
  }
  const sid = await f.login();
  assert.match(sid, /^__Host-m0_principal=/);
  const session = await f.handle(request(`${control}/m0/browser/session`, sid));
  assert.deepEqual(await session.json(), { fixture: true, principal: 'fixture-alpha', tenant: 'alpha' });
  const start = await f.manage('start');
  const receipt = await start.json() as { origin: string; url?: string; raw_preview_url: null };
  assert.equal(receipt.url, undefined, 'management does not mint browsing URL');
  assert.equal(receipt.origin, origin);
  assert.equal(receipt.raw_preview_url, null);
  assert.equal((await f.handle(request(`${origin}${prefix}/`, sid, 'GET', { authorization: `Bearer ${config.M0_PROBE_TOKEN}` }))).status, 403);
});

test('copied full ticket rejects independent tenant and same-tenant sessions without consuming owner ticket', async () => {
  const f = harness();
  const alice = await f.login(), bob = await f.login('bravo'), otherAlice = await f.login();
  const ticket = await f.ticket(alice);
  for (const other of [bob, otherAlice]) {
    const started = await f.begin(ticket);
    const denied = await f.handle(request(started.authorize, other));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'ticket-owner-denied' });
  }
  const started = await f.begin(ticket);
  const authorized = await f.handle(request(started.authorize, alice));
  assert.equal(authorized.status, 303);
  const redeemed = await f.handle(request(authorized.headers.get('location')!, started.challenge));
  assert.equal(redeemed.status, 303);
  assert.equal((await f.handle(request(ticket))).status, 403);
});

test('one-use ticket, challenge and code consume atomically; code copied without cookie secret fails', async () => {
  const f = harness(), alice = await f.login();
  const started = await f.begin(await f.ticket(alice));
  const authorized = await Promise.all([f.handle(request(started.authorize, alice)), f.handle(request(started.authorize, alice))]);
  assert.deepEqual(authorized.map(r => r.status).sort(), [303, 403]);
  const code = authorized.find(r => r.status === 303)!.headers.get('location')!;
  assert.equal((await f.handle(request(code))).status, 403, 'URL alone lacks challenge secret');
  assert.equal((await f.handle(request(code, `${CHALLENGE_COOKIE}=${new URL(code).searchParams.get('code')}`))).status, 403);
  const redeemed = await Promise.all([f.handle(request(code, started.challenge)), f.handle(request(code, started.challenge))]);
  assert.deepEqual(redeemed.map(r => r.status).sort(), [303, 403]);
  const success = redeemed.find(r => r.status === 303)!;
  const cookies = success.headers.get('set-cookie')!;
  assert.match(cookies, /Path=\/; Max-Age=20; Secure; HttpOnly; SameSite=Strict/);
  assert.equal(cookies.includes('Domain='), false);
  assert.equal(new URL(success.headers.get('location')!).search, '');
});

test('borrowed owner navigation with an attacker challenge cannot burn the original ticket; separate codes still redeem once', async () => {
  const f = harness(), alice = await f.login(), ticket = await f.ticket(alice);
  const attackerChallenge = await f.begin(ticket);
  // GET redirect can carry the owner's same-site cookie, even though the nonce
  // was planted in a different context. Authorization alone must not burn ticket.
  const borrowed = await f.handle(request(attackerChallenge.authorize, alice));
  assert.equal(borrowed.status, 303);
  assert.equal((await f.handle(request(borrowed.headers.get('location')!))).status, 403);
  const ownerChallenge = await f.begin(ticket);
  const ownerCode = await f.handle(request(ownerChallenge.authorize, alice));
  assert.equal(ownerCode.status, 303);
  const redeemed = await Promise.all([
    f.handle(request(ownerCode.headers.get('location')!, ownerChallenge.challenge)),
    f.handle(request(borrowed.headers.get('location')!, attackerChallenge.challenge)),
  ]);
  assert.deepEqual(redeemed.map(result => result.status).sort(), [303, 403], 'one ticket, different challenges/codes, one final redemption');
});

test('exact control Origin is required against same-site project CSRF; malformed bodies cannot select identity', async () => {
  const f = harness(), alice = await f.login();
  for (const path of [`/m0/browser/${scope.run_id}/alpha/ticket`, '/m0/browser/logout']) {
    for (const site of [undefined, origin, 'null', 'https://evil.invalid']) {
      assert.equal((await f.handle(request(`${control}${path}`, alice, 'POST', site ? { origin: site } : {}))).status, 403);
    }
    assert.equal((await f.handle(new Request(`${control}${path}`, { method: 'POST', headers: { cookie: alice, origin: control }, body: JSON.stringify({ principal: 'fixture-alpha' }) }))).status, 403);
  }
  assert.equal((await f.handle(request(`${control}/m0/browser/session`, alice))).status, 200, 'rejected logout did not revoke');
});

test('preview scope, actual host, generation, cookie purpose, Origin, routes and methods deny before proxy', async () => {
  const f = harness(), login = await f.flow();
  for (const path of ['/', '/app.js', '/api/state', '/api/headers', '/ws']) {
    const ws: Record<string, string> = path === '/ws' ? { upgrade: 'websocket', origin } : {};
    assert.equal((await f.handle(request(`${origin}${prefix}${path}`, undefined, 'GET', ws))).status, 403);
    assert.equal((await f.handle(request(`${origin}${prefix}${path}`, login.sid, 'GET', ws))).status, 403);
    assert.equal((await f.handle(request(`${origin}${prefix}${path}`, login.cookie, 'GET', { ...ws, origin: 'https://evil.invalid' }))).status, 403);
  }
  for (const path of ['/proxy/8080/', '/api/preview', `${prefix}/api/state?url=http://169.254.169.254/`, `${prefix}/%2fapi/state`]) assert.equal((await f.handle(request(`${origin}${path}`, login.cookie))).status, 404);
  const otherOrigin = previewOrigin(config.M0_PREVIEW_ORIGIN, { ...scope, generation: '2'.repeat(32) });
  assert.notEqual(otherOrigin, origin);
  assert.equal((await f.handle(request(`${otherOrigin}${prefix}/`, login.cookie))).status, 403);
  assert.equal((await f.handle(request(`${origin}${prefix.replace(scope.run_id, 'preview-other-0001')}/`, login.cookie))).status, 403);
  assert.equal((await f.handle(request(`${origin}${prefix}/api/state`, login.cookie, 'POST'))).status, 405);
  assert.equal((await f.handle(request(`${origin}${prefix}/ws`, login.cookie, 'GET', { upgrade: 'websocket' }))).status, 403);
  assert.equal((await f.handle(request(login.page, `${login.cookie}; ${login.cookie}`))).status, 403);
  assert.equal((await f.handle(request(login.page, login.sid.replace(SESSION_COOKIE, ACCESS_COOKIE)))).status, 403, 'HMAC purpose forbids changing cookie role');
  assert.equal((await f.handle(request(login.page, `${login.cookie}x`))).status, 403, 'signature tampering');
  assert.equal(f.calls(), 0);
});

test('logout, expiration and generation replacement revoke previously issued access', async () => {
  for (const mode of ['logout', 'expiry', 'generation', 'revoke']) {
    const f = harness(), login = await f.flow();
    assert.equal((await f.handle(request(login.page, login.cookie))).status, 200);
    if (mode === 'logout') {
      assert.equal((await f.handle(request(`${control}/m0/browser/logout`, login.sid, 'POST', { origin: control }))).status, 204);
      assert.equal(f.ended(), 1);
      assert.equal((await f.handle(request(`${control}/m0/browser/session`, login.sid))).status, 403);
    } else if (mode === 'expiry') f.advance(ACCESS_SECONDS * 1000);
    else if (mode === 'generation') f.generation();
    else await f.manage('revoke');
    assert.equal((await f.handle(request(login.page, login.cookie))).status, 403);
    assert.equal((await f.handle(request(`${login.page}ws`, login.cookie, 'GET', { upgrade: 'websocket', origin }))).status, 403);
    assert.equal(f.calls(), 1);
  }
});

test('expired pending ticket and authorized code both fail closed at exact TTL', async () => {
  for (const phase of ['ticket', 'code']) {
    const f = harness(), sid = await f.login(), ticket = await f.ticket(sid);
    if (phase === 'ticket') { f.advance(TICKET_SECONDS * 1000); assert.equal((await f.handle(request(ticket))).status, 403); }
    else {
      const started = await f.begin(ticket);
      const authorized = await f.handle(request(started.authorize, sid));
      f.advance(TICKET_SECONDS * 1000);
      assert.equal((await f.handle(request(authorized.headers.get('location')!, started.challenge))).status, 403);
    }
  }
});

test('HTTP proxy strips every credential and project Set-Cookie, rejects redirects, and constrains frames', async () => {
  const f = harness(), login = await f.flow();
  const upstream = upstreamRequest(request(`${login.page}api/headers`, `${login.sid}; ${login.cookie}`, 'GET', { referer: control, origin, authorization: 'Bearer synthetic', 'x-sandbox-port': '3000', 'x-forwarded-host': 'evil.invalid', 'x-m0-preview-access': 'forged' }), '/api/headers');
  assert.deepEqual([...upstream.headers.keys()], []);
  assert.equal(upstream.url, 'http://m0-preview.internal:8080/api/headers');
  for (const location of ['https://evil.invalid/', '//evil.invalid/', '/%2e%2e/', '/api/state?url=http://169.254.169.254/', '/unknown']) assert.equal(filterUpstreamResponse(new Response(null, { status: 302, headers: { location } }), scope, '/redirect-external', origin, control).status, 502);
  const filtered = filterUpstreamResponse(new Response(null, { status: 302, headers: { location: '/api/state', 'set-cookie': '__Host-m0_principal=forged; Domain=m0.test; Path=/; Secure', 'access-control-allow-origin': '*' } }), scope, '/redirect-safe', origin, control);
  assert.equal(filtered.headers.get('location'), `${origin}${prefix}/api/state`);
  assert.equal(filtered.headers.get('set-cookie'), null);
  assert.equal(filtered.headers.get('access-control-allow-origin'), null);
  assert.match(filtered.headers.get('content-security-policy')!, /frame-ancestors https:\/\/control.m0.test:8791; sandbox allow-scripts allow-same-origin/);
  const frame = await f.handle(request(`${control}/m0/browser/frame/${scope.run_id}/alpha`, login.sid));
  assert.equal(frame.status, 200);
  assert.match(frame.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
});


test('rejected request and redirect cancellation preserve 400/502 without unhandled rejections', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const f = harness();
    // A disconnected request stream rejects read() and then cancel(). The
    // request remains invalid; cleanup failure must not escape independently.
    const body = new ReadableStream({
      start(controller) { controller.error(new Error('synthetic-request-disconnect')); },
    });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers: { authorization: `Bearer ${config.M0_PROBE_TOKEN}` }, body, duplex: 'half',
    };
    const malformed = await f.handle(new Request(`${control}/m0/preview/${scope.run_id}/alpha/start`, init));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'invalid-probe-request' });
    let cancellations = 0;
    const upstream = new Response(new ReadableStream({
      cancel() { cancellations++; return Promise.reject(new Error('synthetic-response-disconnect')); },
    }), { status: 302, headers: { location: 'https://outside.invalid/' } });
    const denied = filterUpstreamResponse(upstream, scope, '/redirect-external', origin, control);
    assert.equal(denied.status, 502);
    assert.deepEqual(await denied.json(), { error: 'project-redirect-denied' });
    assert.equal(cancellations, 1);
    // Allow Node's unhandled-rejection turn to run before removing the listener.
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});
