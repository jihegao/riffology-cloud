import {HttpError,json} from '../gateway/http.ts';
import {requireRequestHost} from '../gateway/origins.ts';
import {clientIpHeader,proofHeader,signatureHeader,verifyEntry,type VerificationEnv} from './signature.ts';
import {validationConfig,validationTime,validationTopology,validationRoute,validationEmptyBody,validationNoCredentials,
  VALIDATION_ACTOR,VALIDATION_CASE_HEADER,type ValidationEnv,type ValidationTopology,type ValidationAction} from './validation-policy.ts';

const safeErrors=new Set(['entry_proof_denied','entry_ip_denied','entry_replay_denied','entry_replay_unavailable','entry_verifier_not_configured']);
async function budgetRPC<T>(call:()=>Promise<T>,signal:AbortSignal):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(new HttpError('validation_budget_unavailable',503));timer=setTimeout(abort,2000);});
  signal.addEventListener('abort',abort,{once:true});
  try{if(signal.aborted)throw new HttpError('validation_cancelled',403);return await Promise.race([call(),stopped]);}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
/** Same real canonical/transport and verifier as normal dispatch. This handler
 * terminates before ASSETS/Auth/Catalog. Case budget is consumed before verify. */
export async function validationGateway(request:Request,env:VerificationEnv&ValidationEnv,t:ValidationTopology):Promise<Response> {
  try{
    validationTopology(t);requireRequestHost(request);
    if(new URL(request.url).origin!==t.transport)throw new HttpError('validation_scope_denied',403);
    const c=validationConfig(env),route=validationRoute(request,c),cleanup=route.operation==='cleanup';
    validationTime(c,cleanup);validationNoCredentials(request);
    if(request.method!=='POST'||route.operation==='ui'||cleanup&&route.slot!=='A')throw new HttpError('validation_scope_denied',403);
    await validationEmptyBody(request);validationTime(c,cleanup);
    const actor=env.ENTRY_REPLAY?.getByName(VALIDATION_ACTOR);
    if(!actor)throw new HttpError('validation_budget_unavailable',503);
    const action=request.headers.get(VALIDATION_CASE_HEADER);
    if(cleanup){
      if(action!=='cleanup'||request.headers.has(proofHeader)||request.headers.has(signatureHeader)||!actor.validationCleanup)
        throw new HttpError('validation_scope_denied',403);
      const removed=await budgetRPC(()=>actor.validationCleanup!(c.run),request.signal);
      return json({case:'cleanup',status:200,code:'expired_control_rows_removed',removed});
    }
    if(!actor.validationTake||!action||!['observe','begin','primary','replay','expired'].includes(action)||
      (route.operation==='observe')!==(action==='observe')||route.slot==='B'&&['replay','expired'].includes(action))
      throw new HttpError('validation_scope_denied',403);
    if(['observe','begin'].includes(action)&&(request.headers.has(proofHeader)||request.headers.has(signatureHeader)))
      throw new HttpError('validation_scope_denied',403);
    if(action==='begin'&&c.expires-Date.now()<(route.slot==='A'?45_000:10_000))throw new HttpError('validation_closed',403);
    // Native bytes were required to be empty. Reconstruction preserves every
    // signed header/URL/method byte; only the consumed empty body is restored.
    const original=new Request(request.url,{method:request.method,headers:request.headers,signal:request.signal});
    if(await budgetRPC(()=>actor.validationTake!({run:c.run,slot:route.slot,action:action as ValidationAction}),request.signal)!=='accepted')
      throw new HttpError('validation_spent',403);
    validationTime(c);if(request.signal.aborted)throw new HttpError('validation_cancelled',403);
    if(action==='observe'||action==='begin')return json({case:action,status:200,code:'accepted'});
    try{
      const verified=await verifyEntry(original,t.canonical,t.transport,env);
      validationTime(c);if(request.signal.aborted)throw new HttpError('validation_cancelled',403);
      const ipMatches=verified.headers.get(clientIpHeader)===c.ips[route.slot];
      if(!ipMatches)throw new HttpError('entry_ip_denied',403);
      return json({case:action,status:200,code:'accepted',ipMatches:true});
    }catch(error){
      if(error instanceof HttpError&&safeErrors.has(error.message))return json({case:action,status:error.status,code:error.message},error.status);
      return json({case:action,status:503,code:'validation_verifier_unavailable'},503);
    }
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    return json({error:'validation_unavailable'},503);
  }
}
