/** Conservative garbage collection for content addressed Turn Revision blobs.
 * This is deliberately separate from commit/restore: a failed or partial
 * sweep must never be able to affect manifests or objects outside the two
 * blob prefixes. */

import { positive, turnBaseCheckpoints } from '../turn/protocol.ts';
import { turnRuntimeIdentity } from './identity.ts';
import { turnRevisionObjectKey } from './revision.ts';

export type TurnRevisionGcBucket = Pick<R2Bucket, 'list' | 'get' | 'delete'>;
/** The writer and GC must share this durable lease/coordinator. A lease
 * implementation must refuse writer commits while its lease is held. */
export type TurnRevisionGcCoordinator = { runExclusive<T>(operation: () => Promise<T>): Promise<T> };
export type TurnRevisionGcOptions = {
  now: number;
  minAgeMs: number;
  pageSize?: number;
  maxObjects?: number;
};
export type TurnRevisionGcResult = {
  scannedManifests: number;
  scannedBlobs: number;
  deletedBlobs: number;
  retainedBlobs: number;
};

const BLOB = /^turn-blobs\/(files|sessions)\/([a-f0-9]{64})$/;
const MANIFEST = /^turns\/.+\.json$/;
const SHA = /^[a-f0-9]{64}$/;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_OBJECTS = 500;

function fail(code: string): never { throw Error(code); }
function gcPositive(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code);
  return value as number;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !SHA.test(value)) fail('invalid-turn-revision-gc-manifest');
  return value;
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('invalid-turn-revision-gc-manifest');
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !BLOB.test(value)) fail('invalid-turn-revision-gc-manifest');
  return value;
}
export function listed(value: unknown): { key: string; uploaded: Date } {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof (value as { key?: unknown }).key !== 'string'
    || !((value as { uploaded?: unknown }).uploaded instanceof Date)
    || Number.isNaN(((value as { uploaded: Date }).uploaded).getTime())) {
    fail('invalid-turn-revision-gc-list');
  }
  return { key: (value as { key: string }).key, uploaded: (value as { uploaded: Date }).uploaded };
}
function page(value: unknown): { objects: unknown[]; truncated: boolean; cursor: string | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as any).objects)
    || typeof (value as any).truncated !== 'boolean'
    || ((value as any).truncated && (typeof (value as any).cursor !== 'string' || !(value as any).cursor))) {
    fail('invalid-turn-revision-gc-list');
  }
  return { objects: (value as any).objects, truncated: (value as any).truncated, cursor: (value as any).cursor };
}
export async function readManifest(bucket: TurnRevisionGcBucket, objectKey: string): Promise<Set<string>> {
  const object = await bucket.get(objectKey);
  if (!object) fail('turn-revision-gc-manifest-missing');
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > 64 * 1024) fail('turn-revision-gc-manifest-too-large');
  let value: any;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await object.arrayBuffer()))); }
  catch { fail('invalid-turn-revision-gc-manifest'); }
  exact(value, ['schemaVersion', 'identity', 'base', 'outcome', 'executionErrorCode', 'files', 'piSession', 'committedAt']);
  if (value.schemaVersion !== 2 || !['completed', 'failed', 'cancelled', 'interrupted'].includes(value.outcome as string)
    || (value.outcome === 'completed' ? value.executionErrorCode !== null : (value.executionErrorCode !== null && typeof value.executionErrorCode !== 'string')))
    fail('invalid-turn-revision-gc-manifest');
  const identity = turnRuntimeIdentity(value.identity);
  if (turnRevisionObjectKey(identity) !== objectKey) fail('invalid-turn-revision-gc-manifest');
  turnBaseCheckpoints(value.base); gcPositive(value.committedAt, 'invalid-turn-revision-gc-manifest');
  exact(value.files, ['objectKey', 'sha256', 'size']); exact(value.piSession, ['objectKey', 'sha256', 'size']);
  const filesKey = key(value.files.objectKey), sessionsKey = key(value.piSession.objectKey);
  if (filesKey !== `turn-blobs/files/${hash(value.files.sha256)}`
    || sessionsKey !== `turn-blobs/sessions/${hash(value.piSession.sha256)}`) fail('invalid-turn-revision-gc-manifest');
  const fileSize = gcPositive(value.files.size, 'invalid-turn-revision-gc-manifest'), sessionSize = gcPositive(value.piSession.size, 'invalid-turn-revision-gc-manifest');
  if (fileSize > 64 * 1024 * 1024 || sessionSize > 64 * 1024 * 1024 || fileSize + sessionSize > 64 * 1024 * 1024) fail('invalid-turn-revision-gc-manifest');
  return new Set([filesKey, sessionsKey]);
}

/** Lists all Turn manifests to build a complete reference set, then deletes
 * only old, unreferenced files/session blobs. Any malformed or uncertain read
 * aborts before the first delete. A limit failure deletes nothing; larger
 * buckets require a future persisted-cursor coordinator. */
export async function sweepTurnRevisionBlobs(bucket: TurnRevisionGcBucket, coordinator: TurnRevisionGcCoordinator, options: TurnRevisionGcOptions): Promise<TurnRevisionGcResult> {
  if (!bucket?.list || !bucket.get || !bucket.delete) fail('turn-revision-gc-bucket-required');
  if (!coordinator?.runExclusive) fail('turn-revision-gc-coordinator-required');
  return coordinator.runExclusive(async () => {
    const now = gcPositive(options.now, 'invalid-turn-revision-gc-time');
    const minAgeMs = gcPositive(options.minAgeMs, 'invalid-turn-revision-gc-age');
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE, maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 10_000) fail('invalid-turn-revision-gc-limit');
    const referenced = new Set<string>(); let cursor: string | undefined; let scannedManifests = 0;
    do {
      const current = page(await bucket.list({ prefix: 'turns/', cursor, limit: pageSize }));
      for (const raw of current.objects) {
        const item = listed(raw);
        if (!MANIFEST.test(item.key)) continue;
        if (++scannedManifests > maxObjects) fail('turn-revision-gc-limit');
        for (const blob of await readManifest(bucket, item.key)) referenced.add(blob);
      }
      cursor = current.truncated ? current.cursor : undefined;
    } while (cursor);

    let scannedBlobs = 0, deletedBlobs = 0, retainedBlobs = 0; cursor = undefined;
    const candidates: string[] = [];
    do {
      const current = page(await bucket.list({ prefix: 'turn-blobs/', cursor, limit: pageSize }));
      for (const raw of current.objects) {
        const item = listed(raw); if (!BLOB.test(item.key)) continue;
        if (scannedBlobs >= maxObjects) fail('turn-revision-gc-limit');
        scannedBlobs++;
        if (referenced.has(item.key) || now - item.uploaded.getTime() < minAgeMs) { retainedBlobs++; continue; }
        candidates.push(item.key);
      }
      cursor = current.truncated ? current.cursor : undefined;
    } while (cursor);
    // Deleting only after the complete listing avoids changing pagination while
    // a provider is enumerating the bucket. A delete error is surfaced; callers
    // can retry safely because content addressed keys are immutable.
    for (const blob of candidates) {
      await bucket.delete(blob); deletedBlobs++;
    }
    return { scannedManifests, scannedBlobs, deletedBlobs, retainedBlobs };
  });
}
