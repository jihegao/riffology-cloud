import test from 'node:test';
import assert from 'node:assert/strict';
import { issueCapability, resourcePath, verifyCapability } from '../../spikes/m0-tenancy/auth.ts';

const secret = 'x'.repeat(32);
const scope = { run_id: 'm0-test-run', tenant: 'alpha' as const, kind: 'artifact' as const, object_id: 'fixture-alpha-artifact', service_path: resourcePath('m0-test-run', 'alpha', 'artifact', 'fixture-alpha-artifact') };

test('tenancy capability binds every resource claim and service path', async () => {
  const token = await issueCapability(secret, scope, 1_900_000_200);
  assert.equal(await verifyCapability(secret, token, scope, 1_900_000_000), true);
  assert.equal(await verifyCapability(secret, token, { ...scope, tenant: 'bravo', object_id: 'fixture-bravo-artifact', service_path: resourcePath(scope.run_id, 'bravo', 'artifact', 'fixture-bravo-artifact') }, 1_900_000_000), false);
  assert.equal(await verifyCapability(secret, token, { ...scope, service_path: `${scope.service_path}/other` }, 1_900_000_000), false);
  assert.equal(await verifyCapability(secret, `${token}.junk`, scope, 1_900_000_000), false);
  assert.equal(await verifyCapability('', token, scope, 1_900_000_000), false);
});

test('expired capability is rejected without caller supplied clock', async () => {
  const token = await issueCapability(secret, scope, 1_899_999_999);
  assert.equal(await verifyCapability(secret, token, scope, 1_900_000_000), false);
});
