import type { TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import type { TurnJournalState, CheckpointReceipt } from '../turn/protocol.ts';
import { BROWSER_BUILD_WAKE_KEY, WORKSPACE_STATE_KEY, TURN_WAKE_KEY, SERVICE_WAKE_KEY, OBSERVER_WAKE_KEY, SIMULATION_WAKE_KEY, applyWorkspaceAlarm } from '../workspace/shared-alarm.ts';

export const PREVIEW_DISCOVERY_PREFIX='browser-preview:discovery:';
export interface PreviewDiscovery { schemaVersion:1; identity:TurnRuntimeIdentity; receipt:CheckpointReceipt; status:'pending'|'settled'; attempts:number; nextAttemptAt:number|null; reasonCode:string|null }
export function savedPreviewDiscoveries(state:TurnJournalState):PreviewDiscovery[]{
  return Object.values(state.turns).filter(turn=>turn.persistenceOutcome==='saved'&&turn.checkpoint!==null).map(turn=>{
    if(!turn.dispatchId||turn.runtimeGeneration!==state.scope.workspaceGeneration)throw Error('invalid-persisted-turn-journal');
    return {schemaVersion:1,identity:{scope:structuredClone(state.scope),sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration},receipt:structuredClone(turn.checkpoint!),status:'pending',attempts:0,nextAttemptAt:turn.checkpoint!.committedAt,reasonCode:null};
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
    if(prior){if(JSON.stringify(prior.identity)!==JSON.stringify(discovery.identity)||JSON.stringify(prior.receipt)!==JSON.stringify(discovery.receipt))throw Error('preview-discovery-conflict');continue;}
    await tx.put(key,discovery);changed=true;
  }
  if(indexed!==1)await tx.put('browser-preview:discovery-index-version',1);
  if(!changed)return;
  const pending=await tx.list<PreviewDiscovery>({prefix:PREVIEW_DISCOVERY_PREFIX});
  const times=[...pending.values()].filter(row=>row.status==='pending').map(row=>row.nextAttemptAt!);
  const wake=times.length?Math.min(...times):null;
  if(wake===null)await tx.delete(BROWSER_BUILD_WAKE_KEY);else await tx.put(BROWSER_BUILD_WAKE_KEY,wake);
  const workspace=await tx.get<{wakeAt:number|null}>(WORKSPACE_STATE_KEY);
  await applyWorkspaceAlarm(tx,workspace?.wakeAt??null,await tx.get(TURN_WAKE_KEY),await tx.get(SERVICE_WAKE_KEY),await tx.get(OBSERVER_WAKE_KEY),await tx.get(SIMULATION_WAKE_KEY),wake);
}
