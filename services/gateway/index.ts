import {createGatewayManualSaveServices} from './manual-save-services.ts';
import {createGatewayProjectViewServices} from './project-view-services.ts';
import {ProjectArchives} from '../catalog/project-archives.ts';
import {createGatewayProjectArchives} from './project-archive-services.ts';
import {invitedRunsPolicy} from '../simulation/invited-policy.ts';
import {PRIVATE_BETA_CAPACITY_ACTOR} from '../model-budget/private-beta-policy.ts';
import type {PrivateBetaCapacity} from '../model-budget/private-beta-capacity.ts';
import {piDeveloperOwner} from '../model-budget/pi-developer-policy.ts';
import {managedTestingOwner} from '../workspace/managed-route.ts';
import {matchesManagedProjectBootstrap} from '../workspace/managed-bootstrap.ts';
import {createGatewayG4ComputeServices,createGatewayG4WindowServices} from './g4-compute-services.ts';
import {admitG4Task,type G4TaskBudgetNamespace} from '../model-budget/g4-admission.ts';
import {g5TaskKey} from '../model-budget/g5-admission.ts';
import {G5_GLOBAL_ACTOR} from '../model-budget/g5-window.ts';
import type {G5ControlledWindow} from '../model-budget/g5-window-durable.ts';
import {createGatewayBrowserPreviewServices} from './browser-preview-services.ts';
import {serveBrowserPreviewAppAsset} from '../browser-preview/execution/delivery.ts';
import {createGatewayPublications} from './publication-services.ts';
import {R2PublicationArtifacts} from '../publication/artifacts.ts';
import {createGatewayResearchExports} from './research-export-services.ts';
import {createGatewayG5ReadonlyReads} from './g5-read-services.ts';
import {createGatewaySimulationServices} from './simulation-services.ts';
import {R2ModelContentUploadPort} from '../runtime/model-upload.ts';
import {acceptedInvitationProjectAdmission} from '../catalog/project-admission.ts';
// Optional until the model-content binding is configured for an environment.
type GatewayRuntimeEnv=Omit<GatewayEnv,'APP_ORIGIN'> & VerificationEnv & ValidationEnv & {APP_ORIGIN:string;APP_TRANSPORT_ORIGIN?:string;TWO_ACCOUNT_AUTH_MODE?:string;LEGACY_RECOVERY_ORIGIN?:string;LEGACY_RECOVERY_UNTIL?:string;PRIVATE_BETA_CAPACITY?:DurableObjectNamespace<PrivateBetaCapacity>;INVITED_RUNS_POLICY_JSON?:string;INVITED_PROJECT_ADMISSION_ENABLED?:string;PI_DEVELOPER_POLICY_JSON?:string;MANAGED_TESTING_JSON?:string;MANAGED_PROJECT_BOOTSTRAP_JSON?:string;M4_SIMULATION_ENABLED?:unknown;G5_WINDOW_GUARD?:DurableObjectNamespace<G5ControlledWindow>;G5_CONTROLLED_WINDOW_JSON?:string;G5_ADMISSION_ENABLED?:string;G4_CONTROLLED_WINDOW_JSON?:string;TENANT_MODEL_BUDGET?:G4TaskBudgetNamespace;TRUSTED_PI_CAPACITY?:DurableObjectNamespace<import('../capacity/durable.ts').TrustedPiCapacity>;MODEL_CONTENT?:R2Bucket;TOOL_ARTIFACT_STORE?:DurableObjectNamespace<import('../artifacts/durable.ts').ToolArtifactStore>;M3_SERVICE_ENABLED?:unknown;M3_PREVIEW_ENABLED?:unknown;M3_PREVIEW_WS_ENABLED?:unknown;M3_PREVIEW_ORIGIN?:string;BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;M1_GOOGLE_OAUTH_EGRESS_CAPABILITY?:string};
import {R2ModelContentPort} from '../runtime/content.ts';
import { createAuth } from './auth.ts';
import {appTopology,requireRequestHost} from './origins.ts';
import {publicTransportHeaders} from './transport-headers.ts';
import {verifyEntry,signedRequestCapacity,type VerificationEnv} from '../entry/signature.ts';
import {requestAbortBridge,abortableResponse} from '../entry/abort.ts';
import {legacyRecovery} from './recovery.ts';
import {VALIDATION_PREFIX,type ValidationEnv} from '../entry/validation-policy.ts';
import {validationGateway} from '../entry/validation-gateway.ts';
import { catalogDatabase } from '../catalog/database.ts';
import { gateway } from './app.ts';
import { HttpError, json, readJson, requireOrigin } from './http.ts';
import { CatalogError } from '../catalog/contracts.ts';
import { ProvisioningCatalog } from '../catalog/provisioning.ts';
import { workspaceAgentName, type WorkspaceTask } from '../workspace/protocol.ts';
import { createGatewayTurnServices } from './turn-services.ts';
import { createGatewayServiceServices } from './service-services.ts';
import {previewHost} from './preview-host.ts';
import {createGatewayPreviewServices,previewFrameSource} from './preview-services.ts';
import {createGatewayObserverServices} from './observer-services.ts';
import { sessionIdentity } from './session-identity.ts';
import {runRevisionGcMaintenance} from './revision-gc-maintenance.ts';
import {runGatewayScheduledDomains} from './scheduled.ts';
export {InvitedRunCapacity} from '../simulation/invited-capacity-durable.ts';
export {EntryReplayGuard} from '../entry/replay.ts';
export { TenantQuota } from '../quota/durable.ts';
export { TenantModelBudget } from '../model-budget/durable.ts';
export {PrivateBetaCapacity} from '../model-budget/private-beta-capacity.ts';
export {PiDeveloperBudget} from '../model-budget/pi-developer-durable.ts';
export { G5ControlledWindow } from '../model-budget/g5-window-durable.ts';
export { G5TenantModelBudget } from '../model-budget/g5-token-durable.ts';
export { TrustedPiCapacity } from '../capacity/durable.ts';
export { ProjectRuntime } from '../runtime/durable.ts';
export { WorkspaceAgent } from '../workspace/durable.ts';
export { ManagedProductRuntime } from '../turn-runtime/managed-product.ts';
export { ProductTurnRuntime } from '../turn-runtime/durable.ts';
export { RevisionStore } from '../turn-runtime/revision-store.ts';
export { ToolArtifactStore } from '../artifacts/durable.ts';
export { ObserverExecutor } from '../preview/observer-executor-durable.ts';
export { ServiceRun } from '../run/durable.ts';
export { ServiceRuntime } from '../run/runtime-durable.ts';
export { SimulationSandbox } from '../simulation/sandbox.ts';
export { ServiceSandbox } from '../run/service-sandbox.ts';
export { ModelProxyService } from '../model-proxy/service.ts';
export { ContainerProxy, ProjectToolSandbox, TrustedPiSandbox } from '../sandbox/classes.ts';
export { ToolBridgeAgent } from '../tools/durable.ts';
export { ToolBridgeService } from '../tools/service.ts';

async function dispatch(env:GatewayRuntimeEnv, item:{task:WorkspaceTask;mode:'accept'|'observe'}):Promise<void>{
  const actor=env.WORKSPACE_AGENT.getByName(workspaceAgentName(item.task.tenantId,item.task.workspaceId));
  if(item.mode==='accept')await actor.accept(item.task);
  else await actor.reconcile(item.task);
}
const gatewayHandler={
  async fetch(request:Request,env:GatewayRuntimeEnv):Promise<Response>{
    let releaseSignedCapacity=()=>{};
    try {
    const topology=appTopology(env),url=new URL(request.url);
    if(env.RIFFOID_VALIDATION_CONFIG_JSON!==undefined&&url.origin!==topology.recovery){
      if(url.pathname.startsWith(VALIDATION_PREFIX))return validationGateway(request,env,topology);
      return json({error:'validation_maintenance'},503);
    }
    if(url.pathname.startsWith(VALIDATION_PREFIX))throw new HttpError('validation_closed',403);
    if(topology.proxied){
      requireRequestHost(request);
      if(url.origin===topology.canonical)return json({error:'origin_denied'},403);
      if(url.origin===topology.transport||url.origin===topology.recovery){
        if(request.headers.has('upgrade'))return json({error:'upgrade_denied'},403);
        // Strip forwarding/identity assertions. Preserve only the exact G5 read
        // protocol inputs; the original authenticated authority validates them.
        if(url.origin===topology.recovery||topology.authentication!=='signed-entry-v1')request=new Request(request,{headers:publicTransportHeaders(request.headers)});
      }
      if(url.origin===topology.recovery){
        const database=catalogDatabase(env.CATALOG);
        const turns=createGatewayTurnServices(env);
        return legacyRecovery(request,{canonical:topology.canonical,origin:topology.recovery,until:topology.recoveryUntil!,database,
          identity:async req=>{const auth=createAuth({database:env.CATALOG,catalog:database,origin:topology.canonical,secret:env.BETTER_AUTH_SECRET,googleClientId:env.GOOGLE_CLIENT_ID,googleClientSecret:env.GOOGLE_CLIENT_SECRET,readOnlySession:true,sharedTransportRateLimit:true});return sessionIdentity(await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true,disableRefresh:true}}));},
          snapshot:turns.recoverySnapshot,receipt:turns.recoveryReceipt});
      }
    }
    if(url.origin!==topology.transport)return previewHost(request,env,catalogDatabase(env.CATALOG));
    // Shared public transport cannot establish trustworthy client IPs. Keep the
    // whole application closed unless this limited mode is explicitly selected.
    if(topology.proxied&&topology.authentication!=='shared-limited'&&topology.authentication!=='signed-entry-v1')return json({error:'two_account_auth_disabled'},503);
    if(topology.proxied&&topology.authentication==='signed-entry-v1'){releaseSignedCapacity=signedRequestCapacity(request);request=await verifyEntry(request,topology.canonical,topology.transport,env);}
    if(url.pathname.startsWith('/browser-preview-assets/')){if(!env.ASSETS)return json({error:'assets_not_configured'},503);const asset=await serveBrowserPreviewAppAsset(request,env.ASSETS);return asset??json({error:'not_found'},404);}
    if(!url.pathname.startsWith('/api/')){
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'not_found'},404);
      if(!['/','/index.html','/app.js','/artifact-views.js','/project-views.js','/manual-save.js','/project-view-remote.js','/i18n.js','/i18n-bindings.js','/locale-preference.js','/project-status.js','/layout.js','/services.js','/previews.js','/browser-preview.js','/verify-handoff.js','/simulation.js','/comparison.js','/local-runs.js','/export.js','/publication.js','/evidence.js','/evidence.css','/styles.css','/workspace.css','/admin','/admin.html','/admin.js','/admin.css'].includes(url.pathname))return json({error:'not_found'},404);
      if(!env.ASSETS)return json({error:'assets_not_configured'},503);
      const assetRequest=['/admin','/'].includes(url.pathname)
        ? new Request(new URL(url.pathname==='/'?'/index.html':'/admin.html',url),{method:request.method,headers:request.headers})
        : request;
      const asset=await env.ASSETS.fetch(assetRequest),headers=new Headers(asset.headers);
      headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src ${previewFrameSource(env)} ${env.BROWSER_PREVIEW_EXECUTION_ORIGIN?new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN).origin:""}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
      headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
      headers.set('Cache-Control','no-store');return new Response(asset.body,{status:asset.status,headers});
    }
    if(!env.BETTER_AUTH_SECRET||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return json({error:'authentication_not_configured'},503);
    const database=catalogDatabase(env.CATALOG);
    const googleOAuthEgress=env.M1_GOOGLE_OAUTH_EGRESS_CAPABILITY?{capability:env.M1_GOOGLE_OAUTH_EGRESS_CAPABILITY}:undefined;
    const auth=createAuth({database:env.CATALOG,catalog:database,origin:env.APP_ORIGIN,secret:env.BETTER_AUTH_SECRET,googleClientId:env.GOOGLE_CLIENT_ID,googleClientSecret:env.GOOGLE_CLIENT_SECRET,googleOAuthEgress,sharedTransportRateLimit:topology.proxied,verifiedEntryIp:topology.proxied&&topology.authentication==='signed-entry-v1'});
    if(new URL(request.url).origin!==topology.transport)return json({error:'origin_denied'},403);
    if(new URL(request.url).pathname.startsWith('/api/auth/')){
      const path=new URL(request.url).pathname;
      const allowed=request.method==='GET'?['/api/auth/get-session','/api/auth/callback/google','/api/auth/error']:request.method==='POST'?['/api/auth/sign-in/social','/api/auth/sign-out']:[];
      if(!allowed.includes(path))return json({error:'not_found'},404);
      if(request.method==='POST'){
        requireOrigin(request,env.APP_ORIGIN);
        const body=await readJson(request);
        const headers=new Headers(request.headers);headers.delete('content-length');
        return await auth.handler(new Request(request.url,{method:'POST',headers,body:JSON.stringify(body)}));
      }
      return await auth.handler(request);
    }
    return await gateway(request,{testingSimulationAvailable:(principal,tenantId)=>managedTestingOwner(env.MANAGED_TESTING_JSON,tenantId,principal.userId),executionAvailability:{service:env.M3_SERVICE_ENABLED==='true',preview:env.M3_PREVIEW_ENABLED==='true',simulation:env.M4_SIMULATION_ENABLED==='true'||invitedRunsPolicy(env.INVITED_RUNS_POLICY_JSON)?.enabled===true},g4ComputeCounts:createGatewayG4ComputeServices(env),g4WindowSnapshot:createGatewayG4WindowServices(env as unknown as Parameters<typeof createGatewayG4WindowServices>[0]),origin:env.APP_ORIGIN,transportOrigin:topology.transport,database,...(env.PRIVATE_BETA_CAPACITY?{privateBeta:{snapshot:()=>env.PRIVATE_BETA_CAPACITY!.getByName(PRIVATE_BETA_CAPACITY_ACTOR).snapshot(),userStatus:(scope:import('../turn/protocol.ts').TurnScope,actor:import('../turn/protocol.ts').TurnActor)=>env.PRIVATE_BETA_CAPACITY!.getByName(PRIVATE_BETA_CAPACITY_ACTOR).userStatus(scope,actor),pause:(actor:import('../turn/protocol.ts').TurnActor)=>env.PRIVATE_BETA_CAPACITY!.getByName(PRIVATE_BETA_CAPACITY_ACTOR).pause(actor),resume:(actor:import('../turn/protocol.ts').TurnActor)=>env.PRIVATE_BETA_CAPACITY!.getByName(PRIVATE_BETA_CAPACITY_ACTOR).resume(actor)}}:{}),modelContent:env.MODEL_CONTENT?new R2ModelContentPort(env.MODEL_CONTENT):undefined,modelUpload:env.MODEL_CONTENT?new R2ModelContentUploadPort(env.MODEL_CONTENT):undefined,
      admitProject:async(principal,tenantId,key,body)=>{
        if(piDeveloperOwner(env.PI_DEVELOPER_POLICY_JSON,tenantId,principal.userId))return null;
        if(managedTestingOwner(env.MANAGED_TESTING_JSON,tenantId,principal.userId))return null;
        if(await matchesManagedProjectBootstrap(env.MANAGED_PROJECT_BOOTSTRAP_JSON,principal,tenantId,key,body))return null;
        const invited=await acceptedInvitationProjectAdmission(database,env.INVITED_PROJECT_ADMISSION_ENABLED,principal,tenantId);
        if(invited)return {projectAdmission:invited};
        if(env.G5_CONTROLLED_WINDOW_JSON!==undefined){
          if(env.G5_ADMISSION_ENABLED!=='true'||!env.G5_WINDOW_GUARD)throw new HttpError('g5_admission_disabled',409);
          const registration=await g5TaskKey(env.G5_CONTROLLED_WINDOW_JSON,'project',tenantId,principal.userId,{key},body);
          const guard=env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR);
          await guard.registerTask(registration);
          const claim=await guard.claimTaskCreate(registration.key),policy=JSON.parse(env.G5_CONTROLLED_WINDOW_JSON);
          return {authorized:claim.authorized,boundProjectId:claim.boundId,budgetRoute:{kind:'g5',taskKey:registration.key,windowId:policy.windowId,profileSha256:policy.profilePin.profileSha256}};
        }
        return admitG4Task(env.TENANT_MODEL_BUDGET,env.G4_CONTROLLED_WINDOW_JSON,tenantId,principal.userId,'project',{key},body);
      },
      createdProject:async(_principal,_tenantId,projectId,route)=>{
        if(!env.G5_WINDOW_GUARD)throw new HttpError('g5_budget_binding_unavailable',503);
        await env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR).bindTask(route.taskKey,projectId);
      },
      provision:async(principal,tenantId,projectId)=>{
        const item=await new ProvisioningCatalog(database).kickProject(principal,tenantId,projectId);
        if(item)await dispatch(env,item);
      },projectArchives:createGatewayProjectArchives(new ProjectArchives(database),env.WORKSPACE_AGENT),publications:createGatewayPublications(env),publicationArtifacts:new R2PublicationArtifacts(env.WORKSPACE_CHECKPOINTS),researchExports:createGatewayResearchExports(env),g5ReadonlyReads:createGatewayG5ReadonlyReads(env),projectViews:createGatewayProjectViewServices(env),manualSaves:createGatewayManualSaveServices(env),simulations:createGatewaySimulationServices(env),browserPreviews:createGatewayBrowserPreviewServices(env),turns:createGatewayTurnServices({...env,M2_TURN_RUNTIME_CONFIGURED:Boolean(typeof env.PRODUCT_TURN_RUNTIME?.getByName==='function'&&typeof env.TRUSTED_PI_CAPACITY?.getByName==='function'&&typeof env.TOOL_ARTIFACT_STORE?.getByName==='function')}),serviceRuns:createGatewayServiceServices(env),previews:createGatewayPreviewServices(env,database),observations:createGatewayObserverServices(env),identity:async req=>{
      const value=await auth.api.getSession({headers:req.headers,query:{disableCookieCache:true}});
      return sessionIdentity(value);
    }});
    }catch(error){
      if(error instanceof HttpError||error instanceof CatalogError)return json({error:error.message},error.status);
      return json({error:'temporarily_unavailable'},503);
    }finally{releaseSignedCapacity();}
  },
  async scheduled(_event:ScheduledController,env:GatewayRuntimeEnv):Promise<void>{
    const database=catalogDatabase(env.CATALOG);
    await runGatewayScheduledDomains(async()=>{const work=await new ProvisioningCatalog(database).sweep(10),results=await Promise.allSettled(work.map(item=>dispatch(env,item)));if(results.some(result=>result.status==='rejected'))throw Error('workspace-dispatch-incomplete');},()=>runRevisionGcMaintenance(database,env.REVISION_STORE));
  },
} satisfies ExportedHandler<GatewayRuntimeEnv>;
export default {
  ...gatewayHandler,
  async fetch(request:Request,env:GatewayRuntimeEnv):Promise<Response>{
    if(env.TWO_ACCOUNT_AUTH_MODE!=='signed-entry-v1'||new URL(request.url).origin!==env.APP_TRANSPORT_ORIGIN)return gatewayHandler.fetch(request,env);
    const bridge=requestAbortBridge(request.signal);
    try{return abortableResponse(await gatewayHandler.fetch(new Request(request,{signal:bridge.signal}),env),bridge);}
    catch(error){bridge.dispose();throw error;}
  }
} satisfies ExportedHandler<GatewayRuntimeEnv>;

export { ProductionModelBudget } from '../model-budget/production-durable.ts';
