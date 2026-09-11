import { sandboxActorIds } from '../sandbox/policy.ts';
import { normalizeToolCommandIntent, type ToolCommandIntent } from './protocol.ts';
import { toolBridgeActorName } from './identity.ts';
import { verifyTrustedToolRequest } from './internal-auth.ts';
import type { ToolCommandRecord } from './ledger.ts';

const MAX_BODY=1_100_000,MAX_AGE_MS=30_000;
type Id={toString():string};
type IdentityNamespace={idFromName(name:string):Id};
type ToolBridgeStub={run(input:ToolCommandIntent):Promise<ToolCommandRecord>};
type ToolBridgeNamespace={getByName(name:string):ToolBridgeStub};
export interface ToolBridgeHttpEnv{TRUSTED_PI_SANDBOX:IdentityNamespace;TOOL_BRIDGE_AGENT:ToolBridgeNamespace;M2_TOOL_BRIDGE_REQUEST_KEY:string}

async function readBody(request:Request):Promise<ArrayBuffer>{
  const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw Error('tool-bridge-body-too-large');
  if(!request.body)return new ArrayBuffer(0);const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>MAX_BODY)throw Error('tool-bridge-body-too-large');chunks.push(next.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}return joined.buffer;
}
function denied():Response{return Response.json({error:'tool_request_denied'},{status:403,headers:{'cache-control':'no-store'}});}

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
    if(env.TRUSTED_PI_SANDBOX.idFromName(trustedActor).toString()!==containerId)throw Error('tool-bridge-container-scope-denied');
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
