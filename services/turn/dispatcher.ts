import type { CheckpointReceipt, TurnActor, TurnBaseCheckpoints, TurnRecord, TurnResourceDisposition, TurnScope } from './protocol.ts';
import { checkpointObjectKey, jsonPayload, positive, resourceDisposition, sameScope, scope as validateScope, sha, turnBaseCheckpoints, turnId } from './protocol.ts';
import { toolArtifactReceipt, toolArtifactReferenceReceipt, type ToolArtifactReferenceInput, type ToolArtifactStoreRpc } from '../artifacts/protocol.ts';
import type { TurnOperationTelemetryEvent, TurnOperationTrace } from './operation-telemetry.ts';

export type TurnRuntimeEvent = {
  eventId:string;
  type:'assistant.delta'|'assistant.message'|'tool.started'|'tool.updated'|'tool.completed'|'provider.status';
  at:number;
  payload:Record<string,unknown>;
};
export type TurnStopReceipt = {
  confirmationId:string;
  observedAt:number;
  nativeRunning:false;
  fenced:true;
};
type RuntimeReceiptBase = {
  scope:TurnScope;
  sessionId:string;
  turnId:string;
  dispatchId:string;
  generation:number;
  executionErrorCode:string|null;
  events:TurnRuntimeEvent[];
  checkpoint:CheckpointReceipt|null;
  persistenceErrorCode:string|null;
  stopped:TurnStopReceipt|null;
};
export type TurnRuntimeReceipt =
  | RuntimeReceiptBase & {phase:'accepted'|'unknown'|'running';outcome:null;resourceDisposition:Extract<TurnResourceDisposition,{status:'active'}>}
  | RuntimeReceiptBase & {phase:'absent';outcome:null;resourceDisposition:Extract<TurnResourceDisposition,{status:'released'}>}
  | RuntimeReceiptBase & {phase:'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted';resourceDisposition:Exclude<TurnResourceDisposition,{status:'active'}>};
export interface TurnRuntimePort {
  accept(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;actor:TurnActor;message:string;base:TurnBaseCheckpoints;capacityLease:{operationId:string;leaseId:string}}):Promise<TurnRuntimeReceipt>;
  observe(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;capacityLease?:{operationId:string;leaseId:string}}):Promise<TurnRuntimeReceipt>;
  cancel(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;capacityLease?:{operationId:string;leaseId:string}}):Promise<TurnRuntimeReceipt>;
}
export interface TurnDispatcherJournal {
  claim(scope:TurnScope,generation:number):Promise<{turn:TurnRecord;replayed:boolean}|null>;
  admissionCandidate?(scope:TurnScope):{turn:TurnRecord;wait:null|{turnId:string;ticketId:string|null;operationId:string;nextAttemptAt:number}}|null;
  activeTurn?(scope:TurnScope):TurnRecord|null;
  queuedBehindRelease?(scope:TurnScope):number;
  beginResourceWait?(scope:TurnScope,input:{turnId:string;ticketId?:string|null;operationId:string;reasonCode?:string;since?:number;nextAttemptAt?:number}):Promise<unknown>;
  consumeResourceLeaseAndClaim?(scope:TurnScope,generation:number,input:{turnId:string;ticketId:string;operationId:string;leaseId:string}):Promise<{turn:TurnRecord;replayed:boolean}|null>;
  appendRuntime(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;eventId:string;type:TurnRuntimeEvent['type'];at:number;payload:unknown}):Promise<unknown>;
  appendRuntimeBatch?(scope:TurnScope,inputs:ReadonlyArray<{turnId:string;dispatchId:string;runtimeGeneration:number;eventId:string;type:TurnRuntimeEvent['type'];at:number;payload:unknown}>):Promise<unknown>;
  beginCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;outcome:'completed'|'failed'|'cancelled'|'interrupted';errorCode?:string|null}):Promise<TurnRecord>;
  commitCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;checkpoint:CheckpointReceipt;resourceDisposition:TurnResourceDisposition}):Promise<TurnRecord>;
  failCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;errorCode:string;resourceDisposition:TurnResourceDisposition}):Promise<TurnRecord>;
  cancelWithDisposition(scope:TurnScope,actor:TurnActor,id:string):Promise<{turn:TurnRecord;cancelRequested:boolean}>;
  pendingResourceCancellation?(scope:TurnScope):{turn:TurnRecord;wait:{turnId:string;ticketId:string|null;operationId:string};requestedAt:number}|null;
  completeResourceCancellation?(scope:TurnScope,input:{turnId:string;ticketId:string|null;operationId:string;proofId:string;releasedAt:number}):Promise<TurnRecord>;
  pendingInitialBaseCleanup?(scope:TurnScope):{turn:TurnRecord;wait:{status:'release-pending';reasonCode:'turn-initial-base-unavailable';since:number;nextAttemptAt:number;turnId:string;ticketId:string;operationId:string;leaseId:string}}|null;
  completeInitialBaseCleanup?(scope:TurnScope,input:{turnId:string;ticketId:string;operationId:string;leaseId:string;proofId:string;releasedAt:number}):Promise<TurnRecord>;
  completeNeverStartedCancellation?(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;operationId:string;leaseId:string;proofId:string;releasedAt:number}):Promise<TurnRecord>;
  recovery?(scope:TurnScope):{hold:{nextAttemptAt:number};turn:TurnRecord;identity:ExpectedReceipt;resourceLease:{operationId:string;leaseId:string}}|null;
  advanceRecovery?(scope:TurnScope,resolution:'committed'|'aborted'|'pending'):Promise<unknown>;
  releaseRecovery?(scope:TurnScope):{hold:{status:'release-pending'|'recovery-hold';since:number;nextAttemptAt:number};turn:TurnRecord;identity:ExpectedReceipt;resourceLease:{operationId:string;leaseId:string}}|null;
  advanceRelease?(scope:TurnScope,disposition:TurnResourceDisposition):Promise<unknown>;
}
export type TurnArtifactReferencePort=Pick<ToolArtifactStoreRpc,'retain'>;
export type TurnCapacityReceipt=
  | {status:'waiting';turnId:string;generation:number;ticketId:string;operationId:string;reasonCode:string;since:number;nextAttemptAt:number}
  | {status:'acquired';turnId:string;generation:number;ticketId:string;operationId:string;leaseId:string};
export interface TurnCapacityPort{
  acquire(input:{scope:TurnScope;sessionId:string;turnId:string;generation:number;ticketId:string|null;operationId:string|null}):Promise<TurnCapacityReceipt>;
  releaseNeverStarted(input:{scope:TurnScope;sessionId:string;turnId:string;generation:number;ticketId:string|null;operationId:string;leaseId:string|null;reasonCode:string;observedAt:number}):Promise<{proofId:string;releasedAt:number}>;
}

type ExpectedReceipt={scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number};
const EVENT_TYPES=new Set<TurnRuntimeEvent['type']>(['assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status']);
const PHASES=new Set<TurnRuntimeReceipt['phase']>(['accepted','absent','unknown','running','terminal']);
const OUTCOMES=new Set<NonNullable<TurnRuntimeReceipt['outcome']>>(['completed','failed','cancelled','interrupted']);
const RECONCILABLE_PERSISTENCE_ERRORS=new Set(['turn-checkpoint-unknown']);
const NON_PERSISTABLE_EXECUTION_ERRORS=new Set(['turn-base-unavailable','turn-native-execution-absent','turn-native-execution-unresolved','turn-native-exit-failed','turn-native-result-missing','turn-native-start-unresolved']);

function optionalCode(value:unknown):string|null{return value==null?null:turnId(value);}
function checkpoint(value:unknown):CheckpointReceipt|null{
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==5)throw Error('invalid-turn-runtime-receipt');
  const receipt=value as Record<string,unknown>;
  return {revisionId:turnId(receipt.revisionId),objectKey:checkpointObjectKey(receipt.objectKey),filesSha256:sha(receipt.filesSha256),sessionSha256:sha(receipt.sessionSha256),committedAt:positive(receipt.committedAt)};
}
function stopped(value:unknown):TurnStopReceipt|null{
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4)throw Error('invalid-turn-runtime-receipt');
  const receipt=value as Record<string,unknown>;
  if(receipt.nativeRunning!==false||receipt.fenced!==true)throw Error('invalid-turn-runtime-receipt');
  return {confirmationId:turnId(receipt.confirmationId),observedAt:positive(receipt.observedAt),nativeRunning:false,fenced:true};
}
function runtimeEvent(value:unknown):TurnRuntimeEvent{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4)throw Error('invalid-turn-runtime-receipt');
  const receipt=value as Record<string,unknown>;
  if(typeof receipt.type!=='string'||!EVENT_TYPES.has(receipt.type as TurnRuntimeEvent['type']))throw Error('invalid-turn-runtime-receipt');
  return {eventId:turnId(receipt.eventId),type:receipt.type as TurnRuntimeEvent['type'],at:positive(receipt.at),payload:jsonPayload(receipt.payload)};
}
function capacityReceipt(value:unknown):TurnCapacityReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-turn-capacity-receipt');const raw=value as Record<string,unknown>;
  const keys=raw.status==='waiting'?['status','turnId','generation','ticketId','operationId','reasonCode','since','nextAttemptAt']:raw.status==='acquired'?['status','turnId','generation','ticketId','operationId','leaseId']:null;
  if(!keys||Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))throw Error('invalid-turn-capacity-receipt');const common={turnId:turnId(raw.turnId),generation:positive(raw.generation),ticketId:turnId(raw.ticketId),operationId:turnId(raw.operationId)};
  if(raw.status==='acquired')return {status:'acquired',...common,leaseId:turnId(raw.leaseId)};
  const since=positive(raw.since),nextAttemptAt=positive(raw.nextAttemptAt);if(nextAttemptAt<since)throw Error('invalid-turn-capacity-receipt');return {status:'waiting',...common,reasonCode:turnId(raw.reasonCode),since,nextAttemptAt};
}
function validateReceipt(value:unknown,expected:ExpectedReceipt,expectedLease?:{operationId:string;leaseId:string}):TurnRuntimeReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-turn-runtime-receipt');
  const receipt=value as Record<string,unknown>,receiptScope=validateScope(receipt.scope);
  const keys=['scope','sessionId','turnId','dispatchId','generation','phase','outcome','executionErrorCode','events','checkpoint','persistenceErrorCode','stopped','resourceDisposition'];
  if(Object.keys(receipt).length!==keys.length||keys.some(key=>!Object.hasOwn(receipt,key)))throw Error('invalid-turn-runtime-receipt');
  if(!sameScope(receiptScope,expected.scope)||turnId(receipt.sessionId)!==expected.sessionId||turnId(receipt.turnId)!==expected.turnId||turnId(receipt.dispatchId)!==expected.dispatchId||positive(receipt.generation)!==expected.generation)throw Error('turn-runtime-receipt-scope-denied');
  if(typeof receipt.phase!=='string'||!PHASES.has(receipt.phase as TurnRuntimeReceipt['phase']))throw Error('invalid-turn-runtime-receipt');
  const phase=receipt.phase as TurnRuntimeReceipt['phase'];
  const outcome=receipt.outcome==null?null:OUTCOMES.has(receipt.outcome as NonNullable<TurnRuntimeReceipt['outcome']>)?receipt.outcome as NonNullable<TurnRuntimeReceipt['outcome']>:null;
  if(receipt.outcome!=null&&outcome===null)throw Error('invalid-turn-runtime-receipt');
  let events:TurnRuntimeEvent[];
  if(Array.isArray(receipt.events))events=receipt.events.map(runtimeEvent);else throw Error('invalid-turn-runtime-receipt');
  const saved=checkpoint(receipt.checkpoint),saveError=optionalCode(receipt.persistenceErrorCode),executionError=optionalCode(receipt.executionErrorCode),stop=stopped(receipt.stopped);
  const disposition=resourceDisposition(receipt.resourceDisposition);
  if(disposition.turnId!==expected.turnId||disposition.dispatchId!==expected.dispatchId||disposition.generation!==expected.generation)throw Error('turn-runtime-receipt-scope-denied');
  if(expectedLease&&(disposition.operationId!==expectedLease.operationId||disposition.leaseId!==expectedLease.leaseId))throw Error('turn-runtime-receipt-scope-denied');
  if(phase==='terminal'){
    if(!outcome||!stop||disposition.status==='active'||(saved===null)===(saveError===null))throw Error('invalid-turn-runtime-receipt');
    if(outcome==='completed'&&executionError!==null)throw Error('invalid-turn-runtime-receipt');
  }else if(outcome!==null||saved!==null||saveError!==null||stop!==null){throw Error('invalid-turn-runtime-receipt');}
  if((phase==='accepted'||phase==='unknown'||phase==='running')&&disposition.status!=='active')throw Error('invalid-turn-runtime-receipt');
  if(phase==='absent'&&disposition.status!=='released')throw Error('invalid-turn-runtime-receipt');
  if((phase==='absent'||phase==='unknown')&&events.length)throw Error('invalid-turn-runtime-receipt');
  return {scope:receiptScope,sessionId:expected.sessionId,turnId:expected.turnId,dispatchId:expected.dispatchId,generation:expected.generation,phase,outcome,executionErrorCode:executionError,events,checkpoint:saved,persistenceErrorCode:saveError,stopped:stop,resourceDisposition:disposition} as TurnRuntimeReceipt;
}

export class TurnDispatcher {
  private readonly journal:TurnDispatcherJournal;
  private readonly runtime:TurnRuntimePort;
  private readonly artifactReferences:TurnArtifactReferencePort|null;
  private readonly capacity:TurnCapacityPort|null;
  private readonly clock:()=>number;
  private readonly trace:TurnOperationTrace|undefined;
  constructor(journal:TurnDispatcherJournal,runtime:TurnRuntimePort,artifactReferences:TurnArtifactReferencePort|null=null,capacity:TurnCapacityPort|null=null,clock:()=>number=Date.now,trace?:TurnOperationTrace){this.journal=journal;this.runtime=runtime;this.artifactReferences=artifactReferences;this.capacity=capacity;this.clock=clock;this.trace=trace;}

  private emit(event:TurnOperationTelemetryEvent){try{this.trace?.(event);}catch{}}

  alarmCorrelationId(scope:TurnScope):string|null{return this.journal.releaseRecovery?.(scope)?.resourceLease.operationId??this.journal.recovery?.(scope)?.resourceLease.operationId??this.journal.pendingInitialBaseCleanup?.(scope)?.wait.operationId??this.journal.admissionCandidate?.(scope)?.wait?.operationId??this.journal.activeTurn?.(scope)?.resourceLease?.operationId??null;}

  private async retainArtifact(scope:TurnScope,turnIdValue:string,dispatchId:string,event:TurnRuntimeEvent):Promise<void>{
    if(event.type!=='tool.completed'||event.payload.artifact==null)return;
    if(event.payload.isError!==false)throw Error('invalid-tool-artifact-completion');
    const artifact=toolArtifactReceipt(event.payload.artifact);
    if(!this.artifactReferences)throw Error('tool-artifact-reference-store-not-configured');
    const reference:ToolArtifactReferenceInput={schemaVersion:1,scope,artifactId:artifact.artifactId,turnId:turnIdValue,dispatchId,kind:'turn_event',referenceId:event.eventId};
    const retained=toolArtifactReferenceReceipt(await this.artifactReferences.retain(reference));
    if(retained.artifactId!==reference.artifactId||retained.kind!==reference.kind||retained.referenceId!==reference.referenceId||retained.releasedAt!==null)throw Error('tool-artifact-reference-receipt-conflict');
  }

  nextWakeAt(scope:TurnScope){const wakes=[this.journal.recovery?.(scope)?.hold.nextAttemptAt,this.journal.releaseRecovery?.(scope)?.hold.nextAttemptAt,this.journal.admissionCandidate?.(scope)?.wait?.nextAttemptAt].filter((value):value is number=>value!==undefined&&value!==null);return wakes.length?Math.min(...wakes):null;}

  private async apply(turn:TurnRecord,receipt:TurnRuntimeReceipt):Promise<TurnRecord>{
    const dispatchId=turn.dispatchId!,generation=turn.runtimeGeneration!,scope=turn.scope;
    const append=async(events:TurnRuntimeEvent[])=>{
      if(!events.length)return;
      const inputs=events.map(item=>({turnId:turn.id,dispatchId,runtimeGeneration:generation,...item}));
      if(this.journal.appendRuntimeBatch)await this.journal.appendRuntimeBatch(scope,inputs);
      else for(const input of inputs)await this.journal.appendRuntime(scope,input);
    };
    let buffered:TurnRuntimeEvent[]=[];
    for(const item of receipt.events??[]){
      if(item.type==='tool.completed'&&item.payload.artifact!=null){
        // Preserve the retain -> durable event boundary before retaining the
        // next artifact. Ordinary streamed deltas can share one transaction.
        await append(buffered);buffered=[];
        await this.retainArtifact(scope,turn.id,dispatchId,item);await append([item]);
      }else buffered.push(item);
    }
    await append(buffered);
    if(receipt.phase!=='terminal')return turn;
    const pending=await this.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,outcome:receipt.outcome!,errorCode:receipt.executionErrorCode??null});
    if(receipt.checkpoint){this.emit({route:'turn.operation',metric:'checkpoint_result',stage:'checkpoint',reasonCategory:'checkpoint_committed',attempt:1,durationMs:null,value:1,correlationId:turn.resourceLease!.operationId});return this.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,checkpoint:receipt.checkpoint,resourceDisposition:receipt.resourceDisposition});}
    if(RECONCILABLE_PERSISTENCE_ERRORS.has(receipt.persistenceErrorCode!)&&!NON_PERSISTABLE_EXECUTION_ERRORS.has(receipt.executionErrorCode!))return pending;
    this.emit({route:'turn.operation',metric:'checkpoint_result',stage:'checkpoint',reasonCategory:receipt.persistenceErrorCode==='turn-checkpoint-aborted'?'checkpoint_aborted':'checkpoint_unavailable',attempt:1,durationMs:null,value:0,correlationId:turn.resourceLease!.operationId});
    return this.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,errorCode:receipt.persistenceErrorCode!,resourceDisposition:receipt.resourceDisposition});
  }

  /** Replays the durable Stop intent through ProductTurnRuntime. The exact
   * Sandbox process fence owns idempotent signal delivery, so repeating this
   * RPC after a lost response is safe. If Workspace committed its claim/Stop before the first
   * accept RPC reached the Runtime actor, recreate that exact immutable accept
   * intent and immediately apply the same Stop fence. */
  private async reconcileCancellation(turn:TurnRecord,expected:ExpectedReceipt,input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;actor:TurnActor;message:string;base:TurnBaseCheckpoints;capacityLease:{operationId:string;leaseId:string}}):Promise<{receipt:TurnRuntimeReceipt;neverStarted:null}|{receipt:null;neverStarted:{proofId:string;releasedAt:number}}>{
    const exact={...expected,capacityLease:turn.resourceLease!},first=validateReceipt(await this.runtime.cancel(exact),expected,turn.resourceLease!);
    if(first.phase!=='absent')return {receipt:first,neverStarted:null};
    if(this.capacity){
      const neverStarted=await this.capacity.releaseNeverStarted({scope:turn.scope,sessionId:turn.sessionId,turnId:turn.id,generation:expected.generation,ticketId:null,operationId:turn.resourceLease!.operationId,leaseId:turn.resourceLease!.leaseId,reasonCode:'turn-cancelled-before-runtime-accept',observedAt:turn.cancelRequestedAt!});
      return {receipt:null,neverStarted};
    }
    const accepted=validateReceipt(await this.runtime.accept(input),expected,turn.resourceLease!);
    if(accepted.phase==='absent')throw Error('invalid-turn-runtime-receipt');
    if(accepted.phase==='terminal')return {receipt:accepted,neverStarted:null};
    return {receipt:validateReceipt(await this.runtime.cancel(exact),expected,turn.resourceLease!),neverStarted:null};
  }

  async tick(rawScope:TurnScope,generation:number):Promise<TurnRecord|null>{
    const scope=validateScope(rawScope),runtimeGeneration=positive(generation);
    if(scope.workspaceGeneration!==runtimeGeneration)throw Error('turn-runtime-generation-conflict');
    const recovery=this.journal.recovery?.(scope);if(recovery){if(!this.journal.advanceRecovery)throw Error('turn-recovery-journal-required');const receipt=validateReceipt(await this.runtime.observe({...recovery.identity,capacityLease:recovery.resourceLease}),recovery.identity,recovery.resourceLease),resolution=receipt.phase==='terminal'&&receipt.checkpoint?'committed':receipt.phase==='terminal'&&receipt.persistenceErrorCode==='turn-checkpoint-aborted'?'aborted':'pending';await this.journal.advanceRecovery(scope,resolution);this.emit({route:'turn.operation',metric:'checkpoint_result',stage:'checkpoint',reasonCategory:resolution==='committed'?'checkpoint_committed':resolution==='aborted'?'checkpoint_aborted':'checkpoint_pending',attempt:1,durationMs:null,value:resolution==='committed'?1:0,correlationId:recovery.resourceLease.operationId});return recovery.turn;}
    const release=this.journal.releaseRecovery?.(scope);if(release){if(!this.journal.advanceRelease)throw Error('turn-release-journal-required');const observedAt=Math.max(0,this.clock()),age=Math.max(0,observedAt-release.hold.since),correlationId=release.resourceLease.operationId,holdReason=release.hold.status==='recovery-hold'?'release_recovery_hold':'release_pending',queued=this.journal.queuedBehindRelease?.(scope)??0;this.emit({route:'turn.operation',metric:'release_hold_count',stage:'release',reasonCategory:holdReason,attempt:1,durationMs:null,value:1,correlationId});this.emit({route:'turn.operation',metric:'release_hold_age',stage:'release',reasonCategory:holdReason,attempt:1,durationMs:age,value:1,correlationId});this.emit({route:'turn.operation',metric:'hold_start_attempts',stage:'capacity',reasonCategory:holdReason,attempt:0,durationMs:null,value:0,correlationId});if(queued>0)this.emit({route:'turn.operation',metric:'queued_behind_release',stage:'capacity',reasonCategory:holdReason,attempt:1,durationMs:age,value:queued,correlationId});const receipt=validateReceipt(await this.runtime.observe({...release.identity,capacityLease:release.resourceLease}),release.identity,release.resourceLease);if(receipt.resourceDisposition.status==='active')throw Error('invalid-turn-runtime-receipt');await this.journal.advanceRelease(scope,receipt.resourceDisposition);const released=receipt.resourceDisposition.status==='released';this.emit({route:'turn.operation',metric:'release_result',stage:'release',reasonCategory:released?'release_confirmed':receipt.resourceDisposition.status==='recovery-hold'?'release_recovery_hold':'release_pending',attempt:1,durationMs:null,value:released?1:0,correlationId});if(released)this.emit({route:'turn.operation',metric:'release_confirmation_delay',stage:'release',reasonCategory:'release_confirmed',attempt:1,durationMs:age,value:1,correlationId});if(!released)return release.turn;}
    const initialCleanup=this.journal.pendingInitialBaseCleanup?.(scope);if(initialCleanup){if(!this.capacity||!this.journal.completeInitialBaseCleanup)throw Error('turn-capacity-journal-required');const proof=await this.capacity.releaseNeverStarted({scope,sessionId:initialCleanup.turn.sessionId,turnId:initialCleanup.turn.id,generation:runtimeGeneration,ticketId:initialCleanup.wait.ticketId,operationId:initialCleanup.wait.operationId,leaseId:initialCleanup.wait.leaseId,reasonCode:initialCleanup.wait.reasonCode,observedAt:initialCleanup.turn.finishedAt!});return this.journal.completeInitialBaseCleanup(scope,{turnId:initialCleanup.turn.id,ticketId:initialCleanup.wait.ticketId,operationId:initialCleanup.wait.operationId,leaseId:initialCleanup.wait.leaseId,...proof});}
    const pendingCancel=this.journal.pendingResourceCancellation?.(scope);if(pendingCancel){if(!this.capacity||!this.journal.completeResourceCancellation)throw Error('turn-capacity-journal-required');const proof=await this.capacity.releaseNeverStarted({scope,sessionId:pendingCancel.turn.sessionId,turnId:pendingCancel.turn.id,generation:runtimeGeneration,ticketId:pendingCancel.wait.ticketId,operationId:pendingCancel.wait.operationId,leaseId:null,reasonCode:'turn-cancelled-before-capacity-dispatch',observedAt:pendingCancel.requestedAt});return this.journal.completeResourceCancellation(scope,{turnId:pendingCancel.turn.id,ticketId:pendingCancel.wait.ticketId,operationId:pendingCancel.wait.operationId,...proof});}
    let acquired:Extract<TurnCapacityReceipt,{status:'acquired'}>|null=null;
    let claim:{turn:TurnRecord;replayed:boolean}|null;
    if(this.capacity){
      if(!this.journal.activeTurn||!this.journal.admissionCandidate||!this.journal.beginResourceWait||!this.journal.consumeResourceLeaseAndClaim)throw Error('turn-capacity-journal-required');
      const active=this.journal.activeTurn(scope);
      if(active)claim={turn:active,replayed:true};
      else{
        const candidate=this.journal.admissionCandidate(scope);if(!candidate)return null;
        const operationId=candidate.wait?.operationId??crypto.randomUUID();if(!candidate.wait)await this.journal.beginResourceWait(scope,{turnId:candidate.turn.id,operationId,ticketId:null});
        const response=capacityReceipt(await this.capacity.acquire({scope,sessionId:candidate.turn.sessionId,turnId:candidate.turn.id,generation:runtimeGeneration,ticketId:candidate.wait?.ticketId??null,operationId}));
        if(response.turnId!==candidate.turn.id||response.generation!==runtimeGeneration)throw Error('turn-capacity-receipt-scope-denied');
        turnId(response.ticketId);turnId(response.operationId);
        if(response.status==='waiting'){
          turnId(response.reasonCode);positive(response.since);positive(response.nextAttemptAt);if(response.nextAttemptAt<response.since)throw Error('invalid-turn-capacity-receipt');
          await this.journal.beginResourceWait(scope,response);this.emit({route:'turn.operation',metric:'capacity_wait_count',stage:'capacity',reasonCategory:'capacity_wait',attempt:1,durationMs:Math.max(0,this.clock()-response.since),value:1,correlationId:response.operationId});return null;
        }
        turnId(response.leaseId);acquired=response;claim=await this.journal.consumeResourceLeaseAndClaim(scope,runtimeGeneration,response);
      }
    }else claim=await this.journal.claim(scope,runtimeGeneration);
    if(!claim)return null;
    const turn=claim.turn;
    // A verified initial-source failure terminates before native dispatch.
    // It has no execution identity or fabricated persistence receipt.
    if(turn.status==='failed'&&turn.dispatchId===null){
      if(turn.errorCode!=='turn-initial-base-unavailable'||turn.executionOutcome!=='failed'||turn.runtimeGeneration!==null||turn.base!==null||turn.startedAt!==null||turn.startedSequence!==null||turn.persistenceOutcome!==null||turn.persistenceErrorCode!==null||turn.checkpoint!==null||turn.finishedAt===null||turn.terminalSequence===null)throw Error('invalid-turn-predispatch-failure');
      if(acquired){const cleanup=this.journal.pendingInitialBaseCleanup?.(scope);if(!cleanup||!this.journal.completeInitialBaseCleanup)throw Error('turn-capacity-journal-required');const proof=await this.capacity!.releaseNeverStarted({scope,sessionId:turn.sessionId,turnId:turn.id,generation:runtimeGeneration,ticketId:cleanup.wait.ticketId,operationId:cleanup.wait.operationId,leaseId:cleanup.wait.leaseId,reasonCode:cleanup.wait.reasonCode,observedAt:turn.finishedAt});return this.journal.completeInitialBaseCleanup(scope,{turnId:turn.id,ticketId:cleanup.wait.ticketId,operationId:cleanup.wait.operationId,leaseId:cleanup.wait.leaseId,...proof});}return turn;
    }
    const expected={scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId!,generation:runtimeGeneration};
    if(turn.base===null||turn.resourceLease===null)throw Error('turn-runtime-base-missing');const input={...expected,actor:turn.actor,message:turn.message,base:turnBaseCheckpoints(turn.base),capacityLease:{operationId:turn.resourceLease.operationId,leaseId:turn.resourceLease.leaseId}};
    let receipt:TurnRuntimeReceipt;
    if(claim.replayed){
      if(turn.status==='cancelling'){
        const cancellation=await this.reconcileCancellation(turn,expected,input);if(cancellation.neverStarted){if(!this.journal.completeNeverStartedCancellation)throw Error('turn-capacity-journal-required');return this.journal.completeNeverStartedCancellation(scope,{turnId:turn.id,dispatchId:expected.dispatchId,runtimeGeneration:expected.generation,operationId:turn.resourceLease.operationId,leaseId:turn.resourceLease.leaseId,...cancellation.neverStarted});}receipt=cancellation.receipt;
      }else receipt=validateReceipt(await this.runtime.observe({...expected,capacityLease:turn.resourceLease}),expected,turn.resourceLease);
      if(receipt.phase==='unknown')return turn;
      if(receipt.phase==='absent'){
        receipt=validateReceipt(await this.runtime.accept(input),expected,turn.resourceLease);
      }
    }else receipt=validateReceipt(await this.runtime.accept(input),expected,turn.resourceLease);
    if(receipt.phase==='absent')throw Error('invalid-turn-runtime-receipt');
    return this.apply(turn,receipt);
  }

  async cancel(scope:TurnScope,actor:TurnActor,turn:TurnRecord):Promise<TurnRecord>{
    const fenced=await this.journal.cancelWithDisposition(scope,actor,turn.id),next=fenced.turn;
    if(next.status==='queued'&&next.cancelRequestedAt!==null){const pending=this.journal.pendingResourceCancellation?.(scope);if(!pending||!this.capacity||!this.journal.completeResourceCancellation)throw Error('turn-capacity-journal-required');const proof=await this.capacity.releaseNeverStarted({scope,sessionId:next.sessionId,turnId:next.id,generation:scope.workspaceGeneration,ticketId:pending.wait.ticketId,operationId:pending.wait.operationId,leaseId:null,reasonCode:'turn-cancelled-before-capacity-dispatch',observedAt:pending.requestedAt});return this.journal.completeResourceCancellation(scope,{turnId:next.id,ticketId:pending.wait.ticketId,operationId:pending.wait.operationId,...proof});}
    if(next.status!=='cancelling')return next;
    const expected={scope:next.scope,sessionId:next.sessionId,turnId:next.id,dispatchId:next.dispatchId!,generation:next.runtimeGeneration!};
    // The identity-bound Sandbox durably owns native Stop delivery. Every
    // Workspace replay resends the exact cancel RPC so a crash between the
    // journal commit and the first cross-DO call cannot lose the Stop intent.
    if(!next.resourceLease||next.base===null)throw Error('turn-runtime-base-missing');const input={...expected,actor:next.actor,message:next.message,base:turnBaseCheckpoints(next.base),capacityLease:{operationId:next.resourceLease.operationId,leaseId:next.resourceLease.leaseId}},cancellation=await this.reconcileCancellation(next,expected,input);
    if(cancellation.neverStarted){if(!this.journal.completeNeverStartedCancellation)throw Error('turn-capacity-journal-required');return this.journal.completeNeverStartedCancellation(scope,{turnId:next.id,dispatchId:expected.dispatchId,runtimeGeneration:expected.generation,operationId:next.resourceLease.operationId,leaseId:next.resourceLease.leaseId,...cancellation.neverStarted});}
    const receipt=cancellation.receipt;
    if(receipt.phase==='accepted')throw Error('invalid-turn-runtime-receipt');
    if(receipt.phase==='absent')return next;
    return this.apply(next,receipt);
  }
}
