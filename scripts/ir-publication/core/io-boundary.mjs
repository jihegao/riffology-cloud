/** Private artifacts, bounded full responses and redacted original-write records.
 * There is no fetch, credential loader, OAuth configuration or retry here.
 */
import {open,link,unlink,mkdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {GuardError,guard} from './a2/reviewed-wire-primitives.mjs';
import {LIMITS,allowedWrite,WORKER,isId} from './fixed-target.mjs';
import {captureWorkerResponse} from './worker-response-evidence.mjs';
export {GuardError,guard};
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const safeCode=e=>e instanceof GuardError&&/^[a-z0-9-]+$/.test(e.code)?e.code:'transport-or-local-error';
export async function privateStore(directory){
  await mkdir(directory,{mode:0o700});const actual=await realpath(directory),st=await lstat(directory);
  guard(actual===resolve(directory)&&st.isDirectory()&&!st.isSymbolicLink(),'private-directory-canonical');
  const write=async(key,value)=>{
    guard(/^[a-z0-9][a-z0-9_.-]{0,180}$/.test(key),'private-artifact-name');
    const body=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
    const temporary=join(actual,'.pending-'+randomUUID()),target=join(actual,key),handle=await open(temporary,'wx',0o600);
    try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
    try{await link(temporary,target);const parent=await open(actual,'r');try{await parent.sync();}finally{await parent.close();}}finally{await unlink(temporary).catch(()=>{});}
    return {file:target,bytes:body.length,sha256:sha(body)};
  };
  return Object.freeze({directory:actual,write});
}
export function deadlineLimit(deadline,maxMs){const ms=Math.min(maxMs,deadline-Date.now());guard(Number.isFinite(ms)&&ms>0,'hard-deadline-expired');return ms;}
export async function boundedTask(task,{deadline,maxMs,signal,onLateValue}={}){
  const controller=new AbortController(),ms=deadlineLimit(deadline,maxMs);let stopped=false,timer,abort;
  const stop=(code)=>{stopped=true;controller.abort(new GuardError(code));};
  let rejectFence;const fence=new Promise((_,reject)=>{rejectFence=reject;timer=setTimeout(()=>{stop('hard-request-timeout');reject(new GuardError('hard-request-timeout'));},ms);});
  if(signal){abort=()=>{stop('parent-aborted');rejectFence(new GuardError('parent-aborted'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
  const pending=Promise.resolve().then(()=>{guard(!controller.signal.aborted,'parent-aborted');return task(controller.signal);});
  pending.then(value=>{if(stopped)Promise.resolve(onLateValue?.(value)).catch(()=>{});},()=>{});
  try{return await Promise.race([pending,fence]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export async function fullResponse(response,{maxBytes=LIMITS.maxJsonBytes,signal,captureRejected=false}={}){
  let length;
  try{guard(response instanceof Response&&!response.redirected,'full-response-object-required');guard(response.status>=200&&response.status<=(captureRejected?599:299),'api-http-rejected');guard(!signal?.aborted,'parent-aborted');length=response.headers.get('content-length');if(length!==null)guard(/^\d+$/.test(length)&&Number(length)<=maxBytes,'response-content-length-limit');}
  catch(e){try{await response?.body?.cancel?.();}catch{}throw e;}
  const reader=response.body?.getReader();guard(reader,'response-body-missing');const parts=[];let size=0;
  const abort=()=>reader.cancel().catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
  try{for(;;){guard(!signal?.aborted,'parent-aborted');const {done,value}=await reader.read();guard(!signal?.aborted,'parent-aborted');if(done)break;size+=value.byteLength;guard(size<=maxBytes,'response-body-limit');parts.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const body=Buffer.concat(parts);if(length!==null)guard(Number(length)===body.length,'response-length-incomplete');
  return {body,status:response.status,contentType:response.headers.get('content-type'),observedAt:new Date().toISOString(),sha256:sha(body)};
}
export function apiEnvelope(raw){let value;try{value=JSON.parse(raw.body);}catch{throw new GuardError('api-response-json');}
  guard(value&&value.success===true&&Object.hasOwn(value,'result')&&!value.truncated&&!value.isTruncated,'api-envelope-not-complete-success');
  return value;
}
/** Supplied owner connection alone handles auth in private memory. Never logged. */
export async function originalWrite({connection,store,key,method,path,body,contentType,credentialKind='oauth',assetSession=null,requestId,deadline,signal}){
  guard(allowedWrite(method,path,credentialKind),'fixed-write-allowlist');guard(connection&&typeof connection.request==='function','owner-connection-not-bound');
  const intent=await store.write(key+'-intent.safe.json',{schema:'riffoid-ir-original-write-intent/v1',requestId,method,path,bodyBytes:body.length,bodySha256:sha(body),contentType,credentialKind,requestedAt:new Date().toISOString(),automaticRetry:false,credentialsOrBodyNotRetained:true});
  let phase='request';
  try{
    const raw=await boundedTask(async childSignal=>{
      const response=await connection.request({method,path,body,contentType,requestId,credentialKind,assetSession,signal:childSignal});
      if(childSignal.aborted){await store.write(key+'-late-response.safe.json',{schema:'riffoid-ir-late-original-response/v1',requestId,status:response?.status??null,receivedAt:new Date().toISOString(),stopped:true,resumeOrReplay:false,bodyNotLogged:true});await response?.body?.cancel().catch(()=>{});throw new GuardError('late-response-after-stop');}
      phase='response';return method==='PUT'
        ? captureWorkerResponse(response,{store,key,requestId,intentSha256:intent.sha256,signal:childSignal})
        : fullResponse(response,{signal:childSignal,captureRejected:true});
    },{deadline,maxMs:LIMITS.writeMs,signal});
    await store.write(key+'-response.safe.json',{schema:'riffoid-ir-original-response-hash/v1',requestId,originalIntentSha256:intent.sha256,status:raw.status,observedAt:raw.observedAt,bodyBytes:raw.body.length,bodySha256:raw.sha256,bodyRetainedPrivately:method==='PUT',credentialsOrRequestBodyNotRetained:true});
    guard(raw.status>=200&&raw.status<300,'api-http-rejected');
    const envelope=apiEnvelope(raw),result=envelope.result;
    const resultId=result?.id===WORKER?WORKER:isId(result?.id)?result.id:null;
    const ack=await store.write(key+'-ack.safe.json',{schema:'riffoid-ir-known-original-ack/v1',requestId,intentSha256:intent.sha256,acknowledgedAt:raw.observedAt,status:raw.status,responseBytes:raw.body.length,responseSha256:raw.sha256,resultId,bodyRetainedPrivately:method==='PUT',credentialsOrRequestBodyNotRetained:true});
    return {result,ack,acknowledgedAt:raw.observedAt,intent,originalRequest:{requestId,method,path,bodySha256:sha(body),bodyBytes:body.length},responseSha256:raw.sha256,responseStatus:raw.status};
  }catch(e){await store.write(key+'-stopped.safe.json',{schema:'riffoid-ir-original-write-stopped/v1',requestId,phase,code:safeCode(e),outcome:'unknown-or-rejected-stop',originalIntentSha256:intent.sha256,noRetry:true,noRollback:true,noAutomaticUnlock:true});throw e;}
}
