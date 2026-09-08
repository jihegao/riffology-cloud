import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENCODE_GO_RESPONSES_URL, OpenCodeGoResponsesProvider, openCodeGoResponsesLimits } from '../../services/model-proxy/opencode-go-responses.ts';
import type { ProductModelProviderInput } from '../../services/model-proxy/http.ts';

const now=1_800_000_000_000,secret='test-only-opencode-go-credential',input:ProductModelProviderInput={provider:'opencode-go',model:'gpt-5.6-luna',idempotencyKey:'request-a',payload:{input:[{role:'user',content:'hello'}],stream:true,store:false},inputTokenUpperBound:100,maxOutputTokens:20,deadlineAt:now+60_000};
function terminal(kind:'completed'|'incomplete'='completed',overrides:Record<string,unknown>={}){const type=`response.${kind}`;return `event: response.created\ndata: {"type":"response.created","response":{"id":"resp_a"}}\n\nevent: ${type}\ndata: ${JSON.stringify({type,response:{id:'resp_a',usage:{input_tokens:7,output_tokens:3},...overrides}})}\n\ndata: [DONE]\n\n`;}
function completed(overrides:Record<string,unknown>={}){return terminal('completed',overrides);}
function fixture(response:()=>Promise<Response>|Response){const calls:Array<{url:string;init:RequestInit}>=[];return {calls,provider:new OpenCodeGoResponsesProvider({model:'gpt-5.6-luna',credential:secret,clock:()=>now,fetch:async(url,init)=>{calls.push({url:String(url),init:init!});return response();}})};}

test('fixed adapter rebuilds one OpenCode Go request and returns byte-identical verified SSE',async()=>{
  const text=completed(),f=fixture(()=>new Response(text,{status:200,headers:{'content-type':'text/event-stream; charset=utf-8','x-request-id':'provider-request-a'}})),result=await f.provider.dispatch(input);assert.equal(f.calls.length,1);const sent=f.calls[0]!;assert.equal(sent.url,OPENCODE_GO_RESPONSES_URL);assert.equal(sent.init.method,'POST');assert.equal(sent.init.redirect,'manual');const headers=new Headers(sent.init.headers);assert.deepEqual(Object.fromEntries(headers.entries()),{accept:'text/event-stream',authorization:`Bearer ${secret}`,'content-type':'application/json','x-client-request-id':'request-a'});assert.deepEqual(JSON.parse(sent.init.body as string),{...input.payload,model:'gpt-5.6-luna',max_output_tokens:20});
  assert.equal(result.status,200);assert.equal(result.providerRequestId,'provider-request-a');assert.equal(result.inputTokens,7);assert.equal(result.outputTokens,3);assert.equal(result.responseContentType,'text/event-stream');assert.equal(new TextDecoder().decode(result.responseBody),text);assert.doesNotMatch(new TextDecoder().decode(result.responseBody),new RegExp(secret));
});
test('terminal response id is correlation fallback and incomplete terminal usage remains accountable',async()=>{
  const f=fixture(()=>new Response(terminal('incomplete',{id:'resp_incomplete'}),{status:200,headers:{'content-type':'text/event-stream'}})),result=await f.provider.dispatch(input);assert.equal(result.providerRequestId,'resp_incomplete');assert.equal(result.inputTokens,7);assert.equal(result.outputTokens,3);
});
test('provider HTTP errors are consumed and replaced with a generic response',async()=>{
  const f=fixture(()=>new Response('sensitive account detail',{status:429,headers:{'content-type':'application/json','x-request-id':'provider-reject-a'}})),result=await f.provider.dispatch(input);assert.equal(result.status,429);assert.equal(result.providerRequestId,'provider-reject-a');assert.equal(result.inputTokens,null);assert.equal(result.outputTokens,null);assert.deepEqual(JSON.parse(new TextDecoder().decode(result.responseBody)),{error:'provider_rejected',status:429});assert.doesNotMatch(new TextDecoder().decode(result.responseBody),/sensitive/);
});
test('missing, conflicting or excessive terminal evidence fails closed',async()=>{
  const candidates=[
    'data: {"type":"response.created","response":{"id":"resp_a"}}\n\ndata: [DONE]\n\n',
    completed({usage:{input_tokens:101,output_tokens:3}}),completed({usage:{input_tokens:7,output_tokens:21}}),
    completed()+completed(),
    'data: {bad json}\n\n',
  ];
  for(const text of candidates){const f=fixture(()=>new Response(text,{status:200,headers:{'content-type':'text/event-stream'}}));await assert.rejects(f.provider.dispatch(input),/opencode-go-response/);}
});
test('wrong authority, payload policy and oversized response fail before a usable result',async()=>{
  let calls=0;const provider=new OpenCodeGoResponsesProvider({model:'gpt-5.6-luna',credential:secret,clock:()=>now,fetch:async()=>{calls++;return new Response(completed(),{headers:{'content-type':'text/event-stream'}});}});
  for(const value of [{...input,provider:'other'},{...input,model:'other'},{...input,payload:{...input.payload,model:'other'}},{...input,payload:{...input.payload,stream:false}},{...input,maxOutputTokens:15}])await assert.rejects(provider.dispatch(value as ProductModelProviderInput),/request-denied/);assert.equal(calls,0);
  const oversized=fixture(()=>new Response(new Uint8Array(openCodeGoResponsesLimits.maxDefaultResponseBytes+1),{headers:{'content-type':'text/event-stream'}}));await assert.rejects(oversized.provider.dispatch(input),/too-large/);
});
test('absolute provider deadline aborts a pending fetch',async()=>{
  const provider=new OpenCodeGoResponsesProvider({model:'gpt-5.6-luna',credential:secret,clock:()=>now,fetch:async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}))});
  await assert.rejects(provider.dispatch({...input,deadlineAt:now+10}),/deadline|timeout/i);
});
test('release constructor rejects malformed fixed model, credential and response bounds',()=>{
  assert.throws(()=>new OpenCodeGoResponsesProvider({model:'../bad',credential:secret}),/release/);assert.throws(()=>new OpenCodeGoResponsesProvider({model:'gpt-5.6-luna',credential:'short'}),/release/);assert.throws(()=>new OpenCodeGoResponsesProvider({model:'gpt-5.6-luna',credential:secret,maxResponseBytes:100}),/release/);
});
