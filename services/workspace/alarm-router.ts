import type { WorkspaceState } from './coordinator.ts';
import type { WorkspaceTask } from './protocol.ts';
import type { TurnRecord, TurnScope } from '../turn/protocol.ts';

export type WorkspaceAlarmResult = {
  workspace: 'absent' | 'waiting' | 'advanced';
  turn: 'absent' | 'waiting' | 'deferred' | 'advanced' | 'orphan-cleared';
  service?: 'absent' | 'waiting' | 'deferred' | 'advanced';
  observer?: 'absent' | 'waiting' | 'deferred' | 'advanced';
};

export interface WorkspaceAlarmRouterPorts {
  service?: {
    readWake(): number | null;
    advance(scope: TurnScope): Promise<void>;
    defer(at: number): Promise<void>;
  };
  observer?: {
    readWake(): number | null;
    advance(scope: TurnScope): Promise<void>;
    defer(at: number): Promise<void>;
  };
  readWorkspace(): WorkspaceState | null;
  readTurnWake(): number | null;
  runWorkspace(task: WorkspaceTask): Promise<void>;
  runTurn(scope: TurnScope, generation: number): Promise<TurnRecord | null>;
  deferTurn(at: number): Promise<void>;
  clearTurn(): Promise<void>;
  reconcile(): Promise<number | null>;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw Error('invalid-workspace-alarm-routing-time');
  return value as number;
}

function readyScope(state: WorkspaceState): TurnScope | null {
  if (state.projection?.outcome !== 'ready' || !state.projectionConfirmed) return null;
  return {
    tenantId: state.task.tenantId,
    projectId: state.task.projectId,
    workspaceId: state.task.workspaceId,
    workspaceGeneration: state.task.generation,
  };
}

/**
 * Routes the WorkspaceAgent's one physical alarm across two durable logical
 * deadlines. Provisioning runs first because it can make a workspace ready;
 * the state is then re-read before a Turn may cross the runtime boundary.
 */
async function routeWorkspaceAndTurnAlarm(
  ports: WorkspaceAlarmRouterPorts,
  now = Date.now(),
  retryMs = 2_000,
): Promise<WorkspaceAlarmResult> {
  const observedAt = positive(now), retryAt = observedAt + positive(retryMs);
  let workspace: WorkspaceAlarmResult['workspace'] = 'waiting';
  let turn: WorkspaceAlarmResult['turn'] = 'waiting';

  try {
    let state = ports.readWorkspace();
    let turnWake = ports.readTurnWake();

    if (!state) {
      workspace = 'absent';
      if (turnWake === null) turn = 'absent';
      else if (turnWake <= observedAt) {
        // A Turn cannot be dispatched without the persisted Workspace task and
        // generation. Remove only its wakeup; the journal remains for audit.
        await ports.clearTurn();
        turn = 'orphan-cleared';
      }
      return { workspace, turn };
    }

    if (state.wakeAt !== null && state.wakeAt <= observedAt) {
      workspace = 'advanced';
      try {
        await ports.runWorkspace(state.task);
      } catch (error) {
        if (turnWake !== null && turnWake <= observedAt) await ports.deferTurn(retryAt);
        throw error;
      }
    }

    state = ports.readWorkspace();
    turnWake = ports.readTurnWake();
    if (turnWake === null) {
      turn = 'absent';
      return { workspace, turn };
    }
    if (turnWake > observedAt) return { workspace, turn };

    if (!state) {
      await ports.clearTurn();
      turn = 'orphan-cleared';
      return { workspace: 'absent', turn };
    }

    const scope = readyScope(state);
    if (!scope) {
      // Keep the queued or active journal intact while avoiding a physical
      // alarm that immediately loops on an already expired logical deadline.
      await ports.deferTurn(retryAt);
      turn = 'deferred';
      return { workspace, turn };
    }

    await ports.runTurn(scope, state.task.generation);
    turn = 'advanced';
    return { workspace, turn };
  } finally {
    // The outer router reconciles after every activity domain has been visited.
  }
}

/** Each maintenance domain gets a delivery attempt even when an earlier domain
 * fails. Persist a future wake before crossing the external runtime boundary. */
async function routeMaintenance(
  ports:WorkspaceAlarmRouterPorts,
  domain:'service'|'observer',
  observedAt:number,
  retryAt:number,
  result:WorkspaceAlarmResult|undefined,
):Promise<void>{
  const activity=ports[domain];
  if(!activity)return;
  const wake=activity.readWake();
  let status:NonNullable<WorkspaceAlarmResult['service']>='waiting';
  if(wake===null)status='absent';
  else if(wake<=observedAt){
    await activity.defer(retryAt);
    const state=ports.readWorkspace();
    // Stop and reconcile are allowed for non-ready workspaces, but never with
    // a scope inferred from request data when the persisted task is absent.
    if(state){
      await activity.advance({tenantId:state.task.tenantId,projectId:state.task.projectId,workspaceId:state.task.workspaceId,workspaceGeneration:state.task.generation});
      status='advanced';
    }else status='deferred';
  }
  if(result)result[domain]=status;
}

export async function routeWorkspaceAlarm(ports:WorkspaceAlarmRouterPorts,now=Date.now(),retryMs=2000):Promise<WorkspaceAlarmResult>{
  const observedAt=positive(now),retryAt=positive(observedAt+positive(retryMs));
  let result:WorkspaceAlarmResult|undefined;
  try{return result=await routeWorkspaceAndTurnAlarm(ports,observedAt,retryMs);}
  finally{
    try{await routeMaintenance(ports,'service',observedAt,retryAt,result);}
    finally{
      try{await routeMaintenance(ports,'observer',observedAt,retryAt,result);}
      finally{await ports.reconcile();}
    }
  }
}
