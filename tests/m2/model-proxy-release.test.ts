import assert from 'node:assert/strict';
import test from 'node:test';
import { productModelProvider, type ModelProxyReleaseEnv } from '../../services/model-proxy/release.ts';

const base={M2_MODEL_PROVIDER:'opencode-go',M2_MODEL_ID:'gpt-5.6-luna',M2_OPENCODE_GO_API_KEY:'test-only-opencode-go-credential'};
test('product provider stays absent unless the exact release flag and complete fixed configuration are present',()=>{
  for(const env of [{...base},{...base,M2_MODEL_PROVIDER_ENABLED:'false'},{...base,M2_MODEL_PROVIDER_ENABLED:'TRUE'},{...base,M2_MODEL_PROVIDER_ENABLED:'true',M2_MODEL_PROVIDER:'other'},{...base,M2_MODEL_PROVIDER_ENABLED:'true',M2_OPENCODE_GO_API_KEY:undefined}])assert.equal(productModelProvider(env as unknown as ModelProxyReleaseEnv),null);
  assert.ok(productModelProvider({...base,M2_MODEL_PROVIDER_ENABLED:'true'} as unknown as ModelProxyReleaseEnv,{fetch:async()=>{throw Error('must-not-call');}}));
});
test('provider gate returns no credential material or ambient fallback',()=>{
  const provider=productModelProvider({...base,M2_MODEL_PROVIDER_ENABLED:'true'} as unknown as ModelProxyReleaseEnv,{fetch:async()=>{throw Error('must-not-call');}});assert.ok(provider);assert.deepEqual(Object.keys(provider),[]);assert.doesNotMatch(JSON.stringify(provider),/test-only-opencode/);
});

test('production release requires explicit accepted profile and private budget binding',async()=>{
 const {profile}=await import('./production-profile-fixture.ts');
 const ready={M2_MODEL_PROVIDER_ENABLED:'true',M2_MODEL_PROVIDER:'openai',M2_MODEL_ID:profile.model,PRODUCTION_MODEL_ENABLED:'true',PRODUCTION_MODEL_PROFILE_JSON:JSON.stringify(profile),PRODUCTION_ACCEPTED_EVIDENCE_SHA256:profile.acceptance.evidenceSha256,PRODUCTION_OPENAI_API_KEY:'test-only-openai-secret',PRODUCTION_AI_GATEWAY_TOKEN:'test-only-gateway-token',PRODUCTION_MODEL_BUDGET:{getByName(){throw Error('not-called');}}};
 for(const patch of [{PRODUCTION_MODEL_ENABLED:'false'},{PRODUCTION_MODEL_PROFILE_JSON:'{}'},{PRODUCTION_ACCEPTED_EVIDENCE_SHA256:'wrong'},{PRODUCTION_OPENAI_API_KEY:''},{PRODUCTION_MODEL_BUDGET:undefined},{M2_MODEL_ID:'unaccepted-model'}])assert.equal(productModelProvider({...ready,...patch} as unknown as ModelProxyReleaseEnv),null);
 const p=productModelProvider(ready as unknown as ModelProxyReleaseEnv);assert.ok(p);assert.equal(p.productionProfile?.model,profile.model);assert.doesNotMatch(JSON.stringify(p),/test-only/);
});
