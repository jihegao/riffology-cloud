import { statement as sql, type Database } from './database.ts';
import { CatalogError, digest, type Principal } from './contracts.ts';

export interface VerifiedIdentity { subject: string; email: string; emailVerified: boolean; platformVersion: number; browserSession?:{sessionId:string;expiresAt:number} }
const issuer = 'better-auth';
export function normalizedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new CatalogError('invalid_input');
  return normalized;
}
export class Admission {
  private readonly db: Database;
  constructor(db: Database) { this.db = db; }
  async principal(identity: VerifiedIdentity): Promise<Principal> {
    if (!identity.emailVerified) throw new CatalogError('not_found');
    const rows=await this.db.query<{id:string;auth_version:number}>(sql(`SELECT id,auth_version FROM catalog_users WHERE identity_issuer=? AND identity_subject=? AND status='active' AND auth_version=?`,issuer,identity.subject,identity.platformVersion));
    if(!rows[0])throw new CatalogError('not_found');
    return {userId:rows[0].id,authVersion:rows[0].auth_version};
  }
  async accept(identity: VerifiedIdentity, token: unknown): Promise<{tenantId:string}> {
    if(!identity.emailVerified || identity.platformVersion!==1 || typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token))throw new CatalogError('not_found');
    const email=normalizedEmail(identity.email),tokenHash=await digest(token),now=Date.now(),userId=crypto.randomUUID(),tenantId=crypto.randomUUID();
    // Token possession alone is insufficient: the verified provider email must match.
    // Account identity, invitation consumption and personal Tenant commit together.
    await this.db.batch([
      sql(`INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM catalog_invitations WHERE token_hash=? AND normalized_email=? AND state='pending' AND expires_at>?)
        AND NOT EXISTS (SELECT 1 FROM catalog_users WHERE identity_issuer=? AND identity_subject=?)`,userId,issuer,identity.subject,email,now,now,tokenHash,email,now,issuer,identity.subject),
      sql(`UPDATE catalog_invitations SET state='accepted',accepted_by=(SELECT id FROM catalog_users WHERE identity_issuer=? AND identity_subject=? AND status='active' AND normalized_email=?),accepted_at=?
        WHERE token_hash=? AND normalized_email=? AND state='pending' AND expires_at>?
        AND EXISTS (SELECT 1 FROM catalog_users WHERE identity_issuer=? AND identity_subject=? AND status='active' AND auth_version=? AND normalized_email=?)`,
        issuer,identity.subject,email,now,tokenHash,email,now,issuer,identity.subject,identity.platformVersion,email),
      sql(`INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at)
        SELECT ?,u.id,?,? FROM catalog_users u JOIN catalog_invitations i ON i.accepted_by=u.id WHERE u.identity_issuer=? AND u.identity_subject=? AND i.token_hash=? AND i.state='accepted'
        AND NOT EXISTS (SELECT 1 FROM catalog_tenants WHERE owner_user_id=u.id)`,tenantId,now,now,issuer,identity.subject,tokenHash),
      sql(`INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at)
        SELECT t.id,t.owner_user_id,?,? FROM catalog_tenants t WHERE t.id=?`,now,now,tenantId),
      sql(`INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,tenant_id,reason_code,outcome,request_id,created_at)
        SELECT ?,t.owner_user_id,'invitation.accept','invitation',i.id,t.id,'verified-email-and-token','completed',?,?
        FROM catalog_tenants t JOIN catalog_invitations i ON i.accepted_by=t.owner_user_id
        JOIN catalog_users u ON u.id=t.owner_user_id WHERE i.token_hash=? AND i.state='accepted'
        AND u.identity_issuer=? AND u.identity_subject=?
        AND NOT EXISTS (SELECT 1 FROM catalog_audit_log a WHERE a.action='invitation.accept' AND a.target_type='invitation' AND a.target_id=i.id)`,crypto.randomUUID(),crypto.randomUUID(),now,tokenHash,issuer,identity.subject),
    ]);
    const principal=await this.principal(identity);
    const rows=await this.db.query<{id:string}>(sql(`SELECT t.id FROM catalog_tenants t JOIN catalog_invitations i ON i.accepted_by=t.owner_user_id
      JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=t.owner_user_id
      WHERE t.owner_user_id=? AND t.status='active' AND m.status='active' AND i.token_hash=? AND i.state='accepted'`,principal.userId,tokenHash));
    if(!rows[0])throw new CatalogError('not_found');
    return {tenantId:rows[0].id};
  }
}
