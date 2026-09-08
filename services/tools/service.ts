import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleToolBridgeRequest, type ToolBridgeHttpEnv } from './http.ts';

/** Named internal service entrypoint. It is reachable only through a Worker
 * service binding; the public/default fetch handler does not expose /v1/tool. */
export class ToolBridgeService extends WorkerEntrypoint<ToolBridgeHttpEnv>{
  override fetch(request:Request):Promise<Response>{return handleToolBridgeRequest(request,this.env);}
}
