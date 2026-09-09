import assert from 'node:assert/strict';
import test from 'node:test';
import { forwardRunningWebSocket } from '../../services/run/websocket-forward.ts';

const origin = 'https://p-' + 'a'.repeat(40) + '.preview.example.test';
const request = () => new Request(origin + '/socket?room=1', { method: 'GET', headers: {
  upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13',
  'sec-websocket-protocol': 'riff-v1, binary', cookie: 'secret=1', authorization: 'Bearer secret',
  'x-riffology-sandbox-id': 'forged', origin,
} });

test('stopped or absent containers are rejected without resolving port', async () => {
  let calls = 0;
  const stopped = { running: false, getTcpPort() { calls++; throw Error('must-not-resolve-port'); } };
  await assert.rejects(forwardRunningWebSocket(undefined, request(), Date.now() + 60000), /service-container-not-running/);
  await assert.rejects(forwardRunningWebSocket(stopped, request(), Date.now() + 60000), /service-container-not-running/);
  assert.equal(calls, 0);
});

test('expired or overlong deadlines are rejected before port access', async t => {
  // A one-millisecond overrun must not become valid while constructing the
  // Request under parallel test load. Pin wall time to test the exact bound.
  t.mock.timers.enable({apis:['Date'],now:1000000});
  let calls = 0; const container = { running: true, getTcpPort() { calls++; throw Error('must-not-resolve-port'); } };
  await assert.rejects(forwardRunningWebSocket(container, request(), Date.now() - 1), /service-ws-deadline-denied/);
  await assert.rejects(forwardRunningWebSocket(container, request(), Date.now()), /service-ws-deadline-denied/);
  await assert.rejects(forwardRunningWebSocket(container, request(), Date.now() + 900001), /service-ws-deadline-denied/);
  assert.equal(calls, 0);
});

test('running container forwards a cleaned GET upgrade to fixed port 8080', async t => {
  t.mock.timers.enable({apis:['Date'],now:1000000});
  let port = 0, forwarded: Request | undefined;
  const container = { running: true, getTcpPort(value: number) { port = value; return { fetch: async (value: Request) => { forwarded = value; return new Response('upgrade fixture'); } }; } };
  const response = await forwardRunningWebSocket(container, request(), Date.now() + 900000);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'upgrade fixture'); assert.equal(port, 8080);
  assert.ok(forwarded); assert.equal(forwarded!.url, 'http://localhost:8080/socket?room=1'); assert.equal(forwarded!.method, 'GET');
  assert.equal(forwarded!.headers.get('upgrade'), 'websocket'); assert.equal(forwarded!.headers.get('connection'), 'Upgrade'); assert.equal(forwarded!.headers.get('origin'), 'http://localhost:8080');
  assert.equal(forwarded!.headers.get('sec-websocket-version'), '13'); assert.equal(forwarded!.headers.get('sec-websocket-protocol'), 'riff-v1, binary');
  for (const header of ['cookie', 'authorization', 'x-riffology-sandbox-id']) assert.equal(forwarded!.headers.get(header), null);
});

test('forward errors are returned once without automatic retry', async () => {
  let calls = 0; const container = { running: true, getTcpPort() { calls++; return { fetch: async () => { throw Error('socket-lost'); } }; } };
  await assert.rejects(forwardRunningWebSocket(container, request(), Date.now() + 60000), /socket-lost/); assert.equal(calls, 1);
});
