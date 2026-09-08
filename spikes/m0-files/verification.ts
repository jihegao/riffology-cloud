import { Buffer } from 'node:buffer';
import { sha256, type Entry } from '../m0-storage/checkpoint.ts';
import { EXPECTED_FINAL_FILES } from './runtime.ts';

type Row = Record<string, unknown>;
export function verifyRecreatedFilesystem(initial: unknown, recreated: unknown): void {
  const before = row(initial), after = row(recreated);
  for (const value of [before, after]) {
    if (!['root_absent', 'staging_absent', 'marker_absent'].every(key => value[key] === true) || typeof value.boot_id_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.boot_id_sha256)) throw new Error('invalid-boot-observation');
  }
  if (before.boot_id_sha256 === after.boot_id_sha256) throw new Error('runtime-boot-unchanged');
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-probe-record');
  return value as Row;
}
function same(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
function decodeBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 65536) throw new Error('invalid-fixture-base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('invalid-fixture-base64');
  return Uint8Array.from(bytes);
}
export function expectedEntries(): Entry[] {
  return [
    ...EXPECTED_FINAL_FILES.directories.map(item => ({ ...item, kind: 'directory' as const })),
    ...EXPECTED_FINAL_FILES.files.map(item => ({ path: item.path, mode: item.mode, kind: 'file' as const,
      bytes: 'content_utf8' in item ? new TextEncoder().encode(item.content_utf8) : decodeBase64(item.bytes_base64),
    })),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export async function treeFor(entries: Entry[]) {
  return Promise.all(entries.map(async entry => entry.kind === 'directory'
    ? { path: entry.path, kind: entry.kind, mode: entry.mode, size: 0 }
    : { path: entry.path, kind: entry.kind, mode: entry.mode, size: entry.bytes.byteLength, sha256: await sha256(entry.bytes) }));
}
function normalizeTree(value: unknown) {
  if (!Array.isArray(value) || value.length > 32) throw new Error('invalid-fixture-tree');
  return value.map(item => {
    const entry = row(item);
    return entry.kind === 'directory'
      ? { path: entry.path, kind: entry.kind, mode: entry.mode, size: entry.size }
      : { path: entry.path, kind: entry.kind, mode: entry.mode, size: entry.size, sha256: entry.sha256 };
  });
}
export async function verifyTree(value: unknown): Promise<void> {
  same(normalizeTree(value), await treeFor(expectedEntries()), 'fixture-tree-mismatch');
}

/** Recalculate the content hashes in the Worker; never trust reported hashes alone. */
export async function verifyExport(value: unknown): Promise<Entry[]> {
  const record = row(value);
  if (record.root_mode !== 0o755 || !Array.isArray(record.entries) || record.entries.length !== 12) throw new Error('invalid-fixture-export');
  const entries: Entry[] = record.entries.map(item => {
    const entry = row(item);
    if (typeof entry.path !== 'string' || typeof entry.mode !== 'number' || !['file', 'directory'].includes(String(entry.kind))) throw new Error('invalid-fixture-entry');
    return entry.kind === 'directory' ? { path: entry.path, kind: 'directory', mode: entry.mode }
      : { path: entry.path, kind: 'file', mode: entry.mode, bytes: decodeBase64(entry.bytes_base64) };
  });
  const actual = await treeFor(entries);
  same(actual, await treeFor(expectedEntries()), 'fixture-content-mismatch');
  same(normalizeTree(record.tree), actual, 'fixture-reported-hash-mismatch');
  if (record.entry_count !== entries.length || record.total_bytes !== entries.reduce((sum, entry) => sum + (entry.kind === 'file' ? entry.bytes.byteLength : 0), 0)) throw new Error('fixture-count-mismatch');
  return entries;
}

export async function verifyMutation(value: unknown): Promise<void> {
  const record = row(value);
  if (record.operation_count !== 20 || record.root_mode !== 0o755 || !Array.isArray(record.receipts) || record.receipts.length !== 20) throw new Error('invalid-operation-count');
  const counts: Record<string, number> = { create: 0, update: 0, rename: 0, delete: 0 };
  for (const [index, item] of record.receipts.entries()) {
    const receipt = row(item);
    if (receipt.index !== index + 1 || receipt.completed !== true || typeof receipt.operation !== 'string' || !Object.hasOwn(counts, receipt.operation)) throw new Error('invalid-operation-receipt');
    if (receipt.operation === 'rename' && receipt.source_absent !== true) throw new Error('unverified-rename');
    if (receipt.operation === 'delete' && receipt.absent !== true) throw new Error('unverified-delete');
    counts[receipt.operation]++;
  }
  same(counts, { create: 9, update: 6, rename: 3, delete: 2 }, 'operation-kinds-mismatch');
  same(record.deleted_paths, EXPECTED_FINAL_FILES.deleted_paths, 'deletion-list-mismatch');
  await verifyTree(record.tree);
}

export async function verifyRestoration(value: unknown): Promise<void> {
  const record = row(value), probe = row(record.write_probe);
  if (record.restored !== true || record.root_mode !== 0o755 || record.entry_count !== 12) throw new Error('invalid-restoration');
  if (!['completed', 'created', 'renamed', 'deleted'].every(key => probe[key] === true)) throw new Error('write-probe-incomplete');
  const bytes = new TextEncoder().encode('M0 restored filesystem is writable.\n');
  if (probe.mode !== 0o600 || probe.size !== bytes.byteLength || probe.sha256 !== await sha256(bytes)) throw new Error('write-probe-mismatch');
  await verifyTree(record.tree);
}

export function restoreDocument(entries: Entry[]): string {
  return JSON.stringify({ entries: entries.map(entry => entry.kind === 'directory' ? entry
    : { path: entry.path, kind: entry.kind, mode: entry.mode, bytes_base64: Buffer.from(entry.bytes).toString('base64') }) });
}
