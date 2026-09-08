import test from 'node:test';
import assert from 'node:assert/strict';
import { responseWithin, SerialLifecycle } from '../../spikes/m0-tenancy/core.ts';

test('late storage write keeps the queue, so cleanup waits and removes it', async () => {
  const lifecycle = new SerialLifecycle();
  let objectExists = false;
  let putSettled = false;
  let cleanupStarted = false;
  const delayedPut = new Promise<void>(resolve => setTimeout(() => {
    objectExists = true;
    putSettled = true;
    resolve();
  }, 30));
  const write = lifecycle.enqueue(async () => {
    await delayedPut;
    return 'write-complete';
  });
  assert.equal((await responseWithin(write, 2)).timedOut, true);
  lifecycle.close();
  const cleanup = lifecycle.enqueue(async () => {
    cleanupStarted = true;
    assert.equal(putSettled, true);
    objectExists = false;
    return 'cleanup-complete';
  }, { allowClosed: true });
  const result = await responseWithin(cleanup, 1000);
  assert.equal(result.timedOut, false);
  assert.equal(cleanupStarted, true);
  assert.equal(objectExists, false);
});

test('closed lifecycle rejects new resource work but permits cleanup retry', async () => {
  const lifecycle = new SerialLifecycle();
  lifecycle.markBootstrapped();
  lifecycle.close();
  await assert.rejects(lifecycle.enqueue(async () => 'resource'), /run-closed/);
  assert.equal(await lifecycle.enqueue(async () => 'cleanup-retry', { allowClosed: true }), 'cleanup-retry');
});
