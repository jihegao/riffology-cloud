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
import {ExperimentGroupHost,experimentGroupRequest,type ExperimentGroupRequest} from '../simulation/groups.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {SimulationHost,experimentRequest,publicExperiment,publishSimulationResult,type ExperimentRequest} from '../simulation/host.ts';
import {SimulationNative,simulationToken,type SimulationSandboxApi,type SimulationInput} from '../simulation/native.ts';
import {simulationPlan,modelVersion,inspectModel} from '../simulation/source.ts';
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
import {sha} from '../turn/protocol.ts';
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
import { runtimeName, validateWorkspaceTask, workspaceAgentName, type WorkspaceTask } from './protocol.ts';
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

export interface WorkspaceAgentEnv {
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
  M2_TURNS_ENABLED: unknown;
  M2_WORKSPACE_RUNTIME_REUSE_ENABLED?:unknown;
  M2_LAZY_PROJECT_ENABLED?:unknown;
  M2_WORKSPACE_RUNTIME_VERSION?:unknown;
  TRUSTED_PI_SANDBOX?:{idFromName(name:string):{toString():string};getByName?(name:string):unknown};
  PROJECT_SANDBOX?:{getByName(name:string):unknown};
  M2_TURN_ADMISSION_TELEMETRY?:unknown;
  M2_TURN_OPERATION_TELEMETRY?:unknown;
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
  #browserBuildAlarm=new DurableBrowserBuildAlarmPort(this.ctx.storage);
  #browserBuildHost:BrowserPreviewBuildHost|null=null;
  #browserBuild(scope:TurnScope){
    if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('browser-preview-unavailable');
    return this.#browserBuildHost??=new BrowserPreviewBuildHost(this.ctx.storage,scope,{registry:productionPreviewRegistry,bucket:this.env.WORKSPACE_CHECKPOINTS,checkSource:source=>this.#checkBrowserSource(scope,source),resolveInitial:async source=>{
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
      checkScope:()=>{this.#maintenanceScope(owned);},authorize:async actor=>{const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(actor,owned.workspaceId);if(!sameScope(actual,owned))throw Error('browser-preview-access-denied');},
      authorizeVerify:async actor=>{this.#ready(owned);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,owned.workspaceId);if(!sameScope(actual,owned))throw Error('browser-preview-access-denied');this.#ready(owned);},
      head:()=>this.#turns.workspaceRevisionSnapshot(owned)??this.#browserBuild(owned).initial(),saved:revision=>this.#turns.savedRevisionSnapshot(owned,revision)??this.#browserBuild(owned).source(revision),checkSource:source=>this.#checkBrowserSource(owned,source),
      files:source=>this.env.REVISION_STORE.getByName(revisionStoreActorName(owned)).serviceFiles(source,16*1024*1024),simulations:this.#simulations(owned),canVerify:()=>this.#simulationCanRun(),image:this.env.M4_SIMULATION_IMAGE??'',
      delivery:hash=>platformPreviewDelivery(this.env.APP_ORIGIN,this.env.BROWSER_PREVIEW_EXECUTION_ORIGIN,hash)});
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
  browserPreviewView(input:{scope:TurnScope;actor:TurnActor;revisionId?:string;profileId?:PreviewRuntime['profileId']}){return this.#browser(input.scope).view(input.actor,input.revisionId,input.profileId);}
  browserPreviewPackage(input:{scope:TurnScope;actor:TurnActor;packageIdentity:string}){return this.#browser(input.scope).bytes(input.actor,input.packageIdentity);}
  verifyBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}){return this.#browser(input.scope).verify(input.actor,input.body);}
  browserPreviewVerification(input:{scope:TurnScope;actor:TurnActor;key:string}){return this.#browser(input.scope).verification(input.actor,input.key);}
  browserPreviewRetry(input:{scope:TurnScope;actor:TurnActor;key:string}){return this.#browser(input.scope).retryVerification(input.actor,input.key);}
  retryBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}){return this.#browser(input.scope).retry(input.actor,input.body);}
  #simulationHost:SimulationHost|null=null;
  #simulationAlarm=new DurableSimulationAlarmPort(this.ctx.storage);
  #simulations(scope:TurnScope){
    return this.#simulationHost??=new SimulationHost(this.ctx.storage,scope,{
      admitRun:async(actor,key,body)=>admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,actor.userId,'run',{scope,key},body),
      quota:this.env.TENANT_QUOTA.getByName(tenantQuotaName(scope.tenantId)),
      start:async input=>{
        if(input.runtimeImage!==this.env.M4_SIMULATION_IMAGE)throw Error('simulation-image-changed');
        const sandbox=await this.#simulationSandbox(input);
        const bytes=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(input.plan.source);
        return new SimulationNative(sandbox,input).start(bytes);
      },
      observe:async input=>new SimulationNative(await this.#simulationSandbox(input),input).operation('observe'),
      stop:async input=>new SimulationNative(await this.#simulationSandbox(input),input).operation('stop'),
      destroy:async input=>{await (await this.#simulationSandbox(input)).destroy();},
      running:async input=>{const state=await (await this.#simulationSandbox(input)).releaseState();if(!state||typeof state.running!=='boolean')throw Error('simulation-release-unconfirmed');return state.running;},
      publish:async(record,result)=>{if(!this.env.WORKSPACE_CHECKPOINTS)throw Error('simulation-unavailable');return publishSimulationResult(this.env.WORKSPACE_CHECKPOINTS,record,result);},
      authorize:async actor=>{try{const current=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,scope.workspaceId);return sameScope(current,scope);}catch{return false;}},
      hold:promise=>this.ctx.waitUntil(promise),
    });
  }
  #experimentGroupHost:ExperimentGroupHost|null=null;
  #experimentGroups(scope:TurnScope){return this.#experimentGroupHost??=new ExperimentGroupHost(this.ctx.storage,scope,this.#simulations(scope),()=>this.#simulationCanRun());}
  async submitExperimentGroup(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentGroupRequest}){
    const scope=this.#ready(input.scope),host=this.#experimentGroups(scope),request=experimentGroupRequest(input.body);
    const prior=await host.replay(input.actor,input.key,request);
    if(prior)return host.view(prior,this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);
    if(!this.#simulationCanRun())throw Error('simulation-unavailable');
    const source=await this.#simulationSource(scope),store=this.env.REVISION_STORE.getByName(revisionStoreActorName(scope));
    const plan=await simulationPlan(source,await store.serviceFiles(source));
    const group=await host.submit(input.actor,input.key,request,plan,this.env.M4_SIMULATION_IMAGE!,()=>{
      this.#ready(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);
      return source.kind==='saved-turn'?latest?.receipt.revisionId===source.revision.revisionId:latest===null;
    });
    return host.view(group,modelVersion(plan).filesSha256);
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
    const scope=this.#maintenanceScope(input.scope),host=this.#experimentGroups(scope);
    return host.view(await host.cancel(input.groupId),this.#turns.workspaceRevisionSnapshot(scope)?.receipt.filesSha256??null);
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
  #simulationCanRun(){return this.env.M4_SIMULATION_ENABLED==='true'&&!!this.env.SIMULATION_SANDBOX?.getByName&&!!this.env.M4_SIMULATION_IMAGE&&!!this.env.WORKSPACE_CHECKPOINTS;}
  #exporting=false;
  async researchExport(input:{scope:TurnScope;actor:TurnActor}):Promise<Response>{
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
      return new Response(result.bytes,{headers:{'content-type':'application/zip','content-disposition':`attachment; filename="${result.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','x-riffology-export-sha256':result.sha256}});
    }finally{this.#exporting=false;}
  }
  async publicationPrepare(input:{scope:TurnScope;actor:TurnActor;expected?:PublicationVersion;freeze?:boolean}){
    const scope=this.#maintenanceScope(input.scope);if(this.#exporting)throw Error('publication-busy');this.#exporting=true;
    try{
      const authorize=async()=>{this.#maintenanceScope(scope);const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).maintenanceWorkspace(input.actor,scope.workspaceId);if(!sameScope(actual,scope))throw Error('publication-access-denied');this.#maintenanceScope(scope);};
      await authorize();const bucket=this.env.WORKSPACE_CHECKPOINTS;if(!bucket)throw Error('publication-unavailable');const current=await this.#simulationSource(scope);
      const currentCheck=()=>{this.#maintenanceScope(scope);const latest=this.#turns.workspaceRevisionSnapshot(scope);if(current.kind==='saved-turn'?latest?.receipt.revisionId!==current.revision.revisionId:latest!==null)throw Error('publication-model-stale');};
      const snapshot=await researchSnapshot(this.ctx.storage,scope,current,currentCheck),active=this.#turns.publicationHasActiveTurn(scope);
      const result=await preparePublication(snapshot,{authorize,source:(source,maxBytes)=>this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source,maxBytes),artifact:async(key,maxBytes)=>{const object=await bucket.get(key);if(!object)return null;try{if(object.size>maxBytes)throw Error('export-too-large');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==object.size)throw Error('export-source-mismatch');return bytes;}finally{await object.body?.cancel().catch(()=>{});}}},active);
      await authorize();currentCheck();if(result.readiness.ready&&this.#turns.publicationHasActiveTurn(scope))throw Error('publication-model-stale');if(!input.freeze)return {readiness:result.readiness};
      if(!result.frozen||!result.readiness.ready)throw Error('publication-not-ready');if(JSON.stringify(input.expected)!==JSON.stringify(result.readiness.version))throw Error('publication-model-stale');
      const beforeWrite=async()=>{await authorize();currentCheck();if(this.#turns.publicationHasActiveTurn(scope))throw Error('publication-model-stale');};
      const stored=await new R2PublicationArtifacts(bucket).put(result.frozen,beforeWrite);await beforeWrite();return {readiness:result.readiness,stored};
    }finally{this.#exporting=false;}
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
  async #finishEvidence(scope:TurnScope,items:import('../simulation/evidence.ts').EvidenceView[]){const result=await this.#evidence(scope).refreshViews(items);this.#maintenanceScope(scope);return result;}
  async createEvidence(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const ledger=this.#evidence(scope),claim=await ledger.create(evidenceRequest(input.body),input.actor,()=>this.#evidenceAccess(scope,input.actor));await this.#evidenceAccess(scope,input.actor);const result=await ledger.get(claim.claimId,await this.#evidenceHead(scope));await this.#evidenceAccess(scope,input.actor);return (await this.#finishEvidence(scope,[result]))[0]!;
  }
  async listEvidence(input:{scope:TurnScope;actor:TurnActor;before?:string}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).list(await this.#evidenceHead(scope),input.before);await this.#evidenceAccess(scope,input.actor);return {...result,items:await this.#finishEvidence(scope,result.items)};
  }
  async evidence(input:{scope:TurnScope;actor:TurnActor;claimId:string}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const ledger=this.#evidence(scope),result=await ledger.get(input.claimId,await this.#evidenceHead(scope));await this.#evidenceAccess(scope,input.actor);return (await this.#finishEvidence(scope,[result]))[0]!;
  }
  async rejectEvidence(input:{scope:TurnScope;actor:TurnActor;body:unknown}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).reject(input.body,input.actor,()=>this.#evidenceAccess(scope,input.actor));await this.#evidenceAccess(scope,input.actor);return result;
  }
  async researchEvidenceExport(input:{scope:TurnScope;actor:TurnActor}){
    const scope=this.#maintenanceScope(input.scope);await this.#evidenceAccess(scope,input.actor);const result=await this.#evidence(scope).exportRecords();await this.#evidenceAccess(scope,input.actor);return result;
  }
  #runtimeLeases:WorkspaceRuntimeLeases|null=null;
  #leases(){return this.#runtimeLeases??=new WorkspaceRuntimeLeases(this.ctx.storage,workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}),new TrustedPiTurnCapacity(this.env.TRUSTED_PI_CAPACITY),()=>this.env.M2_WORKSPACE_RUNTIME_REUSE_ENABLED==='true'&&this.env.M2_LAZY_PROJECT_ENABLED==='true',()=>this.env.M2_WORKSPACE_RUNTIME_VERSION);}
  async workspaceRuntimeSelection(input:{identity:TurnRuntimeIdentity}){const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);return this.#leases().selection(identity);}
  async workspaceRuntimeBinding(input:{identity:TurnRuntimeIdentity}){const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);return this.#leases().current(identity);}
  async bindWorkspaceRuntime(input:{identity:TurnRuntimeIdentity;executionDeadlineAt:number}){
    const identity=turnRuntimeIdentity(input.identity),scope=this.#ready(identity.scope),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    if(!turn||state.activeTurnId!==identity.turnId||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||turn.cancelRequestedAt!==null)throw Error('workspace-runtime-binding-denied');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity)).workspaceRuntimeState(identity);
    if(runtime.phase!=='running'||runtime.cancelRequestedAt!==null||!runtime.nativeStartReserved||runtime.executionDeadlineAt!==input.executionDeadlineAt||runtime.resourceLease.leaseId!==turn.resourceLease?.leaseId)throw Error('workspace-runtime-binding-denied');
    return this.#leases().bind(identity,input.executionDeadlineAt);
  }
  async workspaceNativeAuthority(input:{context:WorkspaceSandboxBinding;domain:PairDomain}){
    if(!['project','trustedPi'].includes(input.domain))throw Error('workspace-native-authority-denied');
    const identity=turnRuntimeIdentity(input.context.identity),scope=this.#maintenanceScope(identity.scope),{current,lease:physicalLease}=await this.#leases().pairState(identity),state=await this.#turns.snapshot(scope),turn=state.turns[identity.turnId];
    const expectedFiles=turn?.base?.workspace?.filesSha256??turn?.base?.initial?.filesSha256??Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(10240))),n=>n.toString(16).padStart(2,'0')).join('');
    if(!['bound','idle','releasing'].includes(physicalLease.status)||!turn||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId||JSON.stringify(current.lease)!==JSON.stringify(input.context.lease)||current.binding.bindingEpoch!==input.context.bindingEpoch||input.context.filesSha256!==expectedFiles)throw Error('workspace-native-authority-denied');
    return {...current,leaseStatus:physicalLease.status,actorId:await workspaceSandboxActor(current.lease,input.domain)};
  }
  async claimWorkspaceNative(input:{context:WorkspaceSandboxBinding;domain:PairDomain}){
    const current=await this.workspaceNativeAuthority(input);
    if(current.closing||current.executionDeadlineAt<=Date.now())throw Error('workspace-native-admission-closed');
    const runtime=await this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(current.identity)).workspaceRuntimeState(current.identity);
    if(runtime.phase!=='running'||runtime.cancelRequestedAt!==null||runtime.executionDeadlineAt!==current.executionDeadlineAt)throw Error('workspace-native-admission-closed');
    const latest=await this.#leases().authoritative(current.identity);if(latest.closing)throw Error('workspace-native-admission-closed');
    return workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}).claimNativeStart(pairReference(current.lease),current.binding,input.domain);
  }
  #runtimeHandoff:WorkspaceRuntimeHandoff|null=null;
  #handoff(){return this.#runtimeHandoff??=new WorkspaceRuntimeHandoff({storage:this.ctx.storage,pair:workspacePairedCapacityClient(this.env.TRUSTED_PI_CAPACITY as unknown as {getByName(name:string):WorkspacePairedCapacityPort}),binding:identity=>this.#leases().pairState(identity),close:identity=>this.closeWorkspaceRuntime({identity}),journal:async identity=>{const state=await this.#turns.snapshot(identity.scope),turn=state.turns[identity.turnId];if(!turn||turn.sessionId!==identity.sessionId||turn.dispatchId!==identity.dispatchId)throw Error('workspace-runtime-handoff-denied');return turn;},native:async(domain,context)=>{const namespace=domain==='project'?this.env.PROJECT_SANDBOX:this.env.TRUSTED_PI_SANDBOX;if(!namespace?.getByName)throw Error('workspace-native-namespace-required');return namespace.getByName(await workspaceSandboxActor(context.lease,domain)) as NativeHandoffRpc;}});}
  async authorizeWorkspaceLeaseDrain(input:{lease:WorkspaceBindingLease}){this.#maintenanceScope(input.lease.scope);return this.#leases().leaseForDrain(input.lease);}
  async drainRuntimeLease(input:{ref:import('../capacity/paired.ts').WorkspaceLeaseRef}){
    this.#maintenanceScope(input.ref.scope);const current=this.#leases().currentLease();if(!current||JSON.stringify(pairReference(current.lease))!==JSON.stringify(input.ref))throw Error('workspace-runtime-drain-denied');const lease=await this.#leases().leaseForDrain(current.lease);if(lease.status==='released')return;if(!lease.binding)throw Error('workspace-runtime-drain-denied');
    const identity=turnRuntimeIdentity({scope:lease.ref.scope,sessionId:lease.binding.sessionId,turnId:lease.binding.turnId,dispatchId:lease.binding.dispatchId,generation:lease.ref.scope.workspaceGeneration}),turn=(await this.#turns.snapshot(identity.scope)).turns[identity.turnId];if(!turn?.resourceLease)throw Error('workspace-runtime-drain-denied');
    return this.#handoff().settle({identity,outcome:turn.executionOutcome??'interrupted',checkpoint:turn.checkpoint,resourceLease:turn.resourceLease},true);
  }
  async settleWorkspaceRuntime(input:RuntimeSettlementInput){
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
  }
  async closeWorkspaceRuntime(input:{identity:TurnRuntimeIdentity}){
    const identity=turnRuntimeIdentity(input.identity);this.#maintenanceScope(identity.scope);
    const {current:binding}=await this.#leases().pairState(identity);
    await this.#leases().close(identity);
    if(!this.env.TENANT_MODEL_BUDGET||!this.env.PRODUCTION_MODEL_BUDGET||!this.env.TOOL_BRIDGE_AGENT)throw Error('workspace-runtime-settlement-required');
    const model=this.env.TENANT_MODEL_BUDGET.getByName(modelBudgetTenantName(identity.scope.tenantId)),money=this.env.PRODUCTION_MODEL_BUDGET.getByName(PRODUCTION_MONEY_ACTOR),tool=this.env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(identity.scope,identity.turnId,identity.dispatchId));
    const settled=await Promise.all([model.closeTurnAdmission(identity.scope.tenantId,identity),money.closeTurnAdmission(identity),tool.closeTurnAdmission(identity)]);
    if(settled.some(record=>JSON.stringify(record.identity)!==JSON.stringify(identity)||record.closed!==true))throw Error('workspace-runtime-settlement-denied');
    return {binding,settled};
  }
  async workspaceRuntimeAuthority(input:WarmOutboundRequest){
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
    const command=normalizeToolCommand(input.command),scope=this.#ready(command.scope);
    const saved=(await this.#turns.snapshot(scope)).turns[command.turnId];if(!saved||saved.dispatchId!==command.dispatchId)throw Error('project-preparation-denied');
    const identity=turnRuntimeIdentity({scope,sessionId:saved.sessionId,turnId:command.turnId,dispatchId:command.dispatchId,generation:scope.workspaceGeneration}),runtime=this.env.PRODUCT_TURN_RUNTIME.getByName(await turnRuntimeActorName(identity));
    if(!await runtime.projectPreparationRequired(identity))return {ready:true as const};
    const authorize=async()=>{const state=await this.#turns.snapshot(scope),turn=state.turns[command.turnId];
      if(state.activeTurnId!==command.turnId||!turn||!['starting','running'].includes(turn.status)||turn.dispatchId!==command.dispatchId||turn.cancelRequestedAt!==null||turn.finishedAt!==null||command.deadlineAt<=Date.now())throw Error('project-preparation-denied');
      const allowed=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(turn.actor,scope.workspaceId);if(!sameScope(allowed,scope))throw Error('project-preparation-denied');return turn;
    };
    await authorize();
    const result=await runtime.prepareProjectTool({identity,command,observeOnly:input.observeOnly});await authorize();const warm=await this.#leases().current(identity);return warm?{...result,actorId:await workspaceSandboxActor(warm.lease,'project')}:result;
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
  async modelSpec(input:{scope:TurnScope}){
    const scope=this.#ready(input.scope),source=await this.#simulationSource(scope);
    const model=await inspectModel(source,await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).serviceFiles(source),this.#simulationCanRun());
    this.#ready(scope);return model;
  }
  async submitExperiment(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentRequest}){
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
    const scope=this.#maintenanceScope(input.scope),r=await this.#simulations(scope).cancel(input.runId),head=this.#turns.workspaceRevisionSnapshot(scope);
    return {...publicExperiment(r,head?.receipt.filesSha256??null),evidenceRejection:assessmentForRun(await evidenceAssessments(this.ctx.storage),r.runId,modelVersion(r.input.plan))??null};
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
    const scope=this.#ready(input.scope);
    if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');
    await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'run',{scope,key:input.key,type:'service'},input.request);
    this.#ready(scope);
    return this.#services(scope).submit(input.actor,input.key,input.request,()=>{
      if(input.request.runtimeImage!==this.env.M3_SERVICE_IMAGE)throw Error('service-runtime-image-conflict');
      return this.#freezeService(scope);
    });
  }
  async stopService(input:{scope:TurnScope;runId:string}){
    const scope=this.#maintenanceScope(input.scope);
    return this.#services(scope).stop(input.runId);
  }
  async submitServiceRequest(input:{scope:TurnScope;actor:TurnActor;key:string;body:{maxDurationMs:number;expectedRevisionId?:string}}){
    const scope=this.#ready(input.scope);
    if(this.env.M3_SERVICE_ENABLED!=='true')throw Error('service-run-disabled');
    await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'run',{scope,key:input.key,type:'service'},input.body);
    this.#ready(scope);
    return this.#services(scope).submitFromPolicy(input.actor,input.key,input.body,this.env.M3_SERVICE_IMAGE??'',()=>this.#freezeService(scope));
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
    const scope=this.#ready(input.scope);
    if(this.env.M3_PREVIEW_ENABLED!=='true')throw Error('preview-disabled');
    const view=await this.serviceView({scope,runId:input.runId});
    this.#ready(scope);
    if(!view.run)throw Error('preview-run-unavailable');
    return this.#previews(scope).bind(input.actor,input.key,{intent:view.intent,run:view.run},input.expectedPreviewId);
  }
  async currentPreview(input:{scope:TurnScope}){return this.#previews(this.#maintenanceScope(input.scope)).current();}
  async revokePreview(input:{scope:TurnScope;previewId:string;reason:'stopped'|'replaced'|'operator'|'workspace-retired'}){
    return this.#previews(this.#maintenanceScope(input.scope)).revoke(input.previewId,input.reason);
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
  }
  /** Resource transport for an already durably running observation. It does not
   * accept/start calls or grant a browser cookie. The executor separately owns
   * the cumulative budget across resources and the observation result. */
  async forwardObserverHttp(raw:{command:ObserverCommand;targetDigest:string},request:Request):Promise<Response>{
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
  }
  async issuePreviewTicket(input:{scope:TurnScope;principal:PreviewBrowserPrincipal;previewId:string;nonce:string}){
    const scope=this.#ready(input.scope);
    const ticket=await this.#tickets(scope).issue(input.principal,input.previewId,input.nonce);
    this.#ready(scope);return ticket;
  }
  async redeemPreviewTicket(input:{scope:TurnScope;ticket:string;nonce:string}){
    const scope=this.#ready(input.scope);
    const claims=await this.#tickets(scope).redeem(input.ticket,input.nonce);
    this.#ready(scope);return claims;
  }
  async exchangePreviewTicket(input:{scope:TurnScope;ticket:string;nonce:string;previewId:string}){
    const scope=this.#ready(input.scope);
    const previewId=input.previewId;
    if(typeof previewId!=='string'||!previewId)throw Error('preview-ticket-denied');
    const access=await this.#tickets(scope).exchange(input.ticket,input.nonce,previewId);
    this.#ready(scope);return access;
  }
  async authorizePreviewAccess(input:{scope:TurnScope;access:string;previewId:string}){
    const scope=this.#ready(input.scope);
    const claims=await this.#tickets(scope).access(input.access,input.previewId);
    this.#ready(scope);return claims;
  }
  async forwardPreviewHttp(input:{scope:TurnScope;access:string;previewId:string},request:Request):Promise<Response>{
    const scope=this.#ready(input.scope),clean=await serviceHttpRequest(request);
    await this.authorizePreviewAccess(input);
    const target=await this.previewTarget({scope,previewId:input.previewId}),runtime=previewRuntimeInput(target);
    if(!this.env.SERVICE_RUNTIME?.getByName)throw Error('service-forward-not-configured');
    const stub=this.env.SERVICE_RUNTIME.getByName(await serviceRuntimeActorName(runtime));
    const access=await this.authorizePreviewAccess(input);
    if(JSON.stringify(access.binding)!==JSON.stringify(target.binding))throw Error('preview-target-unavailable');
    this.#ready(scope);return stub.forwardHttp(runtime,clean);
  }
  async revokePreviewAccess(input:{scope:TurnScope;access:string}){
    const scope=this.#maintenanceScope(input.scope);
    // Revocation remains available when execution and Preview gates are closed.
    const journal=new SqlPreviewTickets(this.ctx.storage,scope,{
      session:async()=>{throw Error('preview-disabled');},target:async()=>{throw Error('preview-disabled');},
    });
    await journal.revokeAccess(input.access);
  }
  async serviceSnapshot(input:{scope:TurnScope;runId:string}){
    const scope=this.#maintenanceScope(input.scope);
    return this.#services(scope).snapshot(input.runId);
  }
  #engine(): WorkspaceTurnEngine {
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
    return this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).resolveInitial(reference,scope);
  }
  async createSession(input: { scope: TurnScope; actor: TurnActor; key: string; body: { title: unknown } }) {
    return this.#turns.createSession(this.#ready(input.scope), input.actor, input.key, input.body);
  }
  async submitTurn(input: { scope: TurnScope; actor: TurnActor; sessionId: string; key: string; body: { message: unknown } }) {
    const trace=(stage:TurnAdmissionStage,transportSuccess:boolean,error?:unknown)=>traceTurnAdmission(this.env.M2_TURN_ADMISSION_TELEMETRY,stage,transportSuccess,error);
    let scope:TurnScope;
    try{scope=this.#ready(input.scope);trace('ready',true);}catch(error){trace('ready',false,error);throw error;}
    try{if(this.env.M2_TURNS_ENABLED!=='true')throw Error('turn-runtime-not-ready');trace('gate',true);}catch(error){trace('gate',false,error);throw error;}
    let engine:WorkspaceTurnEngine;
    try{engine=this.#engine();trace('engine',true);}catch(error){trace('engine',false,error);throw error;}
    await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(input.actor,scope.workspaceId);
    await admitG4Task(this.env.TENANT_MODEL_BUDGET,this.env.G4_CONTROLLED_WINDOW_JSON,scope.tenantId,input.actor.userId,'turn',{scope,sessionId:input.sessionId,key:input.key},input.body);
    this.#ready(scope);
    return engine.submit(scope,input.actor,input.sessionId,input.key,input.body,trace);
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
        const actual=await new ProjectCatalog(catalogDatabase(this.env.CATALOG),new Set()).workspace(actor,scope.workspaceId);
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
    this.#maintenanceScope(input.scope);
    if(!this.env.TOOL_ARTIFACT_STORE?.getByName)throw Error('tool-artifact-store-not-configured');
    return releaseRetiredArtifactEvent(this.#turns,this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR),input);
  }
  async alarm() {
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
  }
}
