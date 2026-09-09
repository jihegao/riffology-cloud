import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardRunningObserver} from '../../services/run/observer-forward.ts';
const policy={origin:`https://p-${'a'.repeat(40)}.riff-demo.gaojihe.cn`,pagePath:'/page',statePath:'/state'};
const req=(path='/page',init?:RequestInit)=>new Request('http://localhost:8080'+path,init);
function fixture(fetch:(request:Request)=>Promise<Response>=async()=>new Response('ok')){
 let calls=0;const container={running:true,getTcpPort(port:number){assert.equal(port,8080);calls++;return {fetch};}};
 return {container,get calls(){return calls;}};
}
test('private Observer port rebuilds marker, removes caller credentials and filters response',async()=>{
 const f=fixture(async r=>{assert.equal(r.url,'http://localhost:8080/page');assert.equal(r.redirect,'manual');assert.deepEqual([...r.headers],[['accept','text/html'],['x-riff-observer','read-only']]);return new Response('ok',{headers:{'set-cookie':'secret','content-type':'text/html','x-secret':'no'}});});
 const response=await forwardRunningObserver(f.container,req('/page',{headers:{cookie:'secret',authorization:'secret','x-riff-observer':'write'}}),policy,Date.now()+1000);
 assert.equal(await response.text(),'ok');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-secret'),null);assert.equal(f.calls,1);
});
test('private port rejects paths, writes, Upgrade and invalid policy before port access',async()=>{
 const f=fixture();for(const request of [req('/other'),req('/page?x=1'),req('/page',{method:'POST',body:'x'}),req('/page',{headers:{upgrade:'websocket'}}),new Request(policy.origin+'/page')])await assert.rejects(forwardRunningObserver(f.container,request,policy,Date.now()+1000));
 await assert.rejects(forwardRunningObserver(f.container,req(),{...policy,statePath:'/page'},Date.now()+1000));assert.equal(f.calls,0);
});
test('missing or stopped container and invalid deadlines never obtain a port',async()=>{
 const f=fixture();f.container.running=false;await assert.rejects(forwardRunningObserver(f.container,req(),policy,Date.now()+1000));await assert.rejects(forwardRunningObserver(undefined,req(),policy,Date.now()+1000));f.container.running=true;
 for(const deadline of [Date.now()-1,Date.now()+20000,NaN])await assert.rejects(forwardRunningObserver(f.container,req(),policy,deadline));assert.equal(f.calls,0);
});
test('synchronous native failures reject cleanly',async()=>{
 for(const container of [{running:true,getTcpPort(){throw Error('port');}},{running:true,getTcpPort(){return {fetch(){throw Error('fetch');}};}}])await assert.rejects(forwardRunningObserver(container,req(),policy,Date.now()+100),/port|fetch/);
});
test('deadline rejects pending fetch and disposes its late body',async()=>{
 let resolve!:(r:Response)=>void,cancelled=false;
 const f=fixture(()=>new Promise(r=>{resolve=r;}));const result=forwardRunningObserver(f.container,req(),policy,Date.now()+1000);
 await assert.rejects(result,/expired/);resolve(new Response(new ReadableStream({cancel(){cancelled=true;}})));await new Promise(r=>setTimeout(r,0));assert.equal(cancelled,true);
});
test('container stop aborts a pending response read',async()=>{
 let cancelled=false;const f=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
 const response=await forwardRunningObserver(f.container,req(),policy,Date.now()+1000);const reading=response.text();f.container.running=false;await assert.rejects(reading,/expired/);assert.equal(cancelled,true);
});
test('caller abort cancels stream even if upstream does not implement abort',async()=>{
 const controller=new AbortController();let cancelled=false;
 const f=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
 const response=await forwardRunningObserver(f.container,req('/page',{signal:controller.signal}),policy,Date.now()+1000);const reading=response.text();controller.abort();await assert.rejects(reading,/expired/);assert.equal(cancelled,true);
});
test('page and state have independent incremental byte ceilings',async()=>{
 for(const [path,size] of [['/page',8*1024*1024+1],['/state',64*1024+1]] as const){let cancelled=false;const f=fixture(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(size));},cancel(){cancelled=true;}})));const response=await forwardRunningObserver(f.container,req(path),policy,Date.now()+1000);await assert.rejects(response.arrayBuffer(),/budget/);assert.equal(cancelled,true);}
});
test('empty chunks cannot bypass chunk budget',async()=>{
 const f=fixture(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array());}})));const response=await forwardRunningObserver(f.container,req(),policy,Date.now()+1000);await assert.rejects(response.arrayBuffer(),/budget/);
});
test('forbidden redirects are rejected and disposed without following',async()=>{
 let cancelled=false;const f=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'https://other.test/'}}));await assert.rejects(forwardRunningObserver(f.container,req(),policy,Date.now()+1000),/denied/);assert.equal(f.calls,1);assert.equal(cancelled,true);
});
test('consumer cancellation disposes the upstream body',async()=>{
 let cancelled=false;const f=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));const response=await forwardRunningObserver(f.container,req(),policy,Date.now()+1000);await response.body!.cancel();assert.equal(cancelled,true);
});

test('HEAD discards unexpected body and same-target redirects remain manual',async()=>{
 let cancelled=false;const f=fixture(async r=>{assert.equal(r.method,'HEAD');return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'/state'}});});
 const response=await forwardRunningObserver(f.container,req('/page',{method:'HEAD'}),policy,Date.now()+1000);assert.equal(response.body,null);assert.equal(response.headers.get('location'),policy.origin+'/state');assert.equal(cancelled,true);assert.equal(f.calls,1);
});
test('unconsumed response is cancelled at the absolute deadline',async()=>{
 let cancelled=false;const f=fixture(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}})));
 const response=await forwardRunningObserver(f.container,req(),policy,Date.now()+1000);await new Promise(r=>setTimeout(r,1100));assert.equal(cancelled,true);await assert.rejects(response.arrayBuffer(),/expired/);
});

test('cancellation capability denies dispatch and propagates failure without native I/O',async()=>{
 for(const cancelled of [async()=>true,async()=>{throw Error('caller-lost');}]){
  const f=fixture();await assert.rejects(forwardRunningObserver(f.container,req(),policy,Date.now()+1000,{cancelled}));assert.equal(f.calls,0);
 }
});

test('remote cancellation stops a stalled native response and cancels its body',async()=>{
 let cancelled=false,revoked=false;const f=fixture(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
 const response=await forwardRunningObserver(f.container,req(),policy,Date.now()+5000,{async cancelled(){return revoked;}});
 const body=response.text();revoked=true;await assert.rejects(body,/expired/);assert.equal(cancelled,true);
});
