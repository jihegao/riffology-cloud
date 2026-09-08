import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TrustedInvocation } from './authority.ts';

export const TRUSTED_PI_PRINCIPAL = 'm0-trusted-pi';
export const CAPABILITY_MAX_TTL_MS = 10 * 60 * 1000;
const VERSION = 'm0-model-capability-v1';
const INVOCATION_KEYS = ['kind', 'principal', 'tenantId', 'workspaceId', 'runId', 'callId', 'expiresAtMs'] as const;
const RECORD_KEYS = ['version', 'issuedAtMs', 'invocation', 'digestSha256'] as const;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor', 'toString', 'toLocaleString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);
const MAX_TOKEN_LENGTH = 4 + 100 + 1 + 64;
const MAX_AUTHORIZATION_LENGTH = 7 + MAX_TOKEN_LENGTH;

/** Persist this record in trusted Worker/DO storage; never persist the token. */
export type CapabilityRecord = Readonly<{
  version: typeof VERSION;
  issuedAtMs: number;
  invocation: Readonly<TrustedInvocation>;
  digestSha256: string;
}>;

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.hasOwn(descriptors, key)) return null;
    const descriptor = descriptors[key]!;
    // Do not invoke getters or accept hidden fields from caller-supplied objects.
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100
    && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}(?![\s\S])/.test(value) && !RESERVED_IDS.has(value);
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invocationFrom(value: unknown): TrustedInvocation | null {
  const data = fields(value, INVOCATION_KEYS);
  if (!data || data.kind !== 'trusted-pi' || data.principal !== TRUSTED_PI_PRINCIPAL
    || !identifier(data.tenantId) || !identifier(data.workspaceId) || !identifier(data.runId)
    || !identifier(data.callId) || !timestamp(data.expiresAtMs)) return null;
  return {
    kind: 'trusted-pi', principal: TRUSTED_PI_PRINCIPAL,
    tenantId: data.tenantId, workspaceId: data.workspaceId, runId: data.runId,
    callId: data.callId, expiresAtMs: data.expiresAtMs,
  };
}

function parseToken(value: unknown): { runId: string; token: string } | null {
  if (typeof value !== 'string' || value.length > MAX_TOKEN_LENGTH) return null;
  const match = /^m0p\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,99})\.([0-9a-f]{64})(?![\s\S])/.exec(value);
  if (!match || !identifier(match[1])) return null;
  return { runId: match[1], token: value };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function digest(token: string, invocation: TrustedInvocation, issuedAtMs: number): Uint8Array {
  // A fixed array makes binding independent of input object key order. Include
  // every authority field and issuance time so accidental record changes fail.
  const canonical = [token, issuedAtMs, ...INVOCATION_KEYS.map(key => invocation[key])];
  return createHash('sha256').update(`${VERSION}\0`).update(JSON.stringify(canonical)).digest();
}

/** Only the Worker creates invocation from its approved run/call, never a body/header. */
export function issueCapability(invocation: TrustedInvocation, now = Date.now()): Readonly<{ token: string; record: CapabilityRecord }> {
  let binding: TrustedInvocation | null;
  try { binding = invocationFrom(invocation); } catch { binding = null; }
  if (!timestamp(now) || !binding || binding.expiresAtMs <= now
    || binding.expiresAtMs - now > CAPABILITY_MAX_TTL_MS) throw new Error('invalid-capability-invocation');
  const token = `m0p.${binding.runId}.${hex(randomBytes(32))}`;
  const record: CapabilityRecord = Object.freeze({
    version: VERSION, issuedAtMs: now, invocation: Object.freeze(binding),
    digestSha256: hex(digest(token, binding, now)),
  });
  return Object.freeze({ token, record });
}

/** Strict single Bearer value. A duplicate Authorization joined with a comma fails. */
export function parseCapabilityAuthorization(header: unknown): { runId: string; token: string } | null {
  if (typeof header !== 'string' || header.length > MAX_AUTHORIZATION_LENGTH || !header.startsWith('Bearer ')) return null;
  return parseToken(header.slice(7));
}

/**
 * runId in the token only locates the DO. Identity comes exclusively from its
 * saved record. This does not consume/revoke a capability or authorize replay:
 * the DO must also fence revoked calls and persist the one-call execution state.
 */
export function verifyCapability(token: unknown, record: unknown, now = Date.now()): TrustedInvocation | null {
  try {
    const parsed = parseToken(token);
    const saved = fields(record, RECORD_KEYS);
    if (!parsed || !saved || saved.version !== VERSION || !timestamp(now) || !timestamp(saved.issuedAtMs)
      || saved.issuedAtMs > now || typeof saved.digestSha256 !== 'string'
      || !/^[0-9a-f]{64}(?![\s\S])/.test(saved.digestSha256)) return null;
    const binding = invocationFrom(saved.invocation);
    if (!binding || parsed.runId !== binding.runId || binding.expiresAtMs <= now
      || binding.expiresAtMs <= saved.issuedAtMs || binding.expiresAtMs - saved.issuedAtMs > CAPABILITY_MAX_TTL_MS) return null;
    const actual = digest(parsed.token, binding, saved.issuedAtMs);
    const expected = Uint8Array.from(saved.digestSha256.match(/../g)!, pair => Number.parseInt(pair, 16));
    if (!timingSafeEqual(actual, expected)) return null;
    return Object.freeze(binding);
  } catch {
    return null;
  }
}
