import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';

// Transport-only local Workerd probe. No platform authorization, containers or cloud.
test('Workerd WebSocket RPC serialization probe and DO fetch echo/close alternative',{timeout:20000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'ws-rpc-probe-')),worker='ws-rpc-probe';
 const entry=`import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
 function pair(){const [client,server]=Object.values(new WebSocketPair());server.accept();server.addEventListener('message',e=>{if(e.data==='close')server.close(1000,'fixture-close');else server.send('echo:'+e.data);});return client;}
 export class SocketDO extends DurableObject{
  response(){return new Response(null,{status:101,webSocket:pair()});}
  socket(){return pair();}
  fetch(){return this.response();}
 }
 export class Relay extends WorkerEntrypoint{fetch(req){return this.env.SOCKETS.getByName('probe').fetch(req);}}
 export default{async fetch(req,env){const stub=env.SOCKETS.getByName('probe'),mode=new URL(req.url).pathname.slice(1);
  try{if(mode==='service-fetch')return await env.RELAY.fetch(req);if(mode==='response')return await stub.response();if(mode==='socket')return new Response(null,{status:101,webSocket:await stub.socket()});return await stub.fetch(req);}
  catch(e){return Response.json({name:e.name,message:e.message},{status:502});}
 }};`;
 const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:entry}}},env:{RELAY:{type:'worker',worker,exportName:'Relay'},SOCKETS:{type:'durable-object',worker,exportName:'SocketDO'}},exports:{Relay:{type:'worker'},SocketDO:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 t.after(async()=>{await mf.dispose();await rm(directory,{recursive:true,force:true});});await mf.ready;
 for(const mode of ['response','socket','fetch','service-fetch']){
  const response=await mf.dispatchFetch('https://fixture.test/'+mode,{headers:{Upgrade:'websocket'}});
  if(response.status!==101){const error=await response.json();t.diagnostic(JSON.stringify({mode,status:response.status,...error}));assert.ok(['response','socket'].includes(mode));assert.equal(response.status,502);assert.match(error.message,/serializ|WebSocket/i);continue;}
  assert.ok(['fetch','service-fetch'].includes(mode),'RPC unexpectedly supports WebSocket; review probe expectations');
  const ws=response.webSocket;assert.ok(ws);ws.accept();
  const next=(event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(mode+' '+event+' timeout')),2000);ws.addEventListener(event,e=>{clearTimeout(timer);resolve(e);},{once:true});});
  const message=next('message');ws.send('hello');assert.equal((await message).data,'echo:hello');
  const closed=next('close');ws.send('close');const close=await closed;assert.equal(close.code,1000);assert.equal(close.reason,'fixture-close');t.diagnostic(JSON.stringify({mode,status:response.status,echo:true,close:close.code}));
 }
});
