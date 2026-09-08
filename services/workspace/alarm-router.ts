import type { WorkspaceState } from './coordinator.ts';
import type { WorkspaceTask } from './protocol.ts';
import type { TurnRecord, TurnScope } from '../turn/protocol.ts';

export type WorkspaceAlarmResult = {
  workspace: 'absent' | 'waiting' | 'advanced';
  turn: 'absent' | 'waiting' | 'deferred' | 'advanced' | 'orphan-cleared';
};

export interface WorkspaceAlarmRouterPorts {
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
export async function routeWorkspaceAlarm(
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
    await ports.reconcile();
  }
}
