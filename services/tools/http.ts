import {authorizeWarmOutbound,type WarmAuthorityNamespace} from '../sandbox/warm-authority.ts';
import { sandboxActorIds } from '../sandbox/policy.ts';
import { normalizeToolCommandIntent, type ToolCommandIntent } from './protocol.ts';
import { toolBridgeActorName } from './identity.ts';
import { verifyTrustedToolRequest } from './internal-auth.ts';
import type { ToolCommandRecord } from './ledger.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import { workspaceAgentName } from '../workspace/protocol.ts';

const MAX_BODY=1_100_000,MAX_AGE_MS=30_000;
type Id={toString():string};
type IdentityNamespace={idFromName(name:string):Id};
type ToolBridgeStub={run(input:ToolCommandIntent):Promise<ToolCommandRecord>};
type ToolBridgeNamespace={getByName(name:string):ToolBridgeStub};
export interface ToolBridgeHttpEnv{TRUSTED_PI_SANDBOX:IdentityNamespace;TOOL_BRIDGE_AGENT:ToolBridgeNamespace;WORKSPACE_AGENT?:{getByName(name:string):{researchContext(input:{identity:TurnRuntimeIdentity;executionDeadlineAt:number}):Promise<unknown>;workspaceRuntimeAuthority?:NonNullable<ReturnType<WarmAuthorityNamespace['getByName']>['workspaceRuntimeAuthority']>}};M2_TOOL_BRIDGE_REQUEST_KEY:string}

async function readBody(request:Request):Promise<ArrayBuffer>{
  const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw Error('tool-bridge-body-too-large');
  if(!request.body)return new ArrayBuffer(0);const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_BODY)throw Error('tool-bridge-body-too-large');chunks.push(next.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}return joined.buffer;
}
function denied():Response{return Response.json({error:'tool_request_denied'},{status:403,headers:{'cache-control':'no-store'}});}

const RESEARCH_MAX_BODY = 16 * 1024;
export async function handleResearchContextRequest(request:Request,env:ToolBridgeHttpEnv,now=Date.now):Promise<Response>{
  const url=new URL(request.url);if(request.method!=='POST'||url.protocol!=='https:'||url.hostname!=='tool-bridge.riffology.internal'||url.pathname!=='/v1/research'||url.search||url.hash)return new Response('not found',{status:404});
  if(request.headers.get('content-type')!=='application/json'||request.headers.get('x-riffology-sandbox-role')!=='trusted-pi')return denied();
  let body:ArrayBuffer,identity:TurnRuntimeIdentity,deadline:number,containerId:string,requestAt:number;
  try{body=await readBody(request);if(body.byteLength>RESEARCH_MAX_BODY)throw Error('research-context-too-large');containerId=request.headers.get('x-riffology-sandbox-id')??'';const rawAt=request.headers.get('x-riffology-request-at')??'';if(!/^\d+$/.test(rawAt))throw Error('invalid-research-time');requestAt=Number(rawAt);const observed=now();if(!Number.isSafeInteger(observed)||Math.abs(observed-requestAt)>MAX_AGE_MS)throw Error('expired-research-request');await verifyTrustedToolRequest(env.M2_TOOL_BRIDGE_REQUEST_KEY,containerId,requestAt,body,request.headers.get('x-riffology-request-mac')??'');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'identity')||!Object.hasOwn(value,'executionDeadlineAt'))throw Error('invalid-research-context');identity=turnRuntimeIdentity(value.identity);deadline=value.executionDeadlineAt;if(!Number.isSafeInteger(deadline)||deadline<=requestAt||deadline>requestAt+15*60_000)throw Error('research-context-deadline-denied');const trustedActor=(await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId)).trustedPi;if(env.TRUSTED_PI_SANDBOX.idFromName(trustedActor).toString()!==containerId)await authorizeWarmOutbound(env,{purpose:'research',scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId,sessionId:identity.sessionId,containerId,deadlineAt:deadline},now);if(!env.WORKSPACE_AGENT?.getByName)throw Error('research-context-workspace-unavailable');}
  catch{return denied();}
  try{const value=await env.WORKSPACE_AGENT!.getByName(workspaceAgentName(identity.scope.tenantId,identity.scope.workspaceId)).researchContext({identity,executionDeadlineAt:deadline});const encoded=JSON.stringify(value);if(!encoded||new TextEncoder().encode(encoded).byteLength>65536)throw Error('research-context-too-large');return Response.json(value,{headers:{'cache-control':'no-store'}});}catch(error){const code=error instanceof Error&&/^project-resource-[a-z-]+$/.test(error.message)?error.message:'research_context_unavailable';return Response.json({error:code},{status:503,headers:{'cache-control':'no-store'}});}
}

/** Internal service-binding handler. It accepts identity only from the Sandbox
 * outbound interceptor and verifies that the observed DO id is the named
 * Trusted Pi actor derived from the command itself. */
export async function handleToolBridgeRequest(request:Request,env:ToolBridgeHttpEnv,now=Date.now):Promise<Response>{
  const url=new URL(request.url);if(request.method!=='POST'||url.protocol!=='https:'||url.hostname!=='tool-bridge.riffology.internal'||url.pathname!=='/v1/tool'||url.search||url.hash)return new Response('not found',{status:404});
  if(request.headers.get('content-type')!=='application/json'||request.headers.get('x-riffology-sandbox-role')!=='trusted-pi')return denied();
  let body:ArrayBuffer,command:ToolCommandIntent,containerId:string,requestAt:number;
  try{
    body=await readBody(request);containerId=request.headers.get('x-riffology-sandbox-id')??'';const rawAt=request.headers.get('x-riffology-request-at')??'';
    if(!/^\d+$/.test(rawAt))throw Error('invalid-tool-bridge-time');requestAt=Number(rawAt);const observed=now();if(!Number.isSafeInteger(observed)||Math.abs(observed-requestAt)>MAX_AGE_MS)throw Error('expired-tool-bridge-request');
    await verifyTrustedToolRequest(env.M2_TOOL_BRIDGE_REQUEST_KEY,containerId,requestAt,body,request.headers.get('x-riffology-request-mac')??'');
    command=normalizeToolCommandIntent(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));
    const trustedActor=(await sandboxActorIds(command.scope,command.turnId,command.dispatchId)).trustedPi;
    if(env.TRUSTED_PI_SANDBOX.idFromName(trustedActor).toString()!==containerId)await authorizeWarmOutbound(env,{purpose:'tool',scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,containerId,deadlineAt:command.executionDeadlineAt},now);
  }catch{return denied();}
  try{
    const bridge=env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(command.scope,command.turnId,command.dispatchId));
    return Response.json(await bridge.run(command),{headers:{'cache-control':'no-store'}});
  }catch(error){
    const code=error instanceof Error?error.message:'tool-bridge-failed';
    if(code==='tool-idempotency-conflict'||code==='tool-turn-active-command')return Response.json({error:code},{status:409,headers:{'cache-control':'no-store'}});
    return Response.json({error:'tool_bridge_failed'},{status:500,headers:{'cache-control':'no-store'}});
  }
}
