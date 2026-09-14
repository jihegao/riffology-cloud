import type { ProductModelProvider, ProductModelTelemetry } from './http.ts';
import type { ModelProxyHttpEnv } from './http.ts';
import { OpenAIGatewayResponsesProvider } from './openai-gateway-responses.ts';
import { productionProfile } from './production-profile.ts';
import { OpenCodeGoResponsesProvider } from './opencode-go-responses.ts';

export interface ModelProxyReleaseEnv extends ModelProxyHttpEnv{
  M2_MODEL_PROVIDER_ENABLED?:string;
  M2_MODEL_PROVIDER?:string;
  M2_MODEL_ID?:string;
  M2_OPENCODE_GO_API_KEY?:string;
  M3_VERTICAL_MODEL_TELEMETRY?:string;
  PRODUCTION_MODEL_ENABLED?:string;
  PRODUCTION_MODEL_PROFILE_JSON?:string;
  PRODUCTION_ACCEPTED_EVIDENCE_SHA256?:string;
  PRODUCTION_OPENAI_API_KEY?:string;
  PRODUCTION_AI_GATEWAY_TOKEN?:string;
}

/** Exact release gate for the first product provider. Missing, false or
 * malformed configuration returns no provider and therefore cannot reserve a
 * budget or contact OpenCode Go. */
export function productModelProvider(env:ModelProxyReleaseEnv,dependencies:{fetch?:typeof globalThis.fetch;clock?:()=>number;telemetry?:ProductModelTelemetry}={}):ProductModelProvider|null{
  if(env.M2_MODEL_PROVIDER_ENABLED!=='true')return null;
  if(env.M2_MODEL_PROVIDER==='openai'){
    try{
      if(env.PRODUCTION_MODEL_ENABLED!=='true'||!env.PRODUCTION_MODEL_BUDGET)return null;
      const profile=productionProfile(JSON.parse(env.PRODUCTION_MODEL_PROFILE_JSON??'null'));
      if(profile.model!==env.M2_MODEL_ID||profile.acceptance.evidenceSha256!==env.PRODUCTION_ACCEPTED_EVIDENCE_SHA256)return null;
      return new OpenAIGatewayResponsesProvider({profile,providerKey:env.PRODUCTION_OPENAI_API_KEY??'',gatewayKey:env.PRODUCTION_AI_GATEWAY_TOKEN??'',...dependencies});
    }catch{return null;}
  }
  if(env.M2_MODEL_PROVIDER!=='opencode-go'||typeof env.M2_MODEL_ID!=='string'||typeof env.M2_OPENCODE_GO_API_KEY!=='string')return null;
  try{return new OpenCodeGoResponsesProvider({model:env.M2_MODEL_ID,credential:env.M2_OPENCODE_GO_API_KEY,...dependencies});}catch{return null;}
}
