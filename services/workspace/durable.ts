import {WorkspaceArchiveFence} from './archive-fence.ts';
import {statement as sqlArchive} from '../catalog/database.ts';
import {ProjectArchives,type ArchiveTarget,type ArchiveAction} from '../catalog/project-archives.ts';
import type {Principal} from '../catalog/contracts.ts';
import {invitedRunsPolicy,INVITED_RUN_CAPACITY_ACTOR,type InvitedRunsPolicy} from '../simulation/invited-policy.ts';
import {assertInvitedRunResourceQuiet} from '../simulation/invited-resource-quiet.ts';
import type {InvitedRunCapacity} from '../simulation/invited-capacity-durable.ts';
import {leaseReference,type LeaseRequest,type LeaseReference} from '../quota/core.ts';
import {privateBetaPolicy,privateBetaCandidate,authorizePrivateBeta,PRIVATE_BETA_CAPACITY_ACTOR} from '../model-budget/private-beta-policy.ts';
import {privateBetaNativeReleaseGuard} from '../model-budget/private-beta-release.ts';
import type {PrivateBetaCapacity} from '../model-budget/private-beta-capacity.ts';
import {piDeveloperOwner,piDeveloperPolicy} from '../model-budget/pi-developer-policy.ts';
import type {PiDeveloperBudget} from '../model-budget/pi-developer-durable.ts';
import {managedProjectPolicy,requireManagedAdmission,managedProductActorName,resolveManagedRoute,type ManagedAcceptancePolicy} from './managed-route.ts';
import type {TurnRuntimePort} from '../turn/dispatcher.ts';
import {g5TaskKey,g5TaskRecovery} from '../model-budget/g5-admission.ts';
import {g5FixtureClaimContract} from '../model-budget/g5-fixture-manifest.ts';
import {g5B2RunEvidence} from '../model-budget/g5-b2-evidence.ts';
import {G5_GLOBAL_ACTOR,g5WindowPolicy,type G5TaskRecovery} from '../model-budget/g5-window.ts';
import type {G5TenantModelBudget} from '../model-budget/g5-token-durable.ts';
import {G4BrowserBuildHold,g4BuildHoldUntil} from '../browser-preview/g4-build-hold.ts';
import {sandboxActorIds} from '../sandbox/policy.ts';
import type {readG4WindowSnapshot} from '../model-budget/g4-window.ts';
import {g4DurableComputeCounts,readG4NativeSample} from '../model-budget/g4-compute-counts.ts';
import type {SimulationRecord} from '../simulation/host.ts';
import type {ServiceIntentRecord} from './service-intents.ts';
import {admitG4Task} from '../model-budget/g4-admission.ts';
import { frozenSource,sourceScope,type BrowserBuildSource } from '../browser-preview/source.ts';
import {BrowserPreviewBuildHost} from '../browser-preview/build-host.ts';
import {BrowserPreviewOrchestrator} from '../browser-preview/orchestrator.ts';
import {productionPreviewRegistry} from '../browser-preview/production-registry.ts';
import {platformPreviewDelivery} from '../browser-preview/platform-delivery.ts';
import {DurableBrowserBuildAlarmPort} from './turn-alarm.ts';
import {canonicalPreviewJson} from '../browser-preview/contract.ts';
import type {PreviewRuntime} from '../browser-preview/contract.ts';
import {preparePublication,type PublicationVersion} from '../publication/readiness.ts';
import {R2PublicationArtifacts} from '../publication/artifacts.ts';
import {normalizeToolCommand,type ToolCommand} from '../tools/protocol.ts';
import {researchSnapshot,buildResearchExport} from '../research/export.ts';
import {EvidenceLedger,evidenceGroup,assessmentForRun,evidenceAssessments} from '../simulation/evidence-adapter.ts';
import {evidenceRequest,type EvidenceHead} from '../simulation/evidence.ts';
import {boundedResearchContext} from '../simulation/research-context.ts';
import {ExperimentGroupHost,experimentGroupRequest,g5TerminalGroupAuthority,type ExperimentGroupRequest} from '../simulation/groups.ts';
import type {ExperimentGroupRecord} from '../simulation/groups.ts';
import {GROUP_PREFIX} from '../simulation/group-state.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {SimulationHost,experimentRequest,publicExperiment,publishSimulationResult,type ExperimentRequest} from '../simulation/host.ts';
import {SimulationNative,simulationToken,type SimulationSandboxApi,type SimulationInput} from '../simulation/native.ts';
import {simulationPlan,modelVersion,inspectModel,digest} from '../simulation/source.ts';
import type {PreviewSource} from '../preview/source.ts';
import {DurableSimulationAlarmPort} from './turn-alarm.ts';
import {ObserverCancellation,type ObserverCancellationPort} from '../preview/observer-cancellation.ts';
import {createObserverFetchSession} from '../preview/observer-fetch.ts';
import {observerHttpPolicy,type ObserverHttpPolicy} from '../preview/observer-http.ts';
import {observerRuntimePublicRequest,type ObserverRuntimeRequest} from '../preview/observer-runtime.ts';
import {ObserverCallHost} from '../preview/observer-host.ts';
import type {ObserverExecutionTarget} from '../preview/observer-execution.ts';
import {ObserverExecutorCapability,ObserverArtifactReadCapability,observerExecutorActorName,type ObserverExecutorNamespace} from '../preview/observer-executor-rpc.ts';
import {readObserverArtifact,observerArtifactReadInput,type ObserverArtifactReadInput} from './observer-artifact-read.ts';
import {WorkspaceObserverHost} from './observer-host.ts';
import {PreviewRoutes} from '../preview/routes.ts';
import {previewHostOrigin} from '../preview/origin.ts';
import {sha,turnDigest} from '../turn/protocol.ts';
import {initialWorkspaceReference,initialWorkspaceReferenceFromReady,isInitialWorkspaceSourceFailure} from '../turn-runtime/initial-workspace.ts';
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
import {WorkspaceServiceHost} from './service-host.ts';
import type {ServiceIntentRequest,ServiceSourceCandidate} from './service-intents.ts';
import {serviceRunActorName,type ServiceRunTask} from '../run/host.ts';
import {readServiceRun} from '../run/view.ts';
import {SqlPreviewBindings} from '../preview/bindings.ts';
import {resolvePreviewTarget} from '../preview/target.ts';
import {SqlPreviewTickets} from '../preview/tickets.ts';
import {requirePreviewSession,type PreviewBrowserPrincipal} from '../preview/session.ts';
import {previewRuntimeInput} from '../preview/runtime-input.ts';
import {serviceHttpRequest} from '../preview/http.ts';
import {privateWebSocketRequest,readPrivateWebSocketRequest} from '../preview/websocket-protocol.ts';
import {connectPreviewWebSocket,boundedWebSocketHandshake} from '../preview/websocket-connect.ts';
import {serviceRuntimeActorName} from '../run/durable.ts';
import {turnRuntimeActorName} from '../turn-runtime/identity.ts';
import {authorizeObserver} from '../preview/observer-authority.ts';
import {validateObserverCommand,type ObserverCommand} from '../preview/observer-protocol.ts';
import {ProjectCatalog} from '../catalog/projects.ts';
import type {ServiceRuntimeInput} from '../run/runtime-protocol.ts';
import {WORKSPACE_LAYOUT} from './protocol.ts';
import { DurableObserverAlarmPort, DurableServiceAlarmPort, DurableTurnAlarmPort } from './turn-alarm.ts';
import { routeWorkspaceAlarm } from './alarm-router.ts';
import { WorkspaceTurnEngine } from './turns.ts';
import { runtimeName, validateWorkspaceTask, workspaceAgentName, type WorkspaceTask, type WorkspaceBudgetRoute } from './protocol.ts';
import { TurnJournal } from '../turn/journal.ts';
import { DurableTurnStore } from '../turn/store.ts';
import type { TurnActor, TurnScope } from '../turn/protocol.ts';
import { sameScope, initialWorkspaceBase, scope as validateTurnScope } from '../turn/protocol.ts';
import { revisionStoreActorName, type RevisionStoreNamespace } from '../turn-runtime/revision-store-client.ts';
import { TOOL_ARTIFACT_STORE_ACTOR, type ToolArtifactStoreNamespace, type ToolArtifactReferenceInput } from '../artifacts/protocol.ts';
import { releaseRetiredArtifactEvent } from '../artifacts/event-retirement.ts';
import {traceTurnAdmission,type TurnAdmissionStage} from '../turn/admission-telemetry.ts';
import {WorkspaceRuntimeHandoff,type RuntimeSettlementInput,type NativeHandoffRpc} from './runtime-handoff.ts';
import type {WorkspaceBindingLease} from '../turn/protocol.ts';
import {workspaceSandboxActor,type WorkspaceSandboxBinding} from '../sandbox/workspace-binding.ts';
import type {PairDomain} from '../capacity/paired.ts';
import {modelBudgetTenantName} from '../model-budget/core.ts';
import {issueExecutionIsolationAuthority} from '../model-budget/execution-isolation-capability.ts';
import {PRODUCTION_MONEY_ACTOR} from '../model-budget/production-money.ts';
import type {TenantModelBudget} from '../model-budget/durable.ts';
import type {ProductionModelBudget} from '../model-budget/production-durable.ts';
import type {ToolBridgeAgent} from '../tools/durable.ts';
import {toolBridgeActorName} from '../tools/identity.ts';
import {WorkspaceRuntimeLeases,pairReference} from './runtime-leases.ts';
import {workspacePairedCapacityClient,type WorkspacePairedCapacityPort} from '../capacity/paired-client.ts';
import {warmTrustedPiActorId,type WarmOutboundRequest} from '../sandbox/warm-authority.ts';
import { TrustedPiTurnCapacity } from '../capacity/turn.ts';
import type { TrustedPiCapacityNamespace } from '../capacity/client.ts';
import { turnOperationTracer } from '../turn/operation-telemetry.ts';
import {G5TerminalReconciliation} from './g5-terminal-reconciliation.ts';

export interface WorkspaceAgentEnv {
  PRIVATE_BETA_POLICY_JSON?:string;
  PRIVATE_BETA_CAPACITY?:DurableObjectNamespace<PrivateBetaCapacity>;
  WORKSPACE_AGENT: DurableObjectNamespace<WorkspaceAgent>;
  TENANT_QUOTA: DurableObjectNamespace<TenantQuota>;
  PROJECT_RUNTIME: DurableObjectNamespace<ProjectRuntime>;
  PRODUCT_TURN_RUNTIME: DurableObjectNamespace<ProductTurnRuntime>;
  TRUSTED_PI_CAPACITY: TrustedPiCapacityNamespace;
  TENANT_MODEL_BUDGET?:DurableObjectNamespace<TenantModelBudget>;
  PRODUCTION_MODEL_BUDGET?:DurableObjectNamespace<ProductionModelBudget>;
  TOOL_BRIDGE_AGENT?:DurableObjectNamespace<ToolBridgeAgent>;
  REVISION_STORE: RevisionStoreNamespace;
  TOOL_ARTIFACT_STORE: ToolArtifactStoreNamespace;
  G4_CONTROLLED_WINDOW_JSON?:string;
  PI_DEVELOPER_POLICY_JSON?:string;
  PI_DEVELOPER_BUDGET?:{getByName(name:string):PiDeveloperBudget};
  G5_CONTROLLED_WINDOW_JSON?:string;
  G5_TOKEN_BUDGET?:DurableObjectNamespace<G5TenantModelBudget>;
  G5_WINDOW_GUARD?:{getByName(name:string):{archiveQuiescence(scope:TurnScope):Promise<{scope:TurnScope;quiescent:boolean;ambiguousStarts:number}>;assertNativeExecutionQuiet():Promise<import('../simulation/invited-resource-quiet.ts').HistoricalNativeQuiet>;registerTask(task:unknown):Promise<unknown>;claimTaskCreate(key:string):Promise<{authorized:boolean}>;bindTask(key:string,id:string):Promise<unknown>;taskBinding(key:string,id:string):Promise<{found:boolean;bound:boolean}>;taskBindingForIntent(task:G5TaskRecovery,id:string):Promise<{found:boolean;bound:boolean;taskKey:string|null;windowId:string|null;profileSha256:string|null}>;repairTaskBinding(task:G5TaskRecovery,id:string):Promise<{found:true;bound:true;taskKey:string;windowId:string;profileSha256:string}>;checkTaskStart(key:string):Promise<{authorized:boolean}>;claimTaskStart(key:string,identity?:TurnRuntimeIdentity):Promise<{authorized:boolean;alreadyStarted:boolean;grantId:string|null}>;confirmTaskStartGrant(key:string,grantId:string):Promise<{confirmed:boolean}>;checkTaskContinue(key:string,grantId:string):Promise<{authorized:boolean}>;cancelUnstartedTask(key:string):Promise<unknown>;closeTrustedTurn(key:string,identity:TurnRuntimeIdentity):Promise<unknown>}};
  G4_BROWSER_BUILD_HOLD_SCOPES_JSON?:string;
  MANAGED_ACCEPTANCE_JSON?:string;
  MANAGED_TESTING_JSON?:string;
  MANAGED_TURN_RUNTIME?:{getByName(name:string):TurnRuntimePort & {preflight(scope:TurnScope,actor:TurnActor):Promise<unknown>;reserveSimulation(scope:TurnScope,runId:string):Promise<unknown>;budgetStatus(scope:TurnScope):Promise<unknown>;cleanup(scope:TurnScope):Promise<unknown>}};
  M2_TURNS_ENABLED: unknown;
  M2_MODEL_TURN_CAPABILITY_KEY:string;
  M2_WORKSPACE_RUNTIME_REUSE_ENABLED?:unknown;
  M2_LAZY_PROJECT_ENABLED?:unknown;
  M2_WORKSPACE_RUNTIME_VERSION?:unknown;
  TRUSTED_PI_SANDBOX?:{idFromName(name:string):{toString():string};getByName?(name:string):unknown};
  PROJECT_SANDBOX?:{getByName(name:string):unknown};
  M2_TURN_ADMISSION_TELEMETRY?:unknown;
  M2_TURN_OPERATION_TELEMETRY?:unknown;
  INVITED_RUNS_POLICY_JSON?:string;
  INVITED_RUN_CAPACITY?:DurableObjectNamespace<InvitedRunCapacity>;
  M4_SIMULATION_ENABLED?:unknown;
  M4_SIMULATION_IMAGE?:string;
  SIMULATION_SANDBOX?:{getByName(name:string):SimulationSandboxApi};
  WORKSPACE_CHECKPOINTS?:R2Bucket;
  M3_SERVICE_ENABLED?:unknown;
  M3_PREVIEW_ENABLED?:unknown;
  M3_PREVIEW_WS_ENABLED?:unknown;
  M3_OBSERVER_ENABLED?:unknown;
  OBSERVER_EXECUTOR?:ObserverExecutorNamespace;
  M3_PREVIEW_ORIGIN?:string;
  APP_ORIGIN?:string;
  BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;
  M3_SERVICE_IMAGE?:string;
  SERVICE_RUNTIME?:{getByName(name:string):{forwardHttp(input:ServiceRuntimeInput,request:Request):Promise<Response>;forwardObserverHttp?(input:ObserverRuntimeRequest,request:Request,cancellation:ObserverCancellationPort):Promise<Response>;fetch?(request:Request):Promise<Response>}};
  SERVICE_RUN?:{getByName(name:string):{
    accept(task:ServiceRunTask):Promise<unknown>;
    acceptStopped(task:ServiceRunTask):Promise<unknown>;
    stop():Promise<unknown>;
    snapshot():Promise<unknown>;
    archiveQuiescence?():Promise<{runId:string;released:boolean}>;
  }};
  CATALOG: D1Database;
}
/** Private platform RPC and a single internal WebSocket fetch endpoint. The
 * fetch transport still verifies the access session and authoritative target. */
export class WorkspaceAgent extends DurableObject<WorkspaceAgentEnv> {
  constructor(ctx:DurableObjectState,env:WorkspaceAgentEnv){
    super(ctx,env);
    ctx.blockConcurrencyWhile(async()=>{const store=new DurableTurnStore(ctx.storage);if(store.read())await store.transact(current=>{if(!current)throw Error('invalid-persisted-turn-journal');return {state:current,value:null};});});
  }
  #archiveFence=new WorkspaceArchiveFence(this.ctx.storage);
  assertWritableScope(scope:TurnScope):void{this.#maintenanceScope(scope);this.#archiveFence.assertWritable(scope);}
  #archiveWrite<T>(scope:TurnScope,operation:()=>Promise<T>):Promise<T>{this.#maintenanceScope(scope);return this.#archiveFence.write(scope,operation);}
  #archiveRead<T>(scope:TurnScope,operation:()=>Promise<T>):Promise<T>{this.#maintenanceScope(scope);return this.#archiveFence.read(scope,operation);}
  #archiveConditionalWrite<T>(scope:TurnScope,write:boolean,operation:()=>Promise<T>):Promise<T>{return write?this.#archiveWrite(scope,operation):this.#archiveRead(scope,operation);}
  async #archiveBlockers(scope:TurnScope):Promise<string[]>{
    const blockers:string[]=[],bootstrap=this.#store.read();
    if(!bootstrap?.projectionConfirmed||!bootstrap.quotaReleased||bootstrap.phase!=='stopped')blockers.push('provisioning-release-unconfirmed');
    if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined){try{const proof=await this.#betaControl().archiveQuiescence(scope);if(!proof.quiescent)blockers.push('beta-execution-or-release-unconfirmed');}catch{blockers.push('beta-quiescence-unconfirmed');}}
    for(const [name,namespace] of [['legacy',this.env.TENANT_MODEL_BUDGET],['g5',this.env.G5_TOKEN_BUDGET],['pi',this.env.PI_DEVELOPER_BUDGET]] as const){
      if(!namespace){if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)blockers.push(name+'-ledger-unavailable');continue;}
      try{const proof=await namespace.getByName(modelBudgetTenantName(scope.tenantId)).archiveQuiescence(scope.tenantId,scope);if(!sameScope(proof.scope,scope)||!proof.quiescent)blockers.push(name+'-execution-unconfirmed');}catch{blockers.push(name+'-quiescence-unconfirmed');}
    }
    try{const proof=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(scope.tenantId)).archiveQuiescence(scope.tenantId,scope);if(!sameScope(proof.scope,scope)||!proof.quiescent)blockers.push('original-native-resource-unconfirmed');}catch{blockers.push('original-native-authority-unconfirmed');}
    if(this.env.G5_WINDOW_GUARD){try{const proof=await this.#g5Guard().archiveQuiescence(scope);if(!sameScope(proof.scope,scope)||!proof.quiescent)blockers.push(proof.ambiguousStarts?'g5-native-scope-unconfirmed':'g5-native-start-unconfirmed');}catch{blockers.push('g5-native-authority-unconfirmed');}}else if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)blockers.push('g5-native-authority-unconfirmed');
    const journal=new DurableTurnStore(this.ctx.storage).read();
    if(journal&&(journal.activeTurnId||journal.resourceWait||journal.releaseHold||journal.recoveryHold||Object.values(journal.turns).some(t=>!['completed','failed','cancelled','interrupted'].includes(t.status))))blockers.push('turn-or-release-unconfirmed');
    for(const turn of Object.values(journal?.turns??{})){
      if(!turn.resourceLease)continue;
      if(!turn.dispatchId||!turn.runtimeGeneration){blockers.push('native-release-unconfirmed');continue;}
      try{
        const identity=turnRuntimeIdentity({scope:turn.scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration}),proof=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity),disposition=proof.resourceDisposition;
        const released=disposition.status==='released'||disposition.status==='handed-off'&&await this.#leases().archiveReleaseConfirmed(identity,disposition.lease);
        if(proof.phase!=='terminal'||!released)blockers.push('native-release-unconfirmed');
      }catch{blockers.push('native-release-unconfirmed');}
    }
    const runs=await this.ctx.storage.list<{released?:boolean}>({prefix:'simulation:run:'});if([...runs.values()].some(r=>r.released!==true))blockers.push('run-release-unconfirmed');
    const groups=await this.ctx.storage.list<{status:string}>({prefix:'simulation:group:'});if([...groups.values()].some(r=>!['completed','failed','cancelled','partial'].includes(r.status)))blockers.push('experiment-group-active');
    for(const wake of ['browser-preview:wake-at','m2:turn:wake-at','m3:service:wake-at','m3:observer:wake-at','m4:simulation:wake-at'])if(this.ctx.storage.kv.get(wake)!=null)blockers.push('pending-work');
    if(this.#webSockets.size)blockers.push('preview-active');
    const lease=this.#leases().currentLease();if(lease){try{const current=await this.#leases().leaseForDrain(lease.lease);if(!['released','cancelled'].includes(current.status))blockers.push('runtime-lease-unreleased');}catch{blockers.push('runtime-release-unconfirmed');}}
    const tables=new Set(this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(r=>r.name));
    if(tables.has('observer_calls')){const active=this.ctx.storage.sql.exec<{n:number}>("SELECT count(*) AS n FROM observer_calls WHERE json_extract(record_json,'$.status') IN ('accepted','running','unknown')").one().n;if(active)blockers.push('observer-release-unconfirmed');}
    if(tables.has('service_intents')){
      const intents=this.ctx.storage.sql.exec<{record_json:string}>('SELECT record_json FROM service_intents').toArray().map(r=>JSON.parse(r.record_json) as ServiceIntentRecord);
      for(const intent of intents){if(['failed','cancelled'].includes(intent.status)&&intent.deliveryClaimedAt===null)continue;if(intent.status!=='delivered'||!intent.task){blockers.push('service-active-or-unknown');continue;}try{const stub=await this.#serviceRun(intent.task);const proof=await stub.archiveQuiescence?.();if(!proof||proof.runId!==intent.runId||proof.released!==true)blockers.push('service-release-unconfirmed');}catch{blockers.push('service-release-unconfirmed');}}
    }
    return [...new Set(blockers)];
  }
  async prepareProjectArchive(input:{actor:Principal;target:ArchiveTarget;action:ArchiveAction;operationId:string;dryRun:boolean}){
    const scope=this.#maintenanceScope(input.target.scope),catalog=new ProjectArchives(catalogDatabase(this.env.CATALOG));
    const actual=await catalog.target(input.actor,scope.tenantId,scope.projectId,input.target.manifestId??undefined);
    if(actual.epoch!==input.target.epoch||!sameScope(actual.scope,scope)||actual.owner.authVersion!==input.target.owner.authVersion)throw Error('project_busy');
    if(input.dryRun){return {blockers:this.#archiveFence.active()?['concurrent-write']:await this.#archiveBlockers(scope)};}
    await this.#archiveFence.prepare({scope,operationId:input.operationId,epoch:actual.epoch,action:input.action,state:'prepared',wasArchived:actual.archivedAt!==null});
    try{return {blockers:await this.#archiveBlockers(scope)};}catch{ return {blockers:['quiescence-unconfirmed']}; }
  }
  async finishProjectArchive(input:{actor:Principal;target:ArchiveTarget;action:ArchiveAction;operationId:string;requestKey:string}){
    const scope=this.#maintenanceScope(input.target.scope),catalog=new ProjectArchives(catalogDatabase(this.env.CATALOG));
    const actual=await catalog.target(input.actor,scope.tenantId,scope.projectId,input.target.manifestId??undefined),receipt=await catalog.receipt(input.actor,scope.projectId,input.action,input.requestKey);
    if(!receipt||receipt.outcome!=='completed'||receipt.archive_epoch!==actual.epoch||(actual.archivedAt!==null)!==(input.action==='archive'))throw Error('project_busy');
    const fence=this.#archiveFence.get();if(!fence){if(input.action==='restore')return;throw Error('project_busy');}
    // Several completed request keys may acknowledge the same archived epoch.
    // Return the immutable receipt without replacing that epoch's current fence.
    if(input.action==='archive'&&fence.state==='archived'&&fence.epoch===actual.epoch&&sameScope(fence.scope,scope))return;
    const id=input.actor.userId+':'+input.action+':'+input.requestKey;if(fence.operationId!==id)throw Error('project_busy');
    await this.#archiveFence.finish(id,actual.epoch,actual.archivedAt!==null);
  }
  async abortProjectArchive(input:{target:ArchiveTarget;operationId:string}){
    this.#maintenanceScope(input.target.scope);
    const held=this.#archiveFence.get();if(!held||held.operationId!==input.operationId)return;
    const rows=await catalogDatabase(this.env.CATALOG).query<{epoch:number;archivedAt:number|null}>(sqlArchive('SELECT archive_epoch AS epoch,archived_at AS archivedAt FROM catalog_projects WHERE id=? AND workspace_id=?',input.target.scope.projectId,input.target.scope.workspaceId));
    if(rows[0]?.epoch!==input.target.epoch||rows[0]?.archivedAt!==input.target.archivedAt)throw Error('project_busy');
    await this.#archiveFence.abort(input.operationId);
  }
  #browserBuildAlarm=new DurableBrowserBuildAlarmPort(this.ctx.storage);
  #browserBuildHost:BrowserPreviewBuildHost|null=null;
  #browserBuild(scope:TurnScope){
    if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('browser-preview-unavailable');
    return this.#browserBuildHost??=new BrowserPreviewBuildHost(this.ctx.storage,scope,{registry:productionPreviewRegistry,bucket:this.env.WORKSPACE_CHECKPOINTS,holdUntil:source=>g4BuildHoldUntil(this.ctx.storage,source,s=>s.kind==='initial-workspace'?null:new DurableTurnStore(this.ctx.storage).read()?.turns[s.identity.turnId]?.finishedAt??null),checkSource:source=>this.#checkBrowserSource(scope,source),resolveInitial:async source=>{
      this.#checkBrowserSource(scope,source);
      const resolved=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).resolveInitial(source.reference,scope);
      this.#checkBrowserSource(scope,source);return resolved;
    },files:async discovery=>{
      if(discovery.kind==='initial-workspace')throw Error('browser-preview-source-unavailable');
      this.#maintenanceScope(scope);const saved=this.#turns.savedRevisionSnapshot(scope,discovery.receipt.revisionId);
      if(!saved||canonicalPreviewJson(saved.identity)!==canonicalPreviewJson(discovery.identity)||canonicalPreviewJson(saved.receipt)!==canonicalPreviewJson(discovery.receipt))throw Error('browser-preview-source-unavailable');
      const bytes=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles({kind:'saved-turn',identity:saved.identity,revision:saved.receipt},16*1024*1024);
      this.#maintenanceScope(scope);const after=this.#turns.savedRevisionSnapshot(scope,discovery.receipt.revisionId);if(canonicalPreviewJson(after)!==canonicalPreviewJson(saved))throw Error('browser-preview-source-unavailable');return bytes;
    }});
  }
  #checkBrowserSource(scope:TurnScope,source:BrowserBuildSource){
    this.#maintenanceScope(scope);if(!sameScope(sourceScope(source),scope))throw Error('browser-preview-source-unavailable');
    if(source.kind!=='initial-workspace'){
      const saved=this.#turns.savedRevisionSnapshot(scope,source.receipt.revisionId);
      if(canonicalPreviewJson(saved)!==canonicalPreviewJson(frozenSource(source)))throw Error('browser-preview-source-unavailable');return;
    }
    const state=this.#store.read();
    if(!state?.task.modelContent||!state.identity||!state.runtimeReceipt)throw Error('browser-preview-source-unavailable');
    const admitted=this.ctx.storage.kv.get<BrowserBuildSource>('browser-preview:discovery:'+source.revisionId);
    if(admitted?.kind!=='initial-workspace'||admitted.referenceSha256!==source.referenceSha256||canonicalPreviewJson(admitted.reference)!==canonicalPreviewJson(source.reference)||this.ctx.storage.kv.get<string>('browser-preview:initial-source')!==source.revisionId)throw Error('browser-preview-source-unavailable');
    const actual=initialWorkspaceReference({schemaVersion:1,scope,task:state.task,runtime:state.identity,markerNonce:state.markerNonce,markerSha256:state.runtimeReceipt.markerSha256,checkpointRevision:state.runtimeReceipt.checkpointRevision});
    if(canonicalPreviewJson(actual)!==canonicalPreviewJson(source.reference))throw Error('browser-preview-source-unavailable');
  }
  #browser(scope:TurnScope){
    const owned=this.#maintenanceScope(scope);
    return new BrowserPreviewOrchestrator(this.ctx.storage,owned,{builds:this.#browserBuild(owned),bucket:this.env.WORKSPACE_CHECKPOINTS!,registry:productionPreviewRegistry,
      readOnly:()=>this.#archiveFence.get()!==null,checkScope:()=>{this.#maintenanceScope(owned);},authorize:async actor=>{const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(actor,owned.workspaceId);if(!sameScope(actual,owned))throw Error('browser-preview-access-denied');},
      authorizeVerify:async actor=>{this.#ready(owned);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,owned.workspaceId);if(!sameScope(actual,owned))throw Error('browser-preview-access-denied');this.#ready(owned);},
      head:()=>this.#turns.workspaceRevisionSnapshot(owned)??this.#browserBuild(owned).initial(),saved:revision=>this.#turns.savedRevisionSnapshot(owned,revision)??this.#browserBuild(owned).source(revision),checkSource:source=>this.#checkBrowserSource(owned,source),
      files:source=>this.env.REVISION_STORE.getByName(revisionStoreActorName(owned)).serviceFiles(source,16*1024*1024),simulations:this.#simulations(owned),canVerify:()=>this.#simulationCanRun(),image:this.env.M4_SIMULATION_IMAGE??'',
      delivery:hash=>platformPreviewDelivery(this.env.APP_ORIGIN,this.env.BROWSER_PREVIEW_EXECUTION_ORIGIN,hash)});
  }
  #g4BuildHoldControl(){
    return new G4BrowserBuildHold(this.ctx.storage,this.env.G4_CONTROLLED_WINDOW_JSON,this.env.G4_BROWSER_BUILD_HOLD_SCOPES_JSON,{
      checkScope:scope=>{this.#maintenanceScope(scope);},
      authorize:async(scope,actor,creating)=>{const catalog=new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()),actual=creating?await catalog.workspace(actor,scope.workspaceId):await catalog.maintenanceWorkspace(actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('g4-build-hold-scope-denied');},
      window:async()=>{const task=this.#store.read()?.task;if(!task||!this.env.TENANT_MODEL_BUDGET)throw Error('g4-build-hold-window-unavailable');const namespace=this.env.TENANT_MODEL_BUDGET as unknown as {getByName(name:string):{g4WindowSnapshot(tenantId:string):Promise<ReturnType<typeof readG4WindowSnapshot>>}};return namespace.getByName(modelBudgetTenantName(task.tenantId)).g4WindowSnapshot(task.tenantId);},
      finishedAt:source=>source.kind==='initial-workspace'?null:new DurableTurnStore(this.ctx.storage).read()?.turns[source.identity.turnId]?.finishedAt??null,
      baseline:()=>{const task=this.#store.read()!.task;return this.#turns.workspaceRevisionSnapshot(this.#maintenanceScope({tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,workspaceGeneration:task.generation}))?.receipt.revisionId??null;},
      checkSource:source=>this.#checkBrowserSource(sourceScope(source),source),
    });
  }
  g4BrowserBuildHold(input:{scope:TurnScope;actor:TurnActor;durationMs:number}){
    return this.#archiveWrite(input.scope,async()=>{return this.#g4BuildHoldControl().hold(input);
    });
  }
  g4BrowserBuildRelease(input:{scope:TurnScope;actor:TurnActor}){
    return this.#archiveWrite(input.scope,async()=>{return this.#g4BuildHoldControl().release(input);
    });
  }
  async g4ComputeCounts(input:{scope:TurnScope;actor:TurnActor}){
    const scope=this.#maintenanceScope(input.scope),catalog=new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set());
    const authorize=async()=>{this.#maintenanceScope(scope);const actual=await catalog.maintenanceWorkspace(input.actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('g4-compute-counts-scope-denied');this.#maintenanceScope(scope);};
    await authorize();
    const namespace=this.env.TENANT_MODEL_BUDGET as unknown as {getByName(name:string):{g4WindowSnapshot(tenantId:string):Promise<ReturnType<typeof readG4WindowSnapshot>>}}|undefined;
    if(!namespace)throw Error('g4-compute-counts-unavailable');
    const raw=await namespace.getByName(modelBudgetTenantName(scope.tenantId)).g4WindowSnapshot(scope.tenantId);
    let window:ReturnType<typeof readG4WindowSnapshot>;try{window=JSON.parse(JSON.stringify(raw));}finally{const dispose=Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value;if(typeof dispose==='function')dispose.call(raw);}
    await authorize();if(window.policy&&(window.policy.tenantId!==scope.tenantId||window.policy.userId!==input.actor.userId))throw Error('g4-compute-counts-scope-denied');
    const turns=Object.values(new DurableTurnStore(this.ctx.storage).read()?.turns??{}),state=this.#store.read();
    const simulations=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:',limit:1001})).values()];await authorize();
    const hasServices=this.ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_intents'").toArray().length!==0;
    const services=hasServices?this.ctx.storage.sql.exec<{record_json:string}>('SELECT record_json FROM service_intents ORDER BY run_id LIMIT 1001').toArray().map(r=>JSON.parse(r.record_json) as ServiceIntentRecord):[];
    if(turns.length>200||simulations.length>1000||services.length>1000)throw Error('g4-compute-counts-capacity');
    const durable=g4DurableComputeCounts(scope,window,turns,simulations,services);
    type CounterPort={nativeAttemptSnapshot(identity:unknown):Promise<unknown>};
    const project=state?.identity?await readG4NativeSample(this.env.PROJECT_RUNTIME.getByName(runtimeName(state.identity)) as unknown as CounterPort,state.identity):{supported:false,noAddedCalls:true,attempts:null};await authorize();
    const dispatched=turns.filter(t=>t.dispatchId!==null&&t.runtimeGeneration!==null);
    const samples=await Promise.all(dispatched.map(async turn=>{
      const identity=turnRuntimeIdentity({scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId!,generation:turn.runtimeGeneration!}),ids=await sandboxActorIds(scope,turn.id,turn.dispatchId!);
      const [projectTools,trustedPi,toolLedger]=await Promise.all([
        readG4NativeSample(this.env.PROJECT_SANDBOX?.getByName?.(ids.project) as unknown as CounterPort|undefined,identity),
        readG4NativeSample(this.env.TRUSTED_PI_SANDBOX?.getByName?.(ids.trustedPi) as unknown as CounterPort|undefined,identity),
        readG4NativeSample(this.env.TOOL_BRIDGE_AGENT?.getByName(await toolBridgeActorName(scope,turn.id,turn.dispatchId!)) as unknown as CounterPort|undefined,identity,true)]);
      return {turnId:turn.id,dispatchId:turn.dispatchId,actorSelection:'cold-turn-dispatch',projectTools,trustedPi,toolLedger};
    }));await authorize();
    return {schema:'riffology.g4-compute-counts/v1',scope,readOnly:true,noAddedCalls:true,...durable,projectRuntime:{identity:state?.identity??null,readyObserved:state?.runtimeReceipt!=null,counter:project},nativeDispatches:samples,successfulNativeExecutions:null,nativeSemantics:'persisted attempt-before-call counters; unsupported stays null; combine stable before/after with all fences and Cloudflare inventory'};
  }
  browserPreviewView(input:{scope:TurnScope;actor:TurnActor;revisionId?:string;profileId?:PreviewRuntime['profileId']}){
    return this.#archiveRead(input.scope,async()=>{return this.#browser(input.scope).view(input.actor,input.revisionId,input.profileId);
    });
  }
  browserPreviewPackage(input:{scope:TurnScope;actor:TurnActor;packageIdentity:string}){
    return this.#archiveRead(input.scope,async()=>{return this.#browser(input.scope).bytes(input.actor,input.packageIdentity);
    });
  }
  verifyBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    return this.#archiveWrite(input.scope,async()=>{return this.#browser(input.scope).verify(input.actor,input.body);
    });
  }
  browserPreviewVerification(input:{scope:TurnScope;actor:TurnActor;key:string}){return this.#browser(input.scope).verification(input.actor,input.key);}
  browserPreviewRetry(input:{scope:TurnScope;actor:TurnActor;key:string}){return this.#browser(input.scope).retryVerification(input.actor,input.key);}
  retryBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    return this.#archiveWrite(input.scope,async()=>{return this.#browser(input.scope).retry(input.actor,input.body);
    });
  }
  #invitedRunsPolicy():InvitedRunsPolicy|null{return invitedRunsPolicy(this.env.INVITED_RUNS_POLICY_JSON);}
  #invitedRunCandidate(){return !this.#managedRoute()&&this.#invitedRunsPolicy()?.enabled===true;}
  #assertRunWritable(scope:TurnScope){this.assertWritableScope(scope);this.#ready(scope);}
  async #authorizeInvitedRun(scope:TurnScope,actor:TurnActor){
    this.#assertRunWritable(scope);
    const policy=this.#invitedRunsPolicy();if(!policy?.enabled)throw Error('invited-runs-paused');
    const base=this.#betaControl(),beta=base as typeof base & {authorizeRunAdmission?(scope:TurnScope,actor:TurnActor):Promise<unknown>};
    if(!beta.authorizeRunAdmission)throw Error('invited-runs-policy-migration-required');
    await beta.authorizeRunAdmission(scope,actor);this.#assertRunWritable(scope);
    await assertInvitedRunResourceQuiet(this.env,scope);this.#assertRunWritable(scope);
    await beta.authorizeRunAdmission(scope,actor);this.#assertRunWritable(scope);
    const snapshot=await this.#invitedRunCapacity().snapshot();this.#assertRunWritable(scope);
    if(!snapshot.policyReady||snapshot.paused||snapshot.unknown)throw Error('invited-runs-paused');
  }
  #invitedRunCapacity(){const stub=this.env.INVITED_RUN_CAPACITY?.getByName(INVITED_RUN_CAPACITY_ACTOR);if(!stub)throw Error('invited-runs-unconfigured');return stub;}
  async #simulationRecordForLease(request:LeaseRequest|LeaseReference){if(request.operation!=='simulation-run')throw Error('invited-runs-input-invalid');const record=await this.ctx.storage.get<SimulationRecord>('simulation:run:'+request.runId);if(!record||!sameScope(record.scope,{tenantId:request.tenantId,projectId:request.projectId,workspaceId:request.workspaceId,workspaceGeneration:request.generation}))throw Error('invited-runs-lease-denied');return record;}
  #simulationQuota(scope:TurnScope){
    const legacy=this.env.TENANT_QUOTA.getByName(tenantQuotaName(scope.tenantId));
    return {
      lookup:async(tenantId:string,id:string)=>{const invited=this.env.INVITED_RUN_CAPACITY&&this.env.INVITED_RUNS_POLICY_JSON!==undefined?await this.#invitedRunCapacity().lookup(tenantId,id):null;return invited??legacy.lookup(tenantId,id);},
      acquire:async(request:LeaseRequest)=>{const record=await this.#simulationRecordForLease(request);this.#assertRunWritable(scope);if(record.runAdmission){await this.#authorizeInvitedRun(scope,record.actor);this.#assertRunWritable(scope);return this.#invitedRunCapacity().acquire(request,record.actor);}return legacy.acquire(request);},
      dispatch:async(reference:LeaseReference)=>{const record=await this.#simulationRecordForLease(reference);this.#assertRunWritable(scope);if(record.runAdmission){await this.#authorizeInvitedRun(scope,record.actor);this.#assertRunWritable(scope);return this.#invitedRunCapacity().dispatch(reference);}return legacy.dispatch(reference);},
      confirmStopped:async(reference:LeaseReference,proof:import('../quota/core.ts').StopConfirmation)=>{const record=await this.#simulationRecordForLease(reference);return record.runAdmission?this.#invitedRunCapacity().confirmStopped(reference,proof):legacy.confirmStopped(reference,proof);},
    };
  }
  #simulationHost:SimulationHost|null=null;
  #simulationAlarm=new DurableSimulationAlarmPort(this.ctx.storage);
  #simulations(scope:TurnScope):SimulationHost{
    return this.#simulationHost??=new SimulationHost(this.ctx.storage,scope,{
      admitRun:async(actor,key,body,runId,child)=>{this.#assertRunWritable(scope);if(child?.runAdmission&&(child.runAdmission.policyId!==this.#invitedRunsPolicy()?.policyId||!this.#invitedRunCandidate()))throw Error('invited-runs-paused');if(this.#invitedRunCandidate()&&(!child||child.runAdmission)){await this.#authorizeInvitedRun(scope,actor);return {kind:'invited-runs' as const,policyId:this.#invitedRunsPolicy()!.policyId};}if(!this.#legacySimulationCanRun())throw Error('simulation-unavailable');const managed=await this.#managedAdmit(scope,actor,false);if(managed){await this.#managedRuntime(managed).reserveSimulation(scope,runId);return;}if(this.env.G5_CONTROLLED_WINDOW_JSON===undefined){await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,actor.userId,'run',{scope,key},body);return;}const task=await g5TaskKey(this.env.G5_CONTROLLED_WINDOW_JSON,'simulation',scope.tenantId,actor.userId,{scope,key},body);const policy=g5WindowPolicy(JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON))!;const guard=this.#g5Guard();await guard.registerTask(task);const created=await guard.claimTaskCreate(task.key);if(!created.authorized)throw Error('g5-simulation-create-denied');return {kind:'g5' as const,taskKey:task.key,windowId:policy.windowId,profileSha256:policy.profilePin.profileSha256};},
      createdRun:async record=>{if(record.budgetRoute)await this.#g5Guard().bindTask(record.budgetRoute.taskKey,record.runId);},
      authorizeRun:async record=>{if(!record.runAdmission)return this.#legacySimulationCanRun();try{await this.#authorizeInvitedRun(record.scope,record.actor);return true;}catch{return false;}},
      unknownRun:async record=>{if(!record.runAdmission)return;const observed=record.lease?null:await this.#invitedRunCapacity().lookup(record.scope.tenantId,`sim-${record.runId}-${record.attempt}`);const reference=record.lease??(observed?.lease?leaseReference(observed.lease):null);if(reference)await this.#invitedRunCapacity().markUnknown(reference);},
      beforeStart:async(record,stage)=>{this.#assertRunWritable(scope);if(record.runAdmission){if(record.runAdmission.policyId!==this.#invitedRunsPolicy()?.policyId)throw Error('invited-runs-policy-conflict');await this.#authorizeInvitedRun(scope,record.actor);return;}const managed=this.#managedRoute();if(managed){requireManagedAdmission(this.env.MANAGED_ACCEPTANCE_JSON,managed,record.scope,record.actor.userId,this.env.MANAGED_TESTING_JSON);await this.#managedRuntime(managed).reserveSimulation(record.scope,record.runId);return;}if(!record.budgetRoute)return;await this.#g5StartTask(record.budgetRoute.taskKey);},
      quota:this.#simulationQuota(scope),
      start:async input=>{
        this.#assertRunWritable(scope);
        if(input.runtimeImage!==this.env.M4_SIMULATION_IMAGE)throw Error('simulation-image-changed');
        const sandbox=await this.#simulationSandbox(input);
        const bytes=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(input.plan.source);
        const record=await this.#simulations(scope).get(input.runId);if(record.runAdmission)await this.#authorizeInvitedRun(scope,record.actor);this.#assertRunWritable(scope);
        return new SimulationNative(sandbox,input).start(bytes,record.runAdmission?async()=>{
          await this.#authorizeInvitedRun(scope,record.actor);
          const current=await this.#simulations(scope).get(input.runId);this.#assertRunWritable(scope);
          if(current.cancelledAt!==null)throw Error('simulation-access-revoked');
          if(current.status!=='preparing'||!current.startClaimed)throw Error('simulation-operation-unconfirmed');
          if(current.input.deadlineAt<=Date.now())throw Error('simulation-deadline');
          if(current.runAdmission?.policyId!==this.#invitedRunsPolicy()?.policyId)throw Error('invited-runs-policy-conflict');
        }:undefined);
      },
      observe:async input=>new SimulationNative(await this.#simulationSandbox(input),input).operation('observe'),
      stop:async input=>new SimulationNative(await this.#simulationSandbox(input),input).operation('stop'),
      destroy:async input=>{await (await this.#simulationSandbox(input)).destroy();},
      running:async input=>{const state=await (await this.#simulationSandbox(input)).releaseState();if(!state||typeof state.running!=='boolean')throw Error('simulation-release-unconfirmed');return state.running;},
      publish:async(record,result)=>{if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('simulation-unavailable');return publishSimulationResult(this.env.WORKSPACE_CHECKPOINTS,record,result);},
      authorize:async actor=>{try{const current=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,scope.workspaceId);return sameScope(current,scope);}catch{return false;}},
      hold:promise=>this.ctx.waitUntil(promise),
    },Date.now,this.#invitedRunCandidate()?{durationMs:this.#invitedRunsPolicy()!.durationMs,releaseGuardMs:this.#invitedRunsPolicy()!.releaseGuardMs,quietMs:this.#invitedRunsPolicy()!.quietMs}:undefined);
  }
  #experimentGroupHost:ExperimentGroupHost|null=null;
  #experimentGroups(scope:TurnScope){return this.#experimentGroupHost??=new ExperimentGroupHost(this.ctx.storage,scope,this.#simulations(scope),()=>this.#simulationCanRun(),Date.now,this.#invitedRunCandidate()?this.#invitedRunsPolicy()!.maxGroupRuns:80,async group=>{if(!group.runAdmission)return this.#legacySimulationCanRun();try{await this.#authorizeInvitedRun(scope,group.actor);return true;}catch{return false;}});}
  async submitExperimentGroup(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentGroupRequest}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope),host=this.#experimentGroups(scope),request=experimentGroupRequest(input.body),head=this.#turns.workspaceRevisionSnapshot(scope);
    const prior=await host.replay(input.actor,input.key,request);if(prior?.runAdmission)return host.view(prior,head?.receipt.filesSha256??null);
    let g5Task:Awaited<ReturnType<typeof g5TaskKey>>|null=null;
    if(!this.#managedRoute()&&!this.#invitedRunCandidate()&&this.env.G5_CONTROLLED_WINDOW_JSON!==undefined){if(!head)throw Error('g5-group-parent-turn-absent');const parent=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+head.identity.turnId);if(!parent||parent.kind!=='g5')throw Error('g5-group-parent-turn-unbound');g5Task=await g5TaskKey(this.env.G5_CONTROLLED_WINDOW_JSON,'group',scope.tenantId,input.actor.userId,{scope,key:input.key},request,parent.taskKey);await this.#g5Guard().registerTask(g5Task);}
    const finalize=async(group:ExperimentGroupRecord)=>{if(!g5Task)return;const guard=this.#g5Guard();await guard.bindTask(g5Task.key,group.groupId);const started=await guard.claimTaskStart(g5Task.key);if(started.authorized){if(!started.grantId)throw Error('g5-group-start-grant-absent');const confirmed=await guard.confirmTaskStartGrant(g5Task.key,started.grantId);if(!confirmed.confirmed)throw Error('g5-group-start-unconfirmed');}else if(!started.alreadyStarted)throw Error('g5-group-start-denied');this.ctx.storage.kv.put('g5-group-route:'+group.groupId,{kind:'g5',taskKey:g5Task.key,windowId:g5WindowPolicy(JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON!))!.windowId,profileSha256:g5WindowPolicy(JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON!))!.profilePin.profileSha256} satisfies WorkspaceBudgetRoute);await this.ctx.storage.sync();};
    if(prior){await finalize(prior);return host.view(prior,head?.receipt.filesSha256??null);}
    if(this.#invitedRunCandidate()){await this.#authorizeInvitedRun(scope,input.actor);if(request.seeds.length*(request.interventions.length+1)>this.#invitedRunsPolicy()!.maxGroupRuns)throw Error('invited-runs-group-limit');}
    if(g5Task){const claimed=await this.#g5Guard().claimTaskCreate(g5Task.key);if(!claimed.authorized)throw Error('g5-group-create-denied');}
    if(!this.#simulationCanRun())throw Error('simulation-unavailable');
    const source=await this.#simulationSource(scope),store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope));
    const plan=await simulationPlan(source,await store.serviceFiles(source));
    const group=await host.submit(input.actor,input.key,request,plan,this.env.M4_SIMULATION_IMAGE!,()=>{
      this.#ready(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);
      return source.kind==='saved-turn'?latest?.receipt.revisionId===source.revision.revisionId:latest===null;
    },this.#invitedRunCandidate()?{kind:'invited-runs',policyId:this.#invitedRunsPolicy()!.policyId}:undefined);
    await finalize(group);return host.view(group,modelVersion(plan).filesSha256);

    });
  }
  async experimentGroup(input:{scope:TurnScope;groupId:string}){
    const scope=this.#maintenanceScope(input.scope),host=this.#experimentGroups(scope);
    return host.view(await host.get(input.groupId),this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);
  }
  async listExperimentGroups(input:{scope:TurnScope;before?:string}){
    const scope=this.#maintenanceScope(input.scope);
    return this.#experimentGroups(scope).list(this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null,input.before);
  }
  async cancelExperimentGroup(input:{scope:TurnScope;groupId:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope),host=this.#experimentGroups(scope);
    return host.view(await host.cancel(input.groupId),this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);

    });
  }
  async #simulationSandbox(input:SimulationInput){
    if(!this.env.SIMULATION_SANDBOX?.getByName)throw Error('simulation-unavailable');
    return this.env.SIMULATION_SANDBOX.getByName('simulation-'+await simulationToken(input));
  }
  async #simulationSource(scope:TurnScope):Promise<PreviewSource>{
    const revision=this.#turns.workspaceRevisionSnapshot(scope);
    if(revision)return {kind:'saved-turn',identity:revision.identity,revision:revision.receipt};
    const initial=await this.#initialWorkspace(scope);
    return {kind:'initial-workspace',reference:initial.reference,filesSha256:initial.filesSha256};
  }
  #legacySimulationCanRun(){const managed=this.#managedRoute();return managed?managedProjectPolicy(this.env.MANAGED_ACCEPTANCE_JSON,managed.scope,this.env.MANAGED_TESTING_JSON)?.enabled===true:this.env.M4_SIMULATION_ENABLED==='true';}
  #simulationCanRun(){if(this.#archiveFence.get())return false;return (this.#legacySimulationCanRun()||this.#invitedRunCandidate())&&!!this.env.SIMULATION_SANDBOX?.getByName&&!!this.env.M4_SIMULATION_IMAGE&&!!this.env.WORKSPACE_CHECKPOINTS;}
  #exporting=false;
  async researchExport(input:{scope:TurnScope;actor:TurnActor}):Promise<Response>{
    return this.#archiveRead(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);
    if(this.#exporting)throw Error('export-busy');this.#exporting=true;
    try{
      const authorize=async()=>{this.#maintenanceScope(scope);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('export-access-denied');this.#maintenanceScope(scope);};
      await authorize();if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('export-unavailable');
      const current=await this.#simulationSource(scope),snapshot=await researchSnapshot(this.ctx.storage,scope,current,()=>{
        this.#maintenanceScope(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);
        if(current.kind==='saved-turn'?latest?.receipt.revisionId!==current.revision.revisionId:latest!==null)throw Error('export-model-changed');
      });
      const bucket=this.env.WORKSPACE_CHECKPOINTS;
      const result=await buildResearchExport(snapshot,{authorize,source:(source,maxBytes)=>this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source,maxBytes),artifact:async(key,maxBytes)=>{
        const object=await bucket.get(key);if(!object)return null;
        try{if(object.size>maxBytes)throw Error('export-too-large');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.byteLength!==object.size||bytes.byteLength>maxBytes)throw Error('export-source-mismatch');return bytes;}finally{await object.body?.cancel().catch(()=>{});}
      }});
      const revision=(await this.modelSpec({scope})).version;if(!revision)throw Error('export-model-changed');const exportReceipt={schemaVersion:1 as const,sha256:result.sha256,projectId:scope.projectId,workspaceId:scope.workspaceId,revision,runIds:snapshot.runs.map(run=>run.runId).sort(),groupIds:snapshot.groups.map(group=>group.groupId).sort(),claimIds:snapshot.claims.map((claim:any)=>String(claim.claimId)).sort(),sourceVersions:result.manifest.sources.flatMap(source=>source.revisionIds.map(revisionId=>({revisionId,filesSha256:source.filesSha256,specSha256:source.specSha256}))).filter((value,index,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(value))===index).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),manifestSha256:await digest(new TextEncoder().encode(JSON.stringify(result.manifest,null,2))),entryCount:result.manifest.files.length+1,bytes:result.bytes.byteLength,contentType:'application/zip',cacheControl:'no-store'};if(!this.#archiveFence.get()){await this.ctx.storage.put('g5-readonly-export:'+result.sha256,exportReceipt);await this.ctx.storage.sync();}
      return new Response(result.bytes,{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="${result.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','x-riffology-export-sha256':result.sha256}});
    }finally{this.#exporting=false;}

    });
  }
  async publicationPrepare(input:{scope:TurnScope;actor:TurnActor;expected?:PublicationVersion;freeze?:boolean}){
    return this.#archiveConditionalWrite(input.scope,input.freeze===true,async()=>{
    if(input.freeze)this.assertWritableScope(input.scope);
    const scope=this.#maintenanceScope(input.scope);if(this.#exporting)throw Error('publication-busy');this.#exporting=true;
    try{
      const authorize=async()=>{this.#maintenanceScope(scope);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('publication-access-denied');this.#maintenanceScope(scope);};
      await authorize();const bucket=this.env.WORKSPACE_CHECKPOINTS;if(!bucket)throw Error('publication-unavailable');const current=await this.#simulationSource(scope);
      const currentCheck=()=>{this.#maintenanceScope(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);if(current.kind==='saved-turn'?latest?.receipt.revisionId!==current.revision.revisionId:latest!==null)throw Error('publication-model-stale');};
      const snapshot=await researchSnapshot(this.ctx.storage,scope,current,currentCheck),active=this.#turns.publicationHasActiveTurn(scope);
      const result=await preparePublication(snapshot,{authorize,source:(source,maxBytes)=>this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source,maxBytes),artifact:async(key,maxBytes)=>{const object=await bucket.get(key);if(!object)return null;try{if(object.size>maxBytes)throw Error('export-too-large');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==object.size)throw Error('export-source-mismatch');return bytes;}finally{await object.body?.cancel().catch(()=>{});}}},active);
      if(!this.#simulationCanRun()&&!result.readiness.ready)result.readiness.diagnostics=[...(result.readiness.diagnostics??[]),'execution-unavailable'];
      await authorize();currentCheck();if(result.readiness.ready&&this.#turns.publicationHasActiveTurn(scope))throw Error('publication-model-stale');if(!input.freeze)return {readiness:result.readiness};
      if(!result.frozen||!result.readiness.ready)throw Error('publication-not-ready');if(JSON.stringify(input.expected)!==JSON.stringify(result.readiness.version))throw Error('publication-model-stale');
      const beforeWrite=async()=>{await authorize();currentCheck();if(this.#turns.publicationHasActiveTurn(scope))throw Error('publication-model-stale');};
      const stored=await new R2PublicationArtifacts(bucket).put(result.frozen,beforeWrite);await beforeWrite();return {readiness:result.readiness,stored};
    }finally{this.#exporting=false;}

    });
  }
  #evidence(scope:TurnScope){
    return new EvidenceLedger(this.ctx.storage,scope,{
      run:id=>this.#simulations(scope).get(id),
      group:async id=>evidenceGroup(await this.#experimentGroups(scope).get(id),scope),
      source:source=>this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source),
      artifact:async key=>{if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('evidence-artifact-unavailable');const object=await this.env.WORKSPACE_CHECKPOINTS.get(key);if(!object)return null;if(object.size>65536)throw Error('evidence-source-mismatch');return new Uint8Array(await object.arrayBuffer());},
    });
  }
  async #evidenceHead(scope:TurnScope):Promise<EvidenceHead|null>{
    const head=this.#turns.workspaceRevisionSnapshot(scope);if(head)return {revisionId:head.receipt.revisionId,filesSha256:head.receipt.filesSha256};
    try{const initial=await this.#initialWorkspace(scope);return {revisionId:null,filesSha256:initial.filesSha256};}catch{return null;}
  }
  async #evidenceAccess(scope:TurnScope,actor:TurnActor){
    this.#maintenanceScope(scope);const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('evidence-access-denied');this.#maintenanceScope(scope);
  }
  async #finishEvidence(scope:TurnScope,items:import('../simulation/evidence.ts').EvidenceView[]){if(this.#archiveFence.get())return items;const result=await this.#evidence(scope).refreshViews(items);this.#maintenanceScope(scope);return result;}
  async createEvidence(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const ledger=this.#evidence(scope),claim=await ledger.create(evidenceRequest(input.body),input.actor,()=>this.#evidenceAccess(scope,input.actor));await this.#evidenceAccess(scope,input.actor);const result=await ledger.get(claim.claimId,await this.#evidenceHead(scope));await this.#evidenceAccess(scope,input.actor);return (await this.#finishEvidence(scope,[result]))[0]!;

    });
  }
  async listEvidence(input:{scope:TurnScope;actor:TurnActor;before?:string}){
    return this.#archiveRead(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).list(await this.#evidenceHead(scope),input.before);await this.#evidenceAccess(scope,input.actor);return {...result,items:await this.#finishEvidence(scope,result.items)};

    });
  }
  async evidence(input:{scope:TurnScope;actor:TurnActor;claimId:string}){
    return this.#archiveRead(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const ledger=this.#evidence(scope),result=await ledger.get(input.claimId,await this.#evidenceHead(scope));await this.#evidenceAccess(scope,input.actor);return (await this.#finishEvidence(scope,[result]))[0]!;

    });
  }
  async rejectEvidence(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).reject(input.body,input.actor,()=>this.#evidenceAccess(scope,input.actor));await this.#evidenceAccess(scope,input.actor);return result;

    });
  }
  async researchEvidenceExport(input:{scope:TurnScope;actor:TurnActor}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).exportRecords();await this.#evidenceAccess(scope,input.actor);return result;
  }
  #runtimeLeases:WorkspaceRuntimeLeases|null=null;
  #leases(){return this.#runtimeLeases??=new WorkspaceRuntimeLeases(this.ctx.storage,workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}),new TrustedPiTurnCapacity(this.env.TRUSTED_PI_CAPACITY),()=>this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED==='true'&&this.env.M2_LAZY_PROJECT_ENABLED==='true',()=>this.env.M2_WORKSPACE_RUNTIME_VERSION);}
  async workspaceRuntimeSelection(input:{identity:TurnRuntimeIdentity}){const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);return this.#leases().selection(identity);}
  async workspaceRuntimeBinding(input:{identity:TurnRuntimeIdentity}){const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);return this.#leases().current(identity);}
  async bindWorkspaceRuntime(input:{identity:TurnRuntimeIdentity;executionDeadlineAt:number}){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity),scope=this.#ready(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||state.activeTurnId!==identity.turnId||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.cancelRequestedAt!==null)throw Error('workspace-runtime-binding-denied');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity);
    if(runtime.phase!=='running'||runtime.cancelRequestedAt!==null||!runtime.nativeStartReserved||runtime.executionDeadlineAt!==input.executionDeadlineAt||runtime.resourceLease.leaseId!==turn.resourceLease?.leaseId)throw Error('workspace-runtime-binding-denied');
    return this.#leases().bind(identity,input.executionDeadlineAt);

    });
  }
  async workspaceNativeAuthority(input:{context:WorkspaceSandboxBinding;domain:PairDomain}){
    this.assertWritableScope(input.context.identity.scope);
    if(!['project','trustedPi'].includes(input.domain))throw Error('workspace-native-authority-denied');
    const identity=turnRuntimeIdentity(input.context.identity),scope=this.#maintenanceScope(identity.scope),{current,lease:physicalLease}=await this.#leases().pairState(identity),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    const expectedFiles=turn?.base?.workspace?.filesSha256??turn?.base?.initial?.filesSha256??Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(10240))),n=>n.toString(16).padStart(2,'0')).join('');
    if(!['bound','idle','releasing'].includes(physicalLease.status)||!turn||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||JSON.stringify(current.lease)!==JSON.stringify(input.context.lease)||current.binding.bindingEpoch!==input.context.bindingEpoch||input.context.filesSha256!==expectedFiles)throw Error('workspace-native-authority-denied');
    return {...current,leaseStatus:physicalLease.status,actorId:await workspaceSandboxActor(current.lease,input.domain)};
  }
  async claimWorkspaceNative(input:{context:WorkspaceSandboxBinding;domain:PairDomain}){
    return this.#archiveWrite(input.context.identity.scope,async()=>{
    const current=await this.workspaceNativeAuthority(input);
    if(current.closing||current.executionDeadlineAt<=Date.now())throw Error('workspace-native-admission-closed');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(current.identity)).workspaceRuntimeState(current.identity);
    if(runtime.phase!=='running'||runtime.cancelRequestedAt!==null||runtime.executionDeadlineAt!==current.executionDeadlineAt)throw Error('workspace-native-admission-closed');
    const latest=await this.#leases().authoritative(current.identity);if(latest.closing)throw Error('workspace-native-admission-closed');
    return workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}).claimNativeStart(pairReference(current.lease),current.binding,input.domain);

    });
  }
  #runtimeHandoff:WorkspaceRuntimeHandoff|null=null;
  #handoff(){return this.#runtimeHandoff??=new WorkspaceRuntimeHandoff({storage:this.ctx.storage,pair:workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}),binding:identity=>this.#leases().pairState(identity),close:identity=>this.closeWorkspaceRuntime({identity}),journal:async identity=>{const state=await this.#turns.snapshot(identity.scope),turn=state.turns[identity.turnId];if(!turn||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId)throw Error('workspace-runtime-handoff-denied');return turn;},native:async(domain,context)=>{const namespace=domain==='project'?this.env.PROJECT_SANDBOX:this.env.TRUSTED_PI_SANDBOX;if(!namespace?.getByName)throw Error('workspace-native-namespace-required');return namespace.getByName(await workspaceSandboxActor(context.lease,domain)) as NativeHandoffRpc;}});}
  async authorizeWorkspaceLeaseDrain(input:{lease:WorkspaceBindingLease}){this.#maintenanceScope(input.lease.scope);return this.#leases().leaseForDrain(input.lease);}
  async drainRuntimeLease(input:{ref:import('../capacity/paired.ts').WorkspaceLeaseRef}){
    return this.#archiveWrite(input.ref.scope,async()=>{
    this.#maintenanceScope(input.ref.scope);const current=this.#leases().currentLease();if(!current||JSON.stringify(pairReference(current.lease))!==JSON.stringify(input.ref))throw Error('workspace-runtime-drain-denied');const lease=await this.#leases().leaseForDrain(current.lease);if(lease.status==='released')return;if(!lease.binding)throw Error('workspace-runtime-drain-denied');
    const identity=turnRuntimeIdentity({scope:lease.ref.scope,sessionId:lease.binding.sessionId,turnId:lease.binding.turnId,dispatchId:lease.binding.dispatchId,generation:lease.ref.scope.workspaceGeneration}),turn=(await this.#turns.snapshot(identity.scope)).turns[identity.turnId];if(!turn?.resourceLease)throw Error('workspace-runtime-drain-denied');
    return this.#handoff().settle({identity,outcome:turn.executionOutcome??'interrupted',checkpoint:turn.checkpoint,resourceLease:turn.resourceLease},true);
    });
  }
  async settleWorkspaceRuntime(input:RuntimeSettlementInput){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity);
    if(runtime.phase!=='terminal'||runtime.outcome!==input.outcome||JSON.stringify(runtime.checkpoint)!==JSON.stringify(input.checkpoint)||JSON.stringify(runtime.resourceLease)!==JSON.stringify(input.resourceLease))throw Error('workspace-runtime-handoff-authority-denied');
    const selection=this.#leases().selection(identity);if(selection?.mode==='warm'&&!selection.bound){const released=await this.#leases().releaseNeverStarted({scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,generation:identity.generation,ticketId:input.resourceLease.operationId,operationId:input.resourceLease.operationId,leaseId:input.resourceLease.leaseId,reasonCode:'runtime-never-bound',observedAt:Date.now()});return {status:'released' as const,...input.resourceLease,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,...released};}
    if(selection?.mode==='warm'){
      const reconciled=await this.#leases().reconcileBindingForSettlement(identity);
      if(reconciled.status==='unaccepted'){
        let physical=reconciled.lease;
        // A reused lease can still carry the preceding Turn's binding. Drain
        // that exact physical identity; never mint a new-epoch stop proof.
        if(physical.status==='releasing'){
          await this.drainRuntimeLease({ref:physical.ref});
          physical=await this.#leases().leaseForDrain(reconciled.current.lease);
        }
        const common={...input.resourceLease,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation};
        if(physical.status==='cancelled'||physical.status==='released')return {status:'released' as const,...common,proofId:`binding-unaccepted-${physical.ref.leaseId}-${physical.ref.leaseEpoch}`,releasedAt:physical.finishedAt!};
        return {status:'release-pending' as const,...common,reasonCode:'workspace-runtime-unaccepted-binding-drain',since:physical.drainAt??Date.now(),nextAttemptAt:Date.now()+5000};
      }
    }
    return this.#handoff().settle({...input,identity});

    });
  }
  async closeWorkspaceRuntime(input:{identity:TurnRuntimeIdentity}){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);
    const {current:binding}=await this.#leases().pairState(identity);
    await this.#leases().close(identity);
    const route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+identity.turnId);const tokenNamespace=this.ctx.storage.kv.get('pi-developer-turn:'+identity.turnId)?this.env.PI_DEVELOPER_BUDGET:route?this.env.G5_TOKEN_BUDGET:this.env.TENANT_MODEL_BUDGET;
    if(!tokenNamespace||!this.env.PRODUCTION_MODEL_BUDGET||!this.env.TOOL_BRIDGE_AGENT)throw Error('workspace-runtime-settlement-required');
    const model=tokenNamespace.getByName(modelBudgetTenantName(identity.scope.tenantId)),money=this.env.PRODUCTION_MODEL_BUDGET.getByName(PRODUCTION_MONEY_ACTOR),tool=this.env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId));
    const settled=await Promise.all([model.closeTurnAdmission(identity.scope.tenantId,identity),money.closeTurnAdmission(identity),tool.closeTurnAdmission(identity)]);
    if(settled.some(record=>JSON.stringify(record.identity)!==JSON.stringify(identity)||record.closed!==true))throw Error('workspace-runtime-settlement-denied');
    if(route)await this.#g5Guard().closeTrustedTurn(route.taskKey,identity);
    return {binding,settled};

    });
  }
  async workspaceRuntimeAuthority(input:WarmOutboundRequest){
    this.assertWritableScope(input.scope);
    const scope=this.#ready(input.scope),state=await this.#turns.snapshot(scope),turn=state.turns[input.turnId];
    if(!turn||state.activeTurnId!==input.turnId||!['starting','running'].includes(turn.status)||turn.dispatchId!==input.dispatchId||turn.cancelRequestedAt!==null||turn.finishedAt!==null||input.deadlineAt<=Date.now())throw Error('warm-outbound-authority-denied');
    const identity=turnRuntimeIdentity({scope,sessionId:turn.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:scope.workspaceGeneration});
    if(input.sessionId!==undefined&&input.sessionId!==identity.sessionId||input.actor!==undefined&&JSON.stringify(input.actor)!==JSON.stringify(turn.actor))throw Error('warm-outbound-authority-denied');
    const binding=await this.#leases().authoritative(identity);if(binding.closing||input.deadlineAt>binding.executionDeadlineAt)throw Error('warm-outbound-authority-denied');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('warm-outbound-authority-denied');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity);
    if(runtime.phase!=='running'||runtime.cancelRequestedAt!==null||!runtime.nativeStartReserved||runtime.executionDeadlineAt!==binding.executionDeadlineAt||runtime.resourceLease.leaseId!==binding.lease.leaseId)throw Error('warm-outbound-authority-denied');
    const actorId=await warmTrustedPiActorId(binding.lease);if(!this.env.TRUSTED_PI_SANDBOX||this.env.TRUSTED_PI_SANDBOX.idFromName(actorId).toString()!==input.containerId)throw Error('warm-outbound-authority-denied');
    const latest=await this.#leases().authoritative(identity),end=await this.#turns.snapshot(scope),last=end.turns[identity.turnId];if(latest.closing||this.#leases().selection(identity)?.closing||end.activeTurnId!==identity.turnId||last?.cancelRequestedAt!==null||input.deadlineAt<=Date.now())throw Error('warm-outbound-authority-denied');
    return {actorId,identity,actor:turn.actor,executionDeadlineAt:binding.executionDeadlineAt,lease:binding.lease,binding:binding.binding};
  }
  async prepareProjectTool(input:{command:ToolCommand;observeOnly:boolean}){
    return this.#archiveWrite(input.command.scope,async()=>{
    const command=normalizeToolCommand(input.command),scope=this.#ready(command.scope);
    const saved=(await this.#turns.snapshot(scope)).turns[command.turnId];if(!saved||saved.dispatchId!==command.dispatchId)throw Error('project-preparation-denied');
    const identity=turnRuntimeIdentity({scope,sessionId:saved.sessionId,turnId:command.turnId,dispatchId:command.dispatchId,generation:scope.workspaceGeneration}),runtime=this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity));
    if(this.ctx.storage.kv.get<{privateBeta?:boolean}>('pi-developer-turn:'+command.turnId)?.privateBeta)await this.#betaControl().authorizeTool(scope,saved.actor,command.turnId,command.deadlineAt);
    if(!await runtime.projectPreparationRequired(identity))return {ready:true as const};
    const authorize=async()=>{const state=await this.#turns.snapshot(scope),turn=state.turns[command.turnId];
      if(state.activeTurnId!==command.turnId||!turn||!['starting','running'].includes(turn.status)||turn.dispatchId!==command.dispatchId||turn.cancelRequestedAt!==null||turn.finishedAt!==null||command.deadlineAt<=Date.now())throw Error('project-preparation-denied');
      const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('project-preparation-denied');if(this.ctx.storage.kv.get<{privateBeta?:boolean}>('pi-developer-turn:'+command.turnId)?.privateBeta)await this.#betaControl().authorizeTool(scope,turn.actor,command.turnId,command.deadlineAt);return turn;
    };
    await authorize();
    const result=await runtime.prepareProjectTool({identity,command,observeOnly:input.observeOnly});await authorize();const warm=await this.#leases().current(identity);return warm?{...result,actorId:await workspaceSandboxActor(warm.lease,'project')}:result;

    });
  }
  async researchContext(input:{identity:TurnRuntimeIdentity;executionDeadlineAt:number}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#ready(identity.scope);
    const authorize=async()=>{
      if(!Number.isSafeInteger(input.executionDeadlineAt)||input.executionDeadlineAt<=Date.now())throw Error('research-context-expired');
      const state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
      if(state.activeTurnId!==identity.turnId||!turn||!['starting','running'].includes(turn.status)||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation||turn.cancelRequestedAt!==null||turn.finishedAt!==null)throw Error('research-context-turn-denied');
      const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(turn.actor,scope.workspaceId);
      if(!sameScope(allowed,scope))throw Error('research-context-denied');
      return turn;
    };
    await authorize();
    const model=await this.modelSpec({scope}),page=await this.listExperiments({scope}),experiments=page.items.slice(0,5);
    const groupPage=await this.listExperimentGroups({scope}),evidencePage=await this.#evidence(scope).list(model.version,undefined,3);
    const result=boundedResearchContext({model,experiments,experimentGroups:groupPage.items,evidence:evidencePage.items,hasMoreExperiments:page.items.length>5||page.nextCursor!==null,hasMoreGroups:groupPage.nextCursor!==null,hasMoreEvidence:evidencePage.nextCursor!==null});
    await authorize();return result;
  }
  async modelSpec(input:{scope:TurnScope;actor?:TurnActor}){
    const scope=this.#ready(input.scope),source=await this.#simulationSource(scope);
    const model=await inspectModel(source,await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source),this.#simulationCanRun());
    if(this.#invitedRunCandidate()&&input.actor){try{await this.#authorizeInvitedRun(scope,input.actor);}catch(error){model.canRun=false;model.capabilityReason=error instanceof Error&&/^(invited-runs-|private-beta-)/.test(error.message)?error.message:'invited-runs-unavailable';}}
    if(this.#invitedRunCandidate())model.runLimits=this.#invitedRunsPolicy()!;
    if(!this.#simulationCanRun()){model.canRun=false;if(this.#archiveFence.get())model.capabilityReason='project_archived';}
    this.#ready(scope);return model;
  }
  async submitExperiment(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentRequest}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope),host=this.#simulations(scope),request=experimentRequest(input.body);
    const prior=await host.replay(input.actor,input.key,request);
    if(prior)return publicExperiment(prior,this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);
    if(!this.#simulationCanRun())throw Error('simulation-unavailable');
    const source=await this.#simulationSource(scope),store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope));
    const plan=await simulationPlan(source,await store.serviceFiles(source));
    const record=await host.submit(input.actor,input.key,request,plan,this.env.M4_SIMULATION_IMAGE!,()=>{
      this.#ready(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);
      return source.kind==='saved-turn'?latest?.receipt.revisionId===source.revision.revisionId:latest===null;
    });
    return publicExperiment(record,modelVersion(plan).filesSha256);

    });
  }
  async listExperiments(input:{scope:TurnScope;before?:string}){
    const scope=this.#maintenanceScope(input.scope),page=await this.#simulations(scope).list(input.before),head=this.#turns.workspaceRevisionSnapshot(scope);
    const assessments=await evidenceAssessments(this.ctx.storage);return {items:page.items.map(r=>({...publicExperiment(r,head?.receipt.filesSha256??null),evidenceRejection:assessmentForRun(assessments,r.runId,modelVersion(r.input.plan))??null})),nextCursor:page.nextCursor};
  }
  async experiment(input:{scope:TurnScope;runId:string}){
    const scope=this.#maintenanceScope(input.scope),r=await this.#simulations(scope).get(input.runId),head=this.#turns.workspaceRevisionSnapshot(scope);
    return {...publicExperiment(r,head?.receipt.filesSha256??null),evidenceRejection:assessmentForRun(await evidenceAssessments(this.ctx.storage),r.runId,modelVersion(r.input.plan))??null};
  }
  async cancelSimulation(input:{scope:TurnScope;runId:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope),r=await this.#simulations(scope).cancel(input.runId),head=this.#turns.workspaceRevisionSnapshot(scope);
    return {...publicExperiment(r,head?.receipt.filesSha256??null),evidenceRejection:assessmentForRun(await evidenceAssessments(this.ctx.storage),r.runId,modelVersion(r.input.plan))??null};

    });
  }
  readonly #webSockets=new Set<AbortController>();
  #observerHost:WorkspaceObserverHost|null=null;
  async fetch(request:Request):Promise<Response>{
    let controller:AbortController|undefined;
    try{
      if(this.env.M3_PREVIEW_WS_ENABLED!=='true')throw Error('preview-ws-disabled');
      const incoming=readPrivateWebSocketRequest(request,'workspace'),raw=incoming.input as {scope:TurnScope;previewId:string;access:string};
      if(!raw||typeof raw!=='object'||Object.keys(raw).length!==3||!Object.hasOwn(raw,'scope')||!Object.hasOwn(raw,'previewId')||!Object.hasOwn(raw,'access'))throw Error('preview-ws-denied');
      const scope=this.#ready(raw.scope),input={scope,previewId:raw.previewId,access:raw.access};
      if(this.#webSockets.size>=8)throw Error('preview-ws-capacity');
      controller=new AbortController();this.#webSockets.add(controller);
      const held=controller;
      return await boundedWebSocketHandshake(held,async()=>{
      const authorize=async()=>{if(this.env.M3_PREVIEW_WS_ENABLED!=='true')throw Error('preview-ws-disabled');const value=await this.authorizePreviewAccess(input);return {expiresAt:value.expiresAt};};
      await authorize();
      const target=await this.previewTarget({scope,previewId:input.previewId}),runtime=previewRuntimeInput(target);
      const stub=this.env.SERVICE_RUNTIME?.getByName(await serviceRuntimeActorName(runtime));if(!stub?.fetch)throw Error('preview-ws-not-configured');
      return await connectPreviewWebSocket(incoming.request,{authorize,signal:held.signal,finish:()=>{this.#webSockets.delete(held);},connect:clean=>stub.fetch!(privateWebSocketRequest('runtime',runtime,clean))});
      });
    }catch{if(controller){controller.abort();this.#webSockets.delete(controller);}return new Response('preview unavailable',{status:403});}
  }
  #store = new DurableWorkspaceStore(this.ctx.storage);
  #coordinator: WorkspaceCoordinator | null = null;
  #turns = new TurnJournal(new DurableTurnStore(this.ctx.storage),Date.now,async scope=>{
    try{const resolved=await this.#initialWorkspace(scope);
      return initialWorkspaceBase({reference:resolved.reference,filesSha256:resolved.filesSha256});
    }catch(error){if(isInitialWorkspaceSourceFailure(error))throw Error('turn-initial-base-unavailable');throw error;}
  });
  #turnAlarm = new DurableTurnAlarmPort(this.ctx.storage);
  #turnEngine: WorkspaceTurnEngine | null = null;
  #serviceAlarm = new DurableServiceAlarmPort(this.ctx.storage);
  #observerAlarm = new DurableObserverAlarmPort(this.ctx.storage);
  #serviceHost:WorkspaceServiceHost|null=null;
  #previewBindings:SqlPreviewBindings|null=null;
  #previewTickets:SqlPreviewTickets|null=null;
  #tickets(scope:TurnScope){
    this.#ready(scope);
    if(this.env.M3_PREVIEW_ENABLED!=='true')throw Error('preview-disabled');
    return this.#previewTickets??=new SqlPreviewTickets(this.ctx.storage,scope,{
      session:(principal,s)=>requirePreviewSession(catalogDatabase(this.env.CATALOG),principal,s),
      target:async previewId=>(await this.previewTarget({scope,previewId})).binding,
    });
  }
  #previews(scope:TurnScope){this.#maintenanceScope(scope);return this.#previewBindings??=new SqlPreviewBindings(this.ctx.storage,scope);}
  #services(scope:TurnScope){
    this.#maintenanceScope(scope);
    return this.#serviceHost??=new WorkspaceServiceHost(this.ctx.storage,scope,{
      resolve:source=>{
        this.#ready(scope);
        if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');
        const store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope));
        return source.kind==='saved-turn'?store.previewPlan(source):store.initialPreviewPlan(source.reference,scope);
      },
      accept:async task=>{this.#ready(scope);if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');return (await this.#serviceRun(task)).accept(task);},
      acceptStopped:async task=>(await this.#serviceRun(task)).acceptStopped(task),
      stop:async task=>(await this.#serviceRun(task)).stop(),
      hold:promise=>this.ctx.waitUntil(promise),
    });
  }
  async #serviceRun(task:ServiceRunTask){
    if(!this.env.SERVICE_RUN?.getByName)throw Error('service-run-not-configured');
    return this.env.SERVICE_RUN.getByName(await serviceRunActorName(task));
  }
  #freezeService(scope:TurnScope):ServiceSourceCandidate{
    this.#ready(scope);
    const revision=this.#turns.workspaceRevisionSnapshot(scope);
    if(revision)return {kind:'saved-turn',identity:revision.identity,revision:revision.receipt};
    const state=this.#store.read();
    if(!state?.identity||!state.runtimeReceipt)throw Error('workspace-initial-source-missing');
    if(state.runtimeReceipt.layoutVersion!==WORKSPACE_LAYOUT)throw Error('initial-workspace-layout-mismatch');
    return {kind:'initial-workspace',reference:initialWorkspaceReference({schemaVersion:1,scope,task:state.task,runtime:state.identity,markerNonce:state.markerNonce,markerSha256:state.runtimeReceipt.markerSha256,checkpointRevision:state.runtimeReceipt.checkpointRevision})};
  }
  async submitService(input:{scope:TurnScope;actor:TurnActor;key:string;request:ServiceIntentRequest}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');
    if(this.env.G4_CONTROLLED_WINDOW_JSON!==undefined)await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    if(this.env.G5_CONTROLLED_WINDOW_JSON!==undefined)throw Error('g5-service-run-disabled');
    await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'run',{scope,key:input.key,type:'service'},input.request);
    this.#ready(scope);
    return this.#services(scope).submit(input.actor,input.key,input.request,()=>{
      if(input.request.runtimeImage!==this.env.M3_SERVICE_IMAGE)throw Error('service-runtime-image-conflict');
      return this.#freezeService(scope);
    });

    });
  }
  async stopService(input:{scope:TurnScope;runId:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);
    return this.#services(scope).stop(input.runId);

    });
  }
  async submitServiceRequest(input:{scope:TurnScope;actor:TurnActor;key:string;body:{maxDurationMs:number;expectedRevisionId?:string}}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');
    if(this.env.G4_CONTROLLED_WINDOW_JSON!==undefined)await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    if(this.env.G5_CONTROLLED_WINDOW_JSON!==undefined)throw Error('g5-service-run-disabled');
    await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'run',{scope,key:input.key,type:'service'},input.body);
    this.#ready(scope);
    return this.#services(scope).submitFromPolicy(input.actor,input.key,input.body,this.env.M3_SERVICE_IMAGE??'',()=>this.#freezeService(scope));

    });
  }
  async listServices(input:{scope:TurnScope;before?:{createdAt:number;runId:string};limit?:number}){
    const scope=this.#maintenanceScope(input.scope);
    return this.#services(scope).list({...(input.before===undefined?{}:{before:input.before}),...(input.limit===undefined?{}:{limit:input.limit})});
  }
  async serviceView(input:{scope:TurnScope;runId:string}){
    const scope=this.#maintenanceScope(input.scope),intent=await this.#services(scope).snapshot(input.runId);
    if(intent.task===null||intent.deliveryClaimedAt===null)return {intent,run:null};
    const task=intent.task;
    const run=await readServiceRun(task,async()=>(await this.#serviceRun(task)).snapshot(),promise=>this.ctx.waitUntil(promise));
    this.#maintenanceScope(scope);
    return {intent,run};
  }
  async bindPreview(input:{scope:TurnScope;actor:TurnActor;key:string;runId:string;expectedPreviewId:string|null}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    if(this.env.M3_PREVIEW_ENABLED!=='true')throw Error('preview-disabled');
    const view=await this.serviceView({scope,runId:input.runId});
    this.#ready(scope);
    if(!view.run)throw Error('preview-run-unavailable');
    return this.#previews(scope).bind(input.actor,input.key,{intent:view.intent,run:view.run},input.expectedPreviewId);

    });
  }
  async currentPreview(input:{scope:TurnScope}){return this.#previews(this.#maintenanceScope(input.scope)).current();}
  async revokePreview(input:{scope:TurnScope;previewId:string;reason:'stopped'|'replaced'|'operator'|'workspace-retired'}){
    return this.#archiveWrite(input.scope,async()=>{
    return this.#previews(this.#maintenanceScope(input.scope)).revoke(input.previewId,input.reason);

    });
  }
  async previewTarget(input:{scope:TurnScope;previewId:string}){
    const scope=this.#ready(input.scope);
    if(this.env.M3_PREVIEW_ENABLED!=='true')throw Error('preview-disabled');
    const target=await resolvePreviewTarget({binding:id=>this.#previews(scope).authorizeTarget(id),view:runId=>this.serviceView({scope,runId})},input.previewId);
    this.#ready(scope);return target;
  }
  /** Private trusted-call authority only; no browser cookie or caller actor.
   * The execution endpoint remains unconfigured until its separate gate passes. */
  async authorizeObserverCommand(raw:ObserverCommand){
    const command=validateObserverCommand(raw),scope=this.#ready(command.scope);
    const enabled=()=>this.env.M3_OBSERVER_ENABLED==='true'&&this.env.M3_PREVIEW_ENABLED==='true'&&this.env.M2_TURNS_ENABLED==='true';
    if(!enabled())throw Error('observer-disabled');
    return authorizeObserver(command,{
      enabled,
      caller:value=>{this.#ready(scope);return this.#turns.observerCaller(value);},
      membership:async actor=>{const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('observer-scope-denied');},
      runtime:async identity=>{const target=this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity));return target.currentObserverExecution(identity);},
      target:previewId=>this.previewTarget({scope,previewId}),
      current:binding=>{this.#ready(scope);return this.#previews(scope).matchesCurrent(binding);},
    });
  }
  #observers(rawScope:TurnScope){
    const scope=this.#maintenanceScope(rawScope);
    return this.#observerHost??=new WorkspaceObserverHost(this.ctx.storage,scope,{
      shouldStop:async command=>{try{await this.#observerTarget(command);return false;}catch{return true;}},
      stop:async command=>{
        this.#maintenanceScope(scope);
        const namespace=this.env.OBSERVER_EXECUTOR;if(!namespace?.getByName)throw Error('observer-executor-not-configured');
        return namespace.getByName(await observerExecutorActorName(command)).stop(command);
      },
    });
  }
  async #observerTarget(command:ObserverCommand):Promise<ObserverExecutionTarget>{
    const grant=await this.authorizeObserverCommand(command);
    if(!this.env.M3_PREVIEW_ORIGIN||!this.env.APP_ORIGIN)throw Error('observer-origin-not-configured');
    const route=await new PreviewRoutes(catalogDatabase(this.env.CATALOG)).get(command.previewId);
    if(!route||!sameScope(route.scope,command.scope)||route.expiresAt!==grant.binding.expiresAt)throw Error('observer-route-denied');
    const policy=observerHttpPolicy({origin:previewHostOrigin(this.env.M3_PREVIEW_ORIGIN,route.hostLabel,this.env.APP_ORIGIN),...grant.paths});
    this.#ready(command.scope);this.#turns.observerCaller(command);
    if(!this.#previews(command.scope).matchesCurrent(grant.binding))throw Error('observer-target-stale');
    return {binding:grant.binding,runtime:grant.runtime,policy,targetDigest:grant.targetDigest,expiresAt:grant.expiresAt};
  }
  /** Private trusted execution entry. Its namespace is deliberately optional:
   * no call is accepted until the separate executor is configured and gated. */
  async observePreview(raw:ObserverCommand){
    return this.#archiveWrite(raw.scope,async()=>{
    const command=validateObserverCommand(raw),scope=this.#ready(command.scope);
    if(this.env.M3_OBSERVER_ENABLED!=='true'||this.env.M3_PREVIEW_ENABLED!=='true'||this.env.M2_TURNS_ENABLED!=='true')throw Error('observer-disabled');
    const namespace=this.env.OBSERVER_EXECUTOR;
    if(!namespace?.getByName)throw Error('observer-executor-not-configured');
    const executor=namespace.getByName(await observerExecutorActorName(command));
    let policy:ObserverHttpPolicy|undefined;
    const authorize=async()=>{
      if(this.env.OBSERVER_EXECUTOR!==namespace)throw Error('observer-executor-not-configured');
      const target=await this.#observerTarget(command);
      if(policy&&JSON.stringify(target.policy)!==JSON.stringify(policy))throw Error('observer-target-stale');
      policy=target.policy;return target;
    };
    const journal=this.#observers(scope).calls;
    return new ObserverCallHost(journal,{
      authorize,
      execute:async(_command,context)=>{
        const fresh=async()=>{
          const grant=await context.authorize(),target=await authorize();
          if(context.signal.aborted)throw Error('observer-cancelled');
          if(target.targetDigest!==grant.targetDigest)throw Error('observer-target-stale');
          return {...target,expiresAt:Math.min(grant.expiresAt,target.expiresAt)};
        };
        const capability=new ObserverExecutorCapability({
          authorize:fresh,
          forward:async request=>{
            const target=await fresh();
            const clean=observerRuntimePublicRequest(request,target.policy);
            // This Request stays local; AbortSignal is never serialized over RPC.
            return this.forwardObserverHttp({command,targetDigest:target.targetDigest},new Request(clean,{signal:context.signal}));
          },
          cancelled:async()=>{if(context.signal.aborted)return true;try{await fresh();return context.signal.aborted;}catch{return true;}},
        });
        return executor.execute(command,capability);
      },
      stop:()=>executor.stop(command),
    }).run(command);

    });
  }
  /** Resource transport for an already durably running observation. It does not
   * accept/start calls or grant a browser cookie. The executor separately owns
   * the cumulative budget across resources and the observation result. */
  async forwardObserverHttp(raw:{command:ObserverCommand;targetDigest:string},request:Request):Promise<Response>{
    return this.#archiveWrite(raw.command.scope,async()=>{
    if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('observer-forward-denied');
    const fields=Object.getOwnPropertyDescriptors(raw);
    if(Reflect.ownKeys(fields).length!==2||['command','targetDigest'].some(k=>!fields[k]?.enumerable||!Object.hasOwn(fields[k]!,'value')))throw Error('observer-forward-denied');
    const command=validateObserverCommand(raw.command),targetDigest=sha(raw.targetDigest),scope=this.#ready(command.scope);
    const controller=new AbortController(),abort=()=>controller.abort();
    const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('observer-timeout')),{once:true}));void expired.catch(()=>{});
    const timer=setTimeout(abort,Math.max(1,command.deadlineAt-Date.now()));
    request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
    const live=()=>{if(controller.signal.aborted||Date.now()>=command.deadlineAt)throw Error('observer-timeout');};
    const wait=async<T,>(promise:Promise<T>):Promise<T>=>{const value=await Promise.race([promise,expired]);live();return value;};
    let session:ReturnType<typeof createObserverFetchSession>|undefined,expectedPolicy:ObserverHttpPolicy|undefined;
    try{
      const authorize=async()=>{
        live();const grant=await wait(this.authorizeObserverCommand(command));
        if(grant.targetDigest!==targetDigest)throw Error('observer-target-stale');
        if(!this.env.M3_PREVIEW_ORIGIN||!this.env.APP_ORIGIN)throw Error('observer-origin-not-configured');
        const route=await wait(new PreviewRoutes(catalogDatabase(this.env.CATALOG)).get(command.previewId));
        if(!route||!sameScope(route.scope,scope)||route.expiresAt!==grant.binding.expiresAt)throw Error('observer-route-denied');
        const policy=observerHttpPolicy({origin:previewHostOrigin(this.env.M3_PREVIEW_ORIGIN,route.hostLabel,this.env.APP_ORIGIN),...grant.paths});
        if(expectedPolicy&&JSON.stringify(policy)!==JSON.stringify(expectedPolicy))throw Error('observer-target-stale');
        const record=await wait(this.#observers(scope).calls.snapshot(command));
        if(!record||record.status!=='running'||record.targetDigest!==targetDigest)throw Error('observer-call-not-running');
        this.#ready(scope);this.#turns.observerCaller(command);
        if(!this.#previews(scope).matchesCurrent(grant.binding))throw Error('observer-target-stale');
        return {grant,policy};
      };
      const initial=await authorize();expectedPolicy=initial.policy;
      if(!this.env.SERVICE_RUNTIME?.getByName)throw Error('observer-forward-not-configured');
      const runtime=this.env.SERVICE_RUNTIME.getByName(await wait(serviceRuntimeActorName(initial.grant.runtime)));
      if(!runtime.forwardObserverHttp)throw Error('observer-forward-not-configured');
      session=createObserverFetchSession(initial.policy,{
        authorize:async()=>({expiresAt:(await authorize()).grant.expiresAt}),
        forward:(clean,signal)=>{live();if(signal.aborted)throw Error('observer-cancelled');return runtime.forwardObserverHttp!({purpose:'observer',runtime:initial.grant.runtime,policy:initial.policy,deadlineAt:initial.grant.expiresAt},clean,new ObserverCancellation(async()=>{if(signal.aborted)return true;await authorize();return signal.aborted;}));},
      },{deadlineAt:initial.grant.expiresAt,signal:controller.signal});
      return await session.fetch(request);
    }finally{session?.close();clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',abort);}

    });
  }
  async issuePreviewTicket(input:{scope:TurnScope;principal:PreviewBrowserPrincipal;previewId:string;nonce:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    const ticket=await this.#tickets(scope).issue(input.principal,input.previewId,input.nonce);
    this.#ready(scope);return ticket;

    });
  }
  async redeemPreviewTicket(input:{scope:TurnScope;ticket:string;nonce:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    const claims=await this.#tickets(scope).redeem(input.ticket,input.nonce);
    this.#ready(scope);return claims;

    });
  }
  async exchangePreviewTicket(input:{scope:TurnScope;ticket:string;nonce:string;previewId:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope);
    const previewId=input.previewId;
    if(typeof previewId!=='string'||!previewId)throw Error('preview-ticket-denied');
    const access=await this.#tickets(scope).exchange(input.ticket,input.nonce,previewId);
    this.#ready(scope);return access;

    });
  }
  async authorizePreviewAccess(input:{scope:TurnScope;access:string;previewId:string}){
    const scope=this.#ready(input.scope);
    const claims=await this.#tickets(scope).access(input.access,input.previewId);
    this.#ready(scope);return claims;
  }
  async forwardPreviewHttp(input:{scope:TurnScope;access:string;previewId:string},request:Request):Promise<Response>{
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#ready(input.scope),clean=await serviceHttpRequest(request);
    await this.authorizePreviewAccess(input);
    const target=await this.previewTarget({scope,previewId:input.previewId}),runtime=previewRuntimeInput(target);
    if(!this.env.SERVICE_RUNTIME?.getByName)throw Error('service-forward-not-configured');
    const stub=this.env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(runtime));
    const access=await this.authorizePreviewAccess(input);
    if(JSON.stringify(access.binding)!==JSON.stringify(target.binding))throw Error('preview-target-unavailable');
    this.#ready(scope);return stub.forwardHttp(runtime,clean);

    });
  }
  async revokePreviewAccess(input:{scope:TurnScope;access:string}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope);
    // Revocation remains available when execution and Preview gates are closed.
    const journal=new SqlPreviewTickets(this.ctx.storage,scope,{
      session:async()=>{throw Error('preview-disabled');},target:async()=>{throw Error('preview-disabled');},
    });
    await journal.revokeAccess(input.access);

    });
  }
  async serviceSnapshot(input:{scope:TurnScope;runId:string}){
    const scope=this.#maintenanceScope(input.scope);
    return this.#services(scope).snapshot(input.runId);
  }
  #managedRoute():ManagedAcceptancePolicy|null{
    const task=this.#store.read()?.task;if(!task)return null;
    const scope={tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,workspaceGeneration:task.generation};
    const stored=this.ctx.storage.kv.get<ManagedAcceptancePolicy>('managed-product-route-v1')??null;
    const journal=new DurableTurnStore(this.ctx.storage).read();
    const developer=piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON);
    return resolveManagedRoute(this.env.MANAGED_ACCEPTANCE_JSON,scope,stored,!!journal&&Object.keys(journal.turns).length>0,(developer&&piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,scope.tenantId,developer.userId,scope.projectId)&&!stored)?undefined:this.env.MANAGED_TESTING_JSON);
  }
  #managedRuntime(policy:ManagedAcceptancePolicy){const namespace=this.env.MANAGED_TURN_RUNTIME;if(!namespace?.getByName)throw Error('managed-product-runtime-not-configured');return namespace.getByName(managedProductActorName(policy.scope));}
  async #managedAdmit(scope:TurnScope,actor:TurnActor,turnPreflight=true){
    const policy=this.#managedRoute();if(!policy)return null;
    requireManagedAdmission(this.env.MANAGED_ACCEPTANCE_JSON,policy,scope,actor.userId,this.env.MANAGED_TESTING_JSON);
    const authorized=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,scope.workspaceId);if(!sameScope(authorized,scope))throw Error('managed-admission-denied');
    if(turnPreflight)await this.#managedRuntime(policy).preflight(scope,actor);
    const before=this.#managedRoute();if(!before||JSON.stringify(before)!==JSON.stringify(policy))throw Error('managed-route-conflict');
    this.ctx.storage.kv.put('managed-product-route-v1',policy);await this.ctx.storage.sync();return policy;
  }
  async managedAcceptanceStatus(input:{scope:TurnScope;actor:TurnActor}){
    const scope=this.#maintenanceScope(input.scope),policy=this.#managedRoute();
    if(!policy||policy.userId!==input.actor.userId)throw Error('managed-admission-denied');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);
    if(!sameScope(allowed,scope))throw Error('managed-admission-denied');
    const budget=await this.#managedRuntime(policy).budgetStatus(scope);
    if(!budget||typeof budget!=='object'||Array.isArray(budget))throw Error('managed-budget-status-invalid');
    const records=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:'})).values()];
    const simulations=records.filter(record=>sameScope(record.scope,scope)&&record.actor.userId===input.actor.userId).map(record=>({runId:record.runId,status:record.status,released:record.released,releaseProof:record.releaseProof,stop:record.stop,artifactSha256:record.result?.artifactSha256??null}));
    const quota=await this.env.TENANT_QUOTA.getByName(tenantQuotaName(scope.tenantId)).snapshot(scope.tenantId);
    const leaseStatusCounts:Record<string,number>={};for(const lease of quota.leases)leaseStatusCounts[lease.status]=(leaseStatusCounts[lease.status]??0)+1;
    return {...budget,resources:{simulations,tenantQuota:{capacity:quota.capacity,occupied:quota.occupied,available:quota.available,unknown:quota.unknown,configuredPolicyMatches:quota.configuredPolicyMatches,leaseStatusCounts}}};
  }
  async cleanupManagedAcceptance(input:{scope:TurnScope;actor:TurnActor}){
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope),policy=this.#managedRoute();
    if(!policy||policy.userId!==input.actor.userId)throw Error('managed-admission-denied');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);
    if(!sameScope(allowed,scope))throw Error('managed-admission-denied');
    const state=await this.#turns.snapshot(scope);
    if(Object.values(state.turns).some(turn=>!['completed','failed','cancelled','interrupted'].includes(turn.status)))throw Error('managed-session-not-terminal');
    return this.#managedRuntime(policy).cleanup(scope);

    });
  }

  #developerCandidate(scope:TurnScope,actor:TurnActor){return this.env.PRIVATE_BETA_POLICY_JSON!==undefined?privateBetaCandidate(this.env.PRIVATE_BETA_POLICY_JSON):piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,scope.tenantId,actor.userId,scope.projectId);}
  #betaControl(){const stub=this.env.PRIVATE_BETA_CAPACITY?.getByName(PRIVATE_BETA_CAPACITY_ACTOR);if(!stub)throw Error('private-beta-unconfigured');return stub;}
  async privateBetaReleaseState(input:{scope:TurnScope;actor:TurnActor;sessionId:string;requestKey:string}){
    const scope=this.#maintenanceScope(input.scope),state=await this.#turns.snapshot(scope);
    const turn=Object.values(state.turns).find(t=>t.actor.userId===input.actor.userId&&t.actor.authVersion===input.actor.authVersion&&t.sessionId===input.sessionId&&t.requestKey===input.requestKey);
    const terminal=!!turn&&['completed','failed','cancelled','interrupted'].includes(turn.status);
    // Session ownership/version is immutable. A mismatched original actor can
    // never commit this request, including a delayed retry of the old POST.
    // Mere absence (a lost ACK or an in-flight admission) is not such proof.
    const session=state.sessions[input.sessionId];
    const rejectedSession=!!session&&(session.actorUserId!==input.actor.userId||session.actorAuthVersion!==input.actor.authVersion)&&
      state.activeTurnId===null&&state.releaseHold===null&&state.recoveryHold===null&&state.resourceWait===null&&
      Object.values(state.turns).every(t=>['completed','failed','cancelled','interrupted'].includes(t.status))&&
      !Object.values(state.turns).some(t=>t.actor.userId===input.actor.userId&&t.sessionId===input.sessionId&&t.requestKey===input.requestKey);
    const withdrawn=!!this.ctx.storage.kv.get(await this.#withdrawnTurnKey(input))&&
      !turn&&state.activeTurnId===null&&state.releaseHold===null&&state.recoveryHold===null&&state.resourceWait===null&&
      Object.values(state.turns).every(t=>['completed','failed','cancelled','interrupted'].includes(t.status));
    return {found:!!turn,turnId:turn?.id??null,terminal,finishedAt:turn?.finishedAt??null,released:terminal&&state.activeTurnId===null&&state.releaseHold===null&&state.recoveryHold===null,resourceWait:state.resourceWait!==null,rejectedSession,withdrawn,releaseGuard:terminal&&privateBetaNativeReleaseGuard(new DurableTurnStore(this.ctx.storage).read()?.releaseHold,turn?.id??null)};
  }
  #developerBudget(tenantId:string){const stub=this.env.PI_DEVELOPER_BUDGET?.getByName(modelBudgetTenantName(tenantId));if(!stub)throw Error('pi-developer-budget-unavailable');return stub;}
  async piDeveloperTurnAuthorization(input:{identity:TurnRuntimeIdentity;actor:TurnActor}){
    this.assertWritableScope(input.identity.scope);
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope);
    if(!this.ctx.storage.kv.get('pi-developer-turn:'+identity.turnId))return false;
    if(!this.#developerCandidate(scope,input.actor)||this.#store.read()?.task.budgetRoute||this.#managedRoute())throw Error('pi-developer-admission-denied');
    const state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||turn.status!=='running'||state.activeTurnId!==turn.id||turn.actor.userId!==input.actor.userId||turn.actor.authVersion!==input.actor.authVersion||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation||turn.cancelRequestedAt!==null)throw Error('pi-developer-turn-denied');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('pi-developer-admission-denied');if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)await this.#betaControl().authorizeTurn(scope,input.actor,identity.turnId);return true;
  }
  #g5Guard(){const guard=this.env.G5_WINDOW_GUARD?.getByName(G5_GLOBAL_ACTOR);if(!guard)throw Error('g5-workspace-guard-required');return guard;}
  #g5TerminalReconciliation=new G5TerminalReconciliation(this.ctx.storage);
  async #g5StartTask(taskKey:string,identity?:TurnRuntimeIdentity){
    const guard=this.#g5Guard(),grantKey='g5-start-grant:'+taskKey;let grant=this.ctx.storage.kv.get<string>(grantKey);
    if(!grant){const result=await guard.claimTaskStart(taskKey,identity);if(!result.authorized||!result.grantId)throw Error('g5-workspace-start-denied');grant=result.grantId;this.ctx.storage.kv.put(grantKey,grant);await this.ctx.storage.sync();}
    const confirmed=await guard.confirmTaskStartGrant(taskKey,grant);if(!confirmed.confirmed)throw Error('g5-start-grant-unconfirmed');
    const checked=await guard.checkTaskContinue(taskKey,grant);if(!checked.authorized)throw Error('g5-task-continuation-denied');
  }
  async #g5TurnStart(turn:import('../turn/protocol.ts').TurnRecord,phase:'capacity'|'runtime'){
    const route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+turn.id);
    if(!route){
      if(this.ctx.storage.kv.get('pi-developer-turn:'+turn.id)){if(!this.#developerCandidate(turn.scope,turn.actor))throw Error('pi-developer-admission-denied');if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)await this.#betaControl().authorizeTurn(turn.scope,turn.actor,turn.id);return;}
      // Journal commit can survive a lost sync ACK before the route callback runs.
      // Missing provenance in a configured G5 Workspace never authorizes a legacy start.
      if(this.env.G5_CONTROLLED_WINDOW_JSON!==undefined)throw Error('g5-turn-route-unavailable');
      return;
    }
    if(phase==='capacity'){const result=await this.#g5Guard().checkTaskStart(route.taskKey);if(!result.authorized)throw Error('g5-workspace-start-denied');return;}
    await this.#g5StartTask(route.taskKey,{scope:turn.scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId!,generation:turn.runtimeGeneration!});
    const usedKey='g5-native-accept:'+route.taskKey;if(this.ctx.storage.kv.get(usedKey))throw Error('g5-native-accept-reconcile-only');this.ctx.storage.kv.put(usedKey,true);await this.ctx.storage.sync();
  }
  async #g5Terminal(turn:import('../turn/protocol.ts').TurnRecord){if(this.#g5TerminalReconciliation.read(turn.id))return;if(this.ctx.storage.kv.get('pi-developer-turn:'+turn.id)&&turn.dispatchId&&turn.runtimeGeneration){const identity=turnRuntimeIdentity({scope:turn.scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration});await this.#developerBudget(turn.scope.tenantId).closeTurnAdmission(turn.scope.tenantId,identity);}const route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+turn.id);if(!route||this.ctx.storage.kv.get('g5-terminal-closed:'+turn.id))return;if(!turn.dispatchId||!turn.runtimeGeneration){if(turn.status==='cancelled'){await this.#g5Guard().cancelUnstartedTask(route.taskKey);this.ctx.storage.kv.put('g5-terminal-closed:'+turn.id,true);await this.ctx.storage.sync();}return;}const identity=turnRuntimeIdentity({scope:turn.scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration});if(!this.env.G5_TOKEN_BUDGET||!this.env.PRODUCTION_MODEL_BUDGET||!this.env.TOOL_BRIDGE_AGENT)throw Error('g5-terminal-ledgers-required');await this.#g5TerminalReconciliation.run(turn.id,async()=>{await Promise.all([this.env.G5_TOKEN_BUDGET!.getByName(modelBudgetTenantName(identity.scope.tenantId)).closeTurnAdmission(identity.scope.tenantId,identity),this.env.PRODUCTION_MODEL_BUDGET!.getByName(PRODUCTION_MONEY_ACTOR).closeTurnAdmission(identity),this.env.TOOL_BRIDGE_AGENT!.getByName(await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId)).closeTurnAdmission(identity)]);await this.#g5Guard().closeTrustedTurn(route.taskKey,identity);this.ctx.storage.kv.put('g5-terminal-closed:'+turn.id,true);await this.ctx.storage.sync();});}
  async #g5ProjectStart(task:WorkspaceTask){if(!task.budgetRoute)return;await this.#g5StartTask(task.budgetRoute.taskKey);}
  #engine(): WorkspaceTurnEngine {
    const managed=this.#managedRoute();
    if(managed)return this.#turnEngine??=new WorkspaceTurnEngine(this.#turns,this.#managedRuntime(managed),this.#turnAlarm,Date.now,{},this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),null,turnOperationTracer(this.env.M2_TURN_OPERATION_TELEMETRY));
    if (!this.env.PRODUCT_TURN_RUNTIME?.getByName) throw Error('product-turn-runtime-not-configured');
    if (!this.env.TOOL_ARTIFACT_STORE?.getByName) throw Error('tool-artifact-store-not-configured');
    if (!this.env.TRUSTED_PI_CAPACITY?.getByName) throw Error('trusted-pi-capacity-binding-required');
    return this.#turnEngine ??= new WorkspaceTurnEngine(
      this.#turns,
      new ProductTurnRuntimeClient(this.env.PRODUCT_TURN_RUNTIME),
      this.#turnAlarm,
      Date.now,
      {},
      this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),
      this.#leases(),
      turnOperationTracer(this.env.M2_TURN_OPERATION_TELEMETRY),
      (turn,phase)=>this.#g5TurnStart(turn,phase),
      turn=>this.#g5Terminal(turn),
    );
  }
  #for(input: WorkspaceTask): WorkspaceCoordinator {
    const task = validateWorkspaceTask(input);
    if (!this.env.WORKSPACE_AGENT.idFromName(workspaceAgentName(task.tenantId, task.workspaceId)).equals(this.ctx.id)) throw Error('workspace-actor-scope-denied');
    if (!this.#coordinator) {
      this.#coordinator = new WorkspaceCoordinator(this.#store, {
        beforeStart:task=>this.#g5ProjectStart(task),
        catalog: new ProvisioningCatalog(catalogDatabase(this.env.CATALOG)),
        quota: this.env.TENANT_QUOTA.getByName(tenantQuotaName(task.tenantId)),
        runtime: identity => this.env.PROJECT_RUNTIME.getByName(runtimeName(identity)),
        hold: promise => this.ctx.waitUntil(promise),
      });
    }
    return this.#coordinator;
  }
  async accept(task: WorkspaceTask) { if(this.#archiveFence.get())throw Error('project_archived');return this.#for(task).accept(task); }
  async report(task: WorkspaceTask) {
    const coordinator = this.#for(task), state = coordinator.report();
    if (state && JSON.stringify(state.task) !== JSON.stringify(validateWorkspaceTask(task))) throw Error('workspace-task-conflict');
    return state;
  }
  async stop(task: WorkspaceTask) { if(this.#archiveFence.get())throw Error('project_archived');return this.#for(task).stop(task); }
  async reconcile(task: WorkspaceTask) { if(this.#archiveFence.get())throw Error('project_archived');return this.#for(task).reconcile(task); }
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
    return this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).resolveInitial(reference,scope);
  }
  async createSession(input: { scope: TurnScope; actor: TurnActor; key: string; body: { title: unknown } }) {
    return this.#archiveWrite(input.scope,async()=>{
    return this.#turns.createSession(this.#ready(input.scope), input.actor, input.key, input.body);

    });
  }
  async turnReceipt(input:{scope:TurnScope;actor:TurnActor;sessionId:string;key:string}){
    const scope=this.#ready(input.scope),receipt=await this.#turns.receipt(scope,input.actor,input.sessionId,input.key),turn=receipt.turn,managed=this.#managedRoute();
    if(!managed){
      const developerRoute=this.ctx.storage.kv.get<{privateBeta?:boolean}>('pi-developer-turn:'+turn.id),g5Route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+turn.id);
      if(developerRoute){
        if(developerRoute.privateBeta&&!await this.#betaControl().turnBinding({scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.key},turn.id).then(result=>result.bound))throw Error('turn-receipt-not-found');
      }else if(g5Route){
        if(g5Route.kind!=='g5'||!await this.#g5Guard().taskBinding(g5Route.taskKey,turn.id).then(result=>result.bound))throw Error('turn-receipt-not-found');
      }else if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined||piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,scope.tenantId,input.actor.userId,scope.projectId)||this.env.G5_CONTROLLED_WINDOW_JSON!==undefined)throw Error('turn-receipt-not-found');
    }
    return {accepted:true,turn};
  }
  async #bindDeveloperTurn(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,turn:import('../turn/protocol.ts').TurnRecord){
    const beta=privateBetaPolicy(this.env.PRIVATE_BETA_POLICY_JSON),marker={policyId:beta?.policyId??piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON)!.policyId,...(beta?{privateBeta:true}:{})},prior=this.ctx.storage.kv.get('pi-developer-turn:'+turn.id);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(marker))throw Error('pi-developer-turn-route-conflict');
    this.ctx.storage.kv.put('pi-developer-turn:'+turn.id,marker);await this.ctx.storage.sync();
    if(beta)await this.#betaControl().bindTurn({scope,actor,sessionId,requestKey:key},turn.id);
  }
  async #bindG5Turn(route:WorkspaceBudgetRoute,turn:import('../turn/protocol.ts').TurnRecord,recovery?:G5TaskRecovery){
    const prior=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+turn.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(route))throw Error('g5-turn-route-conflict');
    this.ctx.storage.kv.put('g5-turn-route:'+turn.id,route);this.ctx.storage.kv.put('g5-submission:'+route.taskKey,turn.id);await this.ctx.storage.sync();
    if(recovery){const repaired=await this.#g5Guard().repairTaskBinding(recovery,turn.id);if(repaired.taskKey!==route.taskKey||repaired.windowId!==route.windowId||repaired.profileSha256!==route.profileSha256)throw Error('g5-turn-route-conflict');}else await this.#g5Guard().bindTask(route.taskKey,turn.id);
  }
  #managedSubmitTail:Promise<unknown>=Promise.resolve();
  async #withdrawnTurnKey(input:{scope:TurnScope;actor:TurnActor;sessionId:string;requestKey:string}){
    return 'withdrawn-turn:'+await turnDigest({scope:input.scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.requestKey});
  }
  withdrawTurn(input:{scope:TurnScope;actor:TurnActor;sessionId:string;key:string;body:{message:unknown}}){
    return this.#archiveWrite(input.scope,async()=>{
    const next=this.#managedSubmitTail.then(async()=>{
      const scope=this.#ready(input.scope);
      if(this.env.PRIVATE_BETA_POLICY_JSON===undefined||!this.#developerCandidate(scope,input.actor))throw Error('turn-withdrawal-not-supported');
      this.#turns.validateSubmission(scope,input.actor,input.sessionId,input.key,input.body);
      const state=await this.#turns.snapshot(scope);
      if(Object.values(state.turns).some(t=>t.actor.userId===input.actor.userId&&t.sessionId===input.sessionId&&t.requestKey===input.key))throw Error('turn-intent-accepted');
      const marker=await this.#withdrawnTurnKey({scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.key});
      const digest=await turnDigest({message:input.body.message});
      const prior=this.ctx.storage.kv.get<string>(marker);
      if(prior&&prior!==digest)throw Error('turn-idempotency-conflict');
      this.ctx.storage.kv.put(marker,digest);await this.ctx.storage.sync();
      return {withdrawn:true,accepted:false};
    });
    this.#managedSubmitTail=next.catch(()=>{});return next;

    });
  }
  submitTurn(input: { scope: TurnScope; actor: TurnActor; sessionId: string; key: string; body: { message: unknown } }) {
    return this.#archiveWrite(input.scope,async()=>{
    // Serialize admission through the durable journal commit. DO input gates
    // alone do not cover the external preflight/catalog awaits in this method.
    if(!this.#managedRoute()&&!this.#developerCandidate(input.scope,input.actor))return this.#submitTurn(input);
    const next=this.#managedSubmitTail.then(()=>this.#submitTurn(input));
    this.#managedSubmitTail=next.catch(()=>{});return next;

    });
  }
  async #submitTurn(input: { scope: TurnScope; actor: TurnActor; sessionId: string; key: string; body: { message: unknown } }) {
    const trace=(stage:TurnAdmissionStage,transportSuccess:boolean,error?:unknown)=>traceTurnAdmission(this.env.M2_TURN_ADMISSION_TELEMETRY,stage,transportSuccess,error);
    let scope:TurnScope;
    try{scope=this.#ready(input.scope);trace('ready',true);}catch(error){trace('ready',false,error);throw error;}
    if(this.ctx.storage.kv.get(await this.#withdrawnTurnKey({scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.key})))throw Error('turn-intent-withdrawn');
    const selected=this.#managedRoute();
    const developer=!selected&&!this.#store.read()?.task.budgetRoute&&this.#developerCandidate(scope,input.actor);
    const state=await this.#turns.snapshot(scope),prior=Object.values(state.turns).find(turn=>turn.sessionId===input.sessionId&&turn.requestKey===input.key&&turn.actor.userId===input.actor.userId),replay=prior?await this.#turns.submit(scope,input.actor,input.sessionId,input.key,input.body):null,persistedDeveloperRoute=prior&&this.ctx.storage.kv.get<{privateBeta?:boolean}>('pi-developer-turn:'+prior.id),developerEligible=!selected&&!this.#store.read()?.task.budgetRoute,betaAdmission=prior&&developerEligible&&this.env.PRIVATE_BETA_POLICY_JSON!==undefined?await this.#betaControl().turnBinding({scope,actor:input.actor,sessionId:input.sessionId,requestKey:input.key},prior.id).then(result=>result.found):false;
    let recoveredG5:{route:WorkspaceBudgetRoute;task:G5TaskRecovery}|undefined;
    if(prior&&!selected&&!developer&&!persistedDeveloperRoute&&!betaAdmission&&this.env.G5_WINDOW_GUARD){const task=await g5TaskRecovery('turn',scope.tenantId,input.actor.userId,{scope,sessionId:input.sessionId,key:input.key},input.body) as G5TaskRecovery,binding=await this.#g5Guard().taskBindingForIntent(task,prior.id);if(binding.found&&binding.taskKey&&binding.windowId&&binding.profileSha256)recoveredG5={task,route:{kind:'g5',taskKey:binding.taskKey,windowId:binding.windowId,profileSha256:binding.profileSha256}};}
    if(prior&&(selected||developer||persistedDeveloperRoute||betaAdmission||recoveredG5)){
        const validated=replay!;
        if(selected&&selected.userId!==input.actor.userId)throw Error('managed-admission-denied');
        const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);
        if(!sameScope(allowed,scope))throw Error('managed-admission-denied');
        // Original idempotency validation remains the journal's authority.
        // An explicit developer retry may repair only its post-commit route;
        // it never creates another Turn or provider request.
        if(persistedDeveloperRoute?.privateBeta||betaAdmission){if(this.env.PRIVATE_BETA_POLICY_JSON===undefined)throw Error('private-beta-unconfigured');await this.#bindDeveloperTurn(scope,input.actor,input.sessionId,input.key,validated.turn);}
        else if(developer&&!persistedDeveloperRoute)await this.#bindDeveloperTurn(scope,input.actor,input.sessionId,input.key,validated.turn);
        else if(recoveredG5)await this.#bindG5Turn(recoveredG5.route,validated.turn,recoveredG5.task);
        return validated;
    }
    if(selected||developer){
      if(Object.values(state.turns).some(turn=>!['completed','failed','cancelled','interrupted'].includes(turn.status))||state.releaseHold||state.recoveryHold)throw Error('managed-input-in-flight');
    }
    const managed=await this.#managedAdmit(scope,input.actor);
    try{if(!managed&&this.env.M2_TURNS_ENABLED!=='true')throw Error('turn-runtime-not-ready');trace('gate',true);}catch(error){trace('gate',false,error);throw error;}
    let engine:WorkspaceTurnEngine;
    try{engine=this.#engine();trace('engine',true);}catch(error){trace('engine',false,error);throw error;}
    if(!managed&&this.env.G4_CONTROLLED_WINDOW_JSON!==undefined)await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    let route:WorkspaceBudgetRoute|undefined;
    if(developer){
      // Reject immutable Session mismatches and malformed input before reserving
      // user capacity. submit() still rechecks inside the journal transaction.
      this.#turns.validateSubmission(scope,input.actor,input.sessionId,input.key,input.body);
      await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
      const state=await this.#turns.snapshot(scope);
      if(Object.values(state.turns).some(t=>this.ctx.storage.kv.get('g5-turn-route:'+t.id)))throw Error('pi-developer-historical-g5-denied');
      for(const old of Object.values(state.turns)){
        if(this.ctx.storage.kv.get('pi-developer-turn:'+old.id)||!old.dispatchId||!old.runtimeGeneration)continue;
        const identity=turnRuntimeIdentity({scope,sessionId:old.sessionId,turnId:old.id,dispatchId:old.dispatchId,generation:old.runtimeGeneration});
        const ledger=this.env.TENANT_MODEL_BUDGET?.getByName(modelBudgetTenantName(scope.tenantId));
        if(!ledger)throw Error('pi-developer-historical-ledger-unavailable');
        await ledger.assertTurnExecutionIsolated(scope.tenantId,identity);
      }
      await this.#developerBudget(scope.tenantId).admitTurn(scope,input.actor.userId,input.sessionId,input.key,input.actor);
    }else if(!managed&&this.env.G5_CONTROLLED_WINDOW_JSON!==undefined){
      await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
      const task=await g5TaskKey(this.env.G5_CONTROLLED_WINDOW_JSON,'turn',scope.tenantId,input.actor.userId,{scope,sessionId:input.sessionId,key:input.key},input.body);
      const policy=g5WindowPolicy(JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON))!;const guard=this.#g5Guard();await guard.registerTask(task);
      route={kind:'g5',taskKey:task.key,windowId:policy.windowId,profileSha256:policy.profilePin.profileSha256};
      const known=this.ctx.storage.kv.get<string>('g5-submission:'+task.key);if(!known){const created=await guard.claimTaskCreate(task.key);if(!created.authorized)throw Error('g5-turn-create-denied');}
    }else if(!managed){await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'turn',{scope,sessionId:input.sessionId,key:input.key},input.body);}

    this.#ready(scope);
    return engine.submit(scope,input.actor,input.sessionId,input.key,input.body,trace,developer?turn=>this.#bindDeveloperTurn(scope,input.actor,input.sessionId,input.key,turn):route?turn=>this.#bindG5Turn(route!,turn):undefined);
  }
  async cancelTurn(input: { scope: TurnScope; actor: TurnActor; turnId: string }) {
    return this.#archiveWrite(input.scope,async()=>{
    const turn=await this.#engine().cancel(this.#ready(input.scope), input.actor, input.turnId);if(!this.#managedRoute()&&['completed','failed','cancelled','interrupted'].includes(turn.status))await this.#g5Terminal(turn);return turn;

    });
  }
  async replayTurnEvents(input: { scope: TurnScope; afterSequence: number; limit: number }) {
    return this.#turns.replay(this.#ready(input.scope), input.afterSequence, input.limit);
  }
  async turnSnapshot(input: { scope: TurnScope; actor?:TurnActor }) {
    const scope=this.#ready(input.scope),snapshot=await this.#turns.view(scope,input.actor),managed=this.#managedRoute();
    if(this.#archiveFence.get())return {...snapshot,archived:true,piDeveloperState:{billingMode:'observe',blocked:'project_archived'}};
    if(!managed&&this.env.PRIVATE_BETA_POLICY_JSON!==undefined){
      let admitted=false,blocked:string|null=null;
      if(input.actor&&this.#developerCandidate(scope,input.actor)&&!this.#store.read()?.task.budgetRoute&&!Object.keys(snapshot.turns).some(id=>this.ctx.storage.kv.get('g5-turn-route:'+id))){
        try{await authorizePrivateBeta(this.env.CATALOG,scope,input.actor);admitted=true;}catch{blocked='private-beta-admission-denied';}
      }
      return {...snapshot,runtimeBackend:'pi' as const,...(admitted?{piDeveloperState:{billingMode:'observe',blocked,privateBeta:true}}:{})};
    }
    if(!managed){
      const policy=piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON);
      const developer=!!policy&&piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,scope.tenantId,policy.userId,scope.projectId)&&!this.#store.read()?.task.budgetRoute&&!Object.keys(snapshot.turns).some(id=>this.ctx.storage.kv.get('g5-turn-route:'+id));
      let blocked:string|null=null;
      if(developer&&!snapshot.activeTurnId)try{await this.#developerBudget(scope.tenantId).assertQuiet(scope,policy!.userId);}catch(error){blocked=error instanceof Error&&['pi-developer-execution-unconfirmed','pi-developer-execution-isolation-unconfirmed'].includes(error.message)?error.message:'pi-developer-historical-ledger-unavailable';}
      return {...snapshot,runtimeBackend:'pi' as const,...(developer?{piDeveloperState:{billingMode:'observe',blocked}}:{})};
    }
    try{
      const status=await this.#managedRuntime(managed).budgetStatus(scope);
      if(!status||typeof status!=='object'||Array.isArray(status))throw Error('managed-budget-status-invalid');
      const value=status as Record<string,unknown>;
      return {...snapshot,runtimeBackend:'managed' as const,managedState:{stopped:typeof value.stopped==='string'?value.stopped:null,unresolved:Number.isSafeInteger(value.unresolved)?value.unresolved:null,cleanupPending:value.cleanupPending===true}};
    }catch{return {...snapshot,runtimeBackend:'managed' as const,managedState:{unavailable:true}};}
  }
  /** Private maintenance RPC for an exact persisted terminal turn. It only
   * observes the existing ProductTurnRuntime identity and advances the matching
   * release hold; it does not run model settlement or claim queued work. */
  async reconcileRuntimeRelease(input:{identity:TurnRuntimeIdentity}){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||!['completed','failed','cancelled','interrupted'].includes(turn.status)||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation)throw Error('turn-release-scope-denied');
    if(state.releaseHold===null)return {schemaVersion:1 as const,releaseHold:null};
    await this.#engine().reconcileRelease(scope,identity);
    const after=await this.#turns.view(scope);
    return {schemaVersion:1 as const,releaseHold:after.releaseHold};

    });
  }
  async runtimeReleaseSnapshot(input:{identity:TurnRuntimeIdentity}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||!['completed','failed','cancelled','interrupted'].includes(turn.status)||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation)throw Error('turn-release-scope-denied');
    return {schemaVersion:1 as const,status:turn.status,persistenceOutcome:turn.persistenceOutcome,active:state.activeTurnId!==null,releaseHold:state.releaseHold?{status:state.releaseHold.status,matches:state.releaseHold.turnId===identity.turnId}:null,recoveryHold:state.recoveryHold?{matches:state.recoveryHold.turnId===identity.turnId}:null};
  }
  /** Private platform attestation for one exact historical model blocker. The
   * Workspace reads the ledger-owned identity, proves all execution consumers
   * quiescent, and only then appends a proof back to that source ledger. */
  async attestExecutionIsolation(input:{tenantId:string;ledger:'legacy'|'g5';callKey:string}){
    if(!input||Object.keys(input).sort().join(',')!=='callKey,ledger,tenantId'||!['legacy','g5'].includes(input.ledger)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.tenantId)||!/^[a-f0-9]{64}$/.test(input.callKey))throw Error('model-execution-isolation-input-invalid');
    const namespace=input.ledger==='legacy'?this.env.TENANT_MODEL_BUDGET:this.env.G5_TOKEN_BUDGET;
    if(!namespace||!this.env.TOOL_BRIDGE_AGENT)throw Error('model-execution-isolation-authority-unavailable');
    const tenantId=input.tenantId;
    const ledger=namespace.getByName(modelBudgetTenantName(tenantId)),candidate=await ledger.executionIsolationCandidate(tenantId,input.callKey),identity=turnRuntimeIdentity(candidate.identity),scope=this.#maintenanceScope(identity.scope);
    if(scope.tenantId!==tenantId)throw Error('model-execution-isolation-scope-denied');
    return this.#archiveWrite(scope,async()=>{
    const state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||!['completed','failed','cancelled','interrupted'].includes(turn.status)||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation||state.activeTurnId!==null||state.releaseHold!==null||state.recoveryHold!==null)throw Error('model-execution-isolation-workspace-active');
    const model=await ledger.closeTurnAdmission(tenantId,identity);
    if(!model.closed)throw Error('model-execution-isolation-model-open');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).fenceExecution(identity);
    const toolActor=this.env.TOOL_BRIDGE_AGENT!.getByName(await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId)),tools=await toolActor.closeTurnAdmission(identity);
    const isolatedAt=Date.now();
    if(candidate.blocker.deadlineAt>isolatedAt||!tools.closed||tools.active!==0||tools.pending!==0||tools.unknown!==0)throw Error('model-execution-isolation-tools-active');
    const authority={schemaVersion:1 as const,identity,ledger:input.ledger,callKey:input.callKey,recordDigest:candidate.recordDigest,modelDeadlineAt:candidate.blocker.deadlineAt,workspace:{status:turn.status,persistenceOutcome:turn.persistenceOutcome,active:false,releaseHold:null,recoveryHold:null},model:{closed:model.closed,closedAt:model.closedAt,total:model.total,active:model.active,pending:model.pending,unknown:model.unknown},runtime:{identityDigest:runtime.identityDigest,fencedAt:runtime.fencedAt,classification:runtime.classification},tools:{closed:tools.closed,closedAt:tools.closedAt,total:tools.total,active:tools.active,pending:tools.pending,unknown:tools.unknown},isolatedAt};
    const proof={schemaVersion:1 as const,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:await turnDigest(authority),isolatedAt,classification:runtime.classification};
    const authorityMac=await issueExecutionIsolationAuthority(this.env.M2_MODEL_TURN_CAPABILITY_KEY,input.ledger,tenantId,proof);
    const stored=await ledger.recordExecutionIsolation(tenantId,proof,authorityMac);
    return {schemaVersion:1 as const,ledger:input.ledger,proof:stored.proof,proofDigest:stored.proofDigest,evidenceSha256:proof.evidenceSha256,authorityReceiptSha256:await turnDigest({authority,proofDigest:stored.proofDigest})};
    });
  }
  async g5TurnAuthority(input:{identity:TurnRuntimeIdentity;userId:string}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||turn.actor.userId!==input.userId||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation||turn.status!=='completed'||turn.executionOutcome!=='completed'||turn.persistenceOutcome!=='saved'||!turn.checkpoint||state.activeTurnId!==null||state.releaseHold!==null||state.recoveryHold!==null)throw Error('g5-turn-authority-unsettled');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-turn-authority-denied');
    const head=this.#turns.workspaceRevisionSnapshot(scope);if(!head||head.identity.turnId!==identity.turnId||JSON.stringify(head.receipt)!==JSON.stringify(turn.checkpoint))throw Error('g5-turn-authority-head-mismatch');
    const model=await this.modelSpec({scope});if(!model.version)throw Error('g5-turn-authority-model-absent');const toolEventIds=state.events.filter(event=>event.turnId===identity.turnId&&event.type==='tool.completed').map(event=>event.eventId);if(!toolEventIds.length||model.version.revisionId!==turn.checkpoint.revisionId||model.version.filesSha256!==turn.checkpoint.filesSha256)throw Error('g5-turn-authority-evidence-absent');
    return {schemaVersion:1 as const,identity,requestKey:turn.requestKey,version:model.version,toolEventIds};
  }
  async g5FixtureTurnAuthority(rawIdentity:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(rawIdentity),scope=this.#maintenanceScope(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId],route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-turn-route:'+identity.turnId);if(!turn||route?.kind!=='g5'||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.runtimeGeneration!==identity.generation||turn.status!=='completed'||turn.executionOutcome!=='completed'||turn.persistenceOutcome!=='saved'||!turn.checkpoint||state.activeTurnId!==null||state.releaseHold!==null||state.recoveryHold!==null)throw Error('g5-fixture-turn-authority-unsettled');const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-fixture-turn-authority-denied');const head=this.#turns.workspaceRevisionSnapshot(scope);if(!head||JSON.stringify(head.identity)!==JSON.stringify(identity)||JSON.stringify(head.receipt)!==JSON.stringify(turn.checkpoint))throw Error('g5-fixture-turn-authority-head-mismatch');const model=await this.modelSpec({scope});if(!model.version||model.version.revisionId!==turn.checkpoint.revisionId||model.version.filesSha256!==turn.checkpoint.filesSha256)throw Error('g5-fixture-turn-authority-revision-mismatch');const events=state.events.filter(event=>event.turnId===identity.turnId&&event.type==='tool.completed').map(event=>({eventId:event.eventId,type:event.type,payload:structuredClone(event.payload)}));return {schemaVersion:1 as const,identity,requestKey:turn.requestKey,source:model.version,checkpointFilesSha256:turn.checkpoint.filesSha256,events};}
  async g5SimulationRunAuthority(input:{identity:TurnRuntimeIdentity;userId:string;taskKey:string;runId:string;artifactSha256:string}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),record=await this.#simulations(scope).get(input.runId);if(record.actor.userId!==input.userId||!sameScope(record.scope,scope)||record.budgetRoute?.kind!=='g5'||record.budgetRoute.taskKey!==input.taskKey||record.runId!==input.runId||record.status!=='completed'||record.result?.artifactSha256!==input.artifactSha256||record.released!==true||record.releaseProof===null)throw Error('g5-run-authority-unsettled');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(record.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-run-authority-denied');
    return {schemaVersion:1 as const,runId:record.runId,taskKey:record.budgetRoute.taskKey,requestKey:record.key,artifactSha256:record.result.artifactSha256,released:true,active:0,unknown:0,releaseProof:record.releaseProof};
  }
  async g5FixtureTerminalAuthority(input:{identity:TurnRuntimeIdentity;userId:string;runIds:string[];groupId:string|null;claimIds:string[];version:{revisionId:string|null;filesSha256:string;specSha256:string}}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),turn=(await this.#turns.snapshot(scope)).turns[identity.turnId];if(!turn||turn.actor.userId!==input.userId||turn.status!=='completed'||turn.persistenceOutcome!=='saved'||new Set(input.runIds).size!==input.runIds.length||new Set(input.claimIds).size!==input.claimIds.length||!this.env.WORKSPACE_CHECKPOINTS)throw Error('g5-fixture-terminal-authority-denied');const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-fixture-terminal-authority-denied');
    const runs=[];for(const runId of input.runIds){const record=await this.#simulations(scope).get(runId);if(record.actor.userId!==input.userId||!sameScope(record.scope,scope)||record.status!=='completed'||record.errorCode!==null||!record.result||record.released!==true||record.releaseProof===null||JSON.stringify(modelVersion(record.input.plan))!==JSON.stringify(input.version)||Object.values(record.result.metrics).some(value=>!Number.isFinite(value)||value<0))throw Error('g5-fixture-run-authority-unsettled');const evidence=await g5B2RunEvidence(this.env.WORKSPACE_CHECKPOINTS,scope,record,identity.turnId);runs.push({runId:record.runId,requestKey:record.key,artifactSha256:record.result.artifactSha256,parameters:record.input.parameters,seed:record.input.seed,metrics:record.result.metrics,released:true,releaseProof:record.releaseProof,evidence});}
    let group:null|{groupId:string;runIds:string[];taskKey:string}=null;if(input.groupId!==null){const record=await this.#experimentGroups(scope).get(input.groupId),route=this.ctx.storage.kv.get<WorkspaceBudgetRoute>('g5-group-route:'+input.groupId);const ids=record.children.map(child=>child.runId).sort();if(record.status!=='completed'||record.actor.userId!==input.userId||!sameScope(record.scope,scope)||JSON.stringify(ids)!==JSON.stringify([...input.runIds].sort())||JSON.stringify(modelVersion(record.plan))!==JSON.stringify(input.version)||route?.kind!=='g5')throw Error('g5-fixture-group-authority-unsettled');group={groupId:record.groupId,runIds:ids,taskKey:route.taskKey};}
    const head=await this.#evidenceHead(scope),claims=[];for(const claimId of input.claimIds){const claim=await this.#evidence(scope).get(claimId,head);if(claim.evidenceValidity!=='verified'||claim.stale||claim.olderRevision)throw Error('g5-fixture-claim-authority-unsettled');claims.push(claim);}g5FixtureClaimContract(claims,input.runIds,group?.groupId??null,turn.actor);
    const historical=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:'})).values()].filter(record=>!input.runIds.includes(record.runId)&&record.actor.userId===input.userId&&sameScope(record.scope,scope)&&record.status==='completed'&&record.result&&record.released&&record.releaseProof&&JSON.stringify(modelVersion(record.input.plan))!==JSON.stringify(input.version)).map(record=>({runId:record.runId,artifactSha256:record.result!.artifactSha256,version:modelVersion(record.input.plan)}));
    return {schemaVersion:1 as const,runs,group,claims,historical};
  }
  async g5SimulationWindowAuthority(input:{identity:TurnRuntimeIdentity;userId:string;windowId:string}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),turn=(await this.#turns.snapshot(scope)).turns[identity.turnId];if(!turn||turn.actor.userId!==input.userId)throw Error('g5-window-simulation-authority-denied');const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-window-simulation-authority-denied');
    const runs=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:'})).values()].filter(record=>record.budgetRoute?.kind==='g5'&&record.budgetRoute.windowId===input.windowId);for(const record of runs)if(!sameScope(record.scope,scope)||record.actor.userId!==input.userId)throw Error('g5-window-simulation-authority-conflict');
    const groups=[...(await this.ctx.storage.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].filter(group=>group.actor.userId===input.userId&&sameScope(group.scope,scope)&&group.children.some(child=>runs.some(run=>run.runId===child.runId)));
    return {schemaVersion:1 as const,...g5TerminalGroupAuthority(runs,groups)};
  }
  async g5ReadonlyCounters(input:{identity:TurnRuntimeIdentity;userId:string;windowId:string}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),turn=(await this.#turns.snapshot(scope)).turns[identity.turnId];
    if(!turn||turn.actor.userId!==input.userId)throw Error('g5-readonly-counters-authority-denied');
    const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-readonly-counters-authority-denied');
    const runs=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:'})).values()].filter(record=>record.budgetRoute?.kind==='g5'&&record.budgetRoute.windowId===input.windowId);
    for(const record of runs)if(!sameScope(record.scope,scope)||record.actor.userId!==input.userId)throw Error('g5-readonly-counters-authority-conflict');
    const runIds=new Set(runs.map(record=>record.runId)),groups=[...(await this.ctx.storage.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].filter(group=>group.actor.userId===input.userId&&sameScope(group.scope,scope)&&group.children.some(child=>runIds.has(child.runId)));
    const activeRuns=runs.filter(record=>['waiting_for_capacity','preparing','running','finalizing','stopping'].includes(record.status)).length,pendingRuns=runs.filter(record=>record.status==='queued'||record.status==='completed'&&(!record.released||record.releaseProof===null)).length,unknownRuns=runs.filter(record=>record.status==='unknown'||['failed','cancelled'].includes(record.status)).length;
    const activeGroups=groups.filter(group=>group.status==='running').length,pendingGroups=groups.filter(group=>group.status==='queued'||group.status==='completed'&&group.children.some(child=>!runIds.has(child.runId))).length,unknownGroups=groups.filter(group=>['partial','failed','cancelled'].includes(group.status)).length;
    const head=this.#turns.workspaceRevisionSnapshot(scope),version=(await this.modelSpec({scope})).version;if(!head||!version||version.revisionId!==head.receipt.revisionId||version.filesSha256!==head.receipt.filesSha256)throw Error('g5-readonly-counters-revision-absent');
    return {schemaVersion:1 as const,projectId:scope.projectId,revision:version,simulationRuns:runs.length,groups:groups.length,active:activeRuns+activeGroups,pending:pendingRuns+pendingGroups,unknown:unknownRuns+unknownGroups,runIds:[...runIds].sort(),groupIds:groups.map(group=>group.groupId).sort()};
  }
  async beginG5ReadonlyReadSession(input:{identity:TurnRuntimeIdentity;userId:string;windowId:string;bindingSha256:string;binding:{schemaVersion:1;kind:'before-reopen-readonly';projectId:string;workspaceId:string;revision:{revisionId:string;filesSha256:string;specSha256:string};runIds:string[];groupIds:string[];claimIds:string[]}}){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),binding=input.binding;
    if(!/^[a-f0-9]{64}$/.test(input.bindingSha256)||await turnDigest(binding)!==input.bindingSha256||binding?.schemaVersion!==1||binding.kind!=='before-reopen-readonly'||binding.projectId!==scope.projectId||binding.workspaceId!==scope.workspaceId)throw Error('g5-read-session-binding-invalid');
    const authority=await this.g5ReadonlyAttestationAuthority({identity,userId:input.userId,windowId:input.windowId,kind:'before-reopen-readonly'}),expected={schemaVersion:1,kind:authority.kind,projectId:authority.projectId,workspaceId:authority.workspaceId,revision:authority.revision,runIds:authority.runIds,groupIds:authority.groupIds,claimIds:authority.claimIds};
    if(JSON.stringify(binding)!==JSON.stringify(expected))throw Error('g5-read-session-authority-mismatch');
    const key='g5-read-session-binding:'+input.windowId+':'+input.bindingSha256,priorId=await this.ctx.storage.get<string>(key);
    const now=Date.now();if(priorId){const prior=await this.ctx.storage.get<any>('g5-read-session:'+priorId);if(!prior||prior.bindingSha256!==input.bindingSha256)throw Error('g5-read-session-state-conflict');if(!Number.isSafeInteger(prior.expiresAt)||now>=prior.expiresAt)throw Error('g5-read-session-expired');return {schemaVersion:1 as const,sessionId:prior.sessionId,capability:prior.capability,createdAt:prior.createdAt,expiresAt:prior.expiresAt};}
    const sessionId='g5-read-'+crypto.randomUUID(),random=new Uint8Array(32);crypto.getRandomValues(random);const capability=[...random].map(value=>value.toString(16).padStart(2,'0')).join(''),createdAt=now,expiresAt=createdAt+30*60*1000,base=`/api/workspaces/${scope.workspaceId}`,paths=[base,base+'/files',base+'/model',...binding.runIds.map(id=>`${base}/experiments/${id}`),...binding.groupIds.map(id=>`${base}/experiment-groups/${id}`),...binding.claimIds.map(id=>`${base}/evidence/${id}`)],state={schemaVersion:1,sessionId,capability,createdAt,expiresAt,consumedAt:null,windowId:input.windowId,scope,userId:input.userId,authVersion:(await this.#turns.snapshot(scope)).turns[identity.turnId]!.actor.authVersion,binding,bindingSha256:input.bindingSha256,paths,reads:[],status:'open',receipt:null};
    await this.ctx.storage.put('g5-read-session:'+sessionId,state);await this.ctx.storage.put(key,sessionId);await this.ctx.storage.sync();return {schemaVersion:1 as const,sessionId,capability,createdAt,expiresAt};

    });
  }
  async recordG5ReadonlyRead(input:{scope:TurnScope;actor:TurnActor;sessionId:string;capability:string;path:string;status:number;bodySha256:string}){if(this.#archiveFence.get())return {recorded:false};
    return this.#archiveWrite(input.scope,async()=>{
    const scope=this.#maintenanceScope(input.scope),key='g5-read-session:'+input.sessionId,state=await this.ctx.storage.get<any>(key);
    const now=Date.now();if(!state||state.status!=='open'||!Number.isSafeInteger(state.createdAt)||!Number.isSafeInteger(state.expiresAt)||now<state.createdAt||now>=state.expiresAt||state.capability!==input.capability||!sameScope(scope,state.scope)||state.userId!==input.actor.userId||state.authVersion!==input.actor.authVersion||!Number.isSafeInteger(input.status)||input.status!==200||!/^[a-f0-9]{64}$/.test(input.bodySha256))throw Error(now>=Number(state?.expiresAt)?'g5-read-session-expired':'g5-read-session-record-denied');
    const prior=state.reads.at(-1);if(prior?.path===input.path&&prior.status===input.status&&prior.bodySha256===input.bodySha256)return;
    const expected=state.paths[state.reads.length];if(input.path!==expected)throw Error('g5-read-session-order-mismatch');state.reads.push({path:input.path,status:input.status,bodySha256:input.bodySha256});await this.ctx.storage.put(key,state);await this.ctx.storage.sync();
    });
  }
  async consumeG5ReadonlyReadSession(input:{identity:TurnRuntimeIdentity;userId:string;windowId:string;bindingSha256:string;sessionId:string;capability:string}){
    return this.#archiveWrite(input.identity.scope,async()=>{
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),key='g5-read-session:'+input.sessionId,state=await this.ctx.storage.get<any>(key);
    const now=Date.now();if(!state||state.capability!==input.capability||state.windowId!==input.windowId||state.userId!==input.userId||state.bindingSha256!==input.bindingSha256||!sameScope(scope,state.scope))throw Error('g5-read-session-consume-denied');if(!Number.isSafeInteger(state.createdAt)||!Number.isSafeInteger(state.expiresAt)||now<state.createdAt||now>=state.expiresAt)throw Error('g5-read-session-expired');
    if(state.status==='sealed'){if(!Number.isSafeInteger(state.consumedAt)||state.consumedAt<state.createdAt||state.consumedAt>=state.expiresAt)return Promise.reject(Error('g5-read-session-timing-invalid'));return state.receipt;}
    if(state.status!=='open'||state.reads.length!==state.paths.length||state.reads.some((read:any,index:number)=>read.path!==state.paths[index]||read.status!==200||!/^[a-f0-9]{64}$/.test(read.bodySha256)))throw Error('g5-read-session-incomplete');
    const consumedAt=now,result={schemaVersion:1 as const,kind:'before-reopen-read-session' as const,windowId:state.windowId,userId:state.userId,tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,workspaceGeneration:scope.workspaceGeneration,revision:state.binding.revision,bindingSha256:state.bindingSha256,runIds:state.binding.runIds,groupIds:state.binding.groupIds,claimIds:state.binding.claimIds,createdAt:state.createdAt,expiresAt:state.expiresAt,consumedAt,reads:state.reads},receipt={...result,receiptSha256:await turnDigest(result)};state.status='sealed';state.consumedAt=consumedAt;state.receipt=receipt;await this.ctx.storage.put(key,state);await this.ctx.storage.sync();return receipt;

    });
  }
  async g5ReadonlyAttestationAuthority(input:{identity:TurnRuntimeIdentity;userId:string;windowId:string;kind:'before-reopen-readonly'|'research-export-readonly';exportSha256?:string}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#maintenanceScope(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];if(!turn||turn.actor.userId!==input.userId||state.activeTurnId!==null||state.releaseHold!==null||state.recoveryHold!==null||!this.env.WORKSPACE_CHECKPOINTS)throw Error('g5-readonly-authority-unsettled');const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('g5-readonly-authority-denied');
    const current=await this.#simulationSource(scope),version=(await this.modelSpec({scope})).version;if(!version)throw Error('g5-readonly-authority-revision-absent');const runs=[...(await this.ctx.storage.list<SimulationRecord>({prefix:'simulation:run:'})).values()].filter(record=>record.budgetRoute?.kind==='g5'&&record.budgetRoute.windowId===input.windowId);if(runs.some(record=>!sameScope(record.scope,scope)||record.actor.userId!==input.userId||record.status!=='completed'||record.errorCode!==null||!record.result||record.released!==true||record.releaseProof===null))throw Error('g5-readonly-authority-run-unsettled');for(const record of runs)await g5B2RunEvidence(this.env.WORKSPACE_CHECKPOINTS,scope,record,identity.turnId);
    const runIds=new Set(runs.map(record=>record.runId)),groups=[...(await this.ctx.storage.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].filter(group=>group.actor.userId===input.userId&&sameScope(group.scope,scope)&&group.children.some(child=>runIds.has(child.runId)));g5TerminalGroupAuthority(runs,groups);const evidence=await this.#evidence(scope).exportRecords(),claimIds=evidence.claims.map((claim:any)=>String(claim.claimId)).sort();if(new Set(claimIds).size!==claimIds.length)throw Error('g5-readonly-authority-claim-conflict');const sourceVersions=[version,...runs.map(record=>modelVersion(record.input.plan))].filter((value,index,all)=>all.findIndex(other=>JSON.stringify(other)===JSON.stringify(value))===index).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),facts={schemaVersion:1 as const,kind:input.kind,projectId:scope.projectId,workspaceId:scope.workspaceId,revision:version,runIds:[...runIds].sort(),groupIds:groups.map(group=>group.groupId).sort(),claimIds,sourceVersions};
    let exportReceipt:null|Record<string,unknown>=null;if(input.kind==='research-export-readonly'){if(typeof input.exportSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.exportSha256))throw Error('g5-readonly-authority-export-absent');exportReceipt=await this.ctx.storage.get<Record<string,unknown>>('g5-readonly-export:'+input.exportSha256)??null;if(!exportReceipt||exportReceipt.projectId!==scope.projectId||exportReceipt.workspaceId!==scope.workspaceId||!sameScope(scope,identity.scope)||JSON.stringify(exportReceipt.revision)!==JSON.stringify(version)||JSON.stringify(exportReceipt.runIds)!==JSON.stringify(facts.runIds)||JSON.stringify(exportReceipt.groupIds)!==JSON.stringify(facts.groupIds)||JSON.stringify(exportReceipt.claimIds)!==JSON.stringify(facts.claimIds)||JSON.stringify(exportReceipt.sourceVersions)!==JSON.stringify(facts.sourceVersions))throw Error('g5-readonly-authority-export-mismatch');}
    const result={...facts,...(exportReceipt?{export:{sha256:exportReceipt.sha256,manifestSha256:exportReceipt.manifestSha256,entryCount:exportReceipt.entryCount,bytes:exportReceipt.bytes,contentType:exportReceipt.contentType,cacheControl:exportReceipt.cacheControl}}:{})};return {...result,receiptSha256:await turnDigest(result)};
  }
  /** Private plan selection. A future submit intent must freeze this source
   * durably with its idempotency key; this read does not create or start a Run. */
  async previewPlan(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),revision=this.#turns.workspaceRevisionSnapshot(scope);
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');
    const store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope));
    if(revision){const plan=await store.previewPlan({kind:'saved-turn',identity:revision.identity,revision:revision.receipt});this.#ready(scope);return plan;}
    const state=this.#store.read();
    if(!state?.identity||!state.runtimeReceipt)throw Error('workspace-initial-source-missing');
    const reference=await initialWorkspaceReferenceFromReady({scope,task:state.task,runtime:state.identity,markerNonce:state.markerNonce,ready:state.runtimeReceipt});
    const plan=await store.initialPreviewPlan(reference,scope);this.#ready(scope);return plan;
  }
  async reconcileSimulationCreation(input:{scope:TurnScope;actor:TurnActor;runId:string}){
    return this.#archiveWrite(input.scope,async()=>{const scope=this.#maintenanceScope(input.scope);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);if(!sameScope(scope,actual))throw Error('g5-simulation-reconcile-scope-denied');return publicExperiment(await this.#simulations(scope).reconcileCreatedRun(input.runId),this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);
    });
  }
  async listFiles(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),revision=await this.#turns.workspaceRevision(scope);
    if(!revision){const initial=await this.#initialWorkspace(scope);return {schemaVersion:1,revision:null,files:workspaceFileIndex(initial.filesArchive).files};}
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');
    const index=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).files(revision.identity,revision.receipt);
    return {schemaVersion:1,revision:{revisionId:revision.receipt.revisionId,filesSha256:revision.receipt.filesSha256,committedAt:revision.receipt.committedAt},files:index.files};
  }
  async diffFiles(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),revision=await this.#turns.workspaceRevision(scope);
    if(!revision)return {schemaVersion:1,revision:null,baseRevisionId:null,summary:{added:0,modified:0,deleted:0},changes:[]};
    if(!this.env.REVISION_STORE?.getByName)throw Error('revision-store-not-configured');const store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)),result=await store.diff(revision.identity,revision.receipt);
    return {schemaVersion:1,revision:{revisionId:revision.receipt.revisionId,filesSha256:revision.receipt.filesSha256,committedAt:revision.receipt.committedAt},summary:result.summary,changes:result.changes};
  }
  async readObserverArtifact(raw:ObserverArtifactReadInput){
    const input=observerArtifactReadInput(raw);
    this.#maintenanceScope(input.scope);
    const namespace=this.env.OBSERVER_EXECUTOR;
    if(!namespace?.getByName)throw Error('observer-executor-not-configured');
    return readObserverArtifact(input,{
      authorize:async(scope,actor,turnId)=>{
        this.#ready(scope);
        const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(actor,scope.workspaceId);
        if(!sameScope(actual,scope)||this.env.OBSERVER_EXECUTOR!==namespace)throw Error('observer-artifact-read-denied');
        this.#ready(scope);
        return this.#turns.observerHistoryIdentity(scope,actor,turnId);
      },
      lookup:reference=>this.#observers(input.scope).calls.lookup(reference),
      read:async({command,receipt},authorize)=>namespace.getByName(await observerExecutorActorName(command)).readArtifact(command,receipt,new ObserverArtifactReadCapability(authorize)),
    });
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
    return this.#archiveWrite(input.scope,async()=>{
    this.#maintenanceScope(input.scope);
    if(!this.env.TOOL_ARTIFACT_STORE?.getByName)throw Error('tool-artifact-store-not-configured');
    return releaseRetiredArtifactEvent(this.#turns,this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),input);

    });
  }
  async alarm() {
    if(this.#archiveFence.get())return;
    const bootstrap=this.#store.read();if(!bootstrap)return;
    const archiveScope={tenantId:bootstrap.task.tenantId,projectId:bootstrap.task.projectId,workspaceId:bootstrap.task.workspaceId,workspaceGeneration:bootstrap.task.generation};
    return this.#archiveWrite(archiveScope,async()=>{
    const terminalTurns=Object.values(new DurableTurnStore(this.ctx.storage).read()?.turns??{}).filter(turn=>['completed','failed','cancelled','interrupted'].includes(turn.status));
    for(const turn of terminalTurns){try{await this.#g5Terminal(turn);}catch(error){await this.#turnAlarm.schedule(Date.now()+5000);throw error;}}
    await routeWorkspaceAlarm({
      browserBuild:{readWake:()=>this.#browserBuildAlarm.read(),defer:at=>this.#browserBuildAlarm.schedule(at),advance:async scope=>{await this.#browserBuild(this.#maintenanceScope(scope)).alarm();}},
      simulation:{readWake:()=>this.#simulationAlarm.read(),defer:at=>this.#simulationAlarm.schedule(at),advance:async scope=>{const owned=this.#maintenanceScope(scope);await this.#simulations(owned).alarm();await this.#experimentGroups(owned).alarm();}},
      observer:{
        readWake:()=>this.#observerAlarm.read(),
        defer:at=>this.#observerAlarm.schedule(at),
        advance:async scope=>{await this.#observers(scope).alarm();},
      },
      service:{
        readWake:()=>this.#serviceAlarm.read(),
        defer:at=>this.#serviceAlarm.schedule(at),
        advance:async scope=>{await this.#services(this.#maintenanceScope(scope)).alarm();},
      },
      readWorkspace: () => this.#store.read(),
      readTurnWake: () => this.#turnAlarm.read(),
      runWorkspace: task => this.#for(task).alarm(),
      runTurn: (scope, generation) => this.#engine().alarm(scope, generation),
      deferTurn: at => this.#turnAlarm.schedule(at),
      clearTurn: () => this.#turnAlarm.clear(),
      reconcile: () => this.#turnAlarm.reconcile(),
    });
    });
  }
}
