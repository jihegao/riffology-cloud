import test from 'node:test';
import assert from 'node:assert/strict';
import { turnEventStream } from '../../services/gateway/events.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const event={sequence:1,eventId:'event-one',turnId:'turn-one',workspaceId:'workspace-a',runtimeGeneration:1,type:'turn.queued' as const,at:1,payload:{}};

test('SSE persists no authority and closes after a later authorization revocation',async()=>{
 let checks=0,replays=0;const response=turnEventStream({scope,afterSequence:0,pollMs:1,maxMs:1000,
  authorize:async()=>{if(++checks>1)throw Error('revoked');},
  replay:async after=>{replays++;return {events:after===0?[event]:[],nextSequence:after===0?1:after,hasMore:false,oldestSequence:1,snapshotRequired:false};}});
 assert.match(response.headers.get('content-type')??'',/^text\/event-stream/);const text=await response.text();assert.match(text,/id: 1\nevent: turn\.queued/);assert.match(text,/event: stream\.closed\ndata: {"reason":"authorization_changed"}/);assert.equal(replays,1);
});

test('SSE rejects wrong workspace or nonmonotonic pages without forwarding them',async()=>{
 const response=turnEventStream({scope,afterSequence:0,pollMs:1,maxMs:10,authorize:async()=>{},replay:async()=>({events:[{...event,workspaceId:'workspace-b'}],nextSequence:1,hasMore:false,oldestSequence:1,snapshotRequired:false})});
 const text=await response.text();assert.doesNotMatch(text,/turn\.queued/);assert.match(text,/temporarily_unavailable/);
});

test('cancelling an SSE reader stops observation without cancelling a Turn',async()=>{
 let reads=0;const response=turnEventStream({scope,afterSequence:0,pollMs:100,maxMs:1000,authorize:async()=>{},replay:async()=>{reads++;return {events:reads===1?[event]:[],nextSequence:1,hasMore:false,oldestSequence:1,snapshotRequired:false};}}),reader=response.body!.getReader();
 const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/turn\.queued/);await reader.cancel();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reads,1);
});

test('an expired event cursor closes for snapshot recovery without skipping into newer events',async()=>{
 const newer={...event,sequence:8,eventId:'event-eight'};
 const response=turnEventStream({scope,afterSequence:1,pollMs:1,maxMs:100,authorize:async()=>{},replay:async()=>({events:[newer],nextSequence:8,hasMore:false,oldestSequence:7,snapshotRequired:true})});
 const text=await response.text();assert.match(text,/event: snapshot\.required/);assert.match(text,/"oldestSequence":7/);assert.doesNotMatch(text,/event: turn\.queued/);assert.doesNotMatch(text,/id: 8/);
});
