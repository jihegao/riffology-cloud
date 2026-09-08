/** M0 persistence primitive. Production wiring and cloud fault tests remain G0 gates. */
export type FileEntry = { path: string; kind: 'file'; mode: number; bytes: Uint8Array };
export type DirectoryEntry = { path: string; kind: 'directory'; mode: number };
export type Entry = FileEntry | DirectoryEntry;
export type Manifest = {
  schema_version: 1;
  generation: number;
  parent: string | null;
  files: Array<{ path: string; kind: 'file' | 'directory'; mode: number; digest?: string; size?: number }>;
  session: { digest: string; size: number };
};
export type Receipt = { revision: string; sequence: number; generation: number };
export interface Blobs {
  putIfAbsent(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}
export interface Authority {
  /** Must atomically compare generation and parent, then commit receipt + durable event. */
  commit(input: { revision: string; parent: string | null; generation: number }): Promise<Receipt>;
  current(): Promise<Receipt | null>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const digestPattern = /^[a-f0-9]{64}$/;

export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('');
}
function pathAllowed(path: string): boolean {
  return typeof path === 'string' && path.length <= 512 && path.normalize('NFC') === path
    && !/[\\\u0000-\u001f\u007f]/.test(path) && path.split('/').every(p => p !== '' && p !== '.' && p !== '..');
}
function validateEntries(entries: Array<{ path: string; kind: string; mode: number }>): void {
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error('invalid file count');
  const paths = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || !pathAllowed(entry.path) || !['file', 'directory'].includes(entry.kind)) throw new Error('invalid path or entry kind');
    if (!Number.isInteger(entry.mode) || ![0o600, 0o644, 0o700, 0o755].includes(entry.mode)) throw new Error('unsupported permissions');
    if (paths.has(entry.path)) throw new Error('duplicate path');
    paths.set(entry.path, entry.kind);
  }
  for (const path of paths.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (paths.get(parts.slice(0, i).join('/')) !== 'directory') throw new Error('missing directory or file ancestor');
    }
  }
}
function validateHeader(generation: number, parent: string | null): void {
  if (!Number.isSafeInteger(generation) || generation < 1 || (parent !== null && !digestPattern.test(parent))) throw new Error('invalid generation or parent');
}
function blobKey(digest: string): string {
  if (!digestPattern.test(digest)) throw new Error('invalid digest');
  return `blobs/${digest}`;
}
async function verifiedGet(blobs: Blobs, key: string, digest: string): Promise<Uint8Array> {
  const bytes = await blobs.get(key);
  if (!bytes || await sha256(bytes) !== digest) throw new Error('missing or corrupt checkpoint object');
  return bytes;
}
async function upload(blobs: Blobs, bytes: Uint8Array): Promise<string> {
  const digest = await sha256(bytes);
  const key = blobKey(digest);
  await blobs.putIfAbsent(key, bytes);
  await verifiedGet(blobs, key, digest);
  return digest;
}

export async function saveCheckpoint(input: {
  entries: Entry[];
  /** Bytes must come from the trusted Pi host, never the project VM. */
  session: Uint8Array;
  generation: number;
  parent: string | null;
  blobs: Blobs;
  authority: Authority;
}): Promise<Receipt> {
  const { generation, parent, blobs, authority } = input;
  validateHeader(generation, parent);
  validateEntries(input.entries);
  // Copy all bytes before the first await; mutation during uploads cannot change the saved tree.
  const session = Uint8Array.from(input.session);
  const entries = input.entries.map(e => e.kind === 'file' ? { ...e, bytes: Uint8Array.from(e.bytes) } : { ...e });
  const total = entries.reduce((sum, e) => sum + (e.kind === 'file' ? e.bytes.byteLength : 0), session.byteLength);
  if (total > 32 * 1024 * 1024) throw new Error('M0 checkpoint size limit exceeded');
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const files: Manifest['files'] = [];
  for (const entry of entries) {
    files.push(entry.kind === 'directory'
      ? { path: entry.path, kind: entry.kind, mode: entry.mode }
      : { path: entry.path, kind: entry.kind, mode: entry.mode, digest: await upload(blobs, entry.bytes), size: entry.bytes.byteLength });
  }
  const manifest: Manifest = { schema_version: 1, generation, parent, files, session: { digest: await upload(blobs, session), size: session.byteLength } };
  const bytes = encoder.encode(JSON.stringify(manifest));
  const revision = await sha256(bytes);
  const key = `manifests/${revision}`;
  await blobs.putIfAbsent(key, bytes);
  await verifiedGet(blobs, key, revision);
  // The durable commit owns the saved state. Blob upload alone is never an acknowledgement.
  return authority.commit({ revision, generation, parent });
}

export async function restoreCheckpoint(blobs: Blobs, revision: string): Promise<{ manifest: Manifest; entries: Entry[]; session: Uint8Array }> {
  if (!digestPattern.test(revision)) throw new Error('invalid revision');
  const bytes = await verifiedGet(blobs, `manifests/${revision}`, revision);
  if (bytes.byteLength > 1024 * 1024) throw new Error('manifest too large');
  const manifest = JSON.parse(decoder.decode(bytes)) as Manifest;
  if (!manifest || manifest.schema_version !== 1) throw new Error('unsupported checkpoint format');
  validateHeader(manifest.generation, manifest.parent);
  validateEntries(manifest.files);
  if (!manifest.session || !Number.isSafeInteger(manifest.session.size) || manifest.session.size < 0) throw new Error('invalid session metadata');
  let total = manifest.session.size;
  for (const file of manifest.files) {
    if (file.kind === 'file') {
      if (!Number.isSafeInteger(file.size) || file.size! < 0 || !digestPattern.test(file.digest ?? '')) throw new Error('invalid file metadata');
      total += file.size!;
    } else if (file.digest !== undefined || file.size !== undefined) throw new Error('invalid directory metadata');
  }
  if (total > 32 * 1024 * 1024) throw new Error('M0 checkpoint size limit exceeded');
  const session = await verifiedGet(blobs, blobKey(manifest.session.digest), manifest.session.digest);
  if (session.byteLength !== manifest.session.size) throw new Error('session size mismatch');
  const entries: Entry[] = [];
  for (const file of manifest.files) {
    if (file.kind === 'directory') entries.push({ path: file.path, kind: file.kind, mode: file.mode });
    else {
      const content = await verifiedGet(blobs, blobKey(file.digest!), file.digest!);
      if (content.byteLength !== file.size) throw new Error('file size mismatch');
      entries.push({ path: file.path, kind: file.kind, mode: file.mode, bytes: content });
    }
  }
  // Caller must restore this validated tree to a fresh directory, then atomically switch it.
  // Session is returned separately for the trusted host; it must never enter /workspace.
  return { manifest, entries, session };
}
