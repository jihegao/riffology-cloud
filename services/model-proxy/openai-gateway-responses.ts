import type { ProductModelProvider, ProductModelProviderInput, ProductModelProviderResult } from './http.ts';
import { productionEndpoint, productionProfile, type ProductionProfile } from './production-profile.ts';
const encoder=new TextEncoder(),externalId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export type ProductionFailure = 'rejected-auth'|'rate-limited'|'provider-failure'|'deadline'|'cancelled'|'malformed-stream'|'missing-usage'|'outcome-unknown';
export function productionFailure(error:unknown):ProductionFailure {
  if(error instanceof DOMException)return error.name==='TimeoutError'?'deadline':error.name==='AbortError'?'cancelled':'outcome-unknown';
  const value=error instanceof Error?error.message:'';return ['rejected-auth','rate-limited','provider-failure','deadline','cancelled','malformed-stream','missing-usage'].includes(value)?value as ProductionFailure:'outcome-unknown';
}
export const productionHttpFailure=(status:number):ProductionFailure=>status===401||status===403?'rejected-auth':status===429?'rate-limited':'provider-failure';
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('malformed-stream');return v as Record<string,unknown>;}
function usage(bytes:Uint8Array,input:ProductModelProviderInput){
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('malformed-stream');}
 // Truncated terminal frames must not become authoritative merely because the
 // partial buffer happens to parse as JSON.
 if(!text.endsWith('\n\n')&&!text.endsWith('\r\n\r\n'))throw Error('malformed-stream');
 let terminal:{inputTokens:number;outputTokens:number;id:string}|null=null,done=false;
 for(const frame of text.replaceAll('\r\n','\n').split(/\n\n+/u)){
  if(encoder.encode(frame).byteLength>256*1024)throw Error('malformed-stream');
  const data=frame.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(!data)continue;
  if(data==='[DONE]'){if(!terminal||done)throw Error('malformed-stream');done=true;continue;}
  if(done||terminal)throw Error('malformed-stream');let row:Record<string,unknown>;try{row=object(JSON.parse(data));}catch{throw Error('malformed-stream');}
  if(typeof row.type!=='string'||!row.type.startsWith('response.'))throw Error('malformed-stream');
  if(row.type==='response.failed')throw Error('provider-failure');
  if(row.type!=='response.completed'&&row.type!=='response.incomplete')continue;
  const response=object(row.response);if(!response.usage)throw Error('missing-usage');const receipt=object(response.usage);
  if(typeof response.id!=='string'||!externalId.test(response.id)||response.status!==(row.type==='response.completed'?'completed':'incomplete'))throw Error('malformed-stream');
  const a=receipt.input_tokens,b=receipt.output_tokens;if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||(a as number)<0||(b as number)<0||(a as number)>input.inputTokenUpperBound||(b as number)>input.maxOutputTokens)throw Error('missing-usage');
  terminal={inputTokens:a as number,outputTokens:b as number,id:response.id};
 }
 if(!terminal)throw Error('missing-usage');return terminal;
}
/** Buffered, dispatch-once adapter. Custom tools remain in Trusted Pi. No SDK,
 * redirects, retry, fallback, Gateway cache or provider session header. */
export class OpenAIGatewayResponsesProvider implements ProductModelProvider {
 readonly productionProfile:ProductionProfile; readonly #providerKey:string;readonly #gatewayKey:string;readonly #fetch:typeof fetch;readonly #now:()=>number;
 constructor(options:{profile:ProductionProfile;providerKey:string;gatewayKey:string;fetch?:typeof fetch;clock?:()=>number}){
  this.productionProfile=productionProfile(options.profile);
  for(const key of [options.providerKey,options.gatewayKey])if(typeof key!=='string'||key.length<16||key.length>4096||/[\r\n]/.test(key))throw Error('invalid-production-secrets');
  this.#providerKey=options.providerKey;this.#gatewayKey=options.gatewayKey;this.#fetch=options.fetch??fetch;this.#now=options.clock??Date.now;
 }
 async dispatch(input:ProductModelProviderInput):Promise<ProductModelProviderResult>{
  if(input.provider!=='openai'||input.model!==this.productionProfile.model||!externalId.test(input.idempotencyKey)||input.deadlineAt<=this.#now())throw Error('rejected-auth');
  if(!Number.isSafeInteger(input.inputTokenUpperBound)||input.inputTokenUpperBound<1||input.inputTokenUpperBound>this.productionProfile.limits.maxInputTokens||!Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<16||input.maxOutputTokens>this.productionProfile.limits.maxOutputTokens)throw Error('rejected-auth');
  const payload=object(input.payload);if(payload.stream!==true||payload.store!==false)throw Error('rejected-auth');
  // Hosted tools, server-side conversations and background execution have
  // additional billable/retention behavior outside this token-only profile.
  const allowed=new Set(['input','instructions','tools','tool_choice','parallel_tool_calls','reasoning','text','temperature','top_p','stream','store','include','prompt_cache_key','prompt_cache_retention','service_tier']);
  if(Object.keys(payload).some(k=>!allowed.has(k)))throw Error('rejected-auth');
  if(payload.service_tier!==undefined&&payload.service_tier!=='default'||payload.prompt_cache_retention!==undefined&&payload.prompt_cache_retention!=='in_memory')throw Error('rejected-auth');
  const visit=(v:unknown):void=>{if(Array.isArray(v)){for(const item of v)visit(item);}else if(v&&typeof v==='object'){for(const [k,item] of Object.entries(v)){if(['image_url','file_id','input_audio','input_image','input_file'].includes(k)||k==='type'&&['input_image','input_audio','input_file','image','audio','file'].includes(String(item)))throw Error('rejected-auth');visit(item);}}};visit(payload.input);
  if(payload.tools!==undefined&&(!Array.isArray(payload.tools)||payload.tools.some(t=>object(t).type!=='function')))throw Error('rejected-auth');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('deadline','TimeoutError')),input.deadlineAt-this.#now()),signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal;
  try{
   signal.throwIfAborted();
   const response=await this.#fetch(productionEndpoint(this.productionProfile),{method:'POST',redirect:'manual',signal,headers:{'content-type':'application/json',accept:'text/event-stream',authorization:`Bearer ${this.#providerKey}`,'cf-aig-authorization':`Bearer ${this.#gatewayKey}`,'cf-aig-skip-cache':'true','cf-aig-collect-log-payload':'false','cf-aig-max-attempts':'1','x-client-request-id':input.idempotencyKey},body:JSON.stringify({...payload,prompt_cache_key:undefined,prompt_cache_retention:'in_memory',service_tier:'default',model:this.productionProfile.model,max_output_tokens:input.maxOutputTokens})});
   const headerId=response.headers.get('x-request-id');
   if(response.status<200||response.status>=300){await response.body?.cancel();return {status:response.status,providerRequestId:headerId&&externalId.test(headerId)?headerId:null,inputTokens:null,outputTokens:null,responseContentType:'application/json',responseBody:encoder.encode(JSON.stringify({error:productionHttpFailure(response.status)}))};}
   if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream'||!response.body)throw Error('malformed-stream');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   const abort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{for(;;){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>1_000_000)throw Error('malformed-stream');chunks.push(next.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{signal.removeEventListener('abort',abort);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}const evidence=usage(bytes,input);
   return {status:response.status,providerRequestId:headerId&&externalId.test(headerId)?headerId:evidence.id,inputTokens:evidence.inputTokens,outputTokens:evidence.outputTokens,responseContentType:'text/event-stream',responseBody:bytes};
  }finally{clearTimeout(timer);}
 }
}
