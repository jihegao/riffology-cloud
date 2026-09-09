import type { CheckpointReceipt, TurnActor, TurnBaseCheckpoints } from '../turn/protocol.ts';
import { TURN_EVENT_LIMIT, actor as validateActor, checkpointObjectKey, jsonPayload, message, positive, sha, turnBaseCheckpoints, turnDigest, turnId } from '../turn/protocol.ts';
import type { TurnRuntimeEvent, TurnRuntimePort, TurnRuntimeReceipt, TurnStopReceipt } from '../turn/dispatcher.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';

export type ProductTurnRuntimeStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>;
export type TurnExecutionObservation={identity:TurnRuntimeIdentity;phase:'absent'|'unknown'|'running'|'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;executionErrorCode?:string|null;events?:TurnRuntimeEvent[];stopped?:TurnStopReceipt|null};
export interface TurnExecutionPort{
  start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}):Promise<TurnExecutionObservation>;
  currentObserverExecution?(identity:TurnRuntimeIdentity):Promise<{expiresAt:number}>;
  observe(identity:TurnRuntimeIdentity):Promise<TurnExecutionObservation>;
  cancel(identity:TurnRuntimeIdentity):Promise<TurnExecutionObservation>;
}
export type TurnCheckpointInput={identity:TurnRuntimeIdentity;outcome:'completed'|'failed'|'cancelled'|'interrupted';executionErrorCode:string|null;base:TurnBaseCheckpoints};
export type TurnCheckpointIntent={operationId:string;inputSha256:string};
export function turnCheckpointOperationId(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return `commit:${identity.scope.tenantId}:${identity.scope.projectId}:${identity.scope.workspaceId}:${identity.generation}:${identity.sessionId}:${identity.turnId}:${identity.dispatchId}`;}
/** Materializes immutable checkpoint objects and returns their verified
 * receipt. The Workspace TurnJournal remains the authoritative product commit
 * and must durably record this receipt before a Turn is reported as saved. */
export interface TurnCheckpointPort{
  prepare(input:TurnCheckpointInput):Promise<TurnCheckpointIntent>;
  commit(input:TurnCheckpointInput,intent:TurnCheckpointIntent):Promise<CheckpointReceipt>;
  reconcile(identity:TurnRuntimeIdentity,intent:TurnCheckpointIntent):Promise<CheckpointReceipt|null>;
}
type State={schemaVersion:2|3;executionDeadlineAt?:number;identity:TurnRuntimeIdentity;base:TurnBaseCheckpoints;messageSha256:string;message:string|null;phase:'running'|'unknown'|'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;executionErrorCode:string|null;acceptReserved:true;executionReserved:true;cancelRequestedAt:number|null;startedAt:number;settledAt:number|null;events:TurnRuntimeEvent[];checkpointIntent:TurnCheckpointIntent|null;checkpointCommitReserved:boolean;legacyCheckpointUnknown:boolean;checkpoint:CheckpointReceipt|null;persistenceErrorCode:string|null;stopped:TurnStopReceipt|null};
type Row=Record<string,SqlStorageValue>;
const EVENT_TYPES=new Set<TurnRuntimeEvent['type']>(['assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status']);
const OUTCOMES=new Set<NonNullable<State['outcome']>>(['completed','failed','cancelled','interrupted']);
// These failures prove that no valid input state exists to freeze. Attempting
// checkpoint preparation would allocate fresh Sandboxes and could turn an
// input-integrity failure into new project-side effects.
const NON_PERSISTABLE_EXECUTION_ERRORS=new Set(['turn-base-unavailable','turn-native-execution-absent']);
const MAX_RUNTIME_EVENT_BYTES=2*1024*1024,encoder=new TextEncoder();
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
function optionalCode(value:unknown):string|null{return value===null?null:turnId(value);}
function stop(value:unknown):TurnStopReceipt|null{if(value===null)return null;exact(value,['confirmationId','observedAt','nativeRunning','fenced'],'invalid-product-turn-runtime-state');if(value.nativeRunning!==false||value.fenced!==true)reject('invalid-product-turn-runtime-state');return {confirmationId:turnId(value.confirmationId),observedAt:positive(value.observedAt),nativeRunning:false,fenced:true};}
function event(value:unknown):TurnRuntimeEvent{exact(value,['eventId','type','at','payload'],'invalid-product-turn-runtime-event');if(typeof value.type!=='string'||!EVENT_TYPES.has(value.type as TurnRuntimeEvent['type']))reject('invalid-product-turn-runtime-event');return {eventId:turnId(value.eventId),type:value.type as TurnRuntimeEvent['type'],at:positive(value.at),payload:jsonPayload(value.payload)};}
function boundedEvents(events:TurnRuntimeEvent[]):TurnRuntimeEvent[]{if(events.length>TURN_EVENT_LIMIT||encoder.encode(JSON.stringify(events)).byteLength>MAX_RUNTIME_EVENT_BYTES)reject('product-turn-runtime-event-limit');return events;}
function checkpoint(value:unknown,settledAt:number|null):CheckpointReceipt|null{if(value===null)return null;exact(value,['revisionId','objectKey','filesSha256','sessionSha256','committedAt'],'invalid-product-turn-checkpoint');const receipt={revisionId:turnId(value.revisionId),objectKey:checkpointObjectKey(value.objectKey),filesSha256:sha(value.filesSha256),sessionSha256:sha(value.sessionSha256),committedAt:positive(value.committedAt)};if(settledAt!==null&&receipt.committedAt<settledAt)reject('invalid-product-turn-checkpoint');return receipt;}
function intent(value:unknown,identity:TurnRuntimeIdentity):TurnCheckpointIntent|null{if(value===null)return null;exact(value,['operationId','inputSha256'],'invalid-product-turn-runtime-state');if(value.operationId!==turnCheckpointOperationId(identity))reject('invalid-product-turn-runtime-state');return {operationId:value.operationId,inputSha256:sha(value.inputSha256)};}
function migrateStored(value:unknown):unknown{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||(value as Record<string,unknown>).schemaVersion!==1)return value;
  const legacy=structuredClone(value) as Record<string,unknown>;exact(legacy,['schemaVersion','identity','base','messageSha256','message','phase','outcome','executionErrorCode','acceptReserved','executionReserved','cancelRequestedAt','startedAt','settledAt','events','checkpointReserved','checkpoint','persistenceErrorCode','stopped'],'invalid-product-turn-runtime-state');
  if(typeof legacy.checkpointReserved!=='boolean')reject('invalid-product-turn-runtime-state');const reserved=legacy.checkpointReserved,hasCheckpoint=legacy.checkpoint!==null;delete legacy.checkpointReserved;legacy.schemaVersion=2;legacy.checkpointIntent=null;legacy.checkpointCommitReserved=reserved;legacy.legacyCheckpointUnknown=reserved&&!hasCheckpoint;return legacy;
}
function stored(value:unknown):State{
  try{
    value=migrateStored(value);const version=(value as Record<string,unknown>)?.schemaVersion;exact(value,[...(version===3?['executionDeadlineAt']:[]),'schemaVersion','identity','base','messageSha256','message','phase','outcome','executionErrorCode','acceptReserved','executionReserved','cancelRequestedAt','startedAt','settledAt','events','checkpointIntent','checkpointCommitReserved','legacyCheckpointUnknown','checkpoint','persistenceErrorCode','stopped'],'invalid-product-turn-runtime-state');
    if((value.schemaVersion!==2&&value.schemaVersion!==3)||value.acceptReserved!==true||value.executionReserved!==true||!['running','unknown','terminal'].includes(value.phase as string)||typeof value.checkpointCommitReserved!=='boolean'||typeof value.legacyCheckpointUnknown!=='boolean')reject('invalid-product-turn-runtime-state');
    const identity=turnRuntimeIdentity(value.identity),base=turnBaseCheckpoints(value.base),messageSha256=sha(value.messageSha256),startedAt=positive(value.startedAt),settledAt=value.settledAt===null?null:positive(value.settledAt),cancelRequestedAt=value.cancelRequestedAt===null?null:positive(value.cancelRequestedAt);
    const executionDeadlineAt=value.schemaVersion===3?positive(value.executionDeadlineAt):undefined;if(executionDeadlineAt!==undefined&&executionDeadlineAt!==startedAt+600000)reject('invalid-product-turn-runtime-state');
    if(value.message!==null)message(value.message);if(!Array.isArray(value.events))reject('invalid-product-turn-runtime-state');const events=boundedEvents(value.events.map(event)),ids=new Set(events.map(item=>item.eventId));if(ids.size!==events.length)reject('invalid-product-turn-runtime-state');
    const outcome=value.outcome===null?null:OUTCOMES.has(value.outcome as NonNullable<State['outcome']>)?value.outcome as NonNullable<State['outcome']>:reject('invalid-product-turn-runtime-state'),executionErrorCode=optionalCode(value.executionErrorCode),persistenceErrorCode=optionalCode(value.persistenceErrorCode),stopped=stop(value.stopped),saved=checkpoint(value.checkpoint,settledAt),checkpointIntent=intent(value.checkpointIntent,identity),checkpointCommitReserved=value.checkpointCommitReserved as boolean,legacyCheckpointUnknown=value.legacyCheckpointUnknown as boolean;
    if(value.phase==='terminal'){
      if(!outcome||settledAt===null||!stopped||value.message!==null||(saved!==null&&persistenceErrorCode!==null))reject('invalid-product-turn-runtime-state');
      if(outcome==='completed'&&executionErrorCode!==null)reject('invalid-product-turn-runtime-state');
    }else if(outcome!==null||settledAt!==null||stopped!==null||saved!==null||persistenceErrorCode!==null||checkpointIntent!==null||checkpointCommitReserved||legacyCheckpointUnknown)reject('invalid-product-turn-runtime-state');
    if(legacyCheckpointUnknown&&(!checkpointCommitReserved||checkpointIntent!==null||saved!==null))reject('invalid-product-turn-runtime-state');if(checkpointCommitReserved&&checkpointIntent===null&&!legacyCheckpointUnknown&&saved===null)reject('invalid-product-turn-runtime-state');
    return {schemaVersion:value.schemaVersion as 2|3,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt}),identity,base,messageSha256,message:value.message as string|null,phase:value.phase as State['phase'],outcome,executionErrorCode,acceptReserved:true,executionReserved:true,cancelRequestedAt,startedAt,settledAt,events,checkpointIntent,checkpointCommitReserved,legacyCheckpointUnknown,checkpoint:saved,persistenceErrorCode,stopped};
  }catch{reject('invalid-persisted-product-turn-runtime');}
}
function execution(value:unknown,expected:TurnRuntimeIdentity):TurnExecutionObservation{
  exact(value,['identity','phase','outcome',...Object.hasOwn(value as object,'executionErrorCode')?['executionErrorCode']:[],...Object.hasOwn(value as object,'events')?['events']:[],...Object.hasOwn(value as object,'stopped')?['stopped']:[]],'invalid-product-turn-execution-receipt');
  const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('product-turn-runtime-scope-denied');if(!['absent','unknown','running','terminal'].includes(value.phase as string))reject('invalid-product-turn-execution-receipt');
  const phase=value.phase as TurnExecutionObservation['phase'],outcome=value.outcome===null?null:OUTCOMES.has(value.outcome as NonNullable<State['outcome']>)?value.outcome as NonNullable<State['outcome']>:reject('invalid-product-turn-execution-receipt'),events=value.events===undefined?[]:(Array.isArray(value.events)?value.events.map(event):reject('invalid-product-turn-execution-receipt')),executionErrorCode=value.executionErrorCode===undefined||value.executionErrorCode===null?null:turnId(value.executionErrorCode),stopped=value.stopped===undefined||value.stopped===null?null:stop(value.stopped);
  if(phase==='terminal'){if(!outcome||!stopped||(outcome==='completed'&&executionErrorCode!==null))reject('invalid-product-turn-execution-receipt');}else if(outcome!==null||stopped!==null)reject('invalid-product-turn-execution-receipt');
  if((phase==='absent'||phase==='unknown')&&events.length)reject('invalid-product-turn-execution-receipt');return {identity,phase,outcome,executionErrorCode,events,stopped};
}

/** Durable product adapter between Workspace TurnDispatcher and the future Pi
 * execution/checkpoint implementations. It reserves execution before the
 * first external await and never starts again after an uncertain boundary. */
export class ProductTurnRuntimeCore implements TurnRuntimePort{
  readonly #storage:ProductTurnRuntimeStorage;readonly #execution:TurnExecutionPort;readonly #checkpoints:TurnCheckpointPort;readonly #clock:()=>number;readonly #ready:Promise<void>;
  constructor(storage:ProductTurnRuntimeStorage,executionPort:TurnExecutionPort,checkpointPort:TurnCheckpointPort,clock:()=>number=Date.now,existingOnly=false){
    if(!storage?.sql?.exec||!storage.transactionSync||!storage.sync)reject('sqlite-product-turn-runtime-required');this.#storage=storage;this.#execution=executionPort;this.#checkpoints=checkpointPort;this.#clock=clock;
    if(existingOnly){this.#ready=Promise.resolve();return;}
    storage.transactionSync(()=>storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_runtime (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;'));this.#ready=storage.sync();
  }
  ready(){return this.#ready;}
  #read():State|null{const row=this.#storage.sql.exec<Row>('SELECT value FROM product_turn_runtime WHERE singleton=1').toArray()[0];return row?stored(JSON.parse(row.value as string)):null;}
  async #write(state:State){stored(state);this.#storage.transactionSync(()=>this.#storage.sql.exec('INSERT INTO product_turn_runtime VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value',JSON.stringify(state)));await this.#storage.sync();}
  #checked(identity:TurnRuntimeIdentity):State|null{const state=this.#read();if(state&&!sameTurnRuntimeIdentity(state.identity,identity))reject('product-turn-runtime-scope-denied');return state;}
  #receipt(state:State):TurnRuntimeReceipt{return {scope:state.identity.scope,sessionId:state.identity.sessionId,turnId:state.identity.turnId,dispatchId:state.identity.dispatchId,generation:state.identity.generation,phase:state.phase,outcome:state.outcome,executionErrorCode:state.executionErrorCode,events:structuredClone(state.events),checkpoint:state.checkpoint,persistenceErrorCode:state.persistenceErrorCode,stopped:state.stopped};}
  async accept(raw:Parameters<TurnRuntimePort['accept']>[0]):Promise<TurnRuntimeReceipt>{
    await this.#ready;const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),actor=validateActor(raw.actor),text=message(raw.message),base=turnBaseCheckpoints(raw.base),messageSha256=await turnDigest({actor,message:text,base}),prior=this.#checked(identity);
    if(prior){if(prior.messageSha256!==messageSha256)reject('product-turn-runtime-idempotency-conflict');return this.observe(identity);}
    const now=positive(this.#clock());for(const receipt of [base.workspace,base.session])if(receipt&&receipt.committedAt>now)reject('product-turn-runtime-base-time');const state:State={schemaVersion:3,executionDeadlineAt:positive(now+600000),identity,base,messageSha256,message:text,phase:'running',outcome:null,executionErrorCode:null,acceptReserved:true,executionReserved:true,cancelRequestedAt:null,startedAt:now,settledAt:null,events:[],checkpointIntent:null,checkpointCommitReserved:false,legacyCheckpointUnknown:false,checkpoint:null,persistenceErrorCode:null,stopped:null};await this.#write(state);
    try{return await this.#consume(identity,await this.#execution.start({...identity,actor,message:text,base,executionDeadlineAt:state.executionDeadlineAt}));}catch(error){await this.#unknown(identity);throw error;}
  }
  /** Read-only authority: never reconciles execution or prepares a checkpoint. */
  async currentObserverExecution(raw:TurnRuntimeIdentity):Promise<{expiresAt:number}>{
    await this.#ready;const identity=turnRuntimeIdentity(raw);
    const current=()=>{const state=this.#checked(identity);if(!state||state.phase!=='running'||state.cancelRequestedAt!==null||state.executionDeadlineAt===undefined||state.executionDeadlineAt<=positive(this.#clock()))reject('product-turn-observer-denied');return state.executionDeadlineAt;};
    const deadline=current();if(!this.#execution.currentObserverExecution)reject('product-turn-observer-denied');
    const native=await this.#execution.currentObserverExecution(identity);exact(native,['expiresAt'],'product-turn-observer-denied');
    if(current()!==deadline||native.expiresAt!==deadline)reject('product-turn-observer-denied');return {expiresAt:deadline};
  }
  async observe(raw:Parameters<TurnRuntimePort['observe']>[0]):Promise<TurnRuntimeReceipt>{
    await this.#ready;const identity=turnRuntimeIdentity(raw),state=this.#checked(identity);if(!state)return {scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,phase:'absent',outcome:null,events:[]};if(state.phase==='terminal')return this.#finishCheckpoint(identity);
    try{
      const observed=execution(await this.#execution.observe(identity),identity);
      // A prior Stop may have lost its native response with the container.
      // Only a durable cancellation fence plus an absent observation may
      // retry the idempotent native cancel reconciliation.
      return await this.#consume(identity,state.cancelRequestedAt!==null&&observed.phase==='absent'?await this.#execution.cancel(identity):observed);
    }catch(error){await this.#unknown(identity);throw error;}
  }
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]):Promise<TurnRuntimeReceipt>{
    await this.#ready;const identity=turnRuntimeIdentity(raw),state=this.#checked(identity);if(!state)return {scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,phase:'absent',outcome:null,events:[]};if(state.phase==='terminal')return this.#finishCheckpoint(identity);
    const first=state.cancelRequestedAt===null;if(first){state.cancelRequestedAt=positive(this.#clock());await this.#write(state);}try{return await this.#consume(identity,first?await this.#execution.cancel(identity):await this.#execution.observe(identity));}catch(error){await this.#unknown(identity);throw error;}
  }
  async #unknown(identity:TurnRuntimeIdentity){const state=this.#checked(identity);if(state&&state.phase!=='terminal'){state.phase='unknown';await this.#write(state);}}
  async #consume(identity:TurnRuntimeIdentity,value:unknown):Promise<TurnRuntimeReceipt>{
    const observed=execution(value,identity),state=this.#checked(identity);if(!state)reject('product-turn-runtime-not-found');if(state.phase==='terminal')return this.#receipt(state);const observedAt=positive(this.#clock());
    for(const item of observed.events??[])if(item.at<state.startedAt||item.at>observedAt)reject('product-turn-runtime-event-time');
    for(const item of observed.events??[]){const prior=state.events.find(event=>event.eventId===item.eventId);if(prior&&JSON.stringify(prior)!==JSON.stringify(item))reject('product-turn-runtime-event-conflict');if(!prior)state.events.push(item);}
    boundedEvents(state.events);
    if(observed.phase!=='terminal'){state.phase=observed.phase==='running'?'running':'unknown';await this.#write(state);return this.#receipt(state);}
    if(observed.stopped!.observedAt<state.startedAt||observed.stopped!.observedAt>observedAt)reject('product-turn-runtime-stop-time');
    if(state.cancelRequestedAt!==null&&!['cancelled','interrupted'].includes(observed.outcome!)){state.phase='unknown';await this.#write(state);reject('product-turn-cancellation-not-honored');}
    state.phase='terminal';state.outcome=observed.outcome;state.executionErrorCode=observed.executionErrorCode??null;state.stopped=observed.stopped!;state.settledAt=observedAt;state.message=null;await this.#write(state);return this.#finishCheckpoint(identity);
  }
  async #finishCheckpoint(identity:TurnRuntimeIdentity):Promise<TurnRuntimeReceipt>{
    let state=this.#checked(identity)!;if(state.checkpoint)return this.#receipt(state);if(NON_PERSISTABLE_EXECUTION_ERRORS.has(state.executionErrorCode??'')){state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);}if(state.legacyCheckpointUnknown){state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);}let receipt:CheckpointReceipt|null=null;
    const input:TurnCheckpointInput={identity,outcome:state.outcome!,executionErrorCode:state.executionErrorCode,base:state.base};
    if(!state.checkpointIntent){
      let prepared:TurnCheckpointIntent;try{prepared=await this.#checkpoints.prepare(input);}catch{state=this.#checked(identity)!;state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);}
      state=this.#checked(identity)!;const validated=intent(prepared,identity)!;if(state.checkpointIntent&&JSON.stringify(state.checkpointIntent)!==JSON.stringify(validated))reject('product-turn-checkpoint-intent-conflict');state.checkpointIntent??=validated;state.persistenceErrorCode=null;await this.#write(state);
    }
    state=this.#checked(identity)!;const prepared=state.checkpointIntent!;
    if(!state.checkpointCommitReserved){state.checkpointCommitReserved=true;await this.#write(state);try{receipt=await this.#checkpoints.commit(input,prepared);}catch{/* exact reconcile below */}}
    if(!receipt)try{receipt=await this.#checkpoints.reconcile(identity,prepared);}catch{/* immutable outcome remains unknown */}
    state=this.#checked(identity)!;if(receipt){state.checkpoint=checkpoint(receipt,state.settledAt);state.persistenceErrorCode=null;}else state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);
  }
}

export const productTurnRuntimeLimits={maxEvents:TURN_EVENT_LIMIT,maxEventBytes:MAX_RUNTIME_EVENT_BYTES};
