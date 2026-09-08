import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error The standalone JavaScript CLI is exercised directly at runtime.
import { deadlineBudget, safeDeadlineBody } from '../../scripts/m0/boundary-local.mjs';

test('an unexpectedly successful deadline probe cannot persist its issued capability', () => {
  const body = safeDeadlineBody({ fixture_only: true, capability: 'synthetic-private-token', error: 'reflected-private-token', nested: { credential: 'synthetic-private-token' } });
  assert.deepEqual(body, { fixtureOnly: true, capabilityIssued: true });
  assert.ok(!JSON.stringify(body).includes('private-token'));
  assert.deepEqual(safeDeadlineBody({ error: 'invalid_body' }), { error: 'invalid_body', fixtureOnly: false, capabilityIssued: false });
});

test('business deadline rejects while cleanup transport remains bounded and callable', () => {
  const businessDeadline = 1_000;
  const cleanupDeadline = 61_000;
  const calls: Array<{ path: string; timeoutMs: number }> = [];
  const now = 1_001;
  assert.equal(deadlineBudget('business', now, businessDeadline, cleanupDeadline), null);
  const cleanup = deadlineBudget('cleanup', now, businessDeadline, cleanupDeadline, 15_000);
  assert.deepEqual(cleanup, { remainingMs: 59_999, timeoutMs: 15_000 });
  if (cleanup) calls.push({ path: '/probes/cleanup', timeoutMs: cleanup.timeoutMs });
  assert.deepEqual(calls, [{ path: '/probes/cleanup', timeoutMs: 15_000 }]);
});
