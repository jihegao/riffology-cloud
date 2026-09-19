import {G4WindowGuard,type G4WindowPolicy} from './g4-window.ts';
import { actor as validateActor, positive, sha, turnDigest, type TurnActor } from '../turn/protocol.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';

export const MAX_MODEL_RESERVATION_MS = 15 * 60_000;

export type ModelBudgetPolicy = {
  tenantId: string;
  version: string;
  maxReservationAttemptsPerTurn: number;
  maxDispatchedCallsPerTurn: number;
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
  maxReservedTokensPerTurn: number;
};
export type ModelCallRequest = {
  schemaVersion: 1;
  identity: TurnRuntimeIdentity;
  actor: TurnActor;
  callId: string;
  requestId: string;
  deadlineAt: number;
  provider: string;
  model: string;
  payloadSha256: string;
  inputTokenUpperBound: number;
  maxOutputTokens: number;
  inputBoundVersion: string;
  budgetPolicyVersion: string;
};
export type ModelCallReference = {
  identity: TurnRuntimeIdentity;
  callId: string;
  requestId: string;
  digest: string;
  reservationId: string;
};
export type ModelUsageEvidence =
  | { kind: 'verified'; inputTokens: number; outputTokens: number; source: string; observedAt: number }
  | { kind: 'unknown'; observedAt: number };
export type ModelCallOutcome = 'completed' | 'failed' | 'cancelled';
export type ModelCallTerminal = { outcome: ModelCallOutcome; errorCode: string | null; providerRequestId: string | null; usage: ModelUsageEvidence };
export type ModelReleaseProof = {
  confirmationId: string;
  reason: 'cancelled-before-dispatch' | 'proxy-pre-dispatch-failed' | 'deadline-before-dispatch';
  observedAt: number;
};
export type ModelCallStatus = 'reserved' | 'dispatched' | 'unknown' | ModelCallOutcome | 'not-dispatched';
export type ModelCallRecord = {
  schemaVersion: 1;
  identity: TurnRuntimeIdentity;
  actor: TurnActor;
  turnKey: string;
  callKey: string;
  callId: string;
  requestId: string;
  digest: string;
  reservationId: string;
  deadlineAt: number;
  provider: string;
  model: string;
  payloadSha256: string;
  inputTokenUpperBound: number;
  maxOutputTokens: number;
  inputBoundVersion: string;
  reservationTokens: number;
  accountedTokens: number;
  status: ModelCallStatus;
  reconciliation: 'held' | 'recorded' | 'pending' | 'released';
  acceptedAt: number;
  updatedAt: number;
  dispatchedAt: number | null;
  dispatchOrdinal: number | null;
  unknownAt: number | null;
  finishedAt: number | null;
  terminal: ModelCallTerminal | null;
  releaseProof: ModelReleaseProof | null;
};
export type ModelBudgetSnapshot = {
  tenantId: string;
  policyVersion: string;
  configuredPolicyMatches: boolean;
  turnKey: string;
  maxReservationAttemptsPerTurn: number;
  maxDispatchedCallsPerTurn: number;
  maxReservedTokensPerTurn: number;
  attempts: number;
  dispatchedCalls: number;
  accountedTokens: number;
  active: number;
  pending: number;
  records: ModelCallRecord[];
};
export type ModelExecutionBlocker = {
  schemaVersion: 1;
  callKey: string;
  turnKey: string;
  provider: string;
  model: string;
  status: ModelCallStatus;
  reconciliation: ModelCallRecord['reconciliation'];
  acceptedAt: number;
  deadlineAt: number;
  dispatchedAt: number | null;
  unknownAt: number | null;
  finishedAt: number | null;
  terminalOutcome: ModelCallOutcome | null;
  terminalErrorCode: string | null;
  providerRequestIdPresent: boolean;
  usageKind: ModelUsageEvidence['kind'] | null;
};
export type ModelExecutionBlockerInventory = {
  schemaVersion: 1;
  total: number;
  confirmedEnded: number;
  blocked: number;
  blockers: ModelExecutionBlocker[];
};
export type ModelExecutionBlockerCorrelation = {
  schemaVersion: 1;
  callKey: string;
  requestId: string;
  providerRequestId: string | null;
};
export type ModelExecutionIsolationCandidate = {
  schemaVersion: 1;
  identity: TurnRuntimeIdentity;
  blocker: ModelExecutionBlocker;
  recordDigest: string;
};
export type ModelExecutionIsolationProof = {
  schemaVersion: 1;
  callKey: string;
  turnKey: string;
  recordDigest: string;
  evidenceSha256: string;
  isolatedAt: number;
  classification: 'runtime-released' | 'runtime-absent-and-fenced';
};
export type ModelExecutionIsolationManifest = {
  schemaVersion: 1;
  ledger: 'legacy' | 'g5';
  proofs: { callKey: string; proofDigest: string }[];
};
export type ModelExecutionIsolationSnapshot = {
  schemaVersion: 1;
  ledger: ModelExecutionIsolationManifest['ledger'];
  blocked: number;
  isolated: number;
  proofs: { callKey: string; proofDigest: string; evidenceSha256: string; classification: ModelExecutionIsolationProof['classification']; isolatedAt: number }[];
};
export type ModelBudgetStorage = Pick<DurableObjectStorage, 'sql' | 'transactionSync' | 'sync'>;

type Row = Record<string, SqlStorageValue>;
const ACTIVE = new Set<ModelCallStatus>(['reserved', 'dispatched', 'unknown']);
const OUTCOMES = new Set<ModelCallOutcome>(['completed', 'failed', 'cancelled']);
const TERMINAL = new Set<ModelCallStatus>([...OUTCOMES, 'not-dispatched']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function reject(code: string): never { throw Error(code); }
function exact(value: unknown, keys: string[], code = 'invalid-model-budget-input'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) reject(code);
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)
    || ['__proto__', 'constructor', 'prototype'].includes(value)) reject('invalid-model-budget-identifier');
  return value;
}
function externalId(value: unknown): string {
  if (typeof value !== 'string' || !EXTERNAL_ID.test(value)) reject('invalid-model-provider-request-id');
  return value;
}
function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) reject('invalid-model-budget-integer');
  return value as number;
}
function nonnegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) reject('invalid-model-budget-integer');
  return value as number;
}
function canonical(value: unknown): string { return JSON.stringify(value); }
function sameIdentity(a: TurnRuntimeIdentity, b: TurnRuntimeIdentity): boolean { return canonical(a) === canonical(b); }
function stableTurnIdentity(identity: TurnRuntimeIdentity) {
  return { scope: identity.scope, sessionId: identity.sessionId, turnId: identity.turnId, generation: identity.generation };
}
async function turnKey(identity: TurnRuntimeIdentity): Promise<string> {
  return turnDigest({ schemaVersion: 1, purpose: 'model-budget-turn', ...stableTurnIdentity(identity) });
}
export async function modelBudgetTurnKey(value: unknown): Promise<string> {
  return turnKey(turnRuntimeIdentity(value));
}
async function callKey(identity: TurnRuntimeIdentity, callId: string): Promise<string> {
  return turnDigest({ schemaVersion: 1, purpose: 'model-budget-call', ...stableTurnIdentity(identity), callId });
}

function configuredPolicy(value: ModelBudgetPolicy): ModelBudgetPolicy {
  exact(value, ['tenantId', 'version', 'maxReservationAttemptsPerTurn', 'maxDispatchedCallsPerTurn', 'maxInputTokensPerCall', 'maxOutputTokensPerCall', 'maxReservedTokensPerTurn'], 'invalid-model-budget-policy');
  const policy = {
    tenantId: identifier(value.tenantId),
    version: identifier(value.version),
    maxReservationAttemptsPerTurn: positiveInteger(value.maxReservationAttemptsPerTurn, 128),
    maxDispatchedCallsPerTurn: positiveInteger(value.maxDispatchedCallsPerTurn, 64),
    maxInputTokensPerCall: positiveInteger(value.maxInputTokensPerCall, 1_048_576),
    maxOutputTokensPerCall: positiveInteger(value.maxOutputTokensPerCall, 131_072),
    maxReservedTokensPerTurn: positiveInteger(value.maxReservedTokensPerTurn, 4_194_304),
  };
  if (policy.maxDispatchedCallsPerTurn > policy.maxReservationAttemptsPerTurn) reject('invalid-model-budget-policy');
  return policy;
}
function normalizedRequest(value: unknown): ModelCallRequest {
  exact(value, ['schemaVersion', 'identity', 'actor', 'callId', 'requestId', 'deadlineAt', 'provider', 'model', 'payloadSha256', 'inputTokenUpperBound', 'maxOutputTokens', 'inputBoundVersion', 'budgetPolicyVersion']);
  if (value.schemaVersion !== 1) reject('invalid-model-call-request');
  const provider = typeof value.provider === 'string' && PROVIDER.test(value.provider) ? value.provider : reject('invalid-model-call-request');
  const model = typeof value.model === 'string' && MODEL.test(value.model) ? value.model : reject('invalid-model-call-request');
  return {
    schemaVersion: 1,
    identity: turnRuntimeIdentity(value.identity),
    actor: validateActor(value.actor),
    callId: identifier(value.callId),
    requestId: identifier(value.requestId),
    deadlineAt: positiveInteger(value.deadlineAt),
    provider,
    model,
    payloadSha256: sha(value.payloadSha256),
    inputTokenUpperBound: positiveInteger(value.inputTokenUpperBound, 1_048_576),
    maxOutputTokens: positiveInteger(value.maxOutputTokens, 131_072),
    inputBoundVersion: identifier(value.inputBoundVersion),
    budgetPolicyVersion: identifier(value.budgetPolicyVersion),
  };
}
function normalizedReference(value: unknown): ModelCallReference {
  exact(value, ['identity', 'callId', 'requestId', 'digest', 'reservationId']);
  return {
    identity: turnRuntimeIdentity(value.identity),
    callId: identifier(value.callId),
    requestId: identifier(value.requestId),
    digest: sha(value.digest),
    reservationId: identifier(value.reservationId),
  };
}
function normalizedUsage(value: unknown, request: ModelCallRequest, dispatchedAt: number, now: number): ModelUsageEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject('invalid-model-usage-evidence');
  if ((value as Record<string, unknown>).kind === 'unknown') {
    exact(value, ['kind', 'observedAt'], 'invalid-model-usage-evidence');
    const observedAt = positive(value.observedAt);
    if (observedAt < dispatchedAt || observedAt > now) reject('invalid-model-usage-time');
    return { kind: 'unknown', observedAt };
  }
  exact(value, ['kind', 'inputTokens', 'outputTokens', 'source', 'observedAt'], 'invalid-model-usage-evidence');
  if (value.kind !== 'verified') reject('invalid-model-usage-evidence');
  const inputTokens = nonnegativeInteger(value.inputTokens, request.inputTokenUpperBound);
  const outputTokens = nonnegativeInteger(value.outputTokens, request.maxOutputTokens);
  const source = identifier(value.source);
  const observedAt = positive(value.observedAt);
  if (observedAt < dispatchedAt || observedAt > now) reject('invalid-model-usage-time');
  return { kind: 'verified', inputTokens, outputTokens, source, observedAt };
}
function normalizedTerminal(value: unknown, request: ModelCallRequest, dispatchedAt: number, now: number): ModelCallTerminal {
  exact(value, ['outcome', 'errorCode', 'providerRequestId', 'usage'], 'invalid-model-call-terminal');
  if (typeof value.outcome !== 'string' || !OUTCOMES.has(value.outcome as ModelCallOutcome)) reject('invalid-model-call-terminal');
  const errorCode = value.errorCode === null ? null : identifier(value.errorCode);
  if ((value.outcome === 'completed') !== (errorCode === null)) reject('invalid-model-call-terminal');
  const providerRequestId = value.providerRequestId === null ? null : externalId(value.providerRequestId);
  const usage = normalizedUsage(value.usage, request, dispatchedAt, now);
  if (usage.kind === 'verified' && providerRequestId === null) reject('model-provider-request-id-required');
  return { outcome: value.outcome as ModelCallOutcome, errorCode, providerRequestId, usage };
}
function normalizedRelease(value: unknown): ModelReleaseProof {
  exact(value, ['confirmationId', 'reason', 'observedAt'], 'invalid-model-release-proof');
  if (!['cancelled-before-dispatch', 'proxy-pre-dispatch-failed', 'deadline-before-dispatch'].includes(String(value.reason))) reject('invalid-model-release-proof');
  return { confirmationId: identifier(value.confirmationId), reason: value.reason as ModelReleaseProof['reason'], observedAt: positive(value.observedAt) };
}
function normalizedIsolationProof(value: unknown): ModelExecutionIsolationProof {
  exact(value, ['schemaVersion', 'callKey', 'turnKey', 'recordDigest', 'evidenceSha256', 'isolatedAt', 'classification'], 'invalid-model-execution-isolation');
  if (value.schemaVersion !== 1 || !['runtime-released', 'runtime-absent-and-fenced'].includes(String(value.classification))) reject('invalid-model-execution-isolation');
  return {
    schemaVersion: 1,
    callKey: sha(value.callKey), turnKey: sha(value.turnKey), recordDigest: sha(value.recordDigest), evidenceSha256: sha(value.evidenceSha256),
    isolatedAt: positive(value.isolatedAt), classification: value.classification as ModelExecutionIsolationProof['classification'],
  };
}
function normalizedIsolationManifest(value: unknown): ModelExecutionIsolationManifest {
  exact(value, ['schemaVersion', 'ledger', 'proofs'], 'invalid-model-execution-isolation-manifest');
  if (value.schemaVersion !== 1 || !['legacy', 'g5'].includes(String(value.ledger)) || !Array.isArray(value.proofs) || value.proofs.length < 1 || value.proofs.length > 64) reject('invalid-model-execution-isolation-manifest');
  const proofs = value.proofs.map(item => {
    exact(item, ['callKey', 'proofDigest'], 'invalid-model-execution-isolation-manifest');
    return { callKey: sha(item.callKey), proofDigest: sha(item.proofDigest) };
  });
  if (new Set(proofs.map(item => item.callKey)).size !== proofs.length) reject('invalid-model-execution-isolation-manifest');
  return {schemaVersion: 1, ledger: value.ledger as ModelExecutionIsolationManifest['ledger'], proofs};
}

/** Tenant-scoped product quota ledger. It records calls and token bounds only.
 * Prices, balances, payment and settlement belong to the future TenantBilling authority. */
export class SqlTenantModelBudget {
  #storage: ModelBudgetStorage;
  #policy: ModelBudgetPolicy;
  #clock: () => number;
  #id: () => string;
  #ready: Promise<void>;
  readonly g4:G4WindowGuard;

  constructor(storage: ModelBudgetStorage, policy: ModelBudgetPolicy, clock: () => number = Date.now, id: () => string = () => crypto.randomUUID(),g4Policy:G4WindowPolicy|null=null) {
    if (!storage?.sql?.exec || !storage.transactionSync || !storage.sync) reject('sqlite-model-budget-storage-required');
    this.#storage = storage;
    this.g4=new G4WindowGuard(storage,g4Policy,clock);
    this.#policy = configuredPolicy(structuredClone(policy));
    this.#clock = clock;
    this.#id = id;
    storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS model_budget_meta (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), tenant_id TEXT NOT NULL, policy_version TEXT NOT NULL,
        max_reservation_attempts_per_turn INTEGER NOT NULL CHECK(max_reservation_attempts_per_turn BETWEEN 1 AND 128),
        max_dispatched_calls_per_turn INTEGER NOT NULL CHECK(max_dispatched_calls_per_turn BETWEEN 1 AND 64),
        max_input_tokens_per_call INTEGER NOT NULL CHECK(max_input_tokens_per_call BETWEEN 1 AND 1048576),
        max_output_tokens_per_call INTEGER NOT NULL CHECK(max_output_tokens_per_call BETWEEN 1 AND 131072),
        max_reserved_tokens_per_turn INTEGER NOT NULL CHECK(max_reserved_tokens_per_turn BETWEEN 1 AND 4194304)
      );
      CREATE TABLE IF NOT EXISTS model_calls (
        call_key TEXT PRIMARY KEY, turn_key TEXT NOT NULL, call_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
        identity_json TEXT NOT NULL, request_json TEXT NOT NULL, request_digest TEXT NOT NULL, reservation_id TEXT NOT NULL UNIQUE,
        reservation_tokens INTEGER NOT NULL CHECK(reservation_tokens>=1),
        accounted_tokens INTEGER NOT NULL CHECK(accounted_tokens>=0 AND accounted_tokens<=reservation_tokens),
        status TEXT NOT NULL CHECK(status IN ('reserved','dispatched','unknown','completed','failed','cancelled','not-dispatched')),
        reconciliation TEXT NOT NULL CHECK(reconciliation IN ('held','recorded','pending','released')),
        accepted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dispatched_at INTEGER, dispatch_ordinal INTEGER,
        unknown_at INTEGER, finished_at INTEGER, terminal_json TEXT, terminal_digest TEXT,
        release_id TEXT UNIQUE, release_json TEXT, release_digest TEXT,
        CHECK((status='reserved' AND dispatched_at IS NULL AND dispatch_ordinal IS NULL AND finished_at IS NULL AND reconciliation='held') OR
          (status='dispatched' AND dispatched_at IS NOT NULL AND dispatch_ordinal IS NOT NULL AND finished_at IS NULL AND reconciliation='held') OR
          (status='unknown' AND dispatched_at IS NOT NULL AND dispatch_ordinal IS NOT NULL AND unknown_at IS NOT NULL AND finished_at IS NULL AND reconciliation='pending') OR
          (status IN ('completed','failed','cancelled') AND dispatched_at IS NOT NULL AND dispatch_ordinal IS NOT NULL AND finished_at IS NOT NULL AND terminal_json IS NOT NULL AND terminal_digest IS NOT NULL AND reconciliation IN ('recorded','pending')) OR
          (status='not-dispatched' AND dispatched_at IS NULL AND dispatch_ordinal IS NULL AND finished_at IS NOT NULL AND release_id IS NOT NULL AND release_json IS NOT NULL AND release_digest IS NOT NULL AND accounted_tokens=0 AND reconciliation='released'))
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS model_one_active_call_per_turn ON model_calls(turn_key) WHERE status IN ('reserved','dispatched','unknown');
      CREATE INDEX IF NOT EXISTS model_calls_by_turn ON model_calls(turn_key,accepted_at,call_key);
      CREATE TABLE IF NOT EXISTS model_turn_admission_closures(turn_key TEXT PRIMARY KEY,identity_json TEXT NOT NULL,closed_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS model_execution_isolations(
        call_key TEXT PRIMARY KEY, document TEXT NOT NULL, digest TEXT NOT NULL UNIQUE
      ) STRICT;`);
      const meta = this.#rows('SELECT * FROM model_budget_meta WHERE singleton=1')[0];
      if (meta && meta.tenant_id !== this.#policy.tenantId) reject('model-budget-tenant-conflict');
      if (!meta) this.#storage.sql.exec('INSERT INTO model_budget_meta VALUES (1,?,?,?,?,?,?,?)', this.#policy.tenantId, this.#policy.version, this.#policy.maxReservationAttemptsPerTurn, this.#policy.maxDispatchedCallsPerTurn, this.#policy.maxInputTokensPerCall, this.#policy.maxOutputTokensPerCall, this.#policy.maxReservedTokensPerTurn);
    });
    this.#ready = storage.sync();
  }

  ready(): Promise<void> { return this.#ready; }
  #rows(query: string, ...bindings: (string | number | null)[]): Row[] { return this.#storage.sql.exec<Row>(query, ...bindings).toArray(); }
  #now(): number { return positive(this.#clock()); }
  #meta(): Row {
    const row = this.#rows('SELECT * FROM model_budget_meta WHERE singleton=1')[0];
    if (!row || row.tenant_id !== this.#policy.tenantId) reject('model-budget-tenant-conflict');
    return row;
  }
  #policyMatches(): boolean {
    const row = this.#meta();
    return row.policy_version === this.#policy.version
      && row.max_reservation_attempts_per_turn === this.#policy.maxReservationAttemptsPerTurn
      && row.max_dispatched_calls_per_turn === this.#policy.maxDispatchedCallsPerTurn
      && row.max_input_tokens_per_call === this.#policy.maxInputTokensPerCall
      && row.max_output_tokens_per_call === this.#policy.maxOutputTokensPerCall
      && row.max_reserved_tokens_per_turn === this.#policy.maxReservedTokensPerTurn;
  }
  #scope(identity: TurnRuntimeIdentity): void {
    if (identity.scope.tenantId !== this.#policy.tenantId) reject('model-budget-scope-denied');
  }
  #request(row: Row): ModelCallRequest {
    try { return normalizedRequest(JSON.parse(row.request_json as string)); }
    catch { reject('invalid-persisted-model-budget'); }
  }
  #get(key: string): Row | undefined { return this.#rows('SELECT * FROM model_calls WHERE call_key=?', key)[0]; }
  #record(row: Row, now = this.#now()): ModelCallRecord {
    try {
      const request = this.#request(row);
      const identity = turnRuntimeIdentity(JSON.parse(row.identity_json as string));
      const status = row.status as ModelCallStatus;
      if (!sameIdentity(identity, request.identity) || (!ACTIVE.has(status) && !TERMINAL.has(status))) throw Error();
      const dispatchedAt = row.dispatched_at === null ? null : positive(row.dispatched_at);
      const terminal = row.terminal_json === null ? null : normalizedTerminal(JSON.parse(row.terminal_json as string), request, dispatchedAt!, now);
      const releaseProof = row.release_json === null ? null : normalizedRelease(JSON.parse(row.release_json as string));
      const record: ModelCallRecord = {
        schemaVersion: 1, identity, actor: request.actor,
        turnKey: sha(row.turn_key), callKey: sha(row.call_key), callId: request.callId, requestId: request.requestId,
        digest: sha(row.request_digest), reservationId: identifier(row.reservation_id), deadlineAt: request.deadlineAt,
        provider: request.provider, model: request.model, payloadSha256: request.payloadSha256,
        inputTokenUpperBound: request.inputTokenUpperBound, maxOutputTokens: request.maxOutputTokens, inputBoundVersion: request.inputBoundVersion,
        reservationTokens: positiveInteger(row.reservation_tokens), accountedTokens: nonnegativeInteger(row.accounted_tokens),
        status, reconciliation: row.reconciliation as ModelCallRecord['reconciliation'],
        acceptedAt: positive(row.accepted_at), updatedAt: positive(row.updated_at), dispatchedAt,
        dispatchOrdinal: row.dispatch_ordinal === null ? null : positive(row.dispatch_ordinal),
        unknownAt: row.unknown_at === null ? null : positive(row.unknown_at),
        finishedAt: row.finished_at === null ? null : positive(row.finished_at), terminal, releaseProof,
      };
      if (record.reservationTokens !== request.inputTokenUpperBound + request.maxOutputTokens
        || record.accountedTokens > record.reservationTokens || record.updatedAt < record.acceptedAt || record.updatedAt > now
        || !['held', 'recorded', 'pending', 'released'].includes(record.reconciliation)) throw Error();
      if (ACTIVE.has(status) !== (record.finishedAt === null)) throw Error();
      if (status === 'reserved' && (record.dispatchedAt || record.dispatchOrdinal || record.reconciliation !== 'held')) throw Error();
      if (status === 'dispatched' && (!record.dispatchedAt || !record.dispatchOrdinal || record.unknownAt || record.reconciliation !== 'held')) throw Error();
      if (status === 'unknown' && (!record.dispatchedAt || !record.dispatchOrdinal || !record.unknownAt || record.reconciliation !== 'pending')) throw Error();
      if (record.dispatchedAt !== null && (record.dispatchedAt < record.acceptedAt || record.dispatchedAt > record.updatedAt)) throw Error();
      if (record.unknownAt !== null && (record.dispatchedAt === null || record.unknownAt < record.dispatchedAt || record.unknownAt > record.updatedAt)) throw Error();
      if (record.finishedAt !== null && (record.finishedAt < record.acceptedAt || record.finishedAt > record.updatedAt)) throw Error();
      if (status === 'not-dispatched' && (!releaseProof || terminal || row.release_id !== releaseProof.confirmationId || record.reconciliation !== 'released'
        || releaseProof.observedAt < record.acceptedAt || releaseProof.observedAt > record.finishedAt!)) throw Error();
      if (OUTCOMES.has(status as ModelCallOutcome) && (!terminal || releaseProof || terminal.outcome !== status
        || record.dispatchedAt === null || record.finishedAt! < record.dispatchedAt || terminal.usage.observedAt > record.finishedAt!)) throw Error();
      return record;
    } catch { reject('invalid-persisted-model-budget'); }
  }
  async #keys(request: ModelCallRequest): Promise<{ turn: string; call: string; digest: string }> {
    return {
      turn: await turnKey(request.identity),
      call: await callKey(request.identity, request.callId),
      digest: await turnDigest({ schemaVersion: 1, policyVersion: request.budgetPolicyVersion, request }),
    };
  }
  async #verified(row: Row): Promise<ModelCallRecord> {
    const record = this.#record(row), request = this.#request(row), keys = await this.#keys(request);
    if (record.turnKey !== keys.turn || record.callKey !== keys.call || record.digest !== keys.digest) reject('invalid-persisted-model-budget');
    if (record.terminal && row.terminal_digest !== await turnDigest(record.terminal)) reject('invalid-persisted-model-budget');
    if (record.releaseProof && row.release_digest !== await turnDigest(record.releaseProof)) reject('invalid-persisted-model-budget');
    return record;
  }
  async #referenced(value: unknown): Promise<{ key: string; record: ModelCallRecord }> {
    const reference = normalizedReference(value);
    this.#scope(reference.identity);
    const key = await callKey(reference.identity, reference.callId);
    const row = this.#get(key);
    if (!row) reject('model-call-not-found');
    const record = await this.#verified(row);
    if (!sameIdentity(record.identity, reference.identity) || record.requestId !== reference.requestId
      || record.digest !== reference.digest || record.reservationId !== reference.reservationId) reject('model-call-scope-denied');
    return { key, record };
  }

  async reserve(value: unknown): Promise<{ record: ModelCallRecord; replayed: boolean }> {
    const request = normalizedRequest(value);
    this.#scope(request.identity);
    const keys = await this.#keys(request);
    await this.#ready;
    const result = this.#storage.transactionSync(() => {
      const prior = this.#get(keys.call);
      if (prior) {
        const record = this.#record(prior);
        if (record.digest !== keys.digest) reject('model-call-idempotency-conflict');
        return { record, replayed: true };
      }
      if(this.#rows('SELECT 1 FROM model_turn_admission_closures WHERE turn_key=?',keys.turn).length)reject('model-turn-admission-closed');
      if (request.budgetPolicyVersion !== this.#policy.version) reject('model-budget-policy-conflict');
      if (!this.#policyMatches()) reject('model-budget-policy-conflict');
      const now = this.#now();
      if (request.deadlineAt <= now || request.deadlineAt - now > MAX_MODEL_RESERVATION_MS) reject('invalid-model-call-deadline');
      if (request.inputTokenUpperBound > this.#policy.maxInputTokensPerCall || request.maxOutputTokens > this.#policy.maxOutputTokensPerCall) reject('model-call-limit-exceeded');
      if (this.#rows('SELECT call_key FROM model_calls WHERE request_id=?', request.requestId).length) reject('model-request-id-conflict');
      const attempts = Number(this.#rows('SELECT count(*) AS n FROM model_calls WHERE turn_key=?', keys.turn)[0]?.n ?? 0);
      const dispatched = Number(this.#rows('SELECT count(*) AS n FROM model_calls WHERE turn_key=? AND dispatched_at IS NOT NULL', keys.turn)[0]?.n ?? 0);
      if (!Number.isSafeInteger(attempts) || attempts >= this.#policy.maxReservationAttemptsPerTurn) reject('model-turn-attempt-limit');
      if (!Number.isSafeInteger(dispatched) || dispatched >= this.#policy.maxDispatchedCallsPerTurn) reject('model-turn-call-limit');
      if (this.#rows("SELECT call_key FROM model_calls WHERE turn_key=? AND status IN ('reserved','dispatched','unknown')", keys.turn).length) reject('model-turn-active-call');
      const reservationTokens = request.inputTokenUpperBound + request.maxOutputTokens;
      const accounted = Number(this.#rows('SELECT coalesce(sum(accounted_tokens),0) AS n FROM model_calls WHERE turn_key=?', keys.turn)[0]?.n ?? 0);
      if (!Number.isSafeInteger(reservationTokens) || !Number.isSafeInteger(accounted)
        || reservationTokens > this.#policy.maxReservedTokensPerTurn - accounted) reject('model-turn-token-budget-exhausted');
      this.g4.reserveSync(request,keys.call,keys.turn);
      const reservationId = identifier(this.#id());
      this.#storage.sql.exec(
        "INSERT INTO model_calls(call_key,turn_key,call_id,request_id,identity_json,request_json,request_digest,reservation_id,reservation_tokens,accounted_tokens,status,reconciliation,accepted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'reserved','held',?,?)",
        keys.call, keys.turn, request.callId, request.requestId, canonical(request.identity), canonical(request), keys.digest,
        reservationId, reservationTokens, reservationTokens, now, now,
      );
      return { record: this.#record(this.#get(keys.call)!), replayed: false };
    });
    await this.#storage.sync();
    if (result.replayed) result.record = await this.#verified(this.#get(keys.call)!);
    return structuredClone(result);
  }

  async lookup(identityValue: unknown, callIdValue: unknown): Promise<ModelCallRecord | null> {
    const identity = turnRuntimeIdentity(identityValue), callId = identifier(callIdValue);
    this.#scope(identity);
    const key = await callKey(identity, callId);
    await this.#ready;
    const row = this.#get(key);
    return row ? structuredClone(await this.#verified(row)) : null;
  }

  async dispatch(value: unknown): Promise<{ authorized: boolean; observeOnly: boolean; record: ModelCallRecord;controlledWindowDeadlineAt?:number }> {
    const reference = normalizedReference(value);
    this.#scope(reference.identity);
    const key = await callKey(reference.identity, reference.callId);
    await this.#ready;
    const verified = await this.#referenced(reference);
    let granted = false;
    const expiryProof: ModelReleaseProof = { confirmationId: reference.reservationId, reason: 'deadline-before-dispatch', observedAt: verified.record.deadlineAt };
    const expiryDigest = await turnDigest(expiryProof);
    this.#storage.transactionSync(() => {
      const row = this.#get(key);
      if (!row) reject('model-call-not-found');
      const current = this.#record(row);
      if (!sameIdentity(current.identity, reference.identity) || current.requestId !== reference.requestId
        || current.digest !== reference.digest || current.reservationId !== reference.reservationId) reject('model-call-scope-denied');
      if (!this.#policyMatches()) reject('model-budget-policy-conflict');
      if (current.status !== 'reserved') return;
      if(this.#rows('SELECT 1 FROM model_turn_admission_closures WHERE turn_key=?',current.turnKey).length)return;
      const now = this.#now();
      if (current.deadlineAt <= now) {
        this.g4.releaseSync(key);
        this.#storage.sql.exec("UPDATE model_calls SET status='not-dispatched',reconciliation='released',accounted_tokens=0,updated_at=?,finished_at=?,release_id=?,release_json=?,release_digest=? WHERE call_key=?", now, now, expiryProof.confirmationId, canonical(expiryProof), expiryDigest, key);
        return;
      }
      this.g4.dispatchSync(key);
      const ordinal = Number(this.#rows('SELECT count(*) AS n FROM model_calls WHERE turn_key=? AND dispatched_at IS NOT NULL', current.turnKey)[0]?.n ?? 0) + 1;
      this.#storage.sql.exec("UPDATE model_calls SET status='dispatched',updated_at=?,dispatched_at=?,dispatch_ordinal=? WHERE call_key=?", now, now, ordinal, key);
      granted = true;
    });
    await this.#storage.sync();
    const final = this.#storage.transactionSync(() => {
      const row = this.#get(key);
      if (!row) reject('model-call-not-found');
      const current = this.#record(row), now = this.#now();
      if (granted && current.status === 'dispatched' && (current.deadlineAt <= now || (this.g4.deadlineAt()!==null&&this.g4.deadlineAt()!<=now))) {
        this.g4.unknownSync(key);
        this.#storage.sql.exec("UPDATE model_calls SET status='unknown',reconciliation='pending',updated_at=?,unknown_at=? WHERE call_key=?", now, now, key);
        granted = false;
        return this.#record(this.#get(key)!);
      }
      return current;
    });
    await this.#storage.sync();
    return { authorized: granted && final.status === 'dispatched', observeOnly: !granted && (final.status === 'dispatched' || final.status === 'unknown'), record: structuredClone(final),...(this.g4.deadlineAt()===null?{}:{controlledWindowDeadlineAt:this.g4.deadlineAt()!}) };
  }

  async markUnknown(value: unknown): Promise<ModelCallRecord> {
    await this.#ready;
    const { key } = await this.#referenced(value);
    const result = this.#storage.transactionSync(() => {
      const current = this.#record(this.#get(key)!);
      if (current.status === 'reserved') reject('model-call-not-dispatched');
      if (current.status === 'dispatched') {
        const now = this.#now();
        this.g4.unknownSync(key);
        this.#storage.sql.exec("UPDATE model_calls SET status='unknown',reconciliation='pending',updated_at=?,unknown_at=? WHERE call_key=?", now, now, key);
      }
      return this.#record(this.#get(key)!);
    });
    await this.#storage.sync();
    return structuredClone(result);
  }

  async finish(referenceValue: unknown, terminalValue: unknown): Promise<ModelCallRecord> {
    await this.#ready;
    const { key } = await this.#referenced(referenceValue);
    const current = this.#record(this.#get(key)!);
    if (!current.dispatchedAt || current.status === 'reserved' || current.status === 'not-dispatched') reject('model-call-not-dispatched');
    const terminal = normalizedTerminal(terminalValue, this.#request(this.#get(key)!), current.dispatchedAt, this.#now());
    const terminalDigest = await turnDigest(terminal);
    const result = this.#storage.transactionSync(() => {
      const latest = this.#record(this.#get(key)!);
      if (TERMINAL.has(latest.status)) {
        if (latest.status === 'not-dispatched' || this.#get(key)!.terminal_digest !== terminalDigest) reject('model-terminal-conflict');
        return latest;
      }
      if (latest.status === 'reserved') reject('model-call-not-dispatched');
      if (latest.unknownAt !== null && terminal.usage.observedAt < latest.unknownAt) reject('model-terminal-before-unknown');
      const accountedTokens = terminal.usage.kind === 'verified' ? terminal.usage.inputTokens + terminal.usage.outputTokens : latest.reservationTokens;
      const reconciliation = terminal.usage.kind === 'verified' ? 'recorded' : 'pending';
      const now = this.#now();
      this.g4.finishSync(key,terminal);
      this.#storage.sql.exec('UPDATE model_calls SET status=?,reconciliation=?,accounted_tokens=?,updated_at=?,finished_at=?,terminal_json=?,terminal_digest=? WHERE call_key=?', terminal.outcome, reconciliation, accountedTokens, now, now, canonical(terminal), terminalDigest, key);
      return this.#record(this.#get(key)!);
    });
    await this.#storage.sync();
    return structuredClone(result);
  }

  async releaseUndispatched(referenceValue: unknown, proofValue: unknown): Promise<ModelCallRecord> {
    const proof = normalizedRelease(proofValue);
    await this.#ready;
    const { key } = await this.#referenced(referenceValue);
    const proofDigest = await turnDigest(proof);
    const result = this.#storage.transactionSync(() => {
      const current = this.#record(this.#get(key)!), now = this.#now();
      if (proof.observedAt < current.acceptedAt || proof.observedAt > now) reject('invalid-model-release-time');
      if (current.status === 'not-dispatched') {
        if (this.#get(key)!.release_digest !== proofDigest) reject('model-release-conflict');
        return current;
      }
      if (current.status !== 'reserved') reject('model-call-may-have-dispatched');
      this.g4.releaseSync(key);
      if (this.#rows('SELECT call_key FROM model_calls WHERE release_id=?', proof.confirmationId).length) reject('model-release-proof-reused');
      this.#storage.sql.exec("UPDATE model_calls SET status='not-dispatched',reconciliation='released',accounted_tokens=0,updated_at=?,finished_at=?,release_id=?,release_json=?,release_digest=? WHERE call_key=?", now, now, proof.confirmationId, canonical(proof), proofDigest, key);
      return this.#record(this.#get(key)!);
    });
    await this.#storage.sync();
    return structuredClone(result);
  }

  #settlement(identity:TurnRuntimeIdentity,key:string){
    const closure=this.#rows('SELECT * FROM model_turn_admission_closures WHERE turn_key=?',key)[0];if(closure&&closure.identity_json!==canonical(identity))reject('model-turn-settlement-identity-conflict');
    const row=this.#rows(`SELECT count(*) AS total,coalesce(sum(status IN ('reserved','dispatched','unknown')),0) AS active,coalesce(sum(status='unknown'),0) AS unknown,coalesce(sum(status IN ('reserved','dispatched','unknown') OR reconciliation='pending'),0) AS pending,coalesce(sum(identity_json!=?),0) AS foreign_identity FROM model_calls WHERE turn_key=?`,canonical(identity),key)[0]!;
    if(row.foreign_identity!==0)reject('model-turn-settlement-identity-conflict');for(const key of ['total','active','unknown','pending'])if(!Number.isSafeInteger(row[key])||(row[key] as number)<0)reject('model-turn-settlement-invalid');
    return {schemaVersion:1 as const,domain:'model' as const,identity:structuredClone(identity),closed:!!closure,closedAt:closure?positive(closure.closed_at):null,total:row.total as number,active:row.active as number,unknown:row.unknown as number,pending:row.pending as number};
  }
  async closeTurnAdmission(value:unknown){const identity=turnRuntimeIdentity(value);this.#scope(identity);const key=await turnKey(identity);await this.#ready;const result=this.#storage.transactionSync(()=>{this.#settlement(identity,key);this.#storage.sql.exec('INSERT OR IGNORE INTO model_turn_admission_closures VALUES(?,?,?)',key,canonical(identity),this.#now());return this.#settlement(identity,key);});await this.#storage.sync();return result;}
  async turnSettlement(value:unknown){const identity=turnRuntimeIdentity(value);this.#scope(identity);const key=await turnKey(identity);await this.#ready;return this.#storage.transactionSync(()=>this.#settlement(identity,key));}

  /** Read-only execution fence, independent of monetary settlement or period IDs. */
  async assertExecutionQuiet(): Promise<void> {
    await this.#ready;
    for (const row of this.#rows('SELECT * FROM model_calls')) {
      const record = await this.#verified(row);
      if (!this.#executionEnded(record)) throw Error('pi-developer-execution-unconfirmed');
    }
  }

  #executionEnded(record: ModelCallRecord): boolean {
    const terminal = record.terminal;
    return record.status === 'not-dispatched' || !!terminal?.providerRequestId && (
      record.status === 'completed' && terminal.outcome === 'completed' ||
      record.status === 'failed' && terminal.outcome === 'failed' && ['rejected-auth', 'rate-limited'].includes(String(terminal.errorCode))
    );
  }

  #blocker(record: ModelCallRecord): ModelExecutionBlocker {
    return {
      schemaVersion: 1, callKey: record.callKey, turnKey: record.turnKey, provider: record.provider, model: record.model,
      status: record.status, reconciliation: record.reconciliation, acceptedAt: record.acceptedAt, deadlineAt: record.deadlineAt,
      dispatchedAt: record.dispatchedAt, unknownAt: record.unknownAt, finishedAt: record.finishedAt,
      terminalOutcome: record.terminal?.outcome ?? null, terminalErrorCode: record.terminal?.errorCode ?? null,
      providerRequestIdPresent: record.terminal?.providerRequestId !== null && record.terminal?.providerRequestId !== undefined,
      usageKind: record.terminal?.usage.kind ?? null,
    };
  }
  async #recordDigest(record: ModelCallRecord): Promise<string> {
    // Bind only immutable request/admission identity. Provider reconciliation,
    // usage and accounting may advance later without invalidating a proven
    // execution fence or allowing another call to take this record's place.
    return turnDigest({schemaVersion:1,purpose:'model-execution-isolation-record',callKey:record.callKey,turnKey:record.turnKey,requestDigest:record.digest,reservationId:record.reservationId,acceptedAt:record.acceptedAt,deadlineAt:record.deadlineAt,provider:record.provider,model:record.model,payloadSha256:record.payloadSha256});
  }
  async #isolation(callKeyValue: unknown): Promise<{proof:ModelExecutionIsolationProof;digest:string}|null> {
    const key=sha(callKeyValue),row=this.#rows('SELECT document,digest FROM model_execution_isolations WHERE call_key=?',key)[0];
    if(!row)return null;
    const proof=normalizedIsolationProof(JSON.parse(row.document as string)),digest=sha(row.digest);
    if(proof.callKey!==key||digest!==await turnDigest(proof))reject('invalid-persisted-model-execution-isolation');
    return {proof,digest};
  }
  #turnExecutionClosed(record:ModelCallRecord):boolean {
    const row=this.#rows('SELECT identity_json FROM model_turn_admission_closures WHERE turn_key=?',record.turnKey)[0];
    if(!row)return false;
    try{return sameIdentity(turnRuntimeIdentity(JSON.parse(row.identity_json as string)),record.identity);}catch{return false;}
  }

  /** Read-only, redacted inventory for operator reconciliation. It exposes
   * ledger digests and terminal classifications, never request payloads,
   * identities, user input, or raw provider/request identifiers. */
  async executionBlockers(): Promise<ModelExecutionBlockerInventory> {
    await this.#ready;
    const records = await Promise.all(this.#rows('SELECT * FROM model_calls ORDER BY accepted_at,call_key').map(row => this.#verified(row)));
    const blockers = records.filter(record => !this.#executionEnded(record)).map(record => this.#blocker(record));
    return structuredClone({schemaVersion: 1 as const,total: records.length,confirmedEnded: records.length-blockers.length,blocked: blockers.length,blockers});
  }

  /** Private exact-call input for the operator that verifies Workspace/runtime
   * isolation. It reveals the durable Turn identity but never request IDs,
   * actor, payload, reservation, usage, or provider response content. */
  async executionIsolationCandidate(callKeyValue: unknown): Promise<ModelExecutionIsolationCandidate> {
    const key=sha(callKeyValue);await this.#ready;const row=this.#get(key);
    if(!row)reject('model-execution-blocker-absent');const record=await this.#verified(row);
    if(this.#executionEnded(record))reject('model-execution-blocker-ended');
    return structuredClone({schemaVersion:1,identity:record.identity,blocker:this.#blocker(record),recordDigest:await this.#recordDigest(record)});
  }

  /** Append-only operator attestation. This never changes call status,
   * reconciliation, reservations, usage, or provider/billing facts. */
  async recordExecutionIsolation(value: unknown): Promise<{proof:ModelExecutionIsolationProof;proofDigest:string}> {
    const proof=normalizedIsolationProof(value);await this.#ready;const row=this.#get(proof.callKey);
    if(!row)reject('model-execution-blocker-absent');const record=await this.#verified(row),now=this.#now();
    if(this.#executionEnded(record)||!this.#turnExecutionClosed(record)||record.callKey!==proof.callKey||record.turnKey!==proof.turnKey||record.deadlineAt>proof.isolatedAt||proof.isolatedAt>now||(await this.#recordDigest(record))!==proof.recordDigest)reject('model-execution-isolation-denied');
    const digest=await turnDigest(proof),prior=await this.#isolation(proof.callKey);
    if(prior){if(prior.digest!==digest)reject('model-execution-isolation-conflict');return structuredClone({proof:prior.proof,proofDigest:prior.digest});}
    this.#storage.sql.exec('INSERT INTO model_execution_isolations VALUES(?,?,?)',proof.callKey,canonical(proof),digest);await this.#storage.sync();
    return structuredClone({proof,proofDigest:digest});
  }

  /** Admission accepts only the exact frozen set of unresolved historical
   * calls. New/missing blockers, changed records, or proof drift fail closed. */
  async assertExecutionIsolated(value: unknown): Promise<ModelExecutionIsolationSnapshot> {
    const manifest=normalizedIsolationManifest(value);await this.#ready;
    const records=await Promise.all(this.#rows('SELECT * FROM model_calls ORDER BY call_key').map(row=>this.#verified(row))),byKey=new Map(records.map(record=>[record.callKey,record])),blockers=records.filter(record=>!this.#executionEnded(record));
    const expected=new Map(manifest.proofs.map(item=>[item.callKey,item.proofDigest])),proofs:ModelExecutionIsolationSnapshot['proofs']=[];
    if(blockers.some(record=>!expected.has(record.callKey)))reject('pi-developer-execution-isolation-unconfirmed');
    for(const item of manifest.proofs){const record=byKey.get(item.callKey),stored=await this.#isolation(item.callKey);if(!record||!this.#turnExecutionClosed(record)||!stored||stored.digest!==item.proofDigest||stored.proof.turnKey!==record.turnKey||stored.proof.recordDigest!==(await this.#recordDigest(record)))reject('pi-developer-execution-isolation-unconfirmed');proofs.push({callKey:record.callKey,proofDigest:stored.digest,evidenceSha256:stored.proof.evidenceSha256,classification:stored.proof.classification,isolatedAt:stored.proof.isolatedAt});}
    return structuredClone({schemaVersion:1,ledger:manifest.ledger,blocked:blockers.length,isolated:proofs.length,proofs});
  }

  /** Redundant workspace-local fence. Tenant-wide admission still requires
   * the frozen exact-set manifest; this only permits an old Turn when each of
   * its unresolved calls has a current append-only isolation proof. */
  async assertTurnExecutionIsolated(value: unknown): Promise<void> {
    const identity=turnRuntimeIdentity(value);this.#scope(identity);const key=await turnKey(identity);await this.#ready;
    const records=await Promise.all(this.#rows('SELECT * FROM model_calls WHERE turn_key=? ORDER BY call_key',key).map(row=>this.#verified(row)));
    for(const record of records){
      if(this.#executionEnded(record))continue;
      const stored=await this.#isolation(record.callKey);
      if(!this.#turnExecutionClosed(record)||!stored||stored.proof.turnKey!==record.turnKey||stored.proof.recordDigest!==(await this.#recordDigest(record)))reject('pi-developer-execution-isolation-unconfirmed');
    }
  }

  /** Private operator correlation for one exact unresolved blocker. This is
   * intentionally separate from the redacted inventory and returns no
   * identity, actor, payload, reservation, or token/accounting fields. */
  async executionBlockerCorrelation(callKeyValue: unknown): Promise<ModelExecutionBlockerCorrelation> {
    const key = sha(callKeyValue);
    await this.#ready;
    const row = this.#get(key);
    if (!row) reject('model-execution-blocker-absent');
    const record = await this.#verified(row);
    if (this.#executionEnded(record)) reject('model-execution-blocker-ended');
    return structuredClone({
      schemaVersion: 1 as const,
      callKey: record.callKey,
      requestId: record.requestId,
      providerRequestId: record.terminal?.providerRequestId ?? null,
    });
  }

  async snapshot(identityValue: unknown): Promise<ModelBudgetSnapshot> {
    const identity = turnRuntimeIdentity(identityValue);
    this.#scope(identity);
    const key = await turnKey(identity);
    await this.#ready;
    const records = await Promise.all(this.#rows('SELECT * FROM model_calls WHERE turn_key=? ORDER BY accepted_at,call_key', key).map(row => this.#verified(row)));
    const accountedTokens = records.reduce((sum, row) => sum + row.accountedTokens, 0);
    if (!Number.isSafeInteger(accountedTokens) || accountedTokens > this.#policy.maxReservedTokensPerTurn) reject('model-budget-ledger-inconsistent');
    return structuredClone({
      tenantId: this.#policy.tenantId,
      policyVersion: this.#meta().policy_version as string,
      configuredPolicyMatches: this.#policyMatches(),
      turnKey: key,
      maxReservationAttemptsPerTurn: this.#policy.maxReservationAttemptsPerTurn,
      maxDispatchedCallsPerTurn: this.#policy.maxDispatchedCallsPerTurn,
      maxReservedTokensPerTurn: this.#policy.maxReservedTokensPerTurn,
      attempts: records.length,
      dispatchedCalls: records.filter(row => row.dispatchedAt !== null).length,
      accountedTokens,
      active: records.filter(row => ACTIVE.has(row.status)).length,
      pending: records.filter(row => row.reconciliation === 'pending').length,
      records,
    });
  }
}

export function modelCallReference(record: ModelCallRecord): ModelCallReference {
  return { identity: structuredClone(record.identity), callId: record.callId, requestId: record.requestId, digest: record.digest, reservationId: record.reservationId };
}
export function modelBudgetTenantName(tenantId: string): string { return `tenant-model-budget:${identifier(tenantId)}`; }

export {normalizedRequest as modelCallRequest, callKey as modelBudgetCallKey};
