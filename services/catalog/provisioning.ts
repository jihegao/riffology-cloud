import { statement as sql, type Database } from './database.ts';
import { CatalogError, digest, opaqueId, type Principal } from './contracts.ts';

import { validateWorkspaceTask, type WorkspaceTask, type WorkspaceProjection, type ModelContentRef } from '../workspace/protocol.ts';
export type { WorkspaceProjection } from '../workspace/protocol.ts';
export type ProvisioningTask = WorkspaceTask;
const reasons=['initialized','quota-denied','authority-revoked','startup-failed','deadline','runtime-unknown','stop-requested','cleanup-unknown'];
function keys(value:unknown,names:string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==names.length||names.some(k=>!Object.hasOwn(value,k)))throw new CatalogError('invalid_input');
}
function integer(value:unknown,min=1):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min)throw new CatalogError('invalid_input');}
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||! /^[A-Za-z0-9:_-]{1,128}$/.test(value))throw new CatalogError('invalid_input');}
function hash(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
/** A private authority port, not a client-supplied status patch. Only fixed
 * primitive metadata is accepted; canonical hashing excludes arbitrary content. */
export function validateProjection(value:WorkspaceProjection):WorkspaceProjection{
 keys(value,['taskId','tenantId','projectId','workspaceId','generation','sequence','receiptId','updatedAt','outcome','reasonCode','quotaReleased','runtimeReceipt','stopReceipt']);
 for(const field of ['taskId','tenantId','projectId','workspaceId','receiptId'] as const)identifier(value[field]);
 integer(value.generation);integer(value.sequence);integer(value.updatedAt,0);
 if(!['ready','failed','stopped','unknown'].includes(value.outcome)||!reasons.includes(value.reasonCode)||typeof value.quotaReleased!=='boolean')throw new CatalogError('invalid_input');
 let runtime:WorkspaceProjection['runtimeReceipt']=null,stop:WorkspaceProjection['stopReceipt']=null;
 if(value.runtimeReceipt!==null){const r=value.runtimeReceipt;keys(r,r.modelContent===undefined?['receiptId','initializedAt','layoutVersion','markerSha256','checkpointRevision']:['receiptId','initializedAt','layoutVersion','markerSha256','checkpointRevision','modelContent']);identifier(r.receiptId);integer(r.initializedAt,0);
  if(r.layoutVersion!=='m1-empty-v1'||![r.markerSha256,r.checkpointRevision].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))throw new CatalogError('invalid_input');
  let modelContent:NonNullable<WorkspaceProjection['runtimeReceipt']>['modelContent'];
  if(r.modelContent!==undefined){const c=r.modelContent;keys(c,['modelVersionId','modelId','version','contentRef','contentSha256','namespace','bytes','verifiedSha256','fileCount','contentBytes']);
   if(typeof c.modelVersionId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(c.modelVersionId)||typeof c.modelId!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(c.modelId)||typeof c.version!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(c.version)||typeof c.contentRef!=='string'||c.contentRef.length<1||c.contentRef.length>512||!hash(c.contentSha256)||c.namespace!=='model-content'||!hash(c.verifiedSha256)||c.verifiedSha256!==c.contentSha256)throw new CatalogError('invalid_input');
   integer(c.bytes);integer(c.fileCount);integer(c.contentBytes,0);if(c.bytes>8*1024*1024||c.fileCount>4096||c.contentBytes>c.bytes)throw new CatalogError('invalid_input');modelContent={modelVersionId:c.modelVersionId,modelId:c.modelId,version:c.version,contentRef:c.contentRef,contentSha256:c.contentSha256,namespace:'model-content',bytes:c.bytes,verifiedSha256:c.verifiedSha256,fileCount:c.fileCount,contentBytes:c.contentBytes};}
  runtime={receiptId:r.receiptId,initializedAt:r.initializedAt,layoutVersion:r.layoutVersion,markerSha256:r.markerSha256,checkpointRevision:r.checkpointRevision,...(modelContent?{modelContent}:{})};}
 if(value.stopReceipt!==null){const s=value.stopReceipt;keys(s,['confirmationId','observedAt','nativeRunning','fenced']);identifier(s.confirmationId);integer(s.observedAt,0);
  if(s.nativeRunning!==false||s.fenced!==true)throw new CatalogError('invalid_input');stop={confirmationId:s.confirmationId,observedAt:s.observedAt,nativeRunning:false,fenced:true};}
 if(value.outcome==='ready'&&(value.reasonCode!=='initialized'||!runtime||!stop||!value.quotaReleased||runtime.initializedAt>stop.observedAt||stop.observedAt>value.updatedAt))throw new CatalogError('invalid_input');
 if(value.outcome!=='unknown'&&!value.quotaReleased)throw new CatalogError('invalid_input');
 if(value.outcome!=='ready'&&value.reasonCode==='initialized')throw new CatalogError('invalid_input');
 return {taskId:value.taskId,tenantId:value.tenantId,projectId:value.projectId,workspaceId:value.workspaceId,generation:value.generation,sequence:value.sequence,receiptId:value.receiptId,updatedAt:value.updatedAt,outcome:value.outcome,reasonCode:value.reasonCode,quotaReleased:value.quotaReleased,runtimeReceipt:runtime,stopReceipt:stop};
}
const ownership=`SELECT 1 FROM catalog_memberships m JOIN catalog_tenants t ON t.id=m.tenant_id
 JOIN catalog_users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=?
 AND m.status='active' AND m.role='owner' AND t.status='active' AND t.owner_user_id=u.id
 AND u.status='active' AND u.auth_version=?`;
const joined=`FROM catalog_outbox o JOIN catalog_projects p ON p.id=o.project_id AND p.tenant_id=o.tenant_id AND p.workspace_id=o.workspace_id
 JOIN catalog_workspaces w ON w.id=o.workspace_id AND w.project_id=p.id AND w.tenant_id=p.tenant_id`;
const current=`o.kind='workspace.provision' AND o.generation=p.generation AND o.generation=w.generation
 AND p.status<>'deleting' AND w.status<>'deleting'`;
const taskColumns=`o.id,o.tenant_id AS tenantId,o.project_id AS projectId,o.workspace_id AS workspaceId,
 o.generation,o.actor_auth_version AS authVersion,p.starter_version AS starterVersion,o.source_model_version_id AS sourceModelVersionId,o.source_model_id AS sourceModelId,o.source_model_version AS sourceModelVersion,o.source_content_ref AS sourceContentRef,o.source_content_sha256 AS sourceContentSha256,o.created_at AS createdAt,o.deadline_at AS deadlineAt`;
type DispatchRow=ProvisioningTask & {state:string};
function taskWithContent(raw:Record<string,unknown>):ProvisioningTask {
  const {sourceModelVersionId,sourceModelId,sourceModelVersion,sourceContentRef,sourceContentSha256,...base}=raw;
  if ([sourceModelVersionId,sourceModelId,sourceModelVersion,sourceContentRef,sourceContentSha256].every(v=>v===null||v===undefined)) return validateWorkspaceTask(base as WorkspaceTask);
  if ([sourceModelVersionId,sourceModelId,sourceModelVersion,sourceContentRef,sourceContentSha256].some(v=>typeof v!=='string')) throw Error('invalid-model-content-freeze');
  return validateWorkspaceTask({...base,modelContent:{modelVersionId:sourceModelVersionId as string,modelId:sourceModelId as string,version:sourceModelVersion as string,contentRef:sourceContentRef as string,contentSha256:sourceContentSha256 as string} satisfies ModelContentRef} as WorkspaceTask);
}

export class ProvisioningCatalog {
  private readonly db:Database;
  constructor(db:Database){this.db=db;}
  /** A repeated processing task is safe only at the DO's idempotent accept
   * boundary, including expired tasks that the DO must record as failed without
   * starting a VM. Unknown outcomes are observation-only, never effect retry. */
  async kickProject(principal:Principal,tenantId:string,projectId:string):Promise<{task:ProvisioningTask;mode:'accept'|'observe'}|null>{
    opaqueId(tenantId);opaqueId(projectId);const now=Date.now();
    await this.db.batch([
      sql(`UPDATE catalog_outbox SET state='processing',attempts=attempts+1,claimed_at=?,deadline_at=?,updated_at=?
       WHERE id IN (SELECT o.id ${joined} WHERE p.id=? AND p.tenant_id=? AND ${current}
       AND p.status='provisioning' AND w.status='provisioning' AND o.state='pending' AND o.available_at<=? AND o.actor_auth_version=?
       AND EXISTS (${ownership}))`,now,now+180000,now,projectId,tenantId,now,principal.authVersion,tenantId,principal.userId,principal.authVersion),
      sql(`UPDATE catalog_creation_intents SET state='dispatched',updated_at=? WHERE project_id=? AND tenant_id=? AND state='pending'
       AND EXISTS (SELECT 1 ${joined} WHERE o.project_id=? AND o.tenant_id=? AND ${current} AND o.state='processing' AND EXISTS (${ownership}))`,
       now,projectId,tenantId,projectId,tenantId,tenantId,principal.userId,principal.authVersion),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
       SELECT 'dispatch:'||o.id,p.owner_user_id,o.tenant_id,'workspace.dispatch','outbox',o.id,'provisioning-claimed','accepted',o.id,?
       ${joined} WHERE o.project_id=? AND o.tenant_id=? AND ${current} AND o.state='processing' AND EXISTS (${ownership})
       AND NOT EXISTS (SELECT 1 FROM catalog_audit_log a WHERE a.id='dispatch:'||o.id)`,now,projectId,tenantId,tenantId,principal.userId,principal.authVersion),
    ]);
    const owned=await this.db.query(sql(`SELECT 1 FROM catalog_projects p WHERE p.id=? AND p.tenant_id=? AND EXISTS (${ownership})`,projectId,tenantId,tenantId,principal.userId,principal.authVersion));
    if(!owned.length)throw new CatalogError('not_found');
    const rows=await this.db.query<DispatchRow>(sql(`SELECT ${taskColumns},o.state ${joined} WHERE p.id=? AND p.tenant_id=? AND ${current}
      AND o.state IN ('processing','unknown') AND o.deadline_at IS NOT NULL AND o.actor_auth_version IS NOT NULL AND EXISTS (${ownership})`,projectId,tenantId,tenantId,principal.userId,principal.authVersion));
    if(!rows[0])return null;const {state,...raw}=rows[0];const task=taskWithContent(raw); 
    return {task,mode:state==='unknown'?'observe':'accept'};
  }

  /** Private scheduled recovery, independent of a browser connection. Original
   * creation authorization is retained even if revoked: the DO records that
   * task's rejection/cleanup instead of executing under a newer credential.
   * Legacy NULL authorization rows remain pending for explicit operator review.
   * available_at gives repeated observations a bounded backoff and fair progress.
   */
  async sweep(limit=10):Promise<Array<{task:ProvisioningTask;mode:'accept'|'observe'}>>{
    if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new CatalogError('invalid_input');
    const now=Date.now();
    const due=await this.db.query<{id:string}>(sql(`SELECT o.id ${joined} WHERE ${current}
     AND p.status='provisioning' AND w.status='provisioning' AND o.state IN ('pending','processing','unknown')
     AND o.actor_auth_version IS NOT NULL AND o.available_at<=? ORDER BY o.available_at,o.id LIMIT ?`,now,limit));
    const tasks:Array<{task:ProvisioningTask;mode:'accept'|'observe'}>=[];
    for(const item of due){
      await this.db.batch([
        sql(`UPDATE catalog_outbox SET state='processing',attempts=attempts+1,claimed_at=?,deadline_at=?,updated_at=?
         WHERE id IN (SELECT o.id ${joined} WHERE o.id=? AND ${current} AND o.state='pending' AND o.actor_auth_version IS NOT NULL
         AND p.status='provisioning' AND w.status='provisioning')`,now,now+180000,now,item.id),
        sql(`UPDATE catalog_creation_intents SET state='dispatched',updated_at=MAX(updated_at,?) WHERE state='pending'
         AND project_id IN (SELECT o.project_id ${joined} WHERE o.id=? AND ${current} AND o.state='processing')`,now,item.id),
        sql(`INSERT INTO catalog_audit_log(id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
         SELECT 'dispatch:'||o.id,p.owner_user_id,o.tenant_id,'workspace.dispatch','outbox',o.id,'provisioning-claimed','accepted',o.id,?
         ${joined} WHERE o.id=? AND ${current} AND o.state='processing'
         AND NOT EXISTS (SELECT 1 FROM catalog_audit_log a WHERE a.id='dispatch:'||o.id)`,now,item.id),
        sql(`UPDATE catalog_outbox SET available_at=?,updated_at=MAX(updated_at,?) WHERE id=? AND state IN ('processing','unknown')`,now+15000,now,item.id),
      ]);
      const rows=await this.db.query<DispatchRow>(sql(`SELECT ${taskColumns},o.state ${joined} WHERE o.id=? AND ${current}
       AND p.status='provisioning' AND w.status='provisioning' AND o.state IN ('processing','unknown')
       AND o.deadline_at IS NOT NULL AND o.actor_auth_version IS NOT NULL`,item.id));
      if(rows[0]){const {state,...raw}=rows[0];tasks.push({task:taskWithContent(raw),mode:state==='unknown'?'observe':'accept'});}
    }
    return tasks;
  }

  /** Trusted DO calls this before dispatch; it is not a public HTTP action. */
  async taskKnown(task:ProvisioningTask):Promise<boolean>{
    const rows=await this.db.query<ProvisioningTask>(sql(`SELECT ${taskColumns} ${joined} WHERE o.id=? AND ${current}
      AND o.state IN ('processing','unknown') AND o.deadline_at IS NOT NULL AND o.actor_auth_version IS NOT NULL`,task.id));
    const row=rows[0]&&taskWithContent(rows[0] as unknown as Record<string,unknown>);return !!row&&JSON.stringify(row)===JSON.stringify(task);
  }

  /** Current authorization is separate from persisted task authenticity. */
  async verifyTask(task:ProvisioningTask):Promise<boolean>{
    const rows=await this.db.query<ProvisioningTask>(sql(`SELECT ${taskColumns} ${joined}
     JOIN catalog_tenants t ON t.id=p.tenant_id JOIN catalog_users u ON u.id=p.owner_user_id
     JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
     WHERE o.id=? AND ${current} AND o.state IN ('processing','unknown') AND t.status='active' AND u.status='active'
     AND m.status='active' AND m.role='owner' AND u.auth_version=o.actor_auth_version`,task.id));
    const row=rows[0]&&taskWithContent(rows[0] as unknown as Record<string,unknown>);return !!row&&JSON.stringify(row)===JSON.stringify(task);
  }

  /** The fixed WorkspaceAgent invokes this via its private Catalog port. No
   * public route accepts a projection. Receipts cannot allocate or retry a VM. */
  async project(input:WorkspaceProjection):Promise<{applied:boolean}>{
    const r=validateProjection(input),hash=await digest(JSON.stringify(r));
    const model=r.runtimeReceipt?.modelContent??null,modelParams=[model?.modelVersionId??null,model?.modelId??null,model?.version??null,model?.contentRef??null,model?.contentSha256??null];
    const status=r.outcome==='ready'?'ready':r.outcome==='unknown'?'provisioning':'failed';
    const outboxState=r.outcome==='ready'?'completed':r.outcome==='unknown'?'unknown':'failed';
    const intentState=r.outcome==='ready'?'completed':r.outcome==='unknown'?'dispatched':'failed';
    // The first INSERT is a durable, scoped CAS admission. All later mutations
    // depend on its exact immutable receipt and execute in the same D1 batch.
    const admitted=`SELECT 1 FROM catalog_provisioning_receipts WHERE receipt_id=? AND outbox_id=? AND sequence=? AND receipt_hash=?`;
    const params=[r.receiptId,r.taskId,r.sequence,hash];
    await this.db.batch([
      sql(`INSERT INTO catalog_provisioning_receipts(receipt_id,outbox_id,sequence,receipt_hash,outcome,created_at)
       SELECT ?,o.id,?,?,?,? ${joined} WHERE o.id=? AND o.tenant_id=? AND o.project_id=? AND o.workspace_id=? AND o.generation=?
       AND ${current} AND o.state IN ('processing','unknown') AND p.status='provisioning' AND w.status='provisioning'
       AND ((o.source_model_version_id IS NULL AND ? IS NULL) OR (o.source_model_version_id=? AND o.source_model_id=? AND o.source_model_version=? AND o.source_content_ref=? AND o.source_content_sha256=?))
       AND o.projection_sequence<? AND o.deadline_at IS NOT NULL AND o.created_at<=?
       AND (?<>'ready' OR EXISTS (SELECT 1 FROM catalog_users u JOIN catalog_tenants t ON t.id=o.tenant_id
        JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id WHERE u.id=p.owner_user_id AND t.owner_user_id=u.id
        AND u.status='active' AND u.auth_version=o.actor_auth_version AND t.status='active' AND m.status='active' AND m.role='owner'))
       AND NOT EXISTS (SELECT 1 FROM catalog_provisioning_receipts WHERE receipt_id=? OR (outbox_id=? AND sequence=?))`,
       r.receiptId,r.sequence,hash,r.outcome,r.updatedAt,r.taskId,r.tenantId,r.projectId,r.workspaceId,r.generation,modelParams[0],...modelParams,r.sequence,r.updatedAt,r.outcome,r.receiptId,r.taskId,r.sequence),
      sql(`UPDATE catalog_projects SET status=?,reason_code=?,updated_at=MAX(updated_at,?) WHERE id=? AND tenant_id=? AND workspace_id=? AND generation=?
       AND status='provisioning' AND EXISTS (${admitted}) AND EXISTS (SELECT 1 FROM catalog_outbox WHERE id=? AND projection_sequence<?)`,
       status,r.reasonCode,r.updatedAt,r.projectId,r.tenantId,r.workspaceId,r.generation,...params,r.taskId,r.sequence),
      sql(`UPDATE catalog_workspaces SET status=?,reason_code=?,updated_at=MAX(updated_at,?) WHERE id=? AND tenant_id=? AND project_id=? AND generation=?
       AND status='provisioning' AND EXISTS (${admitted}) AND EXISTS (SELECT 1 FROM catalog_outbox WHERE id=? AND projection_sequence<?)`,
       status,r.reasonCode,r.updatedAt,r.workspaceId,r.tenantId,r.projectId,r.generation,...params,r.taskId,r.sequence),
      sql(`UPDATE catalog_creation_intents SET state=?,updated_at=MAX(updated_at,?) WHERE project_id=? AND tenant_id=? AND EXISTS (${admitted})
       AND EXISTS (SELECT 1 FROM catalog_outbox WHERE id=? AND projection_sequence<?)`,intentState,r.updatedAt,r.projectId,r.tenantId,...params,r.taskId,r.sequence),
      sql(`INSERT INTO catalog_audit_log(id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
       SELECT 'projection:'||?,?,'workspace.project','workspace',?,?,?, ?,? WHERE EXISTS (${admitted})
       AND NOT EXISTS (SELECT 1 FROM catalog_audit_log WHERE id='projection:'||?)`,
       r.receiptId,r.tenantId,r.workspaceId,r.reasonCode,r.outcome==='ready'?'completed':r.outcome==='unknown'?'unknown':'failed',r.taskId,r.updatedAt,...params,r.receiptId),
      sql(`UPDATE catalog_outbox SET state=?,reason_code=?,projection_sequence=?,updated_at=MAX(updated_at,?),completed_at=?
       WHERE id=? AND tenant_id=? AND project_id=? AND workspace_id=? AND generation=? AND projection_sequence<? AND EXISTS (${admitted})`,
       outboxState,r.reasonCode,r.sequence,r.updatedAt,r.outcome==='unknown'?null:r.updatedAt,r.taskId,r.tenantId,r.projectId,r.workspaceId,r.generation,r.sequence,...params),
    ]);
    const saved=await this.db.query<{receipt_hash:string}>(sql(`SELECT receipt_hash FROM catalog_provisioning_receipts WHERE receipt_id=? AND outbox_id=? AND sequence=?`,r.receiptId,r.taskId,r.sequence));
    if(saved[0]&&saved[0].receipt_hash!==hash)throw new CatalogError('idempotency_conflict');
    return {applied:saved[0]?.receipt_hash===hash};
  }
}
