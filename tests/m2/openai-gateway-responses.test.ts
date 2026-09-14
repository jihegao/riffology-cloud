import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIGatewayResponsesProvider } from '../../services/model-proxy/openai-gateway-responses.ts';
import { profile } from './production-profile-fixture.ts';
const encode=new TextEncoder();
const terminal=(usage:unknown={input_tokens:40,output_tokens:16},type='response.completed')=>`data: ${JSON.stringify({type,response:{id:'resp-fixture',status:type==='response.completed'?'completed':'incomplete',usage}})}\n\n`;
const input=()=>({provider:'openai',model:profile.model,providerSessionId:'ses_should_not_leave',idempotencyKey:'request-a',payload:{input:[{role:'user',content:'hi'}],tools:[{type:'function',name:'inspect',parameters:{type:'object'}}],stream:true,store:false,prompt_cache_key:'private-session'},inputTokenUpperBound:60,maxOutputTokens:20,deadlineAt:Date.now()+1000});
const provider=(f:typeof fetch)=>new OpenAIGatewayResponsesProvider({profile,providerKey:'test-provider-secret',gatewayKey:'test-gateway-secret',fetch:f});
test('Gateway uses exact fixed endpoint, private keys, no cache/retry/session leakage; split SSE bytes preserved',async()=>{
 let calls=0;const bytes=encode.encode('data: {"type":"response.output_item.added","item":{"type":"function_call","name":"inspect","call_id":"call-1","arguments":"{}"}}\n\n'+terminal());
 const p=provider(async(url,init)=>{calls++;assert.equal(url,'https://gateway.ai.cloudflare.com/v1/'+ 'a'.repeat(32)+'/fixture/openai/responses');const h=new Headers(init!.headers);assert.equal(h.get('authorization'),'Bearer test-provider-secret');assert.equal(h.get('cf-aig-authorization'),'Bearer test-gateway-secret');assert.equal(h.get('cf-aig-skip-cache'),'true');assert.equal(h.get('cf-aig-max-attempts'),'1');assert.equal(h.get('cf-aig-collect-log-payload'),'false');assert.equal(h.has('x-opencode-session'),false);assert.equal(init!.redirect,'manual');const body=JSON.parse(String(init!.body));assert.equal(body.service_tier,'default');assert.equal(body.prompt_cache_key,undefined);assert.equal(body.model,profile.model);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream','x-request-id':'upstream-1'}});});
 const result=await p.dispatch(input());assert.deepEqual(result.responseBody,bytes);assert.equal(result.inputTokens,40);assert.equal(result.providerRequestId,'upstream-1');assert.equal(calls,1);
});
for(const status of [401,403,429,500,503])test(`Gateway sanitizes ${status} and never retries`,async()=>{
 let count=0;const result=await provider(async()=>{count++;return new Response('secret raw upstream text',{status});}).dispatch(input());assert.equal(result.status,status);assert.equal(count,1);assert.equal(result.inputTokens,null);assert.doesNotMatch(new TextDecoder().decode(result.responseBody),/secret|raw/);
});
for(const [body,error] of [[terminal(null),'missing-usage'],[terminal({input_tokens:40,output_tokens:100}),'missing-usage'],['data: nope\n\n','malformed-stream'],[terminal().trim(),'malformed-stream'],[terminal()+terminal(),'malformed-stream'],['data: {"type":"response.failed"}\n\n','provider-failure']] as const)test(`Gateway rejects untrusted terminal ${error}: ${body.slice(0,30)}`,async()=>{await assert.rejects(provider(async()=>new Response(body,{headers:{'content-type':'text/event-stream'}})).dispatch(input()),new RegExp(error));});
test('incomplete execution still carries verified billing usage',async()=>{assert.equal((await provider(async()=>new Response(terminal(undefined,'response.incomplete'),{headers:{'content-type':'text/event-stream'}})).dispatch(input())).outputTokens,16);});
test('cancel before dispatch makes no call; stalled body deadline cancels reader',async()=>{
 let calls=0,cancelled=false;const p=provider(async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});});const c=new AbortController();c.abort();await assert.rejects(p.dispatch({...input(),signal:c.signal}),/abort/i);assert.equal(calls,0);await assert.rejects(p.dispatch({...input(),deadlineAt:Date.now()+20}),/deadline/);assert.equal(calls,1);assert.equal(cancelled,true);
});
test('hosted tools, media, paid tier and extended retention denied before fetch',async()=>{
 let calls=0;const p=provider(async()=>{calls++;throw Error('unexpected');});for(const patch of [{tools:[{type:'web_search'}]},{input:[{type:'input_image',image_url:'x'}]},{service_tier:'priority'},{prompt_cache_retention:'24h'},{previous_response_id:'resp-1'}])await assert.rejects(p.dispatch({...input(),payload:{...input().payload,...patch}}),/rejected-auth/);assert.equal(calls,0);
});
