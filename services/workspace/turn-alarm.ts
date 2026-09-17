import { BROWSER_BUILD_WAKE_KEY, SIMULATION_WAKE_KEY, applyWorkspaceAlarm, alarmTime, TURN_WAKE_KEY, SERVICE_WAKE_KEY, OBSERVER_WAKE_KEY, WORKSPACE_STATE_KEY } from './shared-alarm.ts';

type WorkspaceWakeRecord={wakeAt:unknown};
function workspaceWake(value:unknown):number|null{
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'wakeAt'))throw Error('invalid-workspace-alarm-state');
  return alarmTime((value as WorkspaceWakeRecord).wakeAt);
}

/** A logical activity deadline sharing the Workspace's physical alarm.
 * Every mutation reads all domains inside the same storage transaction. */
class DurableActivityAlarmPort{
  readonly #storage:DurableObjectStorage;
  readonly #key:typeof TURN_WAKE_KEY|typeof SERVICE_WAKE_KEY|typeof OBSERVER_WAKE_KEY|typeof SIMULATION_WAKE_KEY|typeof BROWSER_BUILD_WAKE_KEY;
  constructor(storage:DurableObjectStorage,key:typeof TURN_WAKE_KEY|typeof SERVICE_WAKE_KEY|typeof OBSERVER_WAKE_KEY|typeof SIMULATION_WAKE_KEY|typeof BROWSER_BUILD_WAKE_KEY){
    if(!storage?.kv||typeof storage.transaction!=='function'||typeof storage.sync!=='function')throw Error('sqlite-workspace-alarm-storage-required');
    this.#storage=storage;this.#key=key;
  }
  read():number|null{return alarmTime(this.#storage.kv.get<unknown>(this.#key));}
  async #apply(transaction:DurableObjectTransaction){
    const workspace=await transaction.get<unknown>(WORKSPACE_STATE_KEY),turn=await transaction.get<unknown>(TURN_WAKE_KEY),service=await transaction.get<unknown>(SERVICE_WAKE_KEY),observer=await transaction.get<unknown>(OBSERVER_WAKE_KEY);
    return applyWorkspaceAlarm(transaction,workspaceWake(workspace),turn,service,observer,await transaction.get(SIMULATION_WAKE_KEY),await transaction.get(BROWSER_BUILD_WAKE_KEY));
  }
  async schedule(at:number):Promise<void>{const wake=alarmTime(at)!;
    await this.#storage.transaction(async transaction=>{await transaction.put(this.#key,wake);await this.#apply(transaction);});
    await this.#storage.sync();
  }
  async clear():Promise<void>{
    await this.#storage.transaction(async transaction=>{await transaction.delete(this.#key);await this.#apply(transaction);});
    await this.#storage.sync();
  }
  async reconcile():Promise<number|null>{
    const next=await this.#storage.transaction(transaction=>this.#apply(transaction));
    await this.#storage.sync();return next;
  }
}
export class DurableTurnAlarmPort extends DurableActivityAlarmPort{
  constructor(storage:DurableObjectStorage){super(storage,TURN_WAKE_KEY);}
}
export class DurableServiceAlarmPort extends DurableActivityAlarmPort{
  constructor(storage:DurableObjectStorage){super(storage,SERVICE_WAKE_KEY);}
}

export class DurableObserverAlarmPort extends DurableActivityAlarmPort{
  constructor(storage:DurableObjectStorage){super(storage,OBSERVER_WAKE_KEY);}
}

export class DurableSimulationAlarmPort extends DurableActivityAlarmPort{constructor(storage:DurableObjectStorage){super(storage,SIMULATION_WAKE_KEY);}}

export class DurableBrowserBuildAlarmPort extends DurableActivityAlarmPort{constructor(storage:DurableObjectStorage){super(storage,BROWSER_BUILD_WAKE_KEY);}}
