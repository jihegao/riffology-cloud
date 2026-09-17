import test from 'node:test';
import assert from 'node:assert/strict';
import {probeProductionModels} from '../../services/model-proxy/production-models-probe.ts';
import {profile} from './production-profile-fixture.ts';
const env={PRODUCTION_MODEL_PROFILE_JSON:JSON.stringify(profile),PRODUCTION_OPENAI_API_KEY:'local-only-provider-secret',PRODUCTION_AI_GATEWAY_TOKEN:'local-only-gateway-secret'};
test('fixed native GET models only, no body, redirects observed but never followed and no inference',async()=>{
 let count=0;const result=await probeProductionModels(env,async(url,options)=>{count++;assert.equal(url,`https://gateway.ai.cloudflare.com/v1/${profile.gateway.accountId}/${profile.gateway.gatewayId}/openai/models`);assert.equal(options?.method,'GET');assert.equal(options?.redirect,'manual');assert.equal(options?.body,undefined);assert.ok(options?.signal);return Response.json({data:[{id:profile.model}]});});
 assert.equal(count,1);assert.equal(result.modelAvailable,true);assert.equal(result.inferenceCalls,0);assert.equal(result.readOnly,true);assert.doesNotMatch(JSON.stringify(result),/local-only/);
});
test('country403 white-listed diagnosis excludes raw message and headers; redirects never followed',async()=>{
 const result=await probeProductionModels(env,async()=>Response.json({error:{code:'unsupported_country_region_territory',message:'SECRET raw upstream reason'}},{status:403,headers:{'x-debug-secret':'raw'}}));
 assert.equal(result.errorCode,'region-blocked');assert.equal(result.status,403);assert.doesNotMatch(JSON.stringify(result),/SECRET|message|headers/);
 const redirect=await probeProductionModels(env,async()=>new Response('raw redirect',{status:302,headers:{location:'https://unexpected.example'}}));assert.equal(redirect.errorCode,'redirect-rejected');
});
test('body bound, malformed, missing config and thrown raw errors remain sanitized',async()=>{
 assert.equal((await probeProductionModels(env,async()=>new Response('a'.repeat(65537)))).errorCode,'response-too-large');
 assert.equal((await probeProductionModels(env,async()=>Response.json({data:'raw invalid'}))).errorCode,'malformed-response');
 let calls=0;assert.equal((await probeProductionModels({},async()=>{calls++;throw Error('must not call');})).errorCode,'configuration-unavailable');assert.equal(calls,0);
 const result=await probeProductionModels(env,async()=>{throw Error('secret-cookie raw');});assert.equal(result.errorCode,'transport-unknown');assert.doesNotMatch(JSON.stringify(result),/secret-cookie/);
 assert.equal((await probeProductionModels(env,async()=>{throw new DOMException('raw','TimeoutError');})).errorCode,'deadline');
});
