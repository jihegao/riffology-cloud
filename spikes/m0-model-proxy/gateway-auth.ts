import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { parseCapabilityAuthorization } from './capability.ts';

const DOMAIN = 'riffology-m0-model-gateway-v1\0';
const MAX_SECRET_LENGTH = 1024;
const MAX_EXTERNAL_TOKEN_LENGTH = 4 + 100 + 1 + 64 + 1 + 64;

function singleBearer(header: unknown, maxTokenLength: number): string | null {
  if (typeof header !== 'string' || header.length > 7 + maxTokenLength || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  // Whitespace, control/non-ASCII characters and comma-joined duplicate headers
  // cannot form one opaque Bearer credential. Never trim or normalize secrets.
  if (!/^[\x21-\x7e]+(?![\s\S])/.test(token) || token.includes(',')) return null;
  return token;
}

function validSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= MAX_SECRET_LENGTH
    && /^[\x21-\x7e]+(?![\s\S])/.test(secret) && !secret.includes(',');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function tag(innerToken: string, secret: string): Uint8Array {
  return createHmac('sha256', secret).update(DOMAIN).update(innerToken).digest();
}

/** Worker-only wrapping. The operator key is injected, never read from env. */
export function wrapGatewayCapability(innerToken: string, secret: string): string {
  if (!validSecret(secret)) throw new Error('invalid-model-gateway-secret');
  if (typeof innerToken !== 'string' || !parseCapabilityAuthorization(`Bearer ${innerToken}`)) {
    throw new Error('invalid-inner-model-capability');
  }
  return `${innerToken}.${hex(tag(innerToken, secret))}`;
}

/**
 * Verify BEFORE any DO lookup. This MAC only admits the gateway request; the DO
 * must verify the returned inner token against its record, expiry and revocation
 * fence. Never use the addressing runId as a trusted invocation on its own.
 */
export function unwrapGatewayAuthorization(header: unknown, secret: unknown): { runId: string; innerToken: string } | null {
  if (!validSecret(secret)) return null;
  const external = singleBearer(header, MAX_EXTERNAL_TOKEN_LENGTH);
  if (!external) return null;
  const parts = external.split('.');
  if (parts.length !== 4 || !/^[0-9a-f]{64}(?![\s\S])/.test(parts[3]!)) return null;
  const innerToken = parts.slice(0, 3).join('.');
  const parsed = parseCapabilityAuthorization(`Bearer ${innerToken}`);
  if (!parsed) return null;
  const supplied = Uint8Array.from(parts[3]!.match(/../g)!, pair => Number.parseInt(pair, 16));
  if (!timingSafeEqual(tag(innerToken, secret), supplied)) return null;
  return Object.freeze({ runId: parsed.runId, innerToken });
}

/** A model capability never grants management rights; only the original key does. */
export function hasModelOperatorAuthorization(request: Request, secret: unknown): boolean {
  if (!validSecret(secret)) return false;
  const supplied = singleBearer(request.headers.get('authorization'), MAX_SECRET_LENGTH);
  if (!supplied) return false;
  const actual = createHash('sha256').update(supplied).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(actual, expected);
}
