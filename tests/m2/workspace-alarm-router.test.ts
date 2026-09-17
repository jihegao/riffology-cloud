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

test('a due Service wake runs without a Turn wake, including an unready workspace for stop delivery',async()=>{
  const f=fixture(state(null,false),null);let wake:number|null=900;
  const result=await routeWorkspaceAlarm({...f.ports,service:{readWake:()=>wake,defer:async at=>{f.calls.push(`service-defer:${at}`);wake=at;},advance:async scope=>{assert.equal(scope.workspaceGeneration,2);f.calls.push('service');}}},1000);
  assert.equal(result.service,'advanced');
  assert.deepEqual(f.calls,['service-defer:3000','service','reconcile']);
});

test('a due orphan Service wake stays deferred without dispatch or synthetic scope',async()=>{
  const f=fixture(null,null);let wake:number|null=900;
  const result=await routeWorkspaceAlarm({...f.ports,service:{readWake:()=>wake,defer:async at=>{wake=at;},advance:async()=>{assert.fail('orphan dispatch');}}},1000);
  assert.equal(result.service,'deferred');assert.equal(wake,3000);assert.deepEqual(f.calls,['reconcile']);
});

test('a failing Turn does not suppress Service stop delivery and reconciliation',async()=>{
  const f=fixture(state(null,true),900);f.onTurn(async()=>{throw Error('turn-failed');});
  await assert.rejects(routeWorkspaceAlarm({...f.ports,service:{readWake:()=>900,defer:async()=>{f.calls.push('service-defer');},advance:async()=>{f.calls.push('service');}}},1000),/turn-failed/);
  assert.deepEqual(f.calls.slice(-3),['service-defer','service','reconcile']);
});


test('Observer receives non-ready persisted scope after a Service failure and future defer',async()=>{
 const f=fixture(state(null,false),null);let observerWake=900;
 await assert.rejects(routeWorkspaceAlarm({...f.ports,
  service:{readWake:()=>900,defer:async()=>{f.calls.push('service-defer');},advance:async()=>{f.calls.push('service');throw Error('service-failed');}},
  observer:{readWake:()=>observerWake,defer:async at=>{observerWake=at;f.calls.push('observer-defer');},advance:async scope=>{
   assert.equal(observerWake,3000);assert.deepEqual(scope,{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2});f.calls.push('observer');
  }},
 },1000),/service-failed/);
 assert.deepEqual(f.calls,['service-defer','service','observer-defer','observer','reconcile']);
});

test('orphan Observer wake remains durable and deferred without inventing a scope',async()=>{
 const f=fixture(null,null);let wake=900;
 const result=await routeWorkspaceAlarm({...f.ports,observer:{readWake:()=>wake,defer:async at=>{wake=at;},advance:async()=>{assert.fail('synthetic scope');}}},1000);
 assert.equal(result.observer,'deferred');assert.equal(wake,3000);assert.deepEqual(f.calls,['reconcile']);
});

test('Observer failure is rearmed before delivery and still reconciles the shared alarm',async()=>{
 const f=fixture(state(null,true),null);let wake=900;
 await assert.rejects(routeWorkspaceAlarm({...f.ports,
  service:{readWake:()=>900,defer:async()=>{f.calls.push('service-defer');},advance:async()=>{f.calls.push('service');}},
  observer:{readWake:()=>wake,defer:async at=>{wake=at;f.calls.push('observer-defer');},advance:async()=>{assert.equal(wake,3000);throw Error('observer-failed');}},
 },1000),/observer-failed/);
 assert.deepEqual(f.calls,['service-defer','service','observer-defer','reconcile']);assert.equal(wake,3000);
});

test('future and absent Observer wakes do not run external work',async()=>{
 for(const wake of [null,1500]){
  const f=fixture(null,null);
  const result=await routeWorkspaceAlarm({...f.ports,observer:{readWake:()=>wake,defer:async()=>{assert.fail('unexpected defer');},advance:async()=>{assert.fail('unexpected advance');}}},1000);
  assert.equal(result.observer,wake===null?'absent':'waiting');assert.deepEqual(f.calls,['reconcile']);
 }
});

test('browser build gets persisted retry and delivery after simulation failure',async()=>{
 const f=fixture(state(null,true),null);let wake=900;
 await assert.rejects(routeWorkspaceAlarm({...f.ports,simulation:{readWake:()=>900,defer:async()=>{},advance:async()=>{throw Error('simulation-failed');}},browserBuild:{readWake:()=>wake,defer:async at=>{wake=at;f.calls.push('build-defer');},advance:async scope=>{assert.equal(scope.workspaceId,'workspace-a');assert.equal(wake,1050);f.calls.push('build');}}},1000,50),/simulation-failed/);
 assert.deepEqual(f.calls,['build-defer','build','reconcile']);
});
