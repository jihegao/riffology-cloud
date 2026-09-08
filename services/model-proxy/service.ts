import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleModelProxyRequest } from './http.ts';
import { productModelProvider, type ModelProxyReleaseEnv } from './release.ts';

/** Named internal service entrypoint. The provider remains absent unless the
 * exact release gate and complete fixed OpenCode Go configuration are present. */
export class ModelProxyService extends WorkerEntrypoint<ModelProxyReleaseEnv> {
  override fetch(request: Request): Promise<Response> { return handleModelProxyRequest(request, this.env, productModelProvider(this.env)); }
}
