import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { issueCapability, TRUSTED_PI_PRINCIPAL, verifyCapability } from '../../spikes/m0-model-proxy/capability.ts';
import { hasModelOperatorAuthorization, unwrapGatewayAuthorization, wrapGatewayCapability } from '../../spikes/m0-model-proxy/gateway-auth.ts';

const SECRET = 'synthetic-offline-model-operator-key-0001';
const WRONG_KEY = 'synthetic-offline-model-operator-key-0002';
const NOW = 1_000_000;
function capability() {
  return issueCapability({ kind: 'trusted-pi', principal: TRUSTED_PI_PRINCIPAL,
    tenantId: 'tenant-alpha', workspaceId: 'workspace-alpha', runId: 'run-alpha',
    callId: 'call-one', expiresAtMs: NOW + 60_000 }, NOW);
}
function request(header: string | null) {
  return new Request('https://offline-fixture.invalid/operator', { headers: header === null ? {} : { authorization: header } });
}
function hex(bytes: Uint8Array) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function changed(value: string) { return value.slice(0, -1) + (value.endsWith('0') ? '1' : '0'); }

test('real HMAC uses the exact gateway domain and returns only the inner token for DO verification', () => {
  const issued = capability();
  const external = wrapGatewayCapability(issued.token, SECRET);
  const expected = hex(createHmac('sha256', SECRET).update('riffology-m0-model-gateway-v1\0' + issued.token).digest());
  assert.equal(external, `${issued.token}.${expected}`);
  assert.equal(external.split('.').length, 4);
  const admitted = unwrapGatewayAuthorization(`Bearer ${external}`, SECRET)!;
  assert.deepEqual(admitted, { runId: 'run-alpha', innerToken: issued.token });
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(verifyCapability(admitted.innerToken, issued.record, NOW)?.callId, 'call-one');
});

test('changing the addressing run, nonce or tag fails gateway admission', () => {
  const { token } = capability(); const external = wrapGatewayCapability(token, SECRET);
  const [prefix, run, nonce, mac] = external.split('.');
  for (const forged of [external.replace('run-alpha', 'run-bravo'), `${prefix}.${run}.${changed(nonce!)}.${mac}`,
    `${prefix}.${run}.${nonce}.${changed(mac!)}`, `${prefix}.${run}.${nonce}.${'0'.repeat(64)}`]) {
    assert.equal(unwrapGatewayAuthorization(`Bearer ${forged}`, SECRET), null);
  }
  assert.equal(unwrapGatewayAuthorization(`Bearer ${external}`, WRONG_KEY), null);
  const noDomainTag = hex(createHmac('sha256', SECRET).update(token).digest());
  assert.equal(unwrapGatewayAuthorization(`Bearer ${token}.${noDomainTag}`, SECRET), null);
});

test('operator, external model and inner model credentials cannot exchange permissions', () => {
  const { token } = capability(); const external = wrapGatewayCapability(token, SECRET);
  assert.equal(hasModelOperatorAuthorization(request(`Bearer ${SECRET}`), SECRET), true);
  assert.equal(hasModelOperatorAuthorization(request(`Bearer ${WRONG_KEY}`), SECRET), false);
  assert.equal(hasModelOperatorAuthorization(request(`Bearer ${external}`), SECRET), false);
  assert.equal(hasModelOperatorAuthorization(request(`Bearer ${token}`), SECRET), false);
  assert.equal(unwrapGatewayAuthorization(`Bearer ${SECRET}`, SECRET), null);
  assert.equal(unwrapGatewayAuthorization(`Bearer ${token}`, SECRET), null);
  assert.equal(hasModelOperatorAuthorization(request(null), SECRET), false);
  const duplicate = request(`Bearer ${SECRET}`);
  duplicate.headers.append('authorization', `Bearer ${SECRET}`);
  assert.equal(hasModelOperatorAuthorization(duplicate, SECRET), false);
});

test('strict gateway format rejects extra segments, casing, whitespace, duplicate headers and noncanonical tags', () => {
  const { token } = capability(); const external = wrapGatewayCapability(token, SECRET);
  for (const header of [null, undefined, 1, {}, external, `bearer ${external}`, `BEARER ${external}`, `Basic ${external}`,
    ` Bearer ${external}`, `Bearer  ${external}`, `Bearer\t${external}`, `Bearer ${external} `, `Bearer ${external}\n`,
    `Bearer ${external}\r\n`, `Bearer ${external}, Bearer ${external}`, `Bearer ${external}.${'0'.repeat(64)}`,
    `Bearer ${external}?role=operator`, `Bearer ${external.slice(0, -1)}`, `Bearer ${external}0`,
    `Bearer ${token}.${'A'.repeat(64)}`, `Bearer ${token}.${'g'.repeat(64)}`,
    `Bearer m0p.constructor.${'0'.repeat(64)}.${'0'.repeat(64)}`,
    `Bearer m0p.${'r'.repeat(101)}.${'0'.repeat(64)}.${'0'.repeat(64)}`]) {
    assert.equal(unwrapGatewayAuthorization(header, SECRET), null);
  }
  for (const header of [`bearer ${SECRET}`, `Bearer  ${SECRET}`, `Basic ${SECRET}`, `Bearer ${SECRET},Bearer ${SECRET}`]) {
    assert.equal(hasModelOperatorAuthorization(request(header), SECRET), false);
  }
});

test('invalid or missing key fails closed and wrapping validates the inner capability', () => {
  const { token } = capability(); const external = wrapGatewayCapability(token, SECRET);
  for (const secret of [undefined, null, 42, '', 'a'.repeat(31), 'a'.repeat(1025), SECRET + ' ', SECRET + '\n', SECRET + '\0', SECRET + ',x', '密'.repeat(32), '😀'.repeat(32)]) {
    assert.throws(() => wrapGatewayCapability(token, secret as string), /invalid-model-gateway-secret/);
    assert.equal(unwrapGatewayAuthorization(`Bearer ${external}`, secret), null);
    assert.equal(hasModelOperatorAuthorization(request(`Bearer ${SECRET}`), secret), false);
  }
  for (const inner of [undefined, null, '', external, `Bearer ${token}`, token + '\n', `m0p.run-alpha.${'0'.repeat(63)}`]) {
    assert.throws(() => wrapGatewayCapability(inner as string, SECRET), /invalid-inner-model-capability/);
  }
  const minimumKey = 'a'.repeat(32);
  assert.ok(unwrapGatewayAuthorization(`Bearer ${wrapGatewayCapability(token, minimumKey)}`, minimumKey));
});

test('gateway MAC does not replace stored-record, expiry or revocation checks in the DO', () => {
  const issued = capability(); const external = wrapGatewayCapability(issued.token, SECRET);
  const admitted = unwrapGatewayAuthorization(`Bearer ${external}`, SECRET)!;
  assert.ok(admitted);
  assert.equal(verifyCapability(admitted.innerToken, null, NOW), null, 'deleted/revoked DO record must deny');
  assert.equal(verifyCapability(admitted.innerToken, issued.record, NOW + 60_000), null, 'inner expiry remains authoritative');
  assert.equal(verifyCapability(admitted.innerToken, capability().record, NOW), null, 'another saved capability cannot substitute');
});
