import {Admission,type VerifiedIdentity} from '../catalog/admission.ts';
import {CatalogError} from '../catalog/contracts.ts';
import type {Database} from '../catalog/database.ts';
import {ProjectCatalog} from '../catalog/projects.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {publicResult} from './app.ts';
import {HttpError,json} from './http.ts';

export interface RecoveryServices {
  canonical:string;origin:string;until:number;database:Database;
  identity(request:Request):Promise<VerifiedIdentity|null>;
  snapshot(scope:TurnScope,actor:TurnActor):Promise<unknown>;
  receipt(scope:TurnScope,actor:TurnActor,sessionId:string,key:string):Promise<unknown>;
}
const recoveryScript=`const out=document.querySelector('pre');
document.querySelector('form').addEventListener('submit',async event=>{
event.preventDefault();const data=new FormData(event.target),workspace=data.get('workspace'),session=data.get('session'),key=data.get('key');
if(!/^[A-Za-z0-9_-]{1,128}$/.test(workspace)||session&&!/^[A-Za-z0-9_-]{1,128}$/.test(session)||key&&!/^[A-Za-z0-9_-]{1,128}$/.test(key)||!!session!==!!key){out.textContent='Invalid workspace, session or original request key.';return;}
const path='/api/workspaces/'+workspace+(session?'/sessions/'+session+'/turns/receipt':'');
out.textContent='Reading original record…';try{const response=await fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',headers:session?{'idempotency-key':key}:{}});out.textContent=JSON.stringify(await response.json(),null,2);}catch{out.textContent='Read failed. No request was replayed.';}
});`;
function asset(content:string,type:string){return new Response(content,{headers:{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"}});}
/** Deliberately separate from the full app: no startup, writes, refresh, SSE,
 * Preview/Execution or pending-intent replay. The caller supplies read-only auth. */
export async function legacyRecovery(request:Request,services:RecoveryServices,now=Date.now()):Promise<Response>{
  try{
    const url=new URL(request.url);
    if(url.origin!==services.origin)throw new HttpError('origin_denied',403);
    if(request.method!=='GET'||request.headers.has('upgrade'))throw new HttpError('legacy_read_only',403);
    if(url.search)throw new HttpError('invalid_input',400);
    if(now>=services.until)throw new HttpError('legacy_recovery_expired',410);
    if(url.pathname==='/')return asset(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Original records</title><h1>Original records — read only</h1><p>This temporary page uses your existing session to inspect original records. It does not submit or resume work. Sign in separately at the new application.</p><p><a href="${services.canonical}/" rel="noreferrer">Open application</a></p><form><p><label>Workspace ID <input name="workspace" required maxlength="128"></label></p><p><label>Original Session ID (receipt only) <input name="session" maxlength="128"></label></p><p><label>Original request key (receipt only) <input name="key" maxlength="128"></label></p><button>Read original record</button></form><pre></pre><script src="/legacy-recovery.js" defer></script></html>`,'text/html; charset=utf-8');
    if(url.pathname==='/legacy-recovery.js')return asset(recoveryScript,'text/javascript; charset=utf-8');
    const supplied=request.headers.get('origin');
    if(request.headers.get('sec-fetch-site')==='cross-site'||supplied!==null&&supplied!==services.origin)throw new HttpError('origin_denied',403);
    const snapshot=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const receipt=/^\/api\/workspaces\/([A-Za-z0-9_-]{1,128})\/sessions\/([A-Za-z0-9_-]{1,128})\/turns\/receipt$/.exec(url.pathname);
    if(!snapshot&&!receipt&&!['/api/me','/api/auth/get-session'].includes(url.pathname))throw new HttpError('legacy_route_denied',403);
    const identity=await services.identity(request);if(!identity)throw new HttpError('authentication_required',401);
    const principal=await new Admission(services.database).principal(identity);
    if(!snapshot&&!receipt)return json({userId:principal.userId,session:identity.browserSession,readOnly:true,expiresAt:services.until});
    const scope=await new ProjectCatalog(services.database,new Set()).maintenanceWorkspace(principal,(snapshot??receipt)![1]!);
    const actor={userId:principal.userId,authVersion:principal.authVersion};
    if(snapshot)return json(await services.snapshot(scope,actor));
    const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw new HttpError('invalid_input',400);
    return json(publicResult(await services.receipt(scope,actor,receipt![2]!,key),'turn'));
  }catch(error){
    if(error instanceof HttpError||error instanceof CatalogError)return json({error:error.message},error.status);
    if(error instanceof Error&&error.message==='recovery-authority-unprepared')return json({error:'recovery_authority_unprepared'},503);
    if(error instanceof Error&&['turn-receipt-not-found','turn-session-not-found','workspace-actor-scope-denied'].includes(error.message))return json({error:'not_found'},404);
    return json({error:'recovery_unavailable'},503);
  }
}
