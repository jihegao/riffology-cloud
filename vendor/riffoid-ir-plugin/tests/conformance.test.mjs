import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { IrProject } from '../src/project.mjs';
import { invokeCompiler } from '../src/compiler.mjs';
import { executePlan, planDiagnostics } from '../browser/runtime.js';

const fixture = JSON.parse(await readFile(new URL('../acceptance/b1/business-ir.json', import.meta.url)));
const expected = JSON.parse(await readFile(new URL('../acceptance/b1/expected.json', import.meta.url)));
export const tuple = e => [e.time, e.phase, e.kind, e.entity];
export function assertExpected(actual, expectedCase) {
  assert.deepEqual(Object.fromEntries(Object.keys(expectedCase.metrics).map(k => [k, actual.metrics[k]])), expectedCase.metrics);
  assert.equal(actual.stopReason, expectedCase.stop_reason);
  for (const list of [expectedCase.selected_events, expectedCase.same_minute_order]) {
    let cursor = -1;
    for (const event of list) {
      const index = actual.events.findIndex((e, i) => i > cursor && JSON.stringify(tuple(e)) === JSON.stringify(tuple(event)));
      assert.ok(index > cursor, `Missing or unordered ${JSON.stringify(event)}`); cursor = index;
    }
  }
}
async function compile(project, draft) {
  await project.write('model/business-ir.draft.json', draft);
  const sealed = await project.check({ draftRef: 'model/business-ir.draft.json' });
  assert.equal(sealed.status, 'passed', JSON.stringify(sealed));
  const compiled = await project.compile({ sealedRef: sealed.sealedRef });
  assert.equal(compiled.status, 'succeeded', JSON.stringify(compiled));
  return { ...compiled, artifact: await project.read(compiled.browserArtifactRef) };
}
test('real SDK compilation, B1 and +5 variant agree with fixed expectations and independent Python reference', async () => {
  const project = new IrProject(await mkdtemp('/tmp/riffoid-conformance-'));
  const identities = [];
  for (const [time, expectation] of [['00:40', expected.baseline], ['00:45', expected.second_mission_plus_5_minutes]]) {
    const draft = structuredClone(fixture);
    draft.payload.sections.mission_profile.collections.composite_tasks[0].definition.taskItems[1].firstWaveTime = time;
    const compiled = await compile(project, draft); identities.push(compiled);
    const actual = executePlan(compiled.artifact.plan);
    assertExpected(actual, expectation);
    const ref = await project.write(`reference-${time.slice(-2)}.json`, compiled.artifact.plan);
    const oracle = await invokeCompiler('reference', await project.path(ref));
    assert.ok(oracle.trace, JSON.stringify(oracle));
    assertExpected({ metrics: oracle.metrics, stopReason: oracle.stop_reason, events: oracle.trace }, expectation);
    const kinds = new Set(actual.events.map(e => e.kind));
    assert.deepEqual(actual.events.map(tuple), oracle.trace.filter(e => kinds.has(e.kind)).map(tuple));
    assert.deepEqual(actual.terminalState.resources, oracle.terminal_state.resources);
  }
  assert.notEqual(identities[0].businessFingerprint, identities[1].businessFingerprint);
  assert.notEqual(identities[0].planFingerprint, identities[1].planFingerprint);
  assert.notEqual(identities[0].browserArtifactRef, identities[1].browserArtifactRef);
});

test('serial durations, cancellation and overlapping preparation consume the compiled Plan', async () => {
  const project = new IrProject(await mkdtemp('/tmp/riffoid-variants-'));
  for (const [time, duration] of [['00:30', 3], ['00:35', 0], ['00:45', 15], ['00:40', 30]]) {
    const draft = structuredClone(fixture);
    draft.payload.sections.mission_profile.collections.composite_tasks[0].definition.taskItems[1].firstWaveTime = time;
    draft.payload.sections.support_activities.collections.activities[0].definition.jobs[0].durationMinutes = duration;
    const { artifact } = await compile(project, draft), actual = executePlan(artifact.plan);
    const ref = await project.write('reference-plan.json', artifact.plan), oracle = await invokeCompiler('reference', await project.path(ref));
    assert.deepEqual(actual.metrics, Object.fromEntries(Object.keys(actual.metrics).map(k => [k, oracle.metrics[k]])), `${time}/${duration}`);
    const kinds = new Set(actual.events.map(e => e.kind));
    assert.deepEqual(actual.events.map(tuple), oracle.trace.filter(e => kinds.has(e.kind)).map(tuple), `${time}/${duration}`);
  }
});

test('capability gaps reject unsupported profiles, failures, transport and unknown phase ordering', async () => {
  const project = new IrProject(await mkdtemp('/tmp/riffoid-capability-'));
  const { artifact } = await compile(project, fixture);
  for (const change of [p => { p.semantic_profile = 'event-time-v2'; }, p => p.phases.reverse(),
    p => { p.components[0].failure_rate_per_hour = 1; }, p => p.supply_routes.push({}),
    p => { p.missions[0].required_aircraft = 2; }]) {
    const plan = structuredClone(artifact.plan); change(plan);
    assert.ok(planDiagnostics(plan).length);
    assert.throws(() => executePlan(plan), /./);
  }
});
