import { sandboxActorIds } from '../sandbox/policy.ts';
import { actor as validateActor, checkpointReceipt, message, positive, sameScope, turnBaseCheckpoints, turnDigest, type CheckpointReceipt, type TurnActor, type TurnBaseCheckpoints, type TurnScope } from '../turn/protocol.ts';
import type { TurnExecutionObservation, TurnExecutionPort } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { initialWorkspaceReference, type InitialWorkspaceReference, type ResolvedInitialWorkspace } from './initial-workspace.ts';
import type { RestoredTurnRevision } from './revision.ts';
import type { WorkspaceFilesFreezePort } from './snapshot.ts';

export interface WorkspaceRevisionSource{
  resolveInitial?(reference:InitialWorkspaceReference,expectedScope:TurnScope):Promise<ResolvedInitialWorkspace>;
  restore(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound?:boolean):Promise<RestoredTurnRevision>;
}
export interface ProjectWorkspaceRpc{
  restoreWorkspace(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null):Promise<{sha256:string;bytes:number}>;
  freezeWorkspace(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints):Promise<Uint8Array>;
  abortWorkspace(identity:TurnRuntimeIdentity):Promise<{running:boolean;fenced:true}>;
}
type Resolver=(actorId:string)=>ProjectWorkspaceRpc;
export const PROJECT_WORKSPACE_ABORT_TIMEOUT_MS=30_000;
function reject(code:string):never{throw Error(code);}
function same(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}
const UNUSABLE_BASE_ERRORS=new Set([
  'turn-revision-base-missing','invalid-turn-revision-manifest','turn-revision-base-scope-denied',
  'turn-revision-base-conflict','turn-revision-object-conflict','turn-revision-object-too-large',
  'project-workspace-base-conflict','initial-workspace-source-required','initial-workspace-model-source-required','invalid-initial-workspace-archive',
  'invalid-initial-workspace-reference','initial-workspace-scope-denied','initial-workspace-layout-mismatch',
  'initial-workspace-marker-mismatch','initial-workspace-checkpoint-missing','initial-workspace-checkpoint-invalid','initial-workspace-checkpoint-mismatch',
  'model-content-missing','model-content-mismatch','model-content-unknown','model-content-oversize',
]);
export class TurnBaseUnavailableError extends Error{constructor(){super('turn-base-unavailable');this.name='TurnBaseUnavailableError';}}
function unusableBase(error:unknown):boolean{return error instanceof Error&&UNUSABLE_BASE_ERRORS.has(error.message);}

/** Resolves the Project Sandbox from the immutable Turn identity. It restores
 * only a verified R2 Workspace base and later freezes the same actor for the
 * Revision adapter. Pi never receives either archive or actor id. */
export class ProjectWorkspaceLifecycle implements WorkspaceFilesFreezePort{
  readonly #source:WorkspaceRevisionSource;readonly #resolve:Resolver;readonly #abortTimeoutMs:number;
  constructor(source:WorkspaceRevisionSource,resolve:Resolver,abortTimeoutMs=PROJECT_WORKSPACE_ABORT_TIMEOUT_MS){if(!source?.restore||typeof resolve!=='function')reject('project-workspace-lifecycle-required');if(!Number.isSafeInteger(abortTimeoutMs)||abortTimeoutMs<1)reject('invalid-project-workspace-abort-timeout');this.#source=source;this.#resolve=resolve;this.#abortTimeoutMs=abortTimeoutMs;}
  async #target(identity:TurnRuntimeIdentity){const actorId=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project;return this.#resolve(actorId);}
  async prepare(raw:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints):Promise<void>{
    const identity=turnRuntimeIdentity(raw),base=turnBaseCheckpoints(rawBase);let archive:Uint8Array|null=null;
    if(base.workspace){
      try{
        const expected=checkpointReceipt(base.workspace),restored=await this.#source.restore(identity,expected,false);
        if(!sameScope(restored.identity.scope,identity.scope)||!same(restored.receipt,expected)||!(restored.filesArchive instanceof Uint8Array))reject('project-workspace-base-conflict');
        archive=Uint8Array.from(restored.filesArchive);
      }catch(error){if(unusableBase(error))throw new TurnBaseUnavailableError();throw error;}
    }
    else if(base.initial){
      try{
        if(!this.#source.resolveInitial)reject('initial-workspace-source-required');
        const expected=base.initial.reference;
        if(!sameScope(expected.scope,identity.scope))reject('project-workspace-base-conflict');
        const restored=await this.#source.resolveInitial(expected,identity.scope);
        let restoredReference:InitialWorkspaceReference;
        try{restoredReference=initialWorkspaceReference(restored?.reference);}catch{reject('project-workspace-base-conflict');}
        if(!restored||!same(restoredReference,expected)||!sameScope(restored.reference.scope,identity.scope)||restored.referenceSha256!==await turnDigest(expected)||!(restored.filesArchive instanceof Uint8Array)||restored.filesArchive.byteLength<1||restored.filesSha256!==base.initial.filesSha256)reject('project-workspace-base-conflict');
        archive=Uint8Array.from(restored.filesArchive);
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(archive)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        if(digest!==base.initial.filesSha256)reject('project-workspace-base-conflict');
      }catch(error){if(unusableBase(error))throw new TurnBaseUnavailableError();throw error;}
    }
    await (await this.#target(identity)).restoreWorkspace(identity,base,archive);
  }
  async frozenFiles(raw:TurnRuntimeIdentity,rawBase:TurnBaseCheckpoints):Promise<Uint8Array>{
    const identity=turnRuntimeIdentity(raw),base=turnBaseCheckpoints(rawBase);
    if(base.initial&&!sameScope(base.initial.reference.scope,identity.scope))reject('project-workspace-base-conflict');
    const archive=await (await this.#target(identity)).freezeWorkspace(identity,base);
    if(!(archive instanceof Uint8Array)||archive.byteLength<1)reject('invalid-project-workspace-archive');return Uint8Array.from(archive);
  }
  async abort(raw:TurnRuntimeIdentity):Promise<void>{
    const identity=turnRuntimeIdentity(raw);let timer:ReturnType<typeof setTimeout>|undefined;try{const cleanup=(async()=>{const target=await this.#target(identity);return target.abortWorkspace(identity);})(),result=await Promise.race([cleanup,new Promise<never>((_,rejectTimeout)=>{timer=setTimeout(()=>rejectTimeout(Error('project-workspace-release-timeout')),this.#abortTimeoutMs);})]);
      if(!result||typeof result!=='object'||Object.keys(result).sort().join(',')!=='fenced,running'||result.fenced!==true||result.running!==false)reject('project-workspace-release-unconfirmed');
    }catch{reject('project-workspace-release-unconfirmed');}finally{if(timer!==undefined)clearTimeout(timer);}
  }
}

/** Executes Workspace restore only on ProductTurnRuntime's once-only start
 * path. Observe and cancel never recreate or re-restore a Project Sandbox. */
export class WorkspacePreparedExecutionPort implements TurnExecutionPort{
  readonly #workspace:Pick<ProjectWorkspaceLifecycle,'prepare'|'abort'>;readonly #execution:TurnExecutionPort;
  #startKey:string|null=null;#startPromise:Promise<TurnExecutionObservation>|null=null;
  constructor(workspace:Pick<ProjectWorkspaceLifecycle,'prepare'|'abort'>,execution:TurnExecutionPort){if(!workspace?.prepare||!workspace.abort||!execution?.start||!execution.observe||!execution.cancel||!execution.fenceUnresolvedStart||!execution.release)reject('workspace-prepared-execution-required');this.#workspace=workspace;this.#execution=execution;}
  async start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}):Promise<TurnExecutionObservation>{
    const executionDeadlineAt=input.executionDeadlineAt===undefined?undefined:positive(input.executionDeadlineAt);
    const identity=turnRuntimeIdentity({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation}),actor=validateActor(input.actor),base=turnBaseCheckpoints(input.base),text=message(input.message),key=await turnDigest({identity,actor,base,message:text,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt})});
    if(this.#startPromise){if(this.#startKey!==key)reject('workspace-prepared-execution-conflict');return this.#startPromise;}
    this.#startKey=key;this.#startPromise=(async()=>{
      try{await this.#workspace.prepare(identity,base);}catch(error){
        if(!(error instanceof TurnBaseUnavailableError))throw error;
        const confirmationId=`base-${(await turnDigest({schemaVersion:1,identity,reason:'turn-base-unavailable'})).slice(0,64)}`;
        return {identity,phase:'terminal',outcome:'failed',executionErrorCode:'turn-base-unavailable',events:[],stopped:{confirmationId,observedAt:Date.now(),nativeRunning:false,fenced:true}};
      }
      return this.#settle(identity,this.#execution.start({...identity,actor,message:text,base,...(executionDeadlineAt===undefined?{}:{executionDeadlineAt})}));
    })();return this.#startPromise;
  }
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);if(!this.#execution.currentObserverExecution)reject('product-turn-observer-denied');return this.#execution.currentObserverExecution(identity);}
  async #settle(_identity:TurnRuntimeIdentity,promise:Promise<TurnExecutionObservation>){return promise;}
  observe(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return this.#settle(identity,this.#execution.observe(identity));}
  cancel(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return this.#settle(identity,this.#execution.cancel(identity));}
  fenceUnresolvedStart(raw:TurnRuntimeIdentity,outcome:'failed'|'interrupted'){const identity=turnRuntimeIdentity(raw);return this.#execution.fenceUnresolvedStart(identity,outcome);}
  async release(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw),released=await this.#execution.release(identity);if(released.running)return released;await this.#workspace.abort(identity);return released;}
}
