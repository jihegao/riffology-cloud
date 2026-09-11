import type { TurnCheckpointPort, TurnExecutionPort } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { SandboxTrustedPiHostPort, type TrustedPiProcessSnapshot, type TrustedPiProcessView, type TrustedPiSandboxActorApi, type TrustedPiSandboxProcessApi } from './pi-native.ts';
import { TrustedPiExecutionAdapter } from './pi-execution.ts';
import { RevisionStoreCheckpointPort, type RevisionStoreRpc } from './revision-store-client.ts';
import { ProductTurnSnapshotPort } from './snapshot.ts';
import { ProjectWorkspaceLifecycle, WorkspacePreparedExecutionPort, type ProjectWorkspaceRpc } from './workspace.ts';
import { sandboxActorIds } from '../sandbox/identity.ts';
import type { TurnActor, TurnBaseCheckpoints } from '../turn/protocol.ts';
import type { TrustedPiCapacityPort } from '../capacity/client.ts';
import type { TurnOperationTrace } from '../turn/operation-telemetry.ts';

export type ProductTurnRuntimeRelease={execution:TurnExecutionPort;checkpoints:TurnCheckpointPort;capacity?:TrustedPiCapacityPort|null;trace?:TurnOperationTrace};

export interface ProductTurnRuntimeReleaseDependencies{
  revisions:RevisionStoreRpc;
  resolveProjectSandbox(actorId:string):ProjectWorkspaceRpc;
  resolveTrustedPiSandbox(actorId:string):TrustedPiSandboxActorApi;
  capacity?:TrustedPiCapacityPort|null;
  clock?:()=>number;
  trace?:TurnOperationTrace;
}

function reject(code:string):never{throw Error(code);}
function bound(raw:TurnRuntimeIdentity,expected:TurnRuntimeIdentity):TurnRuntimeIdentity{
  const identity=turnRuntimeIdentity(raw);if(!sameTurnRuntimeIdentity(identity,expected))reject('product-turn-release-scope-denied');return identity;
}
function project(value:unknown):ProjectWorkspaceRpc{
  if(!value||typeof value!=='object'||typeof (value as ProjectWorkspaceRpc).restoreWorkspace!=='function'||typeof (value as ProjectWorkspaceRpc).freezeWorkspace!=='function'||typeof (value as ProjectWorkspaceRpc).abortWorkspace!=='function')reject('product-turn-release-project-sandbox-required');return value as ProjectWorkspaceRpc;
}
function trusted(value:unknown):TrustedPiSandboxActorApi{
  const actor=value as TrustedPiSandboxActorApi;
  if(!value||typeof value!=='object'||typeof actor.writeTurnFile!=='function'||typeof actor.readTurnFile!=='function'||typeof actor.startTurnProcess!=='function'||typeof actor.getTurnProcess!=='function'||typeof actor.startTurnProcessSnapshot!=='function'||typeof actor.getTurnProcessSnapshot!=='function'||typeof actor.cancelTurnProcess!=='function'||typeof actor.destroyAndReleaseState!=='function')reject('product-turn-release-trusted-pi-sandbox-required');return actor;
}
function processSnapshot(value:unknown,cancel:(id:string,signal?:string)=>Promise<void>):TrustedPiProcessView{
  const raw=value as TrustedPiProcessSnapshot,keys=raw&&typeof raw==='object'&&!Array.isArray(raw)&&Number.isSafeInteger(raw.exitCode)?['id','status','exitCode']:['id','status'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key))||typeof raw.id!=='string'||raw.id.length<1||typeof raw.status!=='string'||raw.status.length<1||(Object.hasOwn(raw,'exitCode')&&!Number.isSafeInteger(raw.exitCode)))reject('invalid-trusted-pi-process-snapshot');
  const snapshot={id:raw.id,status:raw.status,...(Object.hasOwn(raw,'exitCode')?{exitCode:raw.exitCode}: {})};
  return {...snapshot,async getStatus(){return snapshot.status;},async kill(signal?:string){await cancel(snapshot.id,signal);}};
}

/** Resolves one Trusted Pi Sandbox lazily because the actor name uses Web
 * Crypto while the Durable Object release gate must remain synchronous. The
 * first verified resolution is reused for every native operation. */
class IdentityBoundTrustedPiSandbox implements TrustedPiSandboxProcessApi{
  readonly #identity:TurnRuntimeIdentity;readonly #resolve:(actorId:string)=>TrustedPiSandboxActorApi;#resolved:Promise<TrustedPiSandboxActorApi>|null=null;
  constructor(identity:TurnRuntimeIdentity,resolve:(actorId:string)=>TrustedPiSandboxActorApi){this.#identity=identity;this.#resolve=resolve;}
  #target():Promise<TrustedPiSandboxActorApi>{return this.#resolved??=sandboxActorIds(this.#identity.scope,this.#identity.turnId,this.#identity.dispatchId).then(ids=>trusted(this.#resolve(ids.trustedPi)));}
  async writeFile(...args:Parameters<TrustedPiSandboxProcessApi['writeFile']>){return (await this.#target()).writeTurnFile(this.#identity,...args);}
  async readFile(...args:Parameters<TrustedPiSandboxProcessApi['readFile']>){return (await this.#target()).readTurnFile(this.#identity,...args);}
  async startProcess(...args:Parameters<TrustedPiSandboxProcessApi['startProcess']>){const target=await this.#target();return processSnapshot(await target.startTurnProcessSnapshot(this.#identity,...args),async(id,signal)=>{if(signal!==undefined&&signal!=='SIGTERM')reject('trusted-pi-native-cancel-signal-invalid');await target.cancelTurnProcess(this.#identity,id);});}
  async getProcess(...args:Parameters<TrustedPiSandboxProcessApi['getProcess']>){const target=await this.#target(),value=await target.getTurnProcessSnapshot(this.#identity,...args);return value===null?null:processSnapshot(value,async(id,signal)=>{if(signal!==undefined&&signal!=='SIGTERM')reject('trusted-pi-native-cancel-signal-invalid');await target.cancelTurnProcess(this.#identity,id);});}
  async cancelProcessOnce(id:string){return (await this.#target()).cancelTurnProcess(this.#identity,id);}
  async destroyAndReleaseState(){return (await this.#target()).destroyAndReleaseState(this.#identity);}
  async queryObserverExecution(raw:TurnRuntimeIdentity){const identity=bound(raw,this.#identity),target=await this.#target();if(!target.queryObserverExecution)reject('trusted-pi-observer-reader-required');return target.queryObserverExecution(identity);}
}

function bindExecution(expected:TurnRuntimeIdentity,delegate:TurnExecutionPort):TurnExecutionPort{return {
  async start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}){bound({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation},expected);return delegate.start(input);},
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=bound(raw,expected);if(!delegate.currentObserverExecution)reject('product-turn-observer-denied');return delegate.currentObserverExecution(identity);},
  async observe(identity:TurnRuntimeIdentity){return delegate.observe(bound(identity,expected));},
  async cancel(identity:TurnRuntimeIdentity){return delegate.cancel(bound(identity,expected));},
  async fenceUnresolvedStart(identity:TurnRuntimeIdentity,outcome:'failed'|'interrupted'){return delegate.fenceUnresolvedStart(bound(identity,expected),outcome);},
  async release(identity:TurnRuntimeIdentity){return delegate.release(bound(identity,expected));},
};}
function bindCheckpoints(expected:TurnRuntimeIdentity,delegate:TurnCheckpointPort):TurnCheckpointPort{return {
  async prepare(input){bound(input.identity,expected);return delegate.prepare(input);},
  async commit(input,intent){bound(input.identity,expected);return delegate.commit(input,intent);},
  async reconcile(identity,intent){return delegate.reconcile(bound(identity,expected),intent);},
  async abandon(identity,intent){const verified=bound(identity,expected);if(!delegate.abandon)reject('product-turn-checkpoint-abandon-required');return delegate.abandon(verified,intent);},
};}

/** Candidate production assembly for one identity-bound ProductTurnRuntime.
 * It restores only verified R2 workspace/session bases, runs Trusted Pi in its
 * derived Sandbox, and freezes both artifacts into one immutable Revision.
 * Provider configuration remains a separate Trusted Pi release gate. */
export function assembleProductTurnRuntimeRelease(
  rawIdentity:TurnRuntimeIdentity,
  dependencies:ProductTurnRuntimeReleaseDependencies,
):ProductTurnRuntimeRelease{
  const identity=turnRuntimeIdentity(rawIdentity);
  if(!dependencies||typeof dependencies!=='object'||!dependencies.revisions?.restore||!dependencies.revisions.load||!dependencies.revisions.reconcileCommit||!dependencies.revisions.commit||typeof dependencies.resolveProjectSandbox!=='function'||typeof dependencies.resolveTrustedPiSandbox!=='function'||(dependencies.capacity!==undefined&&dependencies.capacity!==null&&(!dependencies.capacity.lookup||!dependencies.capacity.dispatch||!dependencies.capacity.confirmReleased))||(dependencies.clock!==undefined&&typeof dependencies.clock!=='function'))reject('product-turn-runtime-release-dependencies-required');
  const clock=dependencies.clock??Date.now,reader=dependencies.revisions;
  const workspace=new ProjectWorkspaceLifecycle(reader,actorId=>project(dependencies.resolveProjectSandbox(actorId)));
  const trustedSandbox=new IdentityBoundTrustedPiSandbox(identity,dependencies.resolveTrustedPiSandbox);
  const trustedHost=new SandboxTrustedPiHostPort(trustedSandbox,reader,clock,undefined,dependencies.trace);
  const execution=new WorkspacePreparedExecutionPort(workspace,new TrustedPiExecutionAdapter(trustedHost));
  const snapshots=new ProductTurnSnapshotPort(workspace,trustedHost);
  const checkpoints=new RevisionStoreCheckpointPort(dependencies.revisions,snapshots);
  return {execution:bindExecution(identity,execution),checkpoints:bindCheckpoints(identity,checkpoints),capacity:dependencies.capacity??null,trace:dependencies.trace};
}
