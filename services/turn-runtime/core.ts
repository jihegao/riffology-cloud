import type { CheckpointReceipt, TurnActor, TurnBaseCheckpoints, TurnResourceDisposition, TurnResourceLease } from '../turn/protocol.ts';
import { TURN_EVENT_LIMIT, actor as validateActor, checkpointObjectKey, jsonPayload, message, positive, sha, turnBaseCheckpoints, turnDigest, turnId } from '../turn/protocol.ts';
import type { TurnRuntimeEvent, TurnRuntimePort, TurnRuntimeReceipt, TurnStopReceipt } from '../turn/dispatcher.ts';
import type { TrustedPiCapacityPort } from '../capacity/client.ts';
import type { TrustedPiCapacityDispatchReference, TrustedPiCapacityIdentity, TrustedPiCapacityStopProof, TrustedPiCapacityTicket } from '../capacity/core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';

export type ProductTurnRuntimeStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'> & Partial<Pick<DurableObjectStorage,'setAlarm'|'deleteAlarm'>>;
export type TurnExecutionObservation={identity:TurnRuntimeIdentity;phase:'absent'|'unknown'|'running'|'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;executionErrorCode?:string|null;events?:TurnRuntimeEvent[];stopped?:TurnStopReceipt|null};
export interface TurnExecutionPort{
  start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}):Promise<TurnExecutionObservation>;
  currentObserverExecution?(identity:TurnRuntimeIdentity):Promise<{expiresAt:number}>;
  observe(identity:TurnRuntimeIdentity):Promise<TurnExecutionObservation>;
  cancel(identity:TurnRuntimeIdentity):Promise<TurnExecutionObservation>;
  release(identity:TurnRuntimeIdentity):Promise<{running:boolean}>;
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
  abandon?(identity:TurnRuntimeIdentity,intent:TurnCheckpointIntent):Promise<{status:'committed';receipt:CheckpointReceipt}|{status:'aborted'|'pending'|'unavailable'|'conflict'}>;
}
type State={schemaVersion:2|3|4;executionDeadlineAt?:number;identity:TurnRuntimeIdentity;actor:TurnActor|null;base:TurnBaseCheckpoints;messageSha256:string;message:string|null;phase:'running'|'unknown'|'terminal';outcome:'completed'|'failed'|'cancelled'|'interrupted'|null;executionErrorCode:string|null;acceptReserved:true;executionReserved:true;resourceLease:TurnResourceLease;capacityManaged:boolean;capacityDispatchReserved:boolean;capacityDispatchConfirmed:boolean;nativeStartReserved:boolean;cancelRequestedAt:number|null;startedAt:number;settledAt:number|null;events:TurnRuntimeEvent[];checkpointIntent:TurnCheckpointIntent|null;checkpointCommitReserved:boolean;legacyCheckpointUnknown:boolean;checkpoint:CheckpointReceipt|null;persistenceErrorCode:string|null;stopped:TurnStopReceipt|null};
type ReleaseState={schemaVersion:2;operationId:string;leaseId:string;begunAt:number;deadlineAt:number;attempts:number;nextAttemptAt:number;absentSince:number|null;status:'release-pending'|'recovery-hold'|'released';reasonCode:string;proof:TrustedPiCapacityStopProof|null;releasedAt:number|null};
type CheckpointRecoveryState={schemaVersion:1;operationId:string;firstFailedAt:number;attempts:number;lastErrorCode:string;nextAttemptAt:number;deadlineAt:number};
export type ProductTurnReleaseTiming={retryMs:number;assignmentGuardMs:number;quietMs:number;deadlineMs:number;holdRetryMs:number};
type Row=Record<string,SqlStorageValue>;
const EVENT_TYPES=new Set<TurnRuntimeEvent['type']>(['assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status']);
const OUTCOMES=new Set<NonNullable<State['outcome']>>(['completed','failed','cancelled','interrupted']);
// These failures prove that no valid input state exists to freeze. Attempting
// checkpoint preparation would allocate fresh Sandboxes and could turn an
// input-integrity failure into new project-side effects.
const NON_PERSISTABLE_EXECUTION_ERRORS=new Set(['turn-base-unavailable','turn-native-execution-absent','turn-native-exit-failed','turn-native-result-missing']);
const MAX_RUNTIME_EVENT_BYTES=2*1024*1024,DEFAULT_RELEASE_TIMING:ProductTurnReleaseTiming={retryMs:5000,assignmentGuardMs:360000,quietMs:30000,deadlineMs:600000,holdRetryMs:60000},encoder=new TextEncoder();
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
function optionalCode(value:unknown):string|null{return value===null?null:turnId(value);}
function nonnegative(value:unknown,code:string):number{if(!Number.isSafeInteger(value)||(value as number)<0)reject(code);return value as number;}
function releaseTiming(value:Partial<ProductTurnReleaseTiming>):ProductTurnReleaseTiming{return {retryMs:nonnegative(value.retryMs??DEFAULT_RELEASE_TIMING.retryMs,'invalid-product-turn-release-timing'),assignmentGuardMs:nonnegative(value.assignmentGuardMs??DEFAULT_RELEASE_TIMING.assignmentGuardMs,'invalid-product-turn-release-timing'),quietMs:nonnegative(value.quietMs??DEFAULT_RELEASE_TIMING.quietMs,'invalid-product-turn-release-timing'),deadlineMs:nonnegative(value.deadlineMs??DEFAULT_RELEASE_TIMING.deadlineMs,'invalid-product-turn-release-timing'),holdRetryMs:nonnegative(value.holdRetryMs??DEFAULT_RELEASE_TIMING.holdRetryMs,'invalid-product-turn-release-timing')};}
function resourceLease(value:unknown):TurnResourceLease{exact(value,['operationId','leaseId'],'invalid-product-turn-resource-lease');return {operationId:turnId(value.operationId),leaseId:turnId(value.leaseId)};}
function capacityIdentity(identity:TurnRuntimeIdentity,lease:TurnResourceLease):TrustedPiCapacityIdentity{return {tenantId:identity.scope.tenantId,projectId:identity.scope.projectId,workspaceId:identity.scope.workspaceId,sessionId:identity.sessionId,operationId:lease.operationId,turnId:identity.turnId,generation:identity.generation};}
function sameCapacityTicket(value:unknown,identity:TurnRuntimeIdentity,lease:TurnResourceLease):TrustedPiCapacityTicket{
  if(!value||typeof value!=='object'||Array.isArray(value))reject('invalid-product-turn-capacity-ticket');const ticket=value as TrustedPiCapacityTicket,expected=capacityIdentity(identity,lease);
  for(const [key,expectedValue] of Object.entries(expected))if(ticket[key as keyof TrustedPiCapacityTicket]!==expectedValue)reject('product-turn-capacity-scope-denied');
  if(ticket.leaseId!==lease.leaseId||typeof ticket.ticketId!=='string'||(ticket.status==='held'?ticket.dispatchId!==null:ticket.status==='dispatched'||ticket.status==='released'?ticket.dispatchId!==identity.dispatchId:false))reject('product-turn-capacity-scope-denied');return ticket;
}
function releaseState(value:unknown,identity:TurnRuntimeIdentity,lease:TurnResourceLease):ReleaseState{
  exact(value,['schemaVersion','operationId','leaseId','begunAt','deadlineAt','attempts','nextAttemptAt','absentSince','status','reasonCode','proof','releasedAt'],'invalid-product-turn-release-state');
  if(value.schemaVersion!==2||value.operationId!==lease.operationId||value.leaseId!==lease.leaseId||!['release-pending','recovery-hold','released'].includes(value.status as string))reject('invalid-product-turn-release-state');
  const begunAt=positive(value.begunAt),deadlineAt=positive(value.deadlineAt),attempts=nonnegative(value.attempts,'invalid-product-turn-release-state'),nextAttemptAt=positive(value.nextAttemptAt),absentSince=value.absentSince===null?null:positive(value.absentSince),releasedAt=value.releasedAt===null?null:positive(value.releasedAt),reasonCode=turnId(value.reasonCode);
  if(deadlineAt<begunAt||absentSince!==null&&absentSince<begunAt)reject('invalid-product-turn-release-state');
  let proof:TrustedPiCapacityStopProof|null=null;if(value.proof!==null){exact(value.proof,['kind','proofId','observedAt'],'invalid-product-turn-release-state');if(value.proof.kind!=='runtime-released')reject('invalid-product-turn-release-state');proof={kind:'runtime-released',proofId:turnId(value.proof.proofId),observedAt:positive(value.proof.observedAt)};}
  if(value.status==='released'){if(!proof||releasedAt===null||releasedAt<proof.observedAt||nextAttemptAt!==releasedAt)reject('invalid-product-turn-release-state');}else if(releasedAt!==null)reject('invalid-product-turn-release-state');
  return {schemaVersion:2,operationId:lease.operationId,leaseId:lease.leaseId,begunAt,deadlineAt,attempts,nextAttemptAt,absentSince,status:value.status as ReleaseState['status'],reasonCode,proof,releasedAt};
}
function checkpointRecovery(value:unknown,identity:TurnRuntimeIdentity):CheckpointRecoveryState{exact(value,['schemaVersion','operationId','firstFailedAt','attempts','lastErrorCode','nextAttemptAt','deadlineAt'],'invalid-product-turn-checkpoint-recovery');if(value.schemaVersion!==1||value.operationId!==turnCheckpointOperationId(identity))reject('invalid-product-turn-checkpoint-recovery');const firstFailedAt=positive(value.firstFailedAt),attempts=positive(value.attempts),nextAttemptAt=positive(value.nextAttemptAt),deadlineAt=positive(value.deadlineAt),lastErrorCode=turnId(value.lastErrorCode);if(deadlineAt!==firstFailedAt+120_000||nextAttemptAt<firstFailedAt)reject('invalid-product-turn-checkpoint-recovery');return {schemaVersion:1,operationId:value.operationId,firstFailedAt,attempts,lastErrorCode,nextAttemptAt,deadlineAt};}
function stop(value:unknown):TurnStopReceipt|null{if(value===null)return null;exact(value,['confirmationId','observedAt','nativeRunning','fenced'],'invalid-product-turn-runtime-state');if(value.nativeRunning!==false||value.fenced!==true)reject('invalid-product-turn-runtime-state');return {confirmationId:turnId(value.confirmationId),observedAt:positive(value.observedAt),nativeRunning:false,fenced:true};}
function event(value:unknown):TurnRuntimeEvent{exact(value,['eventId','type','at','payload'],'invalid-product-turn-runtime-event');if(typeof value.type!=='string'||!EVENT_TYPES.has(value.type as TurnRuntimeEvent['type']))reject('invalid-product-turn-runtime-event');return {eventId:turnId(value.eventId),type:value.type as TurnRuntimeEvent['type'],at:positive(value.at),payload:jsonPayload(value.payload)};}
function boundedEvents(events:TurnRuntimeEvent[]):TurnRuntimeEvent[]{if(events.length>TURN_EVENT_LIMIT||encoder.encode(JSON.stringify(events)).byteLength>MAX_RUNTIME_EVENT_BYTES)reject('product-turn-runtime-event-limit');return events;}
function checkpoint(value:unknown,settledAt:number|null):CheckpointReceipt|null{if(value===null)return null;exact(value,['revisionId','objectKey','filesSha256','sessionSha256','committedAt'],'invalid-product-turn-checkpoint');const receipt={revisionId:turnId(value.revisionId),objectKey:checkpointObjectKey(value.objectKey),filesSha256:sha(value.filesSha256),sessionSha256:sha(value.sessionSha256),committedAt:positive(value.committedAt)};if(settledAt!==null&&receipt.committedAt<settledAt)reject('invalid-product-turn-checkpoint');return receipt;}
function intent(value:unknown,identity:TurnRuntimeIdentity):TurnCheckpointIntent|null{if(value===null)return null;exact(value,['operationId','inputSha256'],'invalid-product-turn-runtime-state');if(value.operationId!==turnCheckpointOperationId(identity))reject('invalid-product-turn-runtime-state');return {operationId:value.operationId,inputSha256:sha(value.inputSha256)};}
function migrateStored(value:unknown):unknown{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)return value;
  const version=(value as Record<string,unknown>).schemaVersion;
  let legacy=structuredClone(value) as Record<string,unknown>;
  if(version===1){exact(legacy,['schemaVersion','identity','base','messageSha256','message','phase','outcome','executionErrorCode','acceptReserved','executionReserved','cancelRequestedAt','startedAt','settledAt','events','checkpointReserved','checkpoint','persistenceErrorCode','stopped'],'invalid-product-turn-runtime-state');if(typeof legacy.checkpointReserved!=='boolean')reject('invalid-product-turn-runtime-state');const reserved=legacy.checkpointReserved,hasCheckpoint=legacy.checkpoint!==null;delete legacy.checkpointReserved;legacy.schemaVersion=2;legacy.checkpointIntent=null;legacy.checkpointCommitReserved=reserved;legacy.legacyCheckpointUnknown=reserved&&!hasCheckpoint;}
  return legacy;
}
function stored(value:unknown):State{
  try{
    value=migrateStored(value);const version=(value as Record<string,unknown>)?.schemaVersion,hasExecutionDeadline=Object.hasOwn(value as object,'executionDeadlineAt');exact(value,[...(hasExecutionDeadline?['executionDeadlineAt']:[]),'schemaVersion','identity',...(version===4?['actor']:[]),'base','messageSha256','message','phase','outcome','executionErrorCode','acceptReserved','executionReserved',...(version===4?['resourceLease','capacityManaged','capacityDispatchReserved','capacityDispatchConfirmed','nativeStartReserved']:[]),'cancelRequestedAt','startedAt','settledAt','events','checkpointIntent','checkpointCommitReserved','legacyCheckpointUnknown','checkpoint','persistenceErrorCode','stopped'],'invalid-product-turn-runtime-state');
    if((value.schemaVersion!==2&&value.schemaVersion!==3&&value.schemaVersion!==4)||value.acceptReserved!==true||value.executionReserved!==true||!['running','unknown','terminal'].includes(value.phase as string)||typeof value.checkpointCommitReserved!=='boolean'||typeof value.legacyCheckpointUnknown!=='boolean')reject('invalid-product-turn-runtime-state');
    const identity=turnRuntimeIdentity(value.identity),savedActor=value.schemaVersion===4?(value.actor===null?null:validateActor(value.actor)):null,base=turnBaseCheckpoints(value.base),messageSha256=sha(value.messageSha256),startedAt=positive(value.startedAt),settledAt=value.settledAt===null?null:positive(value.settledAt),cancelRequestedAt=value.cancelRequestedAt===null?null:positive(value.cancelRequestedAt);
    const executionDeadlineAt=hasExecutionDeadline?positive(value.executionDeadlineAt):undefined;if(executionDeadlineAt!==undefined&&executionDeadlineAt!==startedAt+600000)reject('invalid-product-turn-runtime-state');
    const lease=value.schemaVersion===4?resourceLease(value.resourceLease):{operationId:`legacy-operation-${identity.dispatchId}`,leaseId:`legacy-lease-${identity.dispatchId}`},capacityManaged=value.schemaVersion===4?value.capacityManaged:false,capacityDispatchReserved=value.schemaVersion===4?value.capacityDispatchReserved:true,capacityDispatchConfirmed=value.schemaVersion===4?value.capacityDispatchConfirmed:true,nativeStartReserved=value.schemaVersion===4?value.nativeStartReserved:true;
    if(typeof capacityManaged!=='boolean'||typeof capacityDispatchReserved!=='boolean'||typeof capacityDispatchConfirmed!=='boolean'||typeof nativeStartReserved!=='boolean'||capacityDispatchConfirmed&&!capacityDispatchReserved||nativeStartReserved&&!capacityDispatchConfirmed||(!nativeStartReserved)===(savedActor===null))reject('invalid-product-turn-runtime-state');
    if(value.message!==null)message(value.message);if(!Array.isArray(value.events))reject('invalid-product-turn-runtime-state');const events=boundedEvents(value.events.map(event)),ids=new Set(events.map(item=>item.eventId));if(ids.size!==events.length)reject('invalid-product-turn-runtime-state');
    const outcome=value.outcome===null?null:OUTCOMES.has(value.outcome as NonNullable<State['outcome']>)?value.outcome as NonNullable<State['outcome']>:reject('invalid-product-turn-runtime-state'),executionErrorCode=optionalCode(value.executionErrorCode),persistenceErrorCode=optionalCode(value.persistenceErrorCode),stopped=stop(value.stopped),saved=checkpoint(value.checkpoint,settledAt),checkpointIntent=intent(value.checkpointIntent,identity),checkpointCommitReserved=value.checkpointCommitReserved as boolean,legacyCheckpointUnknown=value.legacyCheckpointUnknown as boolean;
    if(value.phase==='terminal'){
      if(!outcome||settledAt===null||!stopped||value.message!==null||(saved!==null&&persistenceErrorCode!==null))reject('invalid-product-turn-runtime-state');
      if(outcome==='completed'&&executionErrorCode!==null)reject('invalid-product-turn-runtime-state');
    }else if(outcome!==null||settledAt!==null||stopped!==null||saved!==null||persistenceErrorCode!==null||checkpointIntent!==null||checkpointCommitReserved||legacyCheckpointUnknown)reject('invalid-product-turn-runtime-state');
    if(legacyCheckpointUnknown&&(!checkpointCommitReserved||checkpointIntent!==null||saved!==null))reject('invalid-product-turn-runtime-state');if(checkpointCommitReserved&&checkpointIntent===null&&!legacyCheckpointUnknown&&saved===null)reject('invalid-product-turn-runtime-state');
    return {schemaVersion:4,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt}),identity,actor:savedActor,base,messageSha256,message:value.message as string|null,phase:value.phase as State['phase'],outcome,executionErrorCode,acceptReserved:true,executionReserved:true,resourceLease:lease,capacityManaged,capacityDispatchReserved,capacityDispatchConfirmed,nativeStartReserved,cancelRequestedAt,startedAt,settledAt,events,checkpointIntent,checkpointCommitReserved,legacyCheckpointUnknown,checkpoint:saved,persistenceErrorCode,stopped};
  }catch{reject('invalid-persisted-product-turn-runtime');}
}
export function storedProductTurnRuntimeIdentity(value:unknown):TurnRuntimeIdentity{return stored(value).identity;}
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
  readonly #storage:ProductTurnRuntimeStorage;readonly #execution:TurnExecutionPort;readonly #checkpoints:TurnCheckpointPort;readonly #capacity:TrustedPiCapacityPort|null;readonly #clock:()=>number;readonly #releaseTiming:ProductTurnReleaseTiming;readonly #ready:Promise<void>;#releaseTableReady:boolean;#activeRelease:Promise<void>|null=null;
  constructor(storage:ProductTurnRuntimeStorage,executionPort:TurnExecutionPort,checkpointPort:TurnCheckpointPort,clock:()=>number=Date.now,existingOnly=false,timing:Partial<ProductTurnReleaseTiming>={},capacity:TrustedPiCapacityPort|null=null){
    if(!storage?.sql?.exec||!storage.transactionSync||!storage.sync||!executionPort?.start||!executionPort.observe||!executionPort.cancel||!executionPort.release)reject('sqlite-product-turn-runtime-required');this.#storage=storage;this.#execution=executionPort;this.#checkpoints=checkpointPort;this.#clock=clock;
    if(capacity!==null&&(!capacity.lookup||!capacity.dispatch||!capacity.confirmReleased))reject('product-turn-capacity-port-required');this.#capacity=capacity;
    this.#releaseTiming=releaseTiming(timing);if((this.#releaseTiming.retryMs||this.#releaseTiming.assignmentGuardMs||this.#releaseTiming.quietMs)&&(!storage.setAlarm||!storage.deleteAlarm))reject('product-turn-release-alarm-required');this.#releaseTableReady=!existingOnly;
    if(existingOnly){this.#ready=Promise.resolve();return;}
    storage.transactionSync(()=>{storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_runtime (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;');storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_release (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;');storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_checkpoint_recovery (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;');});this.#ready=storage.sync();
  }
  ready(){return this.#ready;}
  #read():State|null{const row=this.#storage.sql.exec<Row>('SELECT value FROM product_turn_runtime WHERE singleton=1').toArray()[0];return row?stored(JSON.parse(row.value as string)):null;}
  async #write(state:State){stored(state);this.#storage.transactionSync(()=>this.#storage.sql.exec('INSERT INTO product_turn_runtime VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value',JSON.stringify(state)));await this.#storage.sync();}
  #readRelease(identity:TurnRuntimeIdentity):ReleaseState|null{const row=this.#storage.sql.exec<Row>('SELECT value FROM product_turn_release WHERE singleton=1').toArray()[0];if(!row)return null;const runtime=this.#checked(identity)??reject('product-turn-runtime-not-found'),value=JSON.parse(row.value as string) as Record<string,unknown>;if(value.schemaVersion===1){exact(value,['schemaVersion','operationId','begunAt','attempts','nextAttemptAt','absentSince','confirmedAt'],'invalid-product-turn-release-state');const begunAt=positive(value.begunAt),confirmedAt=value.confirmedAt===null?null:positive(value.confirmedAt),proof=confirmedAt===null?null:{kind:'runtime-released' as const,proofId:'legacy-release',observedAt:confirmedAt};return {schemaVersion:2,operationId:runtime.resourceLease.operationId,leaseId:runtime.resourceLease.leaseId,begunAt,deadlineAt:begunAt+this.#releaseTiming.deadlineMs,attempts:positive(value.attempts),nextAttemptAt:confirmedAt??positive(value.nextAttemptAt),absentSince:value.absentSince===null?null:positive(value.absentSince),status:confirmedAt===null?'release-pending':'released',reasonCode:confirmedAt===null?'trusted-pi-release-pending':'trusted-pi-release-confirmed',proof,releasedAt:confirmedAt};}return releaseState(value,identity,runtime.resourceLease);}
  async #writeRelease(identity:TurnRuntimeIdentity,state:ReleaseState){const runtime=this.#checked(identity);if(!runtime)reject('product-turn-runtime-not-found');releaseState(state,identity,runtime.resourceLease);this.#storage.transactionSync(()=>this.#storage.sql.exec('INSERT INTO product_turn_release VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value',JSON.stringify(state)));await this.#storage.sync();}
  async #ensureReleaseTable(){if(this.#releaseTableReady)return;this.#storage.transactionSync(()=>this.#storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_release (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;'));await this.#storage.sync();this.#releaseTableReady=true;}
  async #armRelease(at:number){if(this.#storage.setAlarm){await this.#storage.setAlarm(at);await this.#storage.sync();}}
  async #clearRelease(){if(this.#storage.deleteAlarm){await this.#storage.deleteAlarm();await this.#storage.sync();}}
  #readCheckpointRecovery(identity:TurnRuntimeIdentity):CheckpointRecoveryState|null{if(!this.#storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_checkpoint_recovery'").toArray().length)return null;const row=this.#storage.sql.exec<Row>('SELECT value FROM product_turn_checkpoint_recovery WHERE singleton=1').toArray()[0];return row?checkpointRecovery(JSON.parse(row.value as string),identity):null;}
  async #writeCheckpointRecovery(identity:TurnRuntimeIdentity,state:CheckpointRecoveryState){checkpointRecovery(state,identity);this.#storage.transactionSync(()=>{this.#storage.sql.exec('CREATE TABLE IF NOT EXISTS product_turn_checkpoint_recovery (singleton INTEGER PRIMARY KEY CHECK(singleton=1), value TEXT NOT NULL) STRICT;');this.#storage.sql.exec('INSERT INTO product_turn_checkpoint_recovery VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value',JSON.stringify(state));});await this.#storage.sync();if(this.#storage.setAlarm){await this.#storage.setAlarm(state.nextAttemptAt);await this.#storage.sync();}}
  async #clearCheckpointRecovery(){if(!this.#storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_checkpoint_recovery'").toArray().length)return;this.#storage.transactionSync(()=>this.#storage.sql.exec('DELETE FROM product_turn_checkpoint_recovery WHERE singleton=1'));await this.#storage.sync();}
  #checked(identity:TurnRuntimeIdentity):State|null{const state=this.#read();if(state&&!sameTurnRuntimeIdentity(state.identity,identity))reject('product-turn-runtime-scope-denied');return state;}
  #resourceDisposition(state:State):TurnResourceDisposition{
    const binding={operationId:state.resourceLease.operationId,leaseId:state.resourceLease.leaseId,turnId:state.identity.turnId,dispatchId:state.identity.dispatchId,generation:state.identity.generation};
    if(state.phase!=='terminal')return {status:'active',...binding};
    const release=this.#readRelease(state.identity);if(release?.status==='released')return {status:'released',...binding,proofId:release.proof!.proofId,releasedAt:release.releasedAt!};
    if(release)return {status:release.status,...binding,reasonCode:release.reasonCode,since:release.begunAt,nextAttemptAt:release.nextAttemptAt};
    const recovery=this.#readCheckpointRecovery(state.identity);return {status:'release-pending',...binding,reasonCode:'trusted-pi-release-awaiting-checkpoint',since:state.settledAt!,nextAttemptAt:recovery?.nextAttemptAt??state.settledAt!};
  }
  #receipt(state:State):TurnRuntimeReceipt{return {scope:state.identity.scope,sessionId:state.identity.sessionId,turnId:state.identity.turnId,dispatchId:state.identity.dispatchId,generation:state.identity.generation,phase:state.phase,outcome:state.outcome,executionErrorCode:state.executionErrorCode,events:structuredClone(state.events),checkpoint:state.checkpoint,persistenceErrorCode:state.persistenceErrorCode,stopped:state.stopped,resourceDisposition:this.#resourceDisposition(state)} as unknown as TurnRuntimeReceipt;}
  async #capacityTicket(state:State):Promise<TrustedPiCapacityTicket>{
    if(!state.capacityManaged||!this.#capacity)reject('product-turn-capacity-port-required');const found=await this.#capacity.lookup(capacityIdentity(state.identity,state.resourceLease));if(!found)reject('product-turn-capacity-lease-missing');return sameCapacityTicket(found.ticket,state.identity,state.resourceLease);
  }
  async #authorizeCapacity(identity:TurnRuntimeIdentity):Promise<void>{
    let state=this.#checked(identity)??reject('product-turn-runtime-not-found');if(state.capacityDispatchConfirmed)return;if(!state.capacityManaged||!this.#capacity)reject('product-turn-capacity-port-required');
    if(!state.capacityDispatchReserved){state.capacityDispatchReserved=true;await this.#write(state);}
    let ticket=await this.#capacityTicket(state);if(ticket.status==='held'){
      const reference={...capacityIdentity(identity,state.resourceLease),ticketId:ticket.ticketId,leaseId:state.resourceLease.leaseId,dispatchId:identity.dispatchId} satisfies TrustedPiCapacityDispatchReference,result=await this.#capacity.dispatch(reference);ticket=sameCapacityTicket(result.ticket,identity,state.resourceLease);
      if(!result.authorized&&ticket.status!=='dispatched')reject('product-turn-capacity-dispatch-unconfirmed');
    }
    if(ticket.status!=='dispatched')reject('product-turn-capacity-dispatch-unconfirmed');state=this.#checked(identity)??reject('product-turn-runtime-not-found');state.capacityDispatchConfirmed=true;await this.#write(state);
  }
  async #startOrObserve(identity:TurnRuntimeIdentity,acceptedActor?:TurnActor,acceptedMessage?:string):Promise<TurnRuntimeReceipt>{
    await this.#authorizeCapacity(identity);let state=this.#checked(identity)??reject('product-turn-runtime-not-found');if(state.nativeStartReserved)return this.#consume(identity,await this.#execution.observe(identity));
    const actor=acceptedActor??state.actor,text=acceptedMessage??state.message;if(!actor||text===null)reject('product-turn-native-start-reservation-invalid');state.nativeStartReserved=true;state.actor=null;await this.#write(state);
    return this.#consume(identity,await this.#execution.start({...identity,actor,message:text,base:state.base,executionDeadlineAt:state.executionDeadlineAt}));
  }
  async accept(raw:Omit<Parameters<TurnRuntimePort['accept']>[0],'capacityLease'>&{capacityLease?:TurnResourceLease}):Promise<TurnRuntimeReceipt>{
    await this.#ready;const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation}),actor=validateActor(raw.actor),text=message(raw.message),base=turnBaseCheckpoints(raw.base),lease=raw.capacityLease===undefined?(this.#capacity?reject('product-turn-resource-lease-required'):{operationId:'legacy',leaseId:'legacy'}):resourceLease(raw.capacityLease),messageSha256=await turnDigest({actor,message:text,base,resourceLease:lease}),prior=this.#checked(identity);
    if(prior){if(prior.messageSha256!==messageSha256)reject('product-turn-runtime-idempotency-conflict');return this.observe(identity);}
    const now=positive(this.#clock());for(const receipt of [base.workspace,base.session])if(receipt&&receipt.committedAt>now)reject('product-turn-runtime-base-time');const managed=this.#capacity!==null,state:State={schemaVersion:4,executionDeadlineAt:positive(now+600000),identity,actor,base,messageSha256,message:text,phase:'running',outcome:null,executionErrorCode:null,acceptReserved:true,executionReserved:true,resourceLease:lease,capacityManaged:managed,capacityDispatchReserved:!managed,capacityDispatchConfirmed:!managed,nativeStartReserved:false,cancelRequestedAt:null,startedAt:now,settledAt:null,events:[],checkpointIntent:null,checkpointCommitReserved:false,legacyCheckpointUnknown:false,checkpoint:null,persistenceErrorCode:null,stopped:null};await this.#write(state);
    try{return await this.#startOrObserve(identity,actor,text);}catch(error){await this.#unknown(identity);throw error;}
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
    await this.#ready;const identity=turnRuntimeIdentity(raw),state=this.#checked(identity);if(!state)return {scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,phase:'absent',outcome:null,executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:null,stopped:null,resourceDisposition:{status:'released',operationId:'legacy',leaseId:'legacy',turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,proofId:'runtime-absent',releasedAt:positive(this.#clock())}};if(state.phase==='terminal')return this.#finishCheckpoint(identity);
    try{
      if(!state.capacityDispatchConfirmed||!state.nativeStartReserved)return this.#startOrObserve(identity);
      const observed=execution(await this.#execution.observe(identity),identity);
      // A prior Stop may have lost its native response with the container.
      // Only a durable cancellation fence plus an absent observation may
      // retry the idempotent native cancel reconciliation.
      return await this.#consume(identity,state.cancelRequestedAt!==null&&observed.phase==='absent'?await this.#execution.cancel(identity):observed);
    }catch(error){await this.#unknown(identity);throw error;}
  }
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]):Promise<TurnRuntimeReceipt>{
    await this.#ready;const identity=turnRuntimeIdentity(raw),state=this.#checked(identity);if(!state)return {scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,phase:'absent',outcome:null,executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:null,stopped:null,resourceDisposition:{status:'released',operationId:'legacy',leaseId:'legacy',turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,proofId:'runtime-absent',releasedAt:positive(this.#clock())}};if(state.phase==='terminal')return this.#finishCheckpoint(identity);
    const first=state.cancelRequestedAt===null;if(first){state.cancelRequestedAt=positive(this.#clock());await this.#write(state);}try{let current=this.#checked(identity)!;if(!current.capacityDispatchConfirmed)await this.#authorizeCapacity(identity);current=this.#checked(identity)!;if(!current.nativeStartReserved){current.nativeStartReserved=true;current.actor=null;await this.#write(current);}return await this.#consume(identity,first?await this.#execution.cancel(identity):await this.#execution.observe(identity));}catch(error){await this.#unknown(identity);throw error;}
  }
  async maintenance(raw:TurnRuntimeIdentity):Promise<void>{await this.#ready;const identity=turnRuntimeIdentity(raw),state=this.#checked(identity);if(state?.phase==='terminal'){if(this.#releaseEligible(state))await this.#release(identity);else await this.#finishCheckpoint(identity);}}
  async #unknown(identity:TurnRuntimeIdentity){const state=this.#checked(identity);if(state&&state.phase!=='terminal'){state.phase='unknown';await this.#write(state);}}
  async #release(identity:TurnRuntimeIdentity):Promise<void>{
    if(this.#activeRelease)return this.#activeRelease;
    this.#activeRelease=this.#reconcileRelease(identity).finally(()=>{this.#activeRelease=null;});return this.#activeRelease;
  }
  async #reconcileRelease(identity:TurnRuntimeIdentity):Promise<void>{
    const runtime=this.#checked(identity);if(!runtime||!this.#releaseEligible(runtime))reject('product-turn-release-before-checkpoint');
    await this.#ensureReleaseTable();
    const now=positive(this.#clock()),lease=runtime.resourceLease;let state=this.#readRelease(identity)??{schemaVersion:2 as const,operationId:lease.operationId,leaseId:lease.leaseId,begunAt:now,deadlineAt:positive(now+this.#releaseTiming.deadlineMs),attempts:0,nextAttemptAt:now,absentSince:null,status:'release-pending' as const,reasonCode:'trusted-pi-release-pending',proof:null,releasedAt:null};
    if(state.status==='released'){await this.#clearRelease();return;}if(now<state.nextAttemptAt){await this.#armRelease(state.nextAttemptAt);return;}
    if(now>=state.deadlineAt&&state.status==='release-pending'){state={...state,status:'recovery-hold',reasonCode:'trusted-pi-release-deadline-exceeded',nextAttemptAt:positive(now+this.#releaseTiming.holdRetryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
    const retryMs=state.status==='recovery-hold'?this.#releaseTiming.holdRetryMs:this.#releaseTiming.retryMs;
    if(!state.proof){
      state={...state,attempts:state.attempts+1,nextAttemptAt:positive(now+retryMs)};await this.#armRelease(state.nextAttemptAt);await this.#writeRelease(identity,state);
      let observed:{running:boolean};try{observed=await this.#execution.release(identity);exact(observed,['running'],'invalid-product-turn-release-observation');if(typeof observed.running!=='boolean')reject('invalid-product-turn-release-observation');}catch{state=this.#readRelease(identity)??reject('invalid-product-turn-release-state');state={...state,reasonCode:'trusted-pi-release-unconfirmed',nextAttemptAt:positive(this.#clock()+retryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
      const observedAt=positive(this.#clock());state=this.#readRelease(identity)??reject('invalid-product-turn-release-state');
      if(observed.running){state={...state,absentSince:null,reasonCode:'trusted-pi-release-running',nextAttemptAt:positive(observedAt+retryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
      const absentSince=state.absentSince??observedAt;state={...state,absentSince};
      if(observedAt-state.begunAt<this.#releaseTiming.assignmentGuardMs){state={...state,reasonCode:'trusted-pi-release-assignment-guard',nextAttemptAt:positive(observedAt+retryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
      if(observedAt-absentSince<this.#releaseTiming.quietMs){state={...state,reasonCode:'trusted-pi-release-quiet-window',nextAttemptAt:positive(observedAt+retryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
      state={...state,reasonCode:'trusted-pi-capacity-release-pending',proof:{kind:'runtime-released',proofId:lease.leaseId,observedAt},nextAttemptAt:positive(observedAt+retryMs)};await this.#writeRelease(identity,state);
    }
    const proof=state.proof;if(!proof)reject('invalid-product-turn-release-state');let releasedAt=proof.observedAt;
    if(runtime.capacityManaged){
      if(!this.#capacity)reject('product-turn-capacity-port-required');
      try{const ticket=await this.#capacityTicket(runtime),reference={...capacityIdentity(identity,lease),ticketId:ticket.ticketId,leaseId:lease.leaseId,dispatchId:identity.dispatchId} satisfies TrustedPiCapacityDispatchReference,result=await this.#capacity.confirmReleased(reference,proof),released=sameCapacityTicket(result.ticket,identity,lease);if(released.status!=='released'||released.finishedAt===null)reject('product-turn-capacity-release-unconfirmed');releasedAt=positive(released.finishedAt);}catch{state=this.#readRelease(identity)??reject('invalid-product-turn-release-state');state={...state,reasonCode:'trusted-pi-capacity-release-unconfirmed',nextAttemptAt:positive(this.#clock()+retryMs)};await this.#writeRelease(identity,state);await this.#armRelease(state.nextAttemptAt);return;}
    }
    state=this.#readRelease(identity)??reject('invalid-product-turn-release-state');state={...state,status:'released',reasonCode:'trusted-pi-release-confirmed',releasedAt,nextAttemptAt:releasedAt};await this.#writeRelease(identity,state);await this.#clearRelease();
  }
  async #consume(identity:TurnRuntimeIdentity,value:unknown):Promise<TurnRuntimeReceipt>{
    const observed=execution(value,identity),state=this.#checked(identity);if(!state)reject('product-turn-runtime-not-found');if(state.phase==='terminal')return this.#receipt(state);const observedAt=positive(this.#clock());
    for(const item of observed.events??[])if(item.at<state.startedAt||item.at>observedAt)reject('product-turn-runtime-event-time');
    for(const item of observed.events??[]){const prior=state.events.find(event=>event.eventId===item.eventId);if(prior&&JSON.stringify(prior)!==JSON.stringify(item))reject('product-turn-runtime-event-conflict');if(!prior)state.events.push(item);}
    boundedEvents(state.events);
    if(observed.phase!=='terminal'){state.phase=observed.phase==='running'?'running':'unknown';await this.#write(state);return this.#receipt(state);}
    if(observed.stopped!.observedAt<state.startedAt||observed.stopped!.observedAt>observedAt)reject('product-turn-runtime-stop-time');
    // Stop is best effort. A terminal receipt with fenced stop proof may have
    // been produced immediately before the cancellation request reached the
    // native adapter. Preserve that immutable natural outcome instead of
    // turning a completed execution into an unrecoverable unknown state.
    state.phase='terminal';state.outcome=observed.outcome;state.executionErrorCode=observed.executionErrorCode??null;state.stopped=observed.stopped!;state.settledAt=observedAt;state.message=null;await this.#write(state);return this.#finishCheckpoint(identity);
  }
  async #finishCheckpoint(identity:TurnRuntimeIdentity):Promise<TurnRuntimeReceipt>{
    let state=this.#checked(identity)!;if(state.checkpoint){await this.#clearCheckpointRecovery();await this.#release(identity);return this.#receipt(state);}if(state.persistenceErrorCode==='turn-checkpoint-aborted'){await this.#release(identity);return this.#receipt(state);}if(NON_PERSISTABLE_EXECUTION_ERRORS.has(state.executionErrorCode??'')){state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);await this.#release(identity);return this.#receipt(state);}if(state.legacyCheckpointUnknown){state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);}let receipt:CheckpointReceipt|null=null;
    const input:TurnCheckpointInput={identity,outcome:state.outcome!,executionErrorCode:state.executionErrorCode,base:state.base};
    if(!state.checkpointIntent){
      let prepared:TurnCheckpointIntent;try{prepared=await this.#checkpoints.prepare(input);}catch{state=this.#checked(identity)!;state.persistenceErrorCode='turn-checkpoint-unknown';await this.#write(state);return this.#receipt(state);}
      state=this.#checked(identity)!;const validated=intent(prepared,identity)!;if(state.checkpointIntent&&JSON.stringify(state.checkpointIntent)!==JSON.stringify(validated))reject('product-turn-checkpoint-intent-conflict');state.checkpointIntent??=validated;state.persistenceErrorCode=null;await this.#write(state);
    }
    state=this.#checked(identity)!;const prepared=state.checkpointIntent!;
    if(!state.checkpointCommitReserved){state.checkpointCommitReserved=true;await this.#write(state);try{receipt=await this.#checkpoints.commit(input,prepared);}catch{/* exact reconcile below */}}
    if(!receipt)try{receipt=await this.#checkpoints.reconcile(identity,prepared);}catch{/* immutable outcome remains unknown */}
    state=this.#checked(identity)!;if(receipt){state.checkpoint=checkpoint(receipt,state.settledAt);state.persistenceErrorCode=null;await this.#clearCheckpointRecovery();}else{
      const now=positive(this.#clock()),prior=this.#readCheckpointRecovery(identity),attempts=(prior?.attempts??0)+1,firstFailedAt=prior?.firstFailedAt??now,deadlineAt=prior?.deadlineAt??firstFailedAt+120_000;
      if(now>=deadlineAt){let resolution:{status:'committed';receipt:CheckpointReceipt}|{status:'aborted'|'pending'|'unavailable'|'conflict'}={status:'unavailable'};try{if(this.#checkpoints.abandon)resolution=await this.#checkpoints.abandon(identity,prepared);}catch{/* recovery hold */}if(resolution.status==='committed'){state.checkpoint=checkpoint(resolution.receipt,state.settledAt);state.persistenceErrorCode=null;await this.#clearCheckpointRecovery();}else if(resolution.status==='aborted'){state.persistenceErrorCode='turn-checkpoint-aborted';await this.#clearCheckpointRecovery();}else{state.persistenceErrorCode='turn-checkpoint-recovery-hold';await this.#writeCheckpointRecovery(identity,{schemaVersion:1,operationId:prepared.operationId,firstFailedAt,attempts,lastErrorCode:`revision-${resolution.status}`,nextAttemptAt:now+60_000,deadlineAt});}}
      else{const delay=Math.min(30_000,1000*2**Math.min(10,attempts-1));state.persistenceErrorCode='turn-checkpoint-unknown';await this.#writeCheckpointRecovery(identity,{schemaVersion:1,operationId:prepared.operationId,firstFailedAt,attempts,lastErrorCode:'revision-unresolved',nextAttemptAt:Math.min(deadlineAt,now+delay),deadlineAt});}
    }await this.#write(state);if(state.checkpoint)await this.#release(identity);else if(state.persistenceErrorCode==='turn-checkpoint-aborted')await this.#release(identity);return this.#receipt(state);
  }
  #releaseEligible(state:State):boolean{return state.phase==='terminal'&&(state.checkpoint!==null||state.persistenceErrorCode==='turn-checkpoint-aborted'||NON_PERSISTABLE_EXECUTION_ERRORS.has(state.executionErrorCode??''));}
}

export const productTurnRuntimeLimits={maxEvents:TURN_EVENT_LIMIT,maxEventBytes:MAX_RUNTIME_EVENT_BYTES};
