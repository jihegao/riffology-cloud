export type TurnAdmissionStage='gateway'|'ready'|'gate'|'engine'|'alarm'|'journal';

export type TurnAdmissionTelemetryEvent={
  route:'turn.submit';
  stage:TurnAdmissionStage;
  transportSuccess:boolean;
  errorCode:string|null;
};

const SAFE_ERROR_CODES=new Set([
  'turn_runtime_not_ready',
  'workspace-not-ready',
  'workspace-actor-scope-denied',
  'turn-runtime-not-ready',
  'product-turn-runtime-not-configured',
  'tool-artifact-store-not-configured',
  'sqlite-workspace-alarm-storage-required',
  'invalid-workspace-alarm-time',
  'invalid-workspace-alarm-state',
  'invalid-turn-alarm-timing',
  'invalid-turn-identifier',
  'invalid-turn-integer',
  'invalid-turn-scope',
  'invalid-turn-actor',
  'invalid-turn-message',
  'turn-session-not-found',
  'turn-idempotency-conflict',
  'turn-workspace-scope-conflict',
  'invalid-persisted-turn-journal',
  'sqlite-turn-storage-required',
  'turn-journal-operation-must-be-synchronous',
]);

export function turnAdmissionErrorCode(error:unknown):string{
  const value=error instanceof Error?error.message:'';
  return SAFE_ERROR_CODES.has(value)?value:'unclassified';
}

/** Staging diagnostics are deliberately limited to a fixed route/stage schema.
 * The caller controls enablement; this helper never accepts request data. */
export function traceTurnAdmission(enabled:unknown,stage:TurnAdmissionStage,transportSuccess:boolean,error?:unknown):void{
  if(enabled!=='true')return;
  const event:TurnAdmissionTelemetryEvent={route:'turn.submit',stage,transportSuccess,errorCode:transportSuccess?null:turnAdmissionErrorCode(error)};
  try{console.error(`turn-admission ${JSON.stringify(event)}`);}catch{}
}
