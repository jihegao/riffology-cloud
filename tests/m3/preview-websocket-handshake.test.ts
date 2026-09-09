import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedWebSocketHandshake,connectPreviewWebSocket} from '../../services/preview/websocket-connect.ts';

test('handshake timeout covers stalled authority/routing reads before connect',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const controller=new AbortController();
 const pending=boundedWebSocketHandshake(controller,()=>new Promise<Response>(()=>{}));
 const rejected=assert.rejects(pending,/handshake-timeout/);t.mock.timers.tick(10001);await rejected;assert.equal(controller.signal.aborted,true);
});
test('cancelled handshake disposes a late upgrade and never leaves a live socket',async()=>{
 const signal=new AbortController();let release!:(value:Response)=>void,started!:()=>void,finishes=0,closed=0;
 const began=new Promise<void>(resolve=>{started=resolve;});
 const pending=connectPreviewWebSocket(new Request('http://localhost:8080/ws'),{authorize:async()=>({expiresAt:Date.now()+50000}),signal:signal.signal,finish:()=>{finishes++;},connect:()=>{started();return new Promise<Response>(resolve=>{release=resolve;});}});
 await began;signal.abort();await assert.rejects(pending,/aborted/);
 release({status:101,webSocket:{accept(){},close(){closed++;}}} as unknown as Response);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,1);assert.equal(finishes,1);
});
