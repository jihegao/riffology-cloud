import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { IrProject } from '../src/project.mjs';
import { executePlan } from '../browser/runtime.js';

async function setup(options) {
  const p = new IrProject(await mkdtemp('/tmp/riffoid-project-'), options);
  await p.seedExample();
  const checked = await p.check({ draftRef: 'model/business-ir.draft.json' });
  const compiled = await p.compile({ sealedRef: checked.sealedRef });
  assert.equal(compiled.status, 'succeeded', JSON.stringify(compiled));
  return { p, ...compiled };
}
async function finishHarness(p, artifactRef, sourceRunId) {
  const clientId = randomUUID(); await p.heartbeat({ clientId });
  const accepted = await p.run(sourceRunId ? { sourceRunId } : { browserArtifactRef: artifactRef });
  assert.equal(accepted.status, 'pending');
  const claim = await p.heartbeat({ clientId }); assert.equal(claim.run.status, 'running');
  const result = executePlan(claim.artifact.plan, claim.run.inputs); result.planFingerprint = claim.run.planFingerprint;
  return p.submit({ runId: accepted.runId, clientId, result });
}
test('JSON diagnostics locate a syntax error; repair can continue through real compilation', async () => {
  const p = new IrProject(await mkdtemp('/tmp/riffoid-syntax-'));
  await p.write('model/business-ir.draft.json', '{\n "payload": ');
  const bad = await p.check({ draftRef: 'model/business-ir.draft.json' });
  assert.equal(bad.status, 'failed'); assert.equal(bad.diagnostics[0].code, 'invalid_json');
  assert.ok(bad.diagnostics[0].line >= 2); assert.ok(bad.diagnostics[0].column > 0);
  const fixture = await readFile(new URL('../acceptance/b1/business-ir.json', import.meta.url), 'utf8');
  await p.write('model/business-ir.draft.json', fixture);
  const valid = await p.check({ draftRef: 'model/business-ir.draft.json' });
  assert.equal(valid.status, 'passed'); assert.equal((await p.compile({ sealedRef: valid.sealedRef })).status, 'succeeded');
});

test('mode defaults persist without creating/converting models', async () => {
  const root = await mkdtemp('/tmp/riffoid-modes-'), p = new IrProject(root);
  assert.equal((await p.show()).defaultMode, 'code'); assert.equal((await p.show()).currentModel, null);
  await p.setMode('ir'); assert.equal((await new IrProject(root).show()).defaultMode, 'ir');
  await p.seedExample(); const before = await p.read('model/business-ir.draft.json');
  await p.setMode('code'); assert.deepEqual(await p.read('model/business-ir.draft.json'), before);
  assert.equal((await p.show()).currentModel.type, 'ir');
});

test('frozen artifacts and inputs survive edits, reopen, and sourceRunId replay', async () => {
  const { p, browserArtifactRef } = await setup();
  const before = await finishHarness(p, browserArtifactRef);
  assert.equal(before.status, 'succeeded');
  const draft = await p.read('model/business-ir.draft.json');
  draft.payload.sections.mission_profile.collections.composite_tasks[0].definition.taskItems[1].firstWaveTime = '00:45';
  await p.write('model/business-ir.draft.json', draft);
  const check = await p.check({ draftRef: 'model/business-ir.draft.json' }), compiled = await p.compile({ sealedRef: check.sealedRef });
  const after = await finishHarness(p, compiled.browserArtifactRef);
  assert.notEqual(after.planFingerprint, before.planFingerprint);
  const reopened = new IrProject(p.workspace);
  assert.deepEqual(await reopened.result({ runId: before.runId }), before);
  const replay = await finishHarness(reopened, null, before.runId);
  assert.equal(replay.sourceRunId, before.runId); assert.notEqual(replay.runId, before.runId);
  assert.equal(replay.browserArtifactRef, before.browserArtifactRef); assert.equal(replay.runtimeRef, before.runtimeRef);
  assert.deepEqual(replay.inputs, before.inputs); assert.deepEqual(replay.events, before.events); assert.deepEqual(replay.metrics, before.metrics);
});

test('missing browser, invalid options, lease loss and failed persistence never report successful execution', async () => {
  let now = Date.now(); const { p, browserArtifactRef } = await setup({ now: () => now, leaseMs: 100 });
  assert.equal((await p.run({ browserArtifactRef })).accepted, false);
  assert.equal((await p.operation('project_ir_run', { browserArtifactRef, runOptions: { duration: 10 } })).status, 'failed');
  const clientId = randomUUID(); await p.heartbeat({ clientId });
  const pending = await p.run({ browserArtifactRef });
  const claim = await p.heartbeat({ clientId }); assert.equal(claim.run.runId, pending.runId);
  now += 101;
  assert.equal((await p.result({ runId: pending.runId })).status, 'interrupted');
  assert.equal((await p.operation('submit', { runId: pending.runId, clientId, result: {} })).status, 'failed');
  await p.heartbeat({ clientId }); const next = await p.run({ browserArtifactRef }); const nextClaim = await p.heartbeat({ clientId });
  const result = executePlan(nextClaim.artifact.plan); result.planFingerprint = nextClaim.run.planFingerprint;
  const originalWrite = p.write.bind(p);
  p.write = async (ref, value) => { if (value.status === 'succeeded') throw new Error('disk full'); return originalWrite(ref, value); };
  assert.equal((await p.operation('submit', { runId: next.runId, clientId, result })).status, 'failed');
  assert.equal((await p.result({ runId: next.runId })).status, 'running');
  await p.detach({ clientId }); assert.equal((await p.result({ runId: next.runId })).status, 'interrupted');
});

test('content references reject tampering and workspace symlink escapes', async () => {
  const { p, browserArtifactRef } = await setup();
  const outside = await mkdtemp('/tmp/riffoid-outside-'); await symlink(outside, `${p.workspace}/escape`);
  await assert.rejects(p.write('escape/file.json', {}), /Symlink escapes/);
  await assert.rejects(p.read('../escape.json'), /relative/);
  const artifact = await p.read(browserArtifactRef); artifact.plan.duration_minutes = 2; await p.write(browserArtifactRef, artifact);
  assert.equal((await p.operation('project_ir_run', { browserArtifactRef })).diagnostics[0].code, 'artifact_integrity');
});
