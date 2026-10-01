import {scope as checkedScope,type TurnScope} from '../turn/protocol.ts';
export const TRUSTED_PI_CAPACITY = 1;

export type TrustedPiCapacityScope = {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  sessionId: string;
};

export type TrustedPiCapacityIdentity = TrustedPiCapacityScope & {
  operationId: string;
  turnId: string;
  generation: number;
};

export type TrustedPiCapacityTicketReference = TrustedPiCapacityIdentity & {
  ticketId: string;
};

export type TrustedPiCapacityLeaseReference = TrustedPiCapacityTicketReference & {
  leaseId: string;
};

export type TrustedPiCapacityDispatchReference = TrustedPiCapacityLeaseReference & {
  dispatchId: string;
};

export type TrustedPiCapacityStatus = 'queued' | 'held' | 'dispatched' | 'cancelled' | 'released';

export type TrustedPiCapacityTicket = TrustedPiCapacityTicketReference & {
  leaseId: string | null;
  dispatchId: string | null;
  status: TrustedPiCapacityStatus;
  requestedAt: number;
  acquiredAt: number | null;
  dispatchedAt: number | null;
  finishedAt: number | null;
};

export type TrustedPiCapacityRequestResult = {
  outcome: 'acquired' | 'queued' | 'replayed';
  ticket: TrustedPiCapacityTicket;
};

export type TrustedPiCapacityDispatchResult = {
  authorized: boolean;
  ticket: TrustedPiCapacityTicket;
};

export type TrustedPiCapacityStopProof = {
  kind: 'never-started' | 'runtime-released';
  proofId: string;
  observedAt: number;
};

export type TrustedPiCapacityFinishResult = {
  changed: boolean;
  ticket: TrustedPiCapacityTicket;
  next: TrustedPiCapacityTicket | null;
};

export type TrustedPiCapacitySnapshot = {
  capacity: 1;
  occupied: 0 | 1;
  active: TrustedPiCapacityTicket | null;
  queue: TrustedPiCapacityTicket[];
};

/** Hooks run inside this ledger's existing SQLite transaction. They must be
 * synchronous and share the exact same storage/allocator domain. */
export interface TrustedPiAdmissionHook {
  enqueued(ticketId:string,requestedAt:number):void;
  beforePromote():void;
  canPromote(ticketId:string):boolean;
}

export type TrustedPiCapacityStorage = Pick<DurableObjectStorage, 'sql' | 'transactionSync' | 'sync'>;

type Row = Record<string, SqlStorageValue>;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const IDENTITY_KEYS = ['tenantId', 'projectId', 'workspaceId', 'sessionId', 'operationId', 'turnId', 'generation'];

function reject(code: string): never { throw Error(code); }
function exact(value: unknown, keys: string[], code = 'invalid-capacity-input'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) reject(code);
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) reject('invalid-capacity-identifier');
}
function positiveInteger(value: unknown, code = 'invalid-capacity-integer'): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) reject(code);
}

export function trustedPiCapacityIdentity(value: unknown): TrustedPiCapacityIdentity {
  exact(value, IDENTITY_KEYS);
  for (const key of IDENTITY_KEYS.slice(0, -1)) identifier(value[key]);
  positiveInteger(value.generation);
  return {
    tenantId: value.tenantId as string,
    projectId: value.projectId as string,
    workspaceId: value.workspaceId as string,
    sessionId: value.sessionId as string,
    operationId: value.operationId as string,
    turnId: value.turnId as string,
    generation: value.generation as number,
  };
}

function ticketReference(value: unknown, lease: boolean, dispatch = false): TrustedPiCapacityTicketReference | TrustedPiCapacityLeaseReference | TrustedPiCapacityDispatchReference {
  const keys = [...IDENTITY_KEYS, 'ticketId', ...(lease ? ['leaseId'] : []), ...(dispatch ? ['dispatchId'] : [])];
  exact(value, keys);
  const identity = trustedPiCapacityIdentity(Object.fromEntries(IDENTITY_KEYS.map(key => [key, value[key]])));
  identifier(value.ticketId);
  if (lease) identifier(value.leaseId);
  if (dispatch) identifier(value.dispatchId);
  return { ...identity, ticketId: value.ticketId as string, ...(lease ? { leaseId: value.leaseId as string } : {}), ...(dispatch ? { dispatchId: value.dispatchId as string } : {}) };
}

export function trustedPiCapacityTicketReference(ticket: TrustedPiCapacityTicket): TrustedPiCapacityTicketReference {
  return {
    tenantId: ticket.tenantId, projectId: ticket.projectId, workspaceId: ticket.workspaceId, sessionId: ticket.sessionId,
    operationId: ticket.operationId, turnId: ticket.turnId, generation: ticket.generation,
    ticketId: ticket.ticketId,
  };
}

export function trustedPiCapacityLeaseReference(ticket: TrustedPiCapacityTicket): TrustedPiCapacityLeaseReference {
  if (ticket.leaseId === null) reject('capacity-lease-not-acquired');
  return { ...trustedPiCapacityTicketReference(ticket), leaseId: ticket.leaseId };
}

export function trustedPiCapacityDispatchReference(ticket: TrustedPiCapacityTicket, dispatchId: string | null = ticket.dispatchId): TrustedPiCapacityDispatchReference {
  if (dispatchId === null) reject('capacity-dispatch-not-bound'); identifier(dispatchId);
  return { ...trustedPiCapacityLeaseReference(ticket), dispatchId };
}

function stopProof(value: unknown, kind: TrustedPiCapacityStopProof['kind']): TrustedPiCapacityStopProof {
  exact(value, ['kind', 'proofId', 'observedAt'], 'invalid-capacity-stop-proof');
  if (value.kind !== kind) reject('invalid-capacity-stop-proof');
  identifier(value.proofId); positiveInteger(value.observedAt, 'invalid-capacity-observation-time');
  return { kind, proofId: value.proofId, observedAt: value.observedAt };
}

/** Reads the original ledger without constructing it, pinning a policy,
 * promoting tickets, changing release state, or scheduling an alarm. */
export function readTrustedPiArchiveQuiescence(storage:Pick<TrustedPiCapacityStorage,'sql'>,rawScope:TurnScope){
  const scope=checkedScope(rawScope),tables=new Set(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name));
  if(!tables.has('trusted_pi_capacity_meta')||!tables.has('trusted_pi_capacity_tickets'))reject('trusted-pi-capacity-archive-proof-missing');
  const meta=storage.sql.exec<Row>('SELECT capacity,policy_version FROM trusted_pi_capacity_meta WHERE singleton=1').toArray()[0];if(!meta||meta.capacity!==1)reject('trusted-pi-capacity-archive-proof-invalid');identifier(meta.policy_version);
  let unresolved=0;
  for(const row of storage.sql.exec<Row>('SELECT * FROM trusted_pi_capacity_tickets WHERE tenant_id=?',scope.tenantId).toArray()){
    const identity=trustedPiCapacityIdentity(JSON.parse(row.identity_json as string));
    for(const key of IDENTITY_KEYS)if(row[key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase())]!==identity[key as keyof TrustedPiCapacityIdentity])reject('trusted-pi-capacity-archive-scope-denied');
    if(identity.projectId!==scope.projectId&&identity.workspaceId!==scope.workspaceId)continue;
    if(identity.projectId!==scope.projectId||!['queued','held','dispatched','released','cancelled'].includes(row.status as string))reject('trusted-pi-capacity-archive-proof-invalid');
    if(row.status==='released'||row.status==='cancelled'){
      const proof=stopProof(JSON.parse(row.proof_json as string),row.status==='released'?'runtime-released':'never-started');
      positiveInteger(row.finished_at);if(row.proof_id!==proof.proofId||(row.finished_at as number)<proof.observedAt)reject('trusted-pi-capacity-archive-proof-invalid');
      if(row.status==='released'){identifier(row.lease_id);identifier(row.dispatch_id);}else if(row.dispatch_id!==null)reject('trusted-pi-capacity-archive-proof-invalid');
    }else unresolved++;
  }
  return {scope,unresolved,quiescent:unresolved===0};
}

/** Application-wide, fail-closed capacity ledger for the single TrustedPi
 * container slot. All methods are internal platform primitives. */
export class SqlTrustedPiCapacity {
  readonly #storage: TrustedPiCapacityStorage;
  readonly #policyVersion: string;
  readonly #clock: () => number;
  readonly #id: () => string;
  readonly #ready: Promise<void>;
  readonly #admission: TrustedPiAdmissionHook | undefined;

  constructor(storage: TrustedPiCapacityStorage, policyVersion: string, clock: () => number = Date.now, id: () => string = () => crypto.randomUUID(), admission?:TrustedPiAdmissionHook) {
    if (!storage?.sql?.exec || !storage.transactionSync || !storage.sync) reject('sqlite-trusted-pi-capacity-storage-required');
    identifier(policyVersion);
    this.#admission=admission;
    this.#storage = storage; this.#policyVersion = policyVersion; this.#clock = clock; this.#id = id;
    storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS trusted_pi_capacity_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), capacity INTEGER NOT NULL CHECK(capacity=1), policy_version TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS trusted_pi_capacity_workspaces (
        tenant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>=1),
        PRIMARY KEY(tenant_id,workspace_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS trusted_pi_capacity_tickets (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL, dispatch_id TEXT, generation INTEGER NOT NULL CHECK(generation>=1),
        identity_json TEXT NOT NULL, lease_id TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('queued','held','dispatched','cancelled','released')),
        requested_at INTEGER NOT NULL, acquired_at INTEGER, dispatched_at INTEGER, finished_at INTEGER,
        proof_id TEXT UNIQUE, proof_json TEXT,
        CHECK((status='queued' AND lease_id IS NULL AND dispatch_id IS NULL AND acquired_at IS NULL AND dispatched_at IS NULL AND finished_at IS NULL AND proof_json IS NULL) OR
          (status='held' AND lease_id IS NOT NULL AND dispatch_id IS NULL AND acquired_at IS NOT NULL AND dispatched_at IS NULL AND finished_at IS NULL AND proof_json IS NULL) OR
          (status='dispatched' AND lease_id IS NOT NULL AND dispatch_id IS NOT NULL AND acquired_at IS NOT NULL AND dispatched_at IS NOT NULL AND finished_at IS NULL AND proof_json IS NULL) OR
          (status='cancelled' AND dispatched_at IS NULL AND finished_at IS NOT NULL AND proof_json IS NOT NULL) OR
          (status='released' AND lease_id IS NOT NULL AND acquired_at IS NOT NULL AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL AND proof_json IS NOT NULL))
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS trusted_pi_capacity_one_active
        ON trusted_pi_capacity_tickets((1)) WHERE status IN ('held','dispatched');
      CREATE UNIQUE INDEX IF NOT EXISTS trusted_pi_capacity_one_open_turn
        ON trusted_pi_capacity_tickets(tenant_id,project_id,workspace_id,session_id,turn_id,generation)
        WHERE status IN ('queued','held','dispatched');
      CREATE INDEX IF NOT EXISTS trusted_pi_capacity_fifo
        ON trusted_pi_capacity_tickets(status,sequence);`);
      const meta = this.#rows('SELECT * FROM trusted_pi_capacity_meta WHERE singleton=1')[0];
      if (!meta) storage.sql.exec('INSERT INTO trusted_pi_capacity_meta VALUES (1,1,?)', policyVersion);
    });
    this.#ready = storage.sync();
  }

  ready(): Promise<void> { return this.#ready; }
  #rows(query: string, ...bindings: (string | number | null)[]): Row[] { return this.#storage.sql.exec<Row>(query, ...bindings).toArray(); }
  #now(): number { const now = this.#clock(); positiveInteger(now, 'invalid-capacity-clock'); return now; }
  #policy(): void {
    const meta = this.#rows('SELECT * FROM trusted_pi_capacity_meta WHERE singleton=1')[0];
    if (!meta || meta.capacity !== 1 || meta.policy_version !== this.#policyVersion) reject('trusted-pi-capacity-policy-conflict');
    // A feature rollback must not make retained paired reservations invisible.
    // Legacy-only databases never enter this branch.
    if(!this.#admission && this.#rows("SELECT name FROM sqlite_master WHERE type='table' AND name='paired_capacity_leases'").length && this.#rows("SELECT lease_id FROM paired_capacity_leases WHERE status NOT IN ('released','cancelled') LIMIT 1").length) reject('paired-capacity-admission-required');
  }
  #canonical(identity: TrustedPiCapacityIdentity): string { return JSON.stringify(identity); }
  #newId(): string { const value = this.#id(); identifier(value); return value; }
  #rowForIdentity(identity: TrustedPiCapacityIdentity): Row | null {
    const row = this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE operation_id=?', identity.operationId)[0] ?? null;
    if (row && row.identity_json !== this.#canonical(identity)) reject('trusted-pi-capacity-idempotency-conflict');
    return row;
  }
  #referenced(reference: TrustedPiCapacityTicketReference | TrustedPiCapacityLeaseReference | TrustedPiCapacityDispatchReference, requireLease: boolean, requireDispatch = false): Row {
    const normalized = ticketReference(reference, requireLease, requireDispatch);
    const row = this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?', normalized.ticketId)[0];
    const identity = trustedPiCapacityIdentity(Object.fromEntries(IDENTITY_KEYS.map(key => [key, normalized[key as keyof typeof normalized]])));
    if (!row || row.identity_json !== this.#canonical(identity)) reject('trusted-pi-capacity-reference-denied');
    if (requireLease && row.lease_id !== (normalized as TrustedPiCapacityLeaseReference).leaseId) reject('trusted-pi-capacity-reference-denied');
    if (requireDispatch && row.dispatch_id !== (normalized as TrustedPiCapacityDispatchReference).dispatchId) reject('trusted-pi-capacity-reference-denied');
    return row;
  }
  #ticket(row: Row): TrustedPiCapacityTicket {
    const identity = JSON.parse(row.identity_json as string) as TrustedPiCapacityIdentity;
    return { ...identity, ticketId: row.ticket_id as string, leaseId: row.lease_id as string | null, dispatchId: row.dispatch_id as string | null,
      status: row.status as TrustedPiCapacityStatus, requestedAt: row.requested_at as number,
      acquiredAt: row.acquired_at as number | null, dispatchedAt: row.dispatched_at as number | null,
      finishedAt: row.finished_at as number | null };
  }
  #activeRow(): Row | null {
    const rows = this.#rows("SELECT * FROM trusted_pi_capacity_tickets WHERE status IN ('held','dispatched') ORDER BY sequence LIMIT 1");
    if (rows.length > 1) reject('trusted-pi-capacity-ledger-inconsistent');
    return rows[0] ?? null;
  }
  #promote(now: number): TrustedPiCapacityTicket | null {
    this.#admission?.beforePromote();
    const active = this.#activeRow();
    if (active) return this.#ticket(active);
    const queued = this.#rows("SELECT * FROM trusted_pi_capacity_tickets WHERE status='queued' ORDER BY sequence LIMIT 1")[0];
    if (!queued || (this.#admission && !this.#admission.canPromote(queued.ticket_id as string))) return null;
    const leaseId = this.#newId();
    this.#storage.sql.exec("UPDATE trusted_pi_capacity_tickets SET status='held',lease_id=?,acquired_at=? WHERE ticket_id=? AND status='queued'", leaseId, now, queued.ticket_id as string);
    return this.#ticket(this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?', queued.ticket_id as string)[0]!);
  }
  #lookup(identity: TrustedPiCapacityIdentity): TrustedPiCapacityRequestResult | null {
    const row = this.#rowForIdentity(identity);
    if (!row) return null;
    return { outcome: 'replayed', ticket: this.#ticket(row) };
  }

  async request(input: TrustedPiCapacityIdentity): Promise<TrustedPiCapacityRequestResult> {
    const identity = trustedPiCapacityIdentity(input); const canonical = this.#canonical(identity); await this.#ready;
    const result = this.#storage.transactionSync((): TrustedPiCapacityRequestResult => {
      this.#policy(); const prior = this.#rowForIdentity(identity); if (prior) return { outcome: 'replayed', ticket: this.#ticket(prior) };
      const owner = this.#rows('SELECT * FROM trusted_pi_capacity_workspaces WHERE tenant_id=? AND workspace_id=?', identity.tenantId, identity.workspaceId)[0];
      if (owner && owner.project_id !== identity.projectId) reject('trusted-pi-capacity-workspace-owner-conflict');
      if (owner && identity.generation < (owner.generation as number)) reject('trusted-pi-capacity-stale-generation');
      const open = this.#rows("SELECT ticket_id FROM trusted_pi_capacity_tickets WHERE tenant_id=? AND project_id=? AND workspace_id=? AND session_id=? AND turn_id=? AND generation=? AND status IN ('queued','held','dispatched')", identity.tenantId, identity.projectId, identity.workspaceId, identity.sessionId, identity.turnId, identity.generation)[0];
      if (open) reject('trusted-pi-capacity-turn-held');
      const now = this.#now(), ticketId = this.#newId();
      this.#storage.sql.exec(`INSERT INTO trusted_pi_capacity_workspaces VALUES (?,?,?,?)
        ON CONFLICT(tenant_id,workspace_id) DO UPDATE SET generation=MAX(generation,excluded.generation)`, identity.tenantId, identity.workspaceId, identity.projectId, identity.generation);
      this.#storage.sql.exec(`INSERT INTO trusted_pi_capacity_tickets
        (ticket_id,operation_id,tenant_id,project_id,workspace_id,session_id,turn_id,dispatch_id,generation,identity_json,lease_id,status,requested_at,acquired_at,dispatched_at,finished_at,proof_id,proof_json)
        VALUES (?,?,?,?,?,?,?,NULL,?,?,NULL,'queued',?,NULL,NULL,NULL,NULL,NULL)`,
      ticketId, identity.operationId, identity.tenantId, identity.projectId, identity.workspaceId, identity.sessionId,
      identity.turnId, identity.generation, canonical, now);
      this.#admission?.enqueued(ticketId,now);
      this.#promote(now);
      const ticket = this.#ticket(this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?', ticketId)[0]!);
      return { outcome: ticket.status === 'held' ? 'acquired' : 'queued', ticket };
    });
    await this.#storage.sync(); return structuredClone(result);
  }

  async lookup(input: TrustedPiCapacityIdentity): Promise<TrustedPiCapacityRequestResult | null> {
    const identity = trustedPiCapacityIdentity(input); await this.#ready;
    return structuredClone(this.#storage.transactionSync(() => { this.#policy(); return this.#lookup(identity); }));
  }

  async dispatch(input: TrustedPiCapacityDispatchReference): Promise<TrustedPiCapacityDispatchResult> {
    const reference = ticketReference(input, true, true) as TrustedPiCapacityDispatchReference; await this.#ready;
    const granted = this.#storage.transactionSync(() => {
      this.#policy(); const row = this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?', reference.ticketId)[0];
      const identity = trustedPiCapacityIdentity(Object.fromEntries(IDENTITY_KEYS.map(key => [key, reference[key as keyof typeof reference]])));
      if (!row || row.identity_json !== this.#canonical(identity) || row.lease_id !== reference.leaseId) reject('trusted-pi-capacity-reference-denied');
      if (row.status === 'dispatched') { if (row.dispatch_id !== reference.dispatchId) reject('trusted-pi-capacity-reference-denied'); return false; }
      if (row.status !== 'held' || row.dispatch_id !== null) return false;
      const now = this.#now(); this.#storage.sql.exec("UPDATE trusted_pi_capacity_tickets SET status='dispatched',dispatch_id=?,dispatched_at=? WHERE ticket_id=? AND status='held'", reference.dispatchId, now, reference.ticketId); return true;
    });
    await this.#storage.sync();
    const current = this.#storage.transactionSync(() => this.#ticket(this.#referenced(reference, true, true)));
    await this.#storage.sync();
    const final = this.#ticket(this.#referenced(reference, true, true));
    return { authorized: granted && current.status === 'dispatched' && final.status === 'dispatched', ticket: structuredClone(final) };
  }

  async cancelNeverStarted(input: TrustedPiCapacityTicketReference | TrustedPiCapacityLeaseReference, inputProof: TrustedPiCapacityStopProof): Promise<TrustedPiCapacityFinishResult> {
    const hasLease = !!input && typeof input === 'object' && Object.hasOwn(input, 'leaseId');
    const reference = ticketReference(input, hasLease); const proof = stopProof(inputProof, 'never-started'); const canonical = JSON.stringify(proof);
    await this.#ready;
    const result = this.#storage.transactionSync((): TrustedPiCapacityFinishResult => {
      this.#policy(); const row = this.#referenced(reference, hasLease), now = this.#now();
      if (row.status === 'cancelled') {
        if (row.proof_json !== canonical) reject('trusted-pi-capacity-proof-conflict');
        return { changed: false, ticket: this.#ticket(row), next: this.#activeRow() ? this.#ticket(this.#activeRow()!) : null };
      }
      if (row.status === 'released') reject('trusted-pi-capacity-proof-conflict');
      if (row.status === 'dispatched') reject('trusted-pi-capacity-never-started-not-confirmed');
      if (row.status === 'held' && !hasLease) reject('trusted-pi-capacity-reference-denied');
      if (proof.observedAt < (row.requested_at as number) || proof.observedAt > now) reject('invalid-capacity-observation-time');
      if (this.#rows('SELECT ticket_id FROM trusted_pi_capacity_tickets WHERE proof_id=?', proof.proofId).length) reject('trusted-pi-capacity-proof-reused');
      this.#storage.sql.exec("UPDATE trusted_pi_capacity_tickets SET status='cancelled',finished_at=?,proof_id=?,proof_json=? WHERE ticket_id=?", now, proof.proofId, canonical, reference.ticketId);
      const next = this.#promote(now);
      return { changed: true, ticket: this.#ticket(this.#rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?', reference.ticketId)[0]!), next };
    });
    await this.#storage.sync(); return structuredClone(result);
  }

  async confirmReleased(input: TrustedPiCapacityDispatchReference, inputProof: TrustedPiCapacityStopProof): Promise<TrustedPiCapacityFinishResult> {
    const reference = ticketReference(input, true, true) as TrustedPiCapacityDispatchReference;
    const proof = stopProof(inputProof, 'runtime-released'), canonical = JSON.stringify(proof); await this.#ready;
    const result = this.#storage.transactionSync((): TrustedPiCapacityFinishResult => {
      this.#policy(); const row = this.#referenced(reference, true, true), now = this.#now();
      if (row.status === 'released') {
        if (row.proof_json !== canonical) reject('trusted-pi-capacity-proof-conflict');
        return { changed: false, ticket: this.#ticket(row), next: this.#activeRow() ? this.#ticket(this.#activeRow()!) : null };
      }
      if (row.status !== 'dispatched') reject('trusted-pi-capacity-release-not-confirmed');
      if (proof.observedAt < (row.dispatched_at as number) || proof.observedAt > now) reject('invalid-capacity-observation-time');
      if (this.#rows('SELECT ticket_id FROM trusted_pi_capacity_tickets WHERE proof_id=?', proof.proofId).length) reject('trusted-pi-capacity-proof-reused');
      this.#storage.sql.exec("UPDATE trusted_pi_capacity_tickets SET status='released',finished_at=?,proof_id=?,proof_json=? WHERE ticket_id=?", now, proof.proofId, canonical, reference.ticketId);
      const next = this.#promote(now);
      return { changed: true, ticket: this.#ticket(this.#referenced(reference, true, true)), next };
    });
    await this.#storage.sync(); return structuredClone(result);
  }

  /** Internal allocator bridge: caller already owns this storage transaction.
   * No await, nested transaction, or native operation is permitted here. */
  promoteWithinTransaction():void {this.#policy();this.#promote(this.#now());}

  async snapshot(): Promise<TrustedPiCapacitySnapshot> {
    await this.#ready;
    return this.#storage.transactionSync(() => {
      this.#policy(); const active = this.#activeRow();
      const queue = this.#rows("SELECT * FROM trusted_pi_capacity_tickets WHERE status='queued' ORDER BY sequence").map(row => this.#ticket(row));
      return { capacity: 1, occupied: active ? 1 : 0, active: active ? this.#ticket(active) : null, queue } as TrustedPiCapacitySnapshot;
    });
  }
}
