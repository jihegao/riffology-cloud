import {turnRuntimeIdentity} from '../turn-runtime/identity.ts';
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
  #ownedLedger:SqlToolLedger|null=null;
  get #ledger(){return this.#ownedLedger??=new SqlToolLedger(this.ctx.storage);}
  get #dispatcher(){return new ToolDispatcher(this.#ledger,new ProjectSandboxFileEffects(this.env.M2_PROJECT_EFFECT_CAPABILITY_KEY,actorId=>getSandbox(this.env.PROJECT_SANDBOX,actorId,{sleepAfter:'5m'}),Date.now,this.env.WORKSPACE_AGENT?async(command,observeOnly)=>this.env.WORKSPACE_AGENT!.getByName(workspaceAgentName(command.scope.tenantId,command.scope.workspaceId)).prepareProjectTool({command,observeOnly}):undefined),new ToolArtifactMaterializer(this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR)));}
  async #settlementIdentity(value:unknown){const identity=turnRuntimeIdentity(value),name=await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId);if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');return identity;}
  async nativeAttemptSnapshot(raw:unknown){
    const identity=await this.#settlementIdentity(raw);
    const exists=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tool_commands'").toArray()[0];
    if(!exists)return {supported:false,noAddedCalls:true,admitted:null,dispatched:null};
    const rows=this.ctx.storage.sql.exec<{scope_json:string;turn_id:string;dispatch_id:string;dispatched_at:number|null}>('SELECT scope_json,turn_id,dispatch_id,dispatched_at FROM tool_commands').toArray();
    for(const row of rows)if(JSON.stringify(JSON.parse(row.scope_json))!==JSON.stringify(identity.scope)||row.turn_id!==identity.turnId||row.dispatch_id!==identity.dispatchId)throw Error('tool-bridge-ledger-scope-denied');
    return {supported:true,noAddedCalls:true,admitted:rows.length,dispatched:rows.filter(row=>row.dispatched_at!==null).length};
  }
  async closeTurnAdmission(identity:unknown){return this.#ledger.closeTurnAdmission(await this.#settlementIdentity(identity));}
  async turnSettlement(identity:unknown){return this.#ledger.turnSettlement(await this.#settlementIdentity(identity));}
  async run(input:ToolCommandIntent){
    const command=normalizeToolCommandIntent(input),name=await toolBridgeActorName(command.scope,command.turnId,command.dispatchId);
    if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');
    return this.#dispatcher.runIntentUntilSettled(command);
  }
}
