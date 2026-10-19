import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { ProjectIrAuthority, IrCommitUnknown, PROJECT_IR_LEASE_MS, PROJECT_IR_INPUT_MAX_BYTES, type ProjectIrStorage, type ProjectIrBucket, type ProjectIrScope } from '../../services/project-ir/authority.ts';
import { projectIrFixture, projectIrFixtureSha } from './project-ir-fixture.ts';

type Obj = Record<string, any>;
export class ProjectIrFakeStorage implements ProjectIrStorage {
  values = new Map<string, unknown>(); writes = 0; syncs = 0; loseNextSyncAck = false; afterSync?: () => void;
  kv = { get: <T>(key: string): T | undefined => structuredClone(this.values.get(key)) as T | undefined,
    put: (key: string, value: unknown) => { this.writes++; this.values.set(key, structuredClone(value)); } };
  async sync() { this.syncs++; if (this.loseNextSyncAck) { this.loseNextSyncAck = false; throw Error('injected durable sync ACK loss after KV writes'); } this.afterSync?.(); }
  transactionSync<T>(callback: () => T): T { const before = structuredClone(this.values); try { return callback(); } catch (error) { this.values = before; throw error; } }
}
export class ProjectIrFakeBucket implements ProjectIrBucket {
  values = new Map<string, Uint8Array>(); writes = 0; failPut = false; dropPut = false; corruptRead = false;
  afterPut?: (key: string, bytes: Uint8Array) => void;
  async get(key: string) {
    const saved = this.values.get(key); if (!saved) return null;
    const bytes = this.corruptRead ? new Uint8Array([0]) : Uint8Array.from(saved);
    return { arrayBuffer: async () => bytes.buffer };
  }
  async put(key: string, bytes: Uint8Array) {
    if (this.failPut) throw Error('injected R2 unavailable');
    this.writes++; if (!this.dropPut) this.values.set(key, Uint8Array.from(bytes));
    this.afterPut?.(key, bytes); return {};
  }
}
const scope: ProjectIrScope = { tenantId: 'tenant-ir', projectId: 'project-ir', workspaceId: 'workspace-ir', workspaceGeneration: 1 };
const clientId = '11111111-1111-4111-8111-111111111111', otherClient = '22222222-2222-4222-8222-222222222222';
let shared: Awaited<ReturnType<typeof projectIrFixture>>, executePlan: (plan: Obj, options?: Obj) => Obj;
async function fixture() {
  if (!shared) {
    const base = new URL('../../vendor/riffoid-ir-plugin/', import.meta.url);
    const [runtimeSource, workerSource, pkg] = await Promise.all([readFile(new URL('browser/runtime.js', base), 'utf8'), readFile(new URL('browser/worker.js', base), 'utf8'), readFile(new URL('package.json', base), 'utf8')]);
    shared = await projectIrFixture({ runtimeSource, workerSource, pluginVersion: JSON.parse(pkg).version });
    executePlan = (await import('data:text/javascript;base64,' + Buffer.from(runtimeSource).toString('base64'))).executePlan;
  }
  return structuredClone(shared);
}
async function setup(authorized?: () => Promise<void>) {
  const f = await fixture(), storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket(); let now = 1_700_000_000_000;
  const p = new ProjectIrAuthority(storage, bucket, scope, () => now, authorized);
  const registration = await p.register({ effectId: 'register-b1', registration: f.registration });
  assert.equal(registration.status, 'succeeded', JSON.stringify(registration));
  return { f, storage, bucket, p, advance: (ms: number) => { now += ms; }, reopen: (s = scope) => new ProjectIrAuthority(storage, bucket, s, () => now, authorized) };
}
async function claim(p: ProjectIrAuthority, ref: string, effectId = 'run-original', options: Obj = {}) {
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  const accepted = await p.tool({ effectId, operation: 'project_ir_run', input: { browserArtifactRef: ref, ...options } });
  assert.equal(accepted.accepted, true, JSON.stringify(accepted));
  const claimed = await p.browser({ operation: 'heartbeat', input: { clientId } });
  assert.equal(claimed.run?.runId, accepted.runId, JSON.stringify(claimed));
  return { accepted, claimed };
}
function result(claimed: Obj) { const value = executePlan(claimed.artifact.plan, claimed.run.inputs); value.planFingerprint = claimed.run.planFingerprint; return value; }
function code(value: Obj) { return value.diagnostics?.[0]?.code; }

test('real compiler B1 graph registers and browser result is persisted before Agent reads', async () => {
  const { f, p, storage, bucket } = await setup();
  storage.values.set('canonical-head', { revisionId: 'untouched' });
  const show = await p.browser({ operation: 'show', input: {} }); assert.equal(show.defaultMode, 'ir');
  assert.equal((await p.browser({ operation: 'draft' })).draft, f.registration.state.draft);
  const { claimed, accepted } = await claim(p, f.browserArtifactRef);
  assert.equal(claimed.runtimeSource, f.runtimeSource); assert.equal(claimed.workerSource, f.workerSource);
  assert.equal(claimed.run.execution.verification, 'local-unverified');
  const computed = result(claimed);
  assert.deepEqual(Object.fromEntries(['planned_sorties', 'launched_sorties', 'completed_sorties', 'successful_mission_waves', 'cancelled_sorties', 'delayed_sorties', 'elapsed_minutes'].map(k => [k, computed.metrics[k]])), { planned_sorties: 2, launched_sorties: 2, completed_sorties: 2, successful_mission_waves: 2, cancelled_sorties: 0, delayed_sorties: 0, elapsed_minutes: 60 });
  const saved = await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, result: computed } });
  assert.equal(saved.status, 'succeeded', JSON.stringify(saved));
  const read = await p.tool({ effectId: 'result-original', operation: 'project_ir_result', input: { runId: accepted.runId } });
  assert.deepEqual(read, saved); assert.ok(bucket.writes > 0);
  assert.deepEqual(storage.values.get('canonical-head'), { revisionId: 'untouched' });
  assert.ok([...storage.values.keys()].filter(k => k !== 'canonical-head').every(k => /^project-ir\/v1\/[a-f0-9]{64}\//.test(k)));
  const records = await p.browser({ operation: 'records' }); assert.equal(records.records.length, 1); assert.equal('events' in records.records[0], false); assert.equal('terminalState' in records.records[0], false);
});

test('effect IDs bind operation and input; observation never allocates or refreshes a run', async () => {
  const { f, p, storage, bucket, reopen } = await setup();
  const before = [storage.writes, bucket.writes];
  assert.equal(code(await p.tool({ effectId: 'absent', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef }, observeOnly: true })), 'effect_absent');
  assert.deepEqual([storage.writes, bucket.writes], before);
  const noBrowser = await p.tool({ effectId: 'disconnected', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } }); assert.equal(noBrowser.accepted, false);
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  assert.deepEqual(await p.tool({ effectId: 'disconnected', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } }), noBrowser);
  const a = await p.tool({ effectId: 'original', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } });
  const after = [storage.writes, bucket.writes];
  assert.deepEqual(await reopen().tool({ effectId: 'original', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef }, observeOnly: true }), a);
  assert.deepEqual([storage.writes, bucket.writes], after);
  assert.equal(code(await p.tool({ effectId: 'original', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef, runOptions: { seed: 1 } } })), 'effect_conflict');
  assert.equal(code(await p.tool({ effectId: 'original', operation: 'project_ir_result', input: { runId: a.runId } })), 'effect_conflict');
  const changed = structuredClone(f.registration); changed.state.modelMode = 'code';
  assert.equal(code(await p.register({ effectId: 'register-b1', registration: changed })), 'effect_conflict');
});

test('lost heartbeat ACK and actor reconstruction do not dispatch a running job twice; lease expires terminally', async () => {
  const { f, p, reopen, advance } = await setup();
  const { accepted } = await claim(p, f.browserArtifactRef);
  assert.deepEqual(await reopen().browser({ operation: 'heartbeat', input: { clientId } }), { connected: true });
  assert.deepEqual(await p.browser({ operation: 'heartbeat', input: { clientId: otherClient } }), { connected: true });
  advance(PROJECT_IR_LEASE_MS);
  const expired = await reopen().browser({ operation: 'project_ir_result', input: { runId: accepted.runId } });
  assert.equal(expired.status, 'interrupted'); assert.equal(code(expired), 'browser_disconnected');
  assert.deepEqual(await reopen().browser({ operation: 'heartbeat', input: { clientId } }), { connected: true });
  assert.equal(code(await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, error: 'late worker' } })), 'submission_conflict');
});

test('detach interrupts the owned run and unavailable browser rejects a new run', async () => {
  const { f, p } = await setup(); const { accepted } = await claim(p, f.browserArtifactRef);
  assert.deepEqual(await p.browser({ operation: 'detach', input: { clientId } }), { disconnected: true });
  assert.equal((await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })).status, 'interrupted');
  assert.equal((await p.tool({ effectId: 'after-detach', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })).accepted, false);
});

test('submission ACK is idempotent; a conflicting result, wrong owner and malformed event identity are rejected', async () => {
  const { f, p, reopen } = await setup(); const { claimed, accepted } = await claim(p, f.browserArtifactRef), good = result(claimed);
  assert.equal(code(await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId: otherClient, result: good } })), 'run_not_owned');
  for (const mutate of [(r: Obj) => { r.seed++; }, (r: Obj) => { r.planFingerprint = '0'.repeat(64); }, (r: Obj) => { r.runtimeVersion = 'other'; }, (r: Obj) => { r.stopReason = 'natural'; }, (r: Obj) => { r.metrics.elapsed_minutes--; }, (r: Obj) => { r.events[0].sequence = 2; }, (r: Obj) => { r.events[1].time = -1; }, (r: Obj) => { r.events.at(-1).kind = 'unfinished'; }]) {
    const bad = structuredClone(good); mutate(bad);
    assert.equal((await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, result: bad } })).status, 'failed');
    assert.equal((await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })).status, 'running');
  }
  const input = { runId: accepted.runId, clientId, result: good }, saved = await p.browser({ operation: 'submit', input });
  assert.equal(saved.status, 'succeeded'); assert.deepEqual(await reopen().browser({ operation: 'submit', input }), saved);
  const different = structuredClone(input); different.result.metrics.planned_sorties++;
  assert.equal(code(await p.browser({ operation: 'submit', input: different })), 'submission_conflict');
});

test('R2 write/readback failure never publishes success; explicit identical submission may finish after recovery', async () => {
  const { f, p, bucket } = await setup(); const { claimed, accepted } = await claim(p, f.browserArtifactRef), input = { runId: accepted.runId, clientId, result: result(claimed) };
  bucket.failPut = true;
  assert.equal((await p.browser({ operation: 'submit', input })).status, 'failed');
  bucket.failPut = false;
  assert.equal((await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })).status, 'running');
  bucket.dropPut = true;
  assert.equal(code(await p.browser({ operation: 'submit', input })), 'persistence_failed');
  bucket.dropPut = false;
  const saved = await p.browser({ operation: 'submit', input }); assert.equal(saved.status, 'succeeded');
  bucket.corruptRead = true;
  assert.equal(code(await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })), 'artifact_integrity');
});

test('fresh authorization is checked after R2 awaits and before every visible publication', async () => {
  let allowed = true; const authorize = async () => { if (!allowed) throw Error('revoked'); };
  const f = await fixture(), storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket(), p = new ProjectIrAuthority(storage, bucket, scope, undefined, authorize);
  bucket.afterPut = () => { allowed = false; };
  assert.equal(code(await p.register({ effectId: 'revoked-register', registration: f.registration })), 'authorization_denied');
  assert.equal(storage.writes, 0); assert.equal(bucket.writes, 1);
  allowed = true; bucket.afterPut = undefined;
  assert.equal((await p.register({ effectId: 'revoked-register', registration: f.registration })).status, 'succeeded');
  const { claimed, accepted } = await claim(p, f.browserArtifactRef);
  bucket.afterPut = (_key, bytes) => { if (Buffer.from(bytes).toString().includes('"status":"succeeded"')) allowed = false; };
  assert.equal(code(await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, result: result(claimed) } })), 'authorization_denied');
  allowed = true; bucket.afterPut = undefined;
  assert.equal((await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })).status, 'running');
});

test('source replay keeps the original graph, worker, runtime and seed across later registration and reopen', async () => {
  const { f, p, reopen } = await setup(); const { claimed, accepted } = await claim(p, f.browserArtifactRef, 'first', { runOptions: { seed: 13 } });
  const original = await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, result: result(claimed) } });
  assert.equal(original.status, 'succeeded');
  const later = await projectIrFixture({ runtimeSource: f.runtimeSource + '\n// later package runtime\n', workerSource: f.workerSource + '\n// later package worker\n', pluginVersion: '0.3.2' });
  assert.equal((await p.register({ effectId: 'later-register', registration: later.registration })).status, 'succeeded');
  const reopened = reopen(); await reopened.browser({ operation: 'heartbeat', input: { clientId } });
  const replay = await reopened.tool({ effectId: 'explicit-replay', operation: 'project_ir_run', input: { sourceRunId: accepted.runId } }); assert.equal(replay.accepted, true);
  const replayClaim = await reopened.browser({ operation: 'heartbeat', input: { clientId } });
  assert.notEqual(replay.runId, original.runId); assert.equal(replayClaim.run.sourceRunId, original.runId);
  assert.equal(replayClaim.workerSource, f.workerSource); assert.equal(replayClaim.runtimeSource, f.runtimeSource); assert.deepEqual(replayClaim.run.inputs, original.inputs); assert.equal(replayClaim.run.browserArtifactRef, original.browserArtifactRef);
  const saved = await reopened.browser({ operation: 'submit', input: { runId: replay.runId, clientId, result: result(replayClaim) } });
  assert.equal(saved.status, 'succeeded'); assert.deepEqual(saved.metrics, original.metrics); assert.deepEqual(saved.events, original.events);
  assert.deepEqual(await reopened.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } }), original);
});

test('all scope components isolate registrations and records; traversal and graph tampering cannot select an object key', async () => {
  const { f, p, storage, bucket, reopen } = await setup(); const { accepted } = await claim(p, f.browserArtifactRef);
  for (const different of [{ ...scope, tenantId: 'other-tenant' }, { ...scope, projectId: 'other-project' }, { ...scope, workspaceId: 'other-workspace' }, { ...scope, workspaceGeneration: 2 }]) {
    assert.equal(code(await reopen(different).browser({ operation: 'project_ir_result', input: { runId: accepted.runId } })), 'run_not_found');
    await reopen(different).browser({ operation: 'heartbeat', input: { clientId } });
    assert.equal(code(await reopen(different).tool({ effectId: 'same-effect', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })), 'artifact_unregistered');
  }
  for (const path of ['../escape', '/.riffoid-ir/artifacts/' + 'a'.repeat(64) + '/browser.json', '.riffoid-ir/artifacts/' + 'a'.repeat(64) + '/../../secret', '.riffoid-ir/models/' + 'a'.repeat(64) + '/runtime.js']) {
    const bad = structuredClone(f.registration); bad.files[0]!.path = path;
    const before = bucket.writes;
    assert.equal(code(await p.register({ effectId: path, registration: bad })), 'invalid_reference'); assert.equal(bucket.writes, before);
  }
  const bad = structuredClone(f.registration); bad.files[0]!.base64 = Buffer.from('{}').toString('base64');
  assert.equal(code(await p.register({ effectId: 'bad-bytes', registration: bad })), 'artifact_integrity');
  const before = storage.writes;
  const onlyArtifact = structuredClone(f.registration); onlyArtifact.files = onlyArtifact.files.filter(x => x.path === f.browserArtifactRef);
  const foreign = reopen({ ...scope, workspaceGeneration: 3 });
  assert.equal(code(await foreign.register({ effectId: 'missing-dependencies', registration: onlyArtifact })), 'artifact_unregistered'); assert.equal(storage.writes, before);
});

test('registration schema, input size, queue size and record summary bounds are explicit', async () => {
  const { f, p } = await setup();
  assert.equal(code(await p.browser({ operation: 'show', input: { objectKey: 'forbidden' } })), 'invalid_input');
  assert.equal(code(await p.register({ effectId: 'extra', registration: { ...f.registration, schemaVersion: 1 } })), 'invalid_input');
  assert.equal(code(await p.register({ effectId: 'too-large', registration: { ...f.registration, state: { ...f.registration.state, draft: 'x'.repeat(PROJECT_IR_INPUT_MAX_BYTES) } } })), 'input_limit');
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  for (let n = 0; n < 8; n++) assert.equal((await p.tool({ effectId: `queued-${n}`, operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })).accepted, true);
  assert.equal(code(await p.tool({ effectId: 'queue-overflow', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })), 'run_queue_limit');
  const badInput = [{ browserArtifactRef: f.browserArtifactRef, sourceRunId: 'run-00000000-0000-0000-0000-000000000000' }, { browserArtifactRef: f.browserArtifactRef, runOptions: { seed: -1 } }, { browserArtifactRef: f.browserArtifactRef, runOptions: { duration: 1 } }, { sourceRunId: 'run-00000000-0000-0000-0000-000000000000', runOptions: { seed: 0 } }];
  for (let n = 0; n < badInput.length; n++) assert.equal((await p.tool({ effectId: `bad-input-${n}`, operation: 'project_ir_run', input: badInput[n] })).status, 'failed');
});

test('200 total runs are bounded and records returns at most 50 summaries without traces', async () => {
  const { f, p, advance } = await setup();
  for (let n = 0; n < 200; n++) {
    await p.browser({ operation: 'heartbeat', input: { clientId } });
    const accepted = await p.tool({ effectId: `bounded-${n}`, operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } }); assert.equal(accepted.accepted, true, JSON.stringify(accepted));
    const claimed = await p.browser({ operation: 'heartbeat', input: { clientId } }); assert.equal(claimed.run.runId, accepted.runId);
    const failed = await p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, error: 'deliberately stopped before execution' } }); assert.equal(failed.status, 'failed'); assert.equal(code(failed), 'browser_execution_failed'); advance(1);
  }
  const records = await p.browser({ operation: 'records' }); assert.equal(records.records.length, 50); assert.ok(records.records.every((r: Obj) => !('events' in r)));
  assert.equal(code(await p.tool({ effectId: 'bounded-201', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })), 'run_limit');
});


test('concurrent instances share one durable effect/claim boundary and preserve distinct index entries', async () => {
  const { f, p, reopen } = await setup();
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  const input = { effectId: 'concurrent-original', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } };
  const [first, repeated] = await Promise.all([p.tool(input), reopen().tool(input)]);
  assert.equal(first.accepted, true); assert.deepEqual(repeated, first);
  const [a, b] = await Promise.all([p.browser({ operation: 'heartbeat', input: { clientId } }), reopen().browser({ operation: 'heartbeat', input: { clientId: otherClient } })]);
  assert.equal([a, b].filter(x => x.run?.runId === first.runId).length, 1);
  const pairs = await Promise.all(Array.from({ length: 3 }, (_, n) => reopen().tool({ effectId: `concurrent-next-${n}`, operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })));
  assert.equal(new Set(pairs.map(x => x.runId)).size, 3);
  const records = await p.browser({ operation: 'records' }); assert.equal(records.records.length, 4);
});

test('self-consistent paths cannot hide a changed compiler Plan, seed or frozen worker', async () => {
  const { f, p, bucket } = await setup();
  for (const [name, mutate] of [
    ['plan', (a: Obj) => { a.plan.duration_minutes++; }],
    ['seed', (a: Obj) => { a.defaultSeed++; }],
    ['identity', (a: Obj) => { a.planFingerprint = 'f'.repeat(64); }],
  ] as const) {
    const registration = structuredClone(f.registration), file = registration.files.find(x => x.path === f.browserArtifactRef)!;
    const artifact = JSON.parse(Buffer.from(file.base64, 'base64').toString('utf8')); mutate(artifact);
    const bytes = Buffer.from(JSON.stringify(artifact)); file.sha256 = projectIrFixtureSha(bytes); file.path = `.riffoid-ir/artifacts/${file.sha256}/browser.json`; file.base64 = bytes.toString('base64');
    const before = bucket.writes; assert.equal(code(await p.register({ effectId: `changed-${name}`, registration })), 'artifact_identity'); assert.equal(bucket.writes, before);
  }
  const changedWorker = structuredClone(f.registration); changedWorker.workerSource += '\n// changed worker';
  assert.equal(code(await p.register({ effectId: 'changed-worker', registration: changedWorker })), 'artifact_conflict');
  const runtimeKey = [...bucket.values.keys()].find(k => k.endsWith(f.artifact.toolchain.runtimeSha256))!;
  bucket.values.set(runtimeKey, Buffer.from('tampered runtime'));
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  assert.equal(code(await p.tool({ effectId: 'corrupted-runtime', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } })), 'artifact_integrity');
});


test('actor and authVersion bind effects, browser leases and submissions while historical reads/replay remain explicit', async () => {
  const f = await fixture(), storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket(), owner = { userId: 'owner', authVersion: 1 };
  const p = new ProjectIrAuthority(storage, bucket, scope, undefined, undefined, owner);
  assert.equal((await p.register({ effectId: 'register-owner', registration: f.registration })).status, 'succeeded');
  const other = new ProjectIrAuthority(storage, bucket, scope, undefined, undefined, { userId: 'other-owner', authVersion: 1 });
  const renewed = new ProjectIrAuthority(storage, bucket, scope, undefined, undefined, { userId: 'owner', authVersion: 2 });
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  const pending = await p.tool({ effectId: 'owned-effect', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } });
  assert.equal(pending.accepted, true);
  assert.deepEqual(await other.browser({ operation: 'heartbeat', input: { clientId: otherClient } }), { connected: true });
  assert.equal(code(await renewed.browser({ operation: 'heartbeat', input: { clientId } })), 'client_conflict');
  assert.equal(code(await other.tool({ effectId: 'owned-effect', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef }, observeOnly: true })), 'effect_conflict');
  assert.equal(code(await other.register({ effectId: 'register-owner', registration: f.registration })), 'effect_conflict');
  const claimed = await p.browser({ operation: 'heartbeat', input: { clientId } }); assert.deepEqual(claimed.run.actor, owner);
  const value = result(claimed), input = { runId: pending.runId, clientId, result: value };
  assert.equal(code(await other.browser({ operation: 'submit', input })), 'run_not_owned');
  assert.equal(code(await renewed.browser({ operation: 'submit', input })), 'run_not_owned');
  const original = await p.browser({ operation: 'submit', input }); assert.equal(original.status, 'succeeded');
  assert.deepEqual(await renewed.browser({ operation: 'project_ir_result', input: { runId: pending.runId } }), original);
  const newClient = '33333333-3333-4333-8333-333333333333';
  await renewed.browser({ operation: 'heartbeat', input: { clientId: newClient } });
  const replay = await renewed.tool({ effectId: 'renewed-replay', operation: 'project_ir_run', input: { sourceRunId: pending.runId } }); assert.equal(replay.accepted, true);
  const replayClaim = await renewed.browser({ operation: 'heartbeat', input: { clientId: newClient } }); assert.deepEqual(replayClaim.run.actor, { userId: 'owner', authVersion: 2 }); assert.equal(replayClaim.run.sourceRunId, original.runId);
  assert.equal(code(await renewed.browser({ operation: 'submit', input })), 'run_not_owned');
});


test('noncompile state updates preserve installed compiler readiness while replacing the current draft only', async () => {
  const { f, p } = await setup();
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  const before = await p.browser({ operation: 'show' });
  const registration = { schema: 'riffoid-ir.registration/v1', files: [], state: { ...f.registration.state, draft: '{ broken draft', modelMode: 'code', toolchain: null }, workerSource: null };
  assert.equal((await p.register({ effectId: 'updated-state-no-compile', registration })).status, 'succeeded');
  const after = await p.browser({ operation: 'show' });
  assert.deepEqual(after.toolchain, before.toolchain); assert.equal(after.compiler.ready, true); assert.equal(after.runtimeVersion, before.runtimeVersion); assert.equal(after.browserConnected, true); assert.equal(after.defaultMode, 'code');
  assert.equal((await p.browser({ operation: 'draft' })).draft, '{ broken draft');
});


test('a durable run effect with lost KV sync ACK remains unknown and is recovered by read-only original-effect observation', async () => {
  const { f, p, storage, bucket, reopen } = await setup();
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  const input = { effectId: 'run-sync-ack-lost', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } };
  storage.loseNextSyncAck = true;
  await assert.rejects(p.tool(input), (error: unknown) => error instanceof IrCommitUnknown && error.name === 'IrCommitUnknown' && error.code === 'project-ir-commit-unknown' && error.outcome === 'unknown');
  const entries = [...storage.values.entries()].filter(([key]) => key.includes('/runs/'));
  assert.equal(entries.length, 1, 'the original pending run already exists despite its lost acknowledgement');
  const original = entries[0]![1] as Obj; assert.equal(original.record.status, 'pending');
  const before = [storage.writes, storage.syncs, bucket.writes];
  const observed = await reopen().tool({ ...input, observeOnly: true });
  assert.equal(observed.accepted, true); assert.equal(observed.runId, original.record.runId); assert.equal(observed.status, 'pending');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before, 'observation must not rewrite, reserve or allocate');
  assert.equal([...storage.values.keys()].filter(key => key.includes('/runs/')).length, 1);
  assert.deepEqual(await reopen().tool(input), observed, 'same effect re-entry returns the original receipt');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  const absent = await reopen().tool({ ...input, effectId: 'unseen-after-unknown', observeOnly: true });
  assert.equal(absent.status, 'absent'); assert.equal(code(absent), 'effect_absent');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  assert.equal([...storage.values.keys()].filter(key => key.includes('/runs/')).length, 1);
});

test('registration KV sync ACK loss propagates unknown while identical original registration reconciles without new publication', async () => {
  const f = await fixture(), storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket();
  const p = new ProjectIrAuthority(storage, bucket, scope), input = { effectId: 'registration-sync-ack-lost', registration: f.registration };
  storage.loseNextSyncAck = true;
  await assert.rejects(p.register(input), IrCommitUnknown);
  const before = [storage.writes, storage.syncs, bucket.writes];
  const observed = await new ProjectIrAuthority(storage, bucket, scope).register(input);
  assert.equal(observed.status, 'succeeded'); assert.deepEqual(observed.browserArtifactRefs, [f.browserArtifactRef]);
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  assert.equal((await p.browser({ operation: 'show' })).compiler.ready, true);
  assert.equal((await p.register({ effectId: 'invalid-registration-still-diagnostic', registration: { ...f.registration, schema: 'bad' } })).status, 'failed');
});

test('terminal browser save with lost KV sync ACK escapes as unknown and reads the saved original record without recomputation', async () => {
  const { f, p, storage, bucket, reopen } = await setup();
  const { claimed, accepted } = await claim(p, f.browserArtifactRef), computed = result(claimed);
  storage.loseNextSyncAck = true;
  await assert.rejects(p.browser({ operation: 'submit', input: { runId: accepted.runId, clientId, result: computed } }), IrCommitUnknown);
  const before = [storage.writes, storage.syncs, bucket.writes];
  const original = await reopen().browser({ operation: 'project_ir_result', input: { runId: accepted.runId } });
  assert.equal(original.status, 'succeeded'); assert.deepEqual(original.events, computed.events); assert.deepEqual(original.metrics, computed.metrics);
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before, 'the original saved record is read without publishing or re-executing');
  assert.deepEqual(await reopen().browser({ operation: 'heartbeat', input: { clientId } }), { connected: true });
  assert.equal([...storage.values.keys()].filter(key => key.includes('/runs/')).length, 1);
});


test('post-commit final authorization failure escapes diagnostics and original run observation remains read-only', async () => {
  let denyNext = false;
  const authorize = async () => { if (denyNext) { denyNext = false; throw Error('transient final authorization failure'); } };
  const { f, p, storage, bucket, reopen } = await setup(authorize);
  await p.browser({ operation: 'heartbeat', input: { clientId } });
  storage.afterSync = () => { storage.afterSync = undefined; denyNext = true; };
  const input = { effectId: 'run-final-authorization', operation: 'project_ir_run', input: { browserArtifactRef: f.browserArtifactRef } };
  await assert.rejects(p.tool(input), (error: any) => error.code === 'authorization_denied');
  const runs = [...storage.values.entries()].filter(([key]) => key.includes('/runs/'));
  assert.equal(runs.length, 1); const original = (runs[0]![1] as Obj).record;
  assert.equal(original.status, 'pending');
  const before = [storage.writes, storage.syncs, bucket.writes];
  const observed = await reopen().tool({ ...input, observeOnly: true });
  assert.deepEqual(observed, { accepted: true, runId: original.runId, status: 'pending', diagnostics: [] });
  assert.deepEqual(await reopen().tool(input), observed);
  assert.equal((await reopen().tool({ ...input, effectId: 'missing-final-authorization', observeOnly: true })).status, 'absent');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  assert.equal([...storage.values.keys()].filter(key => key.includes('/runs/')).length, 1);
});

test('post-commit registration and terminal save authorization failures preserve their original durable results', async () => {
  let denyNext = false;
  const authorize = async () => { if (denyNext) { denyNext = false; throw Error('transient final authorization failure'); } };
  const f = await fixture(), storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket();
  const p = new ProjectIrAuthority(storage, bucket, scope, () => 1000, authorize);
  const revokeAfterCommit = () => { storage.afterSync = () => { storage.afterSync = undefined; denyNext = true; }; };
  const registration = { effectId: 'register-final-authorization', registration: f.registration };
  revokeAfterCommit();
  await assert.rejects(p.register(registration), (error: any) => error.code === 'authorization_denied');
  let before = [storage.writes, storage.syncs, bucket.writes];
  assert.equal((await p.register(registration)).status, 'succeeded');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  const { claimed, accepted } = await claim(p, f.browserArtifactRef), computed = result(claimed);
  const submit = { operation: 'submit', input: { runId: accepted.runId, clientId, result: computed } };
  revokeAfterCommit();
  await assert.rejects(p.browser(submit), (error: any) => error.code === 'authorization_denied');
  before = [storage.writes, storage.syncs, bucket.writes];
  const original = await p.browser({ operation: 'project_ir_result', input: { runId: accepted.runId } });
  assert.equal(original.status, 'succeeded'); assert.deepEqual(original.metrics, computed.metrics); assert.deepEqual(original.events, computed.events);
  assert.deepEqual(await p.browser(submit), original);
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes], before);
  assert.equal([...storage.values.keys()].filter(key => key.includes('/runs/')).length, 1);
});

test('initial authorization rejection remains a diagnostic with no KV or R2 resources', async () => {
  const storage = new ProjectIrFakeStorage(), bucket = new ProjectIrFakeBucket();
  const p = new ProjectIrAuthority(storage, bucket, scope, undefined, async () => { throw Error('initially denied'); });
  const denied = await p.tool({ effectId: 'initially-denied', operation: 'project_ir_run', input: { browserArtifactRef: '.riffoid-ir/artifacts/' + 'a'.repeat(64) + '/browser.json' } });
  assert.equal(denied.status, 'failed'); assert.equal(code(denied), 'authorization_denied');
  assert.deepEqual([storage.writes, storage.syncs, bucket.writes, storage.values.size, bucket.values.size], [0, 0, 0, 0, 0]);
});
