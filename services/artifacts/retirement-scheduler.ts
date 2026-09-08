import {toolArtifactReference,type ToolArtifactReferenceInput} from './protocol.ts';
export interface RetirementPorts{
  loadCursor():Promise<number>;
  saveCursor(cursor:number):Promise<void>;
  schedule(at:number):Promise<void>;
  page(after:number,limit:number):Promise<Array<{cursor:number;reference:ToolArtifactReferenceInput}>>;
  eligible(reference:ToolArtifactReferenceInput):Promise<{eligible:boolean;reason:string}>;
  release(reference:ToolArtifactReferenceInput):Promise<unknown>;
}
/** Each invocation processes at most 50 references. A retry alarm precedes
 * external work; cursor advances only after the page has been examined. */
export async function retireArtifactPage(ports:RetirementPorts,now=Date.now()){
  await ports.schedule(now+60_000);
  const cursor=await ports.loadCursor();if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('invalid-artifact-retirement-cursor');
  const rows=await ports.page(cursor,50);
  if(!Array.isArray(rows)||rows.length>50)throw Error('invalid-artifact-retirement-page');
  let last=cursor;const checked=rows.map(row=>{if(!Number.isSafeInteger(row.cursor)||row.cursor<=last)throw Error('invalid-artifact-retirement-page');last=row.cursor;const reference=toolArtifactReference(row.reference);if(reference.kind!=='turn_event')throw Error('invalid-artifact-retirement-page');return {cursor:row.cursor,reference};});
  let released=0,deferred=0;
  for(const row of checked){
    // Unavailable/stopped workspaces are conservatively revisited next sweep;
    // one such workspace must not starve every other tenant's references.
    try{const proof=await ports.eligible(row.reference);if(proof.eligible===true&&proof.reason==='event-retired'){await ports.release(row.reference);released++;}}catch{deferred++;}
  }
  await ports.saveCursor(rows.length===50?last:0);
  await ports.schedule(now+(rows.length===50?1000:3_600_000));
  return {examined:rows.length,released,deferred};
}
