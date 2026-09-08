import { R2Blobs, commitCheckpoint, currentCheckpoint } from './adapters.ts';
import { restoreCheckpoint, saveCheckpoint, sha256, type Authority, type Blobs, type Entry, type Receipt } from './checkpoint.ts';

export const STORAGE_FAULT_ACTIONS = ['init', 'upload-interrupt', 'precommit-crash', 'postcommit-crash', 'gc-mark', 'gc-sweep'] as const;
export type StorageFaultAction = typeof STORAGE_FAULT_ACTIONS[number];
export const GC_GRACE_MS = 3000;
export class StorageFaultConflict extends Error {}
const MAX_OBJECTS = 64;
const encoder = new TextEncoder();
const session = encoder.encode('fixed trusted synthetic T06 session; no user data');
const utf8 = (value: string) => encoder.encode(value);
type Stage = 'initializing' | 'initialized' | 'upload-interrupting' | 'upload-interrupted' | 'precommit-uploading' | 'precommit-aborted' | 'postcommit-uploading' | 'postcommit-aborted' | 'gc-marked' | 'gc-sweeping' | 'gc-swept' | 'failed';
type ObjectFact = { key: string; size: number; etag: string; version: string };
type RestoredFact = { receipt: Receipt; manifestSha256: string; files: Array<{ path: string; mode: number; sha256?: string }>; sessionSha256: string };
type UploadFact = { putInvoked: boolean; declaredBytes: number; consumedBytes: number; putRejected: boolean; objectAbsent: boolean };
type FaultFact = { kind: 'precommit' | 'postcommit'; instanceNonce: string; firedAt: number; candidate: string; receiptBefore: Receipt | null; receiptAfter: Receipt | null };
type State = {
  schemaVersion: 1; stage: Stage; startedAt: number; initialInstanceNonce: string;
  initial?: Receipt; upload?: UploadFact; precommit?: FaultFact; postcommit?: FaultFact;
  gc?: { markedAt: number; eligibleAt: number; candidates: ObjectFact[]; retained: string[]; events: Receipt[]; deleted?: string[]; after?: ObjectFact[]; restored?: RestoredFact[] };
  failure?: string;
};
export type FixedStreamFactory = (size: number) => { readable: ReadableStream; writable: WritableStream };
const defaultStream: FixedStreamFactory = size => new FixedLengthStream(size);
export class R2UploadFaultError extends Error {
  readonly fact: UploadFact;
  constructor(fact: UploadFact) { super('actual-stream-interruption-unproven'); this.fact = { ...fact }; }
}

function oneFile(path: string, body: string): Entry[] { return [{ path, kind: 'file', mode: 0o644, bytes: utf8(body) }]; }
function selectedEvents(storage: DurableObjectStorage, after = 0): Receipt[] {
  return Array.from(storage.kv.list<Receipt>({ prefix: 'events/', limit: 65 }), ([, value]) => value).filter(value => value.sequence > after);
}
function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function requireCondition(condition: unknown, reason: string): asserts condition { if (!condition) throw new Error(reason); }

/** A real R2 put consumes one chunk before the body is aborted. No pre-call throw substitutes for the fault. */
export async function interruptR2Put(bucket: R2Bucket, key: string, bytes: Uint8Array, streamFactory = defaultStream): Promise<UploadFact> {
  const fact: UploadFact = { putInvoked: false, declaredBytes: bytes.byteLength, consumedBytes: 0, putRejected: false, objectAbsent: false };
  requireCondition(bytes.byteLength > 65536, 'fault-body-too-small');
  const stream = streamFactory(bytes.byteLength);
  const writer = stream.writable.getWriter();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    // Attach rejection handling before producing the body, including immediate runtime validation failures.
    fact.putInvoked = true;
    const result = bucket.put(key, stream.readable, { onlyIf: { etagDoesNotMatch: '*' } }).then(() => false, () => true);
    try {
      await writer.write(bytes.slice(0, 65536));
      fact.consumedBytes = 65536;
      await writer.abort(new Error('T06-fixed-stream-interruption'));
    } catch {
      // An unsupported streaming binding fails this case; it cannot silently become a multipart success.
    }
    fact.putRejected = await result;
    fact.objectAbsent = await bucket.head(key) === null;
    requireCondition(fact.consumedBytes === 65536 && fact.putRejected && fact.objectAbsent, 'actual-stream-interruption-unproven');
    return fact;
  })();
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { deadline = setTimeout(() => { void writer.abort(new Error('T06-upload-deadline')).catch(() => {}); reject(new Error('actual-stream-interruption-timeout')); }, 12000); })]);
  } catch { throw new R2UploadFaultError(fact); }
  finally { if (deadline) clearTimeout(deadline); writer.releaseLock(); }
}

/** Fixed synthetic stages only; this is a G0 primitive probe, not a production workspace API. */
export class StorageFaultProbe {
  readonly ctx: DurableObjectState;
  readonly bucket: R2Bucket;
  readonly instanceNonce: string;
  readonly prefix: string;
  readonly streamFactory: FixedStreamFactory;
  readonly now: () => number;
  constructor(ctx: DurableObjectState, bucket: R2Bucket, instanceNonce: string, options: { streamFactory?: FixedStreamFactory; now?: () => number } = {}) {
    this.ctx = ctx; this.bucket = bucket; this.instanceNonce = instanceNonce;
    this.prefix = `m0-storage-faults/${ctx.id.toString()}/`;
    this.streamFactory = options.streamFactory ?? defaultStream; this.now = options.now ?? Date.now;
  }
  state() { return this.ctx.storage.kv.get<State>('fault-state'); }
  blobs() { return new R2Blobs(this.bucket, this.prefix.slice(0, -1)); }
  current() { return currentCheckpoint(this.ctx.storage); }
  events(after = 0) { return selectedEvents(this.ctx.storage, after); }
  async persist(state: State) { this.ctx.storage.kv.put('fault-state', state); await this.ctx.storage.sync(); }
  authority(): Authority { return { current: async () => this.current(), commit: input => commitCheckpoint(this.ctx.storage, input) }; }
  async inventory(): Promise<ObjectFact[]> {
    const out: ObjectFact[] = []; let cursor: string | undefined; const cursors = new Set<string>(); let pages = 0;
    do {
      requireCondition(++pages <= MAX_OBJECTS + 1, 'object-inventory-page-limit');
      const page = await this.bucket.list({ prefix: this.prefix, limit: MAX_OBJECTS + 1, ...(cursor ? { cursor } : {}) });
      for (const object of page.objects) {
        requireCondition(object.key.startsWith(this.prefix) && /^(blobs|manifests)\/[a-f0-9]{64}$/.test(object.key.slice(this.prefix.length)), 'unexpected-scoped-object');
        out.push({ key: object.key, size: object.size, etag: object.etag, version: object.version });
      }
      requireCondition(out.length <= MAX_OBJECTS, 'object-inventory-limit');
      cursor = page.truncated ? page.cursor : undefined;
      requireCondition(!page.truncated || typeof cursor === 'string' && cursor.length > 0, 'missing-r2-list-cursor');
      if (cursor) { requireCondition(!cursors.has(cursor), 'repeated-r2-list-cursor'); cursors.add(cursor); }
    } while (cursor);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
  async roots() {
    const events = this.events(); requireCondition(events.length > 0 && events.length < 65, 'event-count-invalid');
    requireCondition(events.every((event, index) => event.sequence === index + 1), 'event-sequence-invalid');
    requireCondition(equal(this.current(), events.at(-1)), 'current-event-mismatch');
    const retained = new Set<string>(); const restored: RestoredFact[] = [];
    for (const receipt of events) {
      const state = await restoreCheckpoint(this.blobs(), receipt.revision);
      retained.add(`${this.prefix}manifests/${receipt.revision}`);
      retained.add(`${this.prefix}blobs/${state.manifest.session.digest}`);
      for (const file of state.manifest.files) if (file.kind === 'file') retained.add(`${this.prefix}blobs/${file.digest}`);
      restored.push({ receipt, manifestSha256: receipt.revision, files: await Promise.all(state.entries.map(async file => ({ path: file.path, mode: file.mode, ...(file.kind === 'file' ? { sha256: await sha256(file.bytes) } : {}) }))), sessionSha256: await sha256(state.session) });
    }
    return { events, retained: [...retained].sort(), restored };
  }
  async status() {
    const state = this.state();
    return { schemaVersion: 1, protocol: 'm0-v1', probe: 'storage-faults', instanceNonce: this.instanceNonce, prefix: this.prefix, state: state ?? null, current: this.current(), events: this.events(), objects: await this.inventory(), restored: this.current() ? (await this.roots()).restored : [], gateStatus: 'needs-review', limits: ['synthetic checkpoint entries and trusted session', 'controlled DO instance abort; not regional storage failure', 'G0 primitives only; no production Turn, concurrent GC or product browser acceptance', 'streaming single-put failure must be observed; no automatic multipart substitution'] };
  }
  async action(action: StorageFaultAction) {
    let state = this.state();
    const expected: Record<StorageFaultAction, Stage | undefined> = { init: undefined, 'upload-interrupt': 'initialized', 'precommit-crash': 'upload-interrupted', 'postcommit-crash': 'precommit-aborted', 'gc-mark': 'postcommit-aborted', 'gc-sweep': 'gc-marked' };
    if (action === 'gc-sweep' && state?.stage === 'gc-swept') return { ...(await this.status()), alreadyComplete: true, deletedNow: [] };
    if (state?.stage !== expected[action]) throw new StorageFaultConflict('phase-conflict-no-action-replayed');
    if (action === 'init') {
      requireCondition(this.current() === null && this.events().length === 0, 'fault-run-not-empty');
      state = { schemaVersion: 1, stage: 'initializing', startedAt: this.now(), initialInstanceNonce: this.instanceNonce };
      await this.persist(state);
      state.initial = await saveCheckpoint({ entries: oneFile('baseline.txt', 'committed A'), session, generation: 1, parent: null, blobs: this.blobs(), authority: this.authority() });
      state.stage = 'initialized'; await this.persist(state); return this.status();
    }
    requireCondition(state?.initial, 'missing-initial-receipt');
    if (action === 'upload-interrupt') {
      state.stage = 'upload-interrupting'; await this.persist(state);
      const body = new Uint8Array(256 * 1024).fill(85);
      const interruptedKey = `blobs/${await sha256(body)}`;
      const base = this.blobs(); let upload: UploadFact | undefined;
      const interrupted: Blobs = { get: key => base.get(key), putIfAbsent: async (key, bytes) => {
        if (key !== interruptedKey) { await base.putIfAbsent(key, bytes); return; }
        upload = await interruptR2Put(this.bucket, `${this.prefix}${key}`, bytes, this.streamFactory);
        throw new Error('T06-upload-interrupted');
      } };
      try {
        await saveCheckpoint({ entries: [...oneFile('orphan-first.txt', 'uncommitted upload orphan'), { path: 'upload-body.bin', kind: 'file', mode: 0o600, bytes: body }], session, generation: 1, parent: state.initial.revision, blobs: interrupted, authority: this.authority() });
        throw new Error('interrupted-upload-committed');
      } catch (error) {
        if (!(error instanceof Error && error.message === 'T06-upload-interrupted' && upload)) { state.stage = 'failed'; state.failure = 'actual-stream-interruption-unproven'; if (error instanceof R2UploadFaultError) state.upload = error.fact; await this.persist(state); throw error; }
      }
      requireCondition(equal(this.current(), state.initial) && this.events().length === 1, 'upload-mutated-authority');
      state.upload = upload; state.stage = 'upload-interrupted'; await this.persist(state); return this.status();
    }
    if (action === 'precommit-crash' || action === 'postcommit-crash') {
      const kind = action === 'precommit-crash' ? 'precommit' : 'postcommit';
      if (kind === 'postcommit') requireCondition(state.precommit?.instanceNonce !== this.instanceNonce, 'precommit-instance-did-not-restart');
      state.stage = kind === 'precommit' ? 'precommit-uploading' : 'postcommit-uploading'; await this.persist(state);
      const authority: Authority = { current: async () => this.current(), commit: async input => {
        await restoreCheckpoint(this.blobs(), input.revision); // Fault occurs only after every real R2 object verifies.
        const before = this.current();
        if (kind === 'postcommit') await commitCheckpoint(this.ctx.storage, input);
        const fault: FaultFact = { kind, instanceNonce: this.instanceNonce, firedAt: this.now(), candidate: input.revision, receiptBefore: before, receiptAfter: this.current() };
        state![kind] = fault; state!.stage = kind === 'precommit' ? 'precommit-aborted' : 'postcommit-aborted';
        await this.persist(state!); // Persist one-shot marker before the deliberate instance abort.
        this.ctx.abort(`T06-${kind}-fault`, { retryAlarm: false });
        throw new Error('DO-abort-did-not-end-invocation');
      } };
      await saveCheckpoint({ entries: oneFile(kind === 'precommit' ? 'orphan-precommit.txt' : 'committed-after-crash.txt', kind === 'precommit' ? 'uncommitted B' : 'committed C'), session, generation: 1, parent: state.initial.revision, blobs: this.blobs(), authority });
      throw new Error('fault-did-not-interrupt');
    }
    if (action === 'gc-mark') {
      requireCondition(state.postcommit?.instanceNonce !== this.instanceNonce, 'postcommit-instance-did-not-restart');
      const roots = await this.roots(); const objects = await this.inventory();
      const candidates = objects.filter(object => !roots.retained.includes(object.key));
      requireCondition(candidates.length >= 3 && roots.events.length === 2, 'orphan-fixture-or-commits-missing');
      const markedAt = this.now();
      state.gc = { markedAt, eligibleAt: markedAt + GC_GRACE_MS, candidates, retained: roots.retained, events: roots.events };
      state.stage = 'gc-marked'; await this.persist(state); return this.status();
    }
    requireCondition(action === 'gc-sweep' && state.gc, 'gc-mark-required');
    if (this.now() < state.gc.eligibleAt) throw new StorageFaultConflict('gc-grace-not-elapsed');
    const roots = await this.roots();
    requireCondition(equal(roots.events, state.gc.events) && equal(roots.retained, state.gc.retained), 'gc-reference-set-changed');
    const objects = await this.inventory();
    for (const object of state.gc.candidates) {
      requireCondition(!roots.retained.includes(object.key) && equal(objects.find(item => item.key === object.key), object), 'gc-object-or-reference-changed');
    }
    // All writes are sealed by the persisted stage; deletion is restricted to exact twice-checked keys.
    state.stage = 'gc-sweeping'; await this.persist(state);
    const deleted = state.gc.candidates.map(object => object.key);
    for (const key of deleted) { requireCondition(key.startsWith(this.prefix), 'gc-prefix-violation'); await this.bucket.delete(key); }
    const after = await this.inventory(); const recovered = await this.roots();
    requireCondition(deleted.every(key => !after.some(object => object.key === key)), 'gc-delete-not-observed');
    requireCondition(equal(recovered, roots) && after.every(object => roots.retained.includes(object.key)), 'gc-damaged-retained-or-left-orphans');
    state.gc.deleted = deleted; state.gc.after = after; state.gc.restored = recovered.restored;
    state.stage = 'gc-swept'; await this.persist(state); return { ...(await this.status()), alreadyComplete: false, deletedNow: deleted };
  }
}

export function parseStorageFaultRoute(request: Request): { runId: string; action: StorageFaultAction | 'status' | 'events'; cursor: number } | null {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/probe\/([a-z0-9][a-z0-9-]{7,47})\/faults\/(init|upload-interrupt|precommit-crash|postcommit-crash|gc-mark|gc-sweep|status|events)$/);
  if (!match || url.search) return null;
  const action = match[2] as StorageFaultAction | 'status' | 'events';
  if (request.method !== (action === 'status' || action === 'events' ? 'GET' : 'POST')) return null;
  const rawCursor = request.headers.get('last-event-id') ?? '0';
  if (!/^(0|[1-9][0-9]{0,7})$/.test(rawCursor) || action !== 'events' && request.headers.has('last-event-id')) return null;
  return { runId: match[1]!, action, cursor: Number(rawCursor) };
}

/** Incoming cloud POSTs may carry a zero-byte stream. Inspect bytes, never trust Content-Length. */
export async function hasEmptyStorageFaultBody(request: Request, timeoutMs = 1500): Promise<boolean> {
  if (!request.body) return true;
  const reader = request.body.getReader(); const deadlineAt = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('probe-body-timeout')), timeoutMs); });
  try {
    for (let reads = 0; reads < 16; reads++) {
      if (Date.now() >= deadlineAt) return false;
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) return true;
      if (part.value.byteLength !== 0) return false;
    }
    return false;
  } catch { return false; }
  finally {
    if (timer) clearTimeout(timer);
    // A hostile body's cancel callback must not extend the read deadline.
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}

/** Snapshot plus bounded live polling; observer cancellation never owns a checkpoint action. */
export function storageEventStream(read: (after: number) => Receipt[], after: number): Response {
  const initial = read(0); const high = initial.at(-1)?.sequence ?? 0;
  if (after > high) return Response.json({ error: 'cursor-ahead' }, { status: 409 });
  let timer: ReturnType<typeof setInterval> | undefined; let closeTimer: ReturnType<typeof setTimeout> | undefined; let cursor = after;
  const stop = () => { if (timer) clearInterval(timer); if (closeTimer) clearTimeout(closeTimer); };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => {
        try { for (const event of read(cursor)) { controller.enqueue(utf8(`id: ${event.sequence}\nevent: saved\ndata: ${JSON.stringify(event)}\n\n`)); cursor = event.sequence; } }
        catch { stop(); controller.error(new Error('event-observation-interrupted')); }
      };
      push(); controller.enqueue(utf8(`event: caught-up\ndata: ${JSON.stringify({ highWatermark: cursor })}\n\n`));
      timer = setInterval(push, 500); closeTimer = setTimeout(() => { stop(); controller.close(); }, 10000);
    },
    cancel() { stop(); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
