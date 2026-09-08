export const TENANTS = ['alpha', 'bravo'] as const;
export const KINDS = ['workspace', 'artifact'] as const;
export type Tenant = (typeof TENANTS)[number];
export type Kind = (typeof KINDS)[number];

const RUN_ID = /^[a-z0-9][a-z0-9-]{7,47}$/;
const OBJECT_ID = /^fixture-(alpha|bravo)-(workspace|artifact)$/;
const encoder = new TextEncoder();

export function isRunId(value: unknown): value is string { return typeof value === 'string' && RUN_ID.test(value); }
export function isTenant(value: unknown): value is Tenant { return TENANTS.includes(value as Tenant); }
export function isKind(value: unknown): value is Kind { return KINDS.includes(value as Kind); }
export function objectId(tenant: Tenant, kind: Kind): string { return `fixture-${tenant}-${kind}`; }
export function isObjectId(value: unknown): value is string { return typeof value === 'string' && OBJECT_ID.test(value); }
export function resourcePath(runId: string, tenant: Tenant, kind: Kind, object: string): string {
  return `/resource/${runId}/${tenant}/${kind}/${object}`;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(`m0-tenancy-capability-v1\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function base64url(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid-capability-encoding');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error('noncanonical-capability');
  return bytes;
}

export type CapabilityScope = { run_id: string; tenant: Tenant; kind: Kind; object_id: string; service_path: string };
export type Capability = CapabilityScope & { version: 1; audience: 'm0-tenancy'; expires_at: number };

export async function issueCapability(secret: string, scope: CapabilityScope, expiresAt: number): Promise<string> {
  const payload: Capability = { version: 1, audience: 'm0-tenancy', ...scope, expires_at: expiresAt };
  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(encoded));
  return `${encoded}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyCapability(secret: string, token: string | null, scope: CapabilityScope, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || secret.length < 32 || secret.length > 1024 || !token || token.length > 2048) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    if (!payload || !signature || !await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature).buffer as ArrayBuffer, encoder.encode(payload))) return false;
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(payload))) as Partial<Capability>;
    const expiresAt = value.expires_at;
    return value.version === 1 && value.audience === 'm0-tenancy' && value.run_id === scope.run_id && value.tenant === scope.tenant
      && value.kind === scope.kind && value.object_id === scope.object_id && value.service_path === scope.service_path
      && typeof expiresAt === 'number' && Number.isInteger(expiresAt) && expiresAt > nowSeconds && expiresAt <= nowSeconds + 300;
  } catch { return false; }
}

export async function hasOperatorAuthorization(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret || secret.length < 32 || secret.length > 1024) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 1031) return false;
  const [actual, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= actual[index]! ^ expected[index]!;
  return mismatch === 0;
}
