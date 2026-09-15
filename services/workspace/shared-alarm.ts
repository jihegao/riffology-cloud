export const BROWSER_BUILD_WAKE_KEY='browser-preview:wake-at';
export const WORKSPACE_STATE_KEY='m1:workspace:initialization';
export const TURN_WAKE_KEY='m2:turn:wake-at';
export const SERVICE_WAKE_KEY='m3:service:wake-at';
export const SIMULATION_WAKE_KEY='m4:simulation:wake-at';
export const OBSERVER_WAKE_KEY='m3:observer:wake-at';

export function alarmTime(value:unknown):number|null{
  if(value===null||value===undefined)return null;
  if(!Number.isSafeInteger(value)||(value as number)<1)throw Error('invalid-workspace-alarm-time');
  return value as number;
}

export function nextWorkspaceAlarm(workspaceWake:unknown,turnWake:unknown,serviceWake:unknown=null,observerWake:unknown=null,simulationWake:unknown=null,buildWake:unknown=null):number|null{
  const values=[alarmTime(workspaceWake),alarmTime(turnWake),alarmTime(serviceWake),alarmTime(observerWake),alarmTime(simulationWake),alarmTime(buildWake)].filter((value):value is number=>value!==null);
  return values.length?Math.min(...values):null;
}

export async function applyWorkspaceAlarm(
  transaction:Pick<DurableObjectTransaction,'setAlarm'|'deleteAlarm'>,
  workspaceWake:unknown,
  turnWake:unknown,
  serviceWake:unknown=null,
  observerWake:unknown=null,
  simulationWake:unknown=null,
  buildWake:unknown=null,
):Promise<number|null>{
  const next=nextWorkspaceAlarm(workspaceWake,turnWake,serviceWake,observerWake,simulationWake,buildWake);
  if(next===null)await transaction.deleteAlarm();else await transaction.setAlarm(next);
  return next;
}
