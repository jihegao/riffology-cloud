import { unzipSync } from 'fflate';

export const PROJECT_IR_INPUT_MAX_BYTES = 256 * 1024;
export const PROJECT_IR_TOOL_MAX_BYTES = 384 * 1024;
export const PROJECT_IR_BROWSER_MAX_BYTES = 512 * 1024;
export const PROJECT_IR_EVENT_MAX_BYTES = 256 * 1024;
export const PROJECT_IR_RUN_LIMIT = 200;
export const PROJECT_IR_LEASE_MS = 12_000;
const MAX_CLIENTS = 8, MAX_ACTIVE_RUNS = 8, MAX_EFFECTS = 4096;
const storageQueues = new WeakMap<ProjectIrStorage, Promise<unknown>>();
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const shaPattern = /^[a-f0-9]{64}$/;
const runPattern = /^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clientPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const refPattern = /^\.riffoid-ir\/(models|bundles|artifacts|runtimes)\/([a-f0-9]{64})\/(business\.json|model\.simpack|browser\.json|runtime\.js)$/;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: any };
export type ProjectIrScope = { tenantId: string; projectId: string; workspaceId: string; workspaceGeneration: number };
export interface ProjectIrStorage {
  kv: { get<T = unknown>(key: string): T | undefined; put(key: string, value: unknown): void };
  sync(): Promise<unknown>;
  transactionSync<T>(callback: () => T): T;
}
export interface ProjectIrBucket {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array): Promise<unknown>;
}
type Pointer = { sha256: string; byteLength: number };
type FilePointer = Pointer & { path: string };
type ArtifactPointer = { ref: string; worker: Pointer; runtime: string; planFingerprint: string; businessFingerprint: string };
type Effect = { requestSha256: string; response: Pointer };
type RunEntry = { record: Obj; terminal?: Pointer; submitSha256?: string };
type Index = { runIds: string[]; effects: number; registrations: number; artifacts: number };
export type ProjectIrActor = { userId: string; authVersion: number };
type Client = { clientId: string; lastSeen: number; actor: ProjectIrActor };
function sameActor(a: ProjectIrActor | undefined, b: ProjectIrActor): boolean { return a?.userId === b.userId && a.authVersion === b.authVersion; }
/** KV was applied, but its durability acknowledgement is unknown. This must
 * escape business diagnostics so the host preserves the original effect and
 * reconciles it read-only instead of accepting a replacement execution. */
export class IrCommitUnknown extends Error {
  readonly code = 'project-ir-commit-unknown';
  readonly outcome = 'unknown';
  constructor(cause: unknown) { super('project-ir-commit-unknown', { cause }); this.name = 'IrCommitUnknown'; }
}
class IrFault extends Error {
  code: string; stage: string;
  constructor(code: string, stage: string, message: string) { super(message); this.code = code; this.stage = stage; }
}
function fail(code: string, stage: string, message: string): never { throw new IrFault(code, stage, message); }
function object(raw: unknown, stage = 'request'): Obj {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail('invalid_input', stage, 'A plain JSON object is required');
  const desc = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).some(k => typeof k !== 'string' || !Object.hasOwn(desc[k]!, 'value'))) fail('invalid_input', stage, 'JSON data properties are required');
  return raw as Obj;
}
function keys(raw: unknown, required: string[], optional: string[] = [], stage = 'request'): Obj {
  const value = object(raw, stage), own = Object.keys(value);
  if (required.some(k => !Object.hasOwn(value, k)) || own.some(k => !required.includes(k) && !optional.includes(k))) fail('invalid_input', stage, 'Unexpected or missing fields');
  return value;
}
/** Reject accessors, non-JSON values and excessive recursion before hashing or sizing. */
function canonical(raw: unknown, depth = 0, budget = { nodes: 0 }): string {
  if (++budget.nodes > 100_000 || depth > 48) fail('input_limit', 'request', 'JSON structure exceeds the supported limit');
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return JSON.stringify(raw);
  if (typeof raw === 'number') { if (!Number.isFinite(raw)) fail('invalid_input', 'request', 'All numbers must be finite'); return JSON.stringify(raw); }
  if (Array.isArray(raw)) return '[' + raw.map(v => canonical(v, depth + 1, budget)).join(',') + ']';
  const value = object(raw);
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1, budget)).join(',') + '}';
}
function bounded(raw: unknown, max: number, code = 'input_limit'): string {
  const text = canonical(raw);
  if (encoder.encode(text).byteLength > max) fail(code, 'request', `JSON exceeds ${max} bytes`);
  return text;
}
function text(raw: unknown, max = 256): string {
  if (typeof raw !== 'string' || !raw || raw.length > max) fail('invalid_input', 'request', 'A bounded nonempty string is required');
  return raw;
}
function seed(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) fail('invalid_seed', 'run', 'seed must be a nonnegative safe integer');
  return raw;
}
async function sha(raw: string | Uint8Array): Promise<string> {
  const bytes = typeof raw === 'string' ? encoder.encode(raw) : Uint8Array.from(raw);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
function parseJson(bytes: Uint8Array, stage = 'registration'): Obj {
  try { const value: unknown = JSON.parse(decoder.decode(bytes)); canonical(value); return object(value, stage); }
  catch (error) { if (error instanceof IrFault) throw error; return fail('invalid_json', stage, 'Stored JSON is invalid'); }
}
function reference(raw: unknown, directory?: string): { path: string; sha256: string } {
  const match = typeof raw === 'string' && raw.match(refPattern);
  const names: Record<string, string> = { models: 'business.json', bundles: 'model.simpack', artifacts: 'browser.json', runtimes: 'runtime.js' };
  if (!match || names[match[1]!] !== match[3] || directory && match[1] !== directory) fail('invalid_reference', 'registration', 'Only immutable IR graph references are accepted');
  return { path: raw as string, sha256: match[2]! };
}
function decodeBase64(raw: unknown): Uint8Array {
  if (typeof raw !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) fail('invalid_base64', 'registration', 'Canonical base64 is required');
  let binary: string;
  try { binary = atob(raw); } catch { return fail('invalid_base64', 'registration', 'Invalid base64'); }
  if (btoa(binary) !== raw) fail('invalid_base64', 'registration', 'Canonical base64 is required');
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function summary(record: Obj): Obj { const { events: _events, terminalState: _terminal, ...value } = record; return value; }

/** A scope-bound durable projection. Production callers pass their actor and fresh principal authorization;
 * no browser-supplied path, R2 key or caller identity selects its namespace. */
export class ProjectIrAuthority {
  #storage: ProjectIrStorage; #bucket: ProjectIrBucket; #scope: ProjectIrScope; #actor: ProjectIrActor;
  #clock: () => number; #authorize: () => Promise<void>; #scopeHash: Promise<string>;
  constructor(storage: ProjectIrStorage, bucket: ProjectIrBucket, scope: ProjectIrScope, clock: () => number = Date.now, authorize: () => Promise<void> = async () => {}, actor: ProjectIrActor = { userId: 'project-ir-test', authVersion: 1 }) {
    const s = keys(scope, ['tenantId', 'projectId', 'workspaceId', 'workspaceGeneration']);
    for (const key of ['tenantId', 'projectId', 'workspaceId']) if (!/^[A-Za-z0-9_-]{1,128}$/.test(text(s[key], 128))) fail('invalid_scope', 'authorization', 'Invalid workspace scope');
    if (!Number.isSafeInteger(s.workspaceGeneration) || s.workspaceGeneration < 1) fail('invalid_scope', 'authorization', 'Invalid workspace generation');
    if (!storage?.kv?.get || !storage.kv.put || !storage.sync || !storage.transactionSync || !bucket?.get || !bucket.put) fail('storage_unavailable', 'storage', 'Durable KV and R2 storage are required');
    const a = keys(actor, ['userId', 'authVersion']);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(text(a.userId, 128)) || !Number.isSafeInteger(a.authVersion) || a.authVersion < 1) fail('invalid_actor', 'authorization', 'A current actor and authVersion are required');
    this.#actor = structuredClone(actor);
    this.#storage = storage; this.#bucket = bucket; this.#scope = structuredClone(scope); this.#clock = clock; this.#authorize = authorize;
    this.#scopeHash = sha(canonical(this.#scope));
  }
  async #auth(): Promise<void> { try { await this.#authorize(); } catch { fail('authorization_denied', 'authorization', 'Current project authorization no longer permits this operation'); } }
  #now(): number { const now = this.#clock(); if (!Number.isSafeInteger(now) || now < 0) fail('invalid_clock', 'storage', 'A finite millisecond clock is required'); return now; }
  async #key(suffix: string): Promise<string> { return `project-ir/v1/${await this.#scopeHash}/${suffix}`; }
  async #read<T>(suffix: string): Promise<T | undefined> { return structuredClone(this.#storage.kv.get<T>(await this.#key(suffix))); }
  async #commit(entries: [string, unknown][]): Promise<void> {
    const resolved = await Promise.all(entries.map(async ([key, value]) => [await this.#key(key), structuredClone(value)] as const));
    await this.#auth();
    const write = () => { for (const [key, value] of resolved) this.#storage.kv.put(key, value); };
    this.#storage.transactionSync(write);
    try { await this.#storage.sync(); } catch (error) { throw new IrCommitUnknown(error); }
  }
  async #immutable(bytes: Uint8Array): Promise<Pointer> {
    const pointer = { sha256: await sha(bytes), byteLength: bytes.byteLength }, key = await this.#key(`objects/${pointer.sha256}`);
    const previous = await this.#bucket.get(key);
    if (previous) { await this.#verified(previous, pointer); return pointer; }
    await this.#auth();
    await this.#bucket.put(key, bytes);
    const saved = await this.#bucket.get(key);
    if (!saved) fail('persistence_failed', 'storage', 'R2 did not retain the complete object');
    await this.#verified(saved, pointer);
    return pointer;
  }
  async #verified(value: { arrayBuffer(): Promise<ArrayBuffer> }, pointer: Pointer): Promise<Uint8Array> {
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (bytes.byteLength !== pointer.byteLength || await sha(bytes) !== pointer.sha256) fail('artifact_integrity', 'storage', 'Persisted object checksum mismatch');
    return bytes;
  }
  async #blob(pointer: Pointer): Promise<Uint8Array> {
    const saved = await this.#bucket.get(await this.#key(`objects/${pointer.sha256}`));
    if (!saved) fail('artifact_integrity', 'storage', 'Persisted object is unavailable');
    return this.#verified(saved, pointer);
  }
  async #json(pointer: Pointer): Promise<Obj> { return parseJson(await this.#blob(pointer), 'load'); }
  async #index(): Promise<Index> { return await this.#read<Index>('index') ?? { runIds: [], effects: 0, registrations: 0, artifacts: 0 }; }
  async #effectKey(effectId: unknown): Promise<string> { return 'effects/' + await sha(text(effectId)); }
  async #fileKey(path: string): Promise<string> { return 'files/' + await sha(path); }
  async #artifactKey(path: string): Promise<string> { return 'artifacts/' + await sha(path); }
  async #file(path: string, pending = new Map<string, Uint8Array>()): Promise<Uint8Array> {
    reference(path);
    const bytes = pending.get(path);
    if (bytes) return bytes;
    const pointer = await this.#read<FilePointer>(await this.#fileKey(path));
    if (!pointer || pointer.path !== path || pointer.sha256 !== reference(path).sha256) fail('artifact_unregistered', 'load', 'The graph reference is not registered in this workspace generation');
    return this.#blob(pointer);
  }
  async #graph(ref: unknown): Promise<{ artifact: Obj; frozen: ArtifactPointer; runtimeSource: string; workerSource: string }> {
    const path = reference(ref, 'artifacts').path, frozen = await this.#read<ArtifactPointer>(await this.#artifactKey(path));
    if (!frozen || frozen.ref !== path) fail('artifact_unregistered', 'run', 'The browser artifact is not registered in this workspace generation');
    const artifact = parseJson(await this.#file(path), 'load');
    await this.#file(reference(artifact.modelRef, 'models').path); await this.#file(reference(artifact.bundleRef, 'bundles').path);
    const runtimeSource = decoder.decode(await this.#file(reference(artifact.runtimeRef, 'runtimes').path));
    if (await sha(runtimeSource) !== artifact.toolchain?.runtimeSha256 || artifact.runtimeRef !== frozen.runtime || artifact.planFingerprint !== frozen.planFingerprint || artifact.businessFingerprint !== frozen.businessFingerprint) fail('artifact_integrity', 'load', 'Frozen artifact identity mismatch');
    return { artifact, frozen, runtimeSource, workerSource: decoder.decode(await this.#blob(frozen.worker)) };
  }
  async #validateArtifact(path: string, pending: Map<string, Uint8Array>, worker: Pointer): Promise<ArtifactPointer> {
    const a = parseJson(await this.#file(path, pending));
    if (a.version !== 'riffoid-browser-artifact/v1' || !shaPattern.test(a.businessFingerprint) || !shaPattern.test(a.planFingerprint)) fail('artifact_identity', 'registration', 'A versioned compiler browser artifact is required');
    const model = parseJson(await this.#file(reference(a.modelRef, 'models').path, pending));
    const bundle = await this.#file(reference(a.bundleRef, 'bundles').path, pending);
    const runtimeRef = reference(a.runtimeRef, 'runtimes'), runtime = await this.#file(runtimeRef.path, pending);
    const toolchain = object(a.toolchain, 'registration'), plan = object(a.plan, 'registration');
    seed(a.defaultSeed);
    if (toolchain.compiler !== '0.1.0' || toolchain.businessIr !== model.version || typeof toolchain.plugin !== 'string' || !toolchain.plugin || typeof toolchain.browserRuntime !== 'string' || !toolchain.browserRuntime || toolchain.runtimeSha256 !== runtimeRef.sha256 || await sha(runtime) !== toolchain.runtimeSha256) fail('artifact_identity', 'registration', 'Compiler and frozen runtime identity mismatch');
    if (model.version !== 'aircraft-business-ir/v1' || model.fingerprint !== a.businessFingerprint || (model.payload?.sections?.$root?.properties?.seed ?? 0) !== a.defaultSeed) fail('artifact_identity', 'registration', 'Business identity or seed does not match the artifact');
    if (plan.plan_version !== toolchain.planIr || plan.semantic_profile !== toolchain.profile || !Number.isInteger(plan.duration_minutes) || plan.duration_minutes < 1 || plan.duration_minutes > 10080 || plan.natural_completion_enabled || !Array.isArray(plan.phases) || plan.phases.length > 64 || !plan.phases.every((v: unknown) => typeof v === 'string') || new Set(plan.phases).size !== plan.phases.length) fail('artifact_identity', 'registration', 'A bounded duration Plan with explicit ordered phases is required');
    let members: Record<string, Uint8Array>;
    const names = ['business.json', 'core.json', 'plan.json', 'lineage.json', 'manifest.json'], seen = new Set<string>();
    let total = 0;
    try {
      members = unzipSync(bundle, { filter(file) {
        total += file.originalSize;
        if (!names.includes(file.name) || seen.has(file.name) || file.originalSize > 512 * 1024 || total > 2 * 1024 * 1024) fail('invalid_bundle', 'registration', 'Compiler bundle has unexpected or oversized members');
        seen.add(file.name); return true;
      } });
    } catch (error) { if (error instanceof IrFault) throw error; return fail('invalid_bundle', 'registration', 'Compiler bundle is invalid'); }
    if (seen.size !== names.length) fail('invalid_bundle', 'registration', 'Compiler bundle must contain exactly five members');
    const manifest = parseJson(members['manifest.json']!), bundleModel = parseJson(members['business.json']!), bundlePlan = parseJson(members['plan.json']!);
    if (manifest.schema_version !== 'sim-engine-model-bundle/v1' || manifest.compiler_version !== toolchain.compiler || manifest.domain_pack?.version !== toolchain.domainPack || manifest.ir_versions?.plan !== plan.plan_version || canonical(manifest) !== canonical(toolchain.manifest) || manifest.identity?.business_fingerprint !== a.businessFingerprint || manifest.identity?.plan_fingerprint !== a.planFingerprint || canonical(bundleModel) !== canonical(model) || canonical(bundlePlan) !== canonical(plan)) fail('artifact_identity', 'registration', 'The artifact graph does not match the inspected compiler bundle');
    const hashes = keys(manifest.files, names.filter(n => n !== 'manifest.json'), [], 'registration');
    for (const name of names.filter(n => n !== 'manifest.json')) if (hashes[name] !== await sha(members[name]!)) fail('artifact_integrity', 'registration', 'Compiler bundle member checksum mismatch');
    const previous = await this.#read<ArtifactPointer>(await this.#artifactKey(path));
    const frozen = { ref: path, worker, runtime: runtimeRef.path, planFingerprint: a.planFingerprint, businessFingerprint: a.businessFingerprint };
    if (previous && canonical(previous) !== canonical(frozen)) fail('artifact_conflict', 'registration', 'The worker and runtime of an existing artifact are immutable');
    return frozen;
  }
  async #responseEffect(requestSha256: string, response: Obj): Promise<Effect> {
    return { requestSha256, response: await this.#immutable(encoder.encode(bounded(response, PROJECT_IR_TOOL_MAX_BYTES, 'response_limit'))) };
  }
  async #execute(raw: unknown, max: number, action: () => Promise<Obj>): Promise<Obj> {
    const result = (storageQueues.get(this.#storage) ?? Promise.resolve()).then(async () => {
      let value: Obj;
      try { bounded(raw, PROJECT_IR_INPUT_MAX_BYTES); await this.#auth(); value = await action(); }
      catch (error) {
        if (error instanceof IrCommitUnknown) throw error;
        const fault = error instanceof IrFault ? error : new IrFault('storage_failed', 'storage', 'The operation could not be durably completed');
        return { status: 'failed', diagnostics: [{ code: fault.code, stage: fault.stage, message: fault.message }] };
      }
      // The action may already have published its original effect/run. Delivery
      // failures must escape to the host's unknown/observe path, never replace
      // that committed result with a determinate business failure.
      bounded(value, max, 'response_limit'); await this.#auth(); return structuredClone(value);
    });
    storageQueues.set(this.#storage, result.catch(() => {})); return result;
  }
  async register(raw: { effectId: string; registration: unknown }): Promise<Obj> {
    return this.#execute(raw, PROJECT_IR_TOOL_MAX_BYTES, async () => {
      const input = keys(raw, ['effectId', 'registration']), registration = keys(input.registration, ['schema', 'files', 'state', 'workerSource']);
      const effectKey = await this.#effectKey(input.effectId), requestSha256 = await sha(canonical({ actor: this.#actor, operation: 'register', registration }));
      const previous = await this.#read<Effect>(effectKey);
      if (previous) { if (previous.requestSha256 !== requestSha256) fail('effect_conflict', 'register', 'The effect ID is already bound to different input'); return this.#json(previous.response); }
      if (registration.schema !== 'riffoid-ir.registration/v1' || !Array.isArray(registration.files) || registration.files.length > 32) fail('invalid_registration', 'registration', 'A bounded versioned IR registration is required');
      const state = keys(registration.state, ['draft', 'modelMode', 'currentModel', 'toolchain']);
      if (state.draft !== null && typeof state.draft !== 'string' || !['ir', 'code'].includes(state.modelMode) || state.currentModel !== null && !object(state.currentModel) || state.toolchain !== null && !object(state.toolchain) || registration.workerSource !== null && typeof registration.workerSource !== 'string') fail('invalid_registration', 'registration', 'Invalid project IR state');
      const index = await this.#index();
      if (index.effects >= MAX_EFFECTS || index.registrations >= 1024) fail('registration_limit', 'registration', 'The bounded registration/effect limit has been reached');
      const pending = new Map<string, Uint8Array>();
      for (const rawFile of registration.files) {
        const file = keys(rawFile, ['path', 'base64', 'sha256']), ref = reference(file.path), bytes = decodeBase64(file.base64);
        if (pending.has(ref.path) || file.sha256 !== ref.sha256 || await sha(bytes) !== ref.sha256) fail('artifact_integrity', 'registration', 'Duplicate file or content-address mismatch');
        pending.set(ref.path, bytes);
      }
      const artifacts = [...pending.keys()].filter(path => path.startsWith('.riffoid-ir/artifacts/'));
      if (artifacts.length && !registration.workerSource) fail('invalid_registration', 'registration', 'Compiled artifacts require their frozen worker source');
      const worker = registration.workerSource === null ? undefined : { sha256: await sha(registration.workerSource), byteLength: encoder.encode(registration.workerSource).byteLength };
      const frozen: ArtifactPointer[] = [];
      for (const path of artifacts) frozen.push(await this.#validateArtifact(path, pending, worker!));
      let newArtifacts = 0;
      for (const item of frozen) if (!await this.#read(await this.#artifactKey(item.ref))) newArtifacts++;
      if (index.artifacts + newArtifacts > 256) fail('artifact_limit', 'registration', 'The bounded artifact limit has been reached');
      const entries: [string, unknown][] = [];
      for (const [path, bytes] of pending) { const pointer = await this.#immutable(bytes); entries.push([await this.#fileKey(path), { ...pointer, path }]); }
      if (worker) await this.#immutable(encoder.encode(registration.workerSource));
      for (const item of frozen) entries.push([await this.#artifactKey(item.ref), item]);
      const previousProjection = await this.#read<Pointer>('projection');
      const previousState = state.toolchain === null && previousProjection ? await this.#json(previousProjection) : null;
      const projectionState = { ...state, toolchain: state.toolchain ?? previousState?.toolchain ?? null };
      const projection = await this.#immutable(encoder.encode(canonical(projectionState)));
      const response = { status: 'succeeded', diagnostics: [], registered: pending.size, browserArtifactRefs: artifacts };
      entries.push(['projection', projection], [effectKey, await this.#responseEffect(requestSha256, response)], ['index', { ...index, effects: index.effects + 1, registrations: index.registrations + 1, artifacts: index.artifacts + newArtifacts }]);
      await this.#commit(entries); return response;
    });
  }
  async #runEntry(runId: unknown): Promise<RunEntry> {
    if (typeof runId !== 'string' || !runPattern.test(runId)) fail('invalid_run_id', 'load', 'A returned runId is required');
    const value = await this.#read<RunEntry>('runs/' + runId);
    if (!value || value.record.runId !== runId) fail('run_not_found', 'load', 'The run is not present in this workspace generation');
    return value;
  }
  async #record(entry: RunEntry): Promise<Obj> { return entry.terminal ? this.#json(entry.terminal) : structuredClone(entry.record); }
  async #terminal(entry: RunEntry, record: Obj, submitSha256?: string): Promise<Obj> {
    bounded(record, PROJECT_IR_TOOL_MAX_BYTES, 'response_limit');
    const terminal = await this.#immutable(encoder.encode(canonical(record)));
    await this.#commit([['runs/' + record.runId, { record: summary(record), terminal, ...(submitSha256 ? { submitSha256 } : {}) } satisfies RunEntry]]);
    return record;
  }
  async #expire(): Promise<void> {
    const index = await this.#index(), now = this.#now();
    for (const runId of index.runIds) {
      const entry = await this.#runEntry(runId), r = entry.record;
      if (['pending', 'running'].includes(r.status) && now - r.lastSeen >= PROJECT_IR_LEASE_MS) await this.#terminal(entry, { ...r, status: 'interrupted', finishedAt: new Date(now).toISOString(), diagnostics: [{ code: 'browser_disconnected', stage: 'run', message: 'Browser lease expired; an explicit replay is required' }] });
    }
  }
  async #clients(): Promise<Client[]> { const now = this.#now(); return (await this.#read<Client[]>('clients') ?? []).filter(c => now - c.lastSeen < PROJECT_IR_LEASE_MS); }
  async #ownClients(): Promise<Client[]> { return (await this.#clients()).filter(c => sameActor(c.actor, this.#actor)); }
  async #result(input: unknown, expire = true): Promise<Obj> { const i = keys(input, ['runId']); if (expire) await this.#expire(); return this.#record(await this.#runEntry(i.runId)); }
  async tool(raw: { effectId: string; operation: string; input: unknown; observeOnly?: boolean }): Promise<Obj> {
    return this.#execute(raw, PROJECT_IR_TOOL_MAX_BYTES, async () => {
      const i = keys(raw, ['effectId', 'operation', 'input'], ['observeOnly']);
      if (i.observeOnly !== undefined && typeof i.observeOnly !== 'boolean') fail('invalid_input', 'tool', 'observeOnly must be boolean');
      if (!['project_ir_run', 'project_ir_result'].includes(i.operation)) fail('unknown_operation', 'tool', 'Only durable run and result operations are supported');
      const effectKey = await this.#effectKey(i.effectId), requestSha256 = await sha(canonical({ actor: this.#actor, operation: i.operation, input: i.input })), old = await this.#read<Effect>(effectKey);
      if (old) { if (old.requestSha256 !== requestSha256) fail('effect_conflict', 'tool', 'The effect ID is already bound to a different operation or input'); return this.#json(old.response); }
      if (i.observeOnly) return { status: 'absent', observed: true, diagnostics: [{ code: 'effect_absent', stage: 'observe', message: 'No durable effect exists for this operation' }] };
      const index = await this.#index(); if (index.effects >= MAX_EFFECTS) fail('effect_limit', 'tool', 'The bounded effect limit has been reached');
      if (i.operation === 'project_ir_result') {
        const response = await this.#result(i.input); await this.#commit([[effectKey, await this.#responseEffect(requestSha256, response)], ['index', { ...await this.#index(), effects: index.effects + 1 }]]); return response;
      }
      const input = keys(i.input, [], ['browserArtifactRef', 'sourceRunId', 'runOptions']);
      const hasSource = Object.hasOwn(input, 'sourceRunId'), hasArtifact = Object.hasOwn(input, 'browserArtifactRef');
      if (hasSource === hasArtifact || hasSource && Object.hasOwn(input, 'runOptions')) fail('invalid_run_input', 'run', 'Choose an artifact with optional seed, or sourceRunId alone');
      if (input.runOptions !== undefined) keys(input.runOptions, [], ['seed']);
      await this.#expire();
      const source = hasSource ? await this.#result({ runId: input.sourceRunId }, false) : undefined;
      const artifactRef = source?.browserArtifactRef ?? input.browserArtifactRef, graph = await this.#graph(artifactRef), artifact = graph.artifact;
      const runSeed = seed(source?.inputs.seed ?? input.runOptions?.seed ?? artifact.defaultSeed);
      if (source && (source.workerSha256 !== graph.frozen.worker.sha256 || source.runtimeRef !== artifact.runtimeRef || source.planFingerprint !== artifact.planFingerprint)) fail('artifact_integrity', 'run', 'The source run frozen identity is unavailable');
      if (!(await this.#ownClients()).length) {
        const response = { accepted: false, diagnostics: [{ code: 'browser_not_connected', stage: 'run', message: 'Open the IR Model project page before running' }] };
        await this.#commit([[effectKey, await this.#responseEffect(requestSha256, response)], ['index', { ...await this.#index(), effects: index.effects + 1 }]]); return response;
      }
      const latest = await this.#index();
      if (latest.runIds.length >= PROJECT_IR_RUN_LIMIT) fail('run_limit', 'run', 'The project has reached its 200 run limit');
      let active = 0; for (const id of latest.runIds) if (['pending', 'running'].includes((await this.#runEntry(id)).record.status)) active++;
      if (active >= MAX_ACTIVE_RUNS) fail('run_queue_limit', 'run', 'At most eight pending/running browser runs are allowed');
      const identity = await sha(canonical({ scope: this.#scope, actor: this.#actor, effectId: i.effectId }));
      const runId = `run-${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20, 32)}`;
      const now = this.#now(), record = { runId, actor: this.#actor, ...(source ? { sourceRunId: source.runId } : {}), modelRef: artifact.modelRef, bundleRef: artifact.bundleRef, browserArtifactRef: artifactRef, runtimeRef: artifact.runtimeRef, workerRef: `.riffoid-ir/workers/${graph.frozen.worker.sha256}/worker.js`, workerSha256: graph.frozen.worker.sha256, toolchain: artifact.toolchain, inputs: { seed: runSeed }, businessFingerprint: artifact.businessFingerprint, planFingerprint: artifact.planFingerprint, execution: { location: 'user-browser', host: 'riffoid', runtimeVersion: artifact.toolchain.browserRuntime, verification: 'local-unverified' }, status: 'pending', diagnostics: [], createdAt: new Date(now).toISOString(), lastSeen: now, recordRef: `.riffoid-ir/runs/${runId}/record.json` };
      const response = { accepted: true, runId, status: 'pending', diagnostics: [] };
      await this.#commit([['runs/' + runId, { record } satisfies RunEntry], [effectKey, await this.#responseEffect(requestSha256, response)], ['index', { ...latest, runIds: [...latest.runIds, runId], effects: latest.effects + 1 }]]);
      return response;
    });
  }
  async browser(raw: { operation: string; input?: unknown }): Promise<Obj> {
    return this.#execute(raw, PROJECT_IR_BROWSER_MAX_BYTES, async () => {
      const i = keys(raw, ['operation'], ['input']), input = i.input ?? {};
      switch (i.operation) {
        case 'show': {
          keys(input, []); const pointer = await this.#read<Pointer>('projection'), state = pointer ? await this.#json(pointer) : { draft: null, modelMode: 'code', currentModel: null, toolchain: null };
          return { defaultMode: state.modelMode, currentModel: state.currentModel, toolchain: state.toolchain, domains: ['aircraft-support-pack/v0.1'], execution: 'user-browser', compiler: { ready: state.toolchain?.compiler === '0.1.0', version: state.toolchain?.compiler ?? null }, runtimeVersion: state.toolchain?.browserRuntime ?? null, browserConnected: (await this.#ownClients()).length > 0 };
        }
        case 'draft': {
          keys(input, []); const pointer = await this.#read<Pointer>('projection'); return { draft: pointer ? (await this.#json(pointer)).draft : null };
        }
        case 'records': {
          keys(input, []); await this.#expire(); const index = await this.#index(), records = [];
          for (const id of index.runIds.slice(-50)) records.push(structuredClone((await this.#runEntry(id)).record));
          return { records };
        }
        case 'project_ir_result': return this.#result(input);
        case 'heartbeat': return this.#heartbeat(input);
        case 'submit': return this.#submit(input);
        case 'detach': {
          const value = keys(input, ['clientId']), clientId = this.#clientId(value.clientId);
          await this.#commit([['clients', (await this.#clients()).filter(c => c.clientId !== clientId || !sameActor(c.actor, this.#actor))]]);
          for (const id of (await this.#index()).runIds) {
            const entry = await this.#runEntry(id), r = entry.record;
            if (r.status === 'running' && r.clientId === clientId && sameActor(r.actor, this.#actor)) await this.#terminal(entry, { ...r, status: 'interrupted', finishedAt: new Date(this.#now()).toISOString(), diagnostics: [{ code: 'browser_closed', stage: 'run', message: 'The executing browser page was closed' }] });
          }
          return { disconnected: true };
        }
        default: return fail('unknown_operation', 'browser', 'Unsupported browser operation');
      }
    });
  }
  #clientId(raw: unknown): string { if (typeof raw !== 'string' || !clientPattern.test(raw)) fail('invalid_client', 'browser', 'A UUID browser client ID is required'); return raw; }
  async #heartbeat(raw: unknown): Promise<Obj> {
    const value = keys(raw, ['clientId']), clientId = this.#clientId(value.clientId); await this.#expire();
    const now = this.#now(), clients = await this.#clients(), old = clients.find(c => c.clientId === clientId);
    if (old && !sameActor(old.actor, this.#actor)) fail('client_conflict', 'browser', 'This client lease belongs to a different actor or authVersion');
    if (!old && clients.length >= MAX_CLIENTS) fail('browser_limit', 'browser', 'At most eight browser clients may hold a lease');
    const fresh = [...clients.filter(c => c.clientId !== clientId), { clientId, lastSeen: now, actor: this.#actor }], index = await this.#index();
    let pending: RunEntry | undefined;
    for (const id of index.runIds) {
      const entry = await this.#runEntry(id);
      if (entry.record.status === 'running' && entry.record.clientId === clientId && sameActor(entry.record.actor, this.#actor)) { await this.#commit([['clients', fresh], ['runs/' + id, { ...entry, record: { ...entry.record, lastSeen: now } }]]); return { connected: true }; }
      if (!pending && entry.record.status === 'pending' && sameActor(entry.record.actor, this.#actor)) pending = entry;
    }
    if (!pending) { await this.#commit([['clients', fresh]]); return { connected: true }; }
    const graph = await this.#graph(pending.record.browserArtifactRef), record: Obj = { ...pending.record, status: 'running', clientId, lastSeen: this.#now() };
    const response = { connected: true, run: record, artifact: graph.artifact, runtimeSource: graph.runtimeSource, workerSource: graph.workerSource };
    bounded(response, PROJECT_IR_BROWSER_MAX_BYTES, 'response_limit');
    await this.#commit([['clients', fresh.map(c => c.clientId === clientId ? { ...c, lastSeen: record.lastSeen } : c)], ['runs/' + record.runId, { record } satisfies RunEntry]]);
    return response;
  }
  async #submit(raw: unknown): Promise<Obj> {
    const i = keys(raw, ['runId', 'clientId'], ['result', 'error']), clientId = this.#clientId(i.clientId);
    if (Object.hasOwn(i, 'result') === Object.hasOwn(i, 'error')) fail('invalid_submission', 'save', 'Submit exactly one result or error');
    const submitSha256 = await sha(canonical(i)), before = await this.#runEntry(i.runId);
    if (!sameActor(before.record.actor, this.#actor)) fail('run_not_owned', 'save', 'This run belongs to a different actor or authVersion');
    if (before.terminal && before.submitSha256 === submitSha256 && before.record.clientId === clientId) return this.#record(before);
    if (before.terminal) fail('submission_conflict', 'save', 'The run already has a different terminal outcome');
    await this.#expire(); const entry = await this.#runEntry(i.runId), record = entry.record;
    if (record.status !== 'running' || record.clientId !== clientId) fail('run_not_owned', 'save', 'The run is no longer owned by this browser');
    let terminal: Obj;
    if (Object.hasOwn(i, 'error')) terminal = { ...record, status: 'failed', diagnostics: [{ code: 'browser_execution_failed', stage: 'run', message: text(i.error, 4000) }] };
    else {
      const result = keys(i.result, ['runtimeVersion', 'planFingerprint', 'seed', 'stopReason', 'metrics', 'events', 'terminalState']), graph = await this.#graph(record.browserArtifactRef), duration = graph.artifact.plan.duration_minutes;
      const metrics = object(result.metrics, 'save'); object(result.terminalState, 'save');
      if (result.runtimeVersion !== record.toolchain.browserRuntime || result.planFingerprint !== record.planFingerprint || result.seed !== record.inputs.seed || result.stopReason !== 'duration' || Object.keys(metrics).length < 1 || Object.keys(metrics).length > 64 || !Object.values(metrics).every(v => typeof v === 'number' && Number.isFinite(v)) || metrics.elapsed_minutes !== duration || !Array.isArray(result.events) || !result.events.length) fail('result_mismatch', 'save', 'Result identity, seed and duration metrics must match the frozen run');
      bounded(result.events, PROJECT_IR_EVENT_MAX_BYTES, 'event_limit');
      const phases: string[] = graph.artifact.plan.phases; let previousTime = -1, previousPhase = -1;
      for (let n = 0; n < result.events.length; n++) {
        const e = object(result.events[n], 'save'), phase = e.phase === 'initialize' ? -1 : phases.indexOf(e.phase);
        if (e.sequence !== n + 1 || typeof e.time !== 'number' || !Number.isFinite(e.time) || e.time < 0 || e.time > duration || e.time < previousTime || typeof e.phase !== 'string' || phase < 0 && e.phase !== 'initialize' || e.time === previousTime && phase < previousPhase || !['phase', 'kind', 'entity'].every(k => typeof e[k] === 'string' && e[k].length > 0 && e[k].length <= 256)) fail('result_mismatch', 'save', 'Events must preserve finite times, sequence and frozen phase ordering');
        previousPhase = phase; previousTime = e.time;
      }
      const last = result.events.at(-1);
      if (last.time !== duration || last.phase !== 'stop' || last.kind !== 'simulation_stopped') fail('result_mismatch', 'save', 'A duration terminal event is required');
      terminal = { ...record, status: 'succeeded', metrics, events: result.events, terminalState: result.terminalState, stopReason: result.stopReason };
    }
    terminal.finishedAt = new Date(this.#now()).toISOString();
    return this.#terminal(entry, terminal, submitSha256);
  }
}
