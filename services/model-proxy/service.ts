import {probeProductionModels} from './production-models-probe.ts';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleModelProxyRequest } from './http.ts';
import { productModelProvider, type ModelProxyReleaseEnv } from './release.ts';

/** Named internal service entrypoint. The provider remains absent unless the
 * exact release gate and complete fixed OpenCode Go configuration are present. */
export class ModelProxyService extends WorkerEntrypoint<ModelProxyReleaseEnv> {
  /** Private service RPC only; does not consult or change inference gates. */
  async probeProductionModels(){
    const result=await probeProductionModels(this.env);
    const metadata=(this.env as ModelProxyReleaseEnv & {CF_VERSION_METADATA?:{id?:string}}).CF_VERSION_METADATA;
    return {...result,workerVersion:metadata?.id??null};
  }
  override fetch(request: Request): Promise<Response> {
    const telemetry=this.env.M3_VERTICAL_MODEL_TELEMETRY==='true'?(event:Record<string,unknown>)=>console.error(`vertical-model ${JSON.stringify(event)}`):undefined;
    return handleModelProxyRequest(request,this.env,productModelProvider(this.env,{telemetry}),Date.now,telemetry);
  }
}
