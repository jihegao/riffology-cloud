import {sameScope,scope as validateScope,turnId} from '../turn/protocol.ts';
import {turnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {WorkspaceAgent} from '../workspace/durable.ts';
import { DurableObject } from 'cloudflare:workers';
import { getSandbox } from '@cloudflare/sandbox';
import type { ProjectToolSandbox } from '../sandbox/classes.ts';
import { ToolDispatcher } from './dispatcher.ts';
import { toolBridgeActorName } from './identity.ts';
import { readExistingToolCommand,SqlToolLedger,toolCommandReference } from './ledger.ts';
import { ProjectSandboxFileEffects } from './project-sandbox.ts';
import { normalizeToolCommandIntent, type ToolCommandIntent } from './protocol.ts';
import { ToolArtifactMaterializer } from '../artifacts/materializer.ts';
import { TOOL_ARTIFACT_STORE_ACTOR, type ToolArtifactStoreNamespace } from '../artifacts/protocol.ts';
import {g5RepairFixtureProof} from './g5-fixture-authority.ts';
import {issueProjectEffectCapability} from '../sandbox/capability.ts';
import {sandboxActorIds} from '../sandbox/policy.ts';
import {workspaceSandboxActor,type WorkspaceSandboxLease} from '../sandbox/workspace-binding.ts';
import {publicToolReceipt,toolReceiptCallId,toolReceiptName,toolReceiptOperation} from './receipt.ts';

export interface ToolBridgeEnv{
  WORKSPACE_AGENT?:DurableObjectNamespace<WorkspaceAgent>;
  TOOL_BRIDGE_AGENT:DurableObjectNamespace<ToolBridgeAgent>;
  PROJECT_SANDBOX:DurableObjectNamespace<ProjectToolSandbox>;
  TOOL_ARTIFACT_STORE:ToolArtifactStoreNamespace;
  M2_PROJECT_EFFECT_CAPABILITY_KEY:string;
}
type G5FixtureWorkspaceAuthority={identity:ReturnType<typeof turnRuntimeIdentity>;requestKey:string;source:{revisionId:string|null;filesSha256:string;specSha256:string};checkpointFilesSha256:string;events:Array<{eventId:string;type:string;payload:Record<string,unknown>}>};
type ReceiptTarget={actorId:string;warm:null|{lease:WorkspaceSandboxLease;bindingEpoch:number}};

/** One internal actor owns the durable Tool Ledger for one immutable Turn
 * dispatch. Public HTTP and project code receive neither this namespace nor
 * the capability signing key. */
export class ToolBridgeAgent extends DurableObject<ToolBridgeEnv>{
  #ownedLedger:SqlToolLedger|null=null;
  get #ledger(){return this.#ownedLedger??=new SqlToolLedger(this.ctx.storage);}
  get #dispatcher(){
    const files=new ProjectSandboxFileEffects(this.env.M2_PROJECT_EFFECT_CAPABILITY_KEY,actorId=>getSandbox(this.env.PROJECT_SANDBOX,actorId,{sleepAfter:'5m'}),Date.now,this.env.WORKSPACE_AGENT?async(command,observeOnly)=>this.env.WORKSPACE_AGENT!.getByName(workspaceAgentName(command.scope.tenantId,command.scope.workspaceId)).prepareProjectTool({command,observeOnly}):undefined);
    const draft=(command:import('./protocol.ts').ToolCommand,effectId:string,observeOnly:boolean)=>{if(!this.env.WORKSPACE_AGENT)throw Error('parameter-draft-unavailable');return this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(command.scope.tenantId,command.scope.workspaceId)).experimentParameterEffect({command,effectId,observeOnly});};
    return new ToolDispatcher(this.#ledger,{
      execute:input=>input.command.operation==='experiment_parameters'?draft(input.command,input.effectId,false):files.execute(input),
      observe:input=>input.command.operation==='experiment_parameters'?draft(input.command,input.reference.effectId,true):files.observe(input),
    },new ToolArtifactMaterializer(this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR)));
  }
  async #settlementIdentity(value:unknown){const identity=turnRuntimeIdentity(value),name=await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId);if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');return identity;}
  async nativeAttemptSnapshot(raw:unknown){
    const identity=await this.#settlementIdentity(raw);
    const exists=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tool_commands'").toArray()[0];
    if(!exists)return {supported:false,noAddedCalls:true,admitted:null,dispatched:null};
    const rows=this.ctx.storage.sql.exec<{scope_json:string;turn_id:string;dispatch_id:string;dispatched_at:number|null}>('SELECT scope_json,turn_id,dispatch_id,dispatched_at FROM tool_commands').toArray();
    for(const row of rows)if(!sameScope(validateScope(JSON.parse(row.scope_json)),identity.scope)||row.turn_id!==identity.turnId||row.dispatch_id!==identity.dispatchId)throw Error('tool-bridge-ledger-scope-denied');
    return {supported:true,noAddedCalls:true,admitted:rows.length,dispatched:rows.filter(row=>row.dispatched_at!==null).length};
  }
  async closeTurnAdmission(identity:unknown){return this.#ledger.closeTurnAdmission(await this.#settlementIdentity(identity));}
  async turnSettlement(identity:unknown){return this.#ledger.turnSettlement(await this.#settlementIdentity(identity));}
  async readPersistedReceipt(input:{identity:unknown;revisionId:string;commandId:string;toolCallId:string;name:string;target:ReceiptTarget}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='commandId,identity,name,revisionId,target,toolCallId')throw Error('invalid-tool-receipt-read');
    const identity=await this.#settlementIdentity(input.identity),revisionId=turnId(input.revisionId),commandId=turnId(input.commandId),toolCallId=toolReceiptCallId(input.toolCallId),name=toolReceiptName(input.name),operation=toolReceiptOperation(name),target=input.target;
    if(!target||typeof target!=='object'||Array.isArray(target)||Object.keys(target).sort().join(',')!=='actorId,warm'||typeof target.actorId!=='string')throw Error('invalid-tool-receipt-read');
    const expectedActor=target.warm?await workspaceSandboxActor(target.warm.lease,'project'):(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).project;
    if(target.actorId!==expectedActor)throw Error('tool-receipt-target-denied');
    const record=readExistingToolCommand(this.ctx.storage,commandId);
    if(!record)return publicToolReceipt({identity,revisionId,toolCallId,name,commandId,record:null,effect:null});
    if(!sameScope(record.scope,identity.scope)||record.turnId!==identity.turnId||record.dispatchId!==identity.dispatchId||record.operation!==operation)throw Error('tool-receipt-scope-denied');
    if(['completed','failed','cancelled'].includes(record.status)||!record.effectId||operation==='experiment_parameters')return publicToolReceipt({identity,revisionId,toolCallId,name,commandId,record,effect:null});
    if(!record.command)throw Error('invalid-persisted-tool-ledger');
    const reference=toolCommandReference(record),capability=await issueProjectEffectCapability(this.env.M2_PROJECT_EFFECT_CAPABILITY_KEY,{actorId:target.actorId,command:record.command,effectId:reference.effectId,expiresAt:Date.now()+60_000});
    const sandbox=this.env.PROJECT_SANDBOX.getByName(target.actorId),effect=await sandbox.readPersistedFileEffectTerminal({identity,reference,command:record.command,capability,warm:target.warm});
    return publicToolReceipt({identity,revisionId,toolCallId,name,commandId,record,effect});
  }
  async g5RepairFixtureAuthority(rawIdentity:unknown){const identity=await this.#settlementIdentity(rawIdentity);if(!this.env.WORKSPACE_AGENT)throw Error('g5-fixture-workspace-binding-unavailable');const recordsPromise=this.#ledger.g5FixtureRecords(identity),workspacePromise:Promise<G5FixtureWorkspaceAuthority>=this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(identity.scope.tenantId,identity.scope.workspaceId)).g5FixtureTurnAuthority(identity),[records,workspace]=await Promise.all([recordsPromise,workspacePromise]);if(JSON.stringify(workspace.identity)!==JSON.stringify(identity))throw Error('g5-fixture-workspace-identity-mismatch');return {schemaVersion:1 as const,source:workspace.source,requestKey:workspace.requestKey,repairProof:await g5RepairFixtureProof({identity,records,events:workspace.events,source:workspace.source,checkpointFilesSha256:workspace.checkpointFilesSha256,requestKey:workspace.requestKey})};}
  async run(input:ToolCommandIntent){
    const command=normalizeToolCommandIntent(input),name=await toolBridgeActorName(command.scope,command.turnId,command.dispatchId);
    if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');
    return this.#dispatcher.runIntentUntilSettled(command);
  }
}
