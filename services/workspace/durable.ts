import {initialWorkspaceReferenceFromReady,isInitialWorkspaceSourceFailure} from '../turn-runtime/initial-workspace.ts';
import {workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
import { DurableObject } from 'cloudflare:workers';
import { catalogDatabase } from '../catalog/database.ts';
import { ProvisioningCatalog } from '../catalog/provisioning.ts';
import { tenantQuotaName, type TenantQuota } from '../quota/durable.ts';
import type { ProjectRuntime } from '../runtime/durable.ts';
import type { ProductTurnRuntime } from '../turn-runtime/durable.ts';
import { ProductTurnRuntimeClient } from '../turn-runtime/client.ts';
import { WorkspaceCoordinator } from './coordinator.ts';
import { DurableWorkspaceStore } from './store.ts';
import { DurableTurnAlarmPort } from './turn-alarm.ts';
import { routeWorkspaceAlarm } from './alarm-router.ts';
import { WorkspaceTurnEngine } from './turns.ts';
import { runtimeName, validateWorkspaceTask, workspaceAgentName, type WorkspaceTask } from './protocol.ts';
import { TurnJournal } from '../turn/journal.ts';
import { DurableTurnStore } from '../turn/store.ts';
import type { TurnActor, TurnScope } from '../turn/protocol.ts';
import { sameScope, initialWorkspaceBase, scope as validateTurnScope } from '../turn/protocol.ts';
import { REVISION_STORE_ACTOR, type RevisionStoreNamespace } from '../turn-runtime/revision-store-client.ts';
import { TOOL_ARTIFACT_STORE_ACTOR, type ToolArtifactStoreNamespace, type ToolArtifactReferenceInput } from '../artifacts/protocol.ts';
import { releaseRetiredArtifactEvent } from '../artifacts/event-retirement.ts';

export interface WorkspaceAgentEnv {
  WORKSPACE_AGENT: DurableObjectNamespace<WorkspaceAgent>;
  TENANT_QUOTA: DurableObjectNamespace<TenantQuota>;
  PROJECT_RUNTIME: DurableObjectNamespace<ProjectRuntime>;
  PRODUCT_TURN_RUNTIME: DurableObjectNamespace<ProductTurnRuntime>;
  REVISION_STORE: RevisionStoreNamespace;
  TOOL_ARTIFACT_STORE: ToolArtifactStoreNamespace;
  M2_TURNS_ENABLED: unknown;
  CATALOG: D1Database;
}
/** Private platform RPC. No fetch, tenant/header credentials or user supplied
 * endpoint can enter this actor. The gateway must first authorize its caller. */
export class WorkspaceAgent extends DurableObject<WorkspaceAgentEnv> {
  #store = new DurableWorkspaceStore(this.ctx.storage);
  #coordinator: WorkspaceCoordinator | null = null;
  #turns = new TurnJournal(new DurableTurnStore(this.ctx.storage),Date.now,async scope=>{
    try{const resolved=await this.#initialWorkspace(scope);
      return initialWorkspaceBase({reference:resolved.reference,filesSha256:resolved.filesSha256});
    }catch(error){if(isInitialWorkspaceSourceFailure(error))throw Error('turn-initial-base-unavailable');throw error;}
  });
  #turnAlarm = new DurableTurnAlarmPort(this.ctx.storage);
  #turnEngine: WorkspaceTurnEngine | null = null;
  #engine(): WorkspaceTurnEngine {
    if (!this.env.PRODUCT_TURN_RUNTIME?.getByName) throw Error('product-turn-runtime-not-configured');
    if (!this.env.TOOL_ARTIFACT_STORE?.getByName) throw Error('tool-artifact-store-not-configured');
    return this.#turnEngine ??= new WorkspaceTurnEngine(
      this.#turns,
      new ProductTurnRuntimeClient(this.env.PRODUCT_TURN_RUNTIME),
      this.#turnAlarm,
      Date.now,
      {},
      this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),
    );
  }
  #for(input: WorkspaceTask): WorkspaceCoordinator {
    const task = validateWorkspaceTask(input);
    if (!this.env.WORKSPACE_AGENT.idFromName(workspaceAgentName(task.tenantId, task.workspaceId)).equals(this.ctx.id)) throw Error('workspace-actor-scope-denied');
    if (!this.#coordinator) {
      this.#coordinator = new WorkspaceCoordinator(this.#store, {
        catalog: new ProvisioningCatalog(catalogDatabase(this.env.CATALOG)),
        quota: this.env.TENANT_QUOTA.getByName(tenantQuotaName(task.tenantId)),
        runtime: identity => this.env.PROJECT_RUNTIME.getByName(runtimeName(identity)),
        hold: promise => this.ctx.waitUntil(promise),
      });
    }
    return this.#coordinator;
  }
  async accept(task: WorkspaceTask) { return this.#for(task).accept(task); }
  async report(task: WorkspaceTask) {
    const coordinator = this.#for(task), state = coordinator.report();
    if (state && JSON.stringify(state.task) !== JSON.stringify(validateWorkspaceTask(task))) throw Error('workspace-task-conflict');
    return state;
  }
  async stop(task: WorkspaceTask) { return this.#for(task).stop(task); }
  async reconcile(task: WorkspaceTask) { return this.#for(task).reconcile(task); }
  #maintenanceScope(rawScope:TurnScope):TurnScope{
    const scope=validateTurnScope(rawScope),state=this.#store.read();
    if(!state)throw Error('workspace-actor-scope-denied');
    const task=validateWorkspaceTask(state.task);
    if(!sameScope(scope,{tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,workspaceGeneration:task.generation})||!this.env.WORKSPACE_AGENT.idFromName(workspaceAgentName(scope.tenantId,scope.workspaceId)).equals(this.ctx.id))throw Error('workspace-actor-scope-denied');
    return scope;
  }
  #ready(rawScope: TurnScope): TurnScope {
    const scope = validateTurnScope(rawScope), state = this.#store.read();
    if (!state || state.projection?.outcome !== 'ready' || !state.projectionConfirmed) throw Error('workspace-not-ready');
    const expected = {
      tenantId: state.task.tenantId,
      projectId: state.task.projectId,
      workspaceId: state.task.workspaceId,
      workspaceGeneration: state.task.generation,
    };
    if (!sameScope(scope, expected) || !this.env.WORKSPACE_AGENT.idFromName(workspaceAgentName(scope.tenantId, scope.workspaceId)).equals(this.ctx.id)) {
      throw Error('workspace-actor-scope-denied');
    }
    return scope;
  }
  async #initialWorkspace(rawScope:TurnScope){
    const scope=this.#ready(rawScope),state=this.#store.read();
    if(!state?.identity||!state.runtimeReceipt)throw Error('workspace-initial-source-missing');
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');
    const reference=await initialWorkspaceReferenceFromReady({scope,task:state.task,runtime:state.identity,markerNonce:state.markerNonce,ready:state.runtimeReceipt});
    return this.env.REVISION_STORE.getByName(REVISION_STORE_ACTOR).resolveInitial(reference,scope);
  }
  async createSession(input: { scope: TurnScope; actor: TurnActor; key: string; body: { title: unknown } }) {
    return this.#turns.createSession(this.#ready(input.scope), input.actor, input.key, input.body);
  }
  async submitTurn(input: { scope: TurnScope; actor: TurnActor; sessionId: string; key: string; body: { message: unknown } }) {
    const scope = this.#ready(input.scope);
    if (this.env.M2_TURNS_ENABLED !== 'true') throw Error('turn-runtime-not-ready');
    return this.#engine().submit(scope, input.actor, input.sessionId, input.key, input.body);
  }
  async cancelTurn(input: { scope: TurnScope; actor: TurnActor; turnId: string }) {
    return this.#engine().cancel(this.#ready(input.scope), input.actor, input.turnId);
  }
  async replayTurnEvents(input: { scope: TurnScope; afterSequence: number; limit: number }) {
    return this.#turns.replay(this.#ready(input.scope), input.afterSequence, input.limit);
  }
  async turnSnapshot(input: { scope: TurnScope }) {
    return this.#turns.view(this.#ready(input.scope));
  }
  async listFiles(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),revision=await this.#turns.workspaceRevision(scope);
    if(!revision){const initial=await this.#initialWorkspace(scope);return {schemaVersion:1,revision:null,files:workspaceFileIndex(initial.filesArchive).files};}
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');
    const index=await this.env.REVISION_STORE.getByName(REVISION_STORE_ACTOR).files(revision.identity,revision.receipt);
    return {schemaVersion:1,revision:{revisionId:revision.receipt.revisionId,filesSha256:revision.receipt.filesSha256,committedAt:revision.receipt.committedAt},files:index.files};
  }
  async diffFiles(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),revision=await this.#turns.workspaceRevision(scope);
    if(!revision)return {schemaVersion:1,revision:null,baseRevisionId:null,summary:{added:0,modified:0,deleted:0},changes:[]};
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');const store=this.env.REVISION_STORE.getByName(REVISION_STORE_ACTOR),result=await store.diff(revision.identity,revision.receipt);
    return {schemaVersion:1,revision:{revisionId:revision.receipt.revisionId,filesSha256:revision.receipt.filesSha256,committedAt:revision.receipt.committedAt},summary:result.summary,changes:result.changes};
  }
  async readArtifact(input:{scope:TurnScope;artifactId:string}){
    const scope=this.#ready(input.scope);
    if(!this.env.TOOL_ARTIFACT_STORE?.getByName)throw Error('tool-artifact-store-not-configured');
    return this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR).read(scope,input.artifactId);
  }
  async artifactEventReleaseEligibility(input:ToolArtifactReferenceInput){
    this.#maintenanceScope(input.scope);
    return this.#turns.artifactEventReleaseEligibility(input);
  }
  async releaseRetiredArtifactEvent(input:ToolArtifactReferenceInput){
    this.#maintenanceScope(input.scope);
    if(!this.env.TOOL_ARTIFACT_STORE?.getByName)throw Error('tool-artifact-store-not-configured');
    return releaseRetiredArtifactEvent(this.#turns,this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),input);
  }
  async alarm() {
    await routeWorkspaceAlarm({
      readWorkspace: () => this.#store.read(),
      readTurnWake: () => this.#turnAlarm.read(),
      runWorkspace: task => this.#for(task).alarm(),
      runTurn: (scope, generation) => this.#engine().alarm(scope, generation),
      deferTurn: at => this.#turnAlarm.schedule(at),
      clearTurn: () => this.#turnAlarm.clear(),
      reconcile: () => this.#turnAlarm.reconcile(),
    });
  }
}
