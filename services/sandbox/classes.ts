import { ContainerProxy, Sandbox } from '@cloudflare/sandbox';
import { MODEL_PROXY_HOST, TOOL_BRIDGE_HOST, projectSandboxOutbound, sandboxActorIds, trustedPiOutbound, type InternalSandboxServices } from './policy.ts';
import {createObserverNativeReader} from '../turn-runtime/observer-native-read.ts';
import {readCurrentObserverExecution} from '../turn-runtime/pi-native.ts';
import { turnRuntimeIdentity } from '../turn-runtime/identity.ts';
import { turnBaseCheckpoints } from '../turn/protocol.ts';
import { ProjectFileEffectPort } from '../project-tools/effect.ts';
import { SandboxNativeProjectEffectPort } from '../project-tools/native.ts';
import { SqlProjectEffectSupervisor } from '../project-tools/supervisor.ts';
import { SandboxProjectWorkspacePort } from '../project-tools/workspace.ts';
import type { ToolCommandReference } from '../tools/ledger.ts';
import type { ToolCommand } from '../tools/protocol.ts';
import { verifyProjectEffectCapability, type ProjectEffectCapability } from './capability.ts';

export { ContainerProxy };
export interface M2SandboxEnv extends InternalSandboxServices{M2_PROJECT_EFFECT_CAPABILITY_KEY:string}

/** Trusted Pi has no project filesystem and receives no ambient Worker env. */
export class TrustedPiSandbox extends Sandbox<M2SandboxEnv>{
  override enableInternet=false;
  override interceptHttps=true;
  override allowedHosts=[MODEL_PROXY_HOST,TOOL_BRIDGE_HOST];
  override sleepAfter='5m';
  override envVars={};
  async releaseState(){return {running:this.ctx.container?.running===true};}
  /** Private, identity-bound read path. Ordinary SDK reads may create a session
   * or start a container and must not be used for Observer authorization. */
  async queryObserverExecution(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    if(!this.ctx.id.name||(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).trustedPi!==this.ctx.id.name)throw Error('trusted-pi-native-scope-denied');
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
  }
  /** Tool Bridge supplies a short-lived capability only after the durable Tool
   * Ledger authorizes this exact command/effect for this named actor. */
  async executeFileEffect(input:{command:ToolCommand;effectId:string;capability:ProjectEffectCapability}){
    await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.effectId,input.capability);
    return this.#effects.execute(input);
  }
  async observeFileEffect(input:{reference:ToolCommandReference;command:ToolCommand;capability:ProjectEffectCapability}){
    await verifyProjectEffectCapability(this.#capabilityKey,this.#actorId,input.command,input.reference.effectId,input.capability);
    return this.#effects.observe(input);
  }
  async restoreWorkspace(...input:Parameters<SandboxProjectWorkspacePort['restoreFiles']>){return this.#workspace.restoreFiles(...input);}
  async freezeWorkspace(...input:Parameters<SandboxProjectWorkspacePort['frozenFiles']>){
    const identity=turnRuntimeIdentity(input[0]);turnBaseCheckpoints(input[1]);
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
    await this.#supervisor.sealForCheckpoint();
    return this.#workspace.frozenFiles(...input);
  }
  async abortWorkspace(raw:Parameters<typeof turnRuntimeIdentity>[0]){
    const identity=turnRuntimeIdentity(raw);
    if((await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project!==this.#actorId)throw Error('project-workspace-actor-scope-denied');
    await this.#supervisor.sealForCheckpoint();
    await this.destroy();
    return {running:this.ctx.container?.running===true,fenced:true as const};
  }
}

TrustedPiSandbox.outbound=(request,env,context)=>trustedPiOutbound(request,env as unknown as M2SandboxEnv,context.containerId);
ProjectToolSandbox.outbound=async()=>projectSandboxOutbound();
