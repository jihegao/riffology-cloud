import type { TurnCheckpointPort, TurnExecutionPort } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { SandboxTrustedPiHostPort, type TrustedPiSandboxProcessApi } from './pi-native.ts';
import { TrustedPiExecutionAdapter } from './pi-execution.ts';
import { RevisionStoreCheckpointPort, type RevisionStoreRpc } from './revision-store-client.ts';
import { ProductTurnSnapshotPort } from './snapshot.ts';
import { ProjectWorkspaceLifecycle, WorkspacePreparedExecutionPort, type ProjectWorkspaceRpc } from './workspace.ts';
import { sandboxActorIds } from '../sandbox/identity.ts';
import type { TurnActor, TurnBaseCheckpoints } from '../turn/protocol.ts';

export type ProductTurnRuntimeRelease={execution:TurnExecutionPort;checkpoints:TurnCheckpointPort};

export interface ProductTurnRuntimeReleaseDependencies{
  revisions:RevisionStoreRpc;
  resolveProjectSandbox(actorId:string):ProjectWorkspaceRpc;
  resolveTrustedPiSandbox(actorId:string):TrustedPiSandboxProcessApi;
  clock?:()=>number;
}

function reject(code:string):never{throw Error(code);}
function bound(raw:TurnRuntimeIdentity,expected:TurnRuntimeIdentity):TurnRuntimeIdentity{
  const identity=turnRuntimeIdentity(raw);if(!sameTurnRuntimeIdentity(identity,expected))reject('product-turn-release-scope-denied');return identity;
}
function project(value:unknown):ProjectWorkspaceRpc{
  if(!value||typeof value!=='object'||typeof (value as ProjectWorkspaceRpc).restoreWorkspace!=='function'||typeof (value as ProjectWorkspaceRpc).freezeWorkspace!=='function'||typeof (value as ProjectWorkspaceRpc).abortWorkspace!=='function')reject('product-turn-release-project-sandbox-required');return value as ProjectWorkspaceRpc;
}
function trusted(value:unknown):TrustedPiSandboxProcessApi{
  if(!value||typeof value!=='object'||typeof (value as TrustedPiSandboxProcessApi).writeFile!=='function'||typeof (value as TrustedPiSandboxProcessApi).readFile!=='function'||typeof (value as TrustedPiSandboxProcessApi).startProcess!=='function'||typeof (value as TrustedPiSandboxProcessApi).getProcess!=='function'||typeof (value as TrustedPiSandboxProcessApi).destroy!=='function'||typeof (value as TrustedPiSandboxProcessApi).releaseState!=='function')reject('product-turn-release-trusted-pi-sandbox-required');return value as TrustedPiSandboxProcessApi;
}

/** Resolves one Trusted Pi Sandbox lazily because the actor name uses Web
 * Crypto while the Durable Object release gate must remain synchronous. The
 * first verified resolution is reused for every native operation. */
class IdentityBoundTrustedPiSandbox implements TrustedPiSandboxProcessApi{
  readonly #identity:TurnRuntimeIdentity;readonly #resolve:(actorId:string)=>TrustedPiSandboxProcessApi;#resolved:Promise<TrustedPiSandboxProcessApi>|null=null;
  constructor(identity:TurnRuntimeIdentity,resolve:(actorId:string)=>TrustedPiSandboxProcessApi){this.#identity=identity;this.#resolve=resolve;}
  #target():Promise<TrustedPiSandboxProcessApi>{return this.#resolved??=sandboxActorIds(this.#identity.scope,this.#identity.turnId,this.#identity.dispatchId).then(ids=>trusted(this.#resolve(ids.trustedPi)));}
  async writeFile(...args:Parameters<TrustedPiSandboxProcessApi['writeFile']>){return (await this.#target()).writeFile(...args);}
  async readFile(...args:Parameters<TrustedPiSandboxProcessApi['readFile']>){return (await this.#target()).readFile(...args);}
  async startProcess(...args:Parameters<TrustedPiSandboxProcessApi['startProcess']>){return (await this.#target()).startProcess(...args);}
  async getProcess(...args:Parameters<TrustedPiSandboxProcessApi['getProcess']>){return (await this.#target()).getProcess(...args);}
  async destroy(){return (await this.#target()).destroy();}
  async releaseState(){return (await this.#target()).releaseState();}
  async queryObserverExecution(raw:TurnRuntimeIdentity){const identity=bound(raw,this.#identity),target=await this.#target();if(!target.queryObserverExecution)reject('trusted-pi-observer-reader-required');return target.queryObserverExecution(identity);}
}

function bindExecution(expected:TurnRuntimeIdentity,delegate:TurnExecutionPort):TurnExecutionPort{return {
  async start(input:TurnRuntimeIdentity&{actor:TurnActor;message:string;base:TurnBaseCheckpoints;executionDeadlineAt?:number}){bound({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation},expected);return delegate.start(input);},
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=bound(raw,expected);if(!delegate.currentObserverExecution)reject('product-turn-observer-denied');return delegate.currentObserverExecution(identity);},
  async observe(identity:TurnRuntimeIdentity){return delegate.observe(bound(identity,expected));},
  async cancel(identity:TurnRuntimeIdentity){return delegate.cancel(bound(identity,expected));},
  async release(identity:TurnRuntimeIdentity){return delegate.release(bound(identity,expected));},
};}
function bindCheckpoints(expected:TurnRuntimeIdentity,delegate:TurnCheckpointPort):TurnCheckpointPort{return {
  async prepare(input){bound(input.identity,expected);return delegate.prepare(input);},
  async commit(input,intent){bound(input.identity,expected);return delegate.commit(input,intent);},
  async reconcile(identity,intent){return delegate.reconcile(bound(identity,expected),intent);},
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
  if(!dependencies||typeof dependencies!=='object'||!dependencies.revisions?.restore||!dependencies.revisions.load||!dependencies.revisions.reconcileCommit||!dependencies.revisions.commit||typeof dependencies.resolveProjectSandbox!=='function'||typeof dependencies.resolveTrustedPiSandbox!=='function'||(dependencies.clock!==undefined&&typeof dependencies.clock!=='function'))reject('product-turn-runtime-release-dependencies-required');
  const clock=dependencies.clock??Date.now,reader=dependencies.revisions;
  const workspace=new ProjectWorkspaceLifecycle(reader,actorId=>project(dependencies.resolveProjectSandbox(actorId)));
  const trustedSandbox=new IdentityBoundTrustedPiSandbox(identity,dependencies.resolveTrustedPiSandbox);
  const trustedHost=new SandboxTrustedPiHostPort(trustedSandbox,reader,clock);
  const execution=new WorkspacePreparedExecutionPort(workspace,new TrustedPiExecutionAdapter(trustedHost));
  const snapshots=new ProductTurnSnapshotPort(workspace,trustedHost);
  const checkpoints=new RevisionStoreCheckpointPort(dependencies.revisions,snapshots);
  return {execution:bindExecution(identity,execution),checkpoints:bindCheckpoints(identity,checkpoints)};
}
