import type {ModelContentUploadPort} from '../runtime/model-upload.ts';
import {readModelUpload} from './model-upload-body.ts';
import type {ModelContentPort} from '../runtime/content.ts';
import { Admission, type VerifiedIdentity } from '../catalog/admission.ts';
import { CatalogError, type Principal } from '../catalog/contracts.ts';
import { ProjectCatalog } from '../catalog/projects.ts';
import { ModelCatalog, type ModelVersion } from '../catalog/models.ts';
import { OperatorCatalog } from '../catalog/admin.ts';
import { statement as sql, type Database } from '../catalog/database.ts';
import { HttpError, json, readJson, requireOrigin } from './http.ts';
import type { TurnActor, TurnScope } from '../turn/protocol.ts';
import { turnEventStream } from './events.ts';
import { toolArtifactReceipt } from '../artifacts/protocol.ts';

export interface GatewayServices {
  origin:string;
  database:Database;
  modelContent?:ModelContentPort;
  modelUpload?:ModelContentUploadPort;
  identity(request:Request):Promise<VerifiedIdentity|null>;
  provision?(principal:Principal,tenantId:string,projectId:string):Promise<void>;
  turns?:{
    createSession(scope:TurnScope,actor:TurnActor,key:string,body:{title:unknown}):Promise<unknown>;
    submit(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,body:{message:unknown}):Promise<unknown>;
    cancel(scope:TurnScope,actor:TurnActor,turnId:string):Promise<unknown>;
    replay(scope:TurnScope,afterSequence:number,limit:number):Promise<unknown>;
    snapshot(scope:TurnScope):Promise<unknown>;
    files(scope:TurnScope):Promise<unknown>;
    diff(scope:TurnScope):Promise<unknown>;
    artifact(scope:TurnScope,artifactId:string):Promise<unknown>;
  };
}
async function turnCall<T>(operation:()=>Promise<T>):Promise<T>{
  try{return await operation();}catch(error){const code=error instanceof Error?error.message:'';
    if(code.includes('idempotency-conflict'))throw new CatalogError('idempotency_conflict');
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
function publicTurn(value:unknown):unknown{if(!value||typeof value!=='object'||Array.isArray(value))return value;const {requestKey:_,payloadSha256:__,dispatchId:___,base:____,startedSequence:_____,terminalSequence:______,...safe}=value as Record<string,unknown>;return safe;}
function publicResult(value:unknown,field:'session'|'turn'):unknown{if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,field))return field==='turn'?publicTurn(value):publicSession(value);const result=value as Record<string,unknown>;return {...result,[field]:field==='turn'?publicTurn(result[field]):publicSession(result[field])};}
function publicModel(model:ModelVersion){return {model_id:model.model_id,version:model.version,status:model.status,title:model.title,description:model.description,content_sha256:model.content_sha256,published_at:model.published_at};}
async function artifactContent(value:unknown):Promise<Response>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-tool-artifact-read');
  const result=value as {receipt?:unknown;content?:unknown},receipt=toolArtifactReceipt(result.receipt);
  if(!(result.content instanceof Uint8Array)||result.content.byteLength!==receipt.bytes)throw Error('invalid-tool-artifact-read');
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(result.content)),sha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');if(sha256!==receipt.sha256)throw Error('invalid-tool-artifact-read');
  return new Response(result.content.slice().buffer,{headers:{'content-type':`${receipt.mediaType}; charset=utf-8`,'content-length':String(receipt.bytes),'cache-control':'no-store','x-content-type-options':'nosniff','etag':`"${receipt.sha256}"`,'x-riffology-artifact-id':receipt.artifactId,'x-riffology-artifact-sha256':receipt.sha256}});
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
      return json({userId:principal.userId,tenants});
    }
    const workspace=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const files=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/files$/.exec(url.pathname);
    const diff=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/diff$/.exec(url.pathname);
    const artifact=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/artifacts\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const sessions=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/sessions$/.exec(url.pathname);
    const turns=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/sessions\/([A-Za-z0-9_-]{1,128})\/turns$/.exec(url.pathname);
    const cancel=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/turns\/([A-Za-z0-9_-]{1,128})\/cancel$/.exec(url.pathname);
    const events=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/events$/.exec(url.pathname);
    const turnMatch=workspace??files??diff??artifact??sessions??turns??cancel??events;
    if(turnMatch){
      if(!services.turns)throw Error('turn-service-not-configured');
      const catalog=new ProjectCatalog(services.database,new Set(['blank-v1']),models),turnScope=await catalog.workspace(principal,turnMatch[1]);
      const turnActor={userId:principal.userId,authVersion:principal.authVersion};
      if(workspace&&request.method==='GET'&&url.search==='')return json(await turnCall(()=>services.turns!.snapshot(turnScope)));
      if(files&&request.method==='GET'&&url.search==='')return json(await turnCall(()=>services.turns!.files(turnScope)));
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
        const result=await catalog.create(principal,match[1],request.headers.get('idempotency-key')??'',await readJson(request));
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
