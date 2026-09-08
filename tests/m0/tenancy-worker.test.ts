import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTenancyRequest, parseResourcePath, type TenancyOperations } from '../../spikes/m0-tenancy/worker.ts';
import { issueCapability } from '../../spikes/m0-tenancy/auth.ts';

test('resource route requires canonical object identity', () => {
  const valid = parseResourcePath('/resource/m0-test-run/alpha/artifact/fixture-alpha-artifact');
  assert.equal(valid?.tenant, 'alpha');
  assert.equal(parseResourcePath('/resource/m0-test-run/alpha/artifact/fixture-bravo-artifact'), null);
  assert.equal(parseResourcePath('/resource/m0-test-run/alpha/artifact/fixture-alpha-artifact?swap=1'), null);
});

const env = { ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1', M0_PROBE_TOKEN: 'm0-owned-test-operator-'.repeat(3) };
const path = '/resource/m0-test-run/alpha/artifact/fixture-alpha-artifact';
const scope = { run_id: 'm0-test-run', tenant: 'alpha' as const, kind: 'artifact' as const, object_id: 'fixture-alpha-artifact', service_path: path };
test('handler allocates operations only after capability checks and distinguishes closed runs from backend failures', async () => {
  let allocations = 0;
  const operations = (): TenancyOperations => { allocations++; return { bootstrap: async () => ({}), cleanup: async () => ({}), resource: async () => { throw new Error('run-closed'); } }; };
  const cap = await issueCapability(env.M0_PROBE_TOKEN, scope, Math.floor(Date.now() / 1000) + 300);
  const expired = await issueCapability(env.M0_PROBE_TOKEN, scope, Math.floor(Date.now() / 1000) - 1);
  for (const capability of ['', expired, `${cap}.extra`]) {
    const response = await handleTenancyRequest(new Request('https://test.invalid' + path, { headers: { 'x-m0-capability': capability } }), env, operations);
    assert.equal(response.status, 403);
  }
  assert.equal(allocations, 0);
  const closed = await handleTenancyRequest(new Request('https://test.invalid' + path, { headers: { 'x-m0-capability': cap } }), env, operations);
  assert.equal(closed.status, 403);
  assert.deepEqual(await closed.json(), { error: 'run-closed' });
  assert.equal(allocations, 1);
});

test('operator body deadline rejects a stalled stream without waiting for its cancel hook', { timeout: 4000 }, async () => {
  let allocations = 0;
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const request = new Request('https://test.invalid/bootstrap/m0-test-run', { method: 'POST', headers: { authorization: `Bearer ${env.M0_PROBE_TOKEN}`, 'content-length': '2' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' });
  const began = Date.now();
  const response = await handleTenancyRequest(request, env, () => { allocations++; throw new Error('must-not-allocate'); });
  assert.equal(response.status, 400);
  assert.ok(Date.now() - began >= 1800 && Date.now() - began < 3000);
  assert.equal(body.locked, false);
  assert.equal(allocations, 0);
});
