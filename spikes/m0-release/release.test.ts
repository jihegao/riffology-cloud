import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { ReleaseController } from './controller.ts';
import { assertHandshake, CONTROLLER_RELEASE, RUNTIME_SHA256, type Fault } from './policy.ts';

async function usingController(operation: (controller: ReleaseController, directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm0-release-'));
  const controller = new ReleaseController(directory);
  await controller.initialize();
  try { await operation(controller, directory); }
  finally { await controller.close(); await rm(directory, { recursive: true, force: true }); }
}
function assertDead(pid: number | undefined) {
  assert.equal(typeof pid, 'number');
  assert.throws(() => process.kill(pid!, 0), error => (error as NodeJS.ErrnoException).code === 'ESRCH');
}

test('new controller admits old compatible runtime through actual subprocess handshake', async () => {
  await usingController(async controller => {
    assert.equal(CONTROLLER_RELEASE, 'controller-v2');
    const starting = controller.startTask('compatible-old', { release: 'runtime-v1' });
    await assert.rejects(controller.execute('compatible-old', 'before-handshake', 'increment'), /not-admitted/);
    const task = await starting;
    assert.notEqual(task.pid, process.pid);
    assert.equal(task.release, 'runtime-v1');
    assert.equal(task.launch_artifact_sha256, RUNTIME_SHA256);
    assert.equal(task.dispatched, 0);
    const result = await controller.execute(task.task_id, 'accepted-once', 'increment');
    assert.equal(result.counter, 1);
    assert.equal(result.release, 'runtime-v1');
    assert.deepEqual(await controller.execute(task.task_id, 'accepted-once', 'increment'), result);
    assert.equal(controller.view(task.task_id).dispatched, 1);
    assert.equal((await controller.effects(task.task_id)).length, 1);
    await assert.rejects(controller.execute(task.task_id, 'accepted-once', 'read-state'), /idempotency-conflict/);
    await controller.stopTask(task.task_id);
    assertDead(task.pid);
  });
});

test('unknown protocol, checkpoint format and mismatched release deny actual runtimes with zero command dispatch', async () => {
  await usingController(async controller => {
    const cases: Array<[Fault, RegExp]> = [['protocol', /protocol-denied/], ['format', /checkpoint-format-denied/], ['release', /release-mismatch/]];
    for (const [fault, reason] of cases) {
      const taskId = `rejected-${fault}`;
      await assert.rejects(controller.startTask(taskId, { release: 'runtime-v2', fault }), reason);
      const task = controller.view(taskId);
      assert.equal(task.status, 'rejected');
      assert.equal(task.dispatched, 0);
      assert.deepEqual(await controller.effects(taskId), []);
      await assert.rejects(controller.execute(taskId, 'must-not-execute', 'increment'), /not-admitted/);
      assertDead(task.pid);
    }
    // Every rejected process printed admitted=true on stdout; it had no effect.
  });
});

test('actual startup failure cannot leave a task running or dispatch a command', async () => {
  await usingController(async controller => {
    await assert.rejects(controller.startTask('startup-failure', { release: 'runtime-v2', fault: 'startup' }), /startup-exited/);
    const task = controller.view('startup-failure');
    assert.equal(task.status, 'startup_failed');
    assert.equal(task.dispatched, 0);
    assert.deepEqual(await controller.effects(task.task_id), []);
    assertDead(task.pid);
  });
});

test('stop cannot be undone by an in-flight startup, result, or checkpoint commit', async () => {
  await usingController(async controller => {
    const starting = controller.startTask('cancel-starting-task');
    const rejectedStart = assert.rejects(starting, /start-cancelled/);
    await controller.stopTask('cancel-starting-task');
    await rejectedStart;
    assert.equal(controller.view('cancel-starting-task').status, 'stopped');
    assert.equal(controller.view('cancel-starting-task').pid, undefined);
    await assert.rejects(controller.execute('cancel-starting-task', 'cancelled-request', 'increment'), /not-admitted/);

    await controller.startTask('cancel-checkpoint-task');
    await controller.execute('cancel-checkpoint-task', 'first-saved-write', 'increment');
    const original = await controller.checkpoint('cancel-checkpoint-task');
    await controller.execute('cancel-checkpoint-task', 'unconfirmed-write', 'increment');
    const checkpointing = controller.checkpoint('cancel-checkpoint-task');
    const rejectedCheckpoint = assert.rejects(checkpointing, /checkpoint-cancelled/);
    await controller.stopTask('cancel-checkpoint-task');
    await rejectedCheckpoint;
    assert.equal(controller.view('cancel-checkpoint-task').status, 'stopped');
    assert.deepEqual(await controller.confirmedCheckpoint(), original.receipt);
    assertDead(controller.view('cancel-checkpoint-task').pid);

    await controller.startTask('cancel-running-task');
    const executing = controller.execute('cancel-running-task', 'stop-racing-request', 'read-state');
    const outcomes = Promise.allSettled([executing, controller.stopTask('cancel-running-task')]);
    await outcomes;
    assert.ok(['stopped', 'unknown'].includes(controller.view('cancel-running-task').status));
    assertDead(controller.view('cancel-running-task').pid);
  });
});

test('existing tasks stay pinned to the old release while new tasks use an admitted new release', async () => {
  await usingController(async controller => {
    await controller.startTask('existing-task');
    assert.deepEqual(await controller.activate('runtime-v2'), { active: 'runtime-v2', outcome: 'activated' });
    await controller.startTask('new-release-task');
    const existing = await controller.execute('existing-task', 'existing-request', 'increment');
    const fresh = await controller.execute('new-release-task', 'new-task-request', 'increment');
    assert.equal(existing.release, 'runtime-v1');
    assert.equal(fresh.release, 'runtime-v2');
    assert.equal(controller.view('existing-task').release, 'runtime-v1');
    assert.equal(controller.view('new-release-task').release, 'runtime-v2');
  });
});

test('failed candidate rolls back the local active pointer and restores the prior confirmed checkpoint with its exact digest', async () => {
  await usingController(async controller => {
    await controller.startTask('checkpoint-owner');
    await controller.execute('checkpoint-owner', 'checkpoint-write', 'increment');
    const confirmed = await controller.checkpoint('checkpoint-owner');
    const before = await readFile(path.join(controller.view('checkpoint-owner').workspace, 'state.json'));
    assert.equal(createHash('sha256').update(before).digest('hex'), confirmed.state_sha256);
    assert.deepEqual(await controller.activate('runtime-v2', 'startup'), { active: 'runtime-v1', outcome: 'rollback' });
    assert.deepEqual(await controller.confirmedCheckpoint(), confirmed.receipt);
    assert.equal(controller.transitions.at(-1)?.outcome, 'rollback');
    await controller.startTask('rollback-reader', { restore: true });
    const restored = await controller.execute('rollback-reader', 'rollback-read-state', 'read-state');
    assert.equal(restored.release, 'runtime-v1');
    assert.equal(restored.counter, 1);
    const after = await readFile(path.join(controller.view('rollback-reader').workspace, 'state.json'));
    assert.equal(createHash('sha256').update(after).digest('hex'), confirmed.state_sha256);
    assert.deepEqual(after, before);
    assert.deepEqual(await controller.confirmedCheckpoint(), confirmed.receipt);
  });
});

test('effect followed by process crash is unknown, never replayed or checkpointed, including task reuse after controller restart', async () => {
  await usingController(async (controller, directory) => {
    await controller.startTask('confirmed-task');
    await controller.execute('confirmed-task', 'confirmed-write', 'increment');
    const confirmed = await controller.checkpoint('confirmed-task');
    await controller.startTask('unknown-effect-task', { release: 'runtime-v2', fault: 'after-effect', restore: true });
    await assert.rejects(controller.execute('unknown-effect-task', 'unknown-request', 'increment'), /effect-outcome-unknown/);
    const unknown = controller.view('unknown-effect-task');
    assert.equal(unknown.status, 'unknown');
    assert.equal(unknown.dispatched, 1);
    assert.deepEqual(await controller.effects(unknown.task_id), [{ request_id: 'unknown-request', counter: 2 }]);
    await assert.rejects(controller.execute(unknown.task_id, 'unknown-request', 'increment'), /must-not-replay/);
    await assert.rejects(controller.execute(unknown.task_id, 'different-request', 'increment'), /not-ready/);
    await assert.rejects(controller.checkpoint(unknown.task_id), /checkpoint-not-ready/);
    assert.equal(controller.view(unknown.task_id).dispatched, 1);
    assert.equal((await controller.effects(unknown.task_id)).length, 1);
    assert.deepEqual(await controller.confirmedCheckpoint(), confirmed.receipt);
    assertDead(unknown.pid);
    await controller.close();
    const restarted = new ReleaseController(directory);
    await restarted.initialize();
    try {
      await assert.rejects(restarted.startTask(unknown.task_id), /EEXIST/);
      assert.equal(restarted.view(unknown.task_id).pid, undefined);
      assert.equal(restarted.view(unknown.task_id).dispatched, 0);
      await restarted.startTask('fresh-recovery-task', { restore: true });
      assert.equal((await restarted.execute('fresh-recovery-task', 'fresh-read-state', 'read-state')).counter, 1);
      assert.deepEqual(await restarted.confirmedCheckpoint(), confirmed.receipt);
    } finally { await restarted.close(); }
  });
});

test('corrupt checkpoint and unknown artifact digest fail closed before launching or dispatching', async () => {
  await usingController(async (controller, directory) => {
    await controller.startTask('corruption-owner');
    await controller.execute('corruption-owner', 'prepare-checkpoint', 'increment');
    const confirmed = await controller.checkpoint('corruption-owner');
    await writeFile(path.join(directory, 'controller-checkpoints', 'blobs', confirmed.state_sha256), 'tampered bytes');
    await assert.rejects(controller.startTask('corrupt-reader', { restore: true }), /missing or corrupt/);
    const rejected = controller.view('corrupt-reader');
    assert.equal(rejected.pid, undefined);
    assert.equal(rejected.dispatched, 0);
    assert.notEqual(rejected.status, 'running');
    assert.throws(() => assertHandshake({ release: 'runtime-v1', artifact_sha256: '0'.repeat(64) }, { kind: 'hello', release: 'runtime-v1', protocol: 'm0-v1', checkpoint_format: 1 }), /artifact-not-approved/);
  });
});
