import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { PROJECT_SERVICE } from './runtime.ts';
import { filterUpstreamResponse, upstreamRequest, type Scope } from './policy.ts';

test('opt-in real fixed Python HTTP/WS protocol regression (no Worker or Container claims)', { skip: process.env.M0_PREVIEW_PROTOCOL !== '1', timeout: 15000 }, async () => {
  const guard = net.createServer();
  guard.listen(8080, '127.0.0.1');
  await once(guard, 'listening');
  await new Promise<void>(resolve => guard.close(() => resolve()));
  const child = spawn('python3', ['-u', '-c', PROJECT_SERVICE], { stdio: ['ignore', 'ignore', 'ignore'] });
  const scope: Scope = { run_id: 'preview-protocol', tenant: 'alpha', preview_id: 'fixture-alpha-preview', generation: '1'.repeat(32) };
  const origin = 'https://p-' + scope.generation + '.preview.m0.test:8791';
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error('fixed Python fixture exited');
      try { const response = await fetch('http://127.0.0.1:8080/api/state'); ready = response.ok; await response.body?.cancel(); if (ready) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready);
    const proxy = async (route: string) => {
      const clean = upstreamRequest(new Request(`${origin}${route}`, { headers: { cookie: 'platform=synthetic', authorization: 'Bearer synthetic', referer: 'https://control.m0.test:8791' } }), route);
      const raw = await fetch(new Request(`http://127.0.0.1:8080${route}`, clean));
      return filterUpstreamResponse(raw, scope, route, origin, 'https://control.m0.test:8791');
    };
    assert.match(await (await proxy('/')).text(), /M0 synthetic Preview/);
    assert.match(await (await proxy('/app.js')).text(), /new WebSocket/);
    assert.equal((await (await proxy('/api/state')).json() as { state_sequence: number }).state_sequence, 1);
    const observed = await (await proxy('/api/headers')).json() as { observed_header_presence: Record<string, boolean> };
    assert.ok(Object.values(observed.observed_header_presence).every(value => !value));
    assert.equal((await proxy('/set-cookie')).headers.get('set-cookie'), null);
    assert.equal((await proxy('/redirect-safe')).status, 302);
    assert.equal((await proxy('/redirect-external')).status, 502);
    assert.equal((await proxy('/redirect-control')).status, 502);
    const socket = net.createConnection({ host: '127.0.0.1', port: 8080 });
    try {
      await once(socket, 'connect');
      const key = Buffer.from(randomBytes(16)).toString('base64');
      const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      const received = new Promise<Buffer>((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        socket.on('data', data => { buffer = Buffer.concat([buffer, data]); if (buffer.toString().includes('m0-fixed-state')) resolve(buffer); });
        socket.once('error', reject);
      });
      socket.write(`GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`);
      const buffer = await received;
      assert.match(buffer.toString(), /HTTP\/1\.1 101/);
      assert.ok(buffer.toString().includes(`Sec-WebSocket-Accept: ${expected}`));
    } finally { socket.destroy(); }
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
});
