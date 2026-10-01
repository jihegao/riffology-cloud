import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SqlTenantModelBudget,
  modelCallReference,
  type ModelBudgetPolicy,
  type ModelBudgetStorage,
  type ModelCallRequest,
} from '../../services/model-budget/core.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import {turnDigest} from '../../services/turn/protocol.ts';

const identity = (overrides: Partial<TurnRuntimeIdentity> = {}): TurnRuntimeIdentity => ({
  scope: { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 1 },
  sessionId: 'session-a',
  turnId: 'turn-a',
  dispatchId: 'dispatch-a',
  generation: 1,
  ...overrides,
});
const policy: ModelBudgetPolicy = {
  tenantId: 'tenant-a',
  version: 'policy-v1',
  maxReservationAttemptsPerTurn: 3,
  maxDispatchedCallsPerTurn: 3,
  maxInputTokensPerCall: 80,
  maxOutputTokensPerCall: 20,
  maxReservedTokensPerTurn: 120,
};
const request = (overrides: Partial<ModelCallRequest> = {}): ModelCallRequest => ({
  schemaVersion: 1,
  identity: identity(),
  actor: { userId: 'user-a', authVersion: 1 },
  callId: 'call-a',
  requestId: 'request-a',
  deadlineAt: 2_000,
  provider: 'provider-a',
  model: 'model-a',
  payloadSha256: 'a'.repeat(64),
  inputTokenUpperBound: 60,
  maxOutputTokens: 20,
  inputBoundVersion: 'bound-v1',
  budgetPolicyVersion: 'policy-v1',
  ...overrides,
});

function fixture(t: { after(fn: () => void): void }, configured: ModelBudgetPolicy = policy) {
  const directory = mkdtempSync(join(tmpdir(), 'm2-model-budget-'));
  const filename = join(directory, 'ledger.sqlite');
  let database = new DatabaseSync(filename), now = 1_000, failSync = false, id = 0;
  const configure = () => database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  configure();
  const storage = {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        if (query.includes('CREATE TABLE')) { database.exec(query); return { toArray: () => [] }; }
        const statement = database.prepare(query);
        const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
        return { toArray: () => structuredClone(rows) };
      },
    },
    transactionSync<T>(operation: () => T): T {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async sync() { if (failSync) throw Error('injected-sync-unknown'); },
  } as unknown as ModelBudgetStorage;
  const host = (nextPolicy = configured) => new SqlTenantModelBudget(storage, nextPolicy, () => now, () => `reservation-${++id}`);
  t.after(() => { database.close(); rmSync(directory, { recursive: true }); });
  return {
    host,
    get now() { return now; },
    advance(value: number) { now = value; },
    failSync(value: boolean) { failSync = value; },
    sql(query: string) { database.exec(query); },
    reopen() { database.close(); database = new DatabaseSync(filename); configure(); },
  };
}

async function dispatch(host: SqlTenantModelBudget, value: ModelCallRequest = request()) {
  const accepted = await host.reserve(value);
  const reference = modelCallReference(accepted.record);
  const sent = await host.dispatch(reference);
  return { accepted, reference, sent };
}

test('identical reservation retries replay one row and changed identity or payload conflicts', async t => {
  const f = fixture(t), host = f.host();
  const first = await host.reserve(request());
  assert.equal(first.replayed, false);
  assert.equal((await host.reserve(request())).replayed, true);
  await assert.rejects(host.reserve(request({ payloadSha256: 'b'.repeat(64) })), /model-call-idempotency-conflict/);
  await assert.rejects(host.reserve(request({ identity: identity({ dispatchId: 'dispatch-b' }) })), /model-call-idempotency-conflict/);
  assert.deepEqual((await host.lookup(identity(), 'call-a'))?.actor, { userId: 'user-a', authVersion: 1 });
  await assert.rejects(host.reserve(request({ actor: { userId: 'user-a', authVersion: 2 } })), /model-call-idempotency-conflict/);
});

test('stable Turn budget spans runtime dispatch recovery and accounts verified usage', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  await host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 10, outputTokens: 5, source: 'provider-usage', observedAt: f.now } });
  const recoveredIdentity = identity({ dispatchId: 'dispatch-b' });
  const second = await host.reserve(request({ identity: recoveredIdentity, callId: 'call-b', requestId: 'request-b', payloadSha256: 'b'.repeat(64), inputTokenUpperBound: 70, maxOutputTokens: 20 }));
  const snapshot = await host.snapshot(recoveredIdentity);
  assert.equal(second.record.turnKey, first.accepted.record.turnKey);
  assert.equal(snapshot.attempts, 2);
  assert.equal(snapshot.dispatchedCalls, 1);
  assert.equal(snapshot.accountedTokens, 105);
});

test('dispatch is authorized once and an unknown result holds the full bound and blocks the Turn', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  assert.equal(first.sent.authorized, true);
  const replay = await host.dispatch(first.reference);
  assert.equal(replay.authorized, false);
  assert.equal(replay.observeOnly, true);
  assert.equal((await host.markUnknown(first.reference)).status, 'unknown');
  await assert.rejects(host.reserve(request({ callId: 'call-b', requestId: 'request-b' })), /model-turn-active-call/);
  const snapshot = await host.snapshot(identity());
  assert.equal(snapshot.accountedTokens, 80);
  assert.equal(snapshot.pending, 1);
});

test('terminal unknown usage stays pending and cannot be treated as zero', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  const done = await host.finish(first.reference, { outcome: 'failed', errorCode: 'provider-failed', providerRequestId: null, usage: { kind: 'unknown', observedAt: f.now } });
  assert.equal(done.reconciliation, 'pending');
  assert.equal(done.accountedTokens, 80);
  await assert.rejects(host.reserve(request({ callId: 'call-b', requestId: 'request-b', inputTokenUpperBound: 30, maxOutputTokens: 20 })), /model-turn-token-budget-exhausted/);
});

test('verified zero usage is explicit evidence and releases the unused token bound', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  const done = await host.finish(first.reference, { outcome: 'failed', errorCode: 'provider-rejected', providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 0, outputTokens: 0, source: 'provider-usage', observedAt: f.now } });
  assert.equal(done.reconciliation, 'recorded');
  assert.equal(done.accountedTokens, 0);
  const second = await host.reserve(request({ callId: 'call-b', requestId: 'request-b', inputTokenUpperBound: 80, maxOutputTokens: 20 }));
  assert.equal(second.record.reservationTokens, 100);
});

test('only a reserved call can be released and the proof is idempotent and unique', async t => {
  const f = fixture(t), host = f.host();
  const accepted = await host.reserve(request()), reference = modelCallReference(accepted.record);
  const proof = { confirmationId: 'never-started-a', reason: 'cancelled-before-dispatch' as const, observedAt: f.now };
  assert.equal((await host.releaseUndispatched(reference, proof)).status, 'not-dispatched');
  assert.equal((await host.releaseUndispatched(reference, proof)).accountedTokens, 0);
  await assert.rejects(host.releaseUndispatched(reference, { ...proof, reason: 'proxy-pre-dispatch-failed' }), /model-release-conflict/);
  const second = await dispatch(host, request({ callId: 'call-b', requestId: 'request-b' }));
  await assert.rejects(host.releaseUndispatched(second.reference, { confirmationId: 'never-started-b', reason: 'proxy-pre-dispatch-failed', observedAt: f.now }), /model-call-may-have-dispatched/);
});

test('an expired reservation is never dispatched and releases through a durable proof', async t => {
  const f = fixture(t), host = f.host();
  const accepted = await host.reserve(request()), reference = modelCallReference(accepted.record);
  f.advance(2_001);
  const result = await host.dispatch(reference);
  assert.equal(result.authorized, false);
  assert.equal(result.observeOnly, false);
  assert.equal(result.record.status, 'not-dispatched');
  assert.equal(result.record.releaseProof?.reason, 'deadline-before-dispatch');
});

test('disk reopen preserves dispatch fencing and policy changes fail closed', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  f.reopen();
  const reopened = f.host();
  assert.equal((await reopened.dispatch(first.reference)).authorized, false);
  f.reopen();
  const changed = f.host({ ...policy, maxReservationAttemptsPerTurn: 4, version: 'policy-v2' });
  assert.equal((await changed.snapshot(identity())).configuredPolicyMatches, false);
  await assert.rejects(changed.reserve(request({ callId: 'call-b', requestId: 'request-b' })), /model-budget-policy-conflict/);
});

test('a lost dispatch commit response never creates a second authorization', async t => {
  const f = fixture(t), host = f.host();
  const accepted = await host.reserve(request()), reference = modelCallReference(accepted.record);
  f.failSync(true);
  await assert.rejects(host.dispatch(reference), /injected-sync-unknown/);
  f.failSync(false);
  f.reopen();
  const retry = await f.host().dispatch(reference);
  assert.equal(retry.authorized, false);
  assert.equal(retry.observeOnly, true);
});

test('scope, usage bounds and persisted corruption fail closed', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  await assert.rejects(host.lookup(identity({ scope: { ...identity().scope, tenantId: 'tenant-b' } }), 'call-a'), /model-budget-scope-denied/);
  await assert.rejects(host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 61, outputTokens: 0, source: 'provider-usage', observedAt: f.now } }), /invalid-model-budget-integer/);
  f.sql("UPDATE model_calls SET identity_json='{}' WHERE call_id='call-a'");
  await assert.rejects(host.lookup(identity(), 'call-a'), /invalid-persisted-model-budget/);
});

test('verified usage requires a provider request id for later reconciliation', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  await assert.rejects(host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: null, usage: { kind: 'verified', inputTokens: 1, outputTokens: 1, source: 'provider-usage', observedAt: f.now } }), /provider-request-id-required/);
});

test('released reservations count toward the separate per-Turn reservation-attempt limit', async t => {
  const f = fixture(t), host = f.host();
  for (let index = 1; index <= 3; index++) {
    const accepted = await host.reserve(request({ callId: `call-${index}`, requestId: `request-${index}`, payloadSha256: String(index).repeat(64) }));
    await host.releaseUndispatched(modelCallReference(accepted.record), { confirmationId: `release-${index}`, reason: 'cancelled-before-dispatch', observedAt: f.now });
  }
  await assert.rejects(host.reserve(request({ callId: 'call-4', requestId: 'request-4' })), /model-turn-attempt-limit/);
});

test('the dispatched-call limit is independent from released reservation attempts', async t => {
  const f = fixture(t, { ...policy, maxDispatchedCallsPerTurn: 1 }), host = f.host();
  const first = await dispatch(host);
  await host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 0, outputTokens: 0, source: 'provider-usage', observedAt: f.now } });
  await assert.rejects(host.reserve(request({ callId: 'call-b', requestId: 'request-b' })), /model-turn-call-limit/);
});

test('unknown can reconcile to one terminal result and conflicting terminal evidence is rejected', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  await host.markUnknown(first.reference);
  const terminal = { outcome: 'completed' as const, errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified' as const, inputTokens: 10, outputTokens: 5, source: 'provider-usage', observedAt: f.now } };
  assert.equal((await host.finish(first.reference, terminal)).status, 'completed');
  assert.equal((await host.finish(first.reference, terminal)).status, 'completed');
  await assert.rejects(host.finish(first.reference, { ...terminal, usage: { ...terminal.usage, outputTokens: 6 } }), /model-terminal-conflict/);
});

test('terminal evidence older than the unknown observation cannot close pending reconciliation', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  f.advance(1_100); await host.markUnknown(first.reference);
  await assert.rejects(host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 1, outputTokens: 1, source: 'provider-usage', observedAt: 1_050 } }), /model-terminal-before-unknown/);
  assert.equal((await host.lookup(identity(), 'call-a'))?.status, 'unknown');
});

test('concurrent request replay creates one reservation and one dispatch authorization', async t => {
  const f = fixture(t), host = f.host();
  const reservations = await Promise.all([host.reserve(request()), host.reserve(request())]);
  assert.equal(reservations.filter(value => !value.replayed).length, 1);
  assert.equal((await host.snapshot(identity())).attempts, 1);
  const reference = modelCallReference(reservations[0]!.record);
  const dispatches = await Promise.all([host.dispatch(reference), host.dispatch(reference)]);
  assert.equal(dispatches.filter(value => value.authorized).length, 1);
});

test('new reservations require the capability-pinned budget policy version', async t => {
  const f = fixture(t), host = f.host();
  await assert.rejects(host.reserve(request({ budgetPolicyVersion: 'policy-v0' })), /model-budget-policy-conflict/);
});

test('stable Turn keys isolate sessions and turns while spanning runtime dispatch recovery', async t => {
  const f = fixture(t), host = f.host();
  const first = await host.reserve(request());
  const otherSession = identity({ sessionId: 'session-b', turnId: 'turn-b' });
  const second = await host.reserve(request({ identity: otherSession, callId: 'call-a', requestId: 'request-b' }));
  assert.notEqual(first.record.turnKey, second.record.turnKey);
  assert.equal((await host.snapshot(identity())).attempts, 1);
  assert.equal((await host.snapshot(otherSession)).attempts, 1);
});

test('persisted request digests are recomputed rather than trusted', async t => {
  const f = fixture(t), host = f.host();
  await host.reserve(request());
  f.sql("UPDATE model_calls SET request_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE call_id='call-a'");
  await assert.rejects(host.lookup(identity(), 'call-a'), /invalid-persisted-model-budget/);
});

test('persisted terminal digests are recomputed rather than trusted', async t => {
  const f = fixture(t), host = f.host(), first = await dispatch(host);
  await host.finish(first.reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 1, outputTokens: 1, source: 'provider-usage', observedAt: f.now } });
  f.sql("UPDATE model_calls SET terminal_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE call_id='call-a'");
  await assert.rejects(host.lookup(identity(), 'call-a'), /invalid-persisted-model-budget/);
});

test('persisted timestamps from the future fail closed after reopen', async t => {
  const f = fixture(t), host = f.host();
  await host.reserve(request());
  f.sql("UPDATE model_calls SET updated_at=1001 WHERE call_id='call-a'");
  await assert.rejects(host.lookup(identity(), 'call-a'), /invalid-persisted-model-budget/);
});

test('product budget implementation imports no M0 price or billing authority', () => {
  const core = readFileSync(new URL('../../services/model-budget/core.ts', import.meta.url), 'utf8');
  const imports = core.split('\n').filter(line => line.startsWith('import ')).join('\n');
  assert.doesNotMatch(imports, /spikes|m0-|billing|quota\/core/);
  assert.doesNotMatch(core, /microusd|priceBook|currency/i);
});

for(const errorCode of ['rejected-auth','rate-limited','provider-failure','deadline'])test(`developer historical execution fence: ${errorCode} survives restart without ledger changes`,async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await assert.rejects(host.assertExecutionQuiet(),/execution-unconfirmed/);
 await host.finish(call.reference,{outcome:'failed',errorCode,providerRequestId:'req-result',usage:{kind:'unknown',observedAt:1000}});
 const before=await host.snapshot(identity());f.reopen();const next=f.host();
 if(['rejected-auth','rate-limited'].includes(errorCode))await next.assertExecutionQuiet();
 else await assert.rejects(next.assertExecutionQuiet(),/execution-unconfirmed/);
 assert.deepEqual(await next.snapshot(identity()),before);
});

test('developer blocker inventory is read-only and redacts identities and external request ids',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await host.finish(call.reference,{outcome:'failed',errorCode:'provider-failure',providerRequestId:'provider-secret',usage:{kind:'unknown',observedAt:1000}});
 const before=await host.snapshot(identity()),inventory=await host.executionBlockers(),after=await host.snapshot(identity());
 assert.deepEqual(after,before);
 assert.equal(inventory.total,1);assert.equal(inventory.confirmedEnded,0);assert.equal(inventory.blocked,1);
 assert.deepEqual(inventory.blockers,[{
  schemaVersion:1,callKey:before.records[0]!.callKey,turnKey:before.records[0]!.turnKey,provider:'provider-a',model:'model-a',status:'failed',reconciliation:'pending',
  acceptedAt:before.records[0]!.acceptedAt,deadlineAt:before.records[0]!.deadlineAt,dispatchedAt:before.records[0]!.dispatchedAt,unknownAt:before.records[0]!.unknownAt,finishedAt:before.records[0]!.finishedAt,
  terminalOutcome:'failed',terminalErrorCode:'provider-failure',providerRequestIdPresent:true,usageKind:'unknown',
 }]);
 const serialized=JSON.stringify(inventory);
 for(const secret of ['provider-secret','request-a','session-a','dispatch-a','workspace-a'])assert.equal(serialized.includes(secret),false);
});

test('private operator correlation returns only exact unresolved request identifiers',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await host.finish(call.reference,{outcome:'failed',errorCode:'provider-failure',providerRequestId:'provider-secret',usage:{kind:'unknown',observedAt:1000}});
 const before=await host.snapshot(identity()),key=before.records[0]!.callKey;
 assert.deepEqual(await host.executionBlockerCorrelation(key),{schemaVersion:1,callKey:key,requestId:'request-a',providerRequestId:'provider-secret'});
 assert.deepEqual(await host.snapshot(identity()),before);
 await assert.rejects(host.executionBlockerCorrelation('f'.repeat(64)),/model-execution-blocker-absent/);
 await assert.rejects(host.executionBlockerCorrelation('not-a-sha'),/invalid-turn-sha/);
});

test('private operator correlation rejects calls whose execution is confirmed ended',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await host.finish(call.reference,{outcome:'failed',errorCode:'rejected-auth',providerRequestId:'provider-secret',usage:{kind:'unknown',observedAt:1000}});
 const key=(await host.snapshot(identity())).records[0]!.callKey;
 await assert.rejects(host.executionBlockerCorrelation(key),/model-execution-blocker-ended/);
});

test('archive proof blocks exact-scope unknown execution and preserves outside-scope isolation and billing',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host),scope=identity().scope;
 await host.markUnknown(call.reference);
 const before=await host.snapshot(identity());
 assert.deepEqual(await host.archiveQuiescence(scope),{scope,quiescent:false,unresolvedCalls:1});
 const outside={...scope,projectId:'other-project',workspaceId:'other-workspace'};
 assert.deepEqual(await host.archiveQuiescence(outside),{scope:outside,quiescent:true,unresolvedCalls:0});
 const generation={...scope,workspaceGeneration:2};
 assert.deepEqual(await host.archiveQuiescence(generation),{scope:generation,quiescent:false,unresolvedCalls:1});
 await assert.rejects(host.archiveQuiescence({...scope,tenantId:'foreign'}),/actor-scope-denied/);
 assert.deepEqual(await host.snapshot(identity()),before);
 await assert.rejects(host.assertExecutionQuiet(),/execution-unconfirmed/);
});

test('append-only execution isolation proves an exact blocker without changing its billing record',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await host.finish(call.reference,{outcome:'failed',errorCode:'provider-failure',providerRequestId:'provider-secret',usage:{kind:'unknown',observedAt:1000}});
 await host.closeTurnAdmission(identity());
 const before=await host.snapshot(identity()),candidate=await host.executionIsolationCandidate(before.records[0]!.callKey);
 assert.deepEqual(candidate.identity,identity());
 assert.equal(JSON.stringify(candidate).includes('provider-secret'),false);
 await assert.rejects(host.recordExecutionIsolation({schemaVersion:1,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:'e'.repeat(64),isolatedAt:1000,classification:'runtime-released'}),/isolation-denied/);
 f.advance(2_100);
 const proof={schemaVersion:1 as const,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:'e'.repeat(64),isolatedAt:2_100,classification:'runtime-released' as const};
 const stored=await host.recordExecutionIsolation(proof);
 assert.deepEqual(await host.recordExecutionIsolation(proof),stored);
 await assert.rejects(host.recordExecutionIsolation({...proof,evidenceSha256:'f'.repeat(64)}),/isolation-conflict/);
 assert.deepEqual(await host.snapshot(identity()),before);
 await assert.rejects(host.assertExecutionQuiet(),/execution-unconfirmed/);
 await host.assertTurnExecutionIsolated(identity());
 const manifest={schemaVersion:1 as const,ledger:'legacy' as const,proofs:[{callKey:proof.callKey,proofDigest:stored.proofDigest}]};
 assert.equal((await host.assertExecutionIsolated(manifest)).isolated,1);
 await assert.rejects(host.assertExecutionIsolated({...manifest,proofs:[]}),/invalid-model-execution-isolation-manifest/);
 await assert.rejects(host.assertExecutionIsolated({...manifest,proofs:[{...manifest.proofs[0]!,proofDigest:'f'.repeat(64)}]}),/execution-isolation-unconfirmed/);
 f.reopen();
 assert.equal((await f.host().assertExecutionIsolated(manifest)).isolated,1);
 assert.deepEqual(await f.host().snapshot(identity()),before);
});

test('execution isolation rejects a proof whose record digest or exact Turn was substituted',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);
 await host.finish(call.reference,{outcome:'failed',errorCode:'provider-failure',providerRequestId:null,usage:{kind:'unknown',observedAt:1000}});
 await host.closeTurnAdmission(identity());
 f.advance(2_100);
 const candidate=await host.executionIsolationCandidate((await host.snapshot(identity())).records[0]!.callKey);
 const base={schemaVersion:1 as const,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:await turnDigest({authority:'workspace-runtime-tool'}),isolatedAt:2_100,classification:'runtime-absent-and-fenced' as const};
 await assert.rejects(host.recordExecutionIsolation({...base,recordDigest:'f'.repeat(64)}),/isolation-denied/);
 await assert.rejects(host.recordExecutionIsolation({...base,turnKey:'f'.repeat(64)}),/isolation-denied/);
});

test('later provider reconciliation cannot invalidate an immutable execution fence or hide a new blocker',async t=>{
 const f=fixture(t),host=f.host(),call=await dispatch(host);await host.markUnknown(call.reference);await host.closeTurnAdmission(identity());f.advance(2_100);
 const candidate=await host.executionIsolationCandidate((await host.snapshot(identity())).records[0]!.callKey),proof={schemaVersion:1 as const,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:'e'.repeat(64),isolatedAt:2_100,classification:'runtime-released' as const},stored=await host.recordExecutionIsolation(proof),manifest={schemaVersion:1 as const,ledger:'legacy' as const,proofs:[{callKey:proof.callKey,proofDigest:stored.proofDigest}]};
 assert.equal((await host.assertExecutionIsolated(manifest)).blocked,1);
 await host.finish(call.reference,{outcome:'completed',errorCode:null,providerRequestId:'provider-later',usage:{kind:'verified',inputTokens:1,outputTokens:1,source:'provider-usage',observedAt:2_100}});
 const after=await host.assertExecutionIsolated(manifest);assert.equal(after.blocked,0);assert.equal(after.isolated,1);
 const other=identity({sessionId:'session-b',turnId:'turn-b',dispatchId:'dispatch-b'}),extra=await dispatch(host,request({identity:other,callId:'call-b',requestId:'request-b',deadlineAt:3_000,payloadSha256:'b'.repeat(64)}));
 await host.markUnknown(extra.reference);
 await assert.rejects(host.assertExecutionIsolated(manifest),/execution-isolation-unconfirmed/);
});
