export const TENANTS = ['alpha', 'bravo'] as const;
export type ProbeTenant = (typeof TENANTS)[number];
export const RESOURCE_KINDS = ['workspace', 'file', 'log', 'artifact', 'preview', 'run'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
const RUN_ID = /^[a-z0-9][a-z0-9-]{7,47}$/;
const encoder = new TextEncoder();

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID.test(value);
}
/** Complete run ID plus role and a DNS-safe suffix: injective, at most 55 bytes. */
export function boundarySandboxId(runId: string, role: 'trusted' | 'alpha' | 'bravo'): string {
  if (!isRunId(runId) || !['trusted', 'alpha', 'bravo'].includes(role)) throw new Error('InvalidProbeScope');
  return `m0-${{ trusted: 't', alpha: 'a', bravo: 'b' }[role]}-${runId}-s`;
}
export function isTenant(value: unknown): value is ProbeTenant {
  return TENANTS.some(tenant => tenant === value);
}
export function isResourceKind(value: unknown): value is ResourceKind {
  return RESOURCE_KINDS.some(kind => kind === value);
}
export function objectId(tenant: ProbeTenant, kind: ResourceKind): string {
  return `fixture-${tenant}-${kind}`;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
export async function hasProbeAuthorization(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret || secret.length < 32 || secret.length > 1024) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 1031) return false;
  const [actual, expected] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= actual[i]! ^ expected[i]!;
  return mismatch === 0;
}

type Capability = {
  version: 1;
  audience: 'riffology-m0-fixture';
  run_id: string;
  tenant: ProbeTenant;
  kind: ResourceKind;
  object_id: string;
  expires_at: number;
};
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('InvalidEncoding');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const result = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0));
  if (base64url(result) !== value) throw new Error('NonCanonicalEncoding');
  return result;
}
async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(`riffology-m0-capability-v1\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function issueCapability(secret: string, run_id: string, tenant: ProbeTenant, kind: ResourceKind, now = Date.now()): Promise<string> {
  const payload: Capability = { version: 1, audience: 'riffology-m0-fixture', run_id, tenant, kind, object_id: objectId(tenant, kind), expires_at: Math.floor(now / 1000) + 300 };
  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(encoded));
  return `${encoded}.${base64url(new Uint8Array(signature))}`;
}
export async function verifyCapability(secret: string, token: string | null, scope: { run_id: string; tenant: ProbeTenant; kind: ResourceKind; object_id: string }, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 1024) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, signature] = parts as [string, string];
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(payload))) return false;
    const claims: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(payload)));
    if (!claims || typeof claims !== 'object') return false;
    const c = claims as Capability;
    return c.version === 1 && c.audience === 'riffology-m0-fixture' && c.run_id === scope.run_id && c.tenant === scope.tenant && c.kind === scope.kind && c.object_id === scope.object_id && c.object_id === objectId(scope.tenant, scope.kind) && Number.isInteger(c.expires_at) && c.expires_at > Math.floor(now / 1000) && c.expires_at <= Math.floor(now / 1000) + 300;
  } catch {
    return false;
  }
}
