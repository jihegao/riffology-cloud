import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, realpath, readdir, rm } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { invokeCompiler, compilerConfig, VERSION } from './compiler.mjs';
import { planDiagnostics, RUNTIME_VERSION } from '../browser/runtime.js';
import { domainPack, domainDevelopment } from './domain-pack.mjs';
import { summarize } from './model-summary.mjs';
export { summarize } from './model-summary.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const diagnostic = (code, stage, message, path) => ({ code, stage, message, ...path ? { path } : {} });
export class IrError extends Error {
  constructor(code, stage, message, path) { super(message); this.diagnostics = [diagnostic(code, stage, message, path)]; }
}

export class IrProject {
  constructor(workspace, { compiler = invokeCompiler, now = Date.now, host = 'pi-web', leaseMs = 12_000 } = {}) {
    this.workspace = resolve(workspace); this.compiler = compiler; this.now = now; this.host = host; this.leaseMs = leaseMs;
    this.clients = new Map(); this.tail = Promise.resolve();
  }
  exclusive(callback) {
    const result = this.tail.then(callback); this.tail = result.catch(() => {}); return result;
  }
  async path(ref) {
    if (typeof ref !== 'string' || !ref || ref.includes('\0') || ref.startsWith('/') || ref.split(/[\\/]/).some(x => x === '..' || x === '.git')) {
      throw new IrError('invalid_reference', 'storage', 'A workspace-relative file reference is required', String(ref));
    }
    const root = await realpath(this.workspace), target = resolve(root, ref);
    if (!relative(root, target) || relative(root, target).startsWith(`..${sep}`)) throw new IrError('invalid_reference', 'storage', 'Reference escapes the workspace', ref);
    // Check existing ancestors too, so a symlink cannot redirect a future write.
    let check = target;
    while (check !== root) {
      const actual = await realpath(check).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (actual) {
        if (actual !== root && relative(root, actual).split(sep)[0] === '..') throw new IrError('invalid_reference', 'storage', 'Symlink escapes the workspace', ref);
        break;
      }
      check = dirname(check);
    }
    return target;
  }
  async read(ref) { return JSON.parse(await readFile(await this.path(ref), 'utf8')); }
  async write(ref, value) {
    const target = await this.path(ref); await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
    return ref;
  }
  async blob(directory, name, value) {
    const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`;
    const ref = `.riffoid-ir/${directory}/${digest(bytes)}/${name}`;
    await this.write(ref, bytes); return ref;
  }
  async ready(signal) {
    const result = await this.compiler('probe', '-', undefined, signal);
    return result.version === '0.1.0' ? { ready: true, version: result.version, sdkModule: result.module } : { ready: false, diagnostics: result.diagnostics };
  }
  async show(signal) {
    const settings = await this.read('.riffoid-ir/settings.json').catch(() => ({ mode: 'code' }));
    const draft = await this.read('model/business-ir.draft.json').catch(() => undefined);
    return { defaultMode: settings.mode, currentModel: draft ? { type: draft.version === 'aircraft-business-ir/v1' ? 'ir' : 'unknown',
      ref: 'model/business-ir.draft.json', fingerprint: draft.fingerprint, summary: summarize(draft) } : null,
      domains: ['aircraft-support-pack/v0.1'], execution: 'user-browser', compiler: await this.ready(signal),
      browserConnected: [...this.clients.values()].some(x => this.now() - x.seen < this.leaseMs), runtimeVersion: RUNTIME_VERSION,
      capabilities: domainPack, development: domainDevelopment() };
  }
  async setMode(mode) {
    if (!['ir', 'code'].includes(mode)) throw new IrError('invalid_mode', 'command', 'Use /sim ir, /sim code or /sim show');
    await this.write('.riffoid-ir/settings.json', { mode }); return { defaultMode: mode, appliesTo: 'subsequent-new-models', existingModelConverted: false };
  }
  async seedExample() {
    const ref = 'model/business-ir.draft.json';
    try { await readFile(await this.path(ref)); throw new IrError('draft_exists', 'model', 'An existing draft is preserved; edit it or choose a new workspace', ref); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { draftRef: await this.write(ref, await readFile(new URL('../acceptance/b1/business-ir.json', import.meta.url), 'utf8')) };
  }
  async check({ draftRef }, signal) {
    const report = await this.compiler('check', await this.path(draftRef), undefined, signal);
    if (report.status !== 'passed') return report;
    const sealedRef = await this.blob('models', 'business.json', report.sealed);
    await this.write('model/business-ir.json', report.sealed);
    return { status: 'passed', diagnostics: report.diagnostics, sealedRef, identity: report.identity };
  }
  async compile({ sealedRef }, signal) {
    await this.assertBlob(sealedRef, 'models', 'business.json');
    const tempRef = `.riffoid-ir/tmp/${randomUUID()}.simpack`, target = await this.path(tempRef);
    await mkdir(dirname(target), { recursive: true });
    try {
      const report = await this.compiler('compile', await this.path(sealedRef), target, signal);
      if (report.status !== 'succeeded') return report;
      const capability = planDiagnostics(report.plan);
      if (capability.length) return { status: 'failed', diagnostics: capability, compilerInspection: report.inspection,
        capabilityGap: { layer: 'browser-runtime', runtimeVersion: RUNTIME_VERSION, planVersion: report.plan.plan_version },
        capabilities: domainPack, development: domainDevelopment() };
      const bytes = await readFile(target);
      const bundleRef = await this.blob('bundles', 'model.simpack', bytes);
      const runtime = await readFile(new URL('../browser/runtime.js', import.meta.url), 'utf8');
      const runtimeRef = await this.blob('runtimes', 'runtime.js', runtime);
      const config = await compilerConfig();
      if (config.packageSha256 !== undefined && !/^[a-f0-9]{64}$/.test(config.packageSha256)) throw new IrError('invalid_package_identity', 'compile', 'Pinned package SHA-256 is invalid');
      const toolchain = { plugin: VERSION, ...config.packageSha256 ? { packageSha256: config.packageSha256 } : {}, domainPack: 'aircraft-support-pack/v0.1', compiler: '0.1.0',
        businessIr: report.business.version, planIr: report.plan.plan_version, profile: report.plan.semantic_profile,
        browserRuntime: RUNTIME_VERSION, runtimeSha256: digest(runtime),
        compilerArtifact: config.wheelSha256 ? { wheelSha256: config.wheelSha256, mode: config.mode } : { mode: 'installed-sdk' }, manifest: report.manifest };
      const artifact = { version: 'riffoid-browser-artifact/v1', modelRef: sealedRef, bundleRef, runtimeRef, toolchain,
        businessFingerprint: report.report.business_fingerprint, planFingerprint: report.report.plan_fingerprint,
        defaultSeed: report.business.payload.sections.$root.properties.seed ?? 0,
        plan: report.plan, lineage: report.lineage };
      const browserArtifactRef = await this.blob('artifacts', 'browser.json', artifact);
      await this.write('model/model.simpack', bytes);
      await this.write('model/browser-artifact.json', { browserArtifactRef });
      await this.write('model/model-spec.json', { schemaVersion: 1, researchQuestion: 'How do aircraft support and mission timing affect sorties?',
        scope: 'Synthetic B1 daily aircraft support', entities: ['aircraft', 'mission', 'support job'], mechanisms: ['daily support and mission dispatch'],
        assumptions: ['deterministic single-day B1'], limitations: ['Synthetic browser result; local/unverified'],
        execution: { kind: 'compiler-v01', businessIr: 'model/business-ir.json', bundle: 'model/model.simpack' }, parameters: {},
        metrics: Object.fromEntries(['planned_sorties', 'launched_sorties', 'completed_sorties', 'successful_mission_waves', 'cancelled_sorties', 'delayed_sorties', 'elapsed_minutes'].map(key => [key, { unit: key === 'elapsed_minutes' ? 'minute' : 'count' }])) });
      return { status: 'succeeded', diagnostics: report.diagnostics, bundleRef, browserArtifactRef, toolchain,
        businessFingerprint: artifact.businessFingerprint, planFingerprint: artifact.planFingerprint };
    } finally { await rm(target, { force: true }); }
  }
  async assertBlob(ref, directory, name) {
    const pattern = new RegExp(`^\\.riffoid-ir/${directory}/([a-f0-9]{64})/${name.replace('.', '\\.')}\$`);
    const match = typeof ref === 'string' && ref.match(pattern);
    if (!match || digest(await readFile(await this.path(ref))) !== match[1]) throw new IrError('artifact_integrity', 'load', 'Immutable reference is missing, invalid or has changed', ref);
  }
  runRef(runId) {
    if (typeof runId !== 'string' || !/^run-[a-f0-9-]{36}$/.test(runId)) throw new IrError('invalid_run_id', 'load', 'A returned runId is required', String(runId));
    return `.riffoid-ir/runs/${runId}/record.json`;
  }
  async result({ runId }) {
    const record = await this.read(this.runRef(runId));
    if (['pending', 'running'].includes(record.status) && this.now() - record.lastSeen > this.leaseMs) {
      record.status = 'interrupted'; record.diagnostics = [diagnostic('browser_disconnected', 'run', 'Browser did not complete within its connection lease; submit an explicit replay')];
      await this.write(record.recordRef, record);
    }
    return record;
  }
  async run(input) {
    if (Object.keys(input).some(key => !['sourceRunId', 'browserArtifactRef', 'runOptions'].includes(key))) throw new IrError('invalid_run_input', 'run', 'Only artifact, sourceRunId and seed are accepted');
    if (Boolean(input.sourceRunId) === Boolean(input.browserArtifactRef) || input.sourceRunId && input.runOptions) throw new IrError('invalid_run_input', 'run', 'Choose a new artifact with optional seed, or sourceRunId alone');
    if (input.runOptions && (Object.keys(input.runOptions).some(x => x !== 'seed') || typeof input.runOptions !== 'object')) throw new IrError('unsupported_run_option', 'run', 'Business inputs must be edited in the draft and recompiled; only seed is supported');
    const source = input.sourceRunId ? await this.result({ runId: input.sourceRunId }) : undefined;
    const artifactRef = source?.browserArtifactRef || input.browserArtifactRef;
    await this.assertBlob(artifactRef, 'artifacts', 'browser.json');
    const artifact = await this.read(artifactRef);
    await this.assertBlob(artifact.modelRef, 'models', 'business.json');
    await this.assertBlob(artifact.bundleRef, 'bundles', 'model.simpack');
    await this.assertBlob(artifact.runtimeRef, 'runtimes', 'runtime.js');
    const seed = source?.inputs.seed ?? input.runOptions?.seed ?? artifact.defaultSeed;
    if (!Number.isSafeInteger(seed) || seed < 0) throw new IrError('invalid_seed', 'run', 'seed must be a nonnegative safe integer');
    if (![...this.clients.values()].some(x => this.now() - x.seen < this.leaseMs)) return { accepted: false, diagnostics: [diagnostic('browser_not_connected', 'run', 'Open the IR Model panel or the project browser page before running')] };
    const runId = `run-${randomUUID()}`, recordRef = this.runRef(runId);
    const record = { runId, ...source ? { sourceRunId: source.runId } : {}, modelRef: artifact.modelRef, bundleRef: artifact.bundleRef,
      browserArtifactRef: artifactRef, runtimeRef: artifact.runtimeRef, toolchain: artifact.toolchain, inputs: { seed },
      businessFingerprint: artifact.businessFingerprint, planFingerprint: artifact.planFingerprint,
      execution: { location: 'user-browser', host: this.host, runtimeVersion: artifact.toolchain.browserRuntime, verification: 'local-unverified' },
      status: 'pending', diagnostics: [], createdAt: new Date(this.now()).toISOString(), lastSeen: this.now(), recordRef };
    await this.write(recordRef, record);
    return { accepted: true, runId, status: 'pending', diagnostics: [] };
  }
  async records() {
    const names = await readdir(await this.path('.riffoid-ir/runs')).catch(() => []);
    return Promise.all(names.filter(x => /^run-[a-f0-9-]{36}$/.test(x)).sort().map(runId => this.result({ runId })));
  }
  async heartbeat({ clientId }) {
    if (typeof clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(clientId)) throw new IrError('invalid_client', 'browser', 'Random browser client ID required');
    const client = this.clients.get(clientId) || {};
    client.seen = this.now(); this.clients.set(clientId, client);
    for (const [id, stale] of this.clients) if (this.now() - stale.seen > this.leaseMs) this.clients.delete(id);
    const records = await this.records();
    const owned = records.find(r => r.status === 'running' && r.clientId === clientId);
    if (owned) { owned.lastSeen = this.now(); await this.write(owned.recordRef, owned); return { connected: true }; }
    const pending = records.find(r => r.status === 'pending');
    if (!pending) return { connected: true };
    pending.status = 'running'; pending.clientId = clientId; pending.lastSeen = this.now();
    await this.write(pending.recordRef, pending);
    return { connected: true, run: pending, artifact: await this.read(pending.browserArtifactRef) };
  }
  async submit({ runId, clientId, result, error }) {
    const record = await this.result({ runId });
    if (record.status !== 'running' || record.clientId !== clientId) throw new IrError('run_not_owned', 'save', 'Run is no longer executing for this browser', runId);
    if (error) {
      record.status = 'failed'; record.diagnostics = [diagnostic('browser_execution_failed', 'run', String(error).slice(0, 4000))];
    } else {
      if (!result || result.runtimeVersion !== record.toolchain.browserRuntime || result.planFingerprint !== record.planFingerprint
        || result.seed !== record.inputs.seed || result.stopReason !== 'duration' || !Array.isArray(result.events) || !result.metrics
        || !Object.values(result.metrics).every(x => typeof x === 'number' && Number.isFinite(x))
        || result.events.some((e, i) => e.sequence !== i + 1 || !Number.isFinite(e.time) || !['phase', 'kind', 'entity'].every(key => typeof e[key] === 'string'))) {
        throw new IrError('result_mismatch', 'save', 'Result identity, input or event structure does not match the claimed run', runId);
      }
      Object.assign(record, { status: 'succeeded', metrics: result.metrics, events: result.events, terminalState: result.terminalState, stopReason: result.stopReason });
    }
    record.finishedAt = new Date(this.now()).toISOString();
    // Success is returned only after the complete record is atomically saved.
    await this.write(record.recordRef, record); return record;
  }
  async detach({ clientId }) {
    this.clients.delete(clientId);
    for (const record of await this.records()) if (record.status === 'running' && record.clientId === clientId) {
      record.status = 'interrupted'; record.diagnostics = [diagnostic('browser_closed', 'run', 'The executing browser page was closed')];
      await this.write(record.recordRef, record);
    }
    return { disconnected: true };
  }
  async interruptAll() {
    for (const record of await this.records()) if (['pending', 'running'].includes(record.status)) {
      record.status = 'interrupted'; record.diagnostics = [diagnostic('host_stopped', 'run', 'The host stopped before a result was saved')];
      await this.write(record.recordRef, record);
    }
  }
  async operation(operation, input = {}, signal) {
    return this.exclusive(async () => {
      try {
        switch (operation) {
          case 'project_ir_check': return await this.check(input, signal);
          case 'project_ir_compile': return await this.compile(input, signal);
          case 'project_ir_run': return await this.run(input);
          case 'project_ir_result': return await this.result(input);
          case 'show': return await this.show(signal);
          case 'mode': return await this.setMode(input.mode);
          case 'example': return await this.seedExample();
          case 'draft': return { draft: await readFile(await this.path('model/business-ir.draft.json'), 'utf8') };
          case 'save-draft': if (typeof input.draft !== 'string' || input.draft.length > 1024 * 1024) throw new IrError('invalid_draft', 'save', 'Draft text limited to 1 MiB');
            return { draftRef: await this.write('model/business-ir.draft.json', input.draft) };
          case 'records': return { records: await this.records() };
          case 'heartbeat': return await this.heartbeat(input);
          case 'submit': return await this.submit(input);
          case 'detach': return await this.detach(input);
          default: throw new IrError('unknown_operation', 'request', `Unknown operation ${operation}`);
        }
      } catch (error) { return { status: 'failed', diagnostics: error.diagnostics || [diagnostic(error.code || 'operation_failed', operation, error.message, error.path)] }; }
    });
  }
}
