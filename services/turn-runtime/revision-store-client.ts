import type {ResolvedPreviewPlan,PreviewSource} from '../preview/source.ts';
import type { InitialWorkspaceReference, ResolvedInitialWorkspace } from './initial-workspace.ts';
import type { CheckpointReceipt, TurnBaseCheckpoints, TurnScope } from '../turn/protocol.ts';
import { turnBaseCheckpoints, turnDigest } from '../turn/protocol.ts';
import { turnCheckpointOperationId, type TurnCheckpointInput, type TurnCheckpointIntent, type TurnCheckpointPort } from './core.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { FrozenTurnSnapshot, FrozenTurnSnapshotPort, RestoredTurnRevision } from './revision.ts';
import type { TurnRevisionGcOptions, TurnRevisionGcResult } from './revision-gc.ts';
import type { WorkspaceFileDiff, WorkspaceFileIndex } from './workspace-file-index.ts';

export const REVISION_STORE_ACTOR='workspace-revisions-v1';
export type RevisionCommitInput={identity:TurnRuntimeIdentity;outcome:'completed'|'failed'|'cancelled'|'interrupted';executionErrorCode:string|null;base:TurnBaseCheckpoints;snapshot:FrozenTurnSnapshot};
export type RevisionGcInput=TurnRevisionGcOptions&{operationId:string};
export type RevisionGcReconcileInput={operationId:string;inputSha256:string};
export type RevisionCommitReconcileInput={operationId:string;identity:TurnRuntimeIdentity;inputSha256:string};
export interface RevisionStoreRpc{
  previewPlan(source:PreviewSource):Promise<ResolvedPreviewPlan>;
  serviceFiles(source:PreviewSource):Promise<Uint8Array>;
  initialPreviewPlan(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedPreviewPlan>;
  resolveInitial(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedInitialWorkspace>;
  commit(input:RevisionCommitInput):Promise<CheckpointReceipt>;
  reconcileCommit(input:RevisionCommitReconcileInput):Promise<CheckpointReceipt|null>;
  observe(identity:TurnRuntimeIdentity):Promise<CheckpointReceipt|null>;
  restore(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound?:boolean):Promise<RestoredTurnRevision>;
  files(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<WorkspaceFileIndex>;
  diff(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<WorkspaceFileDiff>;
  load(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt|null):Promise<Uint8Array|null>;
  gc(input:RevisionGcInput):Promise<TurnRevisionGcResult>;
  reconcileGc?(input:RevisionGcReconcileInput):Promise<TurnRevisionGcResult|null>;
}
export interface RevisionStoreNamespace{getByName(name:string):RevisionStoreRpc}
function reject(code:string):never{throw Error(code);}
async function bytesSha256(value:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function revisionCommitDigestInput(input:TurnCheckpointInput,filesSha256:string,filesBytes:number,sessionSha256:string,sessionBytes:number){return {identity:turnRuntimeIdentity(input.identity),outcome:input.outcome,executionErrorCode:input.executionErrorCode,base:turnBaseCheckpoints(input.base),filesSha256,filesBytes,sessionSha256,sessionBytes};}
export async function revisionCommitIntent(input:TurnCheckpointInput,snapshot:FrozenTurnSnapshot):Promise<TurnCheckpointIntent>{const filesSha256=await bytesSha256(snapshot.filesArchive),sessionSha256=await bytesSha256(snapshot.piSession);return {operationId:turnCheckpointOperationId(input.identity),inputSha256:await turnDigest(revisionCommitDigestInput(input,filesSha256,snapshot.filesArchive.byteLength,sessionSha256,snapshot.piSession.byteLength))};}

/** Freezes Sandbox state without R2 access, then delegates immutable bytes to
 * the private RevisionStore authority. */
export class RevisionStoreCheckpointPort implements TurnCheckpointPort{
  readonly #store:RevisionStoreRpc;readonly #snapshots:FrozenTurnSnapshotPort;
  constructor(store:RevisionStoreRpc,snapshots:FrozenTurnSnapshotPort){if(!store?.commit||!store.reconcileCommit||!snapshots?.freeze)reject('revision-store-required');this.#store=store;this.#snapshots=snapshots;}
  async prepare(input:TurnCheckpointInput){const identity=turnRuntimeIdentity(input.identity),base=turnBaseCheckpoints(input.base),snapshot=await this.#snapshots.freeze(identity,base);return revisionCommitIntent({...input,identity,base},snapshot);}
  async commit(input:TurnCheckpointInput,intent:TurnCheckpointIntent){
    const identity=turnRuntimeIdentity(input.identity),base=turnBaseCheckpoints(input.base),snapshot=await this.#snapshots.freeze(identity,base),actual=await revisionCommitIntent({...input,identity,base},snapshot);
    if(JSON.stringify(actual)!==JSON.stringify(intent))reject('revision-store-checkpoint-intent-conflict');return this.#store.commit({...input,identity,base,snapshot});
  }
  reconcile(identity:TurnRuntimeIdentity,intent:TurnCheckpointIntent){return this.#store.reconcileCommit({...intent,identity:turnRuntimeIdentity(identity)});}
}
