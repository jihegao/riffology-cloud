import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, access } from 'node:fs/promises';
import { IrProject } from '../src/project.mjs';
import { domainPack } from '../src/domain-pack.mjs';
import { invokeCompiler } from '../src/compiler.mjs';
import { executePlan } from '../browser/runtime.js';
import { startBroker, request } from '../src/broker.mjs';
import { liveProject } from '../src/live-connection.mjs';

const tuple = e => [e.time, e.phase, e.kind, e.entity];

function repairActivity(id = 'f35') {
  return { business_id: 'f35-repair', source_path: 'support_activities.activities[3]', definition: {
    aircraft_model: 'F35', id: 'f35-repair', equipment_id: id, jobs: [{ activityCode: 'REP-1', durationMinutes: 4,
      equipment: [{ model: 'cart', quantity: 1 }], personnel: [{ professional: 'crew', quantity: 1 }], predecessors: [], spare: [] }],
    name: 'Repair', operations_phase: 'repair', plan_group_id: 'f35-daily', priority: 1, resource_id: 'flight-line' } };
}

test('multi-day and flight-exposure repair match the independent reference; missing repair stays diagnosed', async () => {
  const project = new IrProject(await mkdtemp('/tmp/riffoid-development-'));
  const state = await project.show();
  assert.deepEqual(state.capabilities, domainPack);
  assert.equal(state.development.kind, 'domain-pack-development');
  await Promise.all([state.development.guide, ...Object.values(state.development.paths), state.compiler.sdkModule].map(path => access(path)));
  await project.seedExample();
  const original = await project.read('model/business-ir.draft.json');
  const unsupported = structuredClone(original);
  unsupported.payload.sections.equipment_tree.collections.components[0].definition.failure_distribution = {
    distributionType: 'exponential', parameters: 1 };
  await project.write('model/business-ir.draft.json', unsupported);
  const unsupportedChecked = await project.check({ draftRef: 'model/business-ir.draft.json' });
  const unsupportedCompiled = await project.compile({ sealedRef: unsupportedChecked.sealedRef });
  assert.equal(unsupportedCompiled.status, 'failed');
  assert.equal(unsupportedCompiled.capabilityGap.layer, 'browser-runtime');
  assert.ok(unsupportedCompiled.diagnostics.some(d => d.path === 'plan.components[0]'));
  for (const feature of ['multi-day', 'failure']) {
    const draft = structuredClone(original), sections = draft.payload.sections;
    if (feature === 'multi-day') {
      sections.time.properties.duration_minutes = 4320;
      sections.mission_profile.properties.duration_minutes = 4320;
      sections.stop_policy.properties.conditions[0].duration_minutes = 4320;
      sections.mission_profile.collections.mission_calendar = [1, 2, 3].map(day => ({
        business_id: `calendar-day-${day}`, source_path: `mission_profile.mission_calendar[${day - 1}]`,
        definition: { composite_task_id: 'daily-sorties', day_index: day },
      }));
    } else {
      sections.equipment_tree.collections.components[0].definition.failure_distribution = { distributionType: 'exponential', parameters: 30 };
      sections.equipment_tree.collections.components[0].definition.special_repair_profile = { repairTimeMinutes: 8 };
      sections.support_activities.collections.activities.push(repairActivity());
    }
    await project.write('model/business-ir.draft.json', draft);
    const checked = await project.check({ draftRef: 'model/business-ir.draft.json' });
    assert.equal(checked.status, 'passed', JSON.stringify(checked));
    const compiled = await project.compile({ sealedRef: checked.sealedRef });
    assert.equal(compiled.status, 'succeeded', JSON.stringify(compiled));
    const artifact = await project.read(compiled.browserArtifactRef), actual = executePlan(artifact.plan);
    const oracle = await invokeCompiler('reference', await project.path(await project.write(`${feature}-plan.json`, artifact.plan)));
    assert.deepEqual(Object.fromEntries(Object.keys(actual.metrics).map(k => [k, actual.metrics[k]])),
      Object.fromEntries(Object.keys(actual.metrics).map(k => [k, oracle.metrics[k]])), feature);
    const kinds = new Set(actual.events.map(e => e.kind));
    assert.deepEqual(actual.events.map(tuple), oracle.trace.filter(e => kinds.has(e.kind)).map(tuple), feature);
    if (feature === 'failure') assert.ok(actual.metrics.lru_failures > 0);
    if (feature === 'multi-day') assert.ok(artifact.plan.missions.some(m => m.planned_start >= 1440));
  }
});

test('a loaded extension adopts its replacement workspace broker before dispatch without duplicate operations', async () => {
  const workspace = await mkdtemp('/tmp/riffoid-reload-');
  const calls = [0, 0], brokers = [];
  const create = async index => {
    const project = new IrProject(workspace);
    project.operation = async () => ({ server: index, dispatches: ++calls[index] });
    const broker = await startBroker(workspace, { project }); brokers.push(broker); return broker;
  };
  try {
    const first = await create(0);
    const bridge = liveProject(workspace, { connection: first.connection, call: (op, input, signal) => request(first.connection, op, input, signal) });
    assert.deepEqual(await bridge.call('test-mutation'), { server: 0, dispatches: 1 });
    await create(1);
    assert.deepEqual(await bridge.call('test-mutation'), { server: 1, dispatches: 1 });
    assert.deepEqual(calls, [1, 1]);
    const other = await startBroker(await mkdtemp('/tmp/riffoid-other-')); brokers.push(other);
    await first.project.write('.riffoid-ir/connection.json', other.connection);
    await assert.rejects(bridge.call('test-mutation'), /does not serve this workspace/);
    assert.deepEqual(calls, [1, 1]);
  } finally { await Promise.all(brokers.map(broker => broker.close())); }
});
