import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceState } from '../../services/workspace/coordinator.ts';
import { routeWorkspaceAlarm } from '../../services/workspace/alarm-router.ts';

function state(wakeAt: number | null, ready = false): WorkspaceState {
  return {
    schemaVersion: 1,
    task: {
      id: 'task-a', tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', generation: 2,
      starterVersion: 'blank-v1', authVersion: 1, createdAt: 1, deadlineAt: 10_000,
    },
    runtimeId: 'runtime-a', markerNonce: 'nonce-a', markerSha256: null, identity: null,
    phase: ready ? 'runtime_ready' : 'pending', lease: null, quotaReleased: false, acquisitionDenied: false,
    acquireAttempts: 0, releaseAttempts: 0,
    intents: { acquire: false, dispatch: false, initialize: false, stop: false, release: false },
    dispatchOwner: null, runtimeReceipt: null, stopReceipt: null, target: null, reasonCode: null, effect: null,
    calls: 0, windowEndsAt: 20_000, wakeAt,
    projection: ready ? {
      taskId: 'task-a', tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', generation: 2,
      sequence: 1, receiptId: 'receipt-a', updatedAt: 900, outcome: 'ready', reasonCode: 'initialized',
      quotaReleased: false, runtimeReceipt: null, stopReceipt: null,
    } : null,
    projectionConfirmed: ready, projectionAttempts: 0, sequence: ready ? 1 : 0,
  };
}

function fixture(initial: WorkspaceState | null, initialTurnWake: number | null) {
  let workspace = initial, turnWake = initialTurnWake;
  const calls: string[] = [];
  let workspaceAction: () => Promise<void> = async () => {};
  let turnAction: () => Promise<null> = async () => null;
  const ports = {
    readWorkspace: () => workspace,
    readTurnWake: () => turnWake,
    runWorkspace: async () => { calls.push('workspace'); await workspaceAction(); },
    runTurn: async (scope: unknown, generation: number) => {
      calls.push(`turn:${generation}:${JSON.stringify(scope)}`);
      return turnAction();
    },
    deferTurn: async (at: number) => { calls.push(`defer:${at}`); turnWake = at; },
    clearTurn: async () => { calls.push('clear'); turnWake = null; },
    reconcile: async () => { calls.push('reconcile'); return null; },
  };
  return {
    ports, calls,
    get turnWake() { return turnWake; },
    setWorkspace(value: WorkspaceState | null) { workspace = value; },
    onWorkspace(action: () => Promise<void>) { workspaceAction = action; },
    onTurn(action: () => Promise<null>) { turnAction = action; },
  };
}

test('an expired orphan Turn wake is cleared without inventing a scope', async () => {
  const f = fixture(null, 900);
  assert.deepEqual(await routeWorkspaceAlarm(f.ports, 1_000, 50), { workspace: 'absent', turn: 'orphan-cleared' });
  assert.deepEqual(f.calls, ['clear', 'reconcile']);
  assert.equal(f.turnWake, null);
});

test('a future orphan Turn wake remains available for a later state recovery', async () => {
  const f = fixture(null, 1_500);
  assert.deepEqual(await routeWorkspaceAlarm(f.ports, 1_000, 50), { workspace: 'absent', turn: 'waiting' });
  assert.deepEqual(f.calls, ['reconcile']);
  assert.equal(f.turnWake, 1_500);
});

test('a due Turn on a non-ready workspace is moved to a future retry', async () => {
  const f = fixture(state(2_000), 900);
  assert.deepEqual(await routeWorkspaceAlarm(f.ports, 1_000, 50), { workspace: 'waiting', turn: 'deferred' });
  assert.deepEqual(f.calls, ['defer:1050', 'reconcile']);
  assert.equal(f.turnWake, 1_050);
});

test('due provisioning runs before a due Turn and the ready state is re-read', async () => {
  const f = fixture(state(900), 900);
  f.onWorkspace(async () => f.setWorkspace(state(null, true)));
  assert.deepEqual(await routeWorkspaceAlarm(f.ports, 1_000, 50), { workspace: 'advanced', turn: 'advanced' });
  assert.deepEqual(f.calls, [
    'workspace',
    'turn:2:{"tenantId":"tenant-a","projectId":"project-a","workspaceId":"workspace-a","workspaceGeneration":2}',
    'reconcile',
  ]);
});

test('provisioning that remains non-ready defers the Turn after re-reading state', async () => {
  const f = fixture(state(900), 900);
  f.onWorkspace(async () => f.setWorkspace(state(1_800)));
  assert.deepEqual(await routeWorkspaceAlarm(f.ports, 1_000, 50), { workspace: 'advanced', turn: 'deferred' });
  assert.deepEqual(f.calls, ['workspace', 'defer:1050', 'reconcile']);
});

test('a provisioning failure defers an already due Turn and still reconciles', async () => {
  const f = fixture(state(900), 900);
  f.onWorkspace(async () => { throw Error('provisioning-transport-unknown'); });
  await assert.rejects(routeWorkspaceAlarm(f.ports, 1_000, 50), /provisioning-transport-unknown/);
  assert.deepEqual(f.calls, ['workspace', 'defer:1050', 'reconcile']);
  assert.equal(f.turnWake, 1_050);
});

test('a Turn failure still reconciles the shared physical alarm', async () => {
  const f = fixture(state(null, true), 900);
  f.onTurn(async () => { throw Error('turn-runtime-unknown'); });
  await assert.rejects(routeWorkspaceAlarm(f.ports, 1_000, 50), /turn-runtime-unknown/);
  assert.equal(f.calls.at(-1), 'reconcile');
  assert.equal(f.calls.filter(call => call === 'reconcile').length, 1);
});
