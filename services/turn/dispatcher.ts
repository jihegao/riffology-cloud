import type { CheckpointReceipt, TurnActor, TurnBaseCheckpoints, TurnRecord, TurnResourceDisposition, TurnScope } from './protocol.ts';
import { checkpointObjectKey, jsonPayload, positive, resourceDisposition, sameScope, scope as validateScope, sha, turnBaseCheckpoints, turnId } from './protocol.ts';
import { toolArtifactReceipt, toolArtifactReferenceReceipt, type ToolArtifactReferenceInput, type ToolArtifactStoreRpc } from '../artifacts/protocol.ts';

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
  observe(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number}):Promise<TurnRuntimeReceipt>;
  cancel(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number}):Promise<TurnRuntimeReceipt>;
}
export interface TurnDispatcherJournal {
  claim(scope:TurnScope,generation:number):Promise<{turn:TurnRecord;replayed:boolean}|null>;
  admissionCandidate?(scope:TurnScope):{turn:TurnRecord;wait:null|{turnId:string;ticketId:string|null;operationId:string;nextAttemptAt:number}}|null;
  activeTurn?(scope:TurnScope):TurnRecord|null;
  beginResourceWait?(scope:TurnScope,input:{turnId:string;ticketId?:string|null;operationId:string;reasonCode?:string;since?:number;nextAttemptAt?:number}):Promise<unknown>;
  consumeResourceLeaseAndClaim?(scope:TurnScope,generation:number,input:{turnId:string;ticketId:string;operationId:string;leaseId:string}):Promise<{turn:TurnRecord;replayed:boolean}|null>;
  appendRuntime(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;eventId:string;type:TurnRuntimeEvent['type'];at:number;payload:unknown}):Promise<unknown>;
  beginCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;outcome:'completed'|'failed'|'cancelled'|'interrupted';errorCode?:string|null}):Promise<TurnRecord>;
  commitCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;checkpoint:CheckpointReceipt;resourceDisposition:TurnResourceDisposition}):Promise<TurnRecord>;
  failCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;errorCode:string;resourceDisposition:TurnResourceDisposition}):Promise<TurnRecord>;
  cancelWithDisposition(scope:TurnScope,actor:TurnActor,id:string):Promise<{turn:TurnRecord;cancelRequested:boolean}>;
  recovery?(scope:TurnScope):{hold:{nextAttemptAt:number};turn:TurnRecord;identity:ExpectedReceipt;resourceLease:{operationId:string;leaseId:string}}|null;
  advanceRecovery?(scope:TurnScope,resolution:'committed'|'aborted'|'pending'):Promise<unknown>;
  releaseRecovery?(scope:TurnScope):{hold:{nextAttemptAt:number};turn:TurnRecord;identity:ExpectedReceipt;resourceLease:{operationId:string;leaseId:string}}|null;
  advanceRelease?(scope:TurnScope,disposition:TurnResourceDisposition):Promise<unknown>;
}
export type TurnArtifactReferencePort=Pick<ToolArtifactStoreRpc,'retain'>;
export type TurnCapacityReceipt=
  | {status:'waiting';turnId:string;generation:number;ticketId:string;operationId:string;reasonCode:string;since:number;nextAttemptAt:number}
  | {status:'acquired';turnId:string;generation:number;ticketId:string;operationId:string;leaseId:string};
export interface TurnCapacityPort{
  acquire(input:{scope:TurnScope;sessionId:string;turnId:string;generation:number;ticketId:string|null;operationId:string|null}):Promise<TurnCapacityReceipt>;
  releaseNeverStarted(input:{scope:TurnScope;sessionId:string;turnId:string;generation:number;ticketId:string;operationId:string;leaseId:string;reasonCode:string;observedAt:number}):Promise<void>;
}

type ExpectedReceipt={scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number};
const EVENT_TYPES=new Set<TurnRuntimeEvent['type']>(['assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status']);
const PHASES=new Set<TurnRuntimeReceipt['phase']>(['accepted','absent','unknown','running','terminal']);
const OUTCOMES=new Set<NonNullable<TurnRuntimeReceipt['outcome']>>(['completed','failed','cancelled','interrupted']);
const RECONCILABLE_PERSISTENCE_ERRORS=new Set(['turn-checkpoint-unknown']);
const NON_PERSISTABLE_EXECUTION_ERRORS=new Set(['turn-base-unavailable','turn-native-execution-absent','turn-native-exit-failed','turn-native-result-missing']);

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
  constructor(journal:TurnDispatcherJournal,runtime:TurnRuntimePort,artifactReferences:TurnArtifactReferencePort|null=null,capacity:TurnCapacityPort|null=null){this.journal=journal;this.runtime=runtime;this.artifactReferences=artifactReferences;this.capacity=capacity;}

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
    for(const item of receipt.events??[]){await this.retainArtifact(scope,turn.id,dispatchId,item);await this.journal.appendRuntime(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,...item});}
    if(receipt.phase!=='terminal')return turn;
    const pending=await this.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,outcome:receipt.outcome!,errorCode:receipt.executionErrorCode??null});
    if(receipt.checkpoint)return this.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,checkpoint:receipt.checkpoint,resourceDisposition:receipt.resourceDisposition});
    if(RECONCILABLE_PERSISTENCE_ERRORS.has(receipt.persistenceErrorCode!)&&!NON_PERSISTABLE_EXECUTION_ERRORS.has(receipt.executionErrorCode!))return pending;
    return this.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,errorCode:receipt.persistenceErrorCode!,resourceDisposition:receipt.resourceDisposition});
  }

  async tick(rawScope:TurnScope,generation:number):Promise<TurnRecord|null>{
    const scope=validateScope(rawScope),runtimeGeneration=positive(generation);
    if(scope.workspaceGeneration!==runtimeGeneration)throw Error('turn-runtime-generation-conflict');
    const recovery=this.journal.recovery?.(scope);if(recovery){if(!this.journal.advanceRecovery)throw Error('turn-recovery-journal-required');const receipt=validateReceipt(await this.runtime.observe(recovery.identity),recovery.identity,recovery.resourceLease);if(receipt.phase==='terminal'&&receipt.checkpoint)await this.journal.advanceRecovery(scope,'committed');else if(receipt.phase==='terminal'&&receipt.persistenceErrorCode==='turn-checkpoint-aborted')await this.journal.advanceRecovery(scope,'aborted');else await this.journal.advanceRecovery(scope,'pending');return recovery.turn;}
    const release=this.journal.releaseRecovery?.(scope);if(release){if(!this.journal.advanceRelease)throw Error('turn-release-journal-required');const receipt=validateReceipt(await this.runtime.observe(release.identity),release.identity,release.resourceLease);if(receipt.resourceDisposition.status==='active')throw Error('invalid-turn-runtime-receipt');await this.journal.advanceRelease(scope,receipt.resourceDisposition);if(receipt.resourceDisposition.status!=='released')return release.turn;}
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
          await this.journal.beginResourceWait(scope,response);return null;
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
      if(acquired)await this.capacity!.releaseNeverStarted({scope,sessionId:turn.sessionId,turnId:turn.id,generation:runtimeGeneration,ticketId:acquired.ticketId,operationId:acquired.operationId,leaseId:acquired.leaseId,reasonCode:turn.errorCode,observedAt:turn.finishedAt});return turn;
    }
    const expected={scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId!,generation:runtimeGeneration};
    if(turn.base===null||turn.resourceLease===null)throw Error('turn-runtime-base-missing');const input={...expected,actor:turn.actor,message:turn.message,base:turnBaseCheckpoints(turn.base),capacityLease:{operationId:turn.resourceLease.operationId,leaseId:turn.resourceLease.leaseId}};
    let receipt:TurnRuntimeReceipt;
    if(claim.replayed){
      receipt=validateReceipt(await this.runtime.observe(expected),expected,turn.resourceLease);
      if(receipt.phase==='unknown')return turn;
      if(receipt.phase==='absent'){
        // A cancelling turn may never be restarted. It remains fenced until
        // observation yields a terminal stop + persistence receipt.
        if(turn.status==='cancelling')return turn;
        receipt=validateReceipt(await this.runtime.accept(input),expected,turn.resourceLease);
      }
    }else receipt=validateReceipt(await this.runtime.accept(input),expected,turn.resourceLease);
    if(receipt.phase==='absent')throw Error('invalid-turn-runtime-receipt');
    return this.apply(turn,receipt);
  }

  async cancel(scope:TurnScope,actor:TurnActor,turn:TurnRecord):Promise<TurnRecord>{
    const fenced=await this.journal.cancelWithDisposition(scope,actor,turn.id),next=fenced.turn;
    if(next.status!=='cancelling')return next;
    const expected={scope:next.scope,sessionId:next.sessionId,turnId:next.id,dispatchId:next.dispatchId!,generation:next.runtimeGeneration!};
    // The first request sends cancel once. Later requests only reconcile the
    // same persisted fence, so a lost response cannot duplicate side effects.
    if(!next.resourceLease)throw Error('turn-runtime-base-missing');const receipt=validateReceipt(await (fenced.cancelRequested?this.runtime.cancel(expected):this.runtime.observe(expected)),expected,next.resourceLease);
    if(receipt.phase==='accepted')throw Error('invalid-turn-runtime-receipt');
    if(receipt.phase==='absent')return next;
    return this.apply(next,receipt);
  }
}
