import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { renameSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreCheckpoint, saveCheckpoint, sha256, type Authority, type Blobs, type Receipt } from '../m0-storage/checkpoint.ts';
import { assertHandshake, faultAllowed, releaseAllowed, requestIdAllowed, RUNTIME_SHA256, type Fault, type FixedCommand, type ReleaseId } from './policy.ts';

type RuntimeResult = { kind: 'result'; release: ReleaseId; generation: string; request_id: string; command: FixedCommand; counter: number };
type TaskState = 'starting' | 'ready' | 'running' | 'checkpointing' | 'rejected' | 'startup_failed' | 'interrupted' | 'unknown' | 'stopped';
type Dispatch = { command: FixedCommand; status: 'pending' | 'confirmed' | 'unknown'; result?: RuntimeResult };
export type TaskView = { task_id: string; release: ReleaseId; fixture_fault: Fault; generation: string; status: TaskState; dispatched: number; workspace: string; pid?: number; launch_artifact_sha256?: string; failure?: string };
type Task = TaskView & { handle?: RuntimeHandle; requests: Map<string, Dispatch>; startupDone: Promise<void> };
const SESSION = new TextEncoder().encode('synthetic controller-owned session; never runtime stdout');
const runtimePath = fileURLToPath(new URL('./runtime.mjs', import.meta.url));

class RuntimeHandle {
  child: ChildProcess;
  hello: Promise<unknown>;
  exited: Promise<void>;
  isExited = false;
  admitted = false;
  pending: { request: { request_id: string; command: FixedCommand; generation: string }; resolve: (value: RuntimeResult) => void; reject: (error: Error) => void } | undefined;
  release: ReleaseId;
  constructor(release: ReleaseId, fault: Fault, workspace: string, entrypoint: string, onExit: () => void) {
    this.release = release;
    this.child = spawn(process.execPath, [entrypoint, release, fault, workspace], { cwd: workspace, env: {}, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let resolveHello: (value: unknown) => void;
    let rejectHello: (error: Error) => void;
    this.hello = new Promise((resolve, reject) => { resolveHello = resolve; rejectHello = reject; });
    // Avoid unhandled rejection if a process exits while launch metadata is recorded.
    void this.hello.catch(() => {});
    let outputBytes = 0;
    for (const stream of [this.child.stdout, this.child.stderr]) stream?.on('data', chunk => {
      outputBytes += chunk.length;
      // stdout/stderr are discarded and can never approve a launch or command.
      if (outputBytes > 8192) this.child.kill('SIGKILL');
    });
    this.child.on('message', message => {
      if (message && typeof message === 'object' && 'kind' in message && message.kind === 'hello' && !this.admitted) { resolveHello!(message); return; }
      const pending = this.pending;
      if (!pending) return;
      const value = message as RuntimeResult;
      if (!value || value.kind !== 'result' || value.release !== this.release || value.generation !== pending.request.generation || value.request_id !== pending.request.request_id || value.command !== pending.request.command || !Number.isSafeInteger(value.counter) || value.counter < 0) {
        pending.reject(new Error('runtime-result-invalid'));
        this.pending = undefined;
        this.child.kill('SIGKILL');
        return;
      }
      this.pending = undefined;
      pending.resolve(value);
    });
    this.child.once('error', error => { rejectHello!(error); this.pending?.reject(error); });
    this.exited = new Promise(resolve => this.child.once('close', () => {
      this.isExited = true;
      rejectHello!(new Error('runtime-startup-exited'));
      this.pending?.reject(new Error('runtime-exited-before-result'));
      this.pending = undefined;
      onExit();
      resolve();
    }));
  }
  async handshake(artifact_sha256: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const hello = await Promise.race([this.hello, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('runtime-handshake-timeout')), 3000); })]);
      assertHandshake({ release: this.release, artifact_sha256 }, hello);
      if (this.isExited) throw new Error('runtime-startup-exited');
      this.admitted = true;
    } finally { clearTimeout(timer); }
  }
  async execute(request: { request_id: string; command: FixedCommand; generation: string }): Promise<RuntimeResult> {
    if (!this.admitted || this.isExited || this.pending) throw new Error('runtime-not-admitted-or-busy');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<RuntimeResult>((resolve, reject) => {
        this.pending = { request, resolve, reject };
        timer = setTimeout(() => { this.pending = undefined; reject(new Error('runtime-result-timeout')); this.child.kill('SIGKILL'); }, 3000);
        this.child.send!({ kind: 'command', ...request }, error => { if (error) { this.pending = undefined; reject(error); } });
      });
    } finally { clearTimeout(timer); }
  }
  async stop(): Promise<void> {
    if (this.isExited) return;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
    try { await this.exited; } finally { clearTimeout(timer); }
  }
}

/** Local file-backed control store, not R2/DO durability or an OS sandbox. */
class LocalCheckpoints implements Blobs, Authority {
  directory: string;
  head: Receipt | null = null;
  constructor(directory: string) { this.directory = directory; }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try { this.head = JSON.parse(await readFile(path.join(this.directory, 'head.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  objectPath(key: string) {
    if (!/^(blobs|manifests)\/[a-f0-9]{64}$/.test(key)) throw new Error('checkpoint-key-denied');
    return path.join(this.directory, key);
  }
  async putIfAbsent(key: string, bytes: Uint8Array) {
    const target = this.objectPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    try { await writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  async get(key: string) {
    try { return Uint8Array.from(await readFile(this.objectPath(key))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async current() { return this.head; }
  async commit(input: { revision: string; parent: string | null; generation: number }, authorize: () => void = () => {}) {
    if ((this.head?.revision ?? null) !== input.parent || input.generation !== 1) throw new Error('checkpoint-commit-conflict');
    const receipt = { revision: input.revision, sequence: (this.head?.sequence ?? 0) + 1, generation: 1 };
    const temporary = path.join(this.directory, `head-${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(receipt), { flag: 'wx' });
      // No await may separate the lifecycle fence and the authoritative switch.
      // This is a local event-loop primitive, not a multi-controller transaction.
      authorize();
      renameSync(temporary, path.join(this.directory, 'head.json'));
      this.head = receipt;
      return receipt;
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}

export class ReleaseController {
  readonly directory: string;
  private tasks = new Map<string, Task>();
  private active: ReleaseId = 'runtime-v1';
  private checkpoints: LocalCheckpoints;
  private checkpointBusy = false;
  private activationBusy = false;
  private closed = false;
  readonly transitions: Array<{ candidate: ReleaseId; from: ReleaseId; to: ReleaseId; outcome: 'activated' | 'rollback'; reason?: string }> = [];
  constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.checkpoints = new LocalCheckpoints(path.join(this.directory, 'controller-checkpoints'));
  }
  async initialize() { await this.checkpoints.initialize(); await mkdir(path.join(this.directory, 'tasks'), { recursive: true }); }
  activeRelease(): ReleaseId { return this.active; }
  view(taskId: string): TaskView {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('unknown-task');
    const { handle: _handle, requests: _requests, startupDone: _startupDone, ...view } = task;
    return { ...view };
  }
  async effects(taskId: string): Promise<unknown[]> {
    try { return (await readFile(path.join(this.view(taskId).workspace, 'effects.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async confirmedCheckpoint() { return this.checkpoints.current(); }
  private task(taskId: string): Task { const task = this.tasks.get(taskId); if (!task) throw new Error('unknown-task'); return task; }
  async startTask(taskId: string, options: { release?: ReleaseId; fault?: Fault; restore?: boolean } = {}): Promise<TaskView> {
    if (this.closed) throw new Error('controller-closed');
    if (!requestIdAllowed(taskId) || this.tasks.has(taskId)) throw new Error('task-id-denied-or-reused');
    const release = options.release ?? this.active;
    const fault = options.fault ?? 'none';
    if (!releaseAllowed(release) || !faultAllowed(fault)) throw new Error('launch-not-allowed');
    let finishStartup: () => void;
    const startupDone = new Promise<void>(resolve => { finishStartup = resolve; });
    const task: Task = { task_id: taskId, release, fixture_fault: fault, generation: crypto.randomUUID().replaceAll('-', ''), status: 'starting', dispatched: 0, workspace: path.join(this.directory, 'tasks', taskId), requests: new Map(), startupDone };
    this.tasks.set(taskId, task);
    const assertStarting = () => { if (this.closed || task.status !== 'starting') throw new Error('task-start-cancelled'); };
    try {
      const source = await readFile(runtimePath);
      assertStarting();
      const digest = createHash('sha256').update(source).digest('hex');
      if (digest !== RUNTIME_SHA256) throw new Error('runtime-artifact-not-approved');
      task.launch_artifact_sha256 = digest;
      // Never reuse a previous execution directory, including after controller
      // restart when its in-memory request ledger is no longer available.
      await mkdir(task.workspace);
      assertStarting();
      const entrypoint = path.join(task.workspace, 'approved-runtime.mjs');
      await writeFile(entrypoint, source, { flag: 'wx', mode: 0o500 });
      assertStarting();
      if (options.restore) {
        const head = await this.checkpoints.current();
        if (!head) throw new Error('no-confirmed-checkpoint');
        const restored = await restoreCheckpoint(this.checkpoints, head.revision);
        const state = restored.entries[0];
        if (restored.entries.length !== 1 || state?.kind !== 'file' || state.path !== 'state.json' || await sha256(restored.session) !== await sha256(SESSION)) throw new Error('checkpoint-shape-denied');
        await writeFile(path.join(task.workspace, 'state.json'), state.bytes, { flag: 'wx' });
      }
      assertStarting();
      task.handle = new RuntimeHandle(release, fault, task.workspace, entrypoint, () => {
        if (['ready', 'running', 'checkpointing'].includes(task.status)) task.status = 'interrupted';
      });
      task.pid = task.handle.child.pid;
      await task.handle.handshake(digest);
      assertStarting();
      task.status = 'ready';
      return this.view(taskId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'runtime-startup-failed';
      if (task.status !== 'stopped') task.status = /denied|mismatch|not-approved|invalid/.test(reason) ? 'rejected' : 'startup_failed';
      task.failure = reason;
      await task.handle?.stop();
      throw new Error(reason);
    } finally { finishStartup!(); }
  }
  async activate(release: ReleaseId, fault: Fault = 'none'): Promise<{ active: ReleaseId; outcome: 'activated' | 'rollback' }> {
    if (this.activationBusy) throw new Error('release-activation-busy');
    this.activationBusy = true;
    const previous = this.active;
    const candidateId = `candidate-${crypto.randomUUID()}`;
    try {
      await this.startTask(candidateId, { release, fault });
      await this.stopTask(candidateId);
      if (this.closed) throw new Error('controller-closed');
      this.active = release;
      this.transitions.push({ candidate: release, from: previous, to: release, outcome: 'activated' });
      return { active: release, outcome: 'activated' };
    } catch (error) {
      // An unadmitted candidate never overwrites the known-good active pointer.
      this.transitions.push({ candidate: release, from: previous, to: previous, outcome: 'rollback', reason: String(error) });
      return { active: previous, outcome: 'rollback' };
    } finally { this.activationBusy = false; }
  }
  async execute(taskId: string, request_id: string, command: FixedCommand): Promise<RuntimeResult> {
    const task = this.task(taskId);
    if (!requestIdAllowed(request_id) || !['increment', 'read-state'].includes(command)) throw new Error('command-not-allowed');
    const previous = task.requests.get(request_id);
    if (previous) {
      if (previous.command !== command) throw new Error('idempotency-conflict');
      if (previous.status === 'confirmed') return { ...previous.result! };
      throw new Error('unknown-or-pending-effect-must-not-replay');
    }
    if (task.status !== 'ready' || !task.handle?.admitted) throw new Error('task-not-admitted-or-not-ready');
    task.requests.set(request_id, { command, status: 'pending' });
    task.status = 'running';
    task.dispatched++;
    try {
      const result = await task.handle.execute({ request_id, command, generation: task.generation });
      task.requests.set(request_id, { command, status: 'confirmed', result });
      if (task.status === 'running') task.status = task.handle.isExited ? 'interrupted' : 'ready';
      return { ...result };
    } catch (error) {
      task.requests.set(request_id, { command, status: 'unknown' });
      task.status = 'unknown';
      await task.handle.stop();
      throw new Error(`effect-outcome-unknown:${String(error)}`);
    }
  }
  async checkpoint(taskId: string): Promise<{ receipt: Receipt; state_sha256: string }> {
    const task = this.task(taskId);
    if (task.status !== 'ready' || this.checkpointBusy) throw new Error('checkpoint-not-ready');
    this.checkpointBusy = true;
    task.status = 'checkpointing';
    const authorizeCommit = () => {
      if (task.status !== 'checkpointing' || !task.handle || task.handle.isExited || task.handle.child.exitCode !== null || task.handle.child.signalCode !== null) throw new Error('checkpoint-cancelled');
    };
    try {
      const bytes = Uint8Array.from(await readFile(path.join(task.workspace, 'state.json')));
      const state = JSON.parse(new TextDecoder().decode(bytes));
      if (state.schema_version !== 1 || !Number.isSafeInteger(state.counter) || state.counter < 0) throw new Error('state-schema-denied');
      authorizeCommit();
      const authority: Authority = { current: () => this.checkpoints.current(), commit: input => this.checkpoints.commit(input, authorizeCommit) };
      const receipt = await saveCheckpoint({ entries: [{ path: 'state.json', kind: 'file', mode: 0o600, bytes }], session: SESSION, generation: 1, parent: (await this.checkpoints.current())?.revision ?? null, blobs: this.checkpoints, authority });
      return { receipt, state_sha256: await sha256(bytes) };
    } finally {
      this.checkpointBusy = false;
      if (task.status === 'checkpointing') task.status = task.handle?.isExited ? 'interrupted' : 'ready';
    }
  }
  async stopTask(taskId: string) {
    const task = this.task(taskId);
    if (!['rejected', 'startup_failed', 'unknown'].includes(task.status)) task.status = 'stopped';
    await task.handle?.stop();
    await task.startupDone;
  }
  async close() { this.closed = true; await Promise.all([...this.tasks.keys()].map(taskId => this.stopTask(taskId))); }
}
