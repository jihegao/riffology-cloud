import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleModelProxyRequest } from './http.ts';
import { productModelProvider, type ModelProxyReleaseEnv } from './release.ts';

/** Named internal service entrypoint. The provider remains absent unless the
 * exact release gate and complete fixed OpenCode Go configuration are present. */
export class ModelProxyService extends WorkerEntrypoint<ModelProxyReleaseEnv> {
  override fetch(request: Request): Promise<Response> {
    const telemetry=this.env.M3_VERTICAL_MODEL_TELEMETRY==='true'?(event:Record<string,unknown>)=>console.error(`vertical-model ${JSON.stringify(event)}`):undefined;
    return handleModelProxyRequest(request,this.env,productModelProvider(this.env,{telemetry}),Date.now,telemetry);
  }
}
