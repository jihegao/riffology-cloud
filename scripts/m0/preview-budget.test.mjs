import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewBudget, MutationAttempts } from './preview-budget.mjs';

const limits = milliseconds => ({ milliseconds, requests: 3, responseBytes: 64 });

test('total deadline terminates an unresolved browser-style wait and cleanup has an independent budget', async () => {
  const business = new PreviewBudget(limits(20));
  const owned = new Set(['fixed-run/alpha']);
  const calls = [];
  try {
    await assert.rejects(business.run(() => new Promise(() => {})), { code: 'total-wall-clock-budget-exhausted' });
    await assert.rejects(business.run(() => { calls.push('late-business-dispatch'); }), { code: 'total-wall-clock-budget-exhausted' });
  } finally {
    business.finish();
    const cleanup = new PreviewBudget(limits(1000));
    try {
      await cleanup.run(async () => {
        for (const scope of owned) { cleanup.takeRequest(); calls.push(`cleanup:${scope}`); owned.delete(scope); }
      });
      assert.equal(cleanup.snapshot().requests, 1);
    } finally { cleanup.finish(); }
  }
  assert.deepEqual(calls, ['cleanup:fixed-run/alpha']);
  assert.equal(owned.size, 0);
});

test('timed-out mutation stays unknown after late acknowledgment and cannot be replayed in another budget', async () => {
  const business = new PreviewBudget(limits(20));
  const attempts = new MutationAttempts();
  let acknowledge;
  let dispatched = 0;
  const pending = new Promise(resolve => { acknowledge = resolve; });
  await assert.rejects(attempts.once('start:fixed-run/alpha', business, () => { dispatched++; return pending; }), { code: 'total-wall-clock-budget-exhausted' });
  business.finish();
  acknowledge({ created: true });
  await new Promise(resolve => setImmediate(resolve));
  const cleanup = new PreviewBudget(limits(1000));
  try {
    await assert.rejects(attempts.once('start:fixed-run/alpha', cleanup, () => { dispatched++; }), { code: 'unknown-mutation-must-not-replay' });
    let destroyed = 0;
    await cleanup.run(() => { cleanup.takeRequest(); destroyed++; });
    assert.equal(destroyed, 1);
    assert.equal(dispatched, 1);
    assert.deepEqual(attempts.snapshot(), { attempts: 1, unknown_acknowledgments: 1, automatic_replays: 0 });
  } finally { cleanup.finish(); }
});

test('request/UTF-8 response byte limits abort their phase without consuming cleanup reserve', async () => {
  const requests = new PreviewBudget({ ...limits(1000), requests: 1 });
  requests.takeRequest();
  assert.throws(() => requests.takeRequest(), { code: 'request-count-budget-exhausted' });
  assert.equal(requests.snapshot().requests, 1);
  requests.finish();
  const response = new PreviewBudget({ ...limits(1000), responseBytes: 5 });
  response.addResponseBytes(Buffer.byteLength('中'));
  assert.throws(() => response.addResponseBytes(Buffer.byteLength('文')), { code: 'response-byte-budget-exhausted' });
  assert.equal(response.snapshot().response_bytes, 6);
  response.finish();
  const cleanup = new PreviewBudget(limits(1000));
  try {
    cleanup.takeRequest(); cleanup.addResponseBytes(4);
    assert.equal(await cleanup.run(() => 'cleanup-acknowledged'), 'cleanup-acknowledged');
  } finally { cleanup.finish(); }
});
