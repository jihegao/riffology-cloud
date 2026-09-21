import { initialWorkspaceReference, type InitialWorkspaceReference } from '../turn-runtime/initial-workspace.ts';
export type TurnScope = { tenantId:string; projectId:string; workspaceId:string; workspaceGeneration:number };
export type TurnActor = { userId:string; authVersion:number };
export type TurnStatus = 'queued'|'running'|'cancelling'|'checkpointing'|'completed'|'failed'|'cancelled'|'interrupted';
export type TurnCancelDisposition = 'cancelled'|'interrupted'|'already-terminal';
export type RuntimeEventType = 'assistant.delta'|'assistant.message'|'tool.started'|'tool.updated'|'tool.completed'|'provider.status';
export type TurnEventType = 'turn.queued'|'turn.started'|'turn.cancel_requested'|'turn.checkpointing'|'turn.completed'|'turn.failed'|'turn.cancelled'|'turn.interrupted'|RuntimeEventType;
export type CheckpointReceipt = { revisionId:string; objectKey:string; filesSha256:string; sessionSha256:string; committedAt:number };
export type InitialWorkspaceBase = { reference:InitialWorkspaceReference; filesSha256:string };
export type TurnBaseCheckpoints = { workspace:CheckpointReceipt|null; session:CheckpointReceipt|null; initial?:InitialWorkspaceBase };
export type TurnResourceLease = { operationId:string; leaseId:string };
export type WorkspaceBindingLease = { scope:TurnScope; leaseId:string; leaseEpoch:number; runtimeVersion:string };
export type WorkspaceTurnBinding = { sessionId:string; turnId:string; dispatchId:string; bindingEpoch:number };
export type WorkspaceQuiescence = { schemaVersion:1; bindingEpoch:string; status:'quiescent'; remaining:0 };
export type WorkspaceProjectNotStarted = { schemaVersion:1; bindingEpoch:string; status:'not-started'; allocation:'never-started'|'retained-sealed' };
export type TurnHandoffDisposition = { status:'handed-off'; operationId:string; leaseId:string; turnId:string; dispatchId:string; generation:number; lease:WorkspaceBindingLease; binding:WorkspaceTurnBinding; checkpoint:CheckpointReceipt; proof:{project:WorkspaceQuiescence|WorkspaceProjectNotStarted;trustedPi:WorkspaceQuiescence}; handedOffAt:number };
export type TurnResourceDisposition =
  | TurnHandoffDisposition
  | { status:'active'; operationId:string; leaseId:string; turnId:string; dispatchId:string; generation:number }
  | { status:'release-pending'|'recovery-hold'; operationId:string; leaseId:string; turnId:string; dispatchId:string; generation:number; reasonCode:string; since:number; nextAttemptAt:number }
  | { status:'released'; operationId:string; leaseId:string; turnId:string; dispatchId:string; generation:number; proofId:string; releasedAt:number };
export type TurnResourceWait =
  | { status:'waiting'; reasonCode:string; since:number; nextAttemptAt:number; turnId:string; ticketId:string|null; operationId:string; leaseId:null }
  | { status:'release-pending'; reasonCode:'turn-initial-base-unavailable'; since:number; nextAttemptAt:number; turnId:string; ticketId:string; operationId:string; leaseId:string };
export type TurnReleaseHold = { status:'release-pending'|'recovery-hold'; reasonCode:string; since:number; nextAttemptAt:number; turnId:string; dispatchId:string; generation:number; operationId:string; leaseId:string };
export type SessionRecord = { id:string; scope:TurnScope; actorUserId:string; actorAuthVersion:number; title:string; createdAt:number; updatedAt:number; head:CheckpointReceipt|null };
export type TurnRecord = {
  id:string; sessionId:string; scope:TurnScope; actor:TurnActor; requestKey:string; payloadSha256:string; message:string;
  status:TurnStatus; createdAt:number; updatedAt:number; startedAt:number|null; finishedAt:number|null;
  startedSequence:number|null; terminalSequence:number|null;
  dispatchId:string|null; runtimeGeneration:number|null; cancelRequestedAt:number|null; cancelDisposition:TurnCancelDisposition|null;
  base:TurnBaseCheckpoints|null; resourceLease:TurnResourceLease|null;
  executionOutcome:'completed'|'failed'|'cancelled'|'interrupted'|null; errorCode:string|null;
  persistenceOutcome:'saved'|'failed'|null; persistenceErrorCode:string|null; checkpoint:CheckpointReceipt|null;
};
export type TurnEvent = { sequence:number; eventId:string; turnId:string; workspaceId:string; runtimeGeneration:number; type:TurnEventType; at:number; payload:Record<string,unknown> };
export type TurnJournalState = {
  schemaVersion:7; scope:TurnScope; nextSequence:number; oldestSequence:number; retentionBytes:number; activeTurnId:string|null; workspaceHead:CheckpointReceipt|null;
  resourceWait:TurnResourceWait|null; releaseHold:TurnReleaseHold|null;
  recoveryHold:null|{status:'reconciling';reasonCode:string;since:number;nextAttemptAt:number;turnId:string;dispatchId:string;runtimeGeneration:number};
  sessions:Record<string,SessionRecord>; turns:Record<string,TurnRecord>;
  sessionIntents:Record<string,{payloadSha256:string;sessionId:string}>;
  turnIntents:Record<string,{payloadSha256:string;turnId:string}>;
  eventReceipts:Record<string,{payloadSha256:string;sequence:number;event:TurnEvent}>; events:TurnEvent[];
};
export type PublicSessionRecord = Omit<SessionRecord,'actorUserId'|'actorAuthVersion'>&{canContinue?:boolean};
export type PublicTurnRecord = Omit<TurnRecord,'actor'|'requestKey'|'payloadSha256'|'dispatchId'|'base'|'resourceLease'|'startedSequence'|'terminalSequence'>&{actor:{userId:string}};
export type TurnJournalView = {
  schemaVersion:3; scope:TurnScope; nextSequence:number; activeTurnId:string|null;
  resourceWait:null|{status:'waiting'|'release-pending';reasonCode:string;since:number;nextAttemptAt:number};
  releaseHold:null|{status:'release-pending'|'recovery-hold';reasonCode:string;since:number;nextAttemptAt:number};
  recoveryHold:null|{status:'reconciling';reasonCode:string;since:number;nextAttemptAt:number};
  sessions:Record<string,PublicSessionRecord>; turns:Record<string,PublicTurnRecord & {timing?:import('./timing.ts').TurnTiming}>;
};

export const TURN_EVENT_LIMIT=2048;
export const TURN_EVENT_BYTES_LIMIT=4*1024*1024;
export const TURN_EVENT_RECEIPT_LIMIT=4096;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const SHA=/^[a-f0-9]{64}$/;
export function turnId(value:unknown):string{if(typeof value!=='string'||!ID.test(value))throw Error('invalid-turn-identifier');return value;}
export function positive(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<1)throw Error('invalid-turn-integer');return value as number;}
export function scope(value:unknown):TurnScope{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-turn-scope');
  const v=value as Record<string,unknown>,keys=['tenantId','projectId','workspaceId','workspaceGeneration'];
  if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key)))throw Error('invalid-turn-scope');
  return {tenantId:turnId(v.tenantId),projectId:turnId(v.projectId),workspaceId:turnId(v.workspaceId),workspaceGeneration:positive(v.workspaceGeneration)};
}
export function actor(value:unknown):TurnActor{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-turn-actor');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==2||!Object.hasOwn(v,'userId')||!Object.hasOwn(v,'authVersion'))throw Error('invalid-turn-actor');
  return {userId:turnId(v.userId),authVersion:positive(v.authVersion)};
}
export function message(value:unknown):string{
  if(typeof value!=='string'||value.length<1||value.length>16000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw Error('invalid-turn-message');
  return value;
}
export function title(value:unknown):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\u0000-\u001f\u007f]/u.test(value))throw Error('invalid-session-title');
  return value.trim();
}
export function sha(value:unknown):string{if(typeof value!=='string'||!SHA.test(value))throw Error('invalid-turn-sha');return value;}
export function resourceDisposition(value:unknown):TurnResourceDisposition{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-turn-resource-disposition');
  const raw=value as Record<string,unknown>,status=raw.status;
  const base=['status','operationId','leaseId','turnId','dispatchId','generation'];
  const keys=status==='active'?base:status==='release-pending'||status==='recovery-hold'?[...base,'reasonCode','since','nextAttemptAt']:status==='released'?[...base,'proofId','releasedAt']:status==='handed-off'?[...base,'lease','binding','checkpoint','proof','handedOffAt']:null;
  if(!keys||Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))throw Error('invalid-turn-resource-disposition');
  const common={operationId:turnId(raw.operationId),leaseId:turnId(raw.leaseId),turnId:turnId(raw.turnId),dispatchId:turnId(raw.dispatchId),generation:positive(raw.generation)};
  if(status==='handed-off'){
    const lease=workspaceBindingLease(raw.lease),binding=workspaceTurnBinding(raw.binding),checkpoint=checkpointReceipt(raw.checkpoint),handedOffAt=positive(raw.handedOffAt);
    const proof=handoffObject(raw.proof,['project','trustedPi']);
    if(lease.leaseId!==common.leaseId||lease.scope.workspaceGeneration!==common.generation||binding.turnId!==common.turnId||binding.dispatchId!==common.dispatchId||handedOffAt<checkpoint.committedAt)throw Error('invalid-turn-handoff');
    return {status:'handed-off',...common,lease,binding,checkpoint,proof:{project:workspaceProjectProof(proof.project),trustedPi:workspaceQuiescence(proof.trustedPi)},handedOffAt};
  }
  if(status==='active')return {status:'active',...common};
  if(status==='released')return {status:'released',...common,proofId:turnId(raw.proofId),releasedAt:positive(raw.releasedAt)};
  const since=positive(raw.since),nextAttemptAt=positive(raw.nextAttemptAt);if(nextAttemptAt<since)throw Error('invalid-turn-resource-disposition');
  return {status:status as 'release-pending'|'recovery-hold',...common,reasonCode:turnId(raw.reasonCode),since,nextAttemptAt};
}
function handoffObject(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('invalid-turn-handoff');return value as Record<string,unknown>;
}
export function workspaceBindingLease(value:unknown):WorkspaceBindingLease{const v=handoffObject(value,['scope','leaseId','leaseEpoch','runtimeVersion']);return {scope:scope(v.scope),leaseId:turnId(v.leaseId),leaseEpoch:positive(v.leaseEpoch),runtimeVersion:sha(v.runtimeVersion)};}
export function workspaceTurnBinding(value:unknown):WorkspaceTurnBinding{const v=handoffObject(value,['sessionId','turnId','dispatchId','bindingEpoch']);return {sessionId:turnId(v.sessionId),turnId:turnId(v.turnId),dispatchId:turnId(v.dispatchId),bindingEpoch:positive(v.bindingEpoch)};}
function workspaceQuiescence(value:unknown):WorkspaceQuiescence{const v=handoffObject(value,['schemaVersion','bindingEpoch','status','remaining']);if(v.schemaVersion!==1||v.status!=='quiescent'||v.remaining!==0)throw Error('invalid-turn-handoff');return {schemaVersion:1,bindingEpoch:sha(v.bindingEpoch),status:'quiescent',remaining:0};}
function workspaceProjectProof(value:unknown):WorkspaceQuiescence|WorkspaceProjectNotStarted{
  if(value&&typeof value==='object'&&(value as {status?:unknown}).status==='not-started'){const v=handoffObject(value,['schemaVersion','bindingEpoch','status','allocation']);if(v.schemaVersion!==1||!['never-started','retained-sealed'].includes(v.allocation as string))throw Error('invalid-turn-handoff');return {schemaVersion:1,bindingEpoch:sha(v.bindingEpoch),status:'not-started',allocation:v.allocation as 'never-started'|'retained-sealed'};}
  return workspaceQuiescence(value);
}
/** Shared native epoch token, independent of file hashes checked by checkpoint authority. */
export async function workspaceBindingToken(lease:WorkspaceBindingLease,binding:WorkspaceTurnBinding):Promise<string>{return turnDigest({schemaVersion:1,purpose:'workspace-binding',lease:workspaceBindingLease(lease),binding:workspaceTurnBinding(binding)});}
export async function verifyHandoffProof(disposition:TurnResourceDisposition):Promise<void>{if(disposition.status!=='handed-off')return;const token=await workspaceBindingToken(disposition.lease,disposition.binding);if(disposition.proof.project.bindingEpoch!==token||disposition.proof.trustedPi.bindingEpoch!==token)throw Error('turn-handoff-proof-conflict');}
export function checkpointObjectKey(value:unknown):string{
  if(typeof value!=='string'||value.length<1||value.length>1024||/[^A-Za-z0-9._\/-]/u.test(value)||value.startsWith('/')||value.endsWith('/')||value.includes('//'))throw Error('invalid-checkpoint-object-key');
  const parts=value.split('/');if(parts.some(part=>!part||part==='.'||part==='..'))throw Error('invalid-checkpoint-object-key');return value;
}
export function checkpointReceipt(value:unknown):CheckpointReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-checkpoint-receipt');
  const receipt=value as Record<string,unknown>,keys=['revisionId','objectKey','filesSha256','sessionSha256','committedAt'];
  if(Object.keys(receipt).length!==keys.length||keys.some(key=>!Object.hasOwn(receipt,key)))throw Error('invalid-checkpoint-receipt');
  return {revisionId:turnId(receipt.revisionId),objectKey:checkpointObjectKey(receipt.objectKey),filesSha256:sha(receipt.filesSha256),sessionSha256:sha(receipt.sessionSha256),committedAt:positive(receipt.committedAt)};
}
export function initialWorkspaceBase(value:unknown):InitialWorkspaceBase{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-initial-workspace-base');
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).length!==2||!Object.hasOwn(raw,'reference')||!Object.hasOwn(raw,'filesSha256'))throw Error('invalid-initial-workspace-base');
  return {reference:initialWorkspaceReference(raw.reference),filesSha256:sha(raw.filesSha256)};
}
export function turnBaseCheckpoints(value:unknown):TurnBaseCheckpoints{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-turn-base-checkpoints');
  const base=value as Record<string,unknown>,keys=Object.hasOwn(value,'initial')?['workspace','session','initial']:['workspace','session'];
  if(Object.keys(base).length!==keys.length||keys.some(key=>!Object.hasOwn(base,key)))throw Error('invalid-turn-base-checkpoints');
  const workspace=base.workspace===null?null:checkpointReceipt(base.workspace),session=base.session===null?null:checkpointReceipt(base.session);
  if(session!==null&&workspace===null)throw Error('invalid-turn-base-checkpoints');
  if(Object.hasOwn(base,'initial')){if(workspace!==null||session!==null)throw Error('invalid-turn-base-checkpoints');return {workspace,session,initial:initialWorkspaceBase(base.initial)};}
  return {workspace,session};
}
export function jsonPayload(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-event-payload');
  let text:string;
  try{text=JSON.stringify(value);}catch{throw Error('invalid-event-payload');}
  if(new TextEncoder().encode(text).byteLength>16384||text.includes('__proto__'))throw Error('invalid-event-payload');
  const parsed=JSON.parse(text);
  return parsed;
}
export async function turnDigest(value:unknown):Promise<string>{
  const text=JSON.stringify(value),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function sameScope(a:TurnScope,b:TurnScope):boolean{return a.tenantId===b.tenantId&&a.projectId===b.projectId&&a.workspaceId===b.workspaceId&&a.workspaceGeneration===b.workspaceGeneration;}
