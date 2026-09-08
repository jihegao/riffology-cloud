import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StorageFaultProbe, StorageFaultConflict, GC_GRACE_MS, interruptR2Put, parseStorageFaultRoute, hasEmptyStorageFaultBody, storageEventStream, type FixedStreamFactory } from '../../spikes/m0-storage/faults.ts';
import type { Receipt } from '../../spikes/m0-storage/checkpoint.ts';
// @ts-expect-error The standalone CLI uses JavaScript; these tests exercise its exported boundaries.
import { parseArguments, readProbeSecret, readLimitedBody, applySavedEvents, runStorageCloud } from '../../scripts/m0/storage-cloud.mjs';

const streamFactory: FixedStreamFactory = () => new TransformStream();
class DeliberateReset extends Error {}
class Bucket {
  data = new Map<string, { bytes: Uint8Array; etag: string; version: string }>();
  deletions: string[] = []; streamCalls = 0; consumed = 0; serial = 0;
  async put(key: string, value: Uint8Array | ReadableStream, options?: { onlyIf?: unknown }) {
    if (options?.onlyIf && this.data.has(key)) return null;
    let bytes: Uint8Array;
    if (value instanceof ReadableStream) {
      this.streamCalls++;
      const reader = value.getReader(); const chunks: Uint8Array[] = [];
      try { while (true) { const next = await reader.read(); if (next.done) break; this.consumed += next.value.byteLength; chunks.push(next.value); } }
      finally { reader.releaseLock(); }
      bytes = new Uint8Array(Buffer.concat(chunks));
    } else bytes = Uint8Array.from(value);
    const version = String(++this.serial);
    this.data.set(key, { bytes, etag: `etag-${version}`, version });
    return this.head(key);
  }
  async head(key: string) { const row = this.data.get(key); return row ? { key, size: row.bytes.byteLength, etag: row.etag, version: row.version } : null; }
  async get(key: string) { const row = this.data.get(key); return row ? { ...await this.head(key), arrayBuffer: async () => Uint8Array.from(row.bytes).buffer } : null; }
  async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
    // Two-item pages exercise bounded pagination rather than assuming one R2 response.
    const keys = [...this.data.keys()].filter(key => key.startsWith(prefix)).sort(); const start = Number(cursor ?? 0);
    const objects = await Promise.all(keys.slice(start, start + 2).map(key => this.head(key)));
    return { objects, truncated: start + 2 < keys.length, cursor: String(start + 2) };
  }
  async delete(key: string) { this.deletions.push(key); this.data.delete(key); }
}
function fixture() {
  let values = new Map<string, unknown>(); let clock = 1000; const bucket = new Bucket(); const resets: string[] = [];
  const ctx = {
    id: { toString: () => 'a'.repeat(64) },
    storage: {
      kv: { get: (key: string) => structuredClone(values.get(key)), put: (key: string, value: unknown) => values.set(key, structuredClone(value)), list: ({ prefix }: { prefix: string }) => new Map([...values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))).entries() },
      sync: async () => {},
      transactionSync: <T>(operation: () => T) => { const before = structuredClone(values); try { return operation(); } catch (error) { values = before; throw error; } },
    },
    abort: (reason: string) => { resets.push(reason); throw new DeliberateReset(reason); },
  } as unknown as DurableObjectState;
  return { bucket, ctx, resets, next: (nonce: string) => new StorageFaultProbe(ctx, bucket as unknown as R2Bucket, nonce, { streamFactory, now: () => clock }), advance: () => { clock += GC_GRACE_MS; } };
}
async function throughCrashes(f: ReturnType<typeof fixture>) {
  const first = f.next('instance-one'); await first.action('init'); await first.action('upload-interrupt');
  await assert.rejects(first.action('precommit-crash'), DeliberateReset);
  const second = f.next('instance-two'); await assert.rejects(second.action('postcommit-crash'), DeliberateReset);
  return f.next('instance-three');
}

test('streaming upload really reaches the bucket and consumes a partial body before rejection', async () => {
  const bucket = new Bucket(); const key = `probe/blobs/${'b'.repeat(64)}`;
  const fact = await interruptR2Put(bucket as unknown as R2Bucket, key, new Uint8Array(256 * 1024), streamFactory);
  assert.deepEqual(fact, { putInvoked: true, declaredBytes: 262144, consumedBytes: 65536, putRejected: true, objectAbsent: true });
  assert.equal(bucket.streamCalls, 1); assert.equal(bucket.consumed, 65536); assert.equal(await bucket.head(key), null);
});

test('an R2 put that claims success after a broken body cannot pass the upload fault case', async () => {
  const f = fixture(); const original = f.bucket.put.bind(f.bucket);
  f.bucket.put = async (...args: Parameters<Bucket['put']>) => { try { return await original(...args); } catch { return { key: args[0], size: 0, etag: 'unexpected-success', version: 'fake' }; } };
  const probe = f.next('instance-one'); await probe.action('init');
  await assert.rejects(probe.action('upload-interrupt'), /unproven/);
  const status = await probe.status(); assert.equal(status.state?.stage, 'failed');
  assert.equal(status.state?.upload?.putRejected, false); assert.equal(status.state?.upload?.consumedBytes, 65536);
  assert.equal(status.current?.sequence, 1); await assert.rejects(probe.action('precommit-crash'), /phase-conflict/);
});

test('fixed cloud stages persist pre/post fault markers and only recover the committed revision', async () => {
  const f = fixture(); const probe = await throughCrashes(f); const status = await probe.status();
  assert.deepEqual(f.resets, ['T06-precommit-fault', 'T06-postcommit-fault']);
  assert.equal(status.state?.stage, 'postcommit-aborted');
  assert.equal(status.state?.precommit?.instanceNonce, 'instance-one');
  assert.equal(status.state?.postcommit?.instanceNonce, 'instance-two');
  assert.equal(status.events.length, 2); assert.equal(status.current?.revision, status.state?.postcommit?.candidate);
  assert.equal(status.state?.precommit?.receiptAfter?.revision, status.state?.initial?.revision);
  assert.equal(status.events.some(event => event.revision === status.state?.precommit?.candidate), false);
  assert.deepEqual(status.restored.map(row => row.files[0]?.path), ['baseline.txt', 'committed-after-crash.txt']);
  assert.ok(status.objects.some(object => object.key.endsWith(`manifests/${status.state?.precommit?.candidate}`)), 'complete uncommitted candidate exists but is never selected for restore');
});

test('a persisted fault cannot execute again, and a surviving instance cannot claim a restart', async () => {
  const f = fixture(); const probe = f.next('same-instance');
  await probe.action('init'); await probe.action('upload-interrupt'); await assert.rejects(probe.action('precommit-crash'), DeliberateReset);
  await assert.rejects(probe.action('precommit-crash'), /phase-conflict/);
  await assert.rejects(probe.action('postcommit-crash'), /did-not-restart/);
  assert.equal(f.resets.length, 1); assert.equal(probe.events().length, 1);
});

test('GC enforces grace, deletes actual unique orphans, preserves every committed root and stays scoped', async () => {
  const f = fixture(); const probe = await throughCrashes(f);
  await f.bucket.put('another-run/blobs/foreign', new Uint8Array([99]));
  const marked = await probe.action('gc-mark'); const before = marked.restored;
  assert.ok(marked.state?.gc?.candidates.length! >= 3);
  await assert.rejects(probe.action('gc-sweep'), /grace/); assert.equal(f.bucket.deletions.length, 0);
  await assert.rejects(probe.action('postcommit-crash'), /phase-conflict/);
  f.advance(); const swept = await probe.action('gc-sweep');
  assert.equal(swept.state?.stage, 'gc-swept'); assert.deepEqual(swept.restored, before);
  assert.deepEqual(f.bucket.deletions.sort(), marked.state?.gc?.candidates.map(row => row.key).sort());
  assert.ok(f.bucket.deletions.every(key => key.startsWith(probe.prefix)));
  assert.ok(await f.bucket.head('another-run/blobs/foreign'));
  assert.deepEqual(swept.objects.map(row => row.key).sort(), marked.state?.gc?.retained);
  const again = await probe.action('gc-sweep');
  assert.ok('deletedNow' in again); assert.deepEqual(again.deletedNow, []);
  assert.equal(f.bucket.deletions.length, marked.state?.gc?.candidates.length);
});

test('GC rechecks object identity before deletion rather than trusting the marked key list', async () => {
  const f = fixture(); const probe = await throughCrashes(f); const marked = await probe.action('gc-mark');
  await f.bucket.put(marked.state!.gc!.candidates[0]!.key, new Uint8Array([12])); f.advance();
  await assert.rejects(probe.action('gc-sweep'), /object-or-reference-changed/);
  assert.equal(f.bucket.deletions.length, 0);
});

test('GC refuses a changed committed reference set without deleting any object', async () => {
  const f = fixture(); const probe = await throughCrashes(f); await probe.action('gc-mark'); f.advance();
  const current = probe.current()!;
  f.ctx.storage.kv.put('events/00000003', { ...current, sequence: 3 }); f.ctx.storage.kv.put('current', { ...current, sequence: 3 });
  await assert.rejects(probe.action('gc-sweep'), /reference-set-changed/);
  assert.equal(f.bucket.deletions.length, 0);
});

test('fault routes accept only fixed actions and canonical event cursors, before a separate body check', () => {
  const url = 'https://staging.example/probe/storage-test/faults/';
  assert.deepEqual(parseStorageFaultRoute(new Request(`${url}init`, { method: 'POST' })), { runId: 'storage-test', action: 'init', cursor: 0 });
  assert.equal(parseStorageFaultRoute(new Request(`${url}init?key=anything`, { method: 'POST' })), null);
  assert.ok(parseStorageFaultRoute(new Request(`${url}init`, { method: 'POST', body: '{}' })), 'body representation is not routing authority');
  assert.equal(parseStorageFaultRoute(new Request(`${url}init`)), null);
  assert.equal(parseStorageFaultRoute(new Request(`${url}delete-anything`, { method: 'POST' })), null);
  for (const cursor of ['-1', '01', '1.0', '999999999', 'NaN']) assert.equal(parseStorageFaultRoute(new Request(`${url}events`, { headers: { 'last-event-id': cursor } })), null);
});

test('body validation accepts a null body and an actual empty cloud-style stream', async () => {
  const url = 'https://staging.example/probe/storage-test/faults/init';
  assert.equal(await hasEmptyStorageFaultBody(new Request(url, { method: 'POST' })), true);
  const request = new Request(url, { method: 'POST', body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); controller.close(); } }), duplex: 'half' } as RequestInit);
  assert.notEqual(request.body, null); assert.equal(await hasEmptyStorageFaultBody(request), true);
});

test('body validation rejects the first nonempty chunk even with Content-Length zero', async () => {
  let canceled = false;
  const request = new Request('https://staging.example', { method: 'POST', headers: { 'content-length': '0' }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { canceled = true; } }), duplex: 'half' } as RequestInit);
  assert.equal(await hasEmptyStorageFaultBody(request), false); assert.equal(canceled, true);
});

test('body validation bounds a hanging stream including an uncooperative cancel callback', async () => {
  let canceled = false;
  const request = new Request('https://staging.example', { method: 'POST', body: new ReadableStream({ cancel() { canceled = true; return new Promise(() => {}); } }), duplex: 'half' } as RequestInit);
  const before = Date.now(); assert.equal(await hasEmptyStorageFaultBody(request, 10), false);
  assert.equal(canceled, true); assert.ok(Date.now() - before < 1000);
});

test('event stream exposes exact cursor replay and remains open until the observer cancels', async () => {
  const events: Receipt[] = [{ revision: 'a'.repeat(64), sequence: 1, generation: 1 }, { revision: 'b'.repeat(64), sequence: 2, generation: 1 }];
  const read = (after: number) => events.filter(event => event.sequence > after);
  const response = storageEventStream(read, 1); const reader = response.body!.getReader();
  const saved = await reader.read(); assert.equal(saved.done, false); assert.match(new TextDecoder().decode(saved.value), /^id: 2\nevent: saved/);
  const marker = await reader.read(); assert.match(new TextDecoder().decode(marker.value), /caught-up/);
  await reader.cancel(); reader.releaseLock();
  const empty = storageEventStream(read, 2); const emptyReader = empty.body!.getReader();
  assert.match(new TextDecoder().decode((await emptyReader.read()).value), /^event: caught-up/); await emptyReader.cancel(); emptyReader.releaseLock();
  assert.equal(storageEventStream(read, 3).status, 409);
});

test('cloud CLI requires a narrowly scoped HTTPS staging origin and deployment provenance', () => {
  const common = ['--deployment-version', '12345678-abcd-abcd-abcd-123456789012', '--bundle-sha256', 'a'.repeat(64), '--secrets-file', '.local/cloud-staging/storage.secrets.json'];
  assert.equal(parseArguments(['--origin', 'https://riffology-m0-storage-staging.jihe-gao.workers.dev', ...common]).origin, 'https://riffology-m0-storage-staging.jihe-gao.workers.dev');
  for (const origin of ['http://riffology-m0-storage-staging.jihe-gao.workers.dev', 'https://attacker.example', 'https://riffology-m0-storage-staging.other-account.workers.dev', 'https://riffology-m0-storage.jihe-gao.workers.dev', 'https://riffology-m0-storage-staging.jihe-gao.workers.dev/path', 'https://user@riffology-m0-storage-staging.jihe-gao.workers.dev', 'https://riffology-m0-storage-staging.jihe-gao.workers.dev?query=1']) assert.throws(() => parseArguments(['--origin', origin, ...common]));
  assert.throws(() => parseArguments(['--origin', 'https://riffology-m0-storage-staging.jihe-gao.workers.dev']), /deployment/);
  assert.throws(() => parseArguments(['--origin', 'https://riffology-m0-storage-staging.jihe-gao.workers.dev', ...common, '--origin', 'https://attacker.example']), /duplicate/);
});

test('the CLI only reads one owned 0600 secret and never accepts a symlink or loose permissions', () => {
  const directory = mkdtempSync(resolve('.local/storage-secret-test-')); const secret = resolve(directory, '.local/storage.secrets.json');
  try {
    mkdirSync(resolve(directory, '.local')); writeFileSync(secret, JSON.stringify({ M0_PROBE_TOKEN: 't'.repeat(40) }), { mode: 0o600 });
    assert.equal(readProbeSecret(directory, secret), 't'.repeat(40));
    chmodSync(secret, 0o640); assert.throws(() => readProbeSecret(directory, secret), /0600/);
    chmodSync(secret, 0o600); writeFileSync(secret, JSON.stringify({ M0_PROBE_TOKEN: 't'.repeat(40), UNEXPECTED: true }));
    assert.throws(() => readProbeSecret(directory, secret), /one-local/);
    const outsideLocal = resolve(directory, 'outside.json'); writeFileSync(outsideLocal, JSON.stringify({ M0_PROBE_TOKEN: 't'.repeat(40) }), { mode: 0o600 });
    assert.throws(() => readProbeSecret(directory, outsideLocal), /under-repository-local/);
    rmSync(secret); symlinkSync('../outside.json', secret); assert.throws(() => readProbeSecret(directory, secret), /symlink/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('bounded response reader cancels oversized bodies and consumer rejects conflicting duplicate sequence', async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); }, cancel() { canceled = true; } }));
  await assert.rejects(readLimitedBody(response, 9), /byte-limit/); assert.equal(canceled, true);
  const consumer = { seen: new Map(), applied: [], duplicates: 0 };
  const event = { revision: 'a'.repeat(64), generation: 1, sequence: 1 };
  applySavedEvents(consumer, [event, event]); assert.deepEqual(consumer.applied, [1]); assert.equal(consumer.duplicates, 1);
  assert.throws(() => applySavedEvents(consumer, [{ ...event, revision: 'b'.repeat(64) }]), /changed receipt/);
});

test('cloud runner drives complete faults over injected transport, cancels SSE, and never automatically retries mutations', async () => {
  const f = fixture(); let nonce = 1; let probe = f.next(`instance-${nonce}`); let transientRead = true;
  const calls: Array<{ method: string; action: string; redirect: string }> = [];
  const directory = mkdtempSync(resolve('docs/evidence/runs/storage-runner-test-')); const output = resolve(directory, 'result.json'); const token = 'synthetic-probe-credential-'.repeat(2);
  try {
    const fakeFetch = async (url: string, init: RequestInit) => {
      const request = new Request(url, init); const route = parseStorageFaultRoute(request)!;
      assert.ok(route); assert.equal(request.headers.get('authorization'), `Bearer ${token}`);
      assert.equal(await hasEmptyStorageFaultBody(request), true);
      calls.push({ method: request.method, action: route.action, redirect: init.redirect! });
      if (route.action === 'status') { if (transientRead) { transientRead = false; return Response.json({ error: 'temporary' }, { status: 503 }); } return Response.json(await probe.status()); }
      if (route.action === 'events') return storageEventStream(after => probe.events(after), route.cursor);
      if (route.action === 'gc-sweep') f.advance();
      try { return Response.json(await probe.action(route.action)); }
      catch (error) { if (error instanceof DeliberateReset) probe = f.next(`instance-${++nonce}`); return Response.json({ error: 'interrupted' }, { status: error instanceof StorageFaultConflict ? 409 : 500 }); }
    };
    const result = await runStorageCloud({ origin: 'https://riffology-m0-storage-staging.jihe-gao.workers.dev', runId: 'storage-runner-test', deploymentVersion: '12345678-abcd-abcd-abcd-123456789012', bundleSha256: 'a'.repeat(64), output }, { fetch: fakeFetch, token });
    assert.equal(result.checksPassed, true); assert.equal(result.gate_decision, 'needs-review');
    const text = readFileSync(output, 'utf8'); assert.equal(text.includes(token), false); const artifact = JSON.parse(text);
    assert.equal(artifact.cloudGatePassed, false); assert.deepEqual(artifact.consumer.appliedSequences, [1, 2]);
    assert.equal(artifact.consumer.duplicateDeliveriesIgnored, 1);
    assert.equal(artifact.actions.filter((row: { action: string; readerCancellationAcknowledged?: boolean }) => row.action === 'events' && row.readerCancellationAcknowledged).length, 4);
    assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => call.action), ['init', 'upload-interrupt', 'precommit-crash', 'postcommit-crash', 'postcommit-crash', 'gc-mark', 'gc-sweep', 'gc-sweep']);
    assert.ok(calls.every(call => call.redirect === 'error'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('an unknown POST result is observed with GETs and is never automatically sent again', async () => {
  const directory = mkdtempSync(resolve('docs/evidence/runs/storage-runner-unknown-test-')); const output = resolve(directory, 'result.json'); const calls: string[] = [];
  try {
    const fakeFetch = async (url: string, init: RequestInit) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname.split('/').at(-1)}`);
      if (init.method === 'POST') throw new TypeError('synthetic connection loss before outcome known');
      return Response.json({ state: null, current: null, objects: [] });
    };
    const result = await runStorageCloud({ origin: 'https://riffology-m0-storage-staging.jihe-gao.workers.dev', runId: 'storage-unknown-test', deploymentVersion: '12345678-abcd-abcd-abcd-123456789012', bundleSha256: 'a'.repeat(64), output }, { fetch: fakeFetch, token: 't'.repeat(40) });
    assert.equal(result.checksPassed, false); assert.deepEqual(calls.filter(call => call.startsWith('POST')), ['POST init']);
    const artifact = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(artifact.actions.find((row: { method: string }) => row.method === 'POST').outcome, 'unknown-do-not-replay');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
