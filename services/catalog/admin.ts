import { normalizedEmail } from './admission.ts';
import { statement as sql, type Database } from './database.ts';
import { CatalogError, digest, opaqueId, type Principal } from './contracts.ts';

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired';
export type InvitationAccessState = 'active' | 'revoked' | 'blocked';
export interface InvitationSummary {
  id: string; normalized_email: string; state: InvitationState; created_at: number;
  expires_at: number; accepted_at: number | null; revoked_at: number | null;
  access_state?: InvitationAccessState | null;
}
export interface TenantSummary {
  id: string; status: 'active' | 'suspended' | 'deleting'; created_at: number;
  projects: number; provisioning: number; ready: number; failed: number;
}
export interface AuditSummary {
  id: string; actor_user_id: string | null; tenant_id: string | null;
  action: string; target_type: string; target_id: string; reason_code: string;
  outcome: string; request_id: string; created_at: number;
}
export interface OperatorOverview {
  tenants: number; activeTenants: number; projects: number; provisioningProjects: number;
  failedProjects: number; pendingInvitations: number; unknownOutbox: number; updatedAt: number;
}

const operator = `SELECT 1 FROM catalog_platform_roles r JOIN catalog_users u ON u.id=r.user_id
  WHERE r.user_id=? AND r.role='operator' AND r.status='active'
  AND u.status='active' AND u.auth_version=?`;
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('invalid_input');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) throw new CatalogError('invalid_input');
  return record;
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Platform metadata only. This class has no R2/runtime/content binding. */
export class OperatorCatalog {
  private readonly db: Database;
  private readonly clock: () => number;
  constructor(db: Database, clock: () => number = Date.now) { this.db=db; this.clock=clock; }

  async require(principal: Principal): Promise<void> {
    const rows = await this.db.query(sql(operator, principal.userId, principal.authVersion));
    if (!rows.length) throw new CatalogError('not_found');
  }

  async overview(principal: Principal): Promise<OperatorOverview> {
    await this.require(principal);
    const now=this.clock();
    const rows = await this.db.query<OperatorOverview>(sql(`SELECT
      (SELECT count(*) FROM catalog_tenants) AS tenants,
      (SELECT count(*) FROM catalog_tenants WHERE status='active') AS activeTenants,
      (SELECT count(*) FROM catalog_projects) AS projects,
      (SELECT count(*) FROM catalog_projects WHERE status='provisioning') AS provisioningProjects,
      (SELECT count(*) FROM catalog_projects WHERE status='failed') AS failedProjects,
      (SELECT count(*) FROM catalog_invitations WHERE state='pending' AND expires_at>?) AS pendingInvitations,
      (SELECT count(*) FROM catalog_outbox WHERE state='unknown') AS unknownOutbox,
      ? AS updatedAt WHERE EXISTS (${operator})`, now, now, principal.userId, principal.authVersion));
    if (!rows[0]) throw new CatalogError('not_found');
    return rows[0];
  }

  async tenants(principal: Principal): Promise<TenantSummary[]> {
    await this.require(principal);
    return this.db.query<TenantSummary>(sql(`SELECT t.id,t.status,t.created_at,
      count(p.id) AS projects,
      coalesce(sum(CASE WHEN p.status='provisioning' THEN 1 ELSE 0 END),0) AS provisioning,
      coalesce(sum(CASE WHEN p.status='ready' THEN 1 ELSE 0 END),0) AS ready,
      coalesce(sum(CASE WHEN p.status='failed' THEN 1 ELSE 0 END),0) AS failed
      FROM catalog_tenants t LEFT JOIN catalog_projects p ON p.tenant_id=t.id
      WHERE EXISTS (${operator}) GROUP BY t.id,t.status,t.created_at
      ORDER BY t.created_at DESC,t.id LIMIT 100`, principal.userId, principal.authVersion));
  }

  async invitations(principal: Principal): Promise<InvitationSummary[]> {
    await this.require(principal);
    const now = this.clock();
    return this.db.query<InvitationSummary>(sql(`SELECT id,normalized_email,
      CASE WHEN state='pending' AND expires_at<=? THEN 'expired' ELSE state END AS state,
      created_at,expires_at,accepted_at,revoked_at,
      CASE WHEN state<>'accepted' THEN NULL
        WHEN EXISTS (SELECT 1 FROM catalog_platform_roles r WHERE r.user_id=accepted_by AND r.status='active') THEN 'blocked'
        WHEN EXISTS (SELECT 1 FROM catalog_users u JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal'
          JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner'
          WHERE u.id=accepted_by AND u.status='active' AND t.status='active' AND m.status='active') THEN 'active'
        WHEN EXISTS (SELECT 1 FROM catalog_users u JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal'
          JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner'
          WHERE u.id=accepted_by AND u.status='revoked' AND t.status='active' AND m.status='active'
          AND EXISTS (SELECT 1 FROM catalog_audit_log ai JOIN catalog_audit_log au ON au.request_id=ai.request_id
            WHERE ai.action='invitation.access.revoke' AND ai.target_type='invitation' AND ai.target_id=catalog_invitations.id
            AND au.action='user.access.revoke' AND au.target_type='user' AND au.target_id=u.id
            AND ai.request_id=catalog_invitations.id||':access:revoke:'||u.auth_version)) THEN 'revoked'
        ELSE 'blocked' END AS access_state
      FROM catalog_invitations WHERE EXISTS (${operator}) ORDER BY created_at DESC,id LIMIT 100`, now, principal.userId, principal.authVersion));
  }

  async audit(principal: Principal): Promise<AuditSummary[]> {
    await this.require(principal);
    return this.db.query<AuditSummary>(sql(`SELECT id,actor_user_id,tenant_id,action,target_type,target_id,
      reason_code,outcome,request_id,created_at FROM (
        SELECT id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at FROM catalog_audit_log
        UNION ALL
        SELECT id,actor_user_id,NULL AS tenant_id,action,'model' AS target_type,model_version_id AS target_id,reason_code,outcome,request_id,created_at FROM catalog_model_audit_log
      ) WHERE EXISTS (${operator}) ORDER BY created_at DESC,id LIMIT 100`, principal.userId, principal.authVersion));
  }

  async issue(principal: Principal, key: string, value: unknown): Promise<{ invitation: InvitationSummary; token: string | null; replayed: boolean }> {
    opaqueId(key);
    const input = exactObject(value, ['email', 'expiresInDays']);
    if (typeof input.email !== 'string') throw new CatalogError('invalid_input');
    const email = normalizedEmail(input.email);
    if (!Number.isSafeInteger(input.expiresInDays) || (input.expiresInDays as number) < 1 || (input.expiresInDays as number) > 30) throw new CatalogError('invalid_input');
    const expiresInDays = input.expiresInDays as number;
    const payloadHash = await digest(JSON.stringify({ email, expiresInDays }));
    const invitationId = crypto.randomUUID(), intentId = crypto.randomUUID(), requestId = crypto.randomUUID();
    const token = randomToken(), tokenHash = await digest(token), now = this.clock(), expiresAt = now + expiresInDays * 86_400_000;
    const noIntent = `NOT EXISTS (SELECT 1 FROM catalog_operator_intents WHERE actor_user_id=? AND operation='invitation.issue' AND idempotency_key=?)`;
    await this.db.batch([
      sql(`INSERT INTO catalog_invitations(id,token_hash,normalized_email,state,issued_by,created_at,expires_at)
        SELECT ?,?,?,'pending',?,?,? WHERE EXISTS (${operator}) AND ${noIntent}`,
        invitationId, tokenHash, email, principal.userId, now, expiresAt,
        principal.userId, principal.authVersion, principal.userId, key),
      sql(`INSERT INTO catalog_operator_intents(id,actor_user_id,operation,idempotency_key,payload_hash,invitation_id,created_at)
        SELECT ?,?,'invitation.issue',?,?,id,? FROM catalog_invitations WHERE id=?`,
        intentId, principal.userId, key, payloadHash, now, invitationId),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
        SELECT ?,?,'invitation.issue','invitation',id,'operator_requested','completed',?,?
        FROM catalog_invitations WHERE id=?`, crypto.randomUUID(), principal.userId, requestId, now, invitationId),
    ]);
    const rows = await this.db.query<InvitationSummary & { payload_hash: string }>(sql(`SELECT i.id,i.normalized_email,i.state,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,x.payload_hash
      FROM catalog_operator_intents x JOIN catalog_invitations i ON i.id=x.invitation_id
      WHERE x.actor_user_id=? AND x.operation='invitation.issue' AND x.idempotency_key=? AND EXISTS (${operator})`,
      principal.userId, key, principal.userId, principal.authVersion));
    if (!rows[0]) throw new CatalogError('not_found');
    if (rows[0].payload_hash !== payloadHash) throw new CatalogError('idempotency_conflict');
    const { payload_hash: _, ...invitation } = rows[0];
    const replayed = invitation.id !== invitationId;
    return { invitation, token: replayed ? null : token, replayed };
  }

  async revoke(principal: Principal, invitationId: string, value: unknown): Promise<InvitationSummary> {
    opaqueId(invitationId);
    exactObject(value, []);
    const now = this.clock(), requestId = crypto.randomUUID();
    await this.db.batch([
      sql(`UPDATE catalog_invitations SET state='revoked',revoked_at=? WHERE id=? AND state='pending'
        AND EXISTS (${operator})`, now, invitationId, principal.userId, principal.authVersion),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
        SELECT ?,?,'invitation.revoke','invitation',id,'operator_requested','completed',?,?
        FROM catalog_invitations WHERE id=? AND state='revoked' AND revoked_at=?
        AND EXISTS (${operator})
        AND NOT EXISTS (SELECT 1 FROM catalog_audit_log WHERE action='invitation.revoke' AND target_type='invitation' AND target_id=?)`,
        crypto.randomUUID(), principal.userId, requestId, now, invitationId, now,
        principal.userId, principal.authVersion, invitationId),
    ]);
    const rows = await this.db.query<InvitationSummary>(sql(`SELECT id,normalized_email,state,created_at,expires_at,accepted_at,revoked_at
      FROM catalog_invitations WHERE id=? AND state='revoked' AND EXISTS (${operator})`, invitationId, principal.userId, principal.authVersion));
    if (!rows[0]) throw new CatalogError('not_found');
    return rows[0];
  }

  async access(principal: Principal, invitationId: string, value: unknown): Promise<InvitationSummary> {
    opaqueId(invitationId);
    const input=exactObject(value,['action']),action=input.action;
    if(action!=='revoke'&&action!=='restore')throw new CatalogError('invalid_input');
    const now=this.clock();
    const revokeProof=`EXISTS (SELECT 1 FROM catalog_audit_log ai JOIN catalog_audit_log au ON au.request_id=ai.request_id
      WHERE ai.action='invitation.access.revoke' AND ai.target_type='invitation' AND ai.target_id=i.id
      AND au.action='user.access.revoke' AND au.target_type='user' AND au.target_id=u.id
      AND ai.request_id=i.id||':access:revoke:'||u.auth_version)`;
    const target=`SELECT i.accepted_by FROM catalog_invitations i
      JOIN catalog_users u ON u.id=i.accepted_by
      JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal' AND t.status='active'
      JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner' AND m.status='active'
      WHERE i.id=? AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL
      AND i.accepted_by<>? AND NOT EXISTS (SELECT 1 FROM catalog_platform_roles r WHERE r.user_id=i.accepted_by AND r.status='active')
      ${action==='restore'?`AND ${revokeProof}`:''}`;
    const toStatus=action==='revoke'?'revoked':'active';
    const userUpdate=action==='revoke'
      ? `UPDATE catalog_users SET status='revoked',auth_version=auth_version+1,updated_at=?
        WHERE id=(${target}) AND status='active' AND EXISTS (${operator})`
      : `UPDATE catalog_users SET status='active',updated_at=?
        WHERE id=(${target}) AND status='revoked' AND EXISTS (${operator})`;
    const actionName=`invitation.access.${action}`,userAction=`user.access.${action}`;
    const reasonCode=`accepted-invitation-access-${action}-v1`;
    const updateValues=[now,invitationId,principal.userId,principal.userId,principal.authVersion];
    await this.db.batch([
      sql(userUpdate,...updateValues),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
        SELECT ?,?,t.id,?,'invitation',i.id,?,'completed',i.id||':access:${action}:'||u.auth_version,?
        FROM catalog_invitations i JOIN catalog_users u ON u.id=i.accepted_by
        JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal' AND t.status='active'
        JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner' AND m.status='active'
        WHERE i.id=? AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL
        AND i.accepted_by<>? AND u.status=? AND u.updated_at=? AND EXISTS (${operator})
        AND NOT EXISTS (SELECT 1 FROM catalog_platform_roles r WHERE r.user_id=i.accepted_by AND r.status='active')
        AND NOT EXISTS (SELECT 1 FROM catalog_audit_log a WHERE a.action=? AND a.target_type='invitation' AND a.target_id=i.id
          AND a.request_id=i.id||':access:${action}:'||u.auth_version)`,
        crypto.randomUUID(),principal.userId,actionName,reasonCode,now,invitationId,principal.userId,toStatus,now,
        principal.userId,principal.authVersion,actionName),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,tenant_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
        SELECT ?,?,t.id,?,'user',u.id,?,'completed',i.id||':access:${action}:'||u.auth_version,?
        FROM catalog_invitations i JOIN catalog_users u ON u.id=i.accepted_by
        JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal' AND t.status='active'
        JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner' AND m.status='active'
        WHERE i.id=? AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL
        AND i.accepted_by<>? AND u.status=? AND u.updated_at=? AND EXISTS (${operator})
        AND NOT EXISTS (SELECT 1 FROM catalog_platform_roles r WHERE r.user_id=i.accepted_by AND r.status='active')
        AND NOT EXISTS (SELECT 1 FROM catalog_audit_log a WHERE a.action=? AND a.target_type='user' AND a.target_id=u.id
          AND a.request_id=i.id||':access:${action}:'||u.auth_version)`,
        crypto.randomUUID(),principal.userId,userAction,reasonCode,now,invitationId,principal.userId,toStatus,now,
        principal.userId,principal.authVersion,userAction),
    ]);
    const rows=await this.db.query<InvitationSummary>(sql(`SELECT i.id,i.normalized_email,i.state,i.created_at,i.expires_at,i.accepted_at,i.revoked_at,? AS access_state
      FROM catalog_invitations i JOIN catalog_users u ON u.id=i.accepted_by
      JOIN catalog_tenants t ON t.owner_user_id=u.id AND t.kind='personal' AND t.status='active'
      JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id AND m.role='owner' AND m.status='active'
      WHERE i.id=? AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL
      AND i.accepted_by<>? AND u.status=? AND NOT EXISTS (SELECT 1 FROM catalog_platform_roles r WHERE r.user_id=i.accepted_by AND r.status='active')
      AND EXISTS (SELECT 1 FROM catalog_audit_log ai JOIN catalog_audit_log au ON au.request_id=ai.request_id
        WHERE ai.action=? AND ai.target_type='invitation' AND ai.target_id=i.id
        AND au.action=? AND au.target_type='user' AND au.target_id=u.id
        AND ai.request_id=i.id||':access:${action}:'||u.auth_version)
      AND EXISTS (${operator})`,toStatus,invitationId,principal.userId,toStatus,actionName,userAction,principal.userId,principal.authVersion));
    if(!rows[0])throw new CatalogError('not_found');
    return rows[0];
  }
}
