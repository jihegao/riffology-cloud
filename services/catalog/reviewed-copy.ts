import {statement as sql,type Database} from './database.ts';
import {actor as checkedActor,scope as checkedScope,type TurnActor,type TurnScope} from '../turn/protocol.ts';

export type ReviewedCopySource={modelVersionId:string;modelId:string;version:string;contentSha256:string;revisionId:string;filesSha256:string;specSha256:string};
export type ReviewedCopyAdmission={schemaVersion:1;mode:'reviewed-copy-first-run';allowed:boolean;scope:TurnScope;source:ReviewedCopySource;maxDistinctRuns:1};
export type ManagedSimulationAdmission=(ReviewedCopyAdmission&{remainingDistinctRuns:number})|{schemaVersion:1;mode:'existing-managed-budget';allowed:boolean;scope:TurnScope;maxDistinctRuns:number|null;remainingDistinctRuns:number|null};

/** Primary-catalog authorization only. This helper never writes or repairs rows. */
export async function reviewedCopySimulationAdmission(db:Database,rawScope:TurnScope,rawActor:TurnActor):Promise<ReviewedCopyAdmission>{
 const target=checkedScope(rawScope),actor=checkedActor(rawActor);
 const rows=await db.query<ReviewedCopySource>(sql(`SELECT p.source_model_version_id AS modelVersionId,p.source_model_id AS modelId,p.source_model_version AS version,
   p.source_digest AS contentSha256,json_extract(s.snapshot_json,'$.version.revisionId') AS revisionId,
   json_extract(s.snapshot_json,'$.version.filesSha256') AS filesSha256,json_extract(s.snapshot_json,'$.version.specSha256') AS specSha256
  FROM catalog_projects p
  JOIN catalog_workspaces w ON w.id=p.workspace_id AND w.project_id=p.id AND w.tenant_id=p.tenant_id AND w.owner_user_id=p.owner_user_id AND w.generation=p.generation
  JOIN catalog_model_versions mv ON mv.id=p.source_model_version_id AND mv.model_id=p.source_model_id AND mv.version=p.source_model_version AND mv.content_sha256=p.source_digest
  JOIN catalog_model_submissions s ON s.model_version_id=mv.id AND s.model_id=mv.model_id AND s.version=mv.version
  WHERE p.id=? AND p.tenant_id=? AND p.workspace_id=? AND p.generation=? AND p.owner_user_id=?
   AND p.status='ready' AND w.status='ready' AND p.archived_at IS NULL
   AND mv.status='published' AND mv.created_by=? AND s.status='published' AND s.reviewed_by=? AND s.created_by<>?
   AND json_extract(s.snapshot_json,'$.contentSha256')=mv.content_sha256
   AND json_extract(s.snapshot_json,'$.version.filesSha256') IS NOT NULL
   AND json_extract(s.snapshot_json,'$.version.specSha256') IS NOT NULL
   AND EXISTS(SELECT 1 FROM catalog_users u JOIN catalog_tenants t ON t.owner_user_id=u.id JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
    WHERE u.id=? AND u.status='active' AND u.auth_version=? AND t.id=p.tenant_id AND t.status='active' AND m.role='owner' AND m.status='active')
   AND EXISTS(SELECT 1 FROM catalog_platform_roles r JOIN catalog_users u ON u.id=r.user_id
    WHERE r.user_id=? AND r.role='operator' AND r.status='active' AND u.status='active' AND u.auth_version=?)
   AND EXISTS(SELECT 1 FROM catalog_submission_reviews sr WHERE sr.submission_id=s.id AND sr.actor_user_id=? AND sr.decision='approve')`,
   target.projectId,target.tenantId,target.workspaceId,target.workspaceGeneration,actor.userId,
   actor.userId,actor.userId,actor.userId,actor.userId,actor.authVersion,actor.userId,actor.authVersion,actor.userId));
 if(rows.length!==1)throw Error('managed-reviewed-copy-denied');
 const source=rows[0]!;
 if(![source.modelVersionId,source.modelId,source.version,source.revisionId,source.contentSha256,source.filesSha256,source.specSha256].every(value=>typeof value==='string')||
  !source.modelVersionId||!source.modelId||!source.version||![source.contentSha256,source.filesSha256,source.specSha256].every(value=>/^[a-f0-9]{64}$/.test(value))||!/^[A-Za-z0-9_-]{1,128}$/.test(source.revisionId))throw Error('managed-reviewed-copy-denied');
 return {schemaVersion:1,mode:'reviewed-copy-first-run',allowed:true,scope:target,source,maxDistinctRuns:1};
}
