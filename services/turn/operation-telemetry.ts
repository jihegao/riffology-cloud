export type TurnOperationMetric=
  |'workspace_binding_result'
  |'workspace_handoff_result'
  |'project_prepare_result'
  |'project_skipped_count'
  |'release_hold_count'
  |'release_hold_age'
  |'release_confirmation_delay'
  |'destroy_timeout'
  |'native_execution_fence'
  |'native_start_fence'
  |'capacity_wait_count'
  |'queued_behind_release'
  |'hold_start_attempts'
  |'alarm_retry'
  |'checkpoint_result'
  |'release_result';

export type TurnOperationStage='workspace-binding'|'workspace-handoff'|'project-preparation'|'capacity'|'checkpoint'|'release'|'destroy'|'native-execution'|'native-start'|'alarm';
export type TurnOperationReason=
  |'none'
  |'capacity_wait'
  |'checkpoint_committed'
  |'checkpoint_aborted'
  |'checkpoint_pending'
  |'checkpoint_unavailable'
  |'release_pending'
  |'release_recovery_hold'
  |'release_confirmed'
  |'destroy_timed_out'
  |'native_execution_unresolved'
  |'native_start_unresolved'
  |'project_cleanup_unconfirmed'
  |'alarm_transport';

export type TurnOperationTelemetryEvent={
  route:'turn.operation';
  metric:TurnOperationMetric;
  stage:TurnOperationStage;
  reasonCategory:TurnOperationReason;
  attempt:number;
  durationMs:number|null;
  value:number;
  correlationId:string;
};

export type TurnOperationTrace=(event:TurnOperationTelemetryEvent)=>void;

const METRICS=new Set<TurnOperationMetric>(['workspace_binding_result','workspace_handoff_result','project_prepare_result','project_skipped_count','release_hold_count','release_hold_age','release_confirmation_delay','destroy_timeout','native_execution_fence','native_start_fence','capacity_wait_count','queued_behind_release','hold_start_attempts','alarm_retry','checkpoint_result','release_result']);
const STAGES=new Set<TurnOperationStage>(['workspace-binding','workspace-handoff','project-preparation','capacity','checkpoint','release','destroy','native-execution','native-start','alarm']);
const REASONS=new Set<TurnOperationReason>(['none','capacity_wait','checkpoint_committed','checkpoint_aborted','checkpoint_pending','checkpoint_unavailable','release_pending','release_recovery_hold','release_confirmed','destroy_timed_out','native_execution_unresolved','native_start_unresolved','project_cleanup_unconfirmed','alarm_transport']);
const OPAQUE=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function count(value:unknown):number{
  if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>1_000_000_000)throw Error('invalid-turn-operation-telemetry');
  return value as number;
}
function duration(value:unknown):number|null{return value===null?null:count(value);}

/** Validate a deliberately low-cardinality lifecycle metric. The schema has no
 * request, actor, scope, identity or free-form error fields. */
export function turnOperationEvent(value:unknown):TurnOperationTelemetryEvent{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-turn-operation-telemetry');
  const raw=value as Record<string,unknown>,keys=['route','metric','stage','reasonCategory','attempt','durationMs','value','correlationId'];
  if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key))||raw.route!=='turn.operation'||typeof raw.metric!=='string'||!METRICS.has(raw.metric as TurnOperationMetric)||typeof raw.stage!=='string'||!STAGES.has(raw.stage as TurnOperationStage)||typeof raw.reasonCategory!=='string'||!REASONS.has(raw.reasonCategory as TurnOperationReason)||typeof raw.correlationId!=='string'||!OPAQUE.test(raw.correlationId))throw Error('invalid-turn-operation-telemetry');
  return {route:'turn.operation',metric:raw.metric as TurnOperationMetric,stage:raw.stage as TurnOperationStage,reasonCategory:raw.reasonCategory as TurnOperationReason,attempt:count(raw.attempt),durationMs:duration(raw.durationMs),value:count(raw.value),correlationId:raw.correlationId};
}

export function turnOperationTracer(enabled:unknown):TurnOperationTrace|undefined{
  if(enabled!=='true')return undefined;
  return value=>{const event=turnOperationEvent(value);try{console.error(`turn-operation ${JSON.stringify(event)}`);}catch{}};
}
