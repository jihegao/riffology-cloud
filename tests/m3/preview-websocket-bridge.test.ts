import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgePreviewSockets, type PreviewSocket } from '../../services/preview/websocket-bridge.ts';

class Socket extends EventTarget implements PreviewSocket {
  binaryType = 'blob'; readonly sent: Array<string | ArrayBuffer> = []; readonly closes: Array<[number | undefined, string | undefined]> = [];
  readyState = 1;
  accept() {}
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.readyState = 3; this.closes.push([code, reason]); }
  message(data: string | ArrayBuffer) { this.dispatchEvent(new MessageEvent('message', { data })); }
  error() { this.dispatchEvent(new Event('error')); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const grant = { expiresAt: 100000 };

test('accepts both sockets and relays text and ArrayBuffer frames in each direction', async () => {
  const left = new Socket(), right = new Socket();
  const bridge = await bridgePreviewSockets(left, right, { authorize: async () => grant, deadlineAt: 100000 }, () => 0);
  assert.equal(left.binaryType, 'arraybuffer'); assert.equal(right.binaryType, 'arraybuffer');
  left.message('one'); left.message(new Uint8Array([1, 2]).buffer); right.message('back'); await tick();
  assert.deepEqual(right.sent, ['one', new Uint8Array([1, 2]).buffer]); assert.deepEqual(left.sent, ['back']);
  bridge.close(); await bridge.closed; assert.equal(left.closes[0]?.[0], 1000); assert.equal(right.closes[0]?.[0], 1000);
});

test('authorization pending during a queued frame is aborted and a late frame is discarded', async () => {
  const left = new Socket(), right = new Socket(), abort = new AbortController(); let calls = 0, release!: () => void;
  const pending = new Promise<{ expiresAt: number }>(resolve => { release = () => resolve(grant); });
  const bridge = await bridgePreviewSockets(left, right, { authorize: async () => (++calls === 1 ? grant : pending), deadlineAt: 100000, signal: abort.signal }, () => 0);
  left.message('late'); await tick(); abort.abort(); release(); await bridge.closed; await tick();
  assert.equal(right.sent.length, 0); assert.equal(left.closes[0]?.[0], 1008); assert.equal(right.closes[0]?.[0], 1008);
});

test('authorization rejection closes both ends, and oversized or overqueued input fails closed', async () => {
  const rejectedLeft = new Socket(), rejectedRight = new Socket();
  await assert.rejects(bridgePreviewSockets(rejectedLeft, rejectedRight, { authorize: async () => { throw Error('revoked'); }, deadlineAt: 100000 }, () => 0), /revoked/);
  assert.equal(rejectedLeft.closes[0]?.[0], 1008); assert.equal(rejectedRight.closes[0]?.[0], 1008);
  for (const data of [new Uint8Array(65537).buffer]) {
    const left = new Socket(), right = new Socket(); const b = await bridgePreviewSockets(left, right, { authorize: async () => grant, deadlineAt: 100000 }, () => 0);
    left.message(data); await b.closed; assert.equal(left.closes[0]?.[0], 1009); assert.equal(right.closes[0]?.[0], 1009);
  }
  const left = new Socket(), right = new Socket(); let release!: () => void; const wait = new Promise<{ expiresAt: number }>(resolve => { release = () => resolve(grant); }); let calls = 0;
  const b = await bridgePreviewSockets(left, right, { authorize: async () => (++calls === 1 ? grant : wait), deadlineAt: 100000 }, () => 0);
  for (let i = 0; i < 34; i++) left.message(String(i)); await b.closed; release(); assert.equal(left.closes[0]?.[0], 1013); assert.equal(right.closes[0]?.[0], 1013);
});

test('authorization expiry is not extended and idle polling revocation closes the bridge', async () => {
  let grants=0;const left = new Socket(), right = new Socket(); const b = await bridgePreviewSockets(left, right, { authorize: async () => ({ expiresAt: ++grants===1?20:10000 }), deadlineAt: 1000 }, () => 0);
  left.message('does not renew');await tick();assert.equal(right.sent[0],'does not renew');
  await new Promise(resolve => setTimeout(resolve, 40)); await b.closed; assert.equal(left.closes[0]?.[0], 1008);
  const a = new Socket(), c = new Socket(); let calls = 0; const idle = await bridgePreviewSockets(a, c, { authorize: async () => (++calls === 1 ? { expiresAt: 10000 } : Promise.reject(Error('revoked'))), deadlineAt: 10000 }, () => 0);
  await new Promise(resolve => setTimeout(resolve, 1100)); await idle.closed; assert.equal(a.closes[0]?.[0], 1008); assert.equal(c.closes[0]?.[0], 1008);
});
