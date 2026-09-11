import type {ResolvedPreviewPlan,PreviewSource} from '../preview/source.ts';
import type { InitialWorkspaceReference, ResolvedInitialWorkspace } from './initial-workspace.ts';
import type { CheckpointReceipt, TurnBaseCheckpoints, TurnScope } from '../turn/protocol.ts';
import { checkpointReceipt, scope as turnScope, turnBaseCheckpoints, turnDigest } from '../turn/protocol.ts';
import { turnCheckpointOperationId, type TurnCheckpointInput, type TurnCheckpointIntent, type TurnCheckpointPort, type TurnCheckpointResolution } from './core.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { frozenTurnSnapshot, type FrozenTurnSnapshot, type FrozenTurnSnapshotPort, type RestoredTurnRevision } from './revision.ts';
import type { TurnRevisionGcOptions, TurnRevisionGcResolution } from './revision-gc.ts';
import type { WorkspaceFileDiff, WorkspaceFileIndex } from './workspace-file-index.ts';

export function revisionStoreActorName(raw:TurnScope):string{const scope=turnScope(raw);return `workspace-revisions-v3:${scope.tenantId}:${scope.projectId}:${scope.workspaceId}`;}
export type RevisionCommitInput={identity:TurnRuntimeIdentity;outcome:'completed'|'failed'|'cancelled'|'interrupted';executionErrorCode:string|null;base:TurnBaseCheckpoints;snapshot:FrozenTurnSnapshot};
export type RevisionGcInput=TurnRevisionGcOptions&{operationId:string;scope:TurnScope};
export type RevisionGcMaintenanceInput=TurnRevisionGcOptions&{scope:TurnScope};
export type RevisionGcReconcileInput={operationId:string;inputSha256:string;scope:TurnScope};
export type RevisionCommitReconcileInput={operationId:string;identity:TurnRuntimeIdentity;inputSha256:string};
export type RevisionCommitResolution=TurnCheckpointResolution;
export interface RevisionStoreRpc{
  previewPlan(source:PreviewSource):Promise<ResolvedPreviewPlan>;
  serviceFiles(source:PreviewSource):Promise<Uint8Array>;
  initialPreviewPlan(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedPreviewPlan>;
  resolveInitial(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedInitialWorkspace>;
  commit(input:RevisionCommitInput):Promise<RevisionCommitResolution>;
  reconcileCommit(input:RevisionCommitReconcileInput):Promise<RevisionCommitResolution>;
  abandonCommit(input:RevisionCommitReconcileInput):Promise<RevisionCommitResolution>;
  observe(identity:TurnRuntimeIdentity):Promise<CheckpointReceipt|null>;
  restore(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound?:boolean):Promise<RestoredTurnRevision>;
  files(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<WorkspaceFileIndex>;
  diff(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<WorkspaceFileDiff>;
  load(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt|null):Promise<Uint8Array|null>;
  gc(input:RevisionGcInput):Promise<TurnRevisionGcResolution>;
  reconcileGc?(input:RevisionGcReconcileInput):Promise<TurnRevisionGcResolution>;
  maintainGc?(input:RevisionGcMaintenanceInput):Promise<TurnRevisionGcResolution>;
}
export interface RevisionStoreNamespace{getByName(name:string):RevisionStoreRpc}
function reject(code:string):never{throw Error(code);}
async function bytesSha256(value:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function revisionCommitDigestInput(input:TurnCheckpointInput,filesSha256:string,filesBytes:number,sessionSha256:string,sessionBytes:number){return {identity:turnRuntimeIdentity(input.identity),outcome:input.outcome,executionErrorCode:input.executionErrorCode,base:turnBaseCheckpoints(input.base),filesSha256,filesBytes,sessionSha256,sessionBytes};}
export async function revisionCommitIntent(input:TurnCheckpointInput,snapshot:FrozenTurnSnapshot):Promise<TurnCheckpointIntent>{const filesSha256=await bytesSha256(snapshot.filesArchive),sessionSha256=await bytesSha256(snapshot.piSession);return {operationId:turnCheckpointOperationId(input.identity),inputSha256:await turnDigest(revisionCommitDigestInput(input,filesSha256,snapshot.filesArchive.byteLength,sessionSha256,snapshot.piSession.byteLength))};}
export function revisionCommitResolution(value:unknown):RevisionCommitResolution{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-revision-store-commit-resolution');const raw=value as Record<string,unknown>;
  if(raw.status==='committed'){if(Object.keys(raw).length!==2||!Object.hasOwn(raw,'receipt'))reject('invalid-revision-store-commit-resolution');return {status:'committed',receipt:checkpointReceipt(raw.receipt)};}
  if(!['absent','pending','unavailable','conflict','aborted'].includes(String(raw.status))||Object.keys(raw).length!==1)reject('invalid-revision-store-commit-resolution');return {status:raw.status as Exclude<RevisionCommitResolution,{status:'committed'}>['status']};
}

/** Freezes Sandbox state without R2 access, then delegates immutable bytes to
 * the private RevisionStore authority. */
export class RevisionStoreCheckpointPort implements TurnCheckpointPort{
  readonly #store:RevisionStoreRpc;readonly #snapshots:FrozenTurnSnapshotPort;readonly #prepared=new Map<string,{intent:TurnCheckpointIntent;snapshot:FrozenTurnSnapshot}>();
  constructor(store:RevisionStoreRpc,snapshots:FrozenTurnSnapshotPort){if(!store?.commit||!store.reconcileCommit||!store.abandonCommit||!snapshots?.freeze)reject('revision-store-required');this.#store=store;this.#snapshots=snapshots;}
  async prepare(input:TurnCheckpointInput){const identity=turnRuntimeIdentity(input.identity),base=turnBaseCheckpoints(input.base),snapshot=frozenTurnSnapshot(await this.#snapshots.freeze(identity,base),identity),prepared=await revisionCommitIntent({...input,identity,base},snapshot);this.#prepared.set(prepared.operationId,{intent:prepared,snapshot});return prepared;}
  async commit(input:TurnCheckpointInput,intent:TurnCheckpointIntent){
    const identity=turnRuntimeIdentity(input.identity),base=turnBaseCheckpoints(input.base),saved=this.#prepared.get(intent.operationId);if(!saved)reject('revision-store-checkpoint-snapshot-unavailable');
    if(JSON.stringify(saved.intent)!==JSON.stringify(intent))reject('revision-store-checkpoint-intent-conflict');return revisionCommitResolution(await this.#store.commit({...input,identity,base,snapshot:saved.snapshot}));
  }
  async reconcile(identity:TurnRuntimeIdentity,intent:TurnCheckpointIntent){return revisionCommitResolution(await this.#store.reconcileCommit({...intent,identity:turnRuntimeIdentity(identity)}));}
  async abandon(identity:TurnRuntimeIdentity,intent:TurnCheckpointIntent){return revisionCommitResolution(await this.#store.abandonCommit({...intent,identity:turnRuntimeIdentity(identity)}));}
}
