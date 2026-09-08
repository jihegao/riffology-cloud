import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_MODEL_INPUT_BOUND_VERSION, PRODUCT_MODEL_PROXY_URL, createProductModelTransport } from '../../services/trusted-pi/product-model-transport.mjs';

const now=1_800_000_000_000,identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2},actor={userId:'user-a',authVersion:3},config={identity,actor,provider:'riffology-product',model:'model-a',maxInputTokensPerCall:10000,maxOutputTokensPerCall:128,requestTimeoutMs:60000};
const selected={provider:'riffology-product',id:'model-a',api:'openai-responses',baseUrl:'https://model-proxy.riffology.internal/v1'};
function payload(){return {model:'model-a',input:[{role:'user',content:'hello'}],stream:true,store:false,max_output_tokens:32};}
function fixture(){const sent=[];return {sent,transport:createProductModelTransport(config,{clock:()=>now,fetchImpl:async(input,init)=>{sent.push(new Request(input,init));return new Response('data: [DONE]\n\n',{status:200,headers:{'content-type':'text/event-stream'}});}})};}

test('payload policy pins the selected Responses model, streaming, privacy and output bound',()=>{
  const f=fixture(),approved=f.transport.onProviderPayload({payload:payload(),model:selected,signal:new AbortController().signal});assert.deepEqual(approved,{...payload(),max_output_tokens:128});assert.equal(payload().max_output_tokens,32);
  assert.throws(()=>f.transport.onProviderPayload({payload:{...payload(),store:true},model:selected}),/payload/);assert.throws(()=>f.transport.onProviderPayload({payload:payload(),model:{...selected,id:'other'}}),/selection-conflict/);assert.throws(()=>f.transport.onProviderPayload({payload:{...payload(),provider:'attacker'},model:selected}),/authority-field/);
  assert.throws(()=>f.transport.onProviderPayload({payload:{...payload(),input:[{role:'user',content:[{type:'input_image',image_url:'https://example.test/x.png'}]}]},model:selected}),/nontext-input-denied/);
});
test('provider transport replaces SDK headers with one identity-bound platform invocation',async()=>{
  const f=fixture(),body=JSON.stringify({...payload(),max_output_tokens:128}),response=await f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer placeholder',cookie:'x=y'},body});assert.equal(response.status,200);assert.equal(f.sent.length,1);
  const sent=f.sent[0];assert.equal(sent.headers.get('authorization'),null);assert.equal(sent.headers.get('cookie'),null);assert.equal(sent.headers.get('accept'),'text/event-stream');const envelope=await sent.json();assert.deepEqual(envelope.identity,identity);assert.deepEqual(envelope.actor,actor);assert.match(envelope.callId,/^call-[a-f0-9]{60}$/);assert.match(envelope.requestId,/^request-[a-f0-9]{60}$/);assert.equal(envelope.deadlineAt,now+60000);assert.equal(envelope.inputBoundVersion,PRODUCT_MODEL_INPUT_BOUND_VERSION);assert.equal(envelope.maxOutputTokens,128);assert.equal(envelope.payload.model,undefined);assert.equal(envelope.payload.max_output_tokens,undefined);assert.equal(envelope.payload.stream,true);assert.ok(envelope.inputTokenUpperBound>=JSON.stringify(envelope.payload).length);
});
test('each SDK dispatch gets a distinct deterministic call fence and the placeholder is never exposed',async()=>{
  const f=fixture(),request={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload(),max_output_tokens:128})};assert.equal(await f.transport.resolveCredential('riffology-product'),'riffology-internal-transport');await f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,request);await f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,request);const values=await Promise.all(f.sent.map(item=>item.json()));assert.notEqual(values[0].callId,values[1].callId);assert.doesNotMatch(JSON.stringify(values),/riffology-internal-transport/);
});
test('route, final model policy, input bound and cancellation fail before internal fetch',async()=>{
  const f=fixture(),body=JSON.stringify({...payload(),max_output_tokens:128});await assert.rejects(f.transport.providerFetch('https://example.com/v1/responses',{method:'POST',headers:{'content-type':'application/json'},body}),/route-denied/);await assert.rejects(f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload(),model:'other',max_output_tokens:128})}),/policy-denied/);
  await assert.rejects(f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload(),input:[{role:'user',content:[{type:'input_file',file_id:'file-a'}]}],max_output_tokens:128})}),/nontext-input-denied/);
  const small=createProductModelTransport({...config,maxInputTokensPerCall:4096},{clock:()=>now,fetchImpl:async()=>{throw Error('must-not-fetch');}});await assert.rejects(small.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json'},body}),/input-bound-denied/);
  const controller=new AbortController();controller.abort();await assert.rejects(f.transport.providerFetch(PRODUCT_MODEL_PROXY_URL,{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal}),/abort/i);assert.equal(f.sent.length,0);
});
test('transport accepts no credential, provider URL or authority field in release input',()=>{
  assert.throws(()=>createProductModelTransport({...config,credential:'secret'}),/invalid-product-model-transport/);assert.throws(()=>createProductModelTransport({...config,provider:'../bad'}),/invalid-product-model-transport/);assert.throws(()=>createProductModelTransport({...config,requestTimeoutMs:900001}),/invalid-product-model-transport/);
});
