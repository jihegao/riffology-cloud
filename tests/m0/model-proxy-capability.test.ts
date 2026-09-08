import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_MAX_TTL_MS, TRUSTED_PI_PRINCIPAL, issueCapability, parseCapabilityAuthorization,
  verifyCapability } from '../../spikes/m0-model-proxy/capability.ts';
import type { TrustedInvocation } from '../../spikes/m0-model-proxy/authority.ts';

const NOW = 1_000_000;
const invocation = (): TrustedInvocation => ({ kind: 'trusted-pi', principal: TRUSTED_PI_PRINCIPAL,
  tenantId: 'tenant-alpha', workspaceId: 'workspace-one', runId: 'run-one', callId: 'call-one', expiresAtMs: NOW + 60_000 });

test('real crypto issues independent 32-byte opaque tokens and verifies only the saved binding', () => {
  const input = invocation();
  const first = issueCapability(input, NOW);
  const second = issueCapability(input, NOW);
  assert.match(first.token, /^m0p\.run-one\.[0-9a-f]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.record.digestSha256, second.record.digestSha256);
  assert.equal(JSON.stringify(first.record).includes(first.token), false);
  assert.deepEqual(parseCapabilityAuthorization(`Bearer ${first.token}`), { runId: input.runId, token: first.token });
  assert.deepEqual(verifyCapability(first.token, first.record, NOW), input);
  assert.equal(verifyCapability(first.token, second.record, NOW), null);
  assert.equal(verifyCapability(second.token, first.record, NOW), null);
  assert.deepEqual(verifyCapability(first.token, structuredClone(first.record), NOW), input, 'DO serialization preserves verification');
});

test('caller mutations cannot change issued records or verified invocation snapshots', () => {
  const input = invocation(); const original = structuredClone(input);
  const issued = issueCapability(input, NOW);
  input.tenantId = 'tenant-attacker'; input.expiresAtMs += 1_000_000;
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(Object.isFrozen(issued.record), true);
  assert.equal(Object.isFrozen(issued.record.invocation), true);
  assert.deepEqual(issued.record.invocation, original);
  assert.throws(() => { (issued.record.invocation as TrustedInvocation).callId = 'different-call'; }, TypeError);
  const verified = verifyCapability(issued.token, issued.record, NOW)!;
  assert.equal(Object.isFrozen(verified), true);
  assert.notEqual(verified, issued.record.invocation);
  assert.throws(() => { verified.tenantId = 'tenant-attacker'; }, TypeError);
  assert.deepEqual(verifyCapability(issued.token, issued.record, NOW), original);
});

test('all binding fields, issuance time, and token addressing are covered by the digest', () => {
  const issued = issueCapability(invocation(), NOW);
  for (const patch of [{ tenantId: 'tenant-bravo' }, { workspaceId: 'workspace-two' }, { callId: 'call-two' },
    { runId: 'run-two' }, { expiresAtMs: NOW + 30_000 }, { principal: 'project' }, { kind: 'project' }]) {
    const altered = { ...issued.record, invocation: { ...issued.record.invocation, ...patch } };
    assert.equal(verifyCapability(issued.token, altered, NOW), null);
  }
  assert.equal(verifyCapability(issued.token, { ...issued.record, issuedAtMs: NOW - 1 }, NOW), null);
  const addressedElsewhere = issued.token.replace('m0p.run-one.', 'm0p.run-two.');
  assert.equal(parseCapabilityAuthorization(`Bearer ${addressedElsewhere}`)?.runId, 'run-two');
  assert.equal(verifyCapability(addressedElsewhere, issued.record, NOW), null, 'addressing alone cannot grant identity');
  assert.equal(verifyCapability(`${issued.token.slice(0, -1)}${issued.token.endsWith('0') ? '1' : '0'}`, issued.record, NOW), null);
});

test('only a future safe expiry within ten minutes can be issued, with exact expiry and clock rollback rejection', () => {
  const max = issueCapability({ ...invocation(), expiresAtMs: NOW + CAPABILITY_MAX_TTL_MS }, NOW);
  assert.ok(verifyCapability(max.token, max.record, NOW + CAPABILITY_MAX_TTL_MS - 1));
  assert.equal(verifyCapability(max.token, max.record, NOW + CAPABILITY_MAX_TTL_MS), null);
  assert.equal(verifyCapability(max.token, max.record, NOW - 1), null);
  for (const expiresAtMs of [NOW, NOW - 1, NOW + CAPABILITY_MAX_TTL_MS + 1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => issueCapability({ ...invocation(), expiresAtMs }, NOW), /invalid-capability-invocation/);
  }
  for (const now of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => issueCapability(invocation(), now), /invalid-capability-invocation/);
    assert.equal(verifyCapability(max.token, max.record, now), null);
  }
});

test('strict Bearer parsing rejects alternate schemes, whitespace, duplicates, suffixes and invalid nonce encodings', () => {
  const { token } = issueCapability(invocation(), NOW);
  for (const header of [undefined, null, 123, {}, token, `bearer ${token}`, `BEARER ${token}`, `Basic ${token}`,
    `Bearer  ${token}`, ` Bearer ${token}`, `Bearer\t${token}`, `Bearer ${token} `, `Bearer ${token}\n`,
    `Bearer ${token}\r\n`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token},${token}`, `Bearer ${token}.extra`,
    `Bearer ${token}?role=trusted-pi`, `Bearer ${token.slice(0, -1)}`, `Bearer ${token}0`,
    'Bearer m0p.run-one.' + 'A'.repeat(64), 'Bearer m0p.run-one.' + 'g'.repeat(64),
    'Bearer m0p.run.one.' + 'a'.repeat(64), 'Bearer m0p.%72un-one.' + 'a'.repeat(64),
    'Bearer m0p.' + 'r'.repeat(101) + '.' + 'a'.repeat(64)]) {
    assert.equal(parseCapabilityAuthorization(header), null);
  }
});

test('strict binding schemas reject extra, missing, inherited, accessor and symbol fields without reading getters', () => {
  let getterCalls = 0;
  const getter = Object.defineProperty(invocation(), 'tenantId', { enumerable: true, get() { getterCalls++; return 'tenant-alpha'; } });
  const missing = { ...invocation() } as Partial<TrustedInvocation>; delete missing.callId;
  const symbol = { ...invocation(), [Symbol('extra')]: true };
  for (const bad of [null, [], { ...invocation(), role: 'trusted-pi' }, { ...invocation(), principal: 'project' },
    missing, Object.create(invocation()), getter, symbol]) {
    assert.throws(() => issueCapability(bad as TrustedInvocation, NOW), /invalid-capability-invocation/);
  }
  assert.equal(getterCalls, 0);
  const issued = issueCapability(invocation(), NOW);
  for (const bad of [null, [], Object.create(issued.record), { ...issued.record, token: issued.token },
    { ...issued.record, version: 'other' }, { ...issued.record, digestSha256: 'a'.repeat(63) },
    { ...issued.record, digestSha256: 'A'.repeat(64) }, { ...issued.record, digestSha256: 'a'.repeat(64) + '\n' },
    { ...issued.record, [Symbol('extra')]: true }, { ...issued.record, invocation: getter }]) {
    assert.equal(verifyCapability(issued.token, bad, NOW), null);
  }
  assert.equal(getterCalls, 0);
});

test('scope identifiers reject prototype names, non-ASCII, path delimiters and newline suffixes', () => {
  for (const id of ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', '', '租户', 'run/one', 'run.one',
    'run-one\n', 'run-one\r', 'r'.repeat(101)]) {
    for (const field of ['tenantId', 'workspaceId', 'runId', 'callId'] as const) {
      assert.throws(() => issueCapability({ ...invocation(), [field]: id }, NOW), /invalid-capability-invocation/);
    }
    assert.equal(parseCapabilityAuthorization(`Bearer m0p.${id}.${'a'.repeat(64)}`), null);
  }
  const issued = issueCapability({ ...invocation(), runId: 'R' + 'x'.repeat(99) }, NOW);
  assert.ok(parseCapabilityAuthorization(`Bearer ${issued.token}`));
  assert.ok(verifyCapability(issued.token, issued.record, NOW));
  assert.equal(Object.hasOwn(Object.prototype, 'used'), false);
});
