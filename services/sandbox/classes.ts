import { ContainerProxy, Sandbox } from '@cloudflare/sandbox';
import { MODEL_PROXY_HOST, TOOL_BRIDGE_HOST, projectSandboxOutbound, sandboxActorIds, trustedPiOutbound, type InternalSandboxServices } from './policy.ts';
import {createObserverNativeReader} from '../turn-runtime/observer-native-read.ts';
import {readCurrentObserverExecution,trustedPiProcessId} from '../turn-runtime/pi-native.ts';
import { turnRuntimeIdentity } from '../turn-runtime/identity.ts';
import { turnBaseCheckpoints } from '../turn/protocol.ts';
import { ProjectFileEffectPort } from '../project-tools/effect.ts';
import { SandboxNativeProjectEffectPort } from '../project-tools/native.ts';
import { SqlProjectEffectSupervisor } from '../project-tools/supervisor.ts';
import { SandboxProjectWorkspacePort } from '../project-tools/workspace.ts';
import type { ToolCommandReference } from '../tools/ledger.ts';
import type { ToolCommand } from '../tools/protocol.ts';
import { verifyProjectEffectCapability, type ProjectEffectCapability } from './capability.ts';
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
  constructor(ctx:DurableObjectState<{}>,env:M2SandboxEnv){super(ctx,env);this.#turnFence=new TurnSandboxFence(ctx.storage);}
  async #assertActor(identity:ReturnType<typeof turnRuntimeIdentity>){
    if(!this.ctx.id.name||(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).trustedPi!==this.ctx.id.name)throw Error('trusted-pi-native-scope-denied');
  }
  async #destroyForFence(){await this.destroy();return {running:this.ctx.container?.running===true};}
  async writeTurnFile(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['writeFile']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.writeFile(...input),()=>this.#destroyForFence());}
  async readTurnFile(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['readFile']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.readFile(...input),()=>this.#destroyForFence());}
  async startTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.startProcess(...input),()=>this.#destroyForFence());}
  async startTurnProcessSnapshot(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['startProcess']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,async()=>{const process=await super.startProcess(...input),status=await process.getStatus(),exitCode=process.exitCode;return {id:process.id,status,...(Number.isSafeInteger(exitCode)?{exitCode}: {})};},()=>this.#destroyForFence());}
  /** Provider-free release probe. Keep the SDK Process handle inside this DO
   * and return only plain data so the caller is not coupled to an RPC target's
   * lifetime. The command and all execution options are fixed here. */
  async startLifecycleProbe(raw:Parameters<typeof turnRuntimeIdentity>[0],processId:string){
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);
    if(!/^probe-[a-f0-9]{24}$/.test(processId))throw Error('trusted-pi-lifecycle-probe-process-invalid');
    return this.#turnFence.run(identity,async()=>{
      const process=await super.startProcess('/bin/sleep 300',{processId,autoCleanup:false,timeout:300000,cwd:'/tmp',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'}});
      if(!process||process.id!==processId)throw Error('trusted-pi-lifecycle-probe-start-invalid');
      return {processId:process.id};
    },()=>this.#destroyForFence());
  }
  async getTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['getProcess']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>super.getProcess(...input),()=>this.#destroyForFence());}
  async getTurnProcessSnapshot(raw:Parameters<typeof turnRuntimeIdentity>[0],...input:Parameters<Sandbox<M2SandboxEnv>['getProcess']>){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);return this.#turnFence.run(identity,async()=>{const process=await super.getProcess(...input);if(!process)return null;const status=await process.getStatus(),exitCode=process.exitCode;return {id:process.id,status,...(Number.isSafeInteger(exitCode)?{exitCode}: {})};},()=>this.#destroyForFence());}
  async cancelTurnProcess(raw:Parameters<typeof turnRuntimeIdentity>[0],id:string){const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);if(id!==await trustedPiProcessId(identity))throw Error('trusted-pi-native-process-mismatch');return this.#turnFence.cancelOnce(identity,async()=>{const process=await super.getProcess(id);if(!process||process.id!==id||!['starting','running'].includes(await process.getStatus()))return false;await process.kill('SIGTERM');return true;});}
  /** Keep teardown and its immediate platform observation in one DO RPC.
   * Splitting these across two stub calls leaves an activation boundary
   * between destroy and the proof used by ProductTurnRuntime. */
  async destroyAndReleaseState(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    await this.#assertActor(identity);
    return this.#turnFence.fence(identity,()=>this.#destroyForFence());
  }
  /** Private, identity-bound read path. Ordinary SDK reads may create a session
   * or start a container and must not be used for Observer authorization. */
  async queryObserverExecution(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);await this.#turnFence.assertOpen(identity);
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
  #effects:ProjectFileEffectPort;
  #supervisor:SqlProjectEffectSupervisor;
  #workspace:SandboxProjectWorkspacePort;
  #turnFence:TurnSandboxFence;
  #actorId:string;
  #capabilityKey:string;
  constructor(ctx:DurableObjectState<{}>,env:M2SandboxEnv){
    super(ctx,env);
    if(!ctx.id.name)throw Error('project-sandbox-requires-named-actor');
    this.#actorId=ctx.id.name;this.#capabilityKey=env.M2_PROJECT_EFFECT_CAPABILITY_KEY;
    const native=new SandboxNativeProjectEffectPort(this);
    this.#supervisor=new SqlProjectEffectSupervisor(ctx.storage,native);
    this.#effects=new ProjectFileEffectPort(this.#supervisor);
    this.#workspace=new SandboxProjectWorkspacePort(this,this.#actorId);
    this.#turnFence=new TurnSandboxFence(ctx.storage);
  }
  async #assertActor(identity:ReturnType<typeof turnRuntimeIdentity>){
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
  }
  async #assertDispatch(identity:Pick<ReturnType<typeof turnRuntimeIdentity>,'scope'|'turnId'|'dispatchId'>){
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
  }
  async #destroyForFence(){
    let failure:unknown=null,running=true;
    try{await this.#supervisor.sealForCheckpoint();}catch(error){failure=error;}
    try{await this.destroy();running=this.ctx.container?.running===true;}catch(error){failure??=error;}
    if(failure!==null)throw failure;return {running};
  }
  /** Tool Bridge supplies a short-lived capability only after the durable Tool
   * Ledger authorizes this exact command/effect for this named actor. */
  async executeFileEffect(input:{command:ToolCommand;effectId:string;capability:ProjectEffectCapability}){
    const claims=await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.effectId,input.capability);
    await this.#assertDispatch(claims);
    return this.#turnFence.runDispatch(claims,()=>this.#effects.execute(input),()=>this.#destroyForFence());
  }
  async observeFileEffect(input:{reference:ToolCommandReference;command:ToolCommand;capability:ProjectEffectCapability}){
    const claims=await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.reference.effectId,input.capability);
    await this.#assertDispatch(claims);
    if(this.#turnFence.isDispatchFenced(claims))return this.#effects.observePersistedTerminal(input);
    return this.#turnFence.runDispatch(claims,()=>this.#effects.observe(input),()=>this.#destroyForFence());
  }
  async restoreWorkspace(...input:Parameters<SandboxProjectWorkspacePort['restoreFiles']>){const identity=turnRuntimeIdentity(input[0]);await this.#assertActor(identity);return this.#turnFence.run(identity,()=>this.#workspace.restoreFiles(...input),()=>this.#destroyForFence());}
  async freezeWorkspace(...input:Parameters<SandboxProjectWorkspacePort['frozenFiles']>){
    const identity=turnRuntimeIdentity(input[0]);turnBaseCheckpoints(input[1]);
    await this.#assertActor(identity);
    return this.#turnFence.run(identity,async()=>{await this.#supervisor.sealForCheckpoint();return this.#workspace.frozenFiles(...input);},()=>this.#destroyForFence());
  }
  async abortWorkspace(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    await this.#assertActor(identity);
    const released=await this.#turnFence.fence(identity,()=>this.#destroyForFence());
    return {...released,fenced:true as const};
  }
}

TrustedPiSandbox.outbound=(request,env,context)=>trustedPiOutbound(request,env as unknown as M2SandboxEnv,context.containerId);
ProjectToolSandbox.outbound=async()=>projectSandboxOutbound();
