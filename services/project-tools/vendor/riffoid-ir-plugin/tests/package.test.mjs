import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createRiffoidAdapter } from '../adapters/riffoid/index.mjs';

test('public PI WEB API v4 contribution renders the selected workspace and opens its qualified panel', async () => {
  const source = await readFile(new URL('../browser/pi-web-plugin.js', import.meta.url), 'utf8');
  const sandbox = { HTMLElement: class {}, customElements: { get: () => false, define() {} } };
  runInNewContext(source.replace('export default', 'globalThis.plugin ='), sandbox);
  const template = (strings, ...values) => ({ strings, values });
  const { contributions } = sandbox.plugin.activate({ runtimePluginId: 'riffoid-ir', html: template, svg: template });
  assert.equal(sandbox.plugin.apiVersion, 4);
  assert.equal(contributions.workspacePanels[0].visible({ machine: { kind: 'local' } }), true);
  const ctx = { workspace: { id: 'w' } };
  assert.equal(contributions.workspacePanels[0].render(ctx).values[0], ctx);
  let selected; contributions.actions[0].run({ selectWorkspaceTool: id => { selected = id; } });
  assert.equal(selected, 'riffoid-ir:workspace.ir');
});

test('Riffoid uses the same tools/runtime, host authorization and existing project.views manifest', async () => {
  const calls = [], adapter = await createRiffoidAdapter({ workspace: await mkdtemp('/tmp/riffoid-host-'), authorize: async args => { calls.push(args); } });
  assert.deepEqual(adapter.definitions.map(t => t.name), ['project_ir_check', 'project_ir_compile', 'project_ir_run', 'project_ir_result']);
  assert.equal(adapter.fixedSkills[0].name, 'riffoid-ir');
  await adapter.project.write('app/views.json', { schema: 'project.views/v1', files: ['app/existing.html'], views: [{ id: 'existing', title: 'Existing', entrypoint: 'app/existing.html' }] });
  await adapter.installView(); const views = await adapter.project.read('app/views.json');
  assert.equal(views.views.length, 2); assert.equal(views.files.includes('app/ir/app.js'), true);
  await adapter.project.seedExample();
  const checked = await adapter.executeTool({ name: 'project_ir_check', args: { draftRef: 'model/business-ir.draft.json' }, scope: 'test-scope' });
  assert.equal(checked.details.status, 'passed'); assert.equal(calls[0].scope, 'test-scope');
  const denied = await createRiffoidAdapter({ workspace: adapter.project.workspace, authorize: async () => { throw Error('scope denied'); } });
  await assert.rejects(denied.browserRequest({ operation: 'draft', scope: 'other' }), /scope denied/);
});
