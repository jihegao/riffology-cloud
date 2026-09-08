import assert from 'node:assert/strict';
import test from 'node:test';
import { issueModelTurnCapability, MAX_MODEL_CAPABILITY_MS, verifyModelTurnCapability } from '../../services/model-proxy/capability.ts';
import { signTrustedModelRequest, verifyTrustedModelRequest } from '../../services/model-proxy/internal-auth.ts';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';

const key = 'test-only-model-capability-key-with-32-bytes';
const requestKey = 'test-only-model-request-key-with-32-bytes';
const identity = { scope: { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 2 }, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 2 };
const actor = { userId: 'user-a', authVersion: 3 };
async function claims(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    purpose: 'product-model-turn',
    capabilityId: 'capability-a',
    identity,
    actor,
    trustedPiActorId: (await sandboxActorIds(identity.scope, identity.turnId, identity.dispatchId)).trustedPi,
    budgetPolicyVersion: 'policy-v1',
    provider: 'provider-a',
    model: 'model-a',
    maxInputTokensPerCall: 4096,
    maxOutputTokensPerCall: 512,
    issuedAt: 1_000,
    expiresAt: 1_000 + MAX_MODEL_CAPABILITY_MS,
    ...overrides,
  };
}

test('round trip binds full Turn, actor, model policy and the derived Trusted Pi actor', async () => {
  const expected = await claims(), token = await issueModelTurnCapability(key, expected, 1_000);
  assert.match(token, /^m2m1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  assert.doesNotMatch(token, new RegExp(key));
  assert.deepEqual(await verifyModelTurnCapability(key, token, expected.trustedPiActorId, 1_001), expected);
});

test('signature, container, dispatch, expiry and excessive lifetime fail closed', async () => {
  const expected = await claims(), token = await issueModelTurnCapability(key, expected, 1_000);
  await assert.rejects(verifyModelTurnCapability('different-model-capability-key-32bytes', token, expected.trustedPiActorId, 1_001), /signature/);
  await assert.rejects(verifyModelTurnCapability(key, token, 'm2-t-wrong', 1_001), /container-denied/);
  await assert.rejects(verifyModelTurnCapability(key, token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), expected.trustedPiActorId, 1_001), /signature/);
  await assert.rejects(verifyModelTurnCapability(key, token, expected.trustedPiActorId, expected.expiresAt), /expired/);
  await assert.rejects(issueModelTurnCapability(key, await claims({ expiresAt: 1_001 + MAX_MODEL_CAPABILITY_MS }), 1_000), /expired/);
  const otherIdentity = { ...identity, dispatchId: 'dispatch-b' };
  await assert.rejects(issueModelTurnCapability(key, await claims({ identity: otherIdentity }), 1_000), /actor-scope-denied/);
});

test('malformed actor, bounds and extra authority fields are rejected before signing', async () => {
  await assert.rejects(issueModelTurnCapability(key, await claims({ actor: { userId: 'user-a', authVersion: 0 } }), 1_000), /turn-integer/);
  await assert.rejects(issueModelTurnCapability(key, await claims({ maxOutputTokensPerCall: 0 }), 1_000), /model-capability/);
  await assert.rejects(issueModelTurnCapability(key, { ...await claims(), balance: 100 }, 1_000), /model-capability/);
});

test('internal request MAC binds container, timestamp, capability and body', async () => {
  const expected = await claims(), capability = await issueModelTurnCapability(key, expected, 1_000), body = new TextEncoder().encode('{"model":"model-a"}').buffer;
  const mac = await signTrustedModelRequest(requestKey, expected.trustedPiActorId, 1_001, capability, body);
  await verifyTrustedModelRequest(requestKey, expected.trustedPiActorId, 1_001, capability, body, mac);
  await assert.rejects(verifyTrustedModelRequest(requestKey, 'm2-t-wrong', 1_001, capability, body, mac), /signature/);
  await assert.rejects(verifyTrustedModelRequest(requestKey, expected.trustedPiActorId, 1_002, capability, body, mac), /signature/);
  await assert.rejects(verifyTrustedModelRequest(requestKey, expected.trustedPiActorId, 1_001, capability, new TextEncoder().encode('{}').buffer, mac), /signature/);
});
