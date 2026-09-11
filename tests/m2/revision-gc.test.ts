import assert from 'node:assert/strict';
import test from 'node:test';
import { sweepTurnRevisionBlobs, type TurnRevisionGcBucket, type TurnRevisionGcCoordinator } from '../../services/turn-runtime/revision-gc.ts';

const old = new Date('2026-01-01T00:00:00.000Z');
const recent = new Date('2026-09-06T00:00:00.000Z');
function manifest(files: string, session: string) {
  return JSON.stringify({ schemaVersion: 3, identity: { scope, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 2 }, base: { workspace: null, session: null }, outcome: 'completed', executionErrorCode: null, files: { objectKey: `turn-blobs-v3/tenant-a/project-a/workspace-a/files/${files}`, sha256: files, size: 1 }, piSession: { objectKey: `turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${session}`, sha256: session, size: 1 }, committedAt: 1 });
}
class Bucket {
  objects = new Map<string, { bytes: Uint8Array; uploaded: Date }>(); deletes: string[] = []; lists: string[] = [];
  add(key: string, body: string | Uint8Array, uploaded = old) { this.objects.set(key, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body, uploaded }); }
  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    this.lists.push(options.prefix ?? ''); const keys = [...this.objects.keys()].filter(key => key.startsWith(options.prefix ?? '')).sort();
    const offset = options.cursor ? Number(options.cursor) : 0, limit = options.limit ?? 100;
    const selected = keys.slice(offset, offset + limit).map(key => ({ key, uploaded: this.objects.get(key)!.uploaded }));
    return { objects: selected, truncated: offset + limit < keys.length, cursor: offset + limit < keys.length ? String(offset + limit) : undefined };
  }
  async get(key: string) { const item = this.objects.get(key); if (!item) return null; return { size: item.bytes.byteLength, async arrayBuffer() { return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength); } }; }
  async delete(key: string) { this.deletes.push(key); this.objects.delete(key); }
}
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},F = 'a'.repeat(64), S = 'b'.repeat(64), U = 'c'.repeat(64);
const MANIFEST_KEY = 'turns/tenant-a/project-a/workspace-a/2/session-a/turn-a/dispatch-a.json';
function coordinator(bucket?: Bucket, overrides: Partial<TurnRevisionGcCoordinator> = {}): TurnRevisionGcCoordinator { return { runExclusive: async operation => operation(), ...overrides }; }

test('GC deletes only old unreferenced files/session blobs and preserves manifests', async () => {
  const bucket = new Bucket(); bucket.add(MANIFEST_KEY, manifest(F, S));
  bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${F}`, 'used'); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${S}`, 'used');
  bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'orphan'); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${U}`, 'orphan'); bucket.add('turn-blobs/other/x', 'untouched');
  const result = await sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, coordinator(bucket), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000, pageSize: 2 });
  assert.deepEqual(bucket.deletes.sort(), [`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, `turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${U}`].sort());
  assert.equal(result.deletedBlobs, 2); assert.equal(bucket.objects.has(MANIFEST_KEY), true); assert.equal(bucket.objects.has('turn-blobs/other/x'), true);
  assert.deepEqual(bucket.lists, ['turns/tenant-a/project-a/workspace-a/', 'turn-blobs-v3/tenant-a/project-a/workspace-a/', 'turn-blobs-v3/tenant-a/project-a/workspace-a/']);
});

test('GC retains young or referenced blobs within the explicit scan bound', async () => {
  const bucket = new Bucket(); bucket.add(MANIFEST_KEY, manifest(F, S)); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${F}`, 'used', recent); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'young', recent); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${S}`, 'used');
  const result = await sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, coordinator(bucket), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 172_800_000, pageSize: 1, maxObjects: 10 });
  assert.equal(result.deletedBlobs, 0); assert.equal(bucket.deletes.length, 0);
});

test('GC refuses a bounded blob listing before deleting later orphans', async () => {
  const bucket = new Bucket(); bucket.add(MANIFEST_KEY, manifest(F, S));
  bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${F}`, 'used', recent); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'orphan');
  await assert.rejects(sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, coordinator(bucket), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000, pageSize: 1, maxObjects: 1 }), /gc-limit/);
  assert.equal(bucket.deletes.length, 0);
});

test('GC fails closed on missing or malformed manifests before deleting', async () => {
  for (const body of ['{}', manifest('bad', S)]) {
    const bucket = new Bucket(); bucket.add(MANIFEST_KEY, body); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'orphan');
    await assert.rejects(sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, coordinator(bucket), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000 }), /manifest/);
    assert.equal(bucket.deletes.length, 0);
  }
  const missing = new Bucket();
  const listedMissing = { list: async (options: { prefix?: string }) => options.prefix === 'turns/tenant-a/project-a/workspace-a/' ? { objects: [{ key: MANIFEST_KEY, uploaded: old }], truncated: false } : { objects: [], truncated: false }, get: missing.get.bind(missing), delete: missing.delete.bind(missing) };
  await assert.rejects(sweepTurnRevisionBlobs(listedMissing as unknown as TurnRevisionGcBucket, coordinator(), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000 }), /manifest/);
  assert.equal(missing.deletes.length, 0);

  const copied = new Bucket(); copied.add('turns/tenant-a/project-a/workspace-a/copied.json', manifest(F, S)); copied.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'orphan');
  await assert.rejects(sweepTurnRevisionBlobs(copied as unknown as TurnRevisionGcBucket, coordinator(copied), { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000 }), /manifest/);
  assert.equal(copied.deletes.length, 0);
});

test('GC rejects uncertain listing shape and never broadens its prefixes', async () => {
  const bucket = { async list() { return { objects: [{ key: 'turn-blobs/files/' + U }], truncated: false }; }, async get() { return null; }, async delete() { throw Error('must-not-delete'); } };
  await assert.rejects(sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, coordinator(), { scope,now: 10, minAgeMs: 1 }), /gc-list/);
});

test('GC requires an exclusive coordinator and releases it after success and failure', async () => {
  const bucket = new Bucket(); bucket.add(MANIFEST_KEY, manifest(F, S)); bucket.add(`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${U}`, 'orphan');
  let exclusive = false, released = false, calls = 0;
  const locked: TurnRevisionGcCoordinator = { runExclusive: async <T>(operation: () => Promise<T>) => { exclusive = true; try { return await operation(); } finally { exclusive = false; released = true; } } };
  const wrapped = { list: async (options: { prefix?: string; cursor?: string; limit?: number }) => { assert.equal(exclusive, true); calls++; return bucket.list(options); }, get: async (key: string) => { assert.equal(exclusive, true); return bucket.get(key); }, delete: async (key: string) => { assert.equal(exclusive, true); return bucket.delete(key); } };
  await sweepTurnRevisionBlobs(wrapped as unknown as TurnRevisionGcBucket, locked, { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000 });
  assert.equal(released, true); assert.ok(calls > 0); assert.equal(exclusive, false);

  released = false;
  const failing = { ...wrapped, get: async () => { assert.equal(exclusive, true); throw Error('injected-get-failure'); } };
  await assert.rejects(sweepTurnRevisionBlobs(failing as unknown as TurnRevisionGcBucket, locked, { scope,now: Date.parse('2026-09-07T00:00:00Z'), minAgeMs: 1_000 }), /injected-get-failure/);
  assert.equal(released, true); assert.equal(exclusive, false);
  await assert.rejects(sweepTurnRevisionBlobs(bucket as unknown as TurnRevisionGcBucket, null as unknown as TurnRevisionGcCoordinator, { scope,now: 1, minAgeMs: 1 }), /coordinator-required/);
});
