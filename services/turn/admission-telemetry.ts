export type TurnAdmissionStage='gateway'|'ready'|'gate'|'engine'|'alarm'|'journal';

export type TurnAdmissionTelemetryEvent={
  route:'turn.submit';
  stage:TurnAdmissionStage;
  transportSuccess:boolean;
  errorCode:string|null;
};

const SAFE_ERROR_CODE=/^[a-z][a-z0-9_-]{0,63}$/;

export function turnAdmissionErrorCode(error:unknown):string{
  const value=error instanceof Error?error.message:'';
  return SAFE_ERROR_CODE.test(value)?value:'unclassified';
}

/** Staging diagnostics are deliberately limited to a fixed route/stage schema.
 * The caller controls enablement; this helper never accepts request data. */
export function traceTurnAdmission(enabled:unknown,stage:TurnAdmissionStage,transportSuccess:boolean,error?:unknown):void{
  if(enabled!=='true')return;
  const event:TurnAdmissionTelemetryEvent={route:'turn.submit',stage,transportSuccess,errorCode:transportSuccess?null:turnAdmissionErrorCode(error)};
  try{console.error(`turn-admission ${JSON.stringify(event)}`);}catch{}
}
