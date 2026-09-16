import { statement as sql, type Database } from './database.ts';
import { CatalogError, createProjectInput, digest, opaqueId, type Principal, type Project } from './contracts.ts';
import type { TurnScope } from '../turn/protocol.ts';
import type { ModelCatalog } from './models.ts';
export type ProjectBudgetRoute={kind:'g5';taskKey:string;windowId:string;profileSha256:string};
export function projectBudgetRoute(raw:unknown):ProjectBudgetRoute {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new CatalogError('invalid_input');
  const r=raw as ProjectBudgetRoute;
  if(Object.keys(r).sort().join(',')!=='kind,profileSha256,taskKey,windowId'||r.kind!=='g5'||!/^[a-f0-9]{64}$/.test(r.taskKey)||!/^[a-f0-9]{64}$/.test(r.profileSha256)||typeof r.windowId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(r.windowId))throw new CatalogError('invalid_input');
  return {kind:'g5',taskKey:r.taskKey,windowId:r.windowId,profileSha256:r.profileSha256};
}

// Every operation rechecks current membership and revocation inside its SQL statement.
const ownership = `SELECT 1 FROM catalog_memberships m JOIN catalog_users u ON u.id=m.user_id
  JOIN catalog_tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND m.role='owner'
  AND u.status='active' AND u.auth_version=? AND t.status='active' AND t.owner_user_id=u.id`;
const correlatedOwnership = `SELECT 1 FROM catalog_memberships m JOIN catalog_users u ON u.id=m.user_id
  JOIN catalog_tenants t ON t.id=m.tenant_id
  WHERE m.tenant_id=p.tenant_id AND m.user_id=? AND m.status='active' AND m.role='owner'
  AND u.status='active' AND u.auth_version=? AND t.status='active' AND t.owner_user_id=u.id`;
const projectColumns = `p.id,p.tenant_id,p.workspace_id,p.title,p.starter_version,p.source_model_version_id,p.source_model_id,p.source_model_version,p.source_digest,p.status,p.generation,p.created_at,p.updated_at`;

export class ProjectCatalog {
  private readonly db: Database;
  private readonly starters: ReadonlySet<string>;
  private readonly models?: ModelCatalog;
  constructor(db: Database, allowedStarters: ReadonlySet<string>, models?: ModelCatalog) { this.db = db; this.starters = allowedStarters; this.models=models; }

  async list(principal: Principal, tenantId: string): Promise<Project[]> {
    opaqueId(tenantId);
    const allowed = await this.db.query(sql(ownership, tenantId, principal.userId, principal.authVersion));
    if (!allowed.length) throw new CatalogError('not_found');
    return this.db.query<Project>(sql(`SELECT ${projectColumns} FROM catalog_projects p WHERE p.tenant_id=?
      AND EXISTS (${ownership}) ORDER BY p.created_at DESC,p.id LIMIT 100`, tenantId, tenantId, principal.userId, principal.authVersion));
  }

  async get(principal: Principal, tenantId: string, projectId: string): Promise<Project> {
    opaqueId(tenantId); opaqueId(projectId);
    const rows = await this.db.query<Project>(sql(`SELECT ${projectColumns} FROM catalog_projects p
      WHERE p.id=? AND p.tenant_id=? AND EXISTS (${ownership})`, projectId, tenantId, tenantId, principal.userId, principal.authVersion));
    if (!rows[0]) throw new CatalogError('not_found');
    return rows[0];
  }

  private async resolveWorkspace(principal:Principal,workspaceId:string,requireReady:boolean):Promise<TurnScope>{
    opaqueId(workspaceId);
    const rows=await this.db.query<{tenantId:string;projectId:string;workspaceId:string;workspaceGeneration:number;projectGeneration:number;projectStatus:string;workspaceStatus:string}>(sql(`SELECT p.tenant_id AS tenantId,p.id AS projectId,w.id AS workspaceId,
      w.generation AS workspaceGeneration,p.generation AS projectGeneration,p.status AS projectStatus,w.status AS workspaceStatus
      FROM catalog_workspaces w JOIN catalog_projects p ON p.id=w.project_id AND p.tenant_id=w.tenant_id AND p.workspace_id=w.id
      WHERE w.id=? AND p.generation=w.generation AND EXISTS (${correlatedOwnership})`,workspaceId,principal.userId,principal.authVersion));
    const row=rows[0];if(!row)throw new CatalogError('not_found');
    if(requireReady&&(row.projectStatus!=='ready'||row.workspaceStatus!=='ready'))throw new CatalogError('not_ready');
    return {tenantId:row.tenantId,projectId:row.projectId,workspaceId:row.workspaceId,workspaceGeneration:row.workspaceGeneration};
  }

  async workspace(principal:Principal,workspaceId:string):Promise<TurnScope>{
    return this.resolveWorkspace(principal,workspaceId,true);
  }

  async maintenanceWorkspace(principal:Principal,workspaceId:string):Promise<TurnScope>{
    return this.resolveWorkspace(principal,workspaceId,false);
  }

  async create(principal: Principal, tenantId: string, key: string, body: unknown, budgetRoute?:ProjectBudgetRoute): Promise<{ project: Project; replayed: boolean }> {
    opaqueId(tenantId); opaqueId(key);
    const input = createProjectInput(body, this.starters);
    const route=budgetRoute===undefined?undefined:projectBudgetRoute(budgetRoute);
    // Replay the original intent before resolving the current model status. A
    // withdrawn model must not make an already committed copy unreplayable.
    const prior = await this.db.query<{project_id:string;payload_hash:string;title:string;source_model_id:string|null;source_model_version:string|null}>(sql(`SELECT i.project_id,i.payload_hash,p.title,p.source_model_id,p.source_model_version FROM catalog_creation_intents i JOIN catalog_projects p ON p.id=i.project_id AND p.tenant_id=i.tenant_id WHERE i.actor_user_id=? AND i.tenant_id=? AND i.operation='project.create' AND i.idempotency_key=? AND EXISTS (${ownership})`,principal.userId,tenantId,key,tenantId,principal.userId,principal.authVersion));
    if (prior[0]) {
      if(route){const saved=await this.db.query<{route_json:string}>(sql('SELECT route_json FROM catalog_project_budget_routes WHERE project_id=? AND tenant_id=?',prior[0].project_id,tenantId));if(!saved[0]||saved[0].route_json!==JSON.stringify(route))throw new CatalogError('idempotency_conflict');}
      const replayInput = input.modelId ? {title:input.title,modelId:prior[0].source_model_id,modelVersion:prior[0].source_model_version} : {title:input.title,starterVersion:input.starterVersion};
      if ((await digest(JSON.stringify(replayInput))) !== prior[0].payload_hash) throw new CatalogError('idempotency_conflict');
      return {project:await this.get(principal,tenantId,prior[0].project_id),replayed:true};
    }
    const requestedInput={...input};
    let source:{id:string;modelId:string;version:string;digest:string}|null=null;
    if (input.modelId) { if (!this.models) throw new CatalogError('not_found'); const m=await this.models.getPublished(input.modelId,input.modelVersion!); source={id:m.id,modelId:m.model_id,version:m.version,digest:m.content_sha256}; input.starterVersion=m.starter_version; }
    const payloadHash = await digest(JSON.stringify(requestedInput));
    const projectId = crypto.randomUUID(), workspaceId = crypto.randomUUID(), intentId = crypto.randomUUID();
    const outboxId = crypto.randomUUID(), now = Date.now();
    // A D1 batch commits these changes together. Concurrent same-key requests only let
    // one generated project enter; losers read the winner without replaying provisioning.
    const existing = `SELECT 1 FROM catalog_creation_intents WHERE actor_user_id=? AND tenant_id=? AND operation='project.create' AND idempotency_key=?`;
    await this.db.batch([
      sql(`INSERT INTO catalog_projects(id,tenant_id,owner_user_id,workspace_id,title,starter_version,source_model_version_id,source_model_id,source_model_version,source_digest,status,generation,created_at,updated_at)
        SELECT ?,?,?,?, ?,?,?,?,?,?,'provisioning',1,?,? WHERE EXISTS (${ownership}) AND NOT EXISTS (${existing}) AND (?
          OR EXISTS (SELECT 1 FROM catalog_model_versions mv WHERE mv.id=? AND mv.model_id=? AND mv.version=? AND mv.status='published' AND mv.starter_version=? AND mv.content_sha256=?))`,
        projectId, tenantId, principal.userId, workspaceId, input.title, input.starterVersion??null, source?.id??null, source?.modelId??null, source?.version??null, source?.digest??null, now, now,
        tenantId, principal.userId, principal.authVersion, principal.userId, tenantId, key, source===null?1:0, source?.id??null, source?.modelId??null, source?.version??null, input.starterVersion??null, source?.digest??null),
      sql(`INSERT INTO catalog_workspaces(id,project_id,tenant_id,owner_user_id,generation,status,created_at,updated_at)
        SELECT workspace_id,id,tenant_id,owner_user_id,generation,'provisioning',?,? FROM catalog_projects WHERE id=?`, now, now, projectId),
      sql(`INSERT INTO catalog_project_budget_routes(project_id,tenant_id,route_json) SELECT id,tenant_id,? FROM catalog_projects WHERE id=? AND ? IS NOT NULL`,route?JSON.stringify(route):null,projectId,route?JSON.stringify(route):null),
      sql(`INSERT INTO catalog_creation_intents(id,actor_user_id,tenant_id,operation,idempotency_key,payload_hash,project_id,state,created_at,updated_at)
        SELECT ?,owner_user_id,tenant_id,'project.create',?,?,id,'pending',?,? FROM catalog_projects WHERE id=?`, intentId,key,payloadHash,now,now,projectId),
      sql(`INSERT INTO catalog_outbox(id,project_id,workspace_id,tenant_id,generation,kind,state,attempts,available_at,created_at,updated_at,actor_auth_version,source_model_version_id,source_model_id,source_model_version,source_content_ref,source_content_sha256)
        SELECT ?,p.id,p.workspace_id,p.tenant_id,p.generation,'workspace.provision','pending',0,?,?,?, ?,p.source_model_version_id,p.source_model_id,p.source_model_version,m.content_ref,m.content_sha256 FROM catalog_projects p LEFT JOIN catalog_model_versions m ON m.id=p.source_model_version_id WHERE p.id=?`, outboxId,now,now,now,principal.authVersion,projectId),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,tenant_id,reason_code,outcome,request_id,created_at)
        SELECT ?,owner_user_id,?,'project',id,tenant_id,'owner-request','accepted',?,? FROM catalog_projects WHERE id=?`,crypto.randomUUID(),source?'project.copy':'project.create',intentId,now,projectId),
    ]);
    const rows = await this.db.query<{project_id: string; payload_hash: string}>(sql(`SELECT project_id,payload_hash FROM catalog_creation_intents
      WHERE actor_user_id=? AND tenant_id=? AND operation='project.create' AND idempotency_key=? AND EXISTS (${ownership})`,
      principal.userId, tenantId, key, tenantId, principal.userId, principal.authVersion));
    if (!rows[0]) throw new CatalogError('not_found');
    if (rows[0].payload_hash !== payloadHash) throw new CatalogError('idempotency_conflict');
    return { project: await this.get(principal, tenantId, rows[0].project_id), replayed: rows[0].project_id !== projectId };
  }
}
