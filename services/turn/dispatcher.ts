import type { CheckpointReceipt, TurnActor, TurnBaseCheckpoints, TurnRecord, TurnScope } from './protocol.ts';
import { checkpointObjectKey, jsonPayload, positive, sameScope, scope as validateScope, sha, turnBaseCheckpoints, turnId } from './protocol.ts';
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
export type TurnRuntimeReceipt = {
  scope:TurnScope;
  sessionId:string;
  turnId:string;
  dispatchId:string;
  generation:number;
  phase:'accepted'|'absent'|'unknown'|'running'|'terminal';
  outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;
  executionErrorCode?:string|null;
  events?:TurnRuntimeEvent[];
  checkpoint?:CheckpointReceipt|null;
  persistenceErrorCode?:string|null;
  stopped?:TurnStopReceipt|null;
};
export interface TurnRuntimePort {
  accept(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number;actor:TurnActor;message:string;base:TurnBaseCheckpoints}):Promise<TurnRuntimeReceipt>;
  observe(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number}):Promise<TurnRuntimeReceipt>;
  cancel(input:{scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number}):Promise<TurnRuntimeReceipt>;
}
export interface TurnDispatcherJournal {
  claim(scope:TurnScope,generation:number):Promise<{turn:TurnRecord;replayed:boolean}|null>;
  appendRuntime(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;eventId:string;type:TurnRuntimeEvent['type'];at:number;payload:unknown}):Promise<unknown>;
  beginCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;outcome:'completed'|'failed'|'cancelled'|'interrupted';errorCode?:string|null}):Promise<TurnRecord>;
  commitCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;checkpoint:CheckpointReceipt}):Promise<TurnRecord>;
  failCheckpoint(scope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;errorCode:string}):Promise<TurnRecord>;
  cancelWithDisposition(scope:TurnScope,actor:TurnActor,id:string):Promise<{turn:TurnRecord;cancelRequested:boolean}>;
}
export type TurnArtifactReferencePort=Pick<ToolArtifactStoreRpc,'retain'>;

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
function validateReceipt(value:unknown,expected:ExpectedReceipt):TurnRuntimeReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-turn-runtime-receipt');
  const receipt=value as Record<string,unknown>,receiptScope=validateScope(receipt.scope);
  if(!sameScope(receiptScope,expected.scope)||turnId(receipt.sessionId)!==expected.sessionId||turnId(receipt.turnId)!==expected.turnId||turnId(receipt.dispatchId)!==expected.dispatchId||positive(receipt.generation)!==expected.generation)throw Error('turn-runtime-receipt-scope-denied');
  if(typeof receipt.phase!=='string'||!PHASES.has(receipt.phase as TurnRuntimeReceipt['phase']))throw Error('invalid-turn-runtime-receipt');
  const phase=receipt.phase as TurnRuntimeReceipt['phase'];
  const outcome=receipt.outcome==null?null:OUTCOMES.has(receipt.outcome as NonNullable<TurnRuntimeReceipt['outcome']>)?receipt.outcome as NonNullable<TurnRuntimeReceipt['outcome']>:null;
  if(receipt.outcome!=null&&outcome===null)throw Error('invalid-turn-runtime-receipt');
  let events:TurnRuntimeEvent[];
  if(receipt.events==null)events=[];else if(Array.isArray(receipt.events))events=receipt.events.map(runtimeEvent);else throw Error('invalid-turn-runtime-receipt');
  const saved=checkpoint(receipt.checkpoint),saveError=optionalCode(receipt.persistenceErrorCode),executionError=optionalCode(receipt.executionErrorCode),stop=stopped(receipt.stopped);
  if(phase==='terminal'){
    if(!outcome||!stop||(saved===null)===(saveError===null))throw Error('invalid-turn-runtime-receipt');
    if(outcome==='completed'&&executionError!==null)throw Error('invalid-turn-runtime-receipt');
  }else if(outcome!==null||saved!==null||saveError!==null||stop!==null){throw Error('invalid-turn-runtime-receipt');}
  if((phase==='absent'||phase==='unknown')&&events.length)throw Error('invalid-turn-runtime-receipt');
  return {scope:receiptScope,sessionId:expected.sessionId,turnId:expected.turnId,dispatchId:expected.dispatchId,generation:expected.generation,phase,outcome,executionErrorCode:executionError,events,checkpoint:saved,persistenceErrorCode:saveError,stopped:stop};
}

export class TurnDispatcher {
  private readonly journal:TurnDispatcherJournal;
  private readonly runtime:TurnRuntimePort;
  private readonly artifactReferences:TurnArtifactReferencePort|null;
  constructor(journal:TurnDispatcherJournal,runtime:TurnRuntimePort,artifactReferences:TurnArtifactReferencePort|null=null){this.journal=journal;this.runtime=runtime;this.artifactReferences=artifactReferences;}

  private async retainArtifact(scope:TurnScope,turnIdValue:string,dispatchId:string,event:TurnRuntimeEvent):Promise<void>{
    if(event.type!=='tool.completed'||event.payload.artifact==null)return;
    if(event.payload.isError!==false)throw Error('invalid-tool-artifact-completion');
    const artifact=toolArtifactReceipt(event.payload.artifact);
    if(!this.artifactReferences)throw Error('tool-artifact-reference-store-not-configured');
    const reference:ToolArtifactReferenceInput={schemaVersion:1,scope,artifactId:artifact.artifactId,turnId:turnIdValue,dispatchId,kind:'turn_event',referenceId:event.eventId};
    const retained=toolArtifactReferenceReceipt(await this.artifactReferences.retain(reference));
    if(retained.artifactId!==reference.artifactId||retained.kind!==reference.kind||retained.referenceId!==reference.referenceId||retained.releasedAt!==null)throw Error('tool-artifact-reference-receipt-conflict');
  }

  private async apply(turn:TurnRecord,receipt:TurnRuntimeReceipt):Promise<TurnRecord>{
    const dispatchId=turn.dispatchId!,generation=turn.runtimeGeneration!,scope=turn.scope;
    for(const item of receipt.events??[]){await this.retainArtifact(scope,turn.id,dispatchId,item);await this.journal.appendRuntime(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,...item});}
    if(receipt.phase!=='terminal')return turn;
    const pending=await this.journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,outcome:receipt.outcome!,errorCode:receipt.executionErrorCode??null});
    if(receipt.checkpoint)return this.journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,checkpoint:receipt.checkpoint});
    if(RECONCILABLE_PERSISTENCE_ERRORS.has(receipt.persistenceErrorCode!)&&!NON_PERSISTABLE_EXECUTION_ERRORS.has(receipt.executionErrorCode!))return pending;
    return this.journal.failCheckpoint(scope,{turnId:turn.id,dispatchId,runtimeGeneration:generation,errorCode:receipt.persistenceErrorCode!});
  }

  async tick(rawScope:TurnScope,generation:number):Promise<TurnRecord|null>{
    const scope=validateScope(rawScope),runtimeGeneration=positive(generation);
    if(scope.workspaceGeneration!==runtimeGeneration)throw Error('turn-runtime-generation-conflict');
    const claim=await this.journal.claim(scope,runtimeGeneration);
    if(!claim)return null;
    const turn=claim.turn;
    // A verified initial-source failure terminates before native dispatch.
    // It has no execution identity or fabricated persistence receipt.
    if(turn.status==='failed'&&turn.dispatchId===null){
      if(turn.errorCode!=='turn-initial-base-unavailable'||turn.executionOutcome!=='failed'||turn.runtimeGeneration!==null||turn.base!==null||turn.startedAt!==null||turn.startedSequence!==null||turn.persistenceOutcome!==null||turn.persistenceErrorCode!==null||turn.checkpoint!==null||turn.finishedAt===null||turn.terminalSequence===null)throw Error('invalid-turn-predispatch-failure');
      return turn;
    }
    const expected={scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId!,generation:runtimeGeneration};
    if(turn.base===null)throw Error('turn-runtime-base-missing');const input={...expected,actor:turn.actor,message:turn.message,base:turnBaseCheckpoints(turn.base)};
    let receipt:TurnRuntimeReceipt;
    if(claim.replayed){
      receipt=validateReceipt(await this.runtime.observe(expected),expected);
      if(receipt.phase==='unknown')return turn;
      if(receipt.phase==='absent'){
        // A cancelling turn may never be restarted. It remains fenced until
        // observation yields a terminal stop + persistence receipt.
        if(turn.status==='cancelling')return turn;
        receipt=validateReceipt(await this.runtime.accept(input),expected);
      }
    }else receipt=validateReceipt(await this.runtime.accept(input),expected);
    if(receipt.phase==='absent')throw Error('invalid-turn-runtime-receipt');
    return this.apply(turn,receipt);
  }

  async cancel(scope:TurnScope,actor:TurnActor,turn:TurnRecord):Promise<TurnRecord>{
    const fenced=await this.journal.cancelWithDisposition(scope,actor,turn.id),next=fenced.turn;
    if(next.status!=='cancelling')return next;
    const expected={scope:next.scope,sessionId:next.sessionId,turnId:next.id,dispatchId:next.dispatchId!,generation:next.runtimeGeneration!};
    // The first request sends cancel once. Later requests only reconcile the
    // same persisted fence, so a lost response cannot duplicate side effects.
    const receipt=validateReceipt(await (fenced.cancelRequested?this.runtime.cancel(expected):this.runtime.observe(expected)),expected);
    if(receipt.phase==='accepted')throw Error('invalid-turn-runtime-receipt');
    if(receipt.phase==='absent')return next;
    return this.apply(next,receipt);
  }
}
