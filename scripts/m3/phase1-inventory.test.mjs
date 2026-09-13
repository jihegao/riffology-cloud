import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePhase1Inventory } from './phase1-inventory.mjs';

const sha = 'a'.repeat(64);
const base = { vars: { TENANT_QUOTA_POLICY_VERSION: 'm1-v1' }, durable_objects: { bindings: [] }, containers: [
  { name: 'project', class_name: 'ProjectRuntime', image: `registry.example/project@sha256:${'1'.repeat(64)}`, instance_type: 'basic', max_instances: 1 },
  { name: 'tools', class_name: 'ProjectToolSandbox', image: `registry.example/tools@sha256:${'2'.repeat(64)}`, instance_type: 'basic', max_instances: 1 },
  { name: 'pi', class_name: 'TrustedPiSandbox', image: `registry.example/pi@sha256:${'3'.repeat(64)}`, instance_type: 'basic', max_instances: 1 },
  { name: 'service', class_name: 'ServiceSandbox', image: `registry.example/service@sha256:${'4'.repeat(64)}`, instance_type: 'basic', max_instances: 1 },
], exports: {}, r2_buckets: [{ binding: 'WORKSPACE_CHECKPOINTS', bucket_name: 'checkpoints' }, { binding: 'MODEL_CONTENT', bucket_name: 'models' }] };
const make = () => {
  const config = structuredClone(base);
  config.vars = { ...config.vars, M2_TURNS_ENABLED: 'false', M3_SERVICE_ENABLED: 'false', M3_PREVIEW_ENABLED: 'false', M4_SIMULATION_ENABLED: 'false', M4_SIMULATION_IMAGE: `registry.example/sim@sha256:${'5'.repeat(64)}`, TENANT_QUOTA_POLICY_VERSION: 'phase1-preview-simulation-v1', TENANT_QUOTA_CAPACITY: '2' };
  config.containers = [...config.containers, { name: 'riffology-phase1-simulation', class_name: 'SimulationSandbox', image: config.vars.M4_SIMULATION_IMAGE, instance_type: 'basic', max_instances: 1 }];
  config.durable_objects.bindings = [{ name: 'SIMULATION_SANDBOX', class_name: 'SimulationSandbox' }];
  const containers = config.containers.map(row => ({ name: row.name, class_name: row.class_name, image: row.image }));
  const bindings = [...Object.entries(config.vars).map(([name, text]) => ({ name, type: 'plain_text', text })), ...config.durable_objects.bindings.map(row => ({ name: row.name, type: 'durable_object_namespace', class_name: row.class_name })), ...config.r2_buckets.map(row => ({ name: row.binding, type: 'r2_bucket', bucket_name: row.bucket_name }))];
  const apps = containers.map((row, i) => ({ id: `app-${i}`, name: row.name, max_instances:1, configuration:{image:row.image,vcpu:0.25,memory_mib:1024,disk:{size_mb:4000}} }));
  return { config, version: { id: 'v1', annotations: { 'workers/tag': `source-${'b'.repeat(40)}` }, resources: { bindings, script_runtime: { containers, exports: { SimulationSandbox: { type: 'durable-object', storage: 'sqlite', container: 'riffology-phase1-simulation' } } } } }, apps, instances: { apps: apps.map((app, i) => ({ appId: app.id, pages: [{ instances: [{ state: i === 0 ? 'active' : 'inactive' }], result_info: { page_token: null, next_page_token: null } }] })) } };
};

test('validates five containers and preserves noninactive instance count', () => {
  const input = make();
  const value = validatePhase1Inventory({ ...input, deployment: { versions: [{ version_id: 'v1', percentage: 100 }] }, workerSha: 'b'.repeat(40), gatesOpen: false });
  assert.equal(value.status, 'passed', JSON.stringify(value));
  assert.equal(value.instances.nonInactive, 1);
});

test('rejects duplicate app, open gate drift and incomplete pagination', () => {
  const input = make();
  const badApps = [...input.apps, { id: 'duplicate', name: input.apps[0].name, image: input.apps[0].image }];
  const value = validatePhase1Inventory({ ...input, apps: badApps, instances: { apps: input.instances.apps.slice(0, 4) }, deployment: { versions: [{ version_id: 'v1', percentage: 100 }] }, workerSha: 'b'.repeat(40), gatesOpen: true });
  assert.equal(value.status, 'blocked');
  assert.ok(value.checks.some(row => row.name === 'gates' && row.status === 'blocked'));
  assert.ok(value.checks.some(row => row.name === 'instances' && row.status === 'blocked'));
});

test('requireInactive blocks a live instance while normal inventory accepts it', () => {
  const input = make();
  assert.equal(validatePhase1Inventory({ ...input, deployment: { versions: [{ version_id: 'v1', percentage: 100 }] }, workerSha: 'b'.repeat(40), gatesOpen: false }).status, 'passed');
  const value = validatePhase1Inventory({ ...input, deployment: { versions: [{ version_id: 'v1', percentage: 100 }] }, workerSha: 'b'.repeat(40), gatesOpen: false, requireInactive: true });
  assert.equal(value.status, 'blocked');
  assert.ok(value.checks.some(row => row.name === 'instances' && row.status === 'blocked'));
});

 test('rejects repeated first pages after pagination already terminated',()=>{
 const input=make();const group=input.instances.apps[0];group.pages=[{instances:[],result_info:{page_token:null,next_page_token:null}},{instances:[],result_info:{page_token:null,next_page_token:null}}];
 const result=validatePhase1Inventory({...input,deployment:{versions:[{version_id:'v1',percentage:100}]},workerSha:'b'.repeat(40),gatesOpen:false});assert.equal(result.status,'blocked');
 });

test('rejects live app resource expansion despite unchanged local config',()=>{const input=make();input.apps[0].max_instances=2;const result=validatePhase1Inventory({...input,deployment:{versions:[{version_id:'v1',percentage:100}]},workerSha:'b'.repeat(40),gatesOpen:false});assert.equal(result.status,'blocked');assert.equal(result.checks.find(x=>x.name==='container-apps').status,'blocked');});
