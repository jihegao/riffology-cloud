import {ProjectArchives,type ArchiveAction,type ArchiveTarget} from '../catalog/project-archives.ts';
import {CatalogError,type Principal} from '../catalog/contracts.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
export interface ProjectArchiveActor {
 prepareProjectArchive(input:{actor:Principal;target:ArchiveTarget;action:ArchiveAction;operationId:string;dryRun:boolean}):Promise<{blockers:string[]}>;
 finishProjectArchive(input:{actor:Principal;target:ArchiveTarget;action:ArchiveAction;operationId:string;requestKey:string}):Promise<void>;
 abortProjectArchive(input:{target:ArchiveTarget;operationId:string}):Promise<void>;
}
export interface GatewayProjectArchives {transition(actor:Principal,tenantId:string,projectId:string,action:ArchiveAction,key:string,manifestId?:string,dryRun?:boolean):Promise<unknown>}
export function createGatewayProjectArchives(archives:ProjectArchives,namespace:{getByName(name:string):ProjectArchiveActor}):GatewayProjectArchives{
 return {async transition(actor,tenantId,projectId,action,key,manifestId,dryRun=false){
  const target=await archives.target(actor,tenantId,projectId,manifestId);
  const stub=namespace.getByName(workspaceAgentName(tenantId,target.scope.workspaceId));
  const prior=await archives.receipt(actor,projectId,action,key);
  if(prior){if(prior.manifest_id!==target.manifestId)throw new CatalogError('idempotency_conflict');if(prior.outcome==='completed'&&prior.archive_epoch===target.epoch&&(target.archivedAt!==null)===(action==='archive'))await stub.finishProjectArchive({actor,target,action,operationId:prior.id,requestKey:key});return prior;}
  const operationId=key; // Request key is owner-scoped by the current target below.
  const identity=actor.userId+':'+action+':'+operationId;
  const preliminary=target.outboxBusy||!['ready','failed'].includes(target.status)?['provisioning-or-outbox']:[];
  let blockers=preliminary;
  if(!blockers.length){try{blockers=(await stub.prepareProjectArchive({actor,target,action,operationId:identity,dryRun})).blockers;}catch(error){if(error instanceof Error&&['project_busy','project_archived'].includes(error.message))blockers=[error.message];else if(error instanceof CatalogError)throw error;else blockers=['quiescence-unconfirmed'];}}
  if(dryRun){await archives.recordCheck(actor,target,key,blockers);return {project_id:projectId,action,archive_epoch:target.epoch,eligible:blockers.length===0,blockers};}
  try{
   const receipt=await archives.commit(actor,target,action,key,blockers[0]);
   if(receipt.outcome==='completed')await stub.finishProjectArchive({actor,target,action,operationId:identity,requestKey:key});
   else await stub.abortProjectArchive({target,operationId:identity});
   return receipt;
  }catch(error){
   // A lost commit response keeps its durable fence. Reconcile the original key.
   const committed=await archives.receipt(actor,projectId,action,key).catch(()=>null);
   if(committed?.outcome==='completed'){await stub.finishProjectArchive({actor,target,action,operationId:identity,requestKey:key});return committed;}
   if(!committed||committed.outcome==='blocked')await stub.abortProjectArchive({target,operationId:identity});
   throw error;
  }
 }};
}
