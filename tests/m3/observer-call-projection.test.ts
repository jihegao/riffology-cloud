import test from 'node:test';
import assert from 'node:assert/strict';
import {SqlObserverCalls, type ObserverCallCommit} from '../../services/preview/observer-calls.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
import {fixture, scope} from './run-fixture.ts';

const digest = 'a'.repeat(64);
const failed = {status: 'failed' as const, result: null, errorCode: 'test-failure'};

function command(commandId = 'call-a'): ObserverCommand {
  return {
    schemaVersion: 1,
    purpose: 'observer',
    scope,
    sessionId: 'session-a',
    turnId: 'turn-a',
    dispatchId: 'dispatch-a',
    commandId,
    previewId: 'preview-a',
    operation: 'snapshot',
    deadlineAt: 15000,
  };
}

test('commit observes one consistent active projection for accept, start, and finish', async t => {
  const f = fixture(t);
  let calls: SqlObserverCalls;
  const observations: Array<{before: string | null; after: string | null}> = [];
  const commit: ObserverCallCommit = async operation => f.storage.transactionSync(() => {
    const before = calls.activeSync();
    const value = operation();
    const after = calls.activeSync();
    observations.push({
      before: before?.status ?? null,
      after: after?.status ?? null,
    });
    return value;
  });
  calls = new SqlObserverCalls(f.storage, scope, () => f.now, commit);
  const c = command();

  await calls.accept(c, digest);
  await calls.start(c);
  await calls.finish(c, failed);

  assert.deepEqual(observations, [
    {before: null, after: 'accepted'},
    {before: 'accepted', after: 'running'},
    {before: 'running', after: null},
  ]);
  assert.equal(await calls.active(), null);
});

test('a commit failure rolls back an accepted call without leaving active state', async t => {
  const f = fixture(t);
  let calls: SqlObserverCalls;
  const commit: ObserverCallCommit = async operation => f.storage.transactionSync(() => {
    operation();
    throw Error('commit-failure');
  });
  calls = new SqlObserverCalls(f.storage, scope, () => f.now, commit);
  const c = command();

  await assert.rejects(calls.accept(c, digest), /commit-failure/);
  assert.equal(await calls.snapshot(c), null);
  assert.equal(calls.activeSync(), null);
});

test('multiple persisted active calls are rejected by both active projections', async t => {
  const f = fixture(t);
  const calls = new SqlObserverCalls(f.storage, scope, () => f.now);
  const first = command('call-a');
  const second = command('call-b');
  await calls.accept(first, digest);
  const secondRecord = {
    command: second,
    targetDigest: digest,
    status: 'accepted',
    acceptedAt: 1000,
    startedAt: null,
    finishedAt: null,
    result: null,
    errorCode: null,
  };
  f.db.prepare('INSERT INTO observer_calls VALUES(?,?)').run(
    JSON.stringify([second.turnId, second.dispatchId, second.commandId]),
    JSON.stringify(secondRecord),
  );

  assert.throws(() => calls.activeSync(), /persisted-invalid/);
  await assert.rejects(calls.active(), /persisted-invalid/);
});
