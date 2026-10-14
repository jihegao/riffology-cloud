import {HttpError,json,requireOrigin} from '../gateway/http.ts';
import {requireRequestHost} from '../gateway/origins.ts';
import {base64url,clientIp,forwarded,pathQuery,proofHeader,signatureHeader,signEntry,type SigningEnv} from './signature.ts';
import {cleanupOnceSource} from './validation-cleanup-ui.ts';
import {validationConfig,validationTime,validationTopology,validationRoute,validationEmptyBody,validationNoCredentials,
  VALIDATION_CASE_HEADER,VALIDATION_INVOCATION_MS,VALIDATION_FETCH_MS,validationCanonical,validationTransport,
  type ValidationEnv,type ValidationConfig,type ValidationSlot} from './validation-policy.ts';

interface Env extends SigningEnv,ValidationEnv {APP_ORIGIN:string;APP_TRANSPORT_ORIGIN:string;TWO_ACCOUNT_AUTH_MODE?:string;}
type Send=(request:Request)=>Promise<Response>;
type Result={case:string;status:number;code:string;ipMatches?:boolean;removed?:number;};
const cases=new Set(['observe','begin','primary','replay','expired','cleanup']);
const codes=new Set(['accepted','entry_proof_denied','entry_replay_denied','entry_replay_unavailable','entry_ip_denied',
  'entry_verifier_not_configured','validation_verifier_unavailable','expired_control_rows_removed']);

async function boundedResult(response:Response,expected:string,signal:AbortSignal):Promise<Result> {
  if(response.headers.has('location')||response.headers.has('set-cookie')||response.status===101||
    !response.headers.get('content-type')?.startsWith('application/json')||!response.body){void response.body?.cancel().catch(()=>{});throw Error('response');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  let abort:()=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(Error('cancelled'));};});
  signal.addEventListener('abort',abort,{once:true});
  try{
    for(let i=0;i<32;i++){
      if(signal.aborted)throw Error('cancelled');
      const v=await Promise.race([reader.read(),stopped]);if(v.done){
        const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
        const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Result;
        if(!result||Object.keys(result).some(k=>!['case','status','code','ipMatches','removed'].includes(k))||
          result.case!==expected||!cases.has(result.case)||!codes.has(result.code)||result.status!==response.status||
          result.ipMatches!==undefined&&result.ipMatches!==true||result.removed!==undefined&&(!Number.isInteger(result.removed)||result.removed<0||result.removed>2))throw Error('response');
        return result;
      }
      size+=v.value.byteLength;if(size>1024)throw Error('response');parts.push(Uint8Array.from(v.value));
    }throw Error('response');
  }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
function nativeCopy(request:Request,signal:AbortSignal):Request {
  return new Request(request.url,{method:request.method,headers:request.headers,signal});
}
function target(native:Request,action:string,signal:AbortSignal):Request {
  const headers=forwarded(native.headers);headers.set(VALIDATION_CASE_HEADER,action);
  return new Request(validationTransport+pathQuery(native),{method:'POST',headers,signal,redirect:'manual',cache:'no-store'});
}
function taggedEmpty(request:Request,action:string,signal:AbortSignal):Request {
  const headers=new Headers(request.headers);headers.set(VALIDATION_CASE_HEADER,action);
  // signEntry deliberately strips unsigned headers. Add only our fixed budget
  // tag afterwards, preserving signed inputs and the already-proven empty body.
  return new Request(request.url,{method:request.method,headers,signal,redirect:'manual',cache:'no-store'});
}
async function exchange(request:Request,action:string,send:Send,signal:AbortSignal):Promise<Result> {
  // Timeout races also bound injected/offline senders. Unknown calls are never retried.
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let abort:()=>void=()=>{};
  const stopped=new Promise<never>((_,reject)=>{
    const fail=()=>{controller.abort();reject(Error('cancelled'));};abort=fail;
    timer=setTimeout(fail,VALIDATION_FETCH_MS);signal.addEventListener('abort',fail,{once:true});
  });
  try{
    if(signal.aborted)throw Error('cancelled');
    const bounded=new Request(request,{signal:controller.signal});
    return await Promise.race([(async()=>boundedResult(await send(bounded),action,controller.signal))(),stopped]);
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
}
function expect(result:Result,status:number,code:string):void {
  if(result.status!==status||result.code!==code||code==='accepted'&&result.case==='primary'&&result.ipMatches!==true)throw Error('unexpected');
}
async function waitPast(expires:number,c:ValidationConfig,signal:AbortSignal):Promise<void> {
  while(Date.now()<=expires+100){
    validationTime(c);if(signal.aborted)throw Error('cancelled');
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(Error('cancelled'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},Math.min(1000,expires+101-Date.now()));
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
  }
  validationTime(c);if(signal.aborted)throw Error('cancelled');
}
async function ui(c:ValidationConfig,slot:ValidationSlot):Promise<Response> {
  const root=JSON.stringify(VALIDATION_PATH(c.run,slot));
  const script=`${cleanupOnceSource};const root=${root};const run=${JSON.stringify(c.run)},slot=${JSON.stringify(slot)},serverNow=${Date.now()},epoch=performance.now(),clock=()=>serverNow+performance.now()-epoch;
const report=t=>{const out=document.getElementById('result');out.textContent+=(out.textContent?'\\n':'')+t;};
let halted=false,haltCleanup=()=>{},ownRunTerminal=false;const spent=new Set(),receipts=[],active=new Map();
const halt=()=>{halted=true;for(const id of ['observe','run','cleanup','armCleanup','stop'])document.getElementById(id).disabled=true;haltCleanup();for(const {controller,timer} of active.values()){clearTimeout(timer);controller.abort();}active.clear();report('stopped locally; unknown requests stay pending; stop both original pages, keep confirmed logs off, report within 10 minutes; do not retry');};
document.getElementById('stop').onclick=halt;
const post=async(op,signal)=>{if(halted||spent.has(op))throw Error('spent');spent.add(op);
const row={requestId:run+'_'+slot+'_'+op,run,slot,operation:op,startedAt:Math.floor(clock()),receivedAt:0,outcome:'unknown',response:null};
let passed=false;try{const r=await fetch(root+op,{method:'POST',body:'',credentials:'omit',mode:'same-origin',redirect:'error',cache:'no-store',signal});const body=await r.text();if(new TextEncoder().encode(body).length>1024)throw Error('response too large');row.response={status:r.status,body};row.outcome='response';const result=JSON.parse(body);if(!r.ok||result.passed!==true)throw Error('unknown');passed=true;}
catch(e){halt();throw e;}finally{row.receivedAt=Math.floor(clock());receipts.push(row);report(JSON.stringify(row));if(op==='run'&&passed&&!halted){ownRunTerminal=true;if(slot==='A')document.getElementById('armCleanup').disabled=false;}}};
const invoke=async(op,timeout)=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);active.set(op,{controller,timer});try{await post(op,controller.signal);}finally{clearTimeout(timer);active.delete(op);}};
for(const op of ['observe','run'])document.getElementById(op).onclick=async()=>{if(halted||spent.has(op))return;document.getElementById(op).disabled=true;try{await invoke(op,45000);}catch{}};
${slot==='A'?`const cleanup=cleanupOnce({serverNow,expires:${c.expires},monotonicNow:()=>performance.now(),setTimer:(f,ms)=>setTimeout(f,ms),clearTimer:t=>clearTimeout(t),canArm:()=>ownRunTerminal&&!halted,enable:()=>document.getElementById('cleanup').disabled=false,disable:()=>document.getElementById('cleanup').disabled=true,report,send:()=>invoke('cleanup',5000)});haltCleanup=()=>cleanup.halt();document.getElementById('cleanup').onclick=()=>{void cleanup();};document.getElementById('armCleanup').onclick=()=>{if(halted||!ownRunTerminal)return;if(!confirm('Has the coordinator confirmed both original A and B Run receipts for this run? Authorize the original A page cleanup once only. If either result is unknown, cancel and Stop both pages.'))return;if(cleanup.arm())document.getElementById('armCleanup').disabled=true;};`:''}`;
  const digest=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(script))));
  const hash=digest.replace(/-/g,'+').replace(/_/g,'/')+'=';
  return new Response(`<!doctype html><meta charset="utf-8"><title>Riffoid protocol validation</title><p>Maintenance test ${slot}. Ordinary application closed. No OAuth or business execution.</p><button id="observe">Observe native source</button><button id="run">Run once</button><button id="stop">Stop this original page locally</button>${slot==='A'?'<p>Cleanup starts unarmed. After the coordinator confirms both original Run receipts, authorize it once here. Unknown on either side: Stop both original pages.</p><button id="armCleanup" disabled>Authorize cleanup once after both receipts</button><button id="cleanup" disabled>Cleanup after deadline</button>':'<button id="armCleanup" hidden disabled>Unavailable</button><button id="cleanup" hidden disabled>Unavailable</button>'}<pre id="result"></pre><script>${script}</script>`,
    {headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff',
      'content-security-policy':`default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`}});
}
function VALIDATION_PATH(run:string,slot:ValidationSlot):string {return `/__riffoid-validation/${run}/${slot}/`;}

/** No caller-chosen target/body/clock. Only three real native proofs in total;
 * lease is durably consumed before private-key use, never returns credentials. */
export async function validationEntry(request:Request,env:Env,send:Send):Promise<Response> {
  const results:Result[]=[];let controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  let stage='preflight';
  let abort:()=>void=()=>{};
  try{
    validationTopology({canonical:env.APP_ORIGIN,transport:env.APP_TRANSPORT_ORIGIN,proxied:true,authentication:env.TWO_ACCOUNT_AUTH_MODE});
    requireRequestHost(request);if(new URL(request.url).origin!==validationCanonical)throw new HttpError('validation_scope_denied',403);
    const c=validationConfig(env),route=validationRoute(request,c),cleanup=route.operation==='cleanup';
    validationTime(c,cleanup||route.operation==='ui'&&Date.now()>=c.expires);
    validationNoCredentials(request);
    if(request.headers.has('cf-worker')||request.headers.has(proofHeader)||request.headers.has(signatureHeader)||
      [...request.headers.keys()].some(k=>k.startsWith('x-riffoid-validation-'))||clientIp(request.headers.get('cf-connecting-ip'))!==c.ips[route.slot])
      throw new HttpError('validation_source_denied',403);
    if(route.operation==='ui'){if(request.method!=='GET')throw new HttpError('validation_scope_denied',403);return ui(c,route.slot);}
    if(request.method!=='POST'||cleanup&&route.slot!=='A')throw new HttpError('validation_scope_denied',403);
    requireOrigin(request,validationCanonical);await validationEmptyBody(request);validationTime(c,cleanup);
    controller=new AbortController();abort=()=>controller?.abort();request.signal.addEventListener('abort',abort,{once:true});
    timer=setTimeout(abort,Math.min(VALIDATION_INVOCATION_MS,(cleanup?c.expires+30_000:c.expires)-Date.now()));
    if(request.signal.aborted)abort();const signal=controller.signal,native=nativeCopy(request,signal);
    if(cleanup||route.operation==='observe'){
      const action=cleanup?'cleanup':'observe',result=await exchange(target(native,action,signal),action,send,signal);
      expect(result,200,cleanup?'expired_control_rows_removed':'accepted');
      return json({slot:route.slot,case:action,passed:true,nativeIpMatches:true,results:[result]});
    }
    // Observation deliberately works before the marker exists. A premature Run
    // must not consume its durable begin lease or touch the signing key.
    if(env.ENTRY_NATIVE_IP_BOUNDARY!=='cloudflare-direct-visitor-waf-v1')
      throw new HttpError('validation_not_ready',503);
    if(c.expires-Date.now()<(route.slot==='A'?45_000:10_000))throw new HttpError('validation_closed',403);
    stage='begin';
    const begin=await exchange(target(native,'begin',signal),'begin',send,signal);expect(begin,200,'accepted');results.push(begin);
    validationTime(c);if(signal.aborted)throw Error('cancelled');
    stage='signing';
    const primary=taggedEmpty(await signEntry(target(native,'primary',signal),nativeCopy(native,signal),validationCanonical,env),'primary',signal);
    validationTime(c);if(signal.aborted)throw Error('cancelled');
    // A separate unused real proof is minted now, before waiting, with no now
    // injection. Its path/body/signed headers match the same real browser POST.
    const unused=route.slot==='A'?taggedEmpty(await signEntry(target(native,'expired',signal),nativeCopy(native,signal),validationCanonical,env),'expired',signal):undefined;
    stage='primary';
    const response=await exchange(primary,'primary',send,signal);results.push(response);expect(response,200,'accepted');
    if(route.slot==='A'){
      // Same actual proof/signature/body/method/path/all signed inputs. Case is
      // an unsigned budget tag; no second signEntry for this request.
      stage='replay';
      const replay=await exchange(taggedEmpty(primary,'replay',signal),'replay',send,signal);results.push(replay);expect(replay,403,'entry_replay_denied');
      const proof=JSON.parse(atob(unused!.headers.get(proofHeader)!.replace(/-/g,'+').replace(/_/g,'/'))) as unknown[];
      if(typeof proof[7]!=='number'||proof[7]>=c.expires)throw Error('deadline');
      stage='expiry_wait';
      await waitPast(proof[7],c,signal);
      stage='expired';
      const expired=await exchange(unused!,'expired',send,signal);results.push(expired);expect(expired,403,'entry_proof_denied');
    }
    return json({slot:route.slot,passed:true,nativeIpMatches:true,sameSignedInputsReplay:route.slot==='A',realUnusedProofExpiry:route.slot==='A',results});
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    // Partial results contain only fixed status codes. Never expose Request,
    // proof, cookie, token, IP or exception text. Unknown means spent/no retry.
    return json({error:'validation_unknown_or_failed',stage,spent:true,retry:false,results},503);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);controller?.abort();}
}
