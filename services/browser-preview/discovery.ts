import type { BrowserBuildSource, SavedBrowserSource } from './source.ts';
import { frozenSource } from './source.ts';
import type { WorkspaceState } from '../workspace/coordinator.ts';
import { initialWorkspaceReferenceFromReady } from '../turn-runtime/initial-workspace.ts';
import { turnDigest } from '../turn/protocol.ts';
import type { TurnJournalState } from '../turn/protocol.ts';
import { BROWSER_BUILD_WAKE_KEY, WORKSPACE_STATE_KEY, TURN_WAKE_KEY, SERVICE_WAKE_KEY, OBSERVER_WAKE_KEY, SIMULATION_WAKE_KEY, applyWorkspaceAlarm } from '../workspace/shared-alarm.ts';

export const PREVIEW_DISCOVERY_PREFIX='browser-preview:discovery:';
type DiscoveryState={schemaVersion:1;status:'pending'|'settled';attempts:number;nextAttemptAt:number|null;reasonCode:string|null};
export type PreviewDiscovery=BrowserBuildSource&DiscoveryState;
export function savedPreviewDiscoveries(state:TurnJournalState):(SavedBrowserSource&DiscoveryState)[]{
  return Object.values(state.turns).filter(turn=>turn.persistenceOutcome==='saved'&&turn.checkpoint!==null).map(turn=>{
    if(!turn.dispatchId||turn.runtimeGeneration!==state.scope.workspaceGeneration)throw Error('invalid-persisted-turn-journal');
    return {schemaVersion:1,identity:{scope:structuredClone(state.scope),sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration},receipt:structuredClone(turn.checkpoint!),status:'pending',attempts:0,nextAttemptAt:turn.finishedAt!,reasonCode:null};
  });
}
export function discoveryKey(revisionId:string){return PREVIEW_DISCOVERY_PREFIX+revisionId;}
/** Called within the journal transaction. No network, R2 or model execution. */
export async function projectPreviewDiscoveries(tx:DurableObjectTransaction,state:TurnJournalState,previous:TurnJournalState|null):Promise<void>{
  let changed=false;
  const indexed=await tx.get('browser-preview:discovery-index-version');
  const candidates=indexed===1?savedPreviewDiscoveries(state).filter(row=>previous?.turns[row.identity.turnId]?.persistenceOutcome!=='saved'):savedPreviewDiscoveries(state);
  for(const discovery of candidates){
    const key=discoveryKey(discovery.receipt.revisionId),prior=await tx.get<PreviewDiscovery>(key);
    if(prior){if(JSON.stringify(frozenSource(prior))!==JSON.stringify(frozenSource(discovery)))throw Error('preview-discovery-conflict');continue;}
    await tx.put(key,discovery);changed=true;
  }
  if(indexed!==1)await tx.put('browser-preview:discovery-index-version',1);
  if(!changed)return;
  const pending=await tx.list<PreviewDiscovery>({prefix:PREVIEW_DISCOVERY_PREFIX});
  const times=[...pending.values()].filter(row=>row.status==='pending').map(row=>row.nextAttemptAt!);
  const existing=await tx.get<number>(BROWSER_BUILD_WAKE_KEY);
  const wake=times.length?Math.min(...times,...(existing===undefined?[]:[existing])):existing??null;
  if(wake===null)await tx.delete(BROWSER_BUILD_WAKE_KEY);else await tx.put(BROWSER_BUILD_WAKE_KEY,wake);
  const workspace=await tx.get<{wakeAt:number|null}>(WORKSPACE_STATE_KEY);
  await applyWorkspaceAlarm(tx,workspace?.wakeAt??null,await tx.get(TURN_WAKE_KEY),await tx.get(SERVICE_WAKE_KEY),await tx.get(OBSERVER_WAKE_KEY),await tx.get(SIMULATION_WAKE_KEY),wake);
}

/** Only the real confirmed-ready state transition admits initial provenance.
 * A legacy ready read never creates work. No external I/O occurs here. */
export async function projectInitialPreviewDiscovery(tx:DurableObjectTransaction,next:WorkspaceState,previous:WorkspaceState|null):Promise<void>{
 if(!next.projectionConfirmed||next.projection?.outcome!=='ready'||!next.task.modelContent||!next.identity||!next.runtimeReceipt)return;
 if(previous?.projectionConfirmed&&previous.projection?.outcome==='ready')return;
 const scope={tenantId:next.task.tenantId,projectId:next.task.projectId,workspaceId:next.task.workspaceId,workspaceGeneration:next.task.generation};
 const reference=await initialWorkspaceReferenceFromReady({scope,task:next.task,runtime:next.identity,markerNonce:next.markerNonce,ready:next.runtimeReceipt});
 const referenceSha256=await turnDigest(reference),revisionId='initial-'+referenceSha256;
 const candidate:PreviewDiscovery={schemaVersion:1,kind:'initial-workspace',reference,referenceSha256,revisionId,filesSha256:null,status:'pending',attempts:0,nextAttemptAt:next.task.createdAt,reasonCode:null};
 const prior=await tx.get<PreviewDiscovery>(discoveryKey(revisionId));
 if(prior){const original=frozenSource(prior);if(original.kind!=='initial-workspace'||JSON.stringify({...original,filesSha256:null})!==JSON.stringify(frozenSource(candidate)))throw Error('preview-discovery-conflict');}
 else await tx.put(discoveryKey(revisionId),candidate);
 await tx.put('browser-preview:initial-source',revisionId);
 if(prior?.status==='settled')return;
 const wake=await tx.get<number>(BROWSER_BUILD_WAKE_KEY);
 await tx.put(BROWSER_BUILD_WAKE_KEY,Math.min(prior?.nextAttemptAt??candidate.nextAttemptAt!,wake??Infinity));
}
