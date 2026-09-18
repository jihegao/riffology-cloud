import type {GatewayBrowserPreviews} from './browser-preview-services.ts';
import {parsePreviewVerifyRequest,type PreviewRuntime} from '../browser-preview/contract.ts';
import {SubmissionCatalog} from '../catalog/submissions.ts';
import type {GatewayPublications} from './publication-services.ts';
import type {PublicationArtifacts} from '../publication/artifacts.ts';
import type {GatewayResearchExports} from './research-export-services.ts';
import {experimentGroupRequest} from '../simulation/groups.ts';
import {experimentRequest} from '../simulation/host.ts';
import type {GatewaySimulations} from './simulation-services.ts';
import type {ModelContentUploadPort} from '../runtime/model-upload.ts';
import {readModelUpload} from './model-upload-body.ts';
import type {ModelContentPort} from '../runtime/content.ts';
import { Admission, type VerifiedIdentity } from '../catalog/admission.ts';
import { CatalogError,createProjectInput,opaqueId, type Principal } from '../catalog/contracts.ts';
import { ProjectCatalog,projectBudgetRoute,type ProjectBudgetRoute } from '../catalog/projects.ts';
import { ModelCatalog, type ModelVersion } from '../catalog/models.ts';
import { OperatorCatalog } from '../catalog/admin.ts';
import { statement as sql, type Database } from '../catalog/database.ts';
import { HttpError, json, readJson, requireOrigin } from './http.ts';
import {sameScope,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import { turnEventStream } from './events.ts';
import { toolArtifactReceipt } from '../artifacts/protocol.ts';
import type {GatewayServiceRuns,ServiceCursor} from './service-services.ts';
import type {GatewayPreviews} from './preview-services.ts';
import {browserPrincipal} from '../preview/session.ts';
import {observerRpcData} from '../preview/observer-rpc-data.ts';
import {observerArtifactReceipt} from '../preview/observer-artifacts.ts';
import type {GatewayObservations} from './observer-services.ts';
import type {GatewayG5ReadonlyReads} from './g5-read-services.ts';

export interface GatewayServices {
  executionAvailability?:{service:boolean;preview:boolean;simulation:boolean};
  g4WindowSnapshot?(tenantId:string,actor:TurnActor):Promise<unknown>;
  g4ComputeCounts?(scope:TurnScope,actor:TurnActor):Promise<unknown>;
  browserPreviews?:GatewayBrowserPreviews;
  publications?:GatewayPublications;
  publicationArtifacts?:PublicationArtifacts;
  researchExports?:GatewayResearchExports;
  simulations?:GatewaySimulations;
  origin:string;
  database:Database;
  modelContent?:ModelContentPort;
  modelUpload?:ModelContentUploadPort;
  identity(request:Request):Promise<VerifiedIdentity|null>;
  admitProject?(principal:Principal,tenantId:string,key:string,body:unknown):Promise<unknown>;
  createdProject?(principal:Principal,tenantId:string,projectId:string,budgetRoute:ProjectBudgetRoute):Promise<void>;
  provision?(principal:Principal,tenantId:string,projectId:string):Promise<void>;
  serviceRuns?:GatewayServiceRuns;
  previews?:GatewayPreviews;
  observations?:GatewayObservations;
  g5ReadonlyReads?:GatewayG5ReadonlyReads;
  turns?:{
    createSession(scope:TurnScope,actor:TurnActor,key:string,body:{title:unknown}):Promise<unknown>;
    submit(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,body:{message:unknown}):Promise<unknown>;
    cancel(scope:TurnScope,actor:TurnActor,turnId:string):Promise<unknown>;
    replay(scope:TurnScope,afterSequence:number,limit:number):Promise<unknown>;
    snapshot(scope:TurnScope):Promise<unknown>;
    files(scope:TurnScope):Promise<unknown>;
    diff(scope:TurnScope):Promise<unknown>;
    artifact(scope:TurnScope,artifactId:string):Promise<unknown>;
    managedAcceptanceStatus?(scope:TurnScope,actor:TurnActor):Promise<unknown>;
    cleanupManagedAcceptance?(scope:TurnScope,actor:TurnActor):Promise<unknown>;
  };
}
async function serviceCall<T>(operation:()=>Promise<T>):Promise<T>{
 try{return await operation();}catch(error){const code=error instanceof Error?error.message:'';
  if(code==='service-intent-conflict')throw new CatalogError('idempotency_conflict');
  if(code==='service-revision-changed')throw new HttpError('service_revision_changed',409);
  if(code==='service-intent-not-found'||code==='workspace-actor-scope-denied')throw new CatalogError('not_found');
  throw error;
 }
}
async function turnCall<T>(operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}catch(error){const code=error instanceof Error?error.message:'';
    if(code.includes('idempotency-conflict'))throw new CatalogError('idempotency_conflict');
    if(code==='workspace-recovery-hold')throw new HttpError(code,409);
    if(code.includes('not-found'))throw new CatalogError('not_found');
    if(code.startsWith('invalid-'))throw new CatalogError('invalid_input');throw error;}
}
function bodyOnly(value:unknown,key:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,key))throw new CatalogError('invalid_input');return value as Record<string,unknown>;
}
function cursor(url:URL,name:string,fallback:number,max:number){const values=url.searchParams.getAll(name);if(values.length===0)return fallback;if(values.length!==1||!/^\d+$/.test(values[0]!))throw new CatalogError('invalid_input');const n=Number(values[0]);if(!Number.isSafeInteger(n)||n<0||n>max)throw new CatalogError('invalid_input');return n;}
function lastEventId(request:Request):number{const value=request.headers.get('last-event-id');if(value===null)return 0;if(!/^\d+$/.test(value))throw new CatalogError('invalid_input');const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new CatalogError('invalid_input');return n;}
function idempotencyKey(request:Request):string{const values=request.headers.get('idempotency-key');if(values===null||!values||!/^[A-Za-z0-9_-]{1,128}$/.test(values))throw new CatalogError('invalid_input');return values;}
function replayed(value:unknown):boolean{return !!value&&typeof value==='object'&&!Array.isArray(value)&&(value as {replayed?:unknown}).replayed===true;}
function publicSession(value:unknown):unknown{if(!value||typeof value!=='object'||Array.isArray(value))return value;const {actorUserId:_,actorAuthVersion:__,...safe}=value as Record<string,unknown>;return safe;}
function publicTurn(value:unknown):unknown{if(!value||typeof value!=='object'||Array.isArray(value))return value;const {actor:privateActor,requestKey:_,payloadSha256:__,dispatchId:___,base:____,resourceLease:_____,startedSequence:______,terminalSequence:_______,...safe}=value as Record<string,unknown>,actor=privateActor&&typeof privateActor==='object'&&!Array.isArray(privateActor)?{userId:(privateActor as Record<string,unknown>).userId}:privateActor;return {...safe,actor};}
async function g5Read(request:Request,services:GatewayServices,scope:TurnScope,actor:TurnActor,response:Response){return services.g5ReadonlyReads?services.g5ReadonlyReads.record(request,scope,actor,response):response;}
function publicResult(value:unknown,field:'session'|'turn'):unknown{if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,field))return field==='turn'?publicTurn(value):publicSession(value);const result=value as Record<string,unknown>;return {...result,[field]:field==='turn'?publicTurn(result[field]):publicSession(result[field])};}
function publicModel(model:ModelVersion){return {model_id:model.model_id,version:model.version,status:model.status,title:model.title,description:model.description,content_sha256:model.content_sha256,published_at:model.published_at};}
async function artifactContent(value:unknown):Promise<Response>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-tool-artifact-read');
  const result=value as {receipt?:unknown;content?:unknown},receipt=toolArtifactReceipt(result.receipt);
  if(!(result.content instanceof Uint8Array)||result.content.byteLength!==receipt.bytes)throw Error('invalid-tool-artifact-read');
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(result.content)),sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(sha256!==receipt.sha256)throw Error('invalid-tool-artifact-read');
  return new Response(result.content.slice().buffer,{headers:{'content-type':`${receipt.mediaType}; charset=utf-8`,'content-length':String(receipt.bytes),'cache-control':'no-store','x-content-type-options':'nosniff','etag':`"${receipt.sha256}"`,'x-riffology-artifact-id':receipt.artifactId,'x-riffology-artifact-sha256':receipt.sha256}});
}
async function observerArtifactContent(value:unknown):Promise<Response>{
 const data=observerRpcData(value as object) as Record<string,unknown>,keys=['receipt','content'];
 if(Object.keys(data).length!==keys.length||keys.some(key=>!Object.hasOwn(data,key)))throw Error('invalid-observer-artifact-read');
 const receipt=observerArtifactReceipt(data.receipt),content=data.content;
 if(!(content instanceof Uint8Array)||content.byteLength!==receipt.bytes)throw Error('invalid-observer-artifact-read');
 const bytes=Uint8Array.from(content),digest=await crypto.subtle.digest('SHA-256',bytes),sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 if(sha256!==receipt.sha256)throw Error('invalid-observer-artifact-read');
 return new Response(bytes.buffer,{headers:{'content-type':receipt.mediaType,'content-length':String(receipt.bytes),'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'x-riffology-observation-state':'historical'}});
}
/** Authentication is supplied by the server entrypoint, never a request identity header. */
export async function gateway(request:Request, services:GatewayServices):Promise<Response> {
  try {
    const url=new URL(request.url);
    if(url.origin!==services.origin)throw new HttpError('origin_denied',403);
    if(request.method!=='GET' || request.headers.get('upgrade'))requireOrigin(request,services.origin);
    const identity=await services.identity(request);
    if(!identity)throw new HttpError('authentication_required',401);
    const admission=new Admission(services.database);
    if(url.pathname==='/api/invitations/accept' && request.method==='POST'){
      const body=await readJson(request);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='token'))throw new CatalogError('invalid_input');
      return json(await admission.accept(identity,(body as {token?:unknown}).token));
    }
    const principal=await admission.principal(identity);
    const admin=new OperatorCatalog(services.database);
    const models=new ModelCatalog(services.database,Date.now,services.modelContent,services.modelUpload);
    const windowRoute=/^\/api\/tenants\/([A-Za-z0-9_-]{1,128})\/g4-window$/.exec(url.pathname);
    if(windowRoute){if(request.method!=='GET'||url.search)throw new CatalogError('invalid_input');const catalog=new ProjectCatalog(services.database,new Set());await catalog.list(principal,windowRoute[1]!);if(!services.g4WindowSnapshot)throw new HttpError('g4-window-unavailable',503);const result=await services.g4WindowSnapshot(windowRoute[1]!,principal);await catalog.list(principal,windowRoute[1]!);return json(result);}
    const publicationRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/(publication-readiness|model-submissions)$/.exec(url.pathname),reviewRoute=/^\/api\/admin\/model-submissions(?:\/([A-Za-z0-9_-]{1,128})\/(review|export))?$/.exec(url.pathname),ownerExport=/^\/api\/model-submissions\/([A-Za-z0-9_-]{1,128})\/export$/.exec(url.pathname);
    if(publicationRoute||reviewRoute||ownerExport){
      if(!services.publications||!services.publicationArtifacts)throw new HttpError('publication-unavailable',503);
      const submissions=new SubmissionCatalog(services.database,models,services.publicationArtifacts);
      if([...url.searchParams.keys()].some(k=>k!=='before')||url.searchParams.getAll('before').length>1)throw new CatalogError('invalid_input');
      const before=url.searchParams.get('before')??undefined;
      try{
        if(publicationRoute){const scope=await new ProjectCatalog(services.database,new Set()).maintenanceWorkspace(principal,publicationRoute[1]!);
          if(publicationRoute[2]==='publication-readiness'&&request.method==='GET'&&!before)return json(await services.publications.prepare(scope,principal));
          if(publicationRoute[2]==='model-submissions'&&request.method==='GET')return json(await submissions.list(principal,scope,before));
          if(publicationRoute[2]==='model-submissions'&&request.method==='POST'&&!before){const result=await submissions.submit(principal,scope,idempotencyKey(request),await readJson(request),version=>services.publications!.freeze(scope,principal,version));return json(result,result.replayed?200:201);}
        }
        if(reviewRoute){if(!reviewRoute[1]&&request.method==='GET')return json(await submissions.reviewList(principal,before));
          if(reviewRoute[2]==='review'&&request.method==='POST'&&!before)return json(await submissions.review(principal,reviewRoute[1]!,idempotencyKey(request),await readJson(request)));
          if(reviewRoute[2]==='export'&&request.method==='GET'&&!before)return await submissions.download(principal,reviewRoute[1]!,true);
        }
        if(ownerExport&&request.method==='GET'&&!before)return await submissions.download(principal,ownerExport[1]!,false);
        throw new HttpError('method_not_allowed',405);
      }catch(error){if(error instanceof CatalogError||error instanceof HttpError)throw error;const code=error instanceof Error?error.message:'';if(['publication-not-ready','publication-model-stale','publication-artifact-invalid','publication-artifact-missing'].includes(code))throw new HttpError(code,409);if(code==='publication-access-denied')throw new HttpError(code,403);if(code==='publication-busy')throw new HttpError(code,429);throw new HttpError('publication-unavailable',503);}
    }
    if(url.pathname==='/api/models'&&request.method==='GET')return json({models:(await models.published()).map(publicModel)});
    const modelDetail=/^\/api\/models\/([A-Za-z0-9._-]{1,128})\/versions\/([A-Za-z0-9._-]{1,64})$/.exec(url.pathname);
    if(modelDetail&&request.method==='GET')return json(publicModel(await models.getPublished(modelDetail[1],modelDetail[2])));
    if(url.pathname==='/api/admin/overview'&&request.method==='GET')return json(await admin.overview(principal));
    if(url.pathname==='/api/admin/tenants'&&request.method==='GET')return json({tenants:await admin.tenants(principal)});
    if(url.pathname==='/api/admin/invitations'&&request.method==='GET')return json({invitations:await admin.invitations(principal)});
    if(url.pathname==='/api/admin/invitations'&&request.method==='POST'){
      return json(await admin.issue(principal,request.headers.get('idempotency-key')??'',await readJson(request)),201);
    }
    const revoke=/^\/api\/admin\/invitations\/([A-Za-z0-9_-]{1,128})\/revoke$/.exec(url.pathname);
    if(revoke&&request.method==='POST')return json(await admin.revoke(principal,revoke[1],await readJson(request)));
    if(url.pathname==='/api/admin/audit'&&request.method==='GET')return json({events:await admin.audit(principal)});
    if(url.pathname==='/api/admin/models'&&request.method==='GET')return json({models:await models.all(principal)});
    if(url.pathname==='/api/admin/models'&&request.method==='POST'){const result=await models.createDraft(principal,idempotencyKey(request),await readJson(request));return json(result,result.replayed?200:201);}
    const modelUpload=/^\/api\/admin\/models\/([A-Za-z0-9_-]{1,128})\/content$/.exec(url.pathname);
    if(modelUpload&&request.method==='POST')return json(await models.upload(principal,modelUpload[1],idempotencyKey(request),()=>readModelUpload(request)));
    const modelTransition=/^\/api\/admin\/models\/([A-Za-z0-9._-]{1,128})\/(validate|publish|withdraw)$/.exec(url.pathname);
    if(modelTransition&&request.method==='POST') { const body=await readJson(request); if(body && typeof body==='object' && Object.keys(body as object).length) throw new CatalogError('invalid_input'); const transitions={validate:'validated',publish:'published',withdraw:'withdrawn'} as const; const result=await models.transition(principal,modelTransition[1],transitions[modelTransition[2] as keyof typeof transitions],idempotencyKey(request)); return json(result); }
    if(url.pathname==='/api/me' && request.method==='GET'){
      const tenants=await services.database.query<{id:string}>(sql(`SELECT t.id FROM catalog_tenants t JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=t.owner_user_id
        JOIN catalog_users u ON u.id=t.owner_user_id WHERE t.owner_user_id=? AND t.status='active' AND m.status='active' AND u.status='active' AND u.auth_version=?`,principal.userId,principal.authVersion));
      return json({userId:principal.userId,tenants,...(services.executionAvailability?{execution:services.executionAvailability}:{})});
    }
    const exportRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/research-export$/.exec(url.pathname);
    if(exportRoute){
      if(request.method!=='GET'||url.search)throw new HttpError('export-input-invalid',400);
      const scope=await new ProjectCatalog(services.database,new Set(['blank-v1']),models).maintenanceWorkspace(principal,exportRoute[1]!);
      if(!services.researchExports)throw new HttpError('export-unavailable',503);
      try{return await g5Read(request,services,scope,principal,await services.researchExports.download(scope,principal));}catch(error){const code=error instanceof Error?error.message:'';
        if(code==='export-access-denied')throw new HttpError(code,403);
        if(code==='export-busy')throw new HttpError(code,429);
        if(code==='export-too-large'||code==='turn-revision-object-too-large')throw new HttpError('export-too-large',413);
        if(['export-model-changed','export-model-spec-invalid','export-dependencies-invalid','export-sensitive-file'].includes(code))throw new HttpError(code,409);
        if(['export-source-mismatch','export-result-missing','export-evidence-mismatch'].includes(code))throw new HttpError(code,409);
        throw new HttpError('export-unavailable',503);
      }
    }
    const evidenceRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/(evidence|evidence-rejections)(?:\/([a-f0-9]{64}))?$/.exec(url.pathname);
    if(evidenceRoute){
      const [,workspaceId,resource,claimId]=evidenceRoute,catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models),scope=await catalog.maintenanceWorkspace(principal,workspaceId!);
      if(!services.simulations)throw new HttpError('evidence-unavailable',503);
      try{
        if(resource==='evidence'&&request.method==='GET'){
          if(claimId&&!url.search)return g5Read(request,services,scope,principal,json(await services.simulations.viewEvidence(scope,principal,claimId)));
          if(!claimId){if([...url.searchParams.keys()].some(k=>k!=='before')||url.searchParams.getAll('before').length>1)throw new HttpError('evidence-input-invalid',400);return json(await services.simulations.listEvidence(scope,principal,url.searchParams.get('before')??undefined));}
        }
        if(request.method==='POST'&&!claimId&&!url.search){const body=await readJson(request);return json(resource==='evidence'?await services.simulations.createEvidence(scope,principal,body):await services.simulations.rejectEvidence(scope,principal,body),201);}
        throw new HttpError('evidence-input-invalid',400);
      }catch(error){if(error instanceof HttpError||error instanceof CatalogError)throw error;const code=error instanceof Error?error.message:'';if(code==='evidence-not-found'||code==='simulation-not-found')throw new HttpError('evidence-not-found',404);if(code==='evidence-capacity')throw new HttpError(code,429);if(code==='evidence-access-denied')throw new HttpError(code,403);if(/^evidence-(?:input-invalid|expectation-mismatch|group-mismatch|metric-missing|no-valid-runs|zero-baseline|number-overflow|source-rejected|run-ineligible)$/.test(code))throw new HttpError(code,400);throw new HttpError('evidence-unavailable',503);}
    }
    const g4CountsRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/g4-compute-counts$/.exec(url.pathname);
    if(g4CountsRoute){
      if(request.method!=='GET'||url.search)throw new HttpError('g4-compute-counts-input-invalid',400);
      const catalog=new ProjectCatalog(services.database,new Set()),scope=await catalog.maintenanceWorkspace(principal,g4CountsRoute[1]!);
      if(!services.g4ComputeCounts)throw new HttpError('g4-compute-counts-unavailable',503);
      const result=await services.g4ComputeCounts(scope,principal);const after=await catalog.maintenanceWorkspace(principal,scope.workspaceId);if(!sameScope(after,scope))throw new HttpError('g4-compute-counts-scope-denied',403);return json(result);
    }
    const browserRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/browser-preview(?:\/(packages|verify|retry)(?:\/([A-Za-z0-9_-]{1,128}))?)?$/.exec(url.pathname);
    if(browserRoute){
      const [,workspaceId,resource,id]=browserRoute,catalog=new ProjectCatalog(services.database,new Set()),scope=resource==='verify'&&!id&&request.method==='POST'?await catalog.workspace(principal,workspaceId!):await catalog.maintenanceWorkspace(principal,workspaceId!);
      if(!services.browserPreviews)throw new HttpError('browser-preview-unavailable',503);
      try{
        if(!resource&&request.method==='GET'){
          if([...url.searchParams.keys()].some(k=>!['revisionId','profileId'].includes(k))||['revisionId','profileId'].some(k=>url.searchParams.getAll(k).length>1))throw new HttpError('browser-preview-input-invalid',400);
          const revision=url.searchParams.get('revisionId')??undefined,profile=url.searchParams.get('profileId')??undefined;
          if(revision!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(revision)||profile!==undefined&&!['python-stdlib/v1','mesa-3.5.1/v1'].includes(profile))throw new HttpError('browser-preview-input-invalid',400);
          return json(await services.browserPreviews.view(scope,principal,revision,profile as PreviewRuntime['profileId']|undefined));
        }
        if(resource==='packages'&&id&&request.method==='GET'&&!url.search){const bytes=await services.browserPreviews.bytes(scope,principal,id);return new Response(bytes,{headers:{'Content-Type':'application/json; charset=utf-8','Content-Length':String(bytes.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
        if(resource==='verify'&&!id&&request.method==='POST'&&!url.search)return json(await services.browserPreviews.verify(scope,principal,parsePreviewVerifyRequest(await readJson(request,12288))),202);
        if(resource==='verify'&&id&&request.method==='GET'&&!url.search)return json(await services.browserPreviews.verification(scope,principal,id));
        if(resource==='retry'&&id&&request.method==='GET'&&!url.search)return json(await services.browserPreviews.retryVerification(scope,principal,id));
        if(resource==='retry'&&!id&&request.method==='POST'&&!url.search)return json(await services.browserPreviews.retry(scope,principal,await readJson(request,4096)),202);
        throw new CatalogError('not_found');
      }catch(error){if(error instanceof HttpError||error instanceof CatalogError)throw error;const code=error instanceof Error?error.message:'';
        if(code==='browser-preview-not-found')throw new HttpError(code,404);
        if(code==='browser-preview-access-denied')throw new HttpError(code,403);
        if(/conflict|stale/.test(code))throw new HttpError(code,409);
        if(/input-invalid|contract-invalid|invalid-browser-preview|invalid-turn-id/.test(code))throw new HttpError('browser-preview-input-invalid',400);
        if(code==='simulation-capacity')throw new HttpError(code,429);
        throw new HttpError('browser-preview-unavailable',503);
      }
    }
    const simulationRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/(model|experiments|experiment-groups|simulation-runs)(?:\/([A-Za-z0-9_-]{1,128})(?:\/(cancel))?)?$/.exec(url.pathname);
    if(simulationRoute){
      const [,workspaceId,resource,id,action]=simulationRoute;
      const creating=request.method==='POST'&&(resource==='experiments'||resource==='experiment-groups')&&!id;
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models);
      const scope=creating?await catalog.workspace(principal,workspaceId!):await catalog.maintenanceWorkspace(principal,workspaceId!);
      if(!services.simulations)throw new HttpError('simulation-unavailable',503);
      try{
        if(resource==='model'&&!id&&request.method==='GET'&&!url.search)return g5Read(request,services,scope,principal,json(await services.simulations.model(scope)));
        if(creating&&resource==='experiment-groups'&&!url.search)return json(await services.simulations.submitGroup(scope,principal,idempotencyKey(request),experimentGroupRequest(await readJson(request,32768))),202);
        if(creating&&!url.search)return json(await services.simulations.submit(scope,principal,idempotencyKey(request),experimentRequest(await readJson(request))),202);
        if(resource==='experiment-groups'&&request.method==='GET'&&!action){
          if(id&&!url.search)return g5Read(request,services,scope,principal,json(await services.simulations.viewGroup(scope,id)));
          if(!id){if([...url.searchParams.keys()].some(k=>k!=='before')||url.searchParams.getAll('before').length>1)throw new HttpError('simulation-input-invalid',400);return json(await services.simulations.listGroups(scope,url.searchParams.get('before')??undefined));}
        }
        if(resource==='experiment-groups'&&id&&action==='cancel'&&request.method==='POST'&&!url.search){const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HttpError('simulation-input-invalid',400);return json(await services.simulations.cancelGroup(scope,id),202);}
        if(resource==='experiments'&&request.method==='GET'&&!action){
          if(id&&!url.search)return g5Read(request,services,scope,principal,json(await services.simulations.view(scope,id)));
          if(!id){if([...url.searchParams.keys()].some(k=>k!=='before')||url.searchParams.getAll('before').length>1)throw new HttpError('simulation-input-invalid',400);return json(await services.simulations.list(scope,url.searchParams.get('before')??undefined));}
        }
        if(resource==='simulation-runs'&&id&&action==='cancel'&&request.method==='POST'&&!url.search){const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HttpError('simulation-input-invalid',400);return json(await services.simulations.cancel(scope,id),202);}
        throw new CatalogError('not_found');
      }catch(error){
        if(error instanceof HttpError||error instanceof CatalogError)throw error;
        const code=error instanceof Error?error.message:'';
        if(['simulation-idempotency-conflict','simulation-model-stale'].includes(code))throw new HttpError(code,409);
        if(code==='simulation-not-found')throw new HttpError(code,404);
        if(code==='simulation-capacity')throw new HttpError(code,429);
        if(['simulation-input-invalid','invalid-model-spec','model-spec-missing','model-spec-invalid','model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'].includes(code))throw new HttpError(code,400);
        throw new HttpError('simulation-unavailable',503);
      }
    }
    const previewRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/previews(?:\/([A-Za-z0-9_-]{1,128})\/(tickets))?$/.exec(url.pathname);
    if(previewRoute){
      if(request.method!=='POST'&&!(request.method==='GET'&&!previewRoute[2]))throw new CatalogError('not_found');
      if(url.search!=='')throw new CatalogError('invalid_input');
      const scope=await new ProjectCatalog(services.database,new Set(['blank-v1']),models).workspace(principal,previewRoute[1]!);
      if(!identity.browserSession)throw new HttpError('authentication_required',401);
      const browser=browserPrincipal(identity,principal);
      if(!services.previews)throw Error('preview-not-configured');
      if(request.method==='GET')return json(await services.previews.current(scope,principal));
      const previewId=previewRoute[2];
      if(previewId){
        const body=bodyOnly(await readJson(request),'nonce');
        if(typeof body.nonce!=='string'||! /^[a-f0-9]{64}$/.test(body.nonce))throw new CatalogError('invalid_input');
        return json(await services.previews.ticket(scope,browser,previewId,body.nonce));
      }
      const body=await readJson(request) as {runId?:unknown;expectedPreviewId?:unknown};
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'runId')||!Object.hasOwn(body,'expectedPreviewId')||typeof body.runId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(body.runId)||!(body.expectedPreviewId===null||typeof body.expectedPreviewId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(body.expectedPreviewId)))throw new CatalogError('invalid_input');
      try{return json(await services.previews.open(scope,principal,idempotencyKey(request),{runId:body.runId,expectedPreviewId:body.expectedPreviewId as string|null}));}
      catch(error){if(error instanceof Error&&['preview-binding-cas-conflict','preview-binding-intent-conflict'].includes(error.message))throw new CatalogError('idempotency_conflict');throw error;}
    }
    const serviceRoute=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/services(?:\/([A-Za-z0-9_-]{1,128})(?:\/(stop))?)?$/.exec(url.pathname);
    if(serviceRoute){
      const [,workspaceId,runId,stop]=serviceRoute;
      const creating=request.method==='POST'&&!runId;
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models);
      const scope=creating?await catalog.workspace(principal,workspaceId!):await catalog.maintenanceWorkspace(principal,workspaceId!);
      if(!services.serviceRuns)throw Error('service-runs-not-configured');
      if(creating){
        if(url.search!=='')throw new CatalogError('invalid_input');
        const body=await readJson(request) as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['maxDurationMs','expectedRevisionId'].includes(k))||!Object.hasOwn(body,'maxDurationMs')||body.expectedRevisionId!==undefined&&(typeof body.expectedRevisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.expectedRevisionId)))throw new CatalogError('invalid_input');const duration=body.maxDurationMs;
        if(!Number.isSafeInteger(duration)||(duration as number)<1||(duration as number)>900000)throw new CatalogError('invalid_input');
        const result=await serviceCall(()=>services.serviceRuns!.submit(scope,principal,idempotencyKey(request),{maxDurationMs:duration as number,...(body.expectedRevisionId===undefined?{}:{expectedRevisionId:body.expectedRevisionId as string})}));return json(result,202);
      }
      if(runId&&stop&&request.method==='POST'){
        if(url.search!=='')throw new CatalogError('invalid_input');
        const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new CatalogError('invalid_input');
        return json(await serviceCall(()=>services.serviceRuns!.stop(scope,runId)),202);
      }
      if(runId&&!stop&&request.method==='GET'){
        if(url.search!=='')throw new CatalogError('invalid_input');
        return json(await serviceCall(()=>services.serviceRuns!.view(scope,runId)));
      }
      if(!runId&&request.method==='GET'){
        if([...url.searchParams.keys()].some(key=>!['limit','before_created_at','before_run_id'].includes(key)))throw new CatalogError('invalid_input');
        const limit=cursor(url,'limit',20,50);if(limit<1)throw new CatalogError('invalid_input');
        let before:ServiceCursor|undefined;
        if(url.searchParams.has('before_created_at')||url.searchParams.has('before_run_id')){
          const ids=url.searchParams.getAll('before_run_id'),createdAt=cursor(url,'before_created_at',0,Number.MAX_SAFE_INTEGER);
          if(createdAt<1||ids.length!==1||!/^[A-Za-z0-9_-]{1,128}$/.test(ids[0]!))throw new CatalogError('invalid_input');
          before={createdAt,runId:ids[0]!};
        }
        return json(await serviceCall(()=>services.serviceRuns!.list(scope,{limit,...(before?{before}:{})})));
      }
      throw new CatalogError('not_found');
    }
    const workspace=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const files=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/files$/.exec(url.pathname);
    const diff=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/diff$/.exec(url.pathname);
    const artifact=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/artifacts\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const sessions=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/sessions$/.exec(url.pathname);
    const managedAcceptance=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/managed-acceptance(?:\/(cleanup))?$/.exec(url.pathname);
    if(managedAcceptance){
      if(url.search)throw new CatalogError('invalid_input');
      const owned=await new ProjectCatalog(services.database,new Set()).maintenanceWorkspace(principal,managedAcceptance[1]!);
      try{
        if(request.method==='GET'&&!managedAcceptance[2]&&services.turns?.managedAcceptanceStatus)return json(await services.turns.managedAcceptanceStatus(owned,principal));
        if(request.method==='POST'&&managedAcceptance[2]==='cleanup'&&services.turns?.cleanupManagedAcceptance){const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new CatalogError('invalid_input');return json(await services.turns.cleanupManagedAcceptance(owned,principal));}
        throw new HttpError('method_not_allowed',405);
      }catch(error){if(error instanceof CatalogError||error instanceof HttpError)throw error;const code=error instanceof Error?error.message:'';if(/scope|owner|access|policy.*denied/.test(code))throw new HttpError('managed_acceptance_denied',403);throw new HttpError('managed_acceptance_unavailable',503);}
    }
    const turns=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/sessions\/([A-Za-z0-9_-]{1,128})\/turns$/.exec(url.pathname);
    const cancel=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/turns\/([A-Za-z0-9_-]{1,128})\/cancel$/.exec(url.pathname);
    const events=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/events$/.exec(url.pathname);
    const observationArtifact=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/turns\/([A-Za-z0-9_-]{1,128})\/observations\/([A-Za-z0-9_-]{1,128})\/artifacts\/(state|view)$/.exec(url.pathname);
    if(observationArtifact){
      if(request.method!=='GET')throw new CatalogError('not_found');
      if(url.search!=='')throw new CatalogError('invalid_input');
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models),turnScope=await catalog.workspace(principal,observationArtifact[1]!);
      if(!services.observations)throw Error('observer-services-not-configured');
      const caller={userId:principal.userId,authVersion:principal.authVersion};
      return await observerArtifactContent(await turnCall(()=>services.observations!.artifact(turnScope,caller,observationArtifact[2]!,observationArtifact[3]!,observationArtifact[4]! as 'state'|'view')));
    }
    const turnMatch=workspace??files??diff??artifact??sessions??turns??cancel??events;
    if(turnMatch){
      if(!services.turns)throw Error('turn-service-not-configured');
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models),turnScope=await catalog.workspace(principal,turnMatch[1]);
      const turnActor={userId:principal.userId,authVersion:principal.authVersion};
      if(workspace&&request.method==='GET'&&url.search==='')return g5Read(request,services,turnScope,turnActor,json(await turnCall(()=>services.turns!.snapshot(turnScope))));
      if(files&&request.method==='GET'&&url.search==='')return g5Read(request,services,turnScope,turnActor,json(await turnCall(()=>services.turns!.files(turnScope))));
      if(diff&&request.method==='GET'&&url.search==='')return json(await turnCall(()=>services.turns!.diff(turnScope)));
      if(artifact&&request.method==='GET'&&url.search==='')return await artifactContent(await turnCall(()=>services.turns!.artifact(turnScope,artifact[2])));
      if(sessions&&request.method==='POST'){
        const body=bodyOnly(await readJson(request),'title');
        const result=await turnCall(()=>services.turns!.createSession(turnScope,turnActor,idempotencyKey(request),{title:body.title}));return json(publicResult(result,'session'),replayed(result)?200:201);
      }
      if(turns&&request.method==='POST'){
        const body=bodyOnly(await readJson(request),'message');
        const result=await turnCall(()=>services.turns!.submit(turnScope,turnActor,turns[2],idempotencyKey(request),{message:body.message}));return json(publicResult(result,'turn'),replayed(result)?200:202);
      }
      if(cancel&&request.method==='POST'){
        const body=await readJson(request);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new CatalogError('invalid_input');
        return json(publicTurn(await turnCall(()=>services.turns!.cancel(turnScope,turnActor,cancel[2]))));
      }
      if(events&&request.method==='GET'){
        if([...url.searchParams.keys()].some(key=>!['after_sequence','limit'].includes(key)))throw new CatalogError('invalid_input');
        const after=Math.max(cursor(url,'after_sequence',0,Number.MAX_SAFE_INTEGER),lastEventId(request));
        if(request.headers.get('accept')?.split(',').some(value=>value.trim().split(';')[0]==='text/event-stream')){
          const suppliedOrigin=request.headers.get('origin');if(suppliedOrigin!==null&&suppliedOrigin!==services.origin)throw new HttpError('origin_denied',403);
          return turnEventStream({scope:turnScope,afterSequence:after,signal:request.signal,
            authorize:async()=>{await catalog.workspace(principal,turnMatch[1]);},
            replay:(sequence,limit)=>turnCall(()=>services.turns!.replay(turnScope,sequence,limit))});
        }
        return json(await turnCall(()=>services.turns!.replay(turnScope,after,cursor(url,'limit',200,200))));
      }
    }
    const match=/^\/api\/tenants\/([A-Za-z0-9_-]{1,128})\/projects(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(url.pathname);
    if(match){
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models);
      if(request.method==='GET'){
        if(match[2])return json(await catalog.get(principal,match[1],match[2]));
        return json({projects:await catalog.list(principal,match[1])});
      }
      if(request.method==='POST'&&!match[2]){
        const body=await readJson(request),key=request.headers.get('idempotency-key')??'';
        let budgetRoute:ProjectBudgetRoute|undefined;
        if(services.admitProject){opaqueId(key);createProjectInput(body,new Set(['blank-v1']));await catalog.list(principal,match[1]);const permit=await services.admitProject(principal,match[1],key,body);
          if(permit&&typeof permit==='object'&&Object.hasOwn(permit,'budgetRoute')){const p=permit as {budgetRoute:unknown;authorized:unknown;boundProjectId:unknown};budgetRoute=projectBudgetRoute(p.budgetRoute);
            if(p.authorized!==true){if(typeof p.boundProjectId==='string')return json({project:await catalog.get(principal,match[1],p.boundProjectId),replayed:true});throw new HttpError('project_admission_observe_only',409);}
          }
        }
        const result=await catalog.create(principal,match[1],key,body,budgetRoute);
        if(budgetRoute){if(!services.createdProject)throw new HttpError('project_budget_binding_unavailable',503);await services.createdProject(principal,match[1],result.project.id,budgetRoute);}
        // The outbox is already committed. Await durable acceptance, never put
        // the only dispatch into waitUntil. A lost response keeps the same key.
        if(services.provision)await services.provision(principal,match[1],result.project.id);
        return json(result,result.replayed?200:202);
      }
    }
    throw new CatalogError('not_found');
  }catch(error){
    if(error instanceof CatalogError||error instanceof HttpError)return json({error:error.message},error.status);
    return json({error:'temporarily_unavailable'},503);
  }
}
