import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';

interface G5ReadWorkspace{recordG5ReadonlyRead(input:{scope:TurnScope;actor:TurnActor;sessionId:string;capability:string;path:string;status:number;bodySha256:string}):Promise<void>}
export type GatewayG5ReadonlyReads={record(request:Request,scope:TurnScope,actor:TurnActor,response:Response):Promise<Response>};

async function sha256(bytes:ArrayBuffer){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');}

/** Records only an explicitly opened G5 read session. The ordinary-user
 * credential is authenticated by the normal Gateway route first. */
export function createGatewayG5ReadonlyReads(env:{WORKSPACE_AGENT:{getByName(name:string):G5ReadWorkspace}}):GatewayG5ReadonlyReads{
 return {async record(request,scope,actor,response){
  const sessionId=request.headers.get('x-riffology-g5-read-session'),capability=request.headers.get('x-riffology-g5-read-capability');
  if(sessionId===null&&capability===null)return response;
  if(!sessionId||!capability)throw Error('g5-read-session-header-invalid');
  const bytes=await response.clone().arrayBuffer();
  await env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).recordG5ReadonlyRead({scope,actor,sessionId,capability,path:new URL(request.url).pathname,status:response.status,bodySha256:await sha256(bytes)});
  return response;
 }};
}
