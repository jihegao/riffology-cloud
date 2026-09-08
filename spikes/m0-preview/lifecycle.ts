import type { BrowserResult } from './browser.ts';
import type { Scope } from './policy.ts';

export interface AccessAuthority {
  nowSeconds(): number;
  scopeActive(scope: Scope): boolean;
  sessionRevoked(sid: string): boolean;
  lookup(scope: Scope, access: string): Promise<BrowserResult>;
}
/** This final check is synchronous. Call it again after awaiting this helper,
 * immediately before returning content, registering sockets or sending bytes. */
export function accessStillAllowed(authority: AccessAuthority, scope: Scope, result: BrowserResult | null): result is BrowserResult & { sid: string; expires_at: number } {
  return !!result?.ok && typeof result.sid === 'string' && typeof result.expires_at === 'number' && result.expires_at > authority.nowSeconds() && !authority.sessionRevoked(result.sid) && authority.scopeActive(scope);
}
export async function resolveBrowserAccess(authority: AccessAuthority, scope: Scope, access: string): Promise<BrowserResult | null> {
  if (!authority.scopeActive(scope)) return null;
  const result = await authority.lookup(scope, access);
  // The central DO can return a pre-logout snapshot after closeSession has run.
  // The coordinator's own persisted fence overrides that delayed snapshot.
  return accessStillAllowed(authority, scope, result) ? result : null;
}
