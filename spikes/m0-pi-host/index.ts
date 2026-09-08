import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, Sandbox, getSandbox } from '@cloudflare/sandbox';
import resourceSource from '../../services/runtime/resource-loading-probe.mjs';
import { EffectDeadlineError, waitForEffect } from '../m0-recovery/bounded-effect.ts';
import { handleHostRequest } from './worker.ts';
export { ContainerProxy };
type Env = Omit<M0PiHostEnv, "PiHostSandbox" | "HOST"> & { PiHostSandbox: DurableObjectNamespace<PiHostSandbox>; HOST: DurableObjectNamespace<M0PiHost> };
export class PiHostSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts: string[] = [];
  override sleepAfter = '60s';
  override envVars = {};
}
PiHostSandbox.outbound = async () => new Response('M0 policy denied', { status: 403 });
const MODULE = '/opt/riffology/services/runtime/resource-loading-probe.mjs';
const ENTRY = '/opt/riffology/services/runtime/resource-probe-entry.mjs';
const OUTPUT = '/opt/m0-resource-probe-result.json';
const entrySource = `import {runResourceLoadingProbe} from './resource-loading-probe.mjs';
import {mkdir,writeFile,rename} from 'node:fs/promises';
const timer=setTimeout(()=>process.exit(124),30000);
try {
 await mkdir('/opt/m0-resource-project',{recursive:false,mode:0o700});
 const result=await runResourceLoadingProbe({trustedCwd:'/opt/m0-resource-project'});
 const encoded=JSON.stringify(result);
 if(Buffer.byteLength(encoded)>65536)throw Error('output-limit');
 await writeFile('${OUTPUT}.tmp',encoded,{mode:0o600,flag:'wx'});
 await rename('${OUTPUT}.tmp','${OUTPUT}');
 process.stdout.write('resource-probe-finished\\n');
} catch {process.stderr.write('resource-probe-failed\\n');process.exitCode=1;}
finally{clearTimeout(timer);}`;
type State = { runId: string; phase: 'queued' | 'preparing' | 'executing' | 'collecting' | 'cleaning' | 'completed' | 'failed';
  startedAt: number; deadline: number; closed: boolean; allocated: boolean; cleanup: 'pending' | 'confirmed' | 'unconfirmed';
  operation: string | null; error: string | null; report: unknown; events: { phase: string; at: number }[] };
export class M0PiHost extends DurableObject<Env> {
  actual: Promise<unknown> | null = null;
  busy = false;
  operationMs = 45000;
  state() { return this.ctx.storage.kv.get<State>('state') ?? null; }
  sandbox() { return getSandbox<PiHostSandbox>(this.env.PiHostSandbox, `m0-ph-${this.env.M0_RUN_ID}-s`, { normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: '60s' }); }
  set(patch: Partial<State>) {
    const previous = this.state(); if (!previous) throw new Error('not-initialized');
    const next = { ...previous, ...patch };
    if (patch.phase && patch.phase !== previous.phase) next.events = [...previous.events, { phase: patch.phase, at: Date.now() }];
    if (next.events.length > 24) throw new Error('event-limit');
    this.ctx.storage.kv.put('state', next); return next;
  }
  async accept() {
    if (this.state()) throw new Error('already-accepted-or-closed');
    const now = Date.now();
    this.ctx.storage.kv.put('state', { runId: this.env.M0_RUN_ID, phase: 'queued', startedAt: now, deadline: now + 180000,
      closed: false, allocated: false, cleanup: 'pending', operation: null, error: null, report: null, events: [{ phase: 'queued', at: now }] } satisfies State);
    await this.ctx.storage.sync(); await this.ctx.storage.setAlarm(Date.now() + 100);
    return this.report();
  }
  report() { return { environment: 'cloudflare-vm', sandboxId: `m0-ph-${this.env.M0_RUN_ID}-s`, realProviderCalls: 0, state: this.state() }; }
  async cleanup() {
    if (!this.state()) {
      this.ctx.storage.kv.put('state', { runId: this.env.M0_RUN_ID, phase: 'failed', startedAt: Date.now(), deadline: Date.now(), closed: true,
        allocated: false, cleanup: 'confirmed', operation: null, error: 'closed-before-accept', report: null, events: [] } satisfies State);
    } else this.set({ closed: true });
    await this.ctx.storage.sync();
    if (!this.actual && !this.state()!.operation && this.state()!.cleanup !== 'confirmed') await this.ctx.storage.setAlarm(Date.now() + 100);
    return this.report();
  }
  async effect<T>(name: string, invoke: () => Promise<T>, cleanup = false): Promise<T> {
    const before = this.state()!;
    if (this.actual || before.operation || !cleanup && (before.closed || Date.now() >= before.deadline)) throw new Error('effect-not-available');
    this.set({ operation: name, allocated: before.allocated || name !== 'destroy' }); await this.ctx.storage.sync();
    if (!cleanup && this.state()!.closed) { this.set({ operation: null }); await this.ctx.storage.sync(); throw new Error('closed'); }
    let timedOut = false, fulfilled = false;
    const actual = Promise.resolve().then(invoke).then(value => { fulfilled = true; return value; }).finally(async () => {
      this.set({ operation: null });
      if (timedOut) this.set({ phase: 'failed', closed: true, error: 'effect-outcome-unknown', cleanup: name === 'destroy' && fulfilled ? 'confirmed' : 'pending' });
      await this.ctx.storage.sync();
      if (this.actual === actual) this.actual = null;
      if (timedOut && this.state()!.cleanup !== 'confirmed') await this.ctx.storage.setAlarm(Date.now() + 100);
    });
    this.actual = actual; this.ctx.waitUntil(actual.catch(() => {}));
    try { return await waitForEffect(actual, cleanup ? 20000 : Math.min(this.operationMs, before.deadline - Date.now())); }
    catch (error) {
      if (error instanceof EffectDeadlineError) { timedOut = true; this.set({ phase: 'failed', closed: true, error: 'effect-outcome-unknown', cleanup: 'unconfirmed' }); await this.ctx.storage.sync(); }
      throw error;
    }
  }
  async finishCleanup() {
    const s = this.state()!;
    if (s.operation || this.actual) return;
    if (s.cleanup === 'confirmed') return;
    this.set({ phase: 'cleaning', closed: true });
    if (s.allocated) await this.effect('destroy', () => this.sandbox().destroy(), true);
    this.set({ cleanup: 'confirmed', phase: s.report && !s.error ? 'completed' : 'failed' });
    await this.ctx.storage.sync();
  }
  async alarm() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = this.state(); if (!s || s.cleanup === 'confirmed') return;
      if (s.operation) {
        if (!this.actual) { this.set({ phase: 'failed', closed: true, cleanup: 'unconfirmed', error: 'interrupted-operation-needs-independent-reconciliation' }); await this.ctx.storage.sync(); }
        return;
      }
      if (s.closed || Date.now() >= s.deadline) { if (!s.closed) this.set({ closed: true, error: 'run-deadline' }); await this.finishCleanup(); return; }
      if (s.phase === 'queued') {
        this.set({ phase: 'preparing' });
        const module = await this.effect('write-module', () => this.sandbox().writeFile(MODULE, resourceSource));
        if (!module.success) throw new Error('write-failed');
        const entry = await this.effect('write-entry', () => this.sandbox().writeFile(ENTRY, entrySource));
        if (!entry.success) throw new Error('write-failed');
        this.set({ phase: 'executing' });
        await this.ctx.storage.sync(); await this.ctx.storage.setAlarm(Date.now() + 100); return;
      }
      if (s.phase === 'executing') {
        if (this.ctx.storage.kv.get('exec-attempted')) throw new Error('exec-already-attempted');
        // This fence survives eviction after the SDK effect settles but before
        // the collecting phase is committed. That gap must never re-run exec.
        this.ctx.storage.kv.put('exec-attempted', true);
        await this.ctx.storage.sync();
        const result = await this.effect('execute-probe', () => this.sandbox().exec(`node ${ENTRY}`, { timeout: 35000 }));
        if (!result.success || result.exitCode !== 0 || result.stdout !== 'resource-probe-finished\n') throw new Error('probe-process-failed');
        this.set({ phase: 'collecting' });
        const file = await this.effect('read-report', () => this.sandbox().readFile(OUTPUT, { encoding: 'utf-8' }));
        if (!file.success || typeof file.content !== 'string' || new TextEncoder().encode(file.content).length > 65536) throw new Error('invalid-report');
        const report = JSON.parse(file.content);
        if (report.passed !== true) throw new Error('probe-checks-failed');
        if (this.state()!.closed) throw new Error('closed-before-report');
        this.set({ report, closed: true }); await this.ctx.storage.sync(); await this.finishCleanup(); return;
      }
      throw new Error('interrupted-phase');
    } catch {
      this.set({ phase: 'failed', closed: true, error: this.state()!.error ?? 'probe-operation-failed' }); await this.ctx.storage.sync();
      if (!this.actual && !this.state()!.operation) {
        try { await this.finishCleanup(); } catch { this.set({ cleanup: 'unconfirmed' }); await this.ctx.storage.sync(); }
      }
    } finally { this.busy = false; }
  }
}
export default { async fetch(request: Request, env: Env) {
  return handleHostRequest(request, env, async action => {
    const host = env.HOST.getByName(`m0-pi-host-${env.M0_RUN_ID}`);
    return action === 'accept' ? host.accept() : action === 'cleanup' ? host.cleanup() : host.report();
  });
} } satisfies ExportedHandler<Env>;
