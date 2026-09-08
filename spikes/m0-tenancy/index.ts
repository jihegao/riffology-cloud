import { DurableObject } from 'cloudflare:workers';
import { createHash } from 'node:crypto';
import { issueCapability, objectId, resourcePath, type Kind, type Tenant } from './auth.ts';
import { responseWithin, SerialLifecycle } from './core.ts';
import { handleTenancyRequest } from './worker.ts';

const encoder = new TextEncoder();
const RESOURCES: Array<{ tenant: Tenant; kind: Kind }> = [
  { tenant: 'alpha', kind: 'workspace' }, { tenant: 'alpha', kind: 'artifact' },
  { tenant: 'bravo', kind: 'workspace' }, { tenant: 'bravo', kind: 'artifact' },
];
function content(runId: string, tenant: Tenant, kind: Kind, revision: number): Uint8Array { return encoder.encode(`m0-tenancy synthetic ${runId} ${tenant} ${kind} revision-${revision}\n`); }
function key(runId: string, tenant: Tenant, kind: Kind): string { return `m0-tenancy/${runId}/${tenant}/${kind}/${objectId(tenant, kind)}`; }
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export class TenancyCoordinator extends DurableObject<M0TenancyEnv> {
  private readonly serial = new SerialLifecycle();
  private async setup(): Promise<void> {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS resources (tenant TEXT NOT NULL, kind TEXT NOT NULL, object_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY (tenant, kind))');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lifecycle (id INTEGER PRIMARY KEY CHECK (id = 1), run_id TEXT NOT NULL, closed INTEGER NOT NULL)');
  }
  private rows() { return this.ctx.storage.sql.exec('SELECT tenant, kind, object_id, revision, digest FROM resources ORDER BY tenant, kind').toArray() as Array<{ tenant: Tenant; kind: Kind; object_id: string; revision: number; digest: string }>; }
  private lifecycle() { return this.ctx.storage.sql.exec('SELECT run_id, closed FROM lifecycle WHERE id = 1').toArray()[0] as { run_id: string; closed: number } | undefined; }
  async bootstrap(runId: string) {
    const task = this.serial.enqueue(async () => {
      await this.setup();
      const life = this.lifecycle();
      if (life?.closed === 1 || life?.run_id || this.serial.wasBootstrapped()) throw new Error('run-already-bootstrapped-or-closed');
      this.serial.markBootstrapped();
      this.ctx.storage.sql.exec('INSERT INTO lifecycle (id, run_id, closed) VALUES (1, ?, 0)', runId);
    const issued: Record<string, string> = {};
    for (const resource of RESOURCES) {
      const bytes = content(runId, resource.tenant, resource.kind, 1); const object = objectId(resource.tenant, resource.kind); const existing = this.rows().find(row => row.tenant === resource.tenant && row.kind === resource.kind);
      if (existing) throw new Error('run-already-bootstrapped');
      const stored = await this.env.CHECKPOINTS.put(key(runId, resource.tenant, resource.kind), bytes, { onlyIf: { etagDoesNotMatch: '*' } });
      if (stored === null) throw new Error('r2-conditional-put-rejected');
      this.ctx.storage.sql.exec('INSERT INTO resources (tenant, kind, object_id, revision, digest) VALUES (?, ?, ?, ?, ?)', resource.tenant, resource.kind, object, 1, digest(bytes));
      issued[`${resource.tenant}-${resource.kind}`] = await issueCapability(this.env.M0_PROBE_TOKEN, { run_id: runId, tenant: resource.tenant, kind: resource.kind, object_id: object, service_path: resourcePath(runId, resource.tenant, resource.kind, object) }, Math.floor(Date.now() / 1000) + 300);
    }
    const expired = await issueCapability(this.env.M0_PROBE_TOKEN, { run_id: runId, tenant: 'alpha', kind: 'artifact', object_id: objectId('alpha', 'artifact'), service_path: resourcePath(runId, 'alpha', 'artifact', objectId('alpha', 'artifact')) }, Math.floor(Date.now() / 1000) - 1);
    return { run_id: runId, resources: this.rows().map(row => ({ tenant: row.tenant, kind: row.kind, object_id: row.object_id, revision: row.revision, digest: row.digest })), capabilities: issued, expired_capability: expired };
    });
    this.ctx.waitUntil(task.then(() => {}, () => {}));
    const result = await responseWithin(task, 10000);
    if (result.timedOut) throw new Error('bootstrap-timeout-unknown');
    return result.value;
  }
  async cleanup(runId: string) {
    const task = this.serial.enqueue(async () => {
      await this.setup();
      const life = this.lifecycle();
      if (life && life.run_id !== runId) throw new Error('run-not-active');
      // Bootstrap may never have arrived, or may still be queued behind cleanup.
      // Persist a tombstone even for an empty run before deleting its fixed keys.
      this.serial.close();
      this.ctx.storage.sql.exec('INSERT INTO lifecycle (id, run_id, closed) VALUES (1, ?, 1) ON CONFLICT(id) DO UPDATE SET closed = 1', runId);
      await this.ctx.storage.sync();
      const deleted = RESOURCES.map(resource => key(runId, resource.tenant, resource.kind));
      await Promise.all(deleted.map(value => this.env.CHECKPOINTS.delete(value)));
      const leftovers = (await Promise.all(deleted.map(async value => Boolean(await this.env.CHECKPOINTS.get(value))))).filter(Boolean).length;
      if (leftovers !== 0) throw new Error('r2-cleanup-incomplete');
      this.ctx.storage.sql.exec('DELETE FROM resources'); await this.ctx.storage.sync();
      return { run_id: runId, deleted_keys: deleted, r2_remaining: leftovers, cleanup: 'r2-prefix-and-sqlite-state-deleted' };
    }, { allowClosed: true });
    this.ctx.waitUntil(task.then(() => {}, () => {}));
    const result = await responseWithin(task, 10000);
    return result.timedOut ? { run_id: runId, cleanup: 'not-confirmed', status: 'cleanup-pending' } : result.value;
  }
  async resource(scope: { runId: string; tenant: Tenant; kind: Kind; objectId: string }, write: boolean) {
    const task = this.serial.enqueue(async () => {
      await this.setup(); const life = this.lifecycle(); if (!life || life.run_id !== scope.runId || life.closed === 1) throw new Error('run-closed');
      const row = this.rows().find(value => value.tenant === scope.tenant && value.kind === scope.kind && value.object_id === scope.objectId); if (!row) throw new Error('resource-not-found');
      let revision = row.revision;
      if (write) { revision += 1; const bytes = content(scope.runId, scope.tenant, scope.kind, revision); const stored = await this.env.CHECKPOINTS.put(key(scope.runId, scope.tenant, scope.kind), bytes); if (stored === null) throw new Error('r2-put-rejected'); this.ctx.storage.sql.exec('UPDATE resources SET revision = ?, digest = ? WHERE tenant = ? AND kind = ?', revision, digest(bytes), scope.tenant, scope.kind); }
      const value = await this.env.CHECKPOINTS.get(key(scope.runId, scope.tenant, scope.kind)); if (!value) throw new Error('r2-object-missing');
      const actualDigest = digest(new Uint8Array(await value.arrayBuffer())); const expectedDigest = digest(content(scope.runId, scope.tenant, scope.kind, revision));
      const latest = this.rows().find(candidate => candidate.tenant === scope.tenant && candidate.kind === scope.kind);
      if (!latest || latest.revision !== revision || latest.digest !== actualDigest || actualDigest !== expectedDigest) throw new Error('r2-sqlite-content-mismatch');
      return { run_id: scope.runId, tenant: scope.tenant, kind: scope.kind, object_id: scope.objectId, operation: write ? 'write' : 'read', revision, digest: actualDigest, content_bytes: value.size };
    });
    this.ctx.waitUntil(task.then(() => {}, () => {}));
    const result = await responseWithin(task, 10000);
    if (result.timedOut) throw new Error('resource-operation-timeout-unknown');
    return result.value;
  }
  
}

export default { fetch(request: Request, env: M0TenancyEnv) {
  const pathname = new URL(request.url).pathname;
  const run = pathname.match(/^\/(?:bootstrap|cleanup)\/([^/]+)$/)?.[1] ?? pathname.match(/^\/resource\/([^/]+)\//)?.[1];
  return handleTenancyRequest(request, env, () => {
    const stub = env.TENANCY.get(env.TENANCY.idFromName(`m0-tenancy-${run ?? 'operator'}`));
    return { bootstrap: value => stub.bootstrap(value), cleanup: value => stub.cleanup(value), resource: (scope, write) => stub.resource(scope, write) };
  });
} } satisfies ExportedHandler<M0TenancyEnv>;
