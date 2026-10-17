import test from 'node:test';
import assert from 'node:assert/strict';
import {committedProjectArtifact,projectArtifactJournalVersion,projectArtifactStoreCursor} from '../../services/project-views/artifacts.ts';
import type {TurnJournalState,TurnEvent} from '../../services/turn/protocol.ts';
const receipt={schemaVersion:1 as const,artifactId:'artifact-'+'a'.repeat(60),operation:'read' as const,mediaType:'application/json' as const,bytes:20000,sha256:'b'.repeat(64),createdAt:1};
test('retained store reference alone cannot expose an Artifact before durable journal append',()=>{
 const state:Pick<TurnJournalState,'events'|'eventReceipts'>={events:[],eventReceipts:{}};
 assert.equal(committedProjectArtifact(receipt,state),false);
 const event={eventId:'event-a',type:'tool.completed',payload:{isError:false,artifact:receipt}} as unknown as TurnEvent;
 state.events.push(event);assert.equal(committedProjectArtifact(receipt,state),true);
 assert.equal(committedProjectArtifact({...receipt,sha256:'c'.repeat(64)},state),false);
 state.events=[];assert.equal(committedProjectArtifact(receipt,state),false);
 state.eventReceipts['event-a']={event} as TurnJournalState['eventReceipts'][string];assert.equal(committedProjectArtifact(receipt,state),true);
 event.payload.isError=true;assert.equal(committedProjectArtifact(receipt,state),false);
});

test('paging cursor is invalidated by retain-to-commit visibility and journal retirement',async()=>{
 const state:Pick<TurnJournalState,'events'|'eventReceipts'>={events:[],eventReceipts:{}};
 const hidden=await projectArtifactJournalVersion(state),storeCursor='c'.repeat(64)+':artifact-'+'d'.repeat(60),cursor=hidden+':'+storeCursor;
 assert.equal(projectArtifactStoreCursor(cursor,hidden),storeCursor);
 state.events.push({eventId:'event-a',type:'tool.completed',payload:{isError:false,artifact:receipt}} as unknown as TurnEvent);
 const visible=await projectArtifactJournalVersion(state);assert.notEqual(visible,hidden);assert.throws(()=>projectArtifactStoreCursor(cursor,visible),/cursor-stale/);
 const committedCursor=visible+':'+storeCursor;state.events=[];assert.throws(()=>projectArtifactStoreCursor(committedCursor,hidden),/cursor-stale/);
 assert.equal(projectArtifactStoreCursor(null,visible),null);
});
