import {CatalogError,digest,opaqueId,type Principal} from './contracts.ts';
import {statement as sql,type Database} from './database.ts';
import {OperatorCatalog} from './admin.ts';
import type {TurnScope} from '../turn/protocol.ts';
export type ArchiveAction='archive'|'restore';
export interface ArchiveTarget {scope:TurnScope;owner:Principal;createdAt:number;archivedAt:number|null;epoch:number;status:string;outboxBusy:number;manifestId:string|null}
export interface ArchiveReceipt {id:string;project_id:string;action:ArchiveAction;request_key:string;manifest_id:string|null;archive_epoch:number;outcome:'completed'|'blocked';reason_code:string;created_at:number}
const owner=`SELECT 1 FROM catalog_memberships m JOIN catalog_users u ON u.id=m.user_id JOIN catalog_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=p.tenant_id AND m.user_id=p.owner_user_id AND m.status='active' AND m.role='owner' AND u.status='active' AND t.status='active' AND t.owner_user_id=u.id AND u.auth_version=?`;
const currentOwner=owner.replace('u.auth_version=?','u.auth_version>=1');
const invited=`SELECT 1 FROM catalog_invitations i WHERE i.accepted_by=p.owner_user_id AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL`;
/** Metadata only: operator authorization never constructs an owner content principal. */
export class ProjectArchives {
 readonly db:Database;readonly clock:()=>number;
 constructor(db:Database,clock=Date.now){this.db=db;this.clock=clock;}
 async target(actor:Principal,tenantId:string,projectId:string,manifestId?:string):Promise<ArchiveTarget>{
  opaqueId(tenantId);opaqueId(projectId);if(manifestId)await new OperatorCatalog(this.db).require(actor);
  const rows=await this.db.query<{tenant_id:string;id:string;workspace_id:string;generation:number;owner_user_id:string;auth_version:number;created_at:number;archived_at:number|null;archive_epoch:number;status:string;outbox_busy:number}>(sql(`SELECT p.tenant_id,p.id,p.workspace_id,p.generation,p.owner_user_id,u.auth_version,p.created_at,p.archived_at,p.archive_epoch,p.status,
    (SELECT count(*) FROM catalog_outbox o WHERE o.project_id=p.id AND o.state NOT IN ('completed','failed')) AS outbox_busy
    FROM catalog_projects p JOIN catalog_users u ON u.id=p.owner_user_id WHERE p.id=? AND p.tenant_id=?
    AND EXISTS (${owner}) AND ((? IS NULL AND p.owner_user_id=? AND u.auth_version=?) OR (? IS NOT NULL AND EXISTS (${invited}) AND EXISTS (
      SELECT 1 FROM catalog_project_archive_items item JOIN catalog_project_archive_manifests mf ON mf.id=item.manifest_id
      WHERE item.manifest_id=? AND item.project_id=p.id AND item.tenant_id=p.tenant_id AND item.owner_user_id=p.owner_user_id
      AND item.workspace_id=p.workspace_id AND item.generation=p.generation AND item.auth_version=u.auth_version AND item.created_at=p.created_at AND p.created_at<=mf.cutoff_at)))`,
    projectId,tenantId,manifestId?await this.ownerVersion(projectId):actor.authVersion,manifestId??null,actor.userId,actor.authVersion,manifestId??null,manifestId??null));
  const row=rows[0];if(!row)throw new CatalogError('not_found');
  return {scope:{tenantId:row.tenant_id,projectId:row.id,workspaceId:row.workspace_id,workspaceGeneration:row.generation},owner:{userId:row.owner_user_id,authVersion:row.auth_version},createdAt:row.created_at,archivedAt:row.archived_at,epoch:row.archive_epoch,status:row.status,outboxBusy:row.outbox_busy,manifestId:manifestId??null};
 }
 private async ownerVersion(projectId:string){return (await this.db.query<{auth_version:number}>(sql('SELECT u.auth_version FROM catalog_users u JOIN catalog_projects p ON p.owner_user_id=u.id WHERE p.id=?',projectId)))[0]?.auth_version??-1;}
 async receipt(actor:Principal,projectId:string,action:ArchiveAction,key:string){opaqueId(key);return (await this.db.query<ArchiveReceipt>(sql('SELECT id,project_id,action,request_key,manifest_id,archive_epoch,outcome,reason_code,created_at FROM catalog_project_archive_receipts WHERE actor_user_id=? AND project_id=? AND action=? AND request_key=?',actor.userId,projectId,action,key)))[0]??null;}
 async commit(actor:Principal,target:ArchiveTarget,action:ArchiveAction,key:string,reason?:string):Promise<ArchiveReceipt>{
  opaqueId(key);const current=await this.target(actor,target.scope.tenantId,target.scope.projectId,target.manifestId??undefined);
  if(JSON.stringify(current.scope)!==JSON.stringify(target.scope)||current.owner.authVersion!==target.owner.authVersion||current.epoch!==target.epoch)throw new CatalogError('idempotency_conflict');
  const prior=await this.receipt(actor,target.scope.projectId,action,key);if(prior){if(prior.manifest_id!==target.manifestId)throw new CatalogError('idempotency_conflict');return prior;}
  if(action==='restore'&&target.manifestId)throw new CatalogError('invalid_input');
  const now=this.clock(),id=crypto.randomUUID(),blocked=reason??(current.outboxBusy||!['ready','failed'].includes(current.status)?'project-busy':null),desired=action==='archive';
  // CAS, current membership, auth-version, frozen item and outbox are rechecked in
  // the same D1 batch as its immutable receipt/audit. Workspace fence is already held.
  const eligible=`p.id=? AND p.tenant_id=? AND p.generation=? AND p.archive_epoch=? AND EXISTS (${owner})
    AND ((? IS NULL AND p.owner_user_id=? AND EXISTS (SELECT 1 FROM catalog_users actor WHERE actor.id=? AND actor.status='active' AND actor.auth_version=?)) OR (? IS NOT NULL AND EXISTS (SELECT 1 FROM catalog_platform_roles r JOIN catalog_users actor ON actor.id=r.user_id WHERE r.user_id=? AND r.role='operator' AND r.status='active' AND actor.status='active' AND actor.auth_version=?)))
    AND (? IS NULL OR EXISTS (${invited})) AND (? IS NULL OR EXISTS (SELECT 1 FROM catalog_project_archive_items item WHERE item.manifest_id=? AND item.project_id=p.id AND item.owner_user_id=p.owner_user_id AND item.auth_version=?))
    AND (? IS NOT NULL OR (p.status IN ('ready','failed') AND NOT EXISTS (SELECT 1 FROM catalog_outbox o WHERE o.project_id=p.id AND o.state NOT IN ('completed','failed'))))`;
  const args=[target.scope.projectId,target.scope.tenantId,target.scope.workspaceGeneration,target.epoch,target.owner.authVersion,target.manifestId,actor.userId,actor.userId,actor.authVersion,target.manifestId,actor.userId,actor.authVersion,target.manifestId,target.manifestId,target.manifestId,target.owner.authVersion,blocked] as (string|number|null)[];
  const epoch=target.epoch+(blocked||desired===(target.archivedAt!==null)?0:1);
  await this.db.batch([
   sql(`INSERT INTO catalog_project_archive_receipts(id,actor_user_id,project_id,action,request_key,manifest_id,archive_epoch,outcome,reason_code,created_at)
    SELECT ?,?,p.id,?,?,?,?,?,?,? FROM catalog_projects p WHERE ${eligible} AND NOT EXISTS (SELECT 1 FROM catalog_project_archive_receipts WHERE actor_user_id=? AND project_id=p.id AND action=? AND request_key=?)`,
    id,actor.userId,action,key,target.manifestId,epoch,blocked?'blocked':'completed',blocked??'owner-request',now,...args,actor.userId,action,key),
   sql(`UPDATE catalog_projects AS p SET archived_at=?,archive_epoch=?,updated_at=? WHERE ${eligible} AND EXISTS (SELECT 1 FROM catalog_project_archive_receipts r WHERE r.id=? AND r.outcome='completed')`,desired?(target.archivedAt??now):null,epoch,now,...args,id),
   sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,tenant_id,reason_code,outcome,request_id,created_at)
    SELECT ?,?,?,'project',p.id,p.tenant_id,r.reason_code,CASE r.outcome WHEN 'completed' THEN 'completed' ELSE 'denied' END,r.id,? FROM catalog_project_archive_receipts r JOIN catalog_projects p ON p.id=r.project_id WHERE r.id=?`,crypto.randomUUID(),actor.userId,'project.'+action,now,id),
  ]);
  const receipt=await this.receipt(actor,target.scope.projectId,action,key);if(!receipt)throw new CatalogError('project_busy');return receipt;
 }
 async recordCheck(actor:Principal,target:ArchiveTarget,key:string,blockers:string[]){
  await this.target(actor,target.scope.tenantId,target.scope.projectId,target.manifestId??undefined);opaqueId(key);
  await this.db.batch([sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,tenant_id,reason_code,outcome,request_id,created_at) VALUES (?,?,'project.archive-check','project',?,?,?,?,?,?)`,crypto.randomUUID(),actor.userId,target.scope.projectId,target.scope.tenantId,blockers[0]??'quiescent',blockers.length?'denied':'completed',key,this.clock())]);
 }
 async freeze(actor:Principal,cutoffAt:number,key:string){
  await new OperatorCatalog(this.db).require(actor);opaqueId(key);
  if(!Number.isSafeInteger(cutoffAt)||cutoffAt<0||cutoffAt>this.clock())throw new CatalogError('invalid_input');
  const id='archive-'+key,prior=(await this.db.query<{cutoff_at:number}>(sql('SELECT cutoff_at FROM catalog_project_archive_manifests WHERE id=?',id)))[0];
  if(prior){if(prior.cutoff_at!==cutoffAt)throw new CatalogError('idempotency_conflict');return this.manifest(actor,id);}
  // Freeze with one transaction. SELECT includes all owners; no LIMIT truncates a migration.
  // Digest is over metadata read after insertion; the manifest ID/cutoff is immutable.
  const now=this.clock();
  await this.db.batch([
   sql(`INSERT INTO catalog_project_archive_manifests(id,actor_user_id,cutoff_at,created_at,metadata_schema,total) SELECT ?,?,?,?,'archive-items-v1',count(*) FROM catalog_projects p JOIN catalog_users u ON u.id=p.owner_user_id WHERE p.created_at<=? AND EXISTS (${currentOwner}) AND EXISTS (${invited}) HAVING EXISTS (SELECT 1 FROM catalog_platform_roles r JOIN catalog_users op ON op.id=r.user_id WHERE r.user_id=? AND r.status='active' AND r.role='operator' AND op.status='active' AND op.auth_version=?)`,id,actor.userId,cutoffAt,now,cutoffAt,actor.userId,actor.authVersion),
   sql(`INSERT INTO catalog_project_archive_items(manifest_id,project_id,tenant_id,owner_user_id,workspace_id,generation,auth_version,created_at)
    SELECT ?,p.id,p.tenant_id,p.owner_user_id,p.workspace_id,p.generation,u.auth_version,p.created_at FROM catalog_projects p JOIN catalog_users u ON u.id=p.owner_user_id WHERE p.created_at<=? AND EXISTS (${currentOwner}) AND EXISTS (${invited}) AND EXISTS (SELECT 1 FROM catalog_project_archive_manifests mf WHERE mf.id=?)`,id,cutoffAt,id),
  ]);
  return this.manifest(actor,id);
 }
 async manifest(actor:Principal,id:string){await new OperatorCatalog(this.db).require(actor);opaqueId(id);const header=(await this.db.query<{id:string;cutoff_at:number;created_at:number;total:number}>(sql('SELECT id,cutoff_at,created_at,total FROM catalog_project_archive_manifests WHERE id=?',id)))[0];if(!header)throw new CatalogError('not_found');
  const items=await this.db.query<{project_id:string;tenant_id:string;owner_user_id:string;workspace_id:string;generation:number;auth_version:number;created_at:number}>(sql('SELECT project_id,tenant_id,owner_user_id,workspace_id,generation,auth_version,created_at FROM catalog_project_archive_items WHERE manifest_id=? ORDER BY project_id',id));
  if(items.length!==header.total)throw new CatalogError('project_busy');
  const receipts=await this.db.query<ArchiveReceipt>(sql('SELECT id,project_id,action,request_key,manifest_id,archive_epoch,outcome,reason_code,created_at FROM catalog_project_archive_receipts WHERE manifest_id=? ORDER BY project_id,created_at,id',id));
  const states=await this.db.query<{project_id:string;archived_at:number|null;archive_epoch:number;status:string}>(sql('SELECT p.id AS project_id,p.archived_at,p.archive_epoch,p.status FROM catalog_projects p JOIN catalog_project_archive_items i ON i.project_id=p.id WHERE i.manifest_id=? ORDER BY p.id',id));
  return {...header,items,receipts,states,digest:await digest(JSON.stringify({cutoffAt:header.cutoff_at,items})),ownerCount:new Set(items.map(i=>i.owner_user_id)).size};}
}
