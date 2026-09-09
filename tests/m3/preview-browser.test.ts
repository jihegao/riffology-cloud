import assert from 'node:assert/strict';
import test from 'node:test';
import { previewBrowser, PREVIEW_ACCESS_COOKIE, PREVIEW_NONCE_COOKIE } from '../../services/preview/browser.ts';

const controlOrigin = 'https://control.example.test';
const previewOrigin = 'https://preview.example.test';
const ticket = 'a'.repeat(64), access = 'b'.repeat(64);
const config = { controlOrigin, previewOrigin };
const valid = (path: string, init: RequestInit = {}) => new Request(previewOrigin + path, init);
function cookieValue(setCookie: string, name: string) {
  const match = setCookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  assert.ok(match, `missing ${name}`);
  return match[1]!;
}

test('bootstrap issues nonce cookie and a strict CSP without bearer material', async () => {
  const response = await previewBrowser(valid('/__riff/bootstrap'), config, { exchange: async () => ({ access, expiresAt: 2000 }) }, () => 1000);
  assert.ok(response);
  assert.equal(response.status, 200);
  const nonceCookie = response.headers.get('set-cookie')!;
  const nonce = cookieValue(nonceCookie, PREVIEW_NONCE_COOKIE);
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.match(nonceCookie, /Path=\/; Max-Age=60; Secure; HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('content-security-policy')!, new RegExp(`default-src 'none'.*script-src 'nonce-[a-f0-9]{64}'.*frame-ancestors ${controlOrigin}`));
  const body = await response.text();
  assert.match(body, /riffology-preview-ready/);
  assert.doesNotMatch(body, new RegExp(ticket));
  assert.doesNotMatch(body, new RegExp(access));
});

test('exchange reads nonce only from the cookie and emits a one-time HttpOnly host access cookie', async () => {
  let calls = 0, received: { ticket: string; nonce: string } | null = null;
  const ports = { exchange: async (receivedTicket: string, receivedNonce: string) => { calls++; received = { ticket: receivedTicket, nonce: receivedNonce }; return { access, expiresAt: 2000 }; } };
  const bootstrap = await previewBrowser(valid('/__riff/bootstrap'), config, ports, () => 1000);
  const nonce = cookieValue(bootstrap!.headers.get('set-cookie')!, PREVIEW_NONCE_COOKIE);
  const response = await previewBrowser(valid('/__riff/exchange', { method: 'POST', headers: { origin: previewOrigin, cookie: `${PREVIEW_NONCE_COOKIE}=${nonce}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }), config, ports, () => 1000);
  assert.equal(response!.status, 200);
  assert.deepEqual(received, { ticket, nonce });
  assert.equal(calls, 1);
  const responseBody = await response!.text();
  assert.deepEqual(JSON.parse(responseBody), { ok: true });
  const cookies = response!.headers.getSetCookie();
  const accessCookie = cookies.find(value => value.startsWith(`${PREVIEW_ACCESS_COOKIE}=`));
  assert.ok(accessCookie);
  assert.match(accessCookie!, /Path=\/; Max-Age=1; Secure; HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(accessCookie!, /Domain=/i);
  assert.match(cookies.find(value => value.startsWith(`${PREVIEW_NONCE_COOKIE}=`))!, /Max-Age=0/);
  assert.doesNotMatch(responseBody, new RegExp(ticket));
  assert.doesNotMatch(responseBody, new RegExp(access));

  const extra = await previewBrowser(valid('/__riff/exchange', { method: 'POST', headers: { origin: previewOrigin, cookie: `${PREVIEW_NONCE_COOKIE}=${nonce}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket, nonce }) }), config, ports, () => 1000);
  assert.equal(extra!.status, 403);
  assert.equal(calls, 1);
});

test('wrong origins, ports, and request metadata are rejected without exchange calls', async () => {
  let calls = 0;
  const ports = { exchange: async () => { calls++; return { access, expiresAt: 2000 }; } };
  for (const request of [
    new Request(controlOrigin + '/__riff/bootstrap'),
    new Request('https://preview.example.test:8443/__riff/bootstrap'),
    valid('/__riff/exchange', { method: 'POST', headers: { origin: controlOrigin, cookie: `${PREVIEW_NONCE_COOKIE}=${'c'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }),
    valid('/__riff/exchange', { method: 'POST', headers: { origin: previewOrigin, 'sec-fetch-site': 'cross-site', cookie: `${PREVIEW_NONCE_COOKIE}=${'c'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }),
  ]) {
    const response = await previewBrowser(request, config, ports, () => 1000);
    assert.equal(response!.status, 403);
  }
  assert.equal(calls, 0);
});

test('duplicate cookies, nonce in body, URL credentials, reserved paths and invalid methods fail closed', async () => {
  let calls = 0;
  const ports = { exchange: async () => { calls++; return { access, expiresAt: 2000 }; } };
  const nonce = 'c'.repeat(64), cookie = `${PREVIEW_NONCE_COOKIE}=${nonce}`;
  const cases: Array<[Request, number]> = [
    [valid('/__riff/exchange', { method: 'POST', headers: { origin: previewOrigin, cookie: `${cookie}; ${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }), 403],
    [valid('/__riff/exchange', { method: 'POST', headers: { origin: previewOrigin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ticket, nonce }) }), 403],
    [valid('/__riff/exchange?ticket=' + ticket, { method: 'POST', headers: { origin: previewOrigin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }), 400],
    [valid('/__riff/bootstrap', { method: 'POST' }), 404],
    [valid('/__riff/other', { method: 'GET' }), 404],
    [valid('/__riff/exchange/', { method: 'POST', headers: { origin: previewOrigin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ticket }) }), 404],
  ];
  for (const [request, status] of cases) assert.equal((await previewBrowser(request, config, ports, () => 1000))!.status, status);
  assert.equal(calls, 0);
  assert.equal(await previewBrowser(valid('/app'), config, ports), null);
});
