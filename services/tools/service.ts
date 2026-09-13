import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleResearchContextRequest, handleToolBridgeRequest, type ToolBridgeHttpEnv } from './http.ts';

/** Named internal service entrypoint. It is reachable only through a Worker
 * service binding; the public/default fetch handler does not expose /v1/tool. */
export class ToolBridgeService extends WorkerEntrypoint<ToolBridgeHttpEnv>{
  override fetch(request:Request):Promise<Response>{return new URL(request.url).pathname==='/v1/research'?handleResearchContextRequest(request,this.env):handleToolBridgeRequest(request,this.env);}
}
