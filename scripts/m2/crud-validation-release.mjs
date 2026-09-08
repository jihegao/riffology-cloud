// Build-only release: copied next to the candidate, never used by Wrangler.
import { createProductTrustedPiRelease } from './release-candidate.mjs';
import { createCrudFixtureFetch } from './crud-validation-fixture.mjs';
const candidate=createProductTrustedPiRelease();
export async function resolveOptions(input){
  const fixed=await candidate.resolveOptions(input);
  return {...fixed,
    providerDefinitions:fixed.providerDefinitions.map(definition=>({...definition,config:{...definition.config,api:'openai-completions',baseUrl:'https://local-crud-fixture.invalid/v1',models:definition.config.models.map(model=>({...model,reasoning:false}))}})),
    resolveCredential:async()=> 'local-crud-fixture-credential',
    onProviderPayload:({payload})=>payload,
    providerFetch:createCrudFixtureFetch(fixed.selectedModel.id),
  };
}
