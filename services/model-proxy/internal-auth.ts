const encoder = new TextEncoder();
const MAC = /^[a-f0-9]{64}$/;
const CONTAINER = /^[A-Za-z0-9-]{1,128}$/;
function reject(code: string): never { throw Error(code); }
function keyBytes(value: unknown): ArrayBuffer {
  if (typeof value !== 'string') reject('invalid-model-proxy-request-key');
  const bytes = encoder.encode(value);
  if (bytes.byteLength < 32 || bytes.byteLength > 256) reject('invalid-model-proxy-request-key');
  return bytes.buffer as ArrayBuffer;
}
function container(value: unknown): string {
  if (typeof value !== 'string' || !CONTAINER.test(value)) reject('invalid-model-proxy-container');
  return value;
}
function time(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) reject('invalid-model-proxy-request-time');
  return value as number;
}
async function key(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function digest(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function message(containerId: string, requestAt: number, capability: string, body: ArrayBuffer): Promise<ArrayBuffer> {
  return encoder.encode(JSON.stringify({
    schemaVersion: 1,
    purpose: 'trusted-pi-model-request',
    containerId: container(containerId),
    requestAt: time(requestAt),
    capabilitySha256: await digest(capability),
    bodySha256: await digest(body),
  })).buffer as ArrayBuffer;
}
export async function signTrustedModelRequest(secret: string, containerId: string, requestAt: number, capability: string, body: ArrayBuffer): Promise<string> {
  const result = await crypto.subtle.sign('HMAC', await key(secret), await message(containerId, requestAt, capability, body));
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function verifyTrustedModelRequest(secret: string, containerId: string, requestAt: number, capability: string, body: ArrayBuffer, rawMac: string): Promise<void> {
  if (!MAC.test(rawMac)) reject('invalid-model-proxy-request-mac');
  const signature = Uint8Array.from(rawMac.match(/../gu)!.map(pair => Number.parseInt(pair, 16))).buffer as ArrayBuffer;
  if (!await crypto.subtle.verify('HMAC', await key(secret), signature, await message(containerId, requestAt, capability, body))) reject('invalid-model-proxy-request-signature');
}
