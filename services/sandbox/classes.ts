import {nativeAttemptSnapshot,recordNativeAttempt,execAttemptTag,bindNativeOwner,NATIVE_OWNER_KEY} from '../g4-native-counts.ts';
import {WorkspaceNativeHost} from './workspace-native-host.ts';
import {historicalWorkspaceBinding,type WorkspaceSandboxBinding,type WorkspaceSandboxLease} from './workspace-binding.ts';
import type {WorkspaceNativeOptions} from './workspace-native.ts';
import type {WorkspaceAgent} from '../workspace/durable.ts';
import {ProjectPreparationLedger} from '../project-tools/preparation.ts';
import { ContainerProxy, Sandbox } from '@cloudflare/sandbox';
import { MODEL_PROXY_HOST, TOOL_BRIDGE_HOST, projectSandboxOutbound, sandboxActorIds, trustedPiOutbound, type InternalSandboxServices } from './policy.ts';
import {createObserverNativeReader} from '../turn-runtime/observer-native-read.ts';
import {readCurrentObserverExecution,trustedPiProcessId} from '../turn-runtime/pi-native.ts';
import { sameTurnRuntimeIdentity,turnRuntimeIdentity,type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import { turnBaseCheckpoints } from '../turn/protocol.ts';
import { persistedProjectEffectReceipt,ProjectFileEffectPort } from '../project-tools/effect.ts';
import { SandboxNativeProjectEffectPort } from '../project-tools/native.ts';
import { readPersistedProjectEffectTerminal,SqlProjectEffectSupervisor } from '../project-tools/supervisor.ts';
import { SandboxProjectWorkspacePort } from '../project-tools/workspace.ts';
import type { ToolCommandReference } from '../tools/ledger.ts';
import type { ToolCommand } from '../tools/protocol.ts';
import { verifyProjectEffectCapability, type ProjectEffectCapability } from './capability.ts';
import {workspaceBindingStorage} from './workspace-native.ts';
import { TurnSandboxFence } from './turn-fence.ts';

export { ContainerProxy };
export interface M2SandboxEnv extends InternalSandboxServices{M2_PROJECT_EFFECT_CAPABILITY_KEY:string}

/** Trusted Pi has no project filesystem and receives no ambient Worker env. */
export class TrustedPiSandbox extends Sandbox<M2SandboxEnv>{
  override enableInternet=false;
  override interceptHttps=true;
  override allowedHosts=[MODEL_PROXY_HOST,TOOL_BRIDGE_HOST];
  override sleepAfter='5m';
  override envVars={};
  #turnFence:TurnSandboxFence;
  #warm:WorkspaceNativeHost<'trustedPi'>;
  constructor(ctx:DurableObjectState<{}>,env:M2SandboxEnv){super(ctx,env);this.#turnFence=new TurnSandboxFence(ctx.storage);this.#warm=new WorkspaceNativeHost('trustedPi',{sandbox:this as unknown as WorkspaceNativeOptions['sandbox'],storage:ctx.storage,actorId:ctx.id.name??'',running:()=>ctx.container?.running===true,queryObserverExecution:identity=>readCurrentObserverExecution(createObserverNativeReader(ctx.container,Date.now()+5000),identity)},name=>{const owner=env.WORKSPACE_AGENT?.getByName(name);if(!owner)throw Error('workspace-native-owner-required');return owner as unknown as WorkspaceAgent;});}
  override async startAndWaitForPorts(...input:Parameters<Sandbox<M2SandboxEnv>['startAndWaitForPorts']>){recordNativeAttempt(this.ctx.storage,'init');await this.ctx.storage.sync();return super.startAndWaitForPorts(...input);}
  override async exec(...input:Parameters<Sandbox<M2SandboxEnv>['exec']>){recordNativeAttempt(this.ctx.storage,execAttemptTag(input[0]));await this.ctx.storage.sync();return super.exec(...input);}
  override async startProcess(...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){if(input[0].includes('/trusted-pi-turn-host.mjs'))recordNativeAttempt(this.ctx.storage,'taskStart');recordNativeAttempt(this.ctx.storage,'startProcess');await this.ctx.storage.sync();return super.startProcess(...input);}
  async nativeAttemptSnapshot(raw:unknown){
    const identity=turnRuntimeIdentity(raw),owner=this.ctx.storage.kv.get(NATIVE_OWNER_KEY),config=this.ctx.storage.kv.get<{context:{identity:unknown}}>('workspace-native-configuration'),fence=this.ctx.storage.kv.get<{identity?:unknown;dispatch?:unknown;sessionId?:string}>('turn-sandbox-fence-v1');
    const bound=config?.context.identity??owner??fence?.identity??(fence?.dispatch&&fence.sessionId?{...(fence.dispatch as object),sessionId:fence.sessionId}:null);
    if(!bound||JSON.stringify(turnRuntimeIdentity(bound))!==JSON.stringify(identity))throw Error('sandbox-counter-owner-denied');
    return nativeAttemptSnapshot(this.ctx.storage,this.ctx.id.toString());
  }
  async configureWorkspaceBinding(input:{context:WorkspaceSandboxBinding;deadlineAt:number}){return this.#warm.configure(input);}
  async sealWorkspaceBinding(context:WorkspaceSandboxBinding){return this.#warm.seal(context);}
  async pruneWorkspaceBinding(context:WorkspaceSandboxBinding,value:string){return this.#warm.prune(context,value);}
  async destroyWorkspaceBinding(context:WorkspaceSandboxBinding){return this.#warm.destroy(context);}
  async destroyWorkspaceLease(lease:WorkspaceSandboxBinding['lease']){return this.#warm.destroyLease(lease);}
  async #assertActor(identity:ReturnType<typeof turnRuntimeIdentity>){
    if(!this.ctx.id.name||(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).trustedPi!==this.ctx.id.name)throw Error('trusted-pi-native-scope-denied');
    bindNativeOwner(this.ctx.storage,identity);await this.ctx.storage.sync();
  }
  async #destroyForFence(){await this.destroy();return {running:this.ctx.container?.running===true};}
  async writeTurnFile(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['writeFile']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).writeTurnFile(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['writeTurnFile']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.writeFile(...input),()=>this.#destroyForFence());}
  async readTurnFile(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['readFile']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).readTurnFile(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['readTurnFile']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.readFile(...input),()=>this.#destroyForFence());}
  async startTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).startTurnProcess(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['startTurnProcess']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.runStart(identity,()=>this.startProcess(...input),()=>this.#destroyForFence());}
  async startTurnProcessSnapshot(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).startTurnProcessSnapshot(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['startTurnProcessSnapshot']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.runStart(identity,async()=>{const process=await this.startProcess(...input),status=await process.getStatus(),exitCode=process.exitCode;return {id:process.id,status,...(Number.isSafeInteger(exitCode)?{exitCode}: {})};},()=>this.#destroyForFence());}
  /** Provider-free release probe. Keep the SDK Process handle inside this DO
   * and return only plain data so the caller is not coupled to an RPC target's
   * lifetime. The command and all execution options are fixed here. */
  async startLifecycleProbe(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);
    const match=/^probe-([a-f0-9]{24})$/.exec(identity.scope.tenantId),token=match?.[1],suffix=identity.turnId.endsWith('-a')?'a':identity.turnId.endsWith('-b')?'b':null;
    if(!token||!suffix||identity.scope.projectId!==`probe-${token}`||identity.scope.workspaceId!==`probe-${token}`||identity.scope.workspaceGeneration!==1||identity.sessionId!==`session-${token}`||identity.turnId!==`turn-${token}-${suffix}`||identity.dispatchId!==`dispatch-${token}-${suffix}`||identity.generation!==1)throw Error('trusted-pi-lifecycle-probe-identity-invalid');
    const processId=`probe-${token}`;
    return this.#turnFence.runStart(identity,async()=>{
      recordNativeAttempt(this.ctx.storage,'taskStart');await this.ctx.storage.sync();const process=await this.startProcess('/bin/sleep 300',{processId,autoCleanup:false,timeout:300000,cwd:'/tmp',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'}});
      if(!process||process.id!==processId)throw Error('trusted-pi-lifecycle-probe-start-invalid');
      const status=await process.getStatus(),containerRunning=this.ctx.container?.running===true;
      if(status!=='running'||!containerRunning)throw Error('trusted-pi-lifecycle-probe-start-unconfirmed');
      return {processId:process.id,status,containerRunning};
    },()=>this.#destroyForFence());
  }
  async getTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['getProcess']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).getTurnProcess(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['getTurnProcess']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.getProcess(...input),()=>this.#destroyForFence());}
  async getTurnProcessSnapshot(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['getProcess']>){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).getTurnProcessSnapshot(identity,...input as Parameters<import('./workspace-native.ts').WorkspaceTrustedPiNativeController['getTurnProcessSnapshot']> extends [unknown,...infer R]?R:never);await this.#assertActor(identity);return this.#turnFence.run(identity,async()=>{const process=await super.getProcess(...input);if(!process)return null;const status=await process.getStatus(),exitCode=process.exitCode;return {id:process.id,status,...(Number.isSafeInteger(exitCode)?{exitCode}: {})};},()=>this.#destroyForFence());}
  async cancelTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],id:string){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).cancelTurnProcess(identity,id);await this.#assertActor(identity);if(id!==await trustedPiProcessId(identity))throw Error('trusted-pi-native-process-mismatch');return this.#turnFence.cancelOnce(identity,async()=>{const process=await super.getProcess(id);if(!process||process.id!==id||!['starting','running'].includes(await process.getStatus()))return false;await process.kill('SIGTERM');return true;});}
  /** Keep teardown and its immediate platform observation in one DO RPC.
   * Splitting these across two stub calls leaves an activation boundary
   * between destroy and the proof used by ProductTurnRuntime. */
  async destroyAndReleaseState(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).destroyAndReleaseState(identity);
    await this.#assertActor(identity);
    return this.#turnFence.fence(identity,()=>this.#destroyForFence());
  }
  /** Private, identity-bound read path. Ordinary SDK reads may create a session
   * or start a container and must not be used for Observer authorization. */
  async queryObserverExecution(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).queryObserverExecution(identity);await this.#assertActor(identity);await this.#turnFence.assertOpen(identity);
    return readCurrentObserverExecution(createObserverNativeReader(this.ctx.container,Date.now()+5000),identity);
  }
}
/** Project code owns /workspace but receives no Pi session, model capability,
 * service binding or public network. */
export class ProjectToolSandbox extends Sandbox<M2SandboxEnv>{
  override enableInternet=false;
  override allowedHosts:string[]=[];
  override sleepAfter='5m';
  override envVars={};
  #preparation:ProjectPreparationLedger;
  #ownedEffects:ProjectFileEffectPort|null=null;
  #ownedSupervisor:SqlProjectEffectSupervisor|null=null;
  get #supervisor(){return this.#ownedSupervisor??=new SqlProjectEffectSupervisor(this.ctx.storage,new SandboxNativeProjectEffectPort(this));}
  get #effects(){return this.#ownedEffects??=new ProjectFileEffectPort(this.#supervisor);}
  #workspace:SandboxProjectWorkspacePort;
  #turnFence:TurnSandboxFence;
  #warm:WorkspaceNativeHost<'project'>;
  #actorId:string;
  #capabilityKey:string;
  constructor(ctx:DurableObjectState<{}>,env:M2SandboxEnv){
    super(ctx,env);
    if(!ctx.id.name)throw Error('project-sandbox-requires-named-actor');
    this.#preparation=new ProjectPreparationLedger(ctx.storage,()=>ctx.container?.running===true);
    this.#actorId=ctx.id.name;this.#capabilityKey=env.M2_PROJECT_EFFECT_CAPABILITY_KEY;
    this.#warm=new WorkspaceNativeHost('project',{sandbox:this as unknown as WorkspaceNativeOptions['sandbox'],storage:ctx.storage,actorId:this.#actorId,running:()=>ctx.container?.running===true,capabilityKey:this.#capabilityKey},name=>{const owner=env.WORKSPACE_AGENT?.getByName(name);if(!owner)throw Error('workspace-native-owner-required');return owner as unknown as WorkspaceAgent;});
    this.#workspace=new SandboxProjectWorkspacePort(this,this.#actorId);
    this.#turnFence=new TurnSandboxFence(ctx.storage);
  }
  override async startAndWaitForPorts(...input:Parameters<Sandbox<M2SandboxEnv>['startAndWaitForPorts']>){recordNativeAttempt(this.ctx.storage,'init');await this.ctx.storage.sync();return super.startAndWaitForPorts(...input);}
  override async exec(...input:Parameters<Sandbox<M2SandboxEnv>['exec']>){recordNativeAttempt(this.ctx.storage,execAttemptTag(input[0]));await this.ctx.storage.sync();return super.exec(...input);}
  override async startProcess(...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){if(input[0].includes('/trusted-pi-turn-host.mjs'))recordNativeAttempt(this.ctx.storage,'taskStart');recordNativeAttempt(this.ctx.storage,'startProcess');await this.ctx.storage.sync();return super.startProcess(...input);}
  async nativeAttemptSnapshot(raw:unknown){
    const identity=turnRuntimeIdentity(raw),owner=this.ctx.storage.kv.get(NATIVE_OWNER_KEY),config=this.ctx.storage.kv.get<{context:{identity:unknown}}>('workspace-native-configuration'),fence=this.ctx.storage.kv.get<{identity?:unknown;dispatch?:unknown;sessionId?:string}>('turn-sandbox-fence-v1');
    const bound=config?.context.identity??owner??fence?.identity??(fence?.dispatch&&fence.sessionId?{...(fence.dispatch as object),sessionId:fence.sessionId}:null);
    if(!bound||JSON.stringify(turnRuntimeIdentity(bound))!==JSON.stringify(identity))throw Error('sandbox-counter-owner-denied');
    return nativeAttemptSnapshot(this.ctx.storage,this.ctx.id.toString());
  }
  async configureWorkspaceBinding(input:{context:WorkspaceSandboxBinding;deadlineAt:number}){return this.#warm.configure(input);}
  async sealWorkspaceBinding(context:WorkspaceSandboxBinding){return this.#warm.seal(context);}
  async pruneWorkspaceBinding(context:WorkspaceSandboxBinding,value:string){return this.#warm.prune(context,value);}
  async destroyWorkspaceBinding(context:WorkspaceSandboxBinding){return this.#warm.destroy(context);}
  async destroyWorkspaceLease(lease:WorkspaceSandboxBinding['lease']){return this.#warm.destroyLease(lease);}
  async #assertActor(identity:ReturnType<typeof turnRuntimeIdentity>){
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
    bindNativeOwner(this.ctx.storage,identity);await this.ctx.storage.sync();
  }
  async #assertDispatch(identity:Pick<ReturnType<typeof turnRuntimeIdentity>,'scope'|'turnId'|'dispatchId'>){
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
  }
  async #destroyForFence(){
    // The durable Turn fence already closes admission. Destruction stops the
    // whole environment; starting a seal process here could recreate an absent
    // container. Snapshotting separately requires native writer quiescence.
    await this.destroy();return {running:this.ctx.container?.running===true};
  }
  /** Tool Bridge supplies a short-lived capability only after the durable Tool
   * Ledger authorizes this exact command/effect for this named actor. */
  async executeFileEffect(input:{command:ToolCommand;effectId:string;capability:ProjectEffectCapability}){
    if(this.#warm.warm)return (await this.#warm.forDispatch(input.command)).executeFileEffect(input);
    const claims=await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.effectId,input.capability);
    await this.#assertDispatch(claims);
    return this.#turnFence.runDispatch(claims,()=>{this.#preparation.assertDispatchUsable(claims);return this.#effects.execute(input);},()=>this.#destroyForFence());
  }
  async observeFileEffect(input:{reference:ToolCommandReference;command:ToolCommand;capability:ProjectEffectCapability}){
    if(this.#warm.warm)return (await this.#warm.forDispatch(input.command,true)).observeFileEffect(input);
    const claims=await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.reference.effectId,input.capability);
    await this.#assertDispatch(claims);
    if(this.#turnFence.isDispatchFenced(claims))return this.#effects.observePersistedTerminal(input);
    return this.#turnFence.runDispatch(claims,()=>{this.#preparation.assertDispatchUsable(claims);return this.#effects.observe(input);},()=>this.#destroyForFence());
  }
  async readPersistedFileEffectTerminal(input:{identity:TurnRuntimeIdentity;reference:ToolCommandReference;command:ToolCommand;capability:ProjectEffectCapability;warm:null|{lease:WorkspaceSandboxLease;bindingEpoch:number}}){
    const identity=turnRuntimeIdentity(input.identity);
    const claims=await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.reference.effectId,input.capability);
    if(!sameTurnRuntimeIdentity(identity,{scope:claims.scope,sessionId:identity.sessionId,turnId:claims.turnId,dispatchId:claims.dispatchId,generation:claims.scope.workspaceGeneration}))throw Error('project-effect-identity-denied');
    let storage:Pick<DurableObjectStorage,'sql'>=this.ctx.storage;
    if(input.warm){const historical=await historicalWorkspaceBinding(this.ctx.storage,{identity,lease:input.warm.lease,bindingEpoch:input.warm.bindingEpoch},this.#actorId,'project');if(!historical)return null;storage=workspaceBindingStorage(this.ctx.storage,historical.bindingEpoch);}
    else await this.#assertDispatch(claims);
    const observed=readPersistedProjectEffectTerminal(storage,input.reference.effectId);if(!observed)return null;
    return await persistedProjectEffectReceipt({reference:input.reference,command:input.command,observation:observed});
  }
  async prepareWorkspaceOnce(identity:ReturnType<typeof turnRuntimeIdentity>,base:Parameters<SandboxProjectWorkspacePort['restoreFiles']>[1],archive:Uint8Array|null,operationId:string,deadlineAt:number){
    identity=turnRuntimeIdentity(identity);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).prepareWorkspaceOnce(identity,base,archive,operationId,deadlineAt);await this.#assertActor(identity);
    return this.#turnFence.run(identity,()=>this.#preparation.prepare(identity,base,operationId,deadlineAt,()=>this.#workspace.restoreFiles(identity,base,archive,deadlineAt)),()=>this.#destroyForFence());
  }
  async observeWorkspacePreparation(raw:ReturnType<typeof turnRuntimeIdentity>,operationId:string){const identity=turnRuntimeIdentity(raw);if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).observeWorkspacePreparation(identity,operationId);await this.#assertActor(identity);return this.#preparation.observe(identity,operationId);}
  async restoreWorkspace(...input:Parameters<SandboxProjectWorkspacePort['restoreFiles']>){const identity=turnRuntimeIdentity(input[0]);if(this.#warm.warm)return (await this.#warm.forIdentity(identity)).restoreWorkspace(identity,input[1],input[2]);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>this.#workspace.restoreFiles(...input),()=>this.#destroyForFence());}
  async freezeWorkspace(...input:Parameters<SandboxProjectWorkspacePort['frozenFiles']>){
    const identity=turnRuntimeIdentity(input[0]);turnBaseCheckpoints(input[1]);
    if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).freezeWorkspace(identity,input[1]);
    await this.#assertActor(identity);
    return this.#turnFence.run(identity,async()=>{this.#preparation.assertUsable(identity);await this.#supervisor.sealForCheckpoint();return this.#workspace.frozenFiles(...input);},()=>this.#destroyForFence());
  }
  async abortWorkspace(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    if(this.#warm.warm)return (await this.#warm.forIdentity(identity,true)).abortWorkspace(identity);
    await this.#assertActor(identity);
    await this.#preparation.close(identity);
    const released=await this.#turnFence.fence(identity,()=>this.#destroyForFence());
    return {...released,fenced:true as const};
  }
}

TrustedPiSandbox.outbound=(request,env,context)=>trustedPiOutbound(request,env as unknown as M2SandboxEnv,context.containerId);
ProjectToolSandbox.outbound=async()=>projectSandboxOutbound();
