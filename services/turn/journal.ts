import { TURN_EVENT_BYTES_LIMIT, TURN_EVENT_LIMIT, TURN_EVENT_RECEIPT_LIMIT, actor, checkpointReceipt, initialWorkspaceBase, jsonPayload, message, positive, sameScope, scope, title, turnDigest, turnId,
  type CheckpointReceipt, type InitialWorkspaceBase, type RuntimeEventType, type SessionRecord, type TurnActor, type TurnEvent,
  type TurnEventType, type TurnJournalState, type TurnJournalView, type TurnRecord, type TurnScope } from './protocol.ts';
import type { AtomicTurnStore } from './store.ts';
import type { TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import { toolArtifactReference, type ToolArtifactReferenceInput } from '../artifacts/protocol.ts';
import {validateObserverCommand,type ObserverCommand} from '../preview/observer-protocol.ts';

const terminal=(status:TurnRecord['status'])=>['completed','failed','cancelled','interrupted'].includes(status);
const intent=(userId:string,key:string)=>`${userId}|${turnId(key)}`;
const nowValid=(value:number)=>positive(value);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Runtime receipts only prevent a still-active Runtime from appending the
 * same event twice. Once a Turn is terminal, appendRuntime rejects every new
 * event by status, so retaining that Turn's receipts cannot add safety and
 * would make the workspace-wide receipt bound grow forever. */
function pruneTerminalEventReceipts(state:TurnJournalState){
  for(const [eventId,receipt] of Object.entries(state.eventReceipts)){const turn=state.turns[receipt.event.turnId];if(turn&&terminal(turn.status))delete state.eventReceipts[eventId];}
}
function fresh(s:TurnScope):TurnJournalState{return {schemaVersion:4,scope:s,nextSequence:1,oldestSequence:1,retentionBytes:0,activeTurnId:null,workspaceHead:null,recoveryHold:null,sessions:{},turns:{},sessionIntents:{},turnIntents:{},eventReceipts:{},events:[]};}
export function retainEventWindow(events:TurnEvent[],maxCount=TURN_EVENT_LIMIT,maxBytes=TURN_EVENT_BYTES_LIMIT){
  if(!Number.isSafeInteger(maxCount)||maxCount<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('invalid-event-retention');
  let bytes=0,start=events.length;
  for(let i=events.length-1;i>=0&&events.length-i<=maxCount;i--){const size=new TextEncoder().encode(JSON.stringify(events[i])).byteLength;if(size>maxBytes||bytes+size>maxBytes)break;bytes+=size;start=i;}
  return {events:events.slice(start),oldestSequence:events[start]?.sequence??((events.at(-1)?.sequence??0)+1),retentionBytes:bytes};
}
function event(state:TurnJournalState,turn:TurnRecord,type:TurnEventType,at:number,payload:Record<string,unknown>,eventId:string=crypto.randomUUID()):TurnEvent{
  turnId(eventId);const size=new TextEncoder().encode(JSON.stringify({sequence:state.nextSequence,eventId,turnId:turn.id,workspaceId:state.scope.workspaceId,runtimeGeneration:turn.runtimeGeneration??state.scope.workspaceGeneration,type,at,payload})).byteLength;if(size>TURN_EVENT_BYTES_LIMIT)throw Error('turn-event-too-large');
  const row={sequence:state.nextSequence++,eventId,turnId:turn.id,workspaceId:state.scope.workspaceId,runtimeGeneration:turn.runtimeGeneration??state.scope.workspaceGeneration,type,at,payload};
  state.events.push(row);state.retentionBytes+=size;
  if(state.events.length>TURN_EVENT_LIMIT||state.retentionBytes>TURN_EVENT_BYTES_LIMIT){const retained=retainEventWindow(state.events);state.events=retained.events;state.oldestSequence=retained.oldestSequence;state.retentionBytes=retained.retentionBytes;}
  return row;
}
function requireState(current:TurnJournalState|null,s:TurnScope):TurnJournalState{
  if(!current)return fresh(s);if(!sameScope(current.scope,s))throw Error('turn-workspace-scope-conflict');return current;
}
function sessionOf(state:TurnJournalState,id:string,expected:TurnScope):SessionRecord{
  const found=state.sessions[turnId(id)];if(!found||!sameScope(found.scope,expected))throw Error('turn-session-not-found');return found;
}
function owned(turn:TurnRecord,a:TurnActor){if(turn.actor.userId!==a.userId||turn.actor.authVersion!==a.authVersion)throw Error('turn-not-found');}

export class TurnJournal{
  #store:AtomicTurnStore;#clock:()=>number;
  #initial:((scope:TurnScope)=>Promise<InitialWorkspaceBase>)|undefined;
  #claimTail:Promise<unknown>=Promise.resolve();
  constructor(store:AtomicTurnStore,clock=Date.now,initial?:(scope:TurnScope)=>Promise<InitialWorkspaceBase>){this.#store=store;this.#clock=clock;this.#initial=initial;}
  #frozenInitial(state:TurnJournalState):InitialWorkspaceBase|undefined{
    return Object.values(state.turns).filter(row=>row.base?.initial).sort((a,b)=>a.startedSequence!-b.startedSequence!)[0]?.base?.initial;
  }
  async createSession(rawScope:TurnScope,rawActor:TurnActor,key:string,input:{title:unknown}){
    const s=scope(rawScope),a=actor(rawActor),normalized={title:title(input?.title)},payloadSha256=await turnDigest(normalized),id=crypto.randomUUID(),at=nowValid(this.#clock()),ik=intent(a.userId,key);
    return this.#store.transact(current=>{const state=requireState(current,s),prior=state.sessionIntents[ik];
      if(prior){const session=state.sessions[prior.sessionId];if(!session||session.actorAuthVersion!==a.authVersion)throw Error('turn-session-not-found');if(prior.payloadSha256!==payloadSha256)throw Error('turn-idempotency-conflict');return {state,value:{session,replayed:true}};}
      const session:SessionRecord={id,scope:s,actorUserId:a.userId,actorAuthVersion:a.authVersion,title:normalized.title,createdAt:at,updatedAt:at,head:null};state.sessions[id]=session;state.sessionIntents[ik]={payloadSha256,sessionId:id};return {state,value:{session,replayed:false}};});
  }
  async submit(rawScope:TurnScope,rawActor:TurnActor,sessionId:string,key:string,input:{message:unknown}){
    const s=scope(rawScope),a=actor(rawActor),sid=turnId(sessionId),normalized={message:message(input?.message)},payloadSha256=await turnDigest(normalized),id=crypto.randomUUID(),at=nowValid(this.#clock()),ik=`${intent(a.userId,key)}|${sid}`;
    return this.#store.transact(current=>{const state=requireState(current,s);if(state.recoveryHold)throw Error('workspace-recovery-hold');const session=sessionOf(state,sid,s);if(session.actorUserId!==a.userId||session.actorAuthVersion!==a.authVersion)throw Error('turn-session-not-found');
      const prior=state.turnIntents[ik];if(prior){if(prior.payloadSha256!==payloadSha256)throw Error('turn-idempotency-conflict');return {state,value:{turn:state.turns[prior.turnId]!,replayed:true}};}
      const turn:TurnRecord={id,sessionId:session.id,scope:s,actor:a,requestKey:key,payloadSha256,message:normalized.message,status:'queued',createdAt:at,updatedAt:at,startedAt:null,finishedAt:null,startedSequence:null,terminalSequence:null,dispatchId:null,runtimeGeneration:null,cancelRequestedAt:null,base:null,executionOutcome:null,errorCode:null,persistenceOutcome:null,persistenceErrorCode:null,checkpoint:null};
      state.turns[id]=turn;state.turnIntents[ik]={payloadSha256,turnId:id};event(state,turn,'turn.queued',at,{});return {state,value:{turn,replayed:false}};});
  }
  async claim(rawScope:TurnScope,runtimeGeneration:number){
    const result=this.#claimTail.then(()=>this.#claim(rawScope,runtimeGeneration));
    this.#claimTail=result.catch(()=>{});return result;
  }
  async #claim(rawScope:TurnScope,runtimeGeneration:number){
    const s=scope(rawScope),generation=positive(runtimeGeneration);if(generation!==s.workspaceGeneration)throw Error('turn-runtime-generation-conflict');
    // Resolve outside the synchronous SQLite transaction; the transaction
    // below rechecks authoritative heads before freezing a source into a Turn.
    const before=requireState(this.#store.read(),s);
    let prepared:InitialWorkspaceBase|undefined,initialUnavailable=false;
    if(!before.activeTurnId&&!before.workspaceHead&&Object.values(before.turns).some(row=>row.status==='queued')){
      prepared=this.#frozenInitial(before);
      if(!prepared&&this.#initial){try{prepared=initialWorkspaceBase(await this.#initial(s));}catch(error){if(!(error instanceof Error)||error.message!=='turn-initial-base-unavailable')throw error;initialUnavailable=true;}}
      if(prepared&&!sameScope(prepared.reference.scope,s))throw Error('initial-workspace-scope-denied');
    }
    return this.#store.transact(current=>{const state=requireState(current,s);pruneTerminalEventReceipts(state);if(state.recoveryHold)return {state,value:null};
      if(state.activeTurnId){const active=state.turns[state.activeTurnId];if(!active||terminal(active.status))throw Error('invalid-persisted-turn-journal');return {state,value:{turn:active,replayed:true}};}
      const next=Object.values(state.turns).filter(turn=>turn.status==='queued').sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id))[0];if(!next)return {state,value:null};
      const at=nowValid(this.#clock());
      const initial=state.workspaceHead?undefined:this.#frozenInitial(state)??prepared;
      if(initialUnavailable&&!state.workspaceHead&&!initial){
        next.status='failed';next.executionOutcome='failed';next.errorCode='turn-initial-base-unavailable';next.updatedAt=at;next.finishedAt=at;
        next.terminalSequence=event(state,next,'turn.failed',at,{queued:true,stage:'initial-workspace',saved:false,errorCode:next.errorCode}).sequence;
        return {state,value:{turn:next,replayed:false}};
      }
      next.status='running';next.startedAt=at;next.updatedAt=at;next.dispatchId=crypto.randomUUID();next.runtimeGeneration=generation;
      if(initial&&!sameScope(initial.reference.scope,s))throw Error('initial-workspace-scope-denied');
      next.base=structuredClone({workspace:state.workspaceHead,session:state.sessions[next.sessionId]!.head,...(initial?{initial}: {})});
      state.activeTurnId=next.id;next.startedSequence=event(state,next,'turn.started',at,{}).sequence;return {state,value:{turn:next,replayed:false}};});
  }
  async appendRuntime(rawScope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;eventId:string;type:RuntimeEventType;at:number;payload:unknown}){
    const s=scope(rawScope),tid=turnId(input.turnId),dispatchId=turnId(input.dispatchId),generation=positive(input.runtimeGeneration),eid=turnId(input.eventId),at=nowValid(input.at),observedAt=nowValid(this.#clock()),payload=jsonPayload(input.payload);
    if(!['assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status'].includes(input.type))throw Error('invalid-runtime-event-type');
    const payloadSha256=await turnDigest({tid,dispatchId,generation,type:input.type,at,payload});
    return this.#store.transact(current=>{const state=requireState(current,s),turn=state.turns[tid];if(!turn||turn.dispatchId!==dispatchId||turn.runtimeGeneration!==generation)throw Error('turn-runtime-scope-denied');
      const prior=state.eventReceipts[eid];if(prior){if(prior.payloadSha256!==payloadSha256)throw Error('turn-event-conflict');return {state,value:{event:structuredClone(prior.event),replayed:true}};}if(!['running','cancelling'].includes(turn.status))throw Error('turn-runtime-scope-denied');if(!turn.startedAt||at<turn.startedAt||at>observedAt)throw Error('invalid-runtime-event-time');
      if(Object.keys(state.eventReceipts).length>=TURN_EVENT_RECEIPT_LIMIT)throw Error('turn-event-receipt-archive-required');const row=event(state,turn,input.type,at,payload,eid);state.eventReceipts[eid]={payloadSha256,sequence:row.sequence,event:structuredClone(row)};turn.updatedAt=Math.max(turn.updatedAt,at);return {state,value:{event:row,replayed:false}};});
  }
  async cancelWithDisposition(rawScope:TurnScope,rawActor:TurnActor,id:string){
    const s=scope(rawScope),a=actor(rawActor),tid=turnId(id),at=nowValid(this.#clock());
    return this.#store.transact(current=>{const state=requireState(current,s),turn=state.turns[tid];if(!turn)throw Error('turn-not-found');owned(turn,a);if(terminal(turn.status)||turn.status==='checkpointing')return {state,value:{turn,cancelRequested:false}};
      let cancelRequested=false;
      if(turn.status==='queued'){turn.status='cancelled';turn.executionOutcome='cancelled';turn.finishedAt=at;turn.updatedAt=at;turn.cancelRequestedAt=at;turn.terminalSequence=event(state,turn,'turn.cancelled',at,{queued:true}).sequence;}
      else if(turn.status==='running'){turn.status='cancelling';turn.cancelRequestedAt=at;turn.updatedAt=at;event(state,turn,'turn.cancel_requested',at,{});cancelRequested=true;}
      return {state,value:{turn,cancelRequested}};});
  }
  async cancel(rawScope:TurnScope,rawActor:TurnActor,id:string){return (await this.cancelWithDisposition(rawScope,rawActor,id)).turn;}
  async beginCheckpoint(rawScope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;outcome:'completed'|'failed'|'cancelled'|'interrupted';errorCode?:string|null}){
    const s=scope(rawScope),tid=turnId(input.turnId),dispatchId=turnId(input.dispatchId),generation=positive(input.runtimeGeneration),at=nowValid(this.#clock());
    if(input.outcome==='completed'&&input.errorCode)throw Error('invalid-turn-outcome');if(input.errorCode!=null)turnId(input.errorCode);
    return this.#store.transact(current=>{const state=requireState(current,s),turn=state.turns[tid];if(!turn||turn.dispatchId!==dispatchId||turn.runtimeGeneration!==generation)throw Error('turn-runtime-scope-denied');
      if(turn.status==='checkpointing'){
        if(turn.executionOutcome!==input.outcome||turn.errorCode!==(input.errorCode??null))throw Error('turn-outcome-conflict');
        return {state,value:turn};
      }
      if(!['running','cancelling'].includes(turn.status))throw Error('turn-runtime-scope-denied');
      const cancellationDisposition=turn.status==='cancelling'&&!['cancelled','interrupted'].includes(input.outcome)?'already-terminal':null;
      turn.status='checkpointing';turn.executionOutcome=input.outcome;turn.errorCode=input.errorCode??null;turn.persistenceOutcome=null;turn.persistenceErrorCode=null;turn.updatedAt=at;event(state,turn,'turn.checkpointing',at,{executionOutcome:input.outcome,errorCode:turn.errorCode,...(cancellationDisposition?{cancellationDisposition}:{})});return {state,value:turn};});
  }
  async commitCheckpoint(rawScope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;checkpoint:CheckpointReceipt}){
    const s=scope(rawScope),tid=turnId(input.turnId),dispatchId=turnId(input.dispatchId),generation=positive(input.runtimeGeneration),at=nowValid(this.#clock()),c=input.checkpoint;
    const checkpoint=checkpointReceipt(c);
    if(checkpoint.committedAt>at)throw Error('invalid-checkpoint-receipt');
    return this.#store.transact(current=>{const state=requireState(current,s),turn=state.turns[tid];if(!turn||turn.dispatchId!==dispatchId||turn.runtimeGeneration!==generation||!turn.executionOutcome)throw Error('turn-runtime-scope-denied');
      if(terminal(turn.status)){
        if(turn.persistenceOutcome==='saved'&&turn.checkpoint&&equal(turn.checkpoint,checkpoint)){pruneTerminalEventReceipts(state);return {state,value:turn};}
        throw Error('turn-checkpoint-conflict');
      }
      if(turn.status!=='checkpointing')throw Error('turn-runtime-scope-denied');
      const lastExecutionAt=state.events.filter(row=>row.turnId===turn.id&&!row.type.startsWith('turn.')).reduce((latest,row)=>Math.max(latest,row.at),turn.startedAt!);
      // ProductTurnRuntime materializes R2 before WorkspaceAgent records its
      // checkpointing intent, so its committedAt can legitimately precede the
      // local checkpointing event. It may not precede execution evidence.
      if(checkpoint.committedAt<lastExecutionAt)throw Error('invalid-checkpoint-receipt');if(turn.checkpoint&&!equal(turn.checkpoint,checkpoint))throw Error('turn-checkpoint-conflict');turn.checkpoint=checkpoint;turn.persistenceOutcome='saved';turn.persistenceErrorCode=null;turn.status=turn.executionOutcome;turn.finishedAt=at;turn.updatedAt=at;state.workspaceHead=structuredClone(checkpoint);const session=state.sessions[turn.sessionId]!;session.head=structuredClone(checkpoint);session.updatedAt=at;state.activeTurnId=null;
      const type=`turn.${turn.status}` as TurnEventType;turn.terminalSequence=event(state,turn,type,at,{revisionId:checkpoint.revisionId,saved:true,errorCode:turn.errorCode}).sequence;pruneTerminalEventReceipts(state);return {state,value:turn};});
  }
  async failCheckpoint(rawScope:TurnScope,input:{turnId:string;dispatchId:string;runtimeGeneration:number;errorCode:string}){
    const s=scope(rawScope),tid=turnId(input.turnId),dispatchId=turnId(input.dispatchId),generation=positive(input.runtimeGeneration),errorCode=turnId(input.errorCode),at=nowValid(this.#clock());
    return this.#store.transact(current=>{const state=requireState(current,s),turn=state.turns[tid];if(!turn||turn.dispatchId!==dispatchId||turn.runtimeGeneration!==generation||!turn.executionOutcome)throw Error('turn-runtime-scope-denied');
      if(terminal(turn.status)){
        if(turn.persistenceOutcome==='failed'&&turn.persistenceErrorCode===errorCode){pruneTerminalEventReceipts(state);return {state,value:turn};}
        throw Error('turn-checkpoint-conflict');
      }
      if(turn.status!=='checkpointing')throw Error('turn-runtime-scope-denied');
      turn.persistenceOutcome='failed';turn.persistenceErrorCode=errorCode;turn.status='failed';turn.finishedAt=at;turn.updatedAt=at;state.activeTurnId=null;if(errorCode==='turn-checkpoint-recovery-hold')state.recoveryHold={status:'reconciling',reasonCode:errorCode,since:at,nextAttemptAt:at+60_000,turnId:turn.id,dispatchId,runtimeGeneration:generation};
      turn.terminalSequence=event(state,turn,'turn.failed',at,{saved:false,executionOutcome:turn.executionOutcome,persistenceErrorCode:errorCode}).sequence;pruneTerminalEventReceipts(state);return {state,value:turn};
    });
  }
  async replay(rawScope:TurnScope,afterSequence=0,limit=200){const s=scope(rawScope);if(!Number.isSafeInteger(afterSequence)||afterSequence<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('invalid-event-cursor');
    const state=requireState(this.#store.read(),s);if(afterSequence>=state.nextSequence)throw Error('invalid-event-cursor');const gap=afterSequence<state.oldestSequence-1;if(gap)return {events:[],nextSequence:state.nextSequence,hasMore:false,oldestSequence:state.oldestSequence,snapshotRequired:true};const events=state.events.filter(row=>row.sequence>afterSequence).slice(0,limit);return {events,nextSequence:events.at(-1)?.sequence??afterSequence,hasMore:state.events.some(row=>row.sequence>(events.at(-1)?.sequence??afterSequence)),oldestSequence:state.oldestSequence,snapshotRequired:false};}
  async compact(rawScope:TurnScope,maxCount=TURN_EVENT_LIMIT,maxBytes=TURN_EVENT_BYTES_LIMIT){const s=scope(rawScope);return this.#store.transact(current=>{const state=requireState(current,s);pruneTerminalEventReceipts(state);const retained=retainEventWindow(state.events,maxCount,maxBytes);state.events=retained.events;state.oldestSequence=retained.oldestSequence;state.retentionBytes=retained.retentionBytes;return {state,value:{oldestSequence:state.oldestSequence,retentionBytes:state.retentionBytes,removed:state.nextSequence-1-state.events.length}};});}
  async snapshot(rawScope:TurnScope){const s=scope(rawScope);return requireState(this.#store.read(),s);}
  recovery(rawScope:TurnScope){const s=scope(rawScope),state=requireState(this.#store.read(),s);if(!state.recoveryHold)return null;const turn=state.turns[state.recoveryHold.turnId];if(!turn||!turn.dispatchId||turn.runtimeGeneration===null)throw Error('invalid-persisted-turn-journal');return {hold:structuredClone(state.recoveryHold),turn:structuredClone(turn),identity:{scope:s,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration}};}
  async advanceRecovery(rawScope:TurnScope,resolution:'committed'|'aborted'|'pending'){const s=scope(rawScope),next=nowValid(this.#clock())+60_000;return this.#store.transact(current=>{const state=requireState(current,s),hold=state.recoveryHold;if(!hold)return {state,value:null};if(resolution==='pending'){hold.nextAttemptAt=Math.max(hold.nextAttemptAt,next);return {state,value:structuredClone(hold)};}state.recoveryHold=null;return {state,value:null};});}
  /** Local current-call anchor. Runtime lease, plugin, Catalog and Preview
   * authority are checked separately; this does not mint a browser grant. */
  observerCaller(raw:ObserverCommand):{actor:TurnActor;identity:TurnRuntimeIdentity}{
    const command=validateObserverCommand(raw,this.#clock()),state=requireState(this.#store.read(),command.scope);
    const turn=state.turns[command.turnId],session=state.sessions[command.sessionId];
    if(state.activeTurnId!==command.turnId||!turn||!session||turn.status!=='running'||turn.cancelRequestedAt!==null||turn.finishedAt!==null||
      turn.sessionId!==command.sessionId||turn.dispatchId!==command.dispatchId||turn.runtimeGeneration!==command.scope.workspaceGeneration||
      !sameScope(session.scope,command.scope)||session.actorUserId!==turn.actor.userId||session.actorAuthVersion!==turn.actor.authVersion)throw Error('observer-turn-denied');
    return {actor:actor(turn.actor),identity:{scope:scope(command.scope),sessionId:command.sessionId,turnId:command.turnId,dispatchId:command.dispatchId,generation:turn.runtimeGeneration}};
  }
  /** Resolve a historical turn's runtime identity for Workspace ACL checks.
   * This deliberately does not require a live lease or compare the caller's
   * current auth version with the historical turn. */
  observerHistoryIdentity(rawScope:TurnScope,rawActor:TurnActor,rawTurnId:string):TurnRuntimeIdentity{
    const s=scope(rawScope),a=actor(rawActor),tid=turnId(rawTurnId),state=requireState(this.#store.read(),s),turn=state.turns[tid];
    if(!turn||turn.id!==tid||!sameScope(turn.scope,s)||!turn.dispatchId||turn.runtimeGeneration!==s.workspaceGeneration||turn.actor.userId!==a.userId)throw Error('observer-turn-denied');
    const session=state.sessions[turn.sessionId];
    if(!session||!sameScope(session.scope,s)||session.id!==turn.sessionId||session.actorUserId!==a.userId||session.actorAuthVersion!==turn.actor.authVersion)throw Error('observer-turn-denied');
    return {scope:s,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration};
  }
  /** Read-only prerequisite for releasing a journal event reference. This does
   * not authorize object deletion: ledger and saved Session references remain. */
  async artifactEventReleaseEligibility(raw:ToolArtifactReferenceInput):Promise<{eligible:boolean;reason:'turn-active'|'event-retained'|'event-retired'}>{
    const reference=toolArtifactReference(raw);
    if(reference.kind!=='turn_event')throw Error('artifact-event-reference-required');
    const state=requireState(this.#store.read(),reference.scope),turn=state.turns[reference.turnId];
    if(!turn||turn.dispatchId!==reference.dispatchId)throw Error('turn-runtime-scope-denied');
    if(!terminal(turn.status))return {eligible:false,reason:'turn-active'};
    if(state.events.some(item=>item.eventId===reference.referenceId)||Object.hasOwn(state.eventReceipts,reference.referenceId))return {eligible:false,reason:'event-retained'};
    return {eligible:true,reason:'event-retired'};
  }
  /** Synchronous read for a caller's storage transaction that freezes a Run
   * intent with the authoritative saved head. Never performs external I/O. */
  workspaceRevisionSnapshot(rawScope:TurnScope):{identity:TurnRuntimeIdentity;receipt:CheckpointReceipt}|null{const s=scope(rawScope),state=requireState(this.#store.read(),s),receipt=state.workspaceHead;if(!receipt)return null;
    const turn=Object.values(state.turns).filter(row=>row.persistenceOutcome==='saved'&&row.checkpoint&&equal(row.checkpoint,receipt)).sort((a,b)=>(b.terminalSequence??0)-(a.terminalSequence??0))[0];
    if(!turn||!turn.dispatchId||turn.runtimeGeneration!==s.workspaceGeneration)throw Error('invalid-persisted-turn-journal');
    return {identity:{scope:s,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration},receipt:structuredClone(receipt)};
  }
  async workspaceRevision(rawScope:TurnScope){return this.workspaceRevisionSnapshot(rawScope);}
  async view(rawScope:TurnScope):Promise<TurnJournalView>{const state=await this.snapshot(rawScope),turns:TurnJournalView['turns']={};
    for(const [id,turn] of Object.entries(state.turns)){const {requestKey:_,payloadSha256:__,dispatchId:___,base:____,startedSequence:_____,terminalSequence:______,...safe}=turn;turns[id]=safe;}
    const sessions:TurnJournalView['sessions']={};for(const [id,session] of Object.entries(state.sessions)){const {actorUserId:_,actorAuthVersion:__,...safe}=session;sessions[id]=safe;}
    const recoveryHold=state.recoveryHold&&{status:state.recoveryHold.status,reasonCode:state.recoveryHold.reasonCode,since:state.recoveryHold.since,nextAttemptAt:state.recoveryHold.nextAttemptAt};return {schemaVersion:2,scope:state.scope,nextSequence:state.nextSequence,activeTurnId:state.activeTurnId,recoveryHold,sessions,turns};
  }
}
