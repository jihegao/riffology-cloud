import { applyWorkspaceAlarm, alarmTime, TURN_WAKE_KEY, WORKSPACE_STATE_KEY } from './shared-alarm.ts';

type WorkspaceWakeRecord={wakeAt:unknown};
function workspaceWake(value:unknown):number|null{
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'wakeAt'))throw Error('invalid-workspace-alarm-state');
  return alarmTime((value as WorkspaceWakeRecord).wakeAt);
}

/** Persists the Turn domain's logical deadline and projects the earliest of
 * provisioning and Turn deadlines onto the Durable Object's single alarm. */
export class DurableTurnAlarmPort{
  readonly #storage:DurableObjectStorage;
  constructor(storage:DurableObjectStorage){
    if(!storage?.kv||typeof storage.transaction!=='function'||typeof storage.sync!=='function')throw Error('sqlite-workspace-alarm-storage-required');
    this.#storage=storage;
  }
  read():number|null{return alarmTime(this.#storage.kv.get<unknown>(TURN_WAKE_KEY));}
  async schedule(at:number):Promise<void>{const turnWake=alarmTime(at)!;
    await this.#storage.transaction(async transaction=>{
      const workspace=await transaction.get<unknown>(WORKSPACE_STATE_KEY);
      await transaction.put(TURN_WAKE_KEY,turnWake);
      await applyWorkspaceAlarm(transaction,workspaceWake(workspace),turnWake);
    });
    await this.#storage.sync();
  }
  async clear():Promise<void>{
    await this.#storage.transaction(async transaction=>{
      const workspace=await transaction.get<unknown>(WORKSPACE_STATE_KEY);
      await transaction.delete(TURN_WAKE_KEY);
      await applyWorkspaceAlarm(transaction,workspaceWake(workspace),null);
    });
    await this.#storage.sync();
  }
  async reconcile():Promise<number|null>{let next:number|null=null;
    await this.#storage.transaction(async transaction=>{
      const workspace=await transaction.get<unknown>(WORKSPACE_STATE_KEY),turnWake=await transaction.get<unknown>(TURN_WAKE_KEY);
      next=await applyWorkspaceAlarm(transaction,workspaceWake(workspace),turnWake);
    });
    await this.#storage.sync();return next;
  }
}
