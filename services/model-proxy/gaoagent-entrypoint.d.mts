import {WorkerEntrypoint} from 'cloudflare:workers';
export interface GaoAgentModelEnv {
  GAOAGENT_MODEL_ENABLED?: string;
  PRODUCTION_MODEL_PROFILE_JSON: string;
  PRODUCTION_OPENAI_API_KEY: string;
  PRODUCTION_AI_GATEWAY_TOKEN: string;
}
export declare class GaoAgentModel extends WorkerEntrypoint<GaoAgentModelEnv> {
  fetch(request: Request): Promise<Response>;
}
