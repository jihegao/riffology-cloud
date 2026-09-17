import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('production provider uses native Workerd fetch with its correct receiver and dispatches once', {timeout:30000}, async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {OpenAIGatewayResponsesProvider} from './services/model-proxy/openai-gateway-responses.ts';
 import {profile} from './tests/m2/production-profile-fixture.ts';
 export default {async fetch(){
  const provider=new OpenAIGatewayResponsesProvider({profile,providerKey:'synthetic-provider-key',gatewayKey:'synthetic-gateway-key'});
  const result=await provider.dispatch({provider:'openai',model:profile.model,providerSessionId:'synthetic-session',idempotencyKey:'native-fetch-test',payload:{input:'synthetic only',stream:true,store:false},inputTokenUpperBound:60,maxOutputTokens:20,deadlineAt:Date.now()+10000});
  return Response.json({status:result.status,inputTokens:result.inputTokens,outputTokens:result.outputTokens});
 }};`},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',logLevel:'silent'});
 let calls=0;
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name:'native-fetch-test',compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:async request=>{
  calls++;assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/v1/'+ 'a'.repeat(32)+'/fixture/openai/responses');
  assert.equal(request.headers.get('cf-aig-max-attempts'),'1');assert.equal(request.headers.get('x-client-request-id'),'native-fetch-test');
  assert.equal((await request.json()).store,false);
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp-native',status:'completed',usage:{input_tokens:40,output_tokens:16}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
 }}}}]});
 try{const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:200,inputTokens:40,outputTokens:16});assert.equal(calls,1);}finally{await mf.dispose();}
});
