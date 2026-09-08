import { DurableObject } from 'cloudflare:workers';
import { EffectDeadlineError, waitForEffect } from '../m0-recovery/bounded-effect.ts';

const KEY = 'm0:release-completion:native-fault';
type Intent = { owner: string; startedAt: number; deadlineAt: number; startReturned: boolean; monitorAttached: boolean };
type Monitor = { outcome: 'unexpected-exit' | 'resolved' | 'unrecognized-error'; exitCode: number | null; observedAt: number };
type Readiness = { port: 3000; status: 'not-probed' | 'response' | 'rejected' | 'unconfirmed' };
export type NativeFaultResult = {
  outcome: 'confirmed' | 'unconfirmed'; reason: 'exit-42' | 'other-exit' | 'normal-resolution' | 'unknown-monitor-error' | 'deadline' | 'start-error' | 'not-fresh' | 'cancelled' | 'owner-lost';
  expectedExitCode: 42; exitCode: number | null; monitor: Monitor | null;
  nativeRunning: boolean | null; readiness: Readiness; recordedAt: number;
};
type Ledger = { intent: Intent | null; result: NativeFaultResult | null; closed: boolean; cleanup: 'pending' | 'confirmed' | 'unconfirmed'; cleanupAttempts: number };
export type NativeFaultReport = Ledger & {
  schemaVersion: 1; probe: 'native-entrypoint-exit-42'; phase: 'idle' | 'running' | 'terminal' | 'owner-lost';
  nativeRunning: boolean | null; ownerLost: boolean; businessDispatches: 0; modelDispatches: 0;
};

/** Only native monitor rejection is parsed. No port, start, cleanup or caller
 * error can supply exit evidence. No raw error text is persisted. */
export function parseNativeMonitorError(error: unknown): Pick<Monitor, 'outcome' | 'exitCode'> {
  const match = error instanceof Error ? /^container exited with unexpected exit code:[ \t]*(\d+)$/i.exec(error.message) : null;
  const code = match ? Number(match[1]) : NaN;
  return match?.[0] === (error as Error)?.message && Number.isSafeInteger(code) && code >= 0 && code <= 255
    ? { outcome: 'unexpected-exit', exitCode: code }
    : { outcome: 'unrecognized-error', exitCode: null };
}

/** A dedicated Container-enabled SQLite DO. The Worker must route only its
 * fixed completion identity here; no input selects an image, command or URL.
 * It deliberately does not inherit Sandbox's readiness/automatic start path. */
export class NativeFault extends DurableObject {
  // Only offline test subclasses shorten these values; there is no RPC setter,
  // request parameter or environment option for changing production deadlines.
  protected readonly deadlineMs: number = 20_000;
  protected readonly cleanupMs: number = 5_000;
  #owner = crypto.randomUUID();
  #monitor: Promise<Monitor> | null = null;
  #cleanup: Promise<NativeFaultReport> | null = null;
  #readinessController: AbortController | null = null;

  #ledger(): Ledger {
    return this.ctx.storage.kv.get<Ledger>(KEY) ?? { intent: null, result: null, closed: false, cleanup: 'pending', cleanupAttempts: 0 };
  }
  #running(): boolean | null {
    try { return this.ctx.container?.running ?? null; } catch { return null; }
  }
  report(): NativeFaultReport {
    const ledger = this.#ledger(), ownerLost = !!ledger.intent && !ledger.result && ledger.intent.owner !== this.#owner;
    return structuredClone({ ...ledger, schemaVersion: 1, probe: 'native-entrypoint-exit-42',
      phase: ledger.result || ledger.closed ? 'terminal' : ownerLost ? 'owner-lost' : ledger.intent ? 'running' : 'idle',
      nativeRunning: this.#running(), ownerLost, businessDispatches: 0, modelDispatches: 0 });
  }
  #result(reason: NativeFaultResult['reason'], monitor: Monitor | null = null, readiness: Readiness = { port: 3000, status: 'not-probed' }): NativeFaultResult {
    return { outcome: reason === 'exit-42' ? 'confirmed' : 'unconfirmed', reason, expectedExitCode: 42,
      exitCode: monitor?.exitCode ?? null, monitor, nativeRunning: this.#running(), readiness, recordedAt: Date.now() };
  }
  async #saveResult(result: NativeFaultResult): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const row = this.#ledger();
      // First terminal receipt wins, including a cancellation or owner loss.
      if (!row.result) this.ctx.storage.kv.put(KEY, { ...row, result, closed: true });
    });
    await this.ctx.storage.sync();
  }
  async #probePort(signal: AbortSignal, deadlineAt: number): Promise<Readiness> {
    try {
      const native = this.ctx.container!;
      const response = await waitForEffect(native.getTcpPort(3000).fetch('http://native-fault-readiness/', { signal }), Math.max(1, deadlineAt - Date.now()));
      void response.body?.cancel().catch(() => {});
      return { port: 3000, status: 'response' };
    } catch (error) {
      return { port: 3000, status: error instanceof EffectDeadlineError || signal.aborted ? 'unconfirmed' : 'rejected' };
    }
  }
  async run(): Promise<NativeFaultReport> {
    const prior = this.#ledger();
    if (prior.intent || prior.closed) return this.report(); // A read, never a replay.
    const startedAt = Date.now(), intent: Intent = { owner: this.#owner, startedAt, deadlineAt: startedAt + this.deadlineMs, startReturned: false, monitorAttached: false };
    this.ctx.storage.transactionSync(() => {
      const row = this.#ledger();
      if (row.intent || row.closed) throw Error('native-fault-never-replay');
      this.ctx.storage.kv.put(KEY, { ...row, intent });
    });
    await this.ctx.storage.sync();
    if (this.#ledger().closed) return this.report();
    let candidate: NativeFaultResult;
    if (Date.now() >= intent.deadlineAt) candidate = this.#result('deadline');
    else if (!this.ctx.container || this.#running() !== false) candidate = this.#result('not-fresh');
    else {
      try {
        const native = this.ctx.container;
        native.start({ entrypoint: ['/bin/sh', '-c', 'exit 42'], enableInternet: false, env: {} });
        // NO await between start and attaching both monitor handlers.
        const actual = native.monitor().then(
          (): Monitor => ({ outcome: 'resolved', exitCode: null, observedAt: Date.now() }),
          (error: unknown): Monitor => ({ ...parseNativeMonitorError(error), observedAt: Date.now() }),
        );
        this.#monitor = actual;
        this.ctx.waitUntil(actual.then(() => {}));
        const row = this.#ledger();
        this.ctx.storage.kv.put(KEY, { ...row, intent: { ...intent, startReturned: true, monitorAttached: true } });
        await this.ctx.storage.sync();
        if (this.#ledger().closed) return this.report();
        const controller = new AbortController(); this.#readinessController = controller;
        const readiness = this.#probePort(controller.signal, intent.deadlineAt);
        const [monitor, port] = await waitForEffect(Promise.all([actual, readiness]), Math.max(1, intent.deadlineAt - Date.now()));
        const reason = Date.now() >= intent.deadlineAt ? 'deadline'
          : monitor.outcome === 'resolved' ? 'normal-resolution'
          : monitor.outcome === 'unrecognized-error' ? 'unknown-monitor-error'
          : monitor.exitCode !== 42 ? 'other-exit'
          : port.status === 'response' || port.status === 'unconfirmed' || this.#running() !== false ? 'unknown-monitor-error' : 'exit-42';
        candidate = this.#result(reason, monitor, port);
      } catch (error) {
        candidate = this.#result(error instanceof EffectDeadlineError ? 'deadline' : 'start-error');
      } finally {
        this.#readinessController?.abort(); this.#readinessController = null;
      }
    }
    // If persistence fails, do not destroy here: the result has not been
    // acknowledged. A separate cleanup may durably fence unknown first.
    await this.#saveResult(candidate);
    return this.cleanup();
  }
  async cleanup(): Promise<NativeFaultReport> {
    if (this.#cleanup) return this.#cleanup;
    const task = this.#clean(); this.#cleanup = task;
    try { return await task; } finally { if (this.#cleanup === task) this.#cleanup = null; }
  }
  async #clean(): Promise<NativeFaultReport> {
    let row = this.#ledger();
    if (row.cleanup === 'confirmed') return this.report();
    if (!row.result) await this.#saveResult(this.#result(row.intent && row.intent.owner !== this.#owner ? 'owner-lost' : 'cancelled'));
    else await this.ctx.storage.sync();
    row = this.#ledger();
    if (row.cleanupAttempts >= 2) return this.report();
    this.ctx.storage.kv.put(KEY, { ...row, closed: true, cleanup: 'unconfirmed', cleanupAttempts: row.cleanupAttempts + 1 });
    await this.ctx.storage.sync();
    this.#readinessController?.abort();
    let confirmed = false;
    try {
      if (this.ctx.container) {
        // Never pass destroy(error): cleanup cannot manufacture exit evidence.
        const actual = this.ctx.container.destroy();
        this.ctx.waitUntil(actual.catch(() => {}));
        await waitForEffect(actual, this.cleanupMs);
        confirmed = this.#running() === false;
      }
    } catch { /* Preserve unconfirmed and allow only the bounded cleanup retry. */ }
    const latest = this.#ledger();
    this.ctx.storage.kv.put(KEY, { ...latest, cleanup: confirmed ? 'confirmed' : 'unconfirmed' });
    await this.ctx.storage.sync();
    return this.report();
  }
}
