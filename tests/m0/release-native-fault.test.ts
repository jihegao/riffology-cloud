import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'cloudflare:workers'
    ? { url: 'data:text/javascript,' + encodeURIComponent('export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }'), shortCircuit: true }
    : next(specifier, context);
} });
const { NativeFault, parseNativeMonitorError } = await import('../../spikes/m0-release-completion/native-fault.ts');
hooks.deregister();
class ShortFault extends NativeFault { protected override readonly deadlineMs: number = 35; protected override readonly cleanupMs: number = 15; }
function fixture(kind: '42' | '1' | 'resolve' | 'unknown' | 'pending' = '42') {
  const values = new Map<string, unknown>(), order: string[] = [], owned: Promise<unknown>[] = [];
  let running = false, starts = 0, destroys = 0, reject!: (error: unknown) => void, resolve!: () => void;
  const monitor = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // A fixture allocates this eagerly even when no native monitor is requested.
  void monitor.catch(() => {});
  const native = { get running() { return running; },
    start(options: unknown) { order.push('start'); starts++; running = true;
      assert.deepEqual(options, { entrypoint: ['/bin/sh', '-c', 'exit 42'], enableInternet: false, env: {} }); },
    monitor() { order.push('monitor'); queueMicrotask(() => { if (kind !== 'pending') running = false;
      if (kind === '42' || kind === '1') reject(Error(`container exited with unexpected exit code: ${kind}`));
      else if (kind === 'resolve') resolve(); else if (kind === 'unknown') reject(Error('sensitive-unrecognized-error')); }); return monitor; },
    getTcpPort(port: number) { assert.equal(port, 3000); return { fetch: async (url: string) => { assert.equal(url, 'http://native-fault-readiness/'); throw Error('the container is not listening'); } }; },
    async destroy(...args: unknown[]) { order.push('destroy'); destroys++; assert.equal(args.length, 0);
      const row = values.get('m0:release-completion:native-fault') as { result: unknown }; assert.ok(row.result, 'result precedes destroy');
      running = false; reject(Error('container exited with unexpected exit code: 42')); },
  };
  const storage = { kv: { get: <T>(key: string) => structuredClone(values.get(key)) as T,
    put(key: string, value: unknown) { order.push('put'); values.set(key, structuredClone(value)); } },
    transactionSync: <T>(operation: () => T): T => { const copy = structuredClone(values); try { return operation(); } catch (e) { values.clear(); for (const entry of copy) values.set(...entry); throw e; } },
    sync: async () => { order.push('sync'); },
  };
  const ctx = { storage, container: native, waitUntil: (promise: Promise<unknown>) => owned.push(promise) } as unknown as DurableObjectState;
  return { host: new ShortFault(ctx, {} as never), ctx, values, order, owned, native, storage,
    get starts() { return starts; }, get destroys() { return destroys; }, setRunning(value: boolean) { running = value; }, reject, resolve };
}
test('native exit42 requires immediate monitor, persisted receipt and no-argument cleanup', async () => {
  const f = fixture(); const report = await f.host.run();
  assert.equal(report.result?.outcome, 'confirmed'); assert.equal(report.result?.exitCode, 42);
  assert.equal(report.result?.readiness.status, 'rejected'); assert.equal(report.result?.nativeRunning, false); assert.equal(report.cleanup, 'confirmed');
  const start = f.order.indexOf('start'); assert.equal(f.order[start + 1], 'monitor'); assert.equal(f.starts, 1); assert.equal(f.destroys, 1);
  assert.deepEqual(await f.host.run(), report); assert.deepEqual(await f.host.cleanup(), report); assert.equal(f.starts, 1); assert.equal(f.destroys, 1);
  assert.ok(!JSON.stringify(report).includes('sensitive')); await Promise.all(f.owned);
});
for (const [kind, reason] of [['1', 'other-exit'], ['resolve', 'normal-resolution'], ['unknown', 'unknown-monitor-error']] as const) {
  test(`native ${kind} cannot pass expected fault`, async () => { const f = fixture(kind); const r = await f.host.run();
    assert.equal(r.result?.outcome, 'unconfirmed'); assert.equal(r.result?.reason, reason); assert.equal(r.cleanup, 'confirmed'); assert.equal(f.starts, 1);
    assert.ok(!JSON.stringify(r).includes('sensitive-unrecognized-error')); });
}
test('timeout receipt is immutable when destroy subsequently yields an apparent exit42', async () => {
  const f = fixture('pending'); const r = await f.host.run();
  assert.equal(r.result?.reason, 'deadline'); assert.equal(r.result?.exitCode, null); await Promise.all(f.owned);
  assert.deepEqual(f.host.report().result, r.result); await f.host.run(); assert.equal(f.starts, 1);
});
test('only exact native Error format and safe bounded exit codes are recognized', () => {
  for (const value of [42, 'container exited with unexpected exit code: 42', Error('port failure 42'), Error('runtime signalled the container to exit: 42'), Error('container exited with unexpected exit code: 42\nother'), Error('container exited with unexpected exit code: 42\n'), Error('container exited with unexpected exit code:\n42'), Error('container exited with unexpected exit code: 256')]) {
    assert.deepEqual(parseNativeMonitorError(value), { outcome: 'unrecognized-error', exitCode: null });
  }
  assert.equal(parseNativeMonitorError(Error('container exited with unexpected exit code:42')).exitCode, 42);
});
test('existing native process is not started and cannot pass the fault', async () => {
  const f = fixture(); f.setRunning(true); const r = await f.host.run(); assert.equal(r.result?.reason, 'not-fresh'); assert.equal(f.starts, 0);
});
test('cleanup before run durably fences startup', async () => {
  const f = fixture(); await f.host.cleanup(); const r = await f.host.run(); assert.equal(r.closed, true); assert.equal(r.result?.reason, 'cancelled'); assert.equal(f.starts, 0);
});
test('cleanup while intent is flushing prevents a delayed native start', async () => {
  const f = fixture(); let release!: () => void, first = true;
  f.storage.sync = async () => { if (first) { first = false; await new Promise<void>(yes => { release = yes; }); } };
  const run = f.host.run(); await f.host.cleanup(); release(); const r = await run; assert.equal(f.starts, 0); assert.equal(r.result?.reason, 'cancelled');
});
test('new DO owner sees unfinished intent and does not replay; cleanup records owner loss', async () => {
  const f = fixture('pending'); const original = f.host.run();
  while (!f.order.includes('monitor')) await new Promise<void>(yes => setImmediate(yes));
  const next = new ShortFault(f.ctx, {} as never); assert.equal(next.report().ownerLost, true); await next.run(); assert.equal(f.starts, 1);
  const r = await next.cleanup(); assert.equal(r.result?.reason, 'owner-lost'); await original;
  assert.equal(next.report().result?.reason, 'owner-lost'); assert.equal(f.starts, 1);
});
test('a failed intent flush dispatches no process and retains one-shot intent', async () => {
  const f = fixture(); f.storage.sync = async () => { throw Error('flush-failed'); };
  await assert.rejects(f.host.run(), /flush-failed/); assert.equal(f.starts, 0); await f.host.run(); assert.equal(f.starts, 0);
});
test('a failed terminal flush cannot trigger destroy before a confirmed result barrier', async () => {
  const f = fixture(); let calls = 0; f.storage.sync = async () => { if (++calls === 3) throw Error('result-flush-failed'); };
  await assert.rejects(f.host.run(), /result-flush-failed/); assert.equal(f.destroys, 0);
  await f.host.cleanup(); assert.equal(f.destroys, 1);
});
