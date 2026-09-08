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
