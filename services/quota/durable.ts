import { DurableObject } from 'cloudflare:workers';
import { SqlTenantQuota, quotaIdentifier, readTenantNativeExecutionQuiet, type LeaseRequest, type LeaseReference, type StopConfirmation } from './core.ts';
export interface TenantQuotaEnv {
  TENANT_QUOTA: DurableObjectNamespace<TenantQuota>;
  TENANT_QUOTA_CAPACITY: string;
  TENANT_QUOTA_POLICY_VERSION: string;
  TENANT_QUOTA_UPGRADE_FROM?:string;
}
export function tenantQuotaName(tenantId: string): string { quotaIdentifier(tenantId); return `tenant-quota:${tenantId}`; }

/** Internal RPC only. Gateway/WorkspaceAgent owns membership and scope checks;
 * runtime supervision owns stop confirmation. Never bind this to project code
 * or forward public request bodies into its RPC methods. */
export class TenantQuota extends DurableObject<TenantQuotaEnv> {
  #core: SqlTenantQuota | null = null;
  #tenantId: string | null = null;
  #forTenant(tenantId: string): SqlTenantQuota {
    const expected = this.env.TENANT_QUOTA.idFromName(tenantQuotaName(tenantId));
    if (!expected.equals(this.ctx.id)) throw Error('quota-actor-scope-denied');
    if (this.#tenantId !== null && this.#tenantId !== tenantId) throw Error('quota-tenant-conflict');
    if (!this.#core) {
      const capacity = this.env.TENANT_QUOTA_CAPACITY;
      if (typeof capacity !== 'string' || !/^(?:[1-9]|[1-5][0-9]|6[0-4])$/.test(capacity)) throw Error('invalid-quota-capacity');
      this.#core = new SqlTenantQuota(this.ctx.storage, { tenantId, capacity: Number(capacity), version: this.env.TENANT_QUOTA_POLICY_VERSION });
      this.#tenantId = tenantId;
    }
    return this.#core;
  }
  async acquire(request: LeaseRequest) { const core=this.#forTenant(request.tenantId);if(this.env.TENANT_QUOTA_UPGRADE_FROM)await core.upgradePolicyFrom(this.env.TENANT_QUOTA_UPGRADE_FROM);return core.acquire(request); }
  async dispatch(reference: LeaseReference) { return this.#forTenant(reference.tenantId).dispatch(reference); }
  async markUnknown(reference: LeaseReference) { return this.#forTenant(reference.tenantId).markUnknown(reference); }
  async confirmStopped(reference: LeaseReference, confirmation: StopConfirmation) { return this.#forTenant(reference.tenantId).confirmStopped(reference, confirmation); }
  async snapshot(tenantId: string) { return this.#forTenant(tenantId).snapshot(); }
  async assertNativeExecutionQuiet(tenantId:string){if(!this.env.TENANT_QUOTA.idFromName(tenantQuotaName(tenantId)).equals(this.ctx.id))throw Error('quota-actor-scope-denied');return readTenantNativeExecutionQuiet(this.ctx.storage,tenantId);}
  async lookup(tenantId: string, operationId: string) { return this.#forTenant(tenantId).lookup(operationId); }
  async reconcile(tenantId: string) { return this.#forTenant(tenantId).reconcile(); }
}
