import { sandboxActorIds } from '../sandbox/identity.ts';
import { actor as validateActor, positive, turnId, type TurnActor } from '../turn/protocol.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from '../turn-runtime/identity.ts';

export const MAX_MODEL_CAPABILITY_MS = 15 * 60_000;
export type ModelTurnCapabilityClaims = {
  schemaVersion: 1;
  purpose: 'product-model-turn';
  capabilityId: string;
  identity: TurnRuntimeIdentity;
  actor: TurnActor;
  trustedPiActorId: string;
  budgetPolicyVersion: string;
  provider: string;
  model: string;
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
  issuedAt: number;
  expiresAt: number;
};

const encoder = new TextEncoder();
const TOKEN = /^m2m1\.([A-Za-z0-9_-]{64,3072})\.([a-f0-9]{64})$/;
const PROVIDER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/;
function reject(code: string): never { throw Error(code); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) reject('invalid-model-capability');
}
function bounded(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) reject('invalid-model-capability');
  return value as number;
}
function keyBytes(value: unknown): ArrayBuffer {
  if (typeof value !== 'string') reject('invalid-model-capability-key');
  const bytes = encoder.encode(value);
  if (bytes.byteLength < 32 || bytes.byteLength > 256) reject('invalid-model-capability-key');
  return bytes.buffer as ArrayBuffer;
}
async function key(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function unbase64url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  let binary: string;
  try { binary = atob(padded); } catch { reject('invalid-model-capability'); }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function signatureBytes(value: string): ArrayBuffer {
  return Uint8Array.from(value.match(/../gu)!.map(pair => Number.parseInt(pair, 16))).buffer as ArrayBuffer;
}
async function normalized(value: unknown): Promise<ModelTurnCapabilityClaims> {
  exact(value, ['schemaVersion', 'purpose', 'capabilityId', 'identity', 'actor', 'trustedPiActorId', 'budgetPolicyVersion', 'provider', 'model', 'maxInputTokensPerCall', 'maxOutputTokensPerCall', 'issuedAt', 'expiresAt']);
  if (value.schemaVersion !== 1 || value.purpose !== 'product-model-turn') reject('invalid-model-capability');
  const identity = turnRuntimeIdentity(value.identity), actor = validateActor(value.actor);
  const trustedPiActorId = turnId(value.trustedPiActorId);
  if (trustedPiActorId !== (await sandboxActorIds(identity.scope, identity.turnId, identity.dispatchId)).trustedPi) reject('model-capability-actor-scope-denied');
  if (typeof value.provider !== 'string' || !PROVIDER.test(value.provider)
    || typeof value.model !== 'string' || !MODEL.test(value.model)) reject('invalid-model-capability');
  return {
    schemaVersion: 1,
    purpose: 'product-model-turn',
    capabilityId: turnId(value.capabilityId),
    identity,
    actor,
    trustedPiActorId,
    budgetPolicyVersion: turnId(value.budgetPolicyVersion),
    provider: value.provider,
    model: value.model,
    maxInputTokensPerCall: bounded(value.maxInputTokensPerCall, 1_048_576),
    maxOutputTokensPerCall: bounded(value.maxOutputTokensPerCall, 131_072),
    issuedAt: positive(value.issuedAt),
    expiresAt: positive(value.expiresAt),
  };
}
function time(claims: ModelTurnCapabilityClaims, now: number): void {
  positive(now);
  if (claims.issuedAt > now || claims.expiresAt <= now || claims.expiresAt <= claims.issuedAt
    || claims.expiresAt - claims.issuedAt > MAX_MODEL_CAPABILITY_MS) reject('model-capability-expired');
}

/** Issues a short-lived Turn capability. It carries no provider credential and
 * cannot alter the server-side budget policy pinned in TenantModelBudget. */
export async function issueModelTurnCapability(secret: string, value: unknown, now = Date.now()): Promise<string> {
  const claims = await normalized(structuredClone(value));
  time(claims, now);
  const encoded = base64url(encoder.encode(JSON.stringify(claims)));
  const prefix = `m2m1.${encoded}`;
  const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(prefix));
  return `${prefix}.${hex(mac)}`;
}

export async function verifyModelTurnCapability(secret: string, token: unknown, expectedTrustedPiActorId: unknown | undefined, now = Date.now()): Promise<ModelTurnCapabilityClaims> {
  if (typeof token !== 'string') reject('invalid-model-capability');
  const match = TOKEN.exec(token);
  if (!match) reject('invalid-model-capability');
  const valid = await crypto.subtle.verify('HMAC', await key(secret), signatureBytes(match[2]!), encoder.encode(`m2m1.${match[1]}`));
  if (!valid) reject('invalid-model-capability-signature');
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64url(match[1]!))); }
  catch { reject('invalid-model-capability'); }
  const claims = await normalized(decoded);
  time(claims, now);
  if (expectedTrustedPiActorId !== undefined && claims.trustedPiActorId !== turnId(expectedTrustedPiActorId)) reject('model-capability-container-denied');
  return structuredClone(claims);
}

export function modelCapabilityHeader(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN.test(value)) reject('invalid-model-capability');
  return value;
}
