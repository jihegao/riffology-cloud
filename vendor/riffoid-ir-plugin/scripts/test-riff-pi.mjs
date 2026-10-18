import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { request } from '../src/broker.mjs';
import { invokeCompiler, VERSION } from '../src/compiler.mjs';
import { testPaths, preserveModel } from './test-workspace.mjs';

const { workspace, output } = await testPaths();
const connection = JSON.parse(await readFile(join(workspace, '.riffoid-ir/connection.json'), 'utf8'));
const riffOrigin = process.env.RIFF_BROWSER_BROKER_URL || 'http://127.0.0.1:8514';
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const fixture = JSON.parse(await readFile(new URL('../acceptance/b1/business-ir.json', import.meta.url)));
const expected = JSON.parse(await readFile(new URL('../acceptance/b1/expected.json', import.meta.url)));
const save = (name, value) => writeFile(join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
const api = async (path, body) => {
  const response = await fetch(riffOrigin + path, { ...body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace, ...body }) } : {} });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || `riff-pi HTTP ${response.status}`); return result;
};
const state = () => api(`/v1/state?workspace=${encodeURIComponent(workspace)}`);
const action = (action, params = {}) => api('/v1/action', { source: 'agent', action, ...params });
async function until(callback, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await callback(); if (value) return value;
    await new Promise(accept => setTimeout(accept, 300));
  }
  throw new Error(`Timed out: ${description}. Keep PI WEB's Browser panel open in this workspace.`);
}
const tool = (name, input) => request(connection, name, input);
async function snapshot() { return (await action('snapshot')).snapshot || ''; }
const fill = draft => action('fill', { selector: '#draft', text: typeof draft === 'string' ? draft : JSON.stringify(draft, null, 2) });
const click = selector => action('click', { selector });
async function waitNewRecord(before) {
  return until(async () => {
    const records = (await tool('records')).records;
    const added = records.find(r => !before.has(r.runId));
    if (added?.status === 'failed' || added?.status === 'interrupted') throw new Error(JSON.stringify(added.diagnostics));
    return added?.status === 'succeeded' ? added : false;
  }, 'browser execution and persisted result');
}
async function compileAndRun(draft) {
  await fill(draft); await click('#save'); await click('#check');
  await until(async () => (await snapshot()).includes('sealedRef'), 'seal and validate');
  await click('#compile'); await until(async () => (await snapshot()).split('\n').some(line => line.startsWith('- status "{') && line.includes('succeeded')), 'compile and inspect');
  const before = new Set((await tool('records')).records.map(r => r.runId));
  await click('#run'); return waitNewRecord(before);
}
const tuple = e => [e.time, e.phase, e.kind, e.entity];
function compare(record, expectation) {
  assert.deepEqual(Object.fromEntries(Object.keys(expectation.metrics).map(k => [k, record.metrics[k]])), expectation.metrics);
  assert.equal(record.stopReason, expectation.stop_reason);
  for (const events of [expectation.selected_events, expectation.same_minute_order]) {
    let after = -1;
    for (const event of events) { const index = record.events.findIndex((e, i) => i > after && JSON.stringify(tuple(e)) === JSON.stringify(tuple(event))); assert.ok(index > after, JSON.stringify(event)); after = index; }
  }
}
async function exportRun(label, record) {
  await save(`${label}-record.json`, record);
  for (const [key, filename] of [['modelRef', 'business.json'], ['bundleRef', 'model.simpack'], ['browserArtifactRef', 'browser-artifact.json'], ['runtimeRef', 'runtime.js']]) {
    await copyFile(join(workspace, record[key]), join(output, `${label}-${filename}`));
  }
  const artifact = JSON.parse(await readFile(join(workspace, record.browserArtifactRef), 'utf8'));
  await save(`${label}-plan.json`, artifact.plan);
  const reference = await invokeCompiler('reference', join(output, `${label}-plan.json`));
  assert.ok(reference.trace, JSON.stringify(reference)); await save(`${label}-independent-reference.json`, reference);
  compare({ metrics: reference.metrics, events: reference.trace, stopReason: reference.stop_reason }, label === 'variant' ? expected.second_mission_plus_5_minutes : expected.baseline);
}

async function acceptance() {
  console.log(`Acceptance workspace: ${workspace}\nRaw results: ${output}`);
  console.log('Connecting to riff-pi Direct Browser (the selected workspace Browser panel must be open)…');
  await api('/v1/surface', { mode: 'native' });
  await action('open', { url: `${connection.origin}/#token=${connection.token}` });
  await until(async () => (await state()).bridgeConnected, 'same-page Riff Bridge connection');
  assert.match(await snapshot(), /IR Model Studio/);
  await click('details summary'); // First disclosure is the Business JSON editor.
  await fill('{\n  "payload": '); await click('#save'); await click('#check');
  await until(async () => /load:/.test(await snapshot()), 'JSON syntax diagnostic');
  const syntax = await tool('project_ir_check', { draftRef: 'model/business-ir.draft.json' });
  assert.equal(syntax.status, 'failed'); assert.equal(syntax.diagnostics[0].code, 'invalid_json'); await save('syntax-diagnostic.json', syntax);
  console.log('Syntax diagnostic verified; repairing through the real page…');
  const baseline = await compileAndRun(fixture); compare(baseline, expected.baseline); await exportRun('baseline', baseline);
  const variantDraft = structuredClone(fixture);
  variantDraft.payload.sections.mission_profile.collections.composite_tasks[0].definition.taskItems[1].firstWaveTime = '00:45';
  const variant = await compileAndRun(variantDraft); compare(variant, expected.second_mission_plus_5_minutes); await exportRun('variant', variant);
  assert.notEqual(baseline.businessFingerprint, variant.businessFingerprint); assert.notEqual(baseline.planFingerprint, variant.planFingerprint);
  await save('business-edit.json', expected.second_mission_plus_5_minutes.edit);
  assert.equal((await tool('project_ir_result', { runId: baseline.runId })).planFingerprint, baseline.planFingerprint);
  console.log('Baseline and +5-minute edit match independent reference; reopening and replaying the baseline…');
  await action('reload'); await until(async () => (await state()).bridgeConnected, 'reopened browser connection');
  await until(async () => (await tool('show')).browserConnected, 'reopened executor');
  const replayed = await tool('project_ir_run', { sourceRunId: baseline.runId });
  assert.equal(replayed.accepted, true, JSON.stringify(replayed));
  const replay = await until(async () => { const r = await tool('project_ir_result', { runId: replayed.runId }); return r.status === 'succeeded' ? r : false; }, 'original-condition browser replay');
  compare(replay, expected.baseline); assert.equal(replay.sourceRunId, baseline.runId);
  assert.equal(replay.browserArtifactRef, baseline.browserArtifactRef); assert.equal(replay.runtimeRef, baseline.runtimeRef);
  assert.deepEqual(replay.metrics, baseline.metrics); assert.deepEqual(replay.events, baseline.events); await exportRun('replay', replay);
  await until(async () => (await snapshot()).includes(`${replay.runId} · succeeded`), 'saved replay visible in the page');
  console.log('Checking that a missing-repair capability gap offers domain development and never dispatches an unsupported run…');
  const extended = structuredClone(variantDraft), sections = extended.payload.sections;
  sections.equipment_tree.collections.components[0].definition.failure_distribution = { distributionType: 'exponential', parameters: 1 };
  const beforeGap = new Set((await tool('records')).records.map(r => r.runId));
  try {
    await fill(extended); await click('#save'); await click('#check');
    await until(async () => (await snapshot()).includes('sealedRef'), 'model with missing repair validates');
    await click('#compile');
    await until(async () => /browser-capability:/.test(await snapshot()), 'browser capability diagnostic');
    const gapSnapshot = await snapshot();
    assert.match(gapSnapshot, /继续开发领域包/);
    assert.match(gapSnapshot, /button "3 · 浏览器运行"[^\n]*\[disabled\]/);
    assert.deepEqual(new Set((await tool('records')).records.map(r => r.runId)), beforeGap);
    await save('domain-extension-diagnostic.json', { status: 'passed', snapshot: gapSnapshot,
      checks: ['failure without repair rejected', 'domain development offered', 'run button disabled', 'no extra run dispatched'] });
  } finally {
    // Restore the supported variant and its current pointers, including on assertion failure.
    await fill(variantDraft); await click('#save'); await click('#check');
    await until(async () => (await snapshot()).includes('sealedRef'), 'restored model validation');
    await click('#compile');
    await until(async () => (await snapshot()).split('\n').some(line => line.startsWith('- status "{') && line.includes('succeeded')), 'restored model compilation');
  }
  const observed = await state();
  await save('riff-pi-observation.json', { surfaceMode: observed.surfaceMode, bridgeConnected: observed.bridgeConnected,
    title: observed.title, url: observed.url?.replace(/#.*$/, ''), snapshot: (observed.snapshot || '').replace(/#token=[a-f0-9]+/g, '#token=[redacted]'),
    observedAt: observed.observedAt, console: observed.console, errors: observed.errors });
  const manifest = await fetch(new URL('/pi-web-plugins/manifest.json', process.env.RIFFOID_IR_PI_WEB_ORIGIN || 'http://127.0.0.1:8504')).then(r => r.json());
  assert.ok(manifest.plugins.some(p => p.id === 'riffoid-ir')); assert.ok(manifest.plugins.some(p => p.id === 'riff-browser'));
  await save('host-manifest.json', manifest);
  return { status: 'passed', testedAt: new Date().toISOString(), host: 'pi-web', pluginVersion: VERSION, workspace,
    browserRuntime: baseline.toolchain.browserRuntime, toolchain: baseline.toolchain, riffPiSurface: 'native iframe with connected same-page bridge',
    baselineRunId: baseline.runId, variantRunId: variant.runId, replayRunId: replay.runId,
    checks: ['real SDK seal/validate/compile/inspect', 'syntax error and repair', 'actual browser Worker execution', 'persist then read by runId',
      'fixed B1 metrics and same-minute order', 'single Business field edit changes Plan and events', 'independent Python reference for baseline and edit', 'reopen and original artifact/runtime/input replay',
      'failure without repair offers domain development without dispatching a run'] };
}
const original = await preserveModel(workspace, output);
let summary, restoration;
try { summary = await acceptance(); }
finally {
  restoration = await original.restore();
  // Clear the page's transient sealed/artifact selection after restoring files.
  await action('reload');
}
await save('summary.json', { ...summary, originalModel: restoration });
console.log(`riff-pi browser acceptance passed; original model restored. Raw results: ${output}\nCopy selected evidence with: npm run acceptance:export -- --from ${JSON.stringify(output)}`);
