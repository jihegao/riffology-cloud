import assert from 'node:assert/strict';
import test from 'node:test';
import { TRUSTED_PI_CAPACITY_ACTOR, type TrustedPiCapacityPort } from '../../services/capacity/client.ts';
import type { TrustedPiCapacityIdentity, TrustedPiCapacityTicket } from '../../services/capacity/core.ts';
import { TrustedPiTurnCapacity } from '../../services/capacity/turn.ts';
import type { TurnScope } from '../../services/turn/protocol.ts';

const scope: TurnScope = { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 2 };
const acquire = { scope, sessionId: 'session-a', turnId: 'turn-a', generation: 2, ticketId: null, operationId: 'operation-a' };
const expected: TrustedPiCapacityIdentity = {
  tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', sessionId: 'session-a',
  operationId: 'operation-a', turnId: 'turn-a', generation: 2,
};

function ticket(overrides: Partial<TrustedPiCapacityTicket> = {}): TrustedPiCapacityTicket {
  return {
    ...expected, ticketId: 'ticket-a', leaseId: 'lease-a', dispatchId: null, status: 'held',
    requestedAt: 1_000, acquiredAt: 1_001, dispatchedAt: null, finishedAt: null, ...overrides,
  };
}

function fixture(initial = ticket()) {
  let current = initial, actorName = '', requestCalls = 0;
  const cancelled: Array<{ reference: unknown; proof: unknown }> = [];
  const port: TrustedPiCapacityPort = {
    async request(identity) { requestCalls++; assert.deepEqual(identity, expected); return { outcome: requestCalls === 1 ? 'acquired' : 'replayed', ticket: structuredClone(current) }; },
    async lookup(identity) { assert.deepEqual(identity, expected); return { outcome: 'replayed', ticket: structuredClone(current) }; },
    async dispatch() { throw Error('unexpected-dispatch'); },
    async cancelNeverStarted(reference, proof) {
      cancelled.push({ reference: structuredClone(reference), proof: structuredClone(proof) });
      current = { ...current, status: 'cancelled', finishedAt: 2_000 };
      return { changed: true, ticket: structuredClone(current), next: null };
    },
    async confirmReleased() { throw Error('unexpected-release'); },
    async snapshot() { return { capacity: 1, occupied: current.status === 'held' ? 1 : 0, active: current.status === 'held' ? current : null, queue: [] }; },
  };
  const namespace = { getByName(name: string) { actorName = name; return port; } };
  return { adapter: new TrustedPiTurnCapacity(namespace, 5_000, () => 2_000), get actorName() { return actorName; }, get current() { return current; }, set current(value) { current = value; }, cancelled };
}

test('workspace adapter uses the fixed application actor and maps the full persisted identity', async () => {
  const f = fixture(), receipt = await f.adapter.acquire(acquire);
  assert.equal(f.actorName, TRUSTED_PI_CAPACITY_ACTOR);
  assert.deepEqual(receipt, { status: 'acquired', turnId: 'turn-a', generation: 2, ticketId: 'ticket-a', operationId: 'operation-a', leaseId: 'lease-a' });
});

test('queued tickets retain their original wait start and use a bounded next retry', async () => {
  const f = fixture(ticket({ status: 'queued', leaseId: null, acquiredAt: null }));
  assert.deepEqual(await f.adapter.acquire(acquire), {
    status: 'waiting', turnId: 'turn-a', generation: 2, ticketId: 'ticket-a', operationId: 'operation-a',
    reasonCode: 'trusted-pi-capacity-exhausted', since: 1_000, nextAttemptAt: 7_000,
  });
});

test('a persisted ticket and all returned identity fields are fenced', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.acquire({ ...acquire, generation: 1 }), /generation-conflict/);
  await assert.rejects(f.adapter.acquire({ ...acquire, ticketId: 'ticket-other' }), /receipt-scope-denied/);
  f.current = ticket({ sessionId: 'session-other' });
  await assert.rejects(f.adapter.acquire(acquire), /receipt-scope-denied/);
});

test('never-started release uses a stable exact proof and rejects dispatched leases', async () => {
  const f = fixture(), input = { ...acquire, ticketId: 'ticket-a', operationId: 'operation-a', leaseId: 'lease-a', reasonCode: 'turn-initial-base-unavailable', observedAt: 1_500 };
  await f.adapter.releaseNeverStarted(input);
  assert.deepEqual(f.cancelled, [{
    reference: { ...expected, ticketId: 'ticket-a', leaseId: 'lease-a' },
    proof: { kind: 'never-started', proofId: 'never-started-cfdd1a8f80ac95cc58a31db8e57a69c78884706daeb1cefeb5b69c304f022486', observedAt: 1_500 },
  }]);
  await f.adapter.releaseNeverStarted(input);
  assert.equal(f.cancelled.length, 2);
  assert.deepEqual(f.cancelled[1], f.cancelled[0]);

  const dispatched = fixture(ticket({ status: 'dispatched', dispatchId: 'dispatch-a', dispatchedAt: 1_002 }));
  await assert.rejects(dispatched.adapter.releaseNeverStarted(input), /reference-denied|never-started-not-confirmed/);
});
