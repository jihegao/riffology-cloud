import { leaseReference, quotaIdentifier, type Acquisition, type Lease, type LeaseRequest } from '../quota/core.ts';
import { canonicalWorkspaceMarker, validateWorkspaceTask, workspaceDigest, WORKSPACE_LAYOUT,
  type RuntimeIdentity, type RuntimeObservation, type RuntimePort, type RuntimeReadyReceipt, type RuntimeStopReceipt,
  type WorkspaceCatalogPort, type WorkspaceProjection, type WorkspaceQuotaPort, type WorkspaceReason, type WorkspaceTask } from './protocol.ts';
import type { WorkspaceStore } from './store.ts';
import { MODEL_CONTENT_MAX_BYTES, MODEL_CONTENT_MAX_FILES } from '../runtime/content.ts';

type EffectKind = 'authority' | 'acquire' | 'lookup' | 'dispatch' | 'initialize' | 'observe' | 'stop' | 'release' | 'project';
export type WorkspaceState = {
  schemaVersion: 1; task: WorkspaceTask; runtimeId: string; markerNonce: string; markerSha256: string | null;
  identity: RuntimeIdentity | null; phase: 'pending' | 'initializing' | 'runtime_ready' | 'stopping' | 'stopped' | 'unknown';
  lease: Lease | null; quotaReleased: boolean; acquisitionDenied: boolean;
  acquireAttempts: number; releaseAttempts: number;
  intents: { acquire: boolean; dispatch: boolean; initialize: boolean; stop: boolean; release: boolean };
  dispatchOwner: string | null; runtimeReceipt: RuntimeReadyReceipt | null; stopReceipt: RuntimeStopReceipt | null;
  target: 'failed' | 'stopped' | null; reasonCode: WorkspaceReason | null;
  effect: { id: string; kind: EffectKind; owner: string; deadlineAt: number } | null;
  calls: number; windowEndsAt: number; wakeAt: number | null;
  projection: WorkspaceProjection | null; projectionConfirmed: boolean; projectionAttempts: number; sequence: number;
};
export type WorkspacePorts = {
  beforeStart?(task:WorkspaceTask):Promise<void>;
  catalog: WorkspaceCatalogPort; quota: WorkspaceQuotaPort; runtime(identity: RuntimeIdentity): RuntimePort;
  /** Hold the actual RPC, including after the local wait times out. */
  hold(promise: Promise<unknown>): void;
};
export type WorkspaceTiming = { rpcMs: number; pollMs: number; cleanupMs: number; maxCalls: number };
const TIMING: WorkspaceTiming = { rpcMs: 10_000, pollMs: 2_000, cleanupMs: 60_000, maxCalls: 128 };
type Result<T> = { known: true; value: T } | { known: false };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
function validModelContentReceipt(task:WorkspaceTask,value:unknown):boolean{
  const expected=task.modelContent;
  if(!expected)return value===undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const receipt=value as Record<string,unknown>,keys=['modelVersionId','modelId','version','contentRef','contentSha256','namespace','bytes','verifiedSha256','fileCount','contentBytes'];
  if(Object.keys(receipt).length!==keys.length||keys.some(key=>!Object.hasOwn(receipt,key)))return false;
  if(!['modelVersionId','modelId','version','contentRef','contentSha256'].every(key=>receipt[key]===expected[key as keyof typeof expected]))return false;
  return receipt.namespace==='model-content'&&hash(receipt.verifiedSha256)&&receipt.verifiedSha256===expected.contentSha256&&
    integer(receipt.bytes)&&receipt.bytes<=MODEL_CONTENT_MAX_BYTES&&integer(receipt.fileCount)&&receipt.fileCount<=MODEL_CONTENT_MAX_FILES&&
    Number.isSafeInteger(receipt.contentBytes)&&(receipt.contentBytes as number)>=0&&(receipt.contentBytes as number)<=MODEL_CONTENT_MAX_BYTES&&(receipt.contentBytes as number)<=receipt.bytes;
}
function request(task: WorkspaceTask): LeaseRequest {
  return { tenantId: task.tenantId, projectId: task.projectId, workspaceId: task.workspaceId, generation: task.generation,
    operation: 'workspace-runtime', operationId: task.id, deadlineAt: task.deadlineAt };
}

/** One immutable M1 task per workspace actor. This core owns no network or
 * identity provider. Its ports must be private, server-selected bindings. */
export class WorkspaceCoordinator {
  #store: WorkspaceStore; #ports: WorkspacePorts; #clock: () => number; #timing: WorkspaceTiming;
  #owner = crypto.randomUUID(); #tick: Promise<void> | null = null;
  constructor(store: WorkspaceStore, ports: WorkspacePorts, clock = Date.now, timing: Partial<WorkspaceTiming> = {}) {
    this.#store = store; this.#ports = ports; this.#clock = clock; this.#timing = { ...TIMING, ...timing };
    for (const v of Object.values(this.#timing)) if (!integer(v)) throw Error('invalid-workspace-timing');
  }
  report(): WorkspaceState | null { return this.#store.read(); }
  #same(task: WorkspaceTask, state: WorkspaceState): void {
    if (!equal(task, state.task)) throw Error('workspace-task-conflict');
  }
  async accept(input: WorkspaceTask): Promise<WorkspaceState> {
    const task = validateWorkspaceTask(input), existing = this.#store.read();
    if (existing) { this.#same(task, existing); return existing.wakeAt === null ? this.reconcile(task) : existing; }
    const known = await this.#wait(this.#ports.catalog.taskKnown(task), this.#timing.rpcMs);
    if (!known.known || known.value !== true) throw Error('workspace-task-not-known');
    const now = this.#clock();
    // D1 claim supplies a fixed 180 s deadline. Reject invented future leases;
    // authentic old tasks remain admissible so their failure can be projected.
    if (task.deadlineAt - now > 180_000 || task.createdAt > now) throw Error('invalid-workspace-deadline');
    return this.#store.update(current => {
      if (current) { this.#same(task, current); return current; }
      return { schemaVersion: 1, task, runtimeId: crypto.randomUUID(), markerNonce: crypto.randomUUID(), markerSha256: null,
        identity: null, phase: 'pending', lease: null, quotaReleased: false, acquisitionDenied: false, acquireAttempts: 0, releaseAttempts: 0,
        intents: { acquire: false, dispatch: false, initialize: false, stop: false, release: false }, dispatchOwner: null,
        runtimeReceipt: null, stopReceipt: null, target: task.deadlineAt <= now ? 'failed' : null,
        reasonCode: task.deadlineAt <= now ? 'deadline' : null, effect: null, calls: 0,
        windowEndsAt: Math.max(now, task.deadlineAt) + this.#timing.cleanupMs, wakeAt: now + 1,
        projection: null, projectionConfirmed: false, projectionAttempts: 0, sequence: 0 };
    });
  }
  /** Persist cancellation independently of any in-flight RPC. No new task,
   * generation, lease or runtime can be selected by this operation. */
  async stop(input: WorkspaceTask): Promise<WorkspaceState> {
    const task = validateWorkspaceTask(input);
    return this.#store.update(state => {
      if (!state) throw Error('workspace-task-not-accepted'); this.#same(task, state);
      if (state.projection?.outcome !== 'unknown' && state.projection !== null) return state;
      state.target = 'stopped'; state.reasonCode = 'stop-requested'; state.wakeAt = this.#clock() + 1;
      state.windowEndsAt = Math.max(state.windowEndsAt, this.#clock() + this.#timing.cleanupMs); return state;
    });
  }
  /** Explicit bounded reconciliation can improve an unknown receipt. It never
   * clears dispatch/initialize/stop intents or creates another runtime. */
  async reconcile(input: WorkspaceTask): Promise<WorkspaceState> {
    const task = validateWorkspaceTask(input);
    return this.#store.update(state => {
      if (!state) throw Error('workspace-task-not-accepted'); this.#same(task, state);
      if (state.projection && state.projection.outcome !== 'unknown' && state.projectionConfirmed) return state;
      if (state.wakeAt !== null) return state;
      state.calls = 0; state.projectionAttempts = 0; state.windowEndsAt = this.#clock() + this.#timing.cleanupMs;
      state.wakeAt = this.#clock() + 1; return state;
    });
  }
  async alarm(): Promise<void> {
    if (this.#tick) return this.#tick;
    this.#tick = this.#advance().finally(() => { this.#tick = null; }); return this.#tick;
  }
  async #mutate(fn: (state: WorkspaceState) => void): Promise<WorkspaceState> {
    return this.#store.update(state => { if (!state) throw Error('workspace-task-not-accepted'); fn(state); return state; });
  }
  async #wait<T>(actual: Promise<T>, ms: number): Promise<Result<T>> {
    const observed = actual.then(value => ({ known: true as const, value }), () => ({ known: false as const }));
    this.#ports.hold(observed);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([observed, new Promise<{ known: false }>(resolve => { timer = setTimeout(() => resolve({ known: false }), Math.max(1, ms)); })]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async #effect<T>(kind: EffectKind, invoke: () => Promise<T>, before?: (s: WorkspaceState) => void,
    guard?: (s: WorkspaceState) => boolean): Promise<Result<T>> {
    const id = crypto.randomUUID(), now = this.#clock(), priorAcquireIntent = this.#store.read()?.intents.acquire ?? false;
    await this.#mutate(s => {
      before?.(s); s.calls++; s.effect = { id, kind, owner: this.#owner, deadlineAt: now + this.#timing.rpcMs };
      s.wakeAt = now + this.#timing.rpcMs + 1;
    });
    const current = this.#store.read()!;
    // No await/microtask between this durable fence/deadline check and invoke.
    let result: Result<T> = { known: false };
    if (current.effect?.id === id && (!guard || guard(current))) {
      try { result = await this.#wait(invoke(), this.#timing.rpcMs); } catch { /* synchronous transport failure is unknown */ }
    } else if (kind === 'acquire') {
      // This invocation definitely never crossed the call boundary. Unlike an
      // unknown RPC result, its pre-call cancellation can safely undo the intent.
      await this.#mutate(s => { s.intents.acquire = priorAcquireIntent; s.target ??= 'failed'; s.reasonCode ??= 'deadline'; });
    }
    await this.#mutate(s => {
      if (s.effect?.id === id) s.effect = null;
      s.wakeAt = this.#clock() + this.#timing.pollMs;
    });
    return result;
  }
  #lease(value: Lease, state: WorkspaceState): Lease {
    if (!value || !equal(request(state.task), (() => { const { leaseId: _, ...r } = leaseReference(value); return r; })())) throw Error('quota-receipt-scope-denied');
    quotaIdentifier(value.leaseId);
    if (state.lease && state.lease.leaseId !== value.leaseId) throw Error('quota-receipt-lease-conflict');
    if (!['held', 'dispatched', 'unknown', 'stopped'].includes(value.status) || !integer(value.acquiredAt) || value.acquiredAt > this.#clock()) throw Error('invalid-quota-receipt');
    return structuredClone(value);
  }
  async #acquisition(value: Acquisition): Promise<void> {
    const state = this.#store.read()!;
    if (!value || !['acquired', 'denied', 'replayed'].includes(value.outcome)) throw Error('invalid-acquisition-receipt');
    if (value.lease === null) {
      if (!['quota-exhausted', 'workspace-held'].includes(value.denial ?? '')) throw Error('invalid-acquisition-receipt');
      await this.#mutate(s => { s.acquisitionDenied = true; s.quotaReleased = true; s.target ??= 'failed'; s.reasonCode ??= 'quota-denied'; }); return;
    }
    if (value.denial !== null) throw Error('invalid-acquisition-receipt');
    const lease = this.#lease(value.lease, state), identity: RuntimeIdentity = {
      taskId: state.task.id, tenantId: state.task.tenantId, projectId: state.task.projectId, workspaceId: state.task.workspaceId,
      generation: state.task.generation, runtimeId: state.runtimeId, leaseId: lease.leaseId };
    const markerSha256 = await workspaceDigest(canonicalWorkspaceMarker(identity, state.markerNonce));
    await this.#mutate(s => { s.lease = lease; s.identity = identity; s.markerSha256 = markerSha256; });
  }
  async #observation(value: RuntimeObservation): Promise<void> {
    const s = this.#store.read()!;
    if (!value || !equal(value.identity, s.identity) || !['pending', 'runtime_ready', 'stopped', 'unknown', 'failed'].includes(value.phase)) throw Error('runtime-receipt-scope-denied');
    let ready = value.ready; const stop = value.stop; let invalidReady = false;
    try { if (ready !== null) {
      quotaIdentifier(ready.receiptId);
      if (Object.keys(ready).length !== (s.task.modelContent?6:5) || !validModelContentReceipt(s.task,ready.modelContent) || !integer(ready.initializedAt) || ready.initializedAt < s.task.createdAt || ready.initializedAt > Math.min(this.#clock(), s.task.deadlineAt) ||
        ready.layoutVersion !== WORKSPACE_LAYOUT || ready.markerSha256 !== s.markerSha256 || !hash(ready.checkpointRevision) ||
        !s.intents.initialize || (s.runtimeReceipt && !equal(ready, s.runtimeReceipt))) throw Error('invalid-runtime-ready-receipt');
    } } catch { ready = null; invalidReady = true; }
    if (stop !== null) {
      quotaIdentifier(stop.confirmationId);
      if (Object.keys(stop).length !== 4 || !integer(stop.observedAt) || stop.observedAt < s.lease!.acquiredAt || stop.observedAt > this.#clock() || stop.nativeRunning !== false || stop.fenced !== true ||
        (ready && ready.initializedAt > stop.observedAt) || (s.runtimeReceipt && s.runtimeReceipt.initializedAt > stop.observedAt) ||
        (s.stopReceipt && !equal(stop, s.stopReceipt))) throw Error('invalid-runtime-stop-receipt');
    }
    if ((value.phase === 'runtime_ready' && !ready && !invalidReady) || (value.phase === 'stopped' && !stop)) throw Error('missing-runtime-receipt');
    await this.#mutate(current => {
      // Reject the checkpoint claim independently; a correctly scoped native
      // stop proof can still clean up this failed initialization and its quota.
      if (invalidReady) { current.target ??= 'failed'; current.reasonCode ??= 'runtime-unknown'; }
      if (ready) { current.runtimeReceipt = structuredClone(ready); current.phase = 'runtime_ready'; }
      if (stop) { current.stopReceipt = structuredClone(stop); current.phase = 'stopped'; }
      if (stop && !current.runtimeReceipt) { current.target ??= 'failed'; current.reasonCode ??= 'startup-failed'; }
      if ((value.phase === 'failed' || value.phase === 'unknown') && !current.runtimeReceipt) {
        current.target ??= 'failed'; current.reasonCode ??= value.failureCode === 'scope-denied' ? 'authority-revoked' : value.phase === 'failed' ? 'startup-failed' : 'runtime-unknown';
      }
    });
  }
  async #finish(unknown = false): Promise<void> {
    await this.#mutate(s => {
      const outcome = unknown ? 'unknown' : s.target ?? 'ready';
      const reasonCode = unknown ? (s.target === 'stopped' ? 'cleanup-unknown' : 'runtime-unknown') : s.reasonCode ?? 'initialized';
      if (!s.projection || s.projection.outcome !== outcome || s.projection.reasonCode !== reasonCode ||
        s.projection.quotaReleased !== s.quotaReleased || !equal(s.projection.runtimeReceipt, s.runtimeReceipt) || !equal(s.projection.stopReceipt, s.stopReceipt)) {
        s.sequence++; s.projection = { taskId: s.task.id, tenantId: s.task.tenantId, projectId: s.task.projectId,
          workspaceId: s.task.workspaceId, generation: s.task.generation, sequence: s.sequence, receiptId: crypto.randomUUID(), updatedAt: this.#clock(),
          outcome, reasonCode, quotaReleased: s.quotaReleased, runtimeReceipt: s.runtimeReceipt, stopReceipt: s.stopReceipt };
        s.projectionConfirmed = false; s.projectionAttempts = 0;
      }
      s.phase = unknown ? 'unknown' : 'stopped'; s.wakeAt = this.#clock() + 1;
    });
  }
  async #project(): Promise<void> {
    const state = this.#store.read()!;
    if (!state.projection) return;
    if (state.projectionConfirmed || state.projectionAttempts >= 3) {
      await this.#mutate(s => { s.wakeAt = null; }); return;
    }
    const result = await this.#effect('project', () => this.#ports.catalog.project(state.projection!), s => { s.projectionAttempts++; });
    if (result.known && result.value?.applied === true) await this.#mutate(s => { s.projectionConfirmed = true; s.wakeAt = null; });
    else if (state.projection.outcome === 'ready') {
      const auth = await this.#effect('authority', () => this.#ports.catalog.verifyTask(state.task));
      if (auth.known && auth.value === false) { await this.#mutate(s => { s.target = 'failed'; s.reasonCode = 'authority-revoked'; }); await this.#finish(); }
    }
  }
  async #advance(): Promise<void> {
    let s = this.#store.read(); if (!s || s.wakeAt === null) return;
    // Any persisted effect after eviction is an uncertain former attempt. Its
    // intent remains; lookup/observe below is the only Runtime recovery path.
    if (s.effect) await this.#mutate(current => { current.effect = null; });
    if (s.projection && s.projection.outcome !== 'unknown') { await this.#project(); return; }
    if (this.#clock() >= s.windowEndsAt || s.calls >= this.#timing.maxCalls) { await this.#finish(true); await this.#project(); return; }
    if (!s.target && !s.runtimeReceipt && (this.#clock() >= s.task.deadlineAt || s.calls >= this.#timing.maxCalls - 8)) {
      await this.#mutate(current => { current.target = 'failed'; current.reasonCode = this.#clock() >= current.task.deadlineAt ? 'deadline' : 'runtime-unknown'; });
    }
    s = this.#store.read()!;
    try {
      if (!s.intents.acquire && s.target) { await this.#mutate(current => { current.quotaReleased = true; }); await this.#finish(); return; }
      if (s.acquisitionDenied) { await this.#finish(); return; }
      if (!s.lease) {
        if (s.intents.acquire) {
          const result = await this.#effect('lookup', () => this.#ports.quota.lookup(s!.task.tenantId, s!.task.id));
          if (result.known && result.value) await this.#acquisition(result.value);
          else if (result.known && result.value === null && s.acquireAttempts < 3 && this.#clock() < s.task.deadlineAt) {
            // Quota, unlike Runtime initialization, atomically deduplicates the
            // complete fixed request. A null read is not itself a release proof.
            const retried = await this.#effect('acquire', async() => {await this.#ports.beforeStart?.(s!.task);return this.#ports.quota.acquire(request(s!.task));}, current => { current.acquireAttempts++; },
              current => this.#clock() < current.task.deadlineAt);
            if (retried.known) await this.#acquisition(retried.value);
          }
          return;
        }
        const auth = await this.#effect('authority', () => this.#ports.catalog.verifyTask(s!.task));
        if (!auth.known) return;
        if (!auth.value) { await this.#mutate(current => { current.target = 'failed'; current.reasonCode = 'authority-revoked'; }); return; }
        const result = await this.#effect('acquire', async() => {await this.#ports.beforeStart?.(s!.task);return this.#ports.quota.acquire(request(s!.task));}, current => { current.intents.acquire = true; current.acquireAttempts++; },
          current => !current.target && this.#clock() < current.task.deadlineAt);
        if (result.known) await this.#acquisition(result.value); return;
      }
      if (s.stopReceipt) {
        if (s.quotaReleased) { await this.#finish(); return; }
        const ref = leaseReference(s.lease), proof = { kind: 'runtime-stopped' as const, confirmationId: s.stopReceipt.confirmationId, observedAt: s.stopReceipt.observedAt };
        if (s.intents.release) {
          const seen = await this.#effect('lookup', () => this.#ports.quota.lookup(s!.task.tenantId, s!.task.id));
          if (seen.known && seen.value?.lease) {
            const lease = this.#lease(seen.value.lease, s);
            if (lease.status === 'stopped' && equal(lease.confirmation, proof)) { await this.#mutate(current => { current.lease = lease; current.quotaReleased = true; }); }
            else if (lease.status !== 'stopped' && s.releaseAttempts < 3) {
              // Same immutable native confirmation, same full lease scope.
              // This cannot release another generation or authorize a start.
              const retried = await this.#effect('release', () => this.#ports.quota.confirmStopped(ref, proof), current => { current.releaseAttempts++; });
              if (retried.known) {
                const stopped = this.#lease(retried.value.lease, s);
                if (stopped.status !== 'stopped' || !equal(stopped.confirmation, proof)) throw Error('quota-stop-not-confirmed');
                await this.#mutate(current => { current.lease = stopped; current.quotaReleased = true; });
              }
            }
          }
          return;
        }
        const result = await this.#effect('release', () => this.#ports.quota.confirmStopped(ref, proof), current => { current.intents.release = true; current.releaseAttempts++; });
        if (result.known) {
          const lease = this.#lease(result.value.lease, s);
          if (lease.status !== 'stopped' || !equal(lease.confirmation, proof)) throw Error('quota-stop-not-confirmed');
          await this.#mutate(current => { current.lease = lease; current.quotaReleased = true; });
        }
        return;
      }
      if (s.target || s.runtimeReceipt || s.intents.stop) {
        if (!s.intents.stop) {
          const result = await this.#effect('stop', () => this.#ports.runtime(s!.identity!).stop(s!.identity!), current => { current.intents.stop = true; current.phase = 'stopping'; });
          if (result.known) await this.#observation(result.value);
        } else {
          const result = await this.#effect('observe', () => this.#ports.runtime(s!.identity!).observe(s!.identity!));
          if (result.known) await this.#observation(result.value);
        }
        return;
      }
      if (!s.intents.dispatch) {
        const auth = await this.#effect('authority', () => this.#ports.catalog.verifyTask(s!.task));
        if (!auth.known) return;
        if (!auth.value) { await this.#mutate(current => { current.target = 'failed'; current.reasonCode = 'authority-revoked'; }); return; }
        const result = await this.#effect('dispatch', async() => {await this.#ports.beforeStart?.(s!.task);return this.#ports.quota.dispatch(leaseReference(s!.lease!));}, current => { current.intents.dispatch = true; },
          current => !current.target && this.#clock() < current.task.deadlineAt);
        if (result.known && result.value.authorized === true) {
          const lease = this.#lease(result.value.lease, s);
          if (lease.status !== 'dispatched') throw Error('quota-dispatch-not-confirmed');
          await this.#mutate(current => { current.lease = lease; current.dispatchOwner = this.#owner; });
        } else await this.#mutate(current => { current.target ??= 'failed'; current.reasonCode ??= 'runtime-unknown'; });
        return;
      }
      if (!s.intents.initialize) {
        if (s.dispatchOwner !== this.#owner) {
          await this.#mutate(current => { current.target = 'failed'; current.reasonCode = 'runtime-unknown'; }); return;
        }
        const auth = await this.#effect('authority', () => this.#ports.catalog.verifyTask(s!.task));
        if (!auth.known || auth.value !== true) {
          await this.#mutate(current => { current.target ??= 'failed'; current.reasonCode ??= auth.known ? 'authority-revoked' : 'runtime-unknown'; }); return;
        }
        const result = await this.#effect('initialize', async() => {await this.#ports.beforeStart?.(s!.task);return this.#ports.runtime(s!.identity!).initialize({ task: s!.task, identity: s!.identity!, markerNonce: s!.markerNonce });},
          current => { current.intents.initialize = true; current.phase = 'initializing'; },
          current => !current.target && current.dispatchOwner === this.#owner && this.#clock() < current.task.deadlineAt);
        if (result.known) await this.#observation(result.value); return;
      }
      const result = await this.#effect('observe', () => this.#ports.runtime(s!.identity!).observe(s!.identity!));
      if (result.known) await this.#observation(result.value);
    } catch {
      // Receipt/transport errors contain no public raw message. Keep a possibly
      // occupied lease; a subsequent alarm can only fence/observe its runtime.
      await this.#mutate(current => {
        // A storage acknowledgement can fail with an intent already committed.
        // Preserve that intent for its specific lookup path, rather than turn a
        // recoverable quota acknowledgement into an irrevocable failed target.
        if (!current.effect) { current.target ??= 'failed'; current.reasonCode ??= 'runtime-unknown'; }
        current.wakeAt = this.#clock() + this.#timing.pollMs;
      });
    }
  }
}
