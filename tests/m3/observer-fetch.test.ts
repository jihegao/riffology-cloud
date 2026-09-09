import assert from 'node:assert/strict';
import test from 'node:test';
import {createObserverFetchSession,type ObserverFetchPorts} from '../../services/preview/observer-fetch.ts';
import {OBSERVER_LIMITS} from '../../services/preview/observer-protocol.ts';
const origin=`https://p-${'a'.repeat(40)}.preview.example.test`;
const policy={origin,pagePath:'/observe',statePath:'/state'};
const request=(path='/observe')=>new Request(origin+path);
const options={deadlineAt:16000};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('Observer fetch performs fresh authorization around forwarding, every body read and final result',async()=>{
 const events:string[]=[];let pulls=0;
 const session=createObserverFetchSession(policy,{
  async authorize(){events.push('authorize');return {expiresAt:16000};},
  async forward(clean,signal){events.push('forward');assert.equal(clean.url,'http://localhost:8080/observe');assert.equal(signal.aborted,false);
   return new Response(new ReadableStream<Uint8Array>({pull(c){events.push('read');if(pulls++===0)c.enqueue(new TextEncoder().encode('ok'));else c.close();}},{highWaterMark:0}));
  },
 },options,()=>1000);
 try{assert.equal(await (await session.fetch(request())).text(),'ok');
  assert.deepEqual(events,['authorize','forward','authorize','authorize','read','authorize','authorize','read','authorize','authorize']);
 }finally{session.close();}
});
test('Observer session counts cumulative requests and response bytes and aborts on excess',async()=>{
 let forwards=0;let signal:AbortSignal|undefined;
 const ports:ObserverFetchPorts={async authorize(){return {expiresAt:16000};},async forward(_r,s){signal=s;forwards++;return new Response(null,{status:204});}};
 const session=createObserverFetchSession(policy,ports,options,()=>1000);
 try{for(let i=0;i<32;i++)assert.equal((await session.fetch(request())).status,204);
  await assert.rejects(session.fetch(request()),/observer-resource-limit/);assert.equal(forwards,32);assert.equal(signal?.aborted,true);
  await assert.rejects(session.fetch(request()),/observer-resource-limit/);assert.equal(forwards,32);
 }finally{session.close();}
 let calls=0;let cancelled=0;
 // Use completed responses for the first two requests and an open final stream
 // so resource overflow must cancel its reader rather than buffer indefinitely.
 const budget=createObserverFetchSession(policy,{...ports,async forward(){calls++;if(calls<=2)return new Response(new Uint8Array(OBSERVER_LIMITS.resourceResponseBytes/2));return new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(1));},cancel(){cancelled++;}}));}},options,()=>1000);
 try{await budget.fetch(request());await budget.fetch(request());
  await assert.rejects(budget.fetch(request()),/observer-resource-limit/);assert.equal(calls,3);assert.equal(cancelled,1);
 }finally{budget.close();}
});
test('Observer rejects revoked authority while waiting for response and disposes its unread body',async()=>{
 const response=deferred<Response>(),started=deferred<void>();let revoked=false,cancelled=0;
 const session=createObserverFetchSession(policy,{async authorize(){if(revoked)throw Error('observer-access-denied');return {expiresAt:16000};},async forward(){started.resolve();return response.promise;}},options,()=>1000);
 const result=session.fetch(request());await started.promise;revoked=true;
 response.resolve(new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}})));
 try{await assert.rejects(result,/observer-access-denied/);assert.equal(cancelled,1);}finally{session.close();}
});
test('Observer rechecks authority after pending body reads before exposing bytes',async()=>{
 const reading=deferred<void>();let revoked=false,cancelled=0,bodyController!:ReadableStreamDefaultController<Uint8Array>;
 const session=createObserverFetchSession(policy,{async authorize(){if(revoked)throw Error('observer-access-denied');return {expiresAt:16000};},async forward(){return new Response(new ReadableStream<Uint8Array>({start(c){bodyController=c;},pull(){reading.resolve();},cancel(){cancelled++;}},{highWaterMark:0}));}},options,()=>1000);
 const result=session.fetch(request());await reading.promise;revoked=true;bodyController.enqueue(new TextEncoder().encode('must not escape'));
 try{await assert.rejects(result,/observer-access-denied/);assert.equal(cancelled,1);}finally{session.close();}
});
test('Observer cancellation returns promptly and disposes a late transport response',async()=>{
 const response=deferred<Response>(),started=deferred<void>(),parent=new AbortController();let cancelled=0,transportSignal!:AbortSignal;
 const session=createObserverFetchSession(policy,{async authorize(){return {expiresAt:16000};},async forward(_r,signal){transportSignal=signal;started.resolve();return response.promise;}},{...options,signal:parent.signal},()=>1000);
 const result=session.fetch(request());await started.promise;parent.abort();
 await assert.rejects(result,/observer-cancelled/);assert.equal(transportSignal.aborted,true);
 response.resolve(new Response(new ReadableStream<Uint8Array>({cancel(){cancelled++;}})));await tick();assert.equal(cancelled,1);
});
test('Observer expiry and cancellation interrupt pending authorization or body reads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const waiting=deferred<void>(),authorization=deferred<{expiresAt:number}>();let forwards=0;
 const session=createObserverFetchSession(policy,{authorize(){waiting.resolve();return authorization.promise;},async forward(){forwards++;return new Response(null);}},options,()=>1000);
 const result=session.fetch(request());await waiting.promise;t.mock.timers.tick(15000);
 await assert.rejects(result,/observer-timeout/);assert.equal(forwards,0);authorization.resolve({expiresAt:16000});
 const reading=deferred<void>(),parent=new AbortController();let cancelled=0;
 const body=createObserverFetchSession(policy,{async authorize(){return {expiresAt:16000};},async forward(){return new Response(new ReadableStream<Uint8Array>({pull(){reading.resolve();},cancel(){cancelled++;}},{highWaterMark:0}));}},{...options,signal:parent.signal},()=>1000);
 const pending=body.fetch(request());await reading.promise;parent.abort();await assert.rejects(pending,/observer-cancelled/);assert.equal(cancelled,1);
});
test('Rejected paths and already cancelled sessions never reach authority or transport',async()=>{
 let calls=0;
 const ports:ObserverFetchPorts={async authorize(){calls++;return {expiresAt:16000};},async forward(){calls++;return new Response(null);}};
 const session=createObserverFetchSession(policy,ports,options,()=>1000);
 await assert.rejects(session.fetch(request('/admin')),/observer-http-denied/);assert.equal(calls,0);
 const parent=new AbortController();parent.abort();
 const cancelled=createObserverFetchSession(policy,ports,{...options,signal:parent.signal},()=>1000);
 await assert.rejects(cancelled.fetch(request()),/observer-cancelled/);assert.equal(calls,0);
});
test('State responses are capped incrementally at 64 KiB even below the session resource budget',async()=>{
 let calls=0,cancelled=0,pulls=0;
 const session=createObserverFetchSession(policy,{async authorize(){return {expiresAt:16000};},async forward(){
  calls++;if(calls===1)return new Response(new Uint8Array(OBSERVER_LIMITS.stateBytes));
  return new Response(new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(pulls===1?OBSERVER_LIMITS.stateBytes:1));},cancel(){cancelled++;}},{highWaterMark:0}));
 }},options,()=>1000);
 try{assert.equal((await (await session.fetch(request('/state'))).arrayBuffer()).byteLength,65536);
  await assert.rejects(session.fetch(request('/state')),/observer-resource-limit/);assert.equal(pulls,2);assert.equal(cancelled,1);
 }finally{session.close();}
});
test('Zero-byte chunks count toward the aggregate response chunk budget and cancel infinite streams',async()=>{
 let calls=0,pulls=0,cancelled=0;
 const session=createObserverFetchSession(policy,{async authorize(){return {expiresAt:16000};},async forward(){
  calls++;let localChunks=0;
  return new Response(new ReadableStream<Uint8Array>({pull(c){
   if(calls===1&&localChunks===2000){c.close();return;}
   localChunks++;pulls++;c.enqueue(new Uint8Array());
  },cancel(){cancelled++;}},{highWaterMark:0}));
 }},options,()=>1000);
 try{assert.equal((await (await session.fetch(request())).arrayBuffer()).byteLength,0);
  await assert.rejects(session.fetch(request()),/observer-resource-limit/);assert.equal(pulls,OBSERVER_LIMITS.resourceChunks+1);assert.equal(cancelled,1);
 }finally{session.close();}
});
