import assert from 'node:assert/strict';
import test from 'node:test';
import { TurnJournal } from '../../services/turn/journal.ts';
import { MemoryTurnStore, type AtomicTurnStore } from '../../services/turn/store.ts';
import type { ObserverCommand } from '../../services/preview/observer-protocol.ts';

const scope = {tenantId:'tenant-a', projectId:'project-a', workspaceId:'workspace-a', workspaceGeneration:1};
const actor = {userId:'user-a', authVersion:1};

function command(overrides: Partial<ObserverCommand> = {}): ObserverCommand {
  return {
    schemaVersion:1,
    purpose:'observer',
    scope,
    sessionId:'session-id',
    turnId:'turn-id',
    dispatchId:'dispatch-id',
    commandId:'command-id',
    previewId:'preview-id',
    operation:'snapshot',
    deadlineAt:2000,
    ...overrides,
  };
}

function scopedStore(base: MemoryTurnStore, mutate: (state: NonNullable<ReturnType<MemoryTurnStore['read']>>) => void): AtomicTurnStore {
  return {
    read() {
      const state = base.read();
      if (state) mutate(state);
      return state;
    },
    transact: base.transact.bind(base),
  };
}

async function runningFixture() {
  const store = new MemoryTurnStore();
  const journal = new TurnJournal(store, () => 1000);
  const session = (await journal.createSession(scope, actor, 'session-key', {title:'Session'})).session;
  const queued = (await journal.submit(scope, actor, session.id, 'turn-key', {message:'Run'})).turn;
  const running = (await journal.claim(scope, 1))!.turn;
  return {store, journal, session, queued, running, current: command({sessionId:session.id, turnId:running.id, dispatchId:running.dispatchId!})};
}

test('observerCaller accepts only the current running turn and returns detached identity and actor', async () => {
  const f = await runningFixture();
  const result = f.journal.observerCaller(f.current);
  assert.deepEqual(result, {actor, identity:{scope, sessionId:f.session.id, turnId:f.running.id, dispatchId:f.running.dispatchId, generation:1}});

  result.actor.userId = 'mutated';
  result.identity.scope.projectId = 'mutated';
  const again = f.journal.observerCaller(f.current);
  assert.deepEqual(again, {actor, identity:{scope, sessionId:f.session.id, turnId:f.running.id, dispatchId:f.running.dispatchId, generation:1}});
});

test('observerCaller denies queued, noncurrent, wrong-scope, session, dispatch, and generation targets', async () => {
  const f = await runningFixture();
  const secondSession = (await f.journal.createSession(scope, actor, 'second-session', {title:'Second'})).session;
  const second = (await f.journal.submit(scope, actor, secondSession.id, 'second-turn', {message:'Second'})).turn;

  assert.throws(() => f.journal.observerCaller(command({sessionId:f.session.id, turnId:f.queued.id})), /observer-turn-denied/);
  assert.throws(() => f.journal.observerCaller(command({sessionId:secondSession.id, turnId:second.id})), /observer-turn-denied/);
  assert.throws(() => f.journal.observerCaller({...f.current, scope:{...scope, workspaceId:'other-workspace'}}), /turn-workspace-scope-conflict/);
  assert.throws(() => f.journal.observerCaller({...f.current, sessionId:secondSession.id}), /observer-turn-denied/);
  assert.throws(() => f.journal.observerCaller({...f.current, dispatchId:'other-dispatch'}), /observer-turn-denied/);
  assert.throws(() => f.journal.observerCaller({...f.current, scope:{...scope, workspaceGeneration:2}}), /turn-workspace-scope-conflict/);
});

test('observerCaller denies immediately after cancellation, checkpointing, and terminal transitions', async () => {
  const cancelled = await runningFixture();
  await cancelled.journal.cancel(scope, actor, cancelled.running.id);
  assert.throws(() => cancelled.journal.observerCaller(cancelled.current), /observer-turn-denied/);

  const checkpointing = await runningFixture();
  await checkpointing.journal.beginCheckpoint(scope, {turnId:checkpointing.running.id, dispatchId:checkpointing.running.dispatchId!, runtimeGeneration:1, outcome:'completed'});
  assert.throws(() => checkpointing.journal.observerCaller(checkpointing.current), /observer-turn-denied/);

  const terminal = await runningFixture();
  const pending = await terminal.journal.beginCheckpoint(scope, {turnId:terminal.running.id, dispatchId:terminal.running.dispatchId!, runtimeGeneration:1, outcome:'completed'});
  await terminal.journal.commitCheckpoint(scope, {turnId:terminal.running.id, dispatchId:terminal.running.dispatchId!, runtimeGeneration:1, checkpoint:{revisionId:'revision', objectKey:'turns/revision.json', filesSha256:'a'.repeat(64), sessionSha256:'b'.repeat(64), committedAt:pending.updatedAt}});
  assert.throws(() => terminal.journal.observerCaller(terminal.current), /observer-turn-denied/);
});

test('observerCaller denies a session actor mismatch from a scoped store read', async () => {
  const base = new MemoryTurnStore();
  const journalForSetup = new TurnJournal(base, () => 1000);
  const session = (await journalForSetup.createSession(scope, actor, 'session-key', {title:'Session'})).session;
  const turn = (await journalForSetup.submit(scope, actor, session.id, 'turn-key', {message:'Run'})).turn;
  const running = (await journalForSetup.claim(scope, 1))!.turn;
  const journal = new TurnJournal(scopedStore(base, state => { state.sessions[session.id]!.actorUserId = 'other-user'; }), () => 1000);
  assert.throws(() => journal.observerCaller(command({sessionId:session.id, turnId:turn.id, dispatchId:running.dispatchId!})), /observer-turn-denied/);
});

test('observerCaller rejects browser-purpose and expired commands before journal authorization', async () => {
  const f = await runningFixture();
  assert.throws(() => f.journal.observerCaller({...f.current, purpose:'browser'} as unknown as ObserverCommand), /observer-command-denied/);
  assert.throws(() => f.journal.observerCaller({...f.current, deadlineAt:1000}), /observer-command-denied/);
});
