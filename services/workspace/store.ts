import type { WorkspaceState } from './coordinator.ts';
import { applyWorkspaceAlarm, TURN_WAKE_KEY, WORKSPACE_STATE_KEY } from './shared-alarm.ts';
export interface WorkspaceStore {
  read(): WorkspaceState | null;
  update(operation: (state: WorkspaceState | null) => WorkspaceState): Promise<WorkspaceState>;
}
/** The state transition and its watchdog alarm share one SQLite transaction.
 * External RPC never runs inside this transaction. */
export class DurableWorkspaceStore implements WorkspaceStore {
  #storage: DurableObjectStorage;
  constructor(storage: DurableObjectStorage) {
    if (!storage?.sql || !storage.kv || !storage.transaction || !storage.sync) throw Error('sqlite-workspace-storage-required');
    this.#storage = storage;
  }
  read(): WorkspaceState | null { return structuredClone(this.#storage.kv.get<WorkspaceState>(WORKSPACE_STATE_KEY) ?? null); }
  async update(operation: (state: WorkspaceState | null) => WorkspaceState): Promise<WorkspaceState> {
    const result = await this.#storage.transaction(async transaction => {
      const state = structuredClone(await transaction.get<WorkspaceState>(WORKSPACE_STATE_KEY) ?? null);
      const next = structuredClone(operation(state));
      if (!next || typeof next !== 'object' || typeof (next as unknown as { then?: unknown }).then === 'function') throw Error('synchronous-workspace-update-required');
      const turnWake=await transaction.get<unknown>(TURN_WAKE_KEY);
      await transaction.put(WORKSPACE_STATE_KEY, next);
      await applyWorkspaceAlarm(transaction,next.wakeAt,turnWake);
      return next;
    });
    await this.#storage.sync(); return structuredClone(result);
  }
}
