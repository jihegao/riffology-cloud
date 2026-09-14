import {workspaceAgentName} from '../workspace/protocol.ts';
import type {WorkspaceAgent} from '../workspace/durable.ts';
import { DurableObject } from 'cloudflare:workers';
import { getSandbox } from '@cloudflare/sandbox';
import type { ProjectToolSandbox } from '../sandbox/classes.ts';
import { ToolDispatcher } from './dispatcher.ts';
import { toolBridgeActorName } from './identity.ts';
import { SqlToolLedger } from './ledger.ts';
import { ProjectSandboxFileEffects } from './project-sandbox.ts';
import { normalizeToolCommandIntent, type ToolCommandIntent } from './protocol.ts';
import { ToolArtifactMaterializer } from '../artifacts/materializer.ts';
import { TOOL_ARTIFACT_STORE_ACTOR, type ToolArtifactStoreNamespace } from '../artifacts/protocol.ts';

export interface ToolBridgeEnv{
  WORKSPACE_AGENT?:DurableObjectNamespace<WorkspaceAgent>;
  TOOL_BRIDGE_AGENT:DurableObjectNamespace<ToolBridgeAgent>;
  PROJECT_SANDBOX:DurableObjectNamespace<ProjectToolSandbox>;
  TOOL_ARTIFACT_STORE:ToolArtifactStoreNamespace;
  M2_PROJECT_EFFECT_CAPABILITY_KEY:string;
}

/** One internal actor owns the durable Tool Ledger for one immutable Turn
 * dispatch. Public HTTP and project code receive neither this namespace nor
 * the capability signing key. */
export class ToolBridgeAgent extends DurableObject<ToolBridgeEnv>{
  #dispatcher=new ToolDispatcher(new SqlToolLedger(this.ctx.storage),new ProjectSandboxFileEffects(this.env.M2_PROJECT_EFFECT_CAPABILITY_KEY,actorId=>getSandbox(this.env.PROJECT_SANDBOX,actorId,{sleepAfter:'5m'}),Date.now,this.env.WORKSPACE_AGENT?async(command,observeOnly)=>this.env.WORKSPACE_AGENT!.getByName(workspaceAgentName(command.scope.tenantId,command.scope.workspaceId)).prepareProjectTool({command,observeOnly}):undefined),new ToolArtifactMaterializer(this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR)));
  async run(input:ToolCommandIntent){
    const command=normalizeToolCommandIntent(input),name=await toolBridgeActorName(command.scope,command.turnId,command.dispatchId);
    if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');
    return this.#dispatcher.runIntentUntilSettled(command);
  }
}
