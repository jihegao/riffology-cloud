import { signTrustedToolRequest } from '../tools/internal-auth.ts';
import { signTrustedModelRequest } from '../model-proxy/internal-auth.ts';
import { issueModelTurnCapability } from '../model-proxy/capability.ts';
import { sandboxActorIds } from './identity.ts';
import { actor as validateActor, positive, turnDigest, turnId } from '../turn/protocol.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';

export { sandboxActorIds } from './identity.ts';

export const MODEL_PROXY_HOST='model-proxy.riffology.internal';
export const TOOL_BRIDGE_HOST='tool-bridge.riffology.internal';
export const RESEARCH_CONTEXT_HOST=TOOL_BRIDGE_HOST;
const MAX_OUTBOUND_BODY=1_100_000,encoder=new TextEncoder();
type IdentityNamespace={idFromName(name:string):{toString():string}};
export type InternalSandboxServices={
  MODEL_PROXY:Fetcher;TOOL_BRIDGE:Fetcher;TRUSTED_PI_SANDBOX:IdentityNamespace;
  M2_MODEL_PROXY_REQUEST_KEY:string;M2_TOOL_BRIDGE_REQUEST_KEY:string;M2_MODEL_TURN_CAPABILITY_KEY:string;
  M2_MODEL_BUDGET_POLICY_VERSION:string;M2_MODEL_PROVIDER:string;M2_MODEL_ID:string;
  M2_MODEL_MAX_INPUT_TOKENS_PER_CALL:string;M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL:string;M2_MODEL_CAPABILITY_TTL_MS:string;
};
type ModelInvocation={schemaVersion:1;identity:TurnRuntimeIdentity;actor:{userId:string;authVersion:number};callId:string;requestId:string;deadlineAt:number;inputTokenUpperBound:number;inputBoundVersion:string;maxOutputTokens:number;payload:Record<string,unknown>};
const PROVIDER=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,MODEL=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/;

function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error(code);}
function setting(value:unknown,maximum:number,code:string):number{if(typeof value!=='string'||!/^[1-9]\d*$/.test(value))throw Error(code);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed>maximum)throw Error(code);return parsed;}
function bounded(value:unknown,maximum:number,code:string):number{if(!Number.isSafeInteger(value)||(value as number)<1||(value as number)>maximum)throw Error(code);return value as number;}
function name(value:unknown,pattern:RegExp,code:string):string{if(typeof value!=='string'||!pattern.test(value))throw Error(code);return value;}
function jsonObject(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-model-invocation');let encoded:string;try{encoded=JSON.stringify(value);}catch{throw Error('invalid-model-invocation');}if(encoded===undefined||encoded.includes('"__proto__"'))throw Error('invalid-model-invocation');return JSON.parse(encoded) as Record<string,unknown>;}
function invocation(bytes:ArrayBuffer):ModelInvocation{
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('invalid-model-invocation');}
  exact(value,['schemaVersion','identity','actor','callId','requestId','deadlineAt','inputTokenUpperBound','inputBoundVersion','maxOutputTokens','payload'],'invalid-model-invocation');if(value.schemaVersion!==1)throw Error('invalid-model-invocation');
  return {schemaVersion:1,identity:turnRuntimeIdentity(value.identity),actor:validateActor(value.actor),callId:turnId(value.callId),requestId:turnId(value.requestId),deadlineAt:positive(value.deadlineAt),inputTokenUpperBound:bounded(value.inputTokenUpperBound,1_048_576,'invalid-model-invocation'),inputBoundVersion:turnId(value.inputBoundVersion),maxOutputTokens:bounded(value.maxOutputTokens,131_072,'invalid-model-invocation'),payload:jsonObject(value.payload)};
}
async function authorizedModelRequest(bytes:ArrayBuffer,env:InternalSandboxServices,containerId:string,requestAt:number):Promise<{body:ArrayBuffer;capability:string}>{
  const input=invocation(bytes),policyVersion=turnId(env.M2_MODEL_BUDGET_POLICY_VERSION),provider=name(env.M2_MODEL_PROVIDER,PROVIDER,'invalid-model-release-policy'),model=name(env.M2_MODEL_ID,MODEL,'invalid-model-release-policy'),maxInput=setting(env.M2_MODEL_MAX_INPUT_TOKENS_PER_CALL,1_048_576,'invalid-model-release-policy'),maxOutput=setting(env.M2_MODEL_MAX_OUTPUT_TOKENS_PER_CALL,131_072,'invalid-model-release-policy'),ttl=setting(env.M2_MODEL_CAPABILITY_TTL_MS,15*60_000,'invalid-model-release-policy');
  const trustedPiActorId=(await sandboxActorIds(input.identity.scope,input.identity.turnId,input.identity.dispatchId)).trustedPi;
  if(env.TRUSTED_PI_SANDBOX.idFromName(trustedPiActorId).toString()!==containerId)throw Error('model-invocation-container-denied');
  if(input.deadlineAt<=requestAt||input.deadlineAt>requestAt+ttl||input.inputTokenUpperBound>maxInput||input.maxOutputTokens>maxOutput)throw Error('model-invocation-limit-denied');
  const expiresAt=Math.min(input.deadlineAt,requestAt+ttl),capabilityId=`cap-${(await turnDigest({schemaVersion:1,purpose:'model-turn-capability',identity:input.identity,actor:input.actor,policyVersion,provider,model})).slice(0,60)}`;
  const capability=await issueModelTurnCapability(env.M2_MODEL_TURN_CAPABILITY_KEY,{schemaVersion:1,purpose:'product-model-turn',capabilityId,identity:input.identity,actor:input.actor,trustedPiActorId,budgetPolicyVersion:policyVersion,provider,model,maxInputTokensPerCall:maxInput,maxOutputTokensPerCall:maxOutput,issuedAt:requestAt,expiresAt},requestAt);
  const projected=encoder.encode(JSON.stringify({schemaVersion:1,callId:input.callId,requestId:input.requestId,deadlineAt:input.deadlineAt,inputTokenUpperBound:input.inputTokenUpperBound,inputBoundVersion:input.inputBoundVersion,maxOutputTokens:input.maxOutputTokens,payload:input.payload}));
  return {body:projected.buffer as ArrayBuffer,capability};
}

async function body(request:Request):Promise<ArrayBuffer>{
  const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_OUTBOUND_BODY))throw Error('sandbox-outbound-body-too-large');
  if(!request.body)return new ArrayBuffer(0);const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_OUTBOUND_BODY)throw Error('sandbox-outbound-body-too-large');chunks.push(next.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}return joined.buffer;
}
function target(request:Request):{binding:'MODEL_PROXY'|'TOOL_BRIDGE';host:string;path:string}{
  const url=new URL(request.url);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||request.method!=='POST')throw Error('sandbox-outbound-denied');
  if(url.hostname===MODEL_PROXY_HOST&&url.pathname==='/v1/responses')return {binding:'MODEL_PROXY',host:MODEL_PROXY_HOST,path:'/v1/responses'};
  if(url.hostname===TOOL_BRIDGE_HOST&&(url.pathname==='/v1/tool'||url.pathname==='/v1/research'))return {binding:'TOOL_BRIDGE',host:TOOL_BRIDGE_HOST,path:url.pathname};
  throw Error('sandbox-outbound-denied');
}
/** Outbound requests are rebuilt rather than forwarded so Pi-controlled
 * headers cannot impersonate a platform actor or smuggle ambient credentials. */
export async function trustedPiOutbound(request:Request,env:InternalSandboxServices,containerId:string,clock:()=>number=Date.now):Promise<Response>{
  const route=target(request);let payload=await body(request);if(!/^[A-Za-z0-9-]{1,128}$/.test(containerId))throw Error('invalid-sandbox-container-id');
  const headers=new Headers({'content-type':'application/json','accept':'application/json','x-riffology-sandbox-id':containerId,'x-riffology-sandbox-role':'trusted-pi'});
  const requestAt=positive(clock());headers.set('x-riffology-request-at',String(requestAt));
  if(route.binding==='TOOL_BRIDGE')headers.set('x-riffology-request-mac',await signTrustedToolRequest(env.M2_TOOL_BRIDGE_REQUEST_KEY,containerId,requestAt,payload));
  else{
    const authorized=await authorizedModelRequest(payload,env,containerId,requestAt);payload=authorized.body;
    headers.set('x-riffology-model-capability',authorized.capability);
    headers.set('x-riffology-request-mac',await signTrustedModelRequest(env.M2_MODEL_PROXY_REQUEST_KEY,containerId,requestAt,authorized.capability,payload));
  }
  const service=route.binding==='MODEL_PROXY'?env.MODEL_PROXY:env.TOOL_BRIDGE;
  return service.fetch(new Request(`https://${route.host}${route.path}`,{method:'POST',headers,body:payload}));
}
export function projectSandboxOutbound():Response{return new Response('sandbox outbound denied',{status:403,headers:{'cache-control':'no-store'}});}
