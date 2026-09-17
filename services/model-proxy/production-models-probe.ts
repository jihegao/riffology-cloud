import {productionProfile} from './production-profile.ts';
import type {ModelProxyReleaseEnv} from './release.ts';
type ProbeEnv=Pick<ModelProxyReleaseEnv,'PRODUCTION_MODEL_PROFILE_JSON'|'PRODUCTION_OPENAI_API_KEY'|'PRODUCTION_AI_GATEWAY_TOKEN'>;
type ErrorCode='configuration-unavailable'|'region-blocked'|'auth-rejected'|'rate-limited'|'provider-failure'|'redirect-rejected'|'response-too-large'|'malformed-response'|'deadline'|'transport-unknown';
export type ProductionModelsProbe={status:number|null;errorCode:ErrorCode|null;modelAvailable:boolean|null;inferenceCalls:0;readOnly:true;state:'read-only-complete'|'read-only-failed'};
const failed=(errorCode:ErrorCode,status:number|null=null):ProductionModelsProbe=>({status,errorCode,modelAvailable:null,inferenceCalls:0,readOnly:true,state:'read-only-failed'});
/** Private GET-only diagnostic. No provider inference, ledger, persistence or retry. */
export async function probeProductionModels(env:ProbeEnv,fetchImpl:typeof fetch=fetch):Promise<ProductionModelsProbe>{
 let profile,providerKey:string,gatewayKey:string;
 try{
  profile=productionProfile(JSON.parse(env.PRODUCTION_MODEL_PROFILE_JSON??'null'));
  providerKey=env.PRODUCTION_OPENAI_API_KEY??'';gatewayKey=env.PRODUCTION_AI_GATEWAY_TOKEN??'';
  for(const key of [providerKey,gatewayKey])if(key.length<16||key.length>4096||/[\r\n]/.test(key))throw Error('invalid');
 }catch{return failed('configuration-unavailable');}
 const url=`https://gateway.ai.cloudflare.com/v1/${profile.gateway.accountId}/${profile.gateway.gatewayId}/openai/models`;
 const signal=AbortSignal.timeout(10000);let status:number|null=null;
 try{
  const response=await fetchImpl(url,{method:'GET',redirect:'manual',signal,headers:{accept:'application/json',authorization:`Bearer ${providerKey}`,'cf-aig-authorization':`Bearer ${gatewayKey}`,'cf-aig-skip-cache':'true','cf-aig-collect-log-payload':'false','cf-aig-max-attempts':'1'}});
  status=response.status;
  if(response.url&&response.url!==url||status>=300&&status<400){await response.body?.cancel();return failed('redirect-rejected',status);}
  if(!response.body)return failed('malformed-response',status);
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return failed('response-too-large',status);}chunks.push(value);}}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return failed(status===401||status===403?'auth-rejected':'malformed-response',status);}
  if(status!==200){
   const code=(raw as {error?:{code?:unknown}})?.error?.code;
   if(status===403&&code==='unsupported_country_region_territory')return failed('region-blocked',status);
   return failed(status===401||status===403?'auth-rejected':status===429?'rate-limited':'provider-failure',status);
  }
  const data=(raw as {data?:unknown})?.data;if(!Array.isArray(data)||data.some(row=>!row||typeof row!=='object'||typeof row.id!=='string'))return failed('malformed-response',status);
  return {status:200,errorCode:null,modelAvailable:data.some(row=>row.id===profile.model),inferenceCalls:0,readOnly:true,state:'read-only-complete'};
 }catch(error){return failed(error instanceof DOMException&&error.name==='TimeoutError'?'deadline':'transport-unknown',status);}
}
