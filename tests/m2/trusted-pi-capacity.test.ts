import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SqlTrustedPiCapacity,
  trustedPiCapacityDispatchReference,
  trustedPiCapacityLeaseReference,
  trustedPiCapacityTicketReference,
  type TrustedPiCapacityIdentity,
  type TrustedPiCapacityStorage,
  type TrustedPiCapacityTicket,
} from '../../services/capacity/core.ts';

const identity = (operationId: string, turnId = operationId, generation = 1, workspaceId = 'workspace-a'): TrustedPiCapacityIdentity => ({
  tenantId: 'tenant-a', projectId: 'project-a', workspaceId, sessionId: 'session-a', operationId,
  turnId, generation,
});

function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), 'trusted-pi-capacity-')), filename = join(directory, 'capacity.sqlite');
  let database = new DatabaseSync(filename), now = 1_000, failSync = false, serial = 0;
  const configure = () => database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); configure();
  const storage = {
    sql: { exec(query: string, ...bindings: (string | number | null)[]) {
      if (query.includes('CREATE TABLE')) { database.exec(query); return { toArray: () => [] }; }
      const statement = database.prepare(query), rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => structuredClone(rows) };
    } },
    transactionSync<T>(operation: () => T): T { database.exec('BEGIN IMMEDIATE'); try { const value = operation(); database.exec('COMMIT'); return value; }
      catch (error) { database.exec('ROLLBACK'); throw error; } },
    async sync() { if (failSync) throw Error('injected-capacity-sync-unknown'); },
  } as unknown as TrustedPiCapacityStorage;
  const host = (version = 'trusted-pi-v1') => new SqlTrustedPiCapacity(storage, version, () => now, () => `capacity-${++serial}`);
  t.after(() => { database.close(); rmSync(directory, { recursive: true }); });
  return { storage, host, get now() { return now; }, advance(to: number) { now = to; }, failSync(to: boolean) { failSync = to; },
    reopen() { database.close(); database = new DatabaseSync(filename); configure(); } };
}

async function held(host: SqlTrustedPiCapacity, value: TrustedPiCapacityIdentity): Promise<TrustedPiCapacityTicket> {
  const result = await host.request(value); assert.equal(result.outcome, 'acquired'); assert.equal(result.ticket.status, 'held'); assert.ok(result.ticket.leaseId); return result.ticket;
}

test('application capacity one persists a FIFO queue and promotes exactly one ticket at a time', async t => {
  const f = fixture(t), host = f.host(), a = await held(host, identity('operation-a'));
  const b = await host.request(identity('operation-b')), c = await host.request(identity('operation-c'));
  assert.equal(b.outcome, 'queued'); assert.equal(b.ticket.leaseId, null); assert.equal(c.outcome, 'queued');
  assert.deepEqual((await host.snapshot()).queue.map(value => value.operationId), ['operation-b', 'operation-c']);
  const dispatchedA = trustedPiCapacityDispatchReference(a, 'dispatch-a');
  assert.equal((await host.dispatch(dispatchedA)).authorized, true);
  const released = await host.confirmReleased(dispatchedA, { kind: 'runtime-released', proofId: 'release-a', observedAt: f.now });
  assert.equal(released.changed, true); assert.equal(released.next?.operationId, 'operation-b'); assert.equal(released.next?.status, 'held'); assert.ok(released.next?.leaseId);
  const after = await host.snapshot(); assert.equal(after.occupied, 1); assert.equal(after.active?.operationId, 'operation-b'); assert.deepEqual(after.queue.map(value => value.operationId), ['operation-c']);
  const cancelled = await host.cancelNeverStarted(trustedPiCapacityLeaseReference(released.next!), { kind: 'never-started', proofId: 'cancel-b', observedAt: f.now });
  assert.equal(cancelled.next?.operationId, 'operation-c'); assert.equal(cancelled.next?.status, 'held'); assert.equal((await host.snapshot()).occupied, 1);
});

test('queued cancellation needs no lease and cannot disturb FIFO or the active lease', async t => {
  const f = fixture(t), host = f.host(), a = await held(host, identity('operation-a'));
  const b = (await host.request(identity('operation-b'))).ticket, c = (await host.request(identity('operation-c'))).ticket;
  assert.equal((await host.cancelNeverStarted(trustedPiCapacityTicketReference(b), { kind: 'never-started', proofId: 'cancel-b', observedAt: f.now })).next?.operationId, 'operation-a');
  assert.deepEqual((await host.snapshot()).queue.map(value => value.operationId), ['operation-c']);
  const dispatchedA = trustedPiCapacityDispatchReference(a, 'dispatch-a');await host.dispatch(dispatchedA);
  await host.confirmReleased(dispatchedA, { kind: 'runtime-released', proofId: 'release-a', observedAt: f.now });
  assert.equal((await host.lookup(identity('operation-c')))?.ticket.leaseId === null, false);
  assert.equal((await host.snapshot()).active?.ticketId, c.ticketId);
});

test('request, dispatch and release are idempotent while every identity field and proof is fenced', async t => {
  const f = fixture(t), host = f.host(), request = identity('operation-a'), a = await held(host, request);
  const replay = await host.request(request); assert.equal(replay.outcome, 'replayed'); assert.equal(replay.ticket.ticketId, a.ticketId); assert.equal(replay.ticket.leaseId, a.leaseId);
  await assert.rejects(host.request({ ...request, sessionId: 'session-forged' }), /idempotency-conflict/);
  const reference = trustedPiCapacityDispatchReference(a, 'dispatch-a');
  for (const changed of [{ operationId: 'operation-other' }, { leaseId: 'lease-other' }, { turnId: 'turn-other' }, { generation: 2 }]) {
    await assert.rejects(host.dispatch({ ...reference, ...changed }), /reference-denied|idempotency-conflict/);
  }
  await assert.rejects(host.confirmReleased(reference, { kind: 'runtime-released', proofId: 'too-early', observedAt: f.now }), /reference-denied/);
  assert.equal((await host.dispatch(reference)).authorized, true); assert.equal((await host.dispatch(reference)).authorized, false);
  await assert.rejects(host.dispatch({ ...reference, dispatchId: 'dispatch-other' }), /reference-denied/);
  const proof = { kind: 'runtime-released' as const, proofId: 'release-a', observedAt: f.now };
  assert.equal((await host.confirmReleased(reference, proof)).changed, true); assert.equal((await host.confirmReleased(reference, proof)).changed, false);
  await assert.rejects(host.confirmReleased(reference, { ...proof, proofId: 'release-other' }), /proof-conflict/);
  const next = await held(host, identity('operation-b'));
  await assert.rejects(host.cancelNeverStarted(trustedPiCapacityLeaseReference(next), { kind: 'never-started', proofId: proof.proofId, observedAt: f.now }), /proof-reused/);
  assert.equal((await host.snapshot()).active?.operationId, 'operation-b');
});

test('SQLite restart retains queue, active dispatch and generation/owner fences', async t => {
  const f = fixture(t), first = f.host(), a = await held(first, identity('operation-a', 'turn-a', 2));
  await first.dispatch(trustedPiCapacityDispatchReference(a, 'dispatch-a')); await first.request(identity('operation-b', 'turn-b', 2));
  f.reopen(); const restarted = f.host();
  assert.equal((await restarted.lookup(identity('operation-a', 'turn-a', 2)))?.ticket.status, 'dispatched');
  assert.equal((await restarted.lookup(identity('operation-b', 'turn-b', 2)))?.ticket.status, 'queued');
  await assert.rejects(restarted.request(identity('operation-stale', 'turn-stale', 1)), /stale-generation/);
  await assert.rejects(restarted.request({ ...identity('operation-owner', 'turn-owner', 3), projectId: 'project-b' }), /workspace-owner-conflict/);
  await assert.rejects(f.host('trusted-pi-v2').snapshot(), /policy-conflict/);
  assert.equal((await restarted.snapshot()).occupied, 1);
});

test('unknown write acknowledgement reconciles the original ticket without duplicate capacity', async t => {
  const f = fixture(t), host = f.host(); await host.ready(); f.failSync(true);
  const request = identity('operation-a'); await assert.rejects(host.request(request), /sync-unknown/);
  f.failSync(false); f.reopen(); const restarted = f.host(), found = await restarted.lookup(request); assert.ok(found);
  assert.equal((await restarted.request(request)).ticket.ticketId, found.ticket.ticketId); assert.equal((await restarted.snapshot()).occupied, 1);
});

test('invalid shapes, future observations and dispatched never-started proofs fail closed', async t => {
  const f = fixture(t), host = f.host();
  await assert.rejects(host.request({ ...identity('operation-a'), extra: 'value' } as TrustedPiCapacityIdentity), /invalid-capacity-input/);
  await assert.rejects(host.request({ ...identity('operation-a'), generation: 0 }), /invalid-capacity-integer/);
  const a = await held(host, identity('operation-a')), lease = trustedPiCapacityLeaseReference(a), ref = trustedPiCapacityDispatchReference(a, 'dispatch-a'); await host.dispatch(ref);
  await assert.rejects(host.cancelNeverStarted(lease, { kind: 'never-started', proofId: 'cancel-a', observedAt: f.now }), /never-started-not-confirmed/);
  await assert.rejects(host.confirmReleased(ref, { kind: 'runtime-released', proofId: 'future', observedAt: f.now + 1 }), /observation-time/);
  assert.equal((await host.snapshot()).occupied, 1);
});
