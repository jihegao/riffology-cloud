import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, getSandbox, Sandbox } from '@cloudflare/sandbox';
import { commitCheckpoint, currentCheckpoint, R2Blobs } from '../m0-storage/adapters.ts';
import { restoreCheckpoint, saveCheckpoint, sha256, type Authority, type Receipt } from '../m0-storage/checkpoint.ts';
import { recoveryRuntimeScript } from './runtime.ts';
import { handleRecoveryRequest, recoverySandboxId, type Action, type ProbeResponse, type RecoveryEvent } from './worker.ts';
import { EffectDeadlineError, waitForEffect, type EffectIntent } from './bounded-effect.ts';

export { ContainerProxy };
type Env = Omit<M0RecoveryEnv, 'M0_EXECUTION_ENVIRONMENT'> & { M0_EXECUTION_ENVIRONMENT?: 'local-docker-workerd' | 'cloudflare-vm' };
export class RecoveryTrustedSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts: string[] = [];
  override sleepAfter = '60s';
  override envVars = {};
}
RecoveryTrustedSandbox.outbound = async () => new Response('M0 policy denied', { status: 403 });

type Phase = 'queued' | 'preparing' | 'launching' | 'ready-wait' | 'go-intent' | 'streaming' | 'finishing' | 'interrupting' | 'completed' | 'interrupted';
type Cleanup = 'pending' | 'destroy_acknowledged' | 'cleanup_not_confirmed';
type FaultKind = 'process' | 'container';
type FaultPlan = { kind: FaultKind; trigger: 'durable-prearmed'; status: 'armed' | 'triggered'; armedAt: number; triggeredAt: number | null; runtimeGeneration: 1 };
type State = {
  phase: Phase; generation: number; runtimeGeneration: number; mode: 'initial' | 'recovery';
  deadline: number; reason: string | null; fault: 'process' | 'container' | 'cleanup' | null;
  cleanup: Cleanup; cleanupAttempts: number; seed: Receipt | null; final: Receipt | null;
};
type RuntimeStatus = { schemaVersion: 1; generation: number; stage: 'ready' | 'streaming' | 'completed' | 'failed'; requestCount: number; contextRestored: boolean; contextSeenOnRecovery?: boolean; streamStartedAt?: number | null };
const TERMINAL: Phase[] = ['completed', 'interrupted'];
const ACTIVE: Phase[] = ['queued', 'preparing', 'launching', 'ready-wait', 'go-intent', 'streaming', 'finishing'];
const encoder = new TextEncoder();
const runtimeDirectory = (generation: number) => `/opt/m0-recovery/g${generation}`;
const processId = (generation: number) => `m0-pi-g${generation}`;

/** Fixed, one-project M0 scheduler. Alarms own progress; HTTP only accepts and observes. */
export class M0RecoveryCoordinator extends DurableObject<Env> implements Authority {
  alarmBusy = false;
  activeEffect: Promise<unknown> | null = null;
  operationTimeoutMs = 45000;
  cleanupTimeoutMs = 20000;
  faultObservationMs = 4500;
  state() { return this.ctx.storage.kv.get<State>('turn-state') ?? null; }
  sandbox(generation: number): RecoveryTrustedSandbox { return getSandbox<RecoveryTrustedSandbox>(this.env.RecoveryTrustedSandbox, recoverySandboxId(this.ctx.id.toString(), generation), { normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: '60s' }); }
  blobs(s: State) {
    const blobs = new R2Blobs(this.env.CHECKPOINTS, `m0-recovery/${this.ctx.id.toString()}`);
    return {
      get: (key: string) => this.effect(s, 'checkpoint-get', () => blobs.get(key)),
      putIfAbsent: (key: string, bytes: Uint8Array) => this.effect(s, 'checkpoint-put', () => blobs.putIfAbsent(key, bytes)),
    };
  }
  /** Persist ownership before dispatch. Never start a second SDK operation or
   * destroy this physical identity while a timed-out operation is still live.
   * SDK startProcess.timeout limits the child, not the management RPC; these
   * APIs expose no caller AbortSignal. An unknown RPC is not cancellation. */
  async effect<T>(s: State, operation: string, invoke: () => Promise<T>, until = s.deadline): Promise<T> {
    const valid = () => this.state()?.generation === s.generation && this.state()?.phase === s.phase
      && (!this.ctx.storage.kv.get('closed') || !ACTIVE.includes(s.phase));
    if (!valid() || Date.now() >= until) throw new Error('stale-or-expired-effect');
    if (this.activeEffect || this.ctx.storage.kv.get('effect-intent')) throw new Error('previous-effect-outcome-unknown');
    const sequence = (this.ctx.storage.kv.get<number>('effect-sequence') ?? 0) + 1;
    const intent: EffectIntent = { sequence, generation: s.generation, runtimeGeneration: s.runtimeGeneration, operation, startedAt: Date.now(), outcome: 'pending' };
    this.ctx.storage.kv.put('effect-sequence', sequence);
    this.ctx.storage.kv.put('effect-intent', intent);
    await this.ctx.storage.sync();
    // cleanup may have fenced the generation while the intent was persisting.
    if (!valid() || Date.now() >= until) {
      this.ctx.storage.kv.delete('effect-intent');
      await this.ctx.storage.sync();
      throw new Error('stale-or-expired-effect');
    }
    let timedOut = false, fulfilled = false;
    let raw: Promise<T>;
    try { raw = Promise.resolve(invoke()); } catch (error) { raw = Promise.reject(error); }
    const actual = raw.then(value => { fulfilled = true; return value; }).finally(async () => {
      const recorded = this.ctx.storage.kv.get<EffectIntent>('effect-intent');
      if (recorded?.sequence === sequence) {
        this.ctx.storage.kv.delete('effect-intent');
        this.ctx.storage.kv.put('last-effect', { ...intent, outcome: 'settled', result: fulfilled ? 'fulfilled' : 'rejected', settledAt: Date.now(), responseTimedOut: timedOut });
      }
      // Late completion can create/write the old VM. Only now may its cleanup
      // run; it can never resume the abandoned call chain or model dispatch.
      let reschedule = false;
      if (timedOut) {
        const current = this.state();
        if (current && current.runtimeGeneration === s.runtimeGeneration) {
          if (ACTIVE.includes(current.phase)) this.interrupt(current, 'effect-outcome-unknown');
          const fenced = this.state()!;
          const destroyed = operation === 'destroy' && fulfilled;
          this.transition(fenced.generation, [fenced.phase], {
            phase: destroyed && fenced.phase === 'interrupting' ? 'interrupted' : fenced.phase,
            cleanup: destroyed ? 'destroy_acknowledged' : 'pending',
          });
          reschedule = true;
        }
      }
      await this.ctx.storage.sync();
      if (this.activeEffect === actual) this.activeEffect = null;
      if (reschedule) await this.ctx.storage.setAlarm(Date.now() + 100);
    });
    this.activeEffect = actual;
    // Retain the real work, consume late rejection, and clear ownership only
    // after settlement metadata has persisted. Durable intent survives eviction.
    this.ctx.waitUntil(actual.catch(() => undefined).finally(() => { if (this.activeEffect === actual) this.activeEffect = null; }));
    try {
      return await waitForEffect(actual, Math.min(this.operationTimeoutMs, until - Date.now()));
    } catch (error) {
      if (error instanceof EffectDeadlineError) {
        timedOut = true;
        if (this.ctx.storage.kv.get<EffectIntent>('effect-intent')?.sequence === sequence) {
          this.ctx.storage.kv.put('effect-intent', { ...intent, outcome: 'unknown' });
          await this.ctx.storage.sync();
        }
      }
      throw error;
    }
  }
  scope() { return { tenantId: 'm0-recovery-tenant', projectId: this.ctx.id.toString(), sessionId: '11111111-1111-4111-8111-111111111111' }; }
  async current() { return currentCheckpoint(this.ctx.storage); }
  async commit(input: { revision: string; parent: string | null; generation: number }) {
    return commitCheckpoint(this.ctx.storage, input, receipt => {
      const state = this.state();
      const pending = this.ctx.storage.kv.get<{ generation: number; digest: string; kind: 'seed' | 'final' }>('pending-session-digest');
      if (!state || state.generation !== input.generation || !pending || pending.generation !== input.generation) throw new Error('stale-generation-or-phase');
      if (this.ctx.storage.kv.get('closed') || Date.now() >= state.deadline) throw new Error('closed-or-expired-checkpoint');
      if (state.phase === 'ready-wait' && pending.kind === 'seed') {
        this.ctx.storage.kv.put('seed-sha256', pending.digest);
        this.append({ ...state, phase: 'go-intent', seed: receipt });
      } else if (state.phase === 'finishing' && pending.kind === 'final') {
        this.ctx.storage.kv.put('final-sha256', pending.digest);
        this.append({ ...state, phase: 'completed', final: receipt });
      } else throw new Error('stale-generation-or-phase');
      this.ctx.storage.kv.delete('pending-session-digest');
      return undefined;
    });
  }
  append(state: State) {
    const sequence = (this.ctx.storage.kv.get<number>('turn-sequence') ?? 0) + 1;
    if (sequence > 64) throw new Error('event-limit');
    const event: RecoveryEvent = { sequence, generation: state.runtimeGeneration, kind: this.state()?.phase === state.phase ? 'cleanup' : 'phase', phase: state.phase, reason: state.reason, at: new Date().toISOString() };
    this.ctx.storage.kv.put('turn-state', state);
    this.ctx.storage.kv.put('generation', state.generation);
    this.ctx.storage.kv.put('turn-sequence', sequence);
    this.ctx.storage.kv.put(`turn-events/${sequence.toString().padStart(8, '0')}`, event);
  }
  transition(generation: number, phases: Phase[], patch: Partial<State>): State | null {
    return this.ctx.storage.transactionSync(() => {
      const old = this.state();
      if (!old || old.generation !== generation || !phases.includes(old.phase)) return null;
      const next = { ...old, ...patch };
      this.append(next);
      return next;
    });
  }
  async schedule(generation: number, phases: Phase[], patch: Partial<State>, armedFault?: FaultKind) {
    return this.ctx.storage.transaction(async tx => {
      if (patch.phase === 'queued' && await tx.get('closed')) return false;
      const old = await tx.get<State>('turn-state');
      if (!old || old.generation !== generation || !phases.includes(old.phase)) return false;
      if (armedFault) {
        const plan = await tx.get<FaultPlan>('fault-plan');
        const observed = await tx.get<RuntimeStatus>('runtime-status');
        if (await tx.get('closed') || !plan || plan.kind !== armedFault || plan.status !== 'armed'
          || old.mode !== 'initial' || old.runtimeGeneration !== plan.runtimeGeneration || old.phase !== 'streaming'
          || observed?.generation !== old.runtimeGeneration || observed.stage !== 'streaming') return false;
        // Consumption and generation fencing commit together. Alarm replay
        // cannot consume the plan twice or inject into the recovered runtime.
        await tx.put('fault-plan', { ...plan, status: 'triggered', triggeredAt: Date.now() });
      }
      const state = { ...old, ...patch };
      const sequence = (await tx.get<number>('turn-sequence') ?? 0) + 1;
      if (sequence > 64) throw new Error('event-limit');
      await tx.put('turn-state', state);
      await tx.put('generation', state.generation);
      await tx.put('turn-sequence', sequence);
      await tx.put(`turn-events/${sequence.toString().padStart(8, '0')}`, { sequence, generation: state.runtimeGeneration, kind: old.phase === state.phase ? 'cleanup' : 'phase', phase: state.phase, reason: state.reason, at: new Date().toISOString() });
      await tx.setAlarm(Date.now() + 100);
      return true;
    });
  }
  async accept(kind: FaultKind | null = null): Promise<ProbeResponse> {
    if (kind !== null && kind !== 'process' && kind !== 'container') return { status: 400, body: { error: 'invalid-fixed-scenario' } };
    // Read/put/alarm in one storage transaction; no runtime dispatch before acknowledgement.
    await this.ctx.storage.transaction(async tx => {
      if (await tx.get('closed')) return;
      if (await tx.get('turn-state')) return;
      const state: State = { phase: 'queued', generation: 1, runtimeGeneration: 1, mode: 'initial', deadline: Date.now() + 180000,
        reason: null, fault: null, cleanup: 'pending', cleanupAttempts: 0, seed: null, final: null };
      await tx.put('turn-state', state);
      await tx.put('generation', 1);
      await tx.put('turn-sequence', 1);
      if (kind) await tx.put('fault-plan', { kind, trigger: 'durable-prearmed', status: 'armed', armedAt: Date.now(), triggeredAt: null, runtimeGeneration: 1 } satisfies FaultPlan);
      await tx.put('turn-events/00000001', { sequence: 1, generation: 1, kind: 'phase', phase: 'queued', reason: null, at: new Date().toISOString() });
      await tx.setAlarm(Date.now() + 100);
    });
    if (this.ctx.storage.kv.get('closed')) return { status: 409, body: { error: 'probe-closed', accepted: false } };
    const plan = this.ctx.storage.kv.get<FaultPlan>('fault-plan') ?? null;
    if ((plan?.kind ?? null) !== kind) return { status: 409, body: { error: 'fixed-scenario-conflict', accepted: false } };
    return { status: 202, body: { accepted: true, state: this.state(), fault_plan: plan, executionOwner: 'durable-alarm', gate_decision: 'not_evaluated' } };
  }
  async events(cursor: number) {
    const sequence = this.ctx.storage.kv.get<number>('turn-sequence') ?? 0;
    if (cursor > sequence) throw new Error('cursor-ahead');
    return { events: Array.from(this.ctx.storage.kv.list<RecoveryEvent>({ prefix: 'turn-events/' }), ([, event]) => event).filter(event => event.sequence > cursor), terminal: this.isSettled() };
  }
  isSettled() { const s = this.state(); return !!s && TERMINAL.includes(s.phase) && s.cleanup !== 'pending'; }
  async report(): Promise<ProbeResponse> {
    const state = this.state();
    return { status: state ? (this.isSettled() ? 200 : 202) : 404, body: {
      schema_version: 1, operation: 'G0-T08-recovery', protocol: 'm0-v1', execution_environment: this.env.M0_EXECUTION_ENVIRONMENT ?? 'unrecorded',
      observed_at: new Date().toISOString(), state, events: (await this.events(0)).events,
      current: await this.current(), seed_sha256: this.ctx.storage.kv.get('seed-sha256') ?? null,
      final_sha256: this.ctx.storage.kv.get('final-sha256') ?? null, runtime_status: this.ctx.storage.kv.get('runtime-status') ?? null,
      runtime_sandbox_id: state ? recoverySandboxId(this.ctx.id.toString(), state.runtimeGeneration) : null,
      fault_receipt: this.ctx.storage.kv.get('fault-receipt') ?? null, stale_event_check: this.ctx.storage.kv.get('stale-event-check') ?? null,
      closed: this.ctx.storage.kv.get('closed') === true, effect_intent: this.ctx.storage.kv.get('effect-intent') ?? null,
      last_effect: this.ctx.storage.kv.get('last-effect') ?? null,
      fault_plan: this.ctx.storage.kv.get('fault-plan') ?? null,
      script_sha256: await sha256(encoder.encode(recoveryRuntimeScript())), gate_decision: 'not_evaluated',
      limits: ['Real Pi SDK with fixed local SSE provider; no external LLM or billing evidence.', 'Fixed single-project probe, no production authentication, queue, tools or untrusted project execution.', 'Recovery is a new explicit turn from the last committed Session; an interrupted model request is never automatically replayed.', 'Local Docker/Workerd does not prove cloud scheduling, VM isolation, rollout or durable Turn acceptance.'],
    } };
  }
  async fault(kind: FaultKind, trigger: 'external' | 'durable-prearmed' = 'external'): Promise<ProbeResponse> {
    const s = this.state();
    const observed = this.ctx.storage.kv.get<RuntimeStatus>('runtime-status');
    if (trigger === 'external' && this.ctx.storage.kv.get('fault-plan')) return { status: 409, body: { error: 'requires-durable-trigger' } };
    if (!s || s.phase !== 'streaming' || observed?.generation !== s.runtimeGeneration || observed.stage !== 'streaming') return { status: 409, body: { error: 'requires-streaming', phase: s?.phase ?? null } };
    if (!await this.schedule(s.generation, ['streaming'], { phase: 'interrupting', generation: s.generation + 1, reason: `injected-${kind}-kill`, fault: kind }, trigger === 'durable-prearmed' ? kind : undefined)) return { status: 409, body: { error: 'state-changed' } };
    return { status: 202, body: { faultAccepted: kind, generation: this.state()!.generation } };
  }
  async recover(): Promise<ProbeResponse> {
    const s = this.state();
    if (this.ctx.storage.kv.get('closed') || this.activeEffect || this.ctx.storage.kv.get('effect-intent') || !s || s.phase !== 'interrupted' || s.cleanup !== 'destroy_acknowledged' || !s.seed || s.mode !== 'initial') return { status: 409, body: { error: 'requires-interrupted-saved-initial-turn' } };
    if (!await this.schedule(s.generation, ['interrupted'], { phase: 'queued', runtimeGeneration: s.generation, mode: 'recovery', deadline: Date.now() + 180000,
      cleanup: 'pending', cleanupAttempts: 0, fault: null, reason: null })) return { status: 409, body: { error: 'state-changed' } };
    return { status: 202, body: { recoveryAccepted: true, replayInterruptedRequest: false, state: this.state() } };
  }
  async lateEvent(): Promise<ProbeResponse> {
    const s = this.state();
    if (!s || s.generation < 2) return { status: 409, body: { error: 'requires-fenced-generation' } };
    const before = JSON.stringify(this.state()), count = this.ctx.storage.kv.get<number>('turn-sequence');
    // The phase is deliberately valid now: a rejection must depend on the old
    // generation, rather than accidentally passing an invalid-phase check.
    const accepted = this.transition(1, [s.phase], { phase: 'completed' }) !== null;
    const currentBefore = JSON.stringify(await this.current());
    const receiptsBefore = JSON.stringify(Array.from(this.ctx.storage.kv.list({ prefix: 'events/' })));
    let writeAccepted = false, writeRejection: string | null = null;
    try {
      await this.commit({ revision: '0'.repeat(64), parent: (await this.current())?.revision ?? null, generation: 1 });
      writeAccepted = true;
    } catch (error) { writeRejection = error instanceof Error && error.message === 'stale-generation' ? 'stale-generation' : 'unexpected-rejection'; }
    const check = { suppliedGeneration: 1, currentGeneration: s.generation, accepted, stateUnchanged: JSON.stringify(this.state()) === before,
      eventCountUnchanged: this.ctx.storage.kv.get<number>('turn-sequence') === count,
      attemptedPhase: s.phase, phaseWasCurrent: true, writeAccepted, writeRejection,
      currentUnchanged: JSON.stringify(await this.current()) === currentBefore,
      receiptEventsUnchanged: JSON.stringify(Array.from(this.ctx.storage.kv.list({ prefix: 'events/' }))) === receiptsBefore };
    this.ctx.storage.kv.put('stale-event-check', check);
    await this.ctx.storage.sync();
    return { status: accepted || writeAccepted || writeRejection !== 'stale-generation' || !check.currentUnchanged || !check.receiptEventsUnchanged || !check.stateUnchanged || !check.eventCountUnchanged ? 500 : 409, body: check };
  }
  async cleanup(): Promise<ProbeResponse> {
    // Persist even if accept has not arrived. A delayed HTTP accept must never
    // recreate resources after the operator has closed the run.
    this.ctx.storage.kv.put('closed', true);
    await this.ctx.storage.sync();
    const s = this.state();
    if (!s) return { status: 200, body: { cleanup: 'no-runtime-created' } };
    if (TERMINAL.includes(s.phase) && s.cleanup === 'destroy_acknowledged') return { status: 200, body: { cleanup: s.cleanup } };
    if (TERMINAL.includes(s.phase)) await this.schedule(s.generation, [s.phase], { cleanup: 'pending', cleanupAttempts: 0 });
    else if (s.phase !== 'interrupting') await this.schedule(s.generation, ACTIVE, { phase: 'interrupting', generation: s.generation + 1, reason: 'operator-cleanup', fault: 'cleanup' });
    return { status: 202, body: { cleanup: 'scheduled' } };
  }
  interrupt(s: State, reason: string, fault: State['fault'] = null) {
    return this.transition(s.generation, ACTIVE, { phase: 'interrupting', generation: s.generation + 1, reason, fault });
  }
  async read(s: State, file: 'status.json' | 'seed.json' | 'final.json', until = s.deadline) {
    const result = await this.effect(s, 'read-' + file, () => this.sandbox(s.runtimeGeneration).readFile(`${runtimeDirectory(s.runtimeGeneration)}/${file}`, { encoding: 'utf-8' }), until);
    if (!result.success || result.content.length > 262144) throw new Error('runtime-file-unavailable');
    return { bytes: encoder.encode(result.content), value: JSON.parse(result.content) as unknown };
  }
  status(value: unknown, s: State): RuntimeStatus {
    const v = value as RuntimeStatus;
    if (!v || v.schemaVersion !== 1 || v.generation !== s.runtimeGeneration || !['ready', 'streaming', 'completed', 'failed'].includes(v.stage)
      || !Number.isInteger(v.requestCount) || v.requestCount < 0 || v.requestCount > 2 || typeof v.contextRestored !== 'boolean') throw new Error('invalid-runtime-status');
    return v;
  }
  snapshot(value: unknown) {
    const v = value as { format?: string; scope?: unknown; entries?: unknown[] };
    if (!v || v.format !== 'riffology-pi-session-v1' || JSON.stringify(v.scope) !== JSON.stringify(this.scope()) || !Array.isArray(v.entries) || v.entries.length > 100) throw new Error('invalid-trusted-snapshot');
  }
  async write(s: State, path: string, data: string) { if (!(await this.effect(s, 'write-file', () => this.sandbox(s.runtimeGeneration).writeFile(path, data))).success) throw new Error('runtime-write-failed'); }
  async destroy(s: State): Promise<Cleanup> {
    try { await this.effect(s, 'destroy', () => this.sandbox(s.runtimeGeneration).destroy(), Date.now() + this.cleanupTimeoutMs); return 'destroy_acknowledged'; }
    catch { return 'cleanup_not_confirmed'; }
  }
  async finishCleanup(s: State) {
    // An in-memory owner will schedule cleanup on actual late settlement. An
    // intent recovered after DO eviction has no such proof: quarantine it for
    // independent operator reconciliation, rather than racing a late create.
    if (this.activeEffect || this.ctx.storage.kv.get('effect-intent')) {
      this.transition(s.generation, [s.phase], { phase: s.phase === 'interrupting' ? 'interrupted' : s.phase,
        cleanup: 'cleanup_not_confirmed', reason: 'effect-outcome-unknown' });
      return;
    }
    let faultReceipt: Record<string, unknown> | undefined;
    if (['process', 'container'].includes(s.fault ?? '') && !this.ctx.storage.kv.get('fault-receipt')) {
      const observationDeadline = Date.now() + this.faultObservationMs;
      let killed = false, status: string | null = null;
      let evidence: { observedAt: number; processStatus: string; runtimeStage: string; finalAbsent: boolean; streamStartedAt: number | null } | null = null;
      try {
        const process = await this.effect(s, 'fault-get-process', () => this.sandbox(s.runtimeGeneration).getProcess(processId(s.runtimeGeneration)), observationDeadline);
        if (process) {
          const processStatus = await this.effect(s, 'fault-process-status', () => process.getStatus(), observationDeadline);
          const runtime = this.status((await this.read(s, 'status.json', observationDeadline)).value, s);
          const final = await this.effect(s, 'fault-final-exists', () => this.sandbox(s.runtimeGeneration).exists(`${runtimeDirectory(s.runtimeGeneration)}/final.json`), observationDeadline);
          evidence = { observedAt: Date.now(), processStatus, runtimeStage: runtime.stage, finalAbsent: final.success && !final.exists, streamStartedAt: runtime.streamStartedAt ?? null };
          if (s.fault === 'process') {
            await this.effect(s, 'fault-kill-process', () => process.kill('SIGKILL'), observationDeadline);
            status = await this.effect(s, 'fault-killed-status', () => process.getStatus(), observationDeadline);
            killed = typeof status === 'string' && ['killed', 'failed', 'error'].includes(status);
          }
        }
      } catch { /* A timed-out RPC remains owned; destroy below will not race it. */ }
      faultReceipt = { kind: s.fault, signal: s.fault === 'process' ? 'SIGKILL' : null, killed, status, before: evidence };
    }
    const cleanup = await this.destroy(s);
    if (faultReceipt) {
      const before = faultReceipt.before as { observedAt: number; processStatus: string; runtimeStage: string; finalAbsent: boolean; streamStartedAt: number | null } | null;
      const confirmedAt = Date.now();
      const windowHit = !!before && before.processStatus === 'running' && before.runtimeStage === 'streaming' && before.finalAbsent
        && typeof before.streamStartedAt === 'number' && before.observedAt >= before.streamStartedAt
        && confirmedAt < before.streamStartedAt + 11500 && cleanup === 'destroy_acknowledged';
      this.ctx.storage.kv.put('fault-receipt', { ...faultReceipt, cleanup, confirmedAt, windowHit,
        windowScope: 'Fixed local 12-second SSE stream; conservative wall-clock bound, not arbitrary provider behavior.' });
    }
    const attempts = s.cleanupAttempts + 1;
    if (cleanup === 'destroy_acknowledged' || attempts >= 3 || this.activeEffect || this.ctx.storage.kv.get('effect-intent')) {
      this.transition(s.generation, [s.phase], { phase: s.phase === 'interrupting' ? 'interrupted' : s.phase, cleanup, cleanupAttempts: attempts });
      // Let the already-scheduled watchdog observe terminal state once. Deleting
      // it after an await could erase an explicit recovery accepted meanwhile.
    } else this.transition(s.generation, [s.phase], { cleanupAttempts: attempts });
  }
  async step(s: State) {
    if (s.phase === 'interrupting' || TERMINAL.includes(s.phase)) { if (s.cleanup === 'pending') await this.finishCleanup(s); return; }
    if (Date.now() >= s.deadline) { this.interrupt(s, 'probe-deadline'); return; }
    if (s.phase === 'queued') { this.transition(s.generation, ['queued'], { phase: 'preparing' }); return; }
    const directory = runtimeDirectory(s.runtimeGeneration);
    if (s.phase === 'preparing') {
      let snapshot: unknown;
      if (s.mode === 'recovery') {
        if (!s.seed || (await this.current())?.revision !== s.seed.revision) throw new Error('last-confirmed-revision-changed');
        const restored = await restoreCheckpoint(this.blobs(s), s.seed.revision);
        if (await sha256(restored.session) !== this.ctx.storage.kv.get('seed-sha256')) throw new Error('seed-digest-mismatch');
        snapshot = JSON.parse(new TextDecoder().decode(restored.session)); this.snapshot(snapshot);
      }
      await this.effect(s, 'mkdir', () => this.sandbox(s.runtimeGeneration).mkdir(directory, { recursive: true }));
      await this.write(s, `${directory}/config.json`, JSON.stringify({ generation: s.runtimeGeneration, scope: this.scope(), mode: s.mode, ...(snapshot ? { snapshot } : {}) }));
      await this.write(s, '/tmp/m0-recovery-pi.mjs', recoveryRuntimeScript());
      const launching = this.transition(s.generation, ['preparing'], { phase: 'launching' });
      if (!launching) return;
      await this.ctx.storage.sync();
      // A durable dispatch intent precedes this side effect. Unknown launch outcomes reconcile by process ID, never retry start.
      await this.effect(launching, 'start-process', () => this.sandbox(s.runtimeGeneration).startProcess('node /tmp/m0-recovery-pi.mjs', { processId: processId(s.runtimeGeneration), env: { M0_RECOVERY_DIR: directory }, autoCleanup: false, timeout: 60000 }));
      this.transition(s.generation, ['launching'], { phase: 'ready-wait' });
      return;
    }
    if (s.phase === 'launching') {
      const process = await this.effect(s, 'get-process', () => this.sandbox(s.runtimeGeneration).getProcess(processId(s.runtimeGeneration)));
      if (process && ['starting', 'running', 'completed'].includes(await this.effect(s, 'process-status', () => process.getStatus()))) this.transition(s.generation, ['launching'], { phase: 'ready-wait' });
      else this.interrupt(s, 'launch-outcome-unknown');
      return;
    }
    if (s.phase === 'go-intent') {
      // Fixed barrier is idempotent inside this runtime; it cannot start another prompt.
      await this.write(s, `${directory}/go`, 'ok');
      this.transition(s.generation, ['go-intent'], { phase: 'streaming' });
      return;
    }
    const process = await this.effect(s, 'get-process', () => this.sandbox(s.runtimeGeneration).getProcess(processId(s.runtimeGeneration)));
    if (!process) { this.interrupt(s, 'runtime-process-missing'); return; }
    const processStatus = await this.effect(s, 'process-status', () => process.getStatus());
    let observed: RuntimeStatus;
    try { observed = this.status((await this.read(s, 'status.json')).value, s); }
    catch (error) {
      if (this.activeEffect || this.ctx.storage.kv.get('effect-intent')) throw error;
      if (['starting', 'running'].includes(processStatus)) return;
      this.interrupt(s, 'runtime-status-unavailable'); return;
    }
    if (this.state()?.generation !== s.generation) return;
    this.ctx.storage.kv.put('runtime-status', observed);
    if (observed.stage === 'failed' || ['failed', 'killed', 'error'].includes(processStatus)) { this.interrupt(s, 'runtime-interrupted'); return; }
    if (s.mode === 'initial' && s.phase === 'streaming' && observed.stage === 'streaming' && processStatus === 'running') {
      const plan = this.ctx.storage.kv.get<FaultPlan>('fault-plan');
      if (plan?.status === 'armed') { await this.fault(plan.kind, 'durable-prearmed'); return; }
    }
    if (s.phase === 'ready-wait' && observed.stage === 'ready') {
      const seed = await this.read(s, 'seed.json'); this.snapshot(seed.value);
      if (s.mode === 'initial') {
        const digest = await sha256(seed.bytes);
        if (this.state()?.generation !== s.generation || this.state()?.phase !== 'ready-wait') return;
        this.ctx.storage.kv.put('pending-session-digest', { generation: s.generation, digest, kind: 'seed' });
        await saveCheckpoint({ entries: [], session: seed.bytes, parent: null, generation: s.generation, blobs: this.blobs(s), authority: this });
      } else {
        if (!observed.contextRestored || observed.requestCount !== 0 || await sha256(seed.bytes) !== this.ctx.storage.kv.get('seed-sha256')) throw new Error('recovery-seed-mismatch');
        this.transition(s.generation, ['ready-wait'], { phase: 'go-intent' });
      }
      return;
    }
    if (s.phase === 'streaming' && observed.stage === 'completed') { this.transition(s.generation, ['streaming'], { phase: 'finishing' }); return; }
    if (s.phase === 'finishing' && observed.stage === 'completed') {
      if (observed.requestCount !== (s.mode === 'initial' ? 2 : 1) || (s.mode === 'recovery' && (!observed.contextRestored || observed.contextSeenOnRecovery !== true))) throw new Error('unexpected-model-request-history');
      const final = await this.read(s, 'final.json'); this.snapshot(final.value);
      const digest = await sha256(final.bytes);
      if (this.state()?.generation !== s.generation || this.state()?.phase !== 'finishing') return;
      this.ctx.storage.kv.put('pending-session-digest', { generation: s.generation, digest, kind: 'final' });
      await saveCheckpoint({ entries: [], session: final.bytes, parent: s.seed!.revision, generation: s.generation, blobs: this.blobs(s), authority: this });
    }
  }
  async alarm() {
    if (this.alarmBusy) return;
    this.alarmBusy = true;
    try {
      const s = this.state();
      if (!s || this.isSettled()) return;
      // Persist the next watchdog before external work. Alarm retries may repeat observation, not model dispatch.
      await this.ctx.storage.setAlarm(Date.now() + 2000);
      try { await this.step(s); }
      catch { if (this.state()?.generation === s.generation) this.interrupt(s, `operation-failed-${s.phase}`); }
      await this.ctx.storage.sync();
    } finally { this.alarmBusy = false; }
  }
}

export default {
  fetch(request: Request, env: Env) {
    const coordinator = (runId: string) => env.RECOVERY.getByName(`m0-recovery-${runId}`);
    return handleRecoveryRequest(request, env, {
      events: (runId, cursor) => coordinator(runId).events(cursor),
      invoke: (runId, action: Exclude<Action, 'events'>) => {
        const stub = coordinator(runId);
        if (action === 'accept-process') return stub.accept('process');
        if (action === 'accept-container') return stub.accept('container');
        if (action === 'kill-process') return stub.fault('process');
        if (action === 'kill-container') return stub.fault('container');
        if (action === 'late-event') return stub.lateEvent();
        return stub[action]();
      },
    });
  },
} satisfies ExportedHandler<Env>;
