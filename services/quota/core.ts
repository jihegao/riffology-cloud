export const MAX_LEASE_MS = 15 * 60_000;
export type QuotaPolicy = { tenantId: string; capacity: number; version: string };
type LeaseRequestBase = {
  tenantId: string; projectId: string; workspaceId: string; generation: number;
  operationId: string; deadlineAt: number;
};
export type LeaseRequest = LeaseRequestBase & ({ operation: 'workspace-runtime' } | { operation: 'service-run' | 'simulation-run'; runId: string });
export type LeaseReference = LeaseRequest & { leaseId: string };
export type StopConfirmation = { kind: 'runtime-stopped' | 'never-started'; confirmationId: string; observedAt: number };
export type Lease = LeaseReference & {
  status: 'held' | 'dispatched' | 'unknown' | 'stopped'; acquiredAt: number;
  dispatchedAt: number | null; unknownAt: number | null; stoppedAt: number | null;
  confirmation: StopConfirmation | null; expired: boolean;
};
export type Acquisition = { outcome: 'acquired' | 'denied' | 'replayed'; lease: Lease | null; denial: 'quota-exhausted' | 'workspace-held' | 'run-held' | null };
export type QuotaSnapshot = {
  tenantId: string; capacity: number; policyVersion: string; configuredPolicyMatches: boolean;
  occupied: number; available: number; unknown: number; leases: Lease[];
};
export type QuotaStorage = Pick<DurableObjectStorage, 'sql' | 'transactionSync' | 'sync'>;
type Row = Record<string, SqlStorageValue>;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const REQUEST_KEYS = ['tenantId', 'projectId', 'workspaceId', 'generation', 'operation', 'operationId', 'deadlineAt'];
function reject(code: string): never { throw Error(code); }
export function quotaIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !ID.test(value)) reject('invalid-quota-identifier');
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) reject('invalid-quota-input');
}
function integer(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) reject('invalid-quota-integer');
}
function requestValue(value: unknown, reference = false): LeaseRequest {
  const service = !!value && typeof value === 'object' && ['service-run','simulation-run'].includes(String((value as {operation?: unknown}).operation));
  const keys = service ? [...REQUEST_KEYS, 'runId'] : REQUEST_KEYS;
  exact(value, reference ? [...keys, 'leaseId'] : keys);
  if (service) quotaIdentifier(value.runId);
  for (const key of ['tenantId', 'projectId', 'workspaceId', 'operationId']) quotaIdentifier(value[key]);
  if (reference) quotaIdentifier(value.leaseId);
  integer(value.generation); integer(value.deadlineAt);
  if (value.operation !== 'workspace-runtime' && value.operation !== 'service-run' && value.operation !== 'simulation-run') reject('invalid-quota-operation');
  return { tenantId: value.tenantId as string, projectId: value.projectId as string, workspaceId: value.workspaceId as string,
    generation: value.generation as number, operation: value.operation as LeaseRequest['operation'], operationId: value.operationId as string, deadlineAt: value.deadlineAt as number,
    ...(service ? {runId: value.runId as string} : {}) } as LeaseRequest;
}
export function leaseReference(lease: Lease): LeaseReference {
  return { tenantId: lease.tenantId, projectId: lease.projectId, workspaceId: lease.workspaceId,
    generation: lease.generation, operation: lease.operation, operationId: lease.operationId, deadlineAt: lease.deadlineAt, leaseId: lease.leaseId, ...(lease.operation !== 'workspace-runtime' ? {runId: lease.runId} : {}) } as LeaseReference;
}

/** Private platform primitive: no identity assertion in these arguments grants
 * authority. The DO adapter validates its name, and its binding must remain
 * accessible only to the authenticated platform and trusted runtime supervisor. */
export class SqlTenantQuota {
  #storage: QuotaStorage;
  #policy: QuotaPolicy;
  #clock: () => number;
  #id: () => string;
  #ready: Promise<void>;
  constructor(storage: QuotaStorage, policy: QuotaPolicy, clock = Date.now, id: () => string = () => crypto.randomUUID()) {
    if (!storage?.sql?.exec || !storage.transactionSync || !storage.sync) reject('sqlite-quota-storage-required');
    exact(policy, ['tenantId', 'capacity', 'version']); quotaIdentifier(policy.tenantId); quotaIdentifier(policy.version);
    if (!Number.isSafeInteger(policy.capacity) || policy.capacity < 1 || policy.capacity > 64) reject('invalid-quota-capacity');
    this.#storage = storage; this.#policy = structuredClone(policy); this.#clock = clock; this.#id = id;
    storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), tenant_id TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 64), policy_version TEXT NOT NULL
      ); CREATE TABLE IF NOT EXISTS quota_workspaces (
        workspace_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>=1)
      ); CREATE TABLE IF NOT EXISTS quota_operations (
        operation_id TEXT PRIMARY KEY, request_json TEXT NOT NULL, lease_id TEXT, denial TEXT,
        CHECK((lease_id IS NULL AND denial IN ('quota-exhausted','workspace-held')) OR (lease_id IS NOT NULL AND denial IS NULL))
      ); CREATE TABLE IF NOT EXISTS quota_leases (
        lease_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
        request_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('held','dispatched','unknown','stopped')),
        acquired_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL, dispatched_at INTEGER,
        unknown_at INTEGER, stopped_at INTEGER, confirmation_id TEXT UNIQUE, confirmation_json TEXT,
        CHECK((status='stopped' AND stopped_at IS NOT NULL AND confirmation_json IS NOT NULL) OR
          (status!='stopped' AND stopped_at IS NULL AND confirmation_json IS NULL))
      ); CREATE INDEX IF NOT EXISTS quota_occupied ON quota_leases(status,deadline_at);`);
      // Upgrade legacy ledgers transactionally; preserve original JSON and intent history.
      const columns = this.#rows('PRAGMA table_info(quota_leases)');
      if (!columns.some(column => column.name === 'resource_key')) {
        storage.sql.exec('ALTER TABLE quota_leases ADD COLUMN resource_key TEXT');
        storage.sql.exec("UPDATE quota_leases SET resource_key='workspace:' || workspace_id");
        storage.sql.exec(`CREATE TABLE quota_operations_v2 (
          operation_id TEXT PRIMARY KEY, request_json TEXT NOT NULL, lease_id TEXT, denial TEXT,
          CHECK((lease_id IS NULL AND denial IN ('quota-exhausted','workspace-held','run-held')) OR (lease_id IS NOT NULL AND denial IS NULL))
        ); INSERT INTO quota_operations_v2 SELECT * FROM quota_operations;
        DROP TABLE quota_operations; ALTER TABLE quota_operations_v2 RENAME TO quota_operations;`);
      }
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS quota_workspace_owners (
        workspace_id TEXT PRIMARY KEY, project_id TEXT NOT NULL
      ); CREATE TABLE IF NOT EXISTS quota_resources (
        resource_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK(generation>=1)
      ); INSERT OR IGNORE INTO quota_workspace_owners SELECT workspace_id,project_id FROM quota_workspaces;
      INSERT OR IGNORE INTO quota_resources SELECT 'workspace:' || workspace_id,workspace_id,project_id,generation FROM quota_workspaces;
      DROP INDEX IF EXISTS quota_workspace_occupied;
      CREATE UNIQUE INDEX IF NOT EXISTS quota_resource_occupied ON quota_leases(resource_key) WHERE status!='stopped';`);
      const meta = this.#rows('SELECT * FROM quota_meta')[0];
      if (meta && meta.tenant_id !== policy.tenantId) reject('quota-tenant-conflict');
      if (!meta) storage.sql.exec('INSERT INTO quota_meta VALUES (1,?,?,?)', policy.tenantId, policy.capacity, policy.version);
    });
    this.#ready = storage.sync();
  }
  /** Explicit, increase-only release migration. Existing leases, operation
   * receipts and unknown execution fences remain untouched. */
  async upgradePolicyFrom(expectedVersion:string):Promise<void>{
    quotaIdentifier(expectedVersion);await this.#ready;
    this.#storage.transactionSync(()=>{const meta=this.#meta();if(this.#policyMatches())return;
      if(meta.policy_version!==expectedVersion||this.#policy.capacity<Number(meta.capacity))throw Error('quota-policy-upgrade-denied');
      this.#storage.sql.exec('UPDATE quota_meta SET capacity=?,policy_version=? WHERE singleton=1',this.#policy.capacity,this.#policy.version);
    });await this.#storage.sync();
  }
  ready(): Promise<void> { return this.#ready; }
  #rows(query: string, ...bindings: (string | number | null)[]): Row[] { return this.#storage.sql.exec<Row>(query, ...bindings).toArray(); }
  #now(): number { const now = this.#clock(); integer(now); return now; }
  #scope(request: LeaseRequest): void { if (request.tenantId !== this.#policy.tenantId) reject('quota-scope-denied'); }
  #meta(): Row { const meta = this.#rows('SELECT * FROM quota_meta WHERE singleton=1')[0]; if (!meta || meta.tenant_id !== this.#policy.tenantId) reject('quota-tenant-conflict'); return meta; }
  #policyMatches(): boolean { const m = this.#meta(); return m.capacity === this.#policy.capacity && m.policy_version === this.#policy.version; }
  #expire(now: number): void { this.#storage.sql.exec("UPDATE quota_leases SET status='unknown',unknown_at=? WHERE status IN ('held','dispatched') AND deadline_at<=?", now, now); }
  #lease(row: Row, now: number): Lease {
    return { ...JSON.parse(row.request_json as string), leaseId: row.lease_id as string, status: row.status as Lease['status'],
      acquiredAt: row.acquired_at as number, dispatchedAt: row.dispatched_at as number | null, unknownAt: row.unknown_at as number | null,
      stoppedAt: row.stopped_at as number | null, confirmation: row.confirmation_json ? JSON.parse(row.confirmation_json as string) : null,
      expired: row.status !== 'stopped' && (row.deadline_at as number) <= now };
  }
  #referenced(reference: LeaseReference, normalized: LeaseRequest): Row {
    const row = this.#rows('SELECT * FROM quota_leases WHERE lease_id=?', reference.leaseId)[0];
    if (!row || row.request_json !== JSON.stringify(normalized)) reject('quota-lease-scope-denied');
    return row;
  }
  #snapshot(now: number): QuotaSnapshot {
    const meta = this.#meta(), leases = this.#rows("SELECT * FROM quota_leases WHERE status!='stopped' ORDER BY acquired_at,lease_id").map(row => this.#lease(row, now));
    if (leases.length > (meta.capacity as number)) reject('quota-ledger-inconsistent');
    return { tenantId: this.#policy.tenantId, capacity: meta.capacity as number, policyVersion: meta.policy_version as string,
      configuredPolicyMatches: this.#policyMatches(), occupied: leases.length, available: (meta.capacity as number) - leases.length,
      unknown: leases.filter(row => row.status === 'unknown' || row.expired).length, leases };
  }
  async snapshot(): Promise<QuotaSnapshot> { await this.#ready; return this.#snapshot(this.#now()); }
  async lookup(operationId: string): Promise<Acquisition | null> {
    quotaIdentifier(operationId); await this.#ready; return this.#lookup(operationId, this.#now());
  }
  #lookup(operationId: string, now: number): Acquisition | null {
    const row = this.#rows('SELECT * FROM quota_operations WHERE operation_id=?', operationId)[0];
    if (!row) return null;
    const lease = row.lease_id ? this.#rows('SELECT * FROM quota_leases WHERE lease_id=?', row.lease_id as string)[0] : null;
    if (row.lease_id && !lease) reject('quota-ledger-inconsistent');
    return { outcome: 'replayed', lease: lease ? this.#lease(lease, now) : null, denial: row.denial as Acquisition['denial'] };
  }
  async acquire(input: LeaseRequest): Promise<Acquisition> {
    const request = requestValue(input); this.#scope(request); const canonical = JSON.stringify(request);
    await this.#ready;
    const result = this.#storage.transactionSync((): Acquisition => {
      const now = this.#now(); this.#expire(now);
      const prior = this.#rows('SELECT * FROM quota_operations WHERE operation_id=?', request.operationId)[0];
      if (prior) { if (prior.request_json !== canonical) reject('quota-idempotency-conflict'); return this.#lookup(request.operationId, now)!; }
      if (!this.#policyMatches()) reject('quota-policy-conflict');
      if (request.deadlineAt <= now || request.deadlineAt - now > MAX_LEASE_MS) reject('invalid-quota-deadline');
      const resourceKey = request.operation !== 'workspace-runtime' ? `run:${request.runId}` : `workspace:${request.workspaceId}`;
      const owner = this.#rows('SELECT * FROM quota_workspace_owners WHERE workspace_id=?', request.workspaceId)[0];
      if (owner && owner.project_id !== request.projectId) reject('quota-workspace-owner-conflict');
      const resource = this.#rows('SELECT * FROM quota_resources WHERE resource_key=?', resourceKey)[0];
      if (resource && (resource.project_id !== request.projectId || resource.workspace_id !== request.workspaceId)) reject('quota-resource-owner-conflict');
      if (resource && request.generation < (resource.generation as number)) reject('quota-stale-generation');
      const held = this.#rows("SELECT lease_id FROM quota_leases WHERE resource_key=? AND status!='stopped'", resourceKey)[0];
      if (!held && resource && request.generation === resource.generation) reject('quota-generation-reused');
      const denial = held ? (request.operation !== 'workspace-runtime' ? 'run-held' : 'workspace-held') : this.#snapshot(now).available === 0 ? 'quota-exhausted' : null;
      if (denial) {
        this.#storage.sql.exec('INSERT INTO quota_operations VALUES (?,?,NULL,?)', request.operationId, canonical, denial);
        return { outcome: 'denied', lease: null, denial };
      }
      const leaseId = this.#id(); quotaIdentifier(leaseId);
      this.#storage.sql.exec('INSERT OR IGNORE INTO quota_workspace_owners VALUES (?,?)', request.workspaceId, request.projectId);
      this.#storage.sql.exec('INSERT INTO quota_resources VALUES (?,?,?,?) ON CONFLICT(resource_key) DO UPDATE SET generation=excluded.generation', resourceKey, request.workspaceId, request.projectId, request.generation);
      if (request.operation === 'workspace-runtime') this.#storage.sql.exec('INSERT INTO quota_workspaces VALUES (?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET generation=excluded.generation', request.workspaceId, request.projectId, request.generation);
      this.#storage.sql.exec("INSERT INTO quota_leases VALUES (?,?,?,?,'held',?,?,NULL,NULL,NULL,NULL,NULL,?)", leaseId, request.operationId, request.workspaceId, canonical, now, request.deadlineAt, resourceKey);
      this.#storage.sql.exec('INSERT INTO quota_operations VALUES (?,?,?,NULL)', request.operationId, canonical, leaseId);
      return { outcome: 'acquired', lease: this.#lease(this.#rows('SELECT * FROM quota_leases WHERE lease_id=?', leaseId)[0]!, now), denial: null };
    });
    await this.#storage.sync(); return structuredClone(result);
  }
  /** Only the first confirmed transition authorizes a dispatch. An uncertain
   * response is reconciled, never retried as a fresh dispatch permission. */
  async dispatch(reference: LeaseReference): Promise<{ authorized: boolean; lease: Lease }> {
    const ref = structuredClone(reference), request = requestValue(ref, true); this.#scope(request); await this.#ready;
    const granted = this.#storage.transactionSync(() => {
      const now = this.#now(); this.#expire(now); const row = this.#referenced(ref, request);
      if (!this.#policyMatches()) reject('quota-policy-conflict');
      if (row.status !== 'held') return false;
      this.#storage.sql.exec("UPDATE quota_leases SET status='dispatched',dispatched_at=? WHERE lease_id=?", now, ref.leaseId); return true;
    });
    await this.#storage.sync();
    // A flush or another trusted RPC can consume the remaining lease window.
    // Do not return a stale dispatch authorization after that await.
    const result = this.#storage.transactionSync(() => {
      const now = this.#now(); this.#expire(now); const row = this.#referenced(ref, request);
      return { authorized: granted && row.status === 'dispatched', lease: this.#lease(row, now) };
    });
    await this.#storage.sync();
    const now = this.#now(), current = this.#lease(this.#referenced(ref, request), now);
    return { authorized: result.authorized && current.status === 'dispatched' && !current.expired, lease: current };
  }
  async markUnknown(reference: LeaseReference): Promise<Lease> {
    const ref = structuredClone(reference), request = requestValue(ref, true); this.#scope(request); await this.#ready;
    const result = this.#storage.transactionSync(() => {
      const now = this.#now(), row = this.#referenced(ref, request);
      if (row.status !== 'stopped' && row.status !== 'unknown') this.#storage.sql.exec("UPDATE quota_leases SET status='unknown',unknown_at=? WHERE lease_id=?", now, ref.leaseId);
      return this.#lease(this.#referenced(ref, request), now);
    });
    await this.#storage.sync(); return result;
  }
  async reconcile(): Promise<QuotaSnapshot> {
    await this.#ready;
    const result = this.#storage.transactionSync(() => { const now = this.#now(); this.#expire(now); return this.#snapshot(now); });
    await this.#storage.sync(); return result;
  }
  async confirmStopped(reference: LeaseReference, proof: StopConfirmation): Promise<{ released: boolean; lease: Lease }> {
    const ref = structuredClone(reference), request = requestValue(ref, true); this.#scope(request);
    exact(proof, ['kind', 'confirmationId', 'observedAt']); quotaIdentifier(proof.confirmationId); integer(proof.observedAt);
    if (!['runtime-stopped', 'never-started'].includes(proof.kind)) reject('invalid-stop-confirmation');
    const confirmation = structuredClone(proof), canonical = JSON.stringify({ kind: proof.kind, confirmationId: proof.confirmationId, observedAt: proof.observedAt });
    await this.#ready;
    const result = this.#storage.transactionSync(() => {
      const now = this.#now(); this.#expire(now); const row = this.#referenced(ref, request);
      if (row.status === 'stopped') {
        if (row.confirmation_json !== canonical) reject('quota-confirmation-conflict');
        return { released: false, lease: this.#lease(row, now) };
      }
      if (confirmation.observedAt < (row.acquired_at as number) || confirmation.observedAt > now) reject('invalid-stop-observation-time');
      if (confirmation.kind === 'never-started' && (row.status !== 'held' || row.dispatched_at !== null)) reject('quota-stop-not-confirmed');
      if (this.#rows('SELECT lease_id FROM quota_leases WHERE confirmation_id=?', confirmation.confirmationId).length) reject('quota-confirmation-reused');
      this.#storage.sql.exec("UPDATE quota_leases SET status='stopped',stopped_at=?,confirmation_id=?,confirmation_json=? WHERE lease_id=?", now, confirmation.confirmationId, canonical, ref.leaseId);
      return { released: true, lease: this.#lease(this.#referenced(ref, request), now) };
    });
    await this.#storage.sync(); return result;
  }
}
