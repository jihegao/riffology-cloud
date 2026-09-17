import {backendState as validateBackendState} from './backend-contract.ts';
import {validatePiRevisionState} from './revision.ts';
/** Conservative garbage collection for content addressed Turn Revision blobs.
 * This is deliberately separate from commit/restore: a failed or partial
 * sweep must never be able to affect manifests or objects outside the two
 * blob prefixes. */

import { positive, scope as turnScope, turnBaseCheckpoints, type TurnScope } from '../turn/protocol.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity } from './identity.ts';
import { turnRevisionBlobPrefix, turnRevisionManifestPrefix, turnRevisionObjectKey } from './revision.ts';

export type TurnRevisionGcBucket = Pick<R2Bucket, 'list' | 'get' | 'delete'>;
export type TurnRevisionGcOptions = {
  scope: TurnScope;
  now: number;
  minAgeMs: number;
  pageSize?: number;
  /** Maximum candidates processed by one RPC/alarm delivery, not by the sweep. */
  maxObjects?: number;
};
/** Each processed candidate can require one list, one read and one delete.
 * Paging normally makes the real total much smaller, but this is the strict
 * per-delivery R2 binding-call ceiling derived from maxObjects. */
export function turnRevisionGcMaxR2Calls(maxObjects:number):number {
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 10_000) fail('invalid-turn-revision-gc-limit');
  return maxObjects * 3 + 2;
}
export type TurnRevisionGcResult = {
  scannedManifests: number;
  scannedBlobs: number;
  deletedBlobs: number;
  retainedBlobs: number;
};
export type TurnRevisionGcResolution =
  | { status: 'completed'; result: TurnRevisionGcResult }
  | { status: 'yielded' }
  | { status: 'unknown' };

const BLOB = /^turn-blobs-v3\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/(files|sessions)\/([a-f0-9]{64})$/;
const SHA = /^[a-f0-9]{64}$/;

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
function key(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !BLOB.test(value)) fail('invalid-turn-revision-gc-manifest');
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
export async function readManifest(bucket: TurnRevisionGcBucket, objectKey: string,rawScope?:TurnScope): Promise<Set<string>> {
  const object = await bucket.get(objectKey);
  if (!object) fail('turn-revision-gc-manifest-missing');
  if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > 64 * 1024) fail('turn-revision-gc-manifest-too-large');
  let value: any;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await object.arrayBuffer()))); }
  catch { fail('invalid-turn-revision-gc-manifest'); }
  const managed=value?.schemaVersion===4&&value?.backendState?.backend==='managed-agents';
  exact(value, ['schemaVersion', ...(value.schemaVersion===4?['backendState']:[]), 'identity', 'base', 'outcome', 'executionErrorCode', 'files', managed?'sessionState':'piSession', 'committedAt']);
  if (value.schemaVersion !== 3 && value.schemaVersion !== 4 || !['completed', 'failed', 'cancelled', 'interrupted'].includes(value.outcome as string)
    || (value.outcome === 'completed' ? value.executionErrorCode !== null : (value.executionErrorCode !== null && typeof value.executionErrorCode !== 'string')))
    fail('invalid-turn-revision-gc-manifest');
  if(value.schemaVersion===4){if(managed)validateBackendState(value.backendState);else validatePiRevisionState(value.backendState);}
  const session=managed?value.sessionState:value.piSession;
  const identity = turnRuntimeIdentity(value.identity);
  if(managed){const state=validateBackendState(value.backendState);if(state.recovery!=='remote-reference'||!sameTurnRuntimeIdentity(state.identity,identity))fail('invalid-turn-revision-gc-manifest');}
  const scope=turnScope(rawScope??identity.scope),blobPrefix=turnRevisionBlobPrefix(scope);
  if (turnRevisionObjectKey(identity) !== objectKey || turnRevisionManifestPrefix(identity.scope)!==turnRevisionManifestPrefix(scope)) fail('invalid-turn-revision-gc-manifest');
  turnBaseCheckpoints(value.base); gcPositive(value.committedAt, 'invalid-turn-revision-gc-manifest');
  exact(value.files, ['objectKey', 'sha256', 'size']); exact(session, ['objectKey', 'sha256', 'size']);
  const filesKey = key(value.files.objectKey,blobPrefix), sessionsKey = key(session.objectKey,blobPrefix);
  if (filesKey !== `${blobPrefix}files/${hash(value.files.sha256)}`
    || sessionsKey !== `${blobPrefix}sessions/${hash(session.sha256)}`) fail('invalid-turn-revision-gc-manifest');
  const fileSize = gcPositive(value.files.size, 'invalid-turn-revision-gc-manifest'), sessionSize = gcPositive(session.size, 'invalid-turn-revision-gc-manifest');
  if (fileSize > 64 * 1024 * 1024 || sessionSize > 64 * 1024 * 1024 || fileSize + sessionSize > 64 * 1024 * 1024) fail('invalid-turn-revision-gc-manifest');
  return new Set([filesKey, sessionsKey]);
}
