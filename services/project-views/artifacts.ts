import {toolArtifactReceipt,type ToolArtifactReceipt} from '../artifacts/protocol.ts';
import type {TurnJournalState} from '../turn/protocol.ts';
/** A store retain precedes journal append. Require the actual committed event,
 * never infer that it exists from its retained storage reference. */
export function committedProjectArtifact(receipt:ToolArtifactReceipt,state:Pick<TurnJournalState,'events'|'eventReceipts'>):boolean{
 return [...state.events,...Object.values(state.eventReceipts).map(r=>r.event)].some(event=>{
  if(event.type!=='tool.completed'||event.payload.isError!==false||!event.payload.artifact)return false;
  try{return JSON.stringify(toolArtifactReceipt(event.payload.artifact))===JSON.stringify(receipt);}catch{return false;}
 });
}

import {turnDigest} from '../turn/protocol.ts';
/** Hash only the visible receipt set. A retain without append does not change
 * this epoch; append and journal retirement do. Cursors cannot skip over a
 * receipt that became visible while paging. */
export async function projectArtifactJournalVersion(state:Pick<TurnJournalState,'events'|'eventReceipts'>){
 const receipts=new Set<string>();
 for(const event of [...state.events,...Object.values(state.eventReceipts).map(r=>r.event)]){
  if(event.type!=='tool.completed'||event.payload.isError!==false||!event.payload.artifact)continue;
  try{receipts.add(JSON.stringify(toolArtifactReceipt(event.payload.artifact)));}catch{}
 }
 return turnDigest([...receipts].sort());
}
export function projectArtifactStoreCursor(cursor:string|null,journalVersion:string):string|null{
 if(cursor===null)return null;
 if(typeof cursor!=='string'||! /^[a-f0-9]{64}:[a-f0-9]{64}:artifact-[a-f0-9]{60}$/.test(cursor)||cursor.slice(0,64)!==journalVersion)throw Error('project-artifact-cursor-stale');
 return cursor.slice(65);
}
