import { createHash } from 'node:crypto';

export const PRODUCT_MODEL_PROXY_URL='https://model-proxy.riffology.internal/v1/responses';
export const PRODUCT_MODEL_INPUT_BOUND_VERSION='utf8-provider-payload-plus-4096-v1';
const ID=/^[A-Za-z0-9_-]{1,128}$/,PROVIDER=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,MODEL=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/,MAX_BODY=1_000_000;
const MEDIA_TYPES=new Set(['input_image','input_audio','input_file','image','audio','file']),MEDIA_KEYS=new Set(['image_url','file_id','input_audio','input_image','input_file']);
const encoder=new TextEncoder();
function fail(code){throw Error(code);}
function exact(value,keys,code){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(code);}
function id(value){if(typeof value!=='string'||!ID.test(value))fail('invalid-product-model-transport');return value;}
function positive(value,maximum=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(value)||value<1||value>maximum)fail('invalid-product-model-transport');return value;}
function identity(value){exact(value,['scope','sessionId','turnId','dispatchId','generation'],'invalid-product-model-transport');exact(value.scope,['tenantId','projectId','workspaceId','workspaceGeneration'],'invalid-product-model-transport');const scope={tenantId:id(value.scope.tenantId),projectId:id(value.scope.projectId),workspaceId:id(value.scope.workspaceId),workspaceGeneration:positive(value.scope.workspaceGeneration)},generation=positive(value.generation);if(generation!==scope.workspaceGeneration)fail('invalid-product-model-transport');return {scope,sessionId:id(value.sessionId),turnId:id(value.turnId),dispatchId:id(value.dispatchId),generation};}
function actor(value){exact(value,['userId','authVersion'],'invalid-product-model-transport');return {userId:id(value.userId),authVersion:positive(value.authVersion)};}
function jsonObject(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('invalid-product-model-payload');let encoded;try{encoded=JSON.stringify(value);}catch{fail('invalid-product-model-payload');}if(encoded===undefined||encoded.includes('"__proto__"')||encoder.encode(encoded).byteLength>MAX_BODY)fail('invalid-product-model-payload');return JSON.parse(encoded);}
function textOnly(value,depth=0){if(depth>32)fail('product-model-nontext-input-denied');if(Array.isArray(value)){for(const item of value)textOnly(item,depth+1);return;}if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(MEDIA_KEYS.has(key)||(key==='type'&&typeof item==='string'&&MEDIA_TYPES.has(item)))fail('product-model-nontext-input-denied');textOnly(item,depth+1);}}
function text(value,pattern){if(typeof value!=='string'||!pattern.test(value))fail('invalid-product-model-transport');return value;}
function token(identityValue,actorValue,index,purpose){return createHash('sha256').update(JSON.stringify({schemaVersion:1,purpose,identity:identityValue,actor:actorValue,index})).digest('hex').slice(0,60);}
async function requestBody(request){const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))fail('product-model-payload-too-large');const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength<1||bytes.byteLength>MAX_BODY)fail('product-model-payload-too-large');let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid-product-model-payload');}return jsonObject(parsed);}

/** Creates the release-controlled Pi payload policy and transport. It supplies
 * a non-secret placeholder credential only because the OpenAI adapter requires
 * a string; providerFetch rebuilds the request and never forwards its headers. */
export function createProductModelTransport(raw,options={}){
  exact(raw,['identity','actor','provider','model','maxInputTokensPerCall','maxOutputTokensPerCall','requestTimeoutMs'],'invalid-product-model-transport');
  const identityValue=identity(raw.identity),actorValue=actor(raw.actor),provider=text(raw.provider,PROVIDER),model=text(raw.model,MODEL),maxInputTokensPerCall=positive(raw.maxInputTokensPerCall,1_048_576),maxOutputTokensPerCall=positive(raw.maxOutputTokensPerCall,131_072),requestTimeoutMs=positive(raw.requestTimeoutMs,15*60_000),fetchImpl=options.fetchImpl??globalThis.fetch,clock=options.clock??Date.now;
  if(typeof fetchImpl!=='function'||typeof clock!=='function')fail('invalid-product-model-transport');let sequence=0;
  const executionDeadlineAt=options.executionDeadlineAt===undefined?null:positive(options.executionDeadlineAt);
  const checkDeadline=()=>{const observed=positive(clock());if(executionDeadlineAt!==null&&observed>=executionDeadlineAt)fail('product-model-execution-expired');return observed;};
  const onProviderPayload=({payload,model:selected,signal})=>{
    signal?.throwIfAborted();if(!selected||selected.provider!==provider||selected.id!==model||selected.api!=='openai-responses'||selected.baseUrl!=='https://model-proxy.riffology.internal/v1')fail('product-model-selection-conflict');
    const approved=jsonObject(payload);if(approved.model!==model||approved.stream!==true||approved.store!==false)fail('invalid-product-model-payload');for(const key of ['provider','apiKey','api_key','authorization','baseURL','base_url','background'])if(Object.hasOwn(approved,key))fail('model-provider-authority-field-denied');textOnly(approved);approved.max_output_tokens=maxOutputTokensPerCall;return approved;
  };
  const providerFetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);if(request.method!=='POST'||url.href!==PRODUCT_MODEL_PROXY_URL||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail('product-model-transport-route-denied');request.signal.throwIfAborted();checkDeadline();
    const approved=await requestBody(request);if(approved.model!==model||approved.stream!==true||approved.store!==false||approved.max_output_tokens!==maxOutputTokensPerCall)fail('product-model-payload-policy-denied');textOnly(approved);
    const payload={...approved};delete payload.model;delete payload.max_output_tokens;const payloadBytes=encoder.encode(JSON.stringify(payload)),inputTokenUpperBound=payloadBytes.byteLength+4096;if(inputTokenUpperBound>maxInputTokensPerCall)fail('product-model-input-bound-denied');
    const index=++sequence,observed=checkDeadline(),callId=`call-${token(identityValue,actorValue,index,'product-model-call')}`,requestId=`request-${token(identityValue,actorValue,index,'product-model-request')}`,relativeDeadlineAt=observed+requestTimeoutMs;if(!Number.isSafeInteger(relativeDeadlineAt))fail('invalid-product-model-transport');
    const deadlineAt=Math.min(relativeDeadlineAt,executionDeadlineAt??relativeDeadlineAt),envelope={schemaVersion:1,identity:identityValue,actor:actorValue,callId,requestId,deadlineAt,inputTokenUpperBound,inputBoundVersion:PRODUCT_MODEL_INPUT_BOUND_VERSION,maxOutputTokens:maxOutputTokensPerCall,payload};
    const body=JSON.stringify(envelope);request.signal.throwIfAborted();checkDeadline();
    return fetchImpl(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json','accept':'text/event-stream'},body,signal:request.signal});
  };
  return Object.freeze({
    resolveCredential:async(requestedProvider,{signal}={})=>{signal?.throwIfAborted();if(requestedProvider!==provider)fail('product-model-selection-conflict');return 'riffology-internal-transport';},
    onProviderPayload,
    providerFetch,
  });
}
