import {toolArtifactReference,toolArtifactReferenceReceipt,type ToolArtifactReferenceInput,type ToolArtifactStoreRpc} from './protocol.ts';
import type {TurnJournal} from '../turn/journal.ts';

/** Terminal Turns cannot append new runtime events. Once their event and
 * replay receipt are absent, that absence remains true across the release RPC.
 * Lost release acknowledgements retry the same immutable reference. */
export async function releaseRetiredArtifactEvent(journal:Pick<TurnJournal,'artifactEventReleaseEligibility'>,store:Pick<ToolArtifactStoreRpc,'release'>,raw:ToolArtifactReferenceInput){
  const reference=toolArtifactReference(raw),eligibility=await journal.artifactEventReleaseEligibility(reference);
  if(!eligibility.eligible)return {released:false as const,reason:eligibility.reason};
  const receipt=toolArtifactReferenceReceipt(await store.release(reference));
  if(receipt.artifactId!==reference.artifactId||receipt.kind!==reference.kind||receipt.referenceId!==reference.referenceId||receipt.releasedAt===null)throw Error('tool-artifact-release-receipt-conflict');
  return {released:true as const,receipt};
}
