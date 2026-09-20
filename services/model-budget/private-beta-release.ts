export function privateBetaNativeReleaseGuard(hold:{turnId:string;status:string;reasonCode:string}|null|undefined,turnId:string|null):boolean{
  return !!turnId&&hold?.turnId===turnId&&hold.status==='release-pending'&&['trusted-pi-release-assignment-guard','trusted-pi-release-quiet-window'].includes(hold.reasonCode);
}

/** An original native absence guard keeps capacity occupied. It may use the
 * existing total Turn deadline, never a rolling extension or release proof. */
export function privateBetaReleaseDeadline(createdAt:number,policy:{maxTurnDurationMs:number;releaseTimeoutMs:number},state:{terminal:boolean;finishedAt:number|null;releaseGuard?:boolean}):number{
  if(state.terminal&&state.finishedAt!==null&&state.releaseGuard!==true)return state.finishedAt+policy.releaseTimeoutMs;
  return createdAt+policy.maxTurnDurationMs;
}
