import type { ProductModelProvider } from './http.ts';
import type { ModelProxyHttpEnv } from './http.ts';
import { OpenCodeGoResponsesProvider } from './opencode-go-responses.ts';

export interface ModelProxyReleaseEnv extends ModelProxyHttpEnv{
  M2_MODEL_PROVIDER_ENABLED?:string;
  M2_MODEL_PROVIDER?:string;
  M2_MODEL_ID?:string;
  M2_OPENCODE_GO_API_KEY?:string;
}

/** Exact release gate for the first product provider. Missing, false or
 * malformed configuration returns no provider and therefore cannot reserve a
 * budget or contact OpenCode Go. */
export function productModelProvider(env:ModelProxyReleaseEnv,dependencies:{fetch?:typeof globalThis.fetch;clock?:()=>number}={}):ProductModelProvider|null{
  if(env.M2_MODEL_PROVIDER_ENABLED!=='true')return null;
  if(env.M2_MODEL_PROVIDER!=='opencode-go'||typeof env.M2_MODEL_ID!=='string'||typeof env.M2_OPENCODE_GO_API_KEY!=='string')return null;
  try{return new OpenCodeGoResponsesProvider({model:env.M2_MODEL_ID,credential:env.M2_OPENCODE_GO_API_KEY,...dependencies});}catch{return null;}
}
