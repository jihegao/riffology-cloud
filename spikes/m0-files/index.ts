import { DurableObject } from 'cloudflare:workers';
import { ContainerProxy, getSandbox, Sandbox, type ExecResult } from '@cloudflare/sandbox';
import { R2Blobs, currentCheckpoint, commitCheckpoint } from '../m0-storage/adapters.ts';
import { restoreCheckpoint, saveCheckpoint, sha256, type Authority, type Receipt } from '../m0-storage/checkpoint.ts';
import { CREATE_AND_MUTATE, EXPORT_TREE, M0_RESTORE_INPUT, RESTORE_TREE_AND_VERIFY } from './runtime.ts';
import { expectedEntries, restoreDocument, treeFor, verifyExport, verifyMutation, verifyRestoration, verifyRecreatedFilesystem } from './verification.ts';
import { fileSandboxId, handleFilesRequest, type ProbeResponse } from './worker.ts';

export { ContainerProxy };
interface Env extends M0FilesEnv {
  M0_EXECUTION_ENVIRONMENT?: 'local-docker-workerd' | 'cloudflare-vm';
}
export class FileProjectSandbox extends Sandbox<Env> {
  override enableInternet = false;
  override allowedHosts: string[] = [];
  override sleepAfter = '60s';
  override envVars = {};
}
FileProjectSandbox.outbound = async () => new Response('M0 policy denied', { status: 403 });

const FRESH_FILESYSTEM = String.raw`
import json, os, hashlib, uuid
os.makedirs('/workspace', exist_ok=True)
with open('/proc/sys/kernel/random/boot_id') as source:
    boot_id = str(uuid.UUID(source.read().strip()))
print(json.dumps({'root_absent': not os.path.lexists('/workspace/m0-files'), 'staging_absent': not os.path.lexists('/workspace/m0-files-staging'), 'marker_absent': not os.path.lexists('/tmp/m0-files-boot-marker'), 'boot_id_sha256': hashlib.sha256(boot_id.encode()).hexdigest()}))
`;
function fixedJson(result: ExecResult): unknown {
  if (!result.success || result.exitCode !== 0 || result.stdout.length > 65536) throw new Error('fixed-command-failed');
  return JSON.parse(result.stdout.trim());
}
async function boundedDestroy(sandbox: FileProjectSandbox): Promise<'destroy_acknowledged' | 'cleanup_not_confirmed'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([sandbox.destroy(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('destroy-timeout')), 20000); })]);
    return 'destroy_acknowledged';
  } catch { return 'cleanup_not_confirmed'; }
  finally { clearTimeout(timer); }
}

/** One fixed experiment per DO. This is not the production durable Turn scheduler. */
export class M0FilesCoordinator extends DurableObject<Env> implements Authority {
  busy = false;
  expired = false;
  sandbox() {
    return getSandbox(this.env.FileProjectSandbox, fileSandboxId(this.ctx.id.toString()), {
      normalizeId: true, enableDefaultSession: false, keepAlive: false, sleepAfter: '60s',
    });
  }
  async destroySafely() {
    try { return await boundedDestroy(this.sandbox()); }
    catch { return 'cleanup_not_confirmed' as const; }
  }
  async current() { return currentCheckpoint(this.ctx.storage); }
  async commit(input: { revision: string; parent: string | null; generation: number }): Promise<Receipt> {
    if (this.expired || this.ctx.storage.kv.get('expired')) throw new Error('probe-expired');
    return commitCheckpoint(this.ctx.storage, input);
  }
  async phase(name: string) {
    if (this.expired || this.ctx.storage.kv.get('expired')) throw new Error('probe-expired');
    this.ctx.storage.kv.put('phase', name);
    await this.ctx.storage.sync();
  }
  async script(path: string, code: string) {
    const sandbox = this.sandbox();
    const written = await sandbox.writeFile(path, code);
    if (!written.success) throw new Error('script-write-failed');
    return fixedJson(await sandbox.exec(`python3 ${path}`, { timeout: 20000 }));
  }
  async fresh() {
    const result = await this.script('/tmp/m0-files-fresh.py', FRESH_FILESYSTEM) as Record<string, unknown>;
    if (result.root_absent !== true || result.staging_absent !== true || result.marker_absent !== true) throw new Error('filesystem-not-fresh');
    return result;
  }
  async run(): Promise<ProbeResponse> {
    const previous = this.ctx.storage.kv.get<ProbeResponse>('report');
    if (previous) return previous;
    if (this.busy || this.ctx.storage.kv.get('started')) return { status: 409, body: { error: 'run-already-started', phase: this.ctx.storage.kv.get('phase'), rerun: 'use a new run ID; clean up this run if interrupted' } };
    this.busy = true;
    const observations: Record<string, unknown> = {};
    let failureStage: string | null = null;
    let failureCode: string | null = null;
    try {
      this.ctx.storage.kv.put('started', new Date().toISOString());
      await this.ctx.storage.setAlarm(Date.now() + 180000);
      await this.ctx.storage.sync();
      await this.phase('initial-start');
      observations.initial_filesystem = await this.fresh();
      const marker = `synthetic-boot-${crypto.randomUUID()}`;
      if (!(await this.sandbox().writeFile('/tmp/m0-files-boot-marker', marker)).success) throw new Error('marker-write-failed');
      const markerRead = await this.sandbox().readFile('/tmp/m0-files-boot-marker', { encoding: 'utf-8' });
      if (!markerRead.success || markerRead.content !== marker) throw new Error('marker-verification-failed');
      observations.initial_marker_sha256 = await sha256(new TextEncoder().encode(marker));
      await this.phase('twenty-file-operations');
      const mutations = await this.script('/tmp/m0-files-mutate.py', CREATE_AND_MUTATE);
      await verifyMutation(mutations);
      observations.mutations = mutations;
      const exported = await this.script('/tmp/m0-files-export.py', EXPORT_TREE);
      const entries = await verifyExport(exported);
      observations.expected_tree = await treeFor(expectedEntries());
      observations.worker_verified_export = true;
      const blobs = new R2Blobs(this.env.CHECKPOINTS, `m0-files/${this.ctx.id.toString()}`);
      // Explicitly synthetic and created in the Worker. Never export a Session from the project VM.
      const session = new TextEncoder().encode('M0 synthetic trusted Session; real Pi integration is a separate gate.');
      await this.phase('checkpoint-before-destroy');
      const saved = await saveCheckpoint({ entries, session, generation: 1, parent: null, blobs, authority: this });
      observations.initial_receipt = saved;
      await this.phase('destroy-project-runtime');
      observations.destroy_before_restore = await this.destroySafely();
      if (observations.destroy_before_restore !== 'destroy_acknowledged') throw new Error('destroy-unconfirmed');
      this.ctx.storage.kv.put('generation', 2);
      await this.phase('restart-empty-filesystem');
      observations.recreated_filesystem = await this.fresh();
      // Cloud guests must reboot; local Docker containers share the host kernel.
      if (this.env.M0_EXECUTION_ENVIRONMENT === 'cloudflare-vm') {
        verifyRecreatedFilesystem(observations.initial_filesystem, observations.recreated_filesystem);
        observations.distinct_runtime_boot_verified = true;
      } else observations.distinct_runtime_boot_verified = false;
      await this.phase('restore-from-checkpoint');
      // Discard the exported tree as a restoration source; load and verify the committed R2 reference.
      const current = await this.current();
      if (current?.revision !== saved.revision) throw new Error('saved-pointer-changed');
      const restored = await restoreCheckpoint(blobs, current.revision);
      if (await sha256(restored.session) !== await sha256(session)) throw new Error('trusted-session-mismatch');
      const document = restoreDocument(restored.entries);
      if (!(await this.sandbox().writeFile(M0_RESTORE_INPUT, document)).success) throw new Error('restore-input-write-failed');
      const restoration = await this.script('/tmp/m0-files-restore.py', RESTORE_TREE_AND_VERIFY);
      await verifyRestoration(restoration);
      observations.restoration = restoration;
      const after = await this.script('/tmp/m0-files-export.py', EXPORT_TREE);
      const afterEntries = await verifyExport(after);
      observations.worker_verified_restored_export = true;
      await this.phase('checkpoint-after-restore');
      observations.restored_receipt = await saveCheckpoint({ entries: afterEntries, session: restored.session, generation: 2, parent: saved.revision, blobs, authority: this });
      let rejected = false;
      try { await this.commit({ revision: saved.revision, parent: null, generation: 1 }); }
      catch (error) { rejected = error instanceof Error && error.message === 'stale-generation'; }
      if (!rejected) throw new Error('old-generation-accepted');
      observations.old_generation_rejected = true;
      observations.events = Array.from(this.ctx.storage.kv.list<Receipt>({ prefix: 'events/' }), ([, receipt]) => receipt);
      if ((observations.events as Receipt[]).length !== 2) throw new Error('saved-event-count-mismatch');
      observations.current_receipt = await this.current();
      const prefix = `m0-files/${this.ctx.id.toString()}/`;
      const objects = await this.env.CHECKPOINTS.list({ prefix, limit: 100 });
      if (objects.truncated || objects.objects.some(object => !object.key.startsWith(prefix))) throw new Error('checkpoint-inventory-incomplete');
      observations.checkpoint_inventory = {
        prefix, objects: objects.objects.map(object => ({ key: object.key, size: object.size, etag: object.etag })),
        truncated: false, retention: 'retained-for-recovery-audit; sandbox cleanup does not delete R2 checkpoints',
      };
      await this.phase('verified');
    } catch (error) {
      failureStage = this.ctx.storage.kv.get<string>('phase') ?? 'setup';
      const known = ['filesystem-not-fresh', 'runtime-boot-unchanged', 'invalid-boot-observation', 'destroy-unconfirmed', 'saved-pointer-changed', 'old-generation-accepted', 'saved-event-count-mismatch', 'checkpoint-inventory-incomplete'];
      failureCode = error instanceof Error && known.includes(error.message) ? error.message : 'probe-step-failed';
    }
    const cleanup = await this.destroySafely();
    const scripts = { mutate: await sha256(new TextEncoder().encode(CREATE_AND_MUTATE)), export: await sha256(new TextEncoder().encode(EXPORT_TREE)), restore: await sha256(new TextEncoder().encode(RESTORE_TREE_AND_VERIFY)) };
    // No await between this final expiry check and storing the report.
    const passed = failureStage === null && cleanup === 'destroy_acknowledged' && !this.expired && !this.ctx.storage.kv.get('expired');
    const report: ProbeResponse = { status: passed ? 200 : 500, body: {
      schema_version: 1, protocol: 'm0-v1', operation: 'G0-T05-filesystem', observed_at: new Date().toISOString(),
      execution_environment: this.env.M0_EXECUTION_ENVIRONMENT ?? 'unrecorded',
      primitive_checks_passed: passed, gate_decision: 'not_evaluated', failure_stage: failureStage, failure_code: failureCode,
      observations, cleanup,
      script_sha256: scripts,
      limits: ['Fixed synthetic project, no concurrent untrusted writer or real Pi Session.', 'Runtime receipts are diagnostics corroborated by independently expected content hashes; no production authority is granted to stdout.', 'Local Docker/Workerd does not close cloud VM/R2 gates.', 'Destroy acknowledgement plus missing ephemeral marker and tree verifies filesystem recreation, not a cloud fault or account disaster recovery.', 'The probe does not resume an interrupted step; durable product Turn scheduling remains separate.'],
    } };
    this.ctx.storage.kv.put('report', report);
    this.busy = false;
    if (cleanup === 'destroy_acknowledged') await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.sync();
    return report;
  }
  report(): ProbeResponse {
    return this.ctx.storage.kv.get<ProbeResponse>('report') ?? { status: this.busy ? 202 : 409, body: {
      error: this.busy ? 'probe-running' : 'report-unavailable-or-interrupted', phase: this.ctx.storage.kv.get('phase') ?? null,
      gate_decision: 'not_evaluated',
    } };
  }
  async cleanup(): Promise<ProbeResponse> {
    if (this.busy) return { status: 409, body: { error: 'probe-running' } };
    this.busy = true;
    try {
      const cleanup = await this.destroySafely();
      if (cleanup === 'destroy_acknowledged') await this.ctx.storage.deleteAlarm();
      return { status: cleanup === 'destroy_acknowledged' ? 200 : 503, body: { cleanup } };
    } finally { this.busy = false; }
  }
  async alarm() {
    this.expired = true;
    this.ctx.storage.kv.put('expired', true);
    this.ctx.storage.kv.put('generation', (this.ctx.storage.kv.get<number>('generation') ?? 1) + 1);
    const cleanup = await this.destroySafely();
    this.ctx.storage.kv.put('alarm_cleanup', { cleanup, at: new Date().toISOString() });
    if (cleanup !== 'destroy_acknowledged') await this.ctx.storage.setAlarm(Date.now() + 60000);
    await this.ctx.storage.sync();
  }
}

export default {
  fetch(request: Request, env: Env) {
    const coordinator = (runId: string) => env.FILES.getByName(`m0-files-${runId}`);
    return handleFilesRequest(request, env, {
      run: runId => coordinator(runId).run(),
      report: runId => coordinator(runId).report(),
      cleanup: runId => coordinator(runId).cleanup(),
    });
  },
} satisfies ExportedHandler<Env>;
