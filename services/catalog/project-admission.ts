import { CatalogError, opaqueId, type Principal } from './contracts.ts';
import { statement as sql, type Database } from './database.ts';

export const INVITED_PROJECT_POLICY_VERSION = 'accepted-invitation-project-v1';

export interface ProjectCreationAdmission {
  kind: 'accepted-invitation';
  invitationId: string;
  policyVersion: typeof INVITED_PROJECT_POLICY_VERSION;
}

export function projectCreationAdmission(value: unknown): ProjectCreationAdmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('invalid_input');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'invitationId,kind,policyVersion'
    || input.kind !== 'accepted-invitation'
    || input.policyVersion !== INVITED_PROJECT_POLICY_VERSION) throw new CatalogError('invalid_input');
  return {
    kind: input.kind,
    invitationId: opaqueId(input.invitationId),
    policyVersion: input.policyVersion,
  };
}

/**
 * Resolve only ordinary invitations issued through the operator-controlled
 * catalog path. Acceptance is immutable, while current user, Tenant,
 * membership and auth-version state are rechecked for every create request.
 */
export async function acceptedInvitationProjectAdmission(
  db: Database,
  enabled: unknown,
  principal: Principal,
  tenantId: string,
): Promise<ProjectCreationAdmission | null> {
  if (enabled !== 'true') return null;
  opaqueId(tenantId);
  const rows = await db.query<{ invitationId: string }>(sql(`SELECT i.id AS invitationId
    FROM catalog_invitations i
    JOIN catalog_users u ON u.id=i.accepted_by
    JOIN catalog_tenants t ON t.owner_user_id=u.id
    JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
    WHERE i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL
      AND i.accepted_by=? AND u.id=? AND u.status='active' AND u.auth_version=?
      AND t.id=? AND t.kind='personal' AND t.status='active'
      AND m.role='owner' AND m.status='active'
    ORDER BY i.accepted_at,i.id LIMIT 1`,
    principal.userId, principal.userId, principal.authVersion, tenantId));
  if (!rows[0]) return null;
  return projectCreationAdmission({
    kind: 'accepted-invitation',
    invitationId: rows[0].invitationId,
    policyVersion: INVITED_PROJECT_POLICY_VERSION,
  });
}
