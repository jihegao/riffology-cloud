import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewTarget, type PreviewTargetPorts } from '../../services/preview/target.ts';
import type { PreviewBinding } from '../../services/preview/bindings.ts';
import type { ServiceIntentRecord } from '../../services/workspace/service-intents.ts';
import type { ServiceRunRecord } from '../../services/run/service.ts';
import { actor, reference, scope, spec } from './run-fixture.ts';

function candidate(runId = 'run-a'): { binding: PreviewBinding; view: { intent: ServiceIntentRecord; run: ServiceRunRecord } } {
  const s = spec(), runtime = reference(runId), source = structuredClone(s.plan.source);
  const task = { runId, scope, actor, requestKey: `request-${runId}`, spec: s };
  const intent: ServiceIntentRecord = {
    runId, scope, actor, requestKey: task.requestKey,
    request: { runtimeImage: s.runtimeImage, maxDurationMs: s.maxDurationMs }, source,
    task, status: 'delivered', createdAt: 1000, updatedAt: 1100, deliveryDeadlineAt: 6000,
    nextAttemptAt: null, deliveryClaimedAt: 1000, stopRequestedAt: null, stopForwardedAt: null, errorCode: null,
  };
  const run: ServiceRunRecord = {
    id: runId, kind: 'service', scope, actor, spec: structuredClone(s), status: 'running',
    createdAt: 1000, updatedAt: 1100, startedAt: 1100, stopRequestedAt: null, runtime, errorCode: null,
  };
  const binding: PreviewBinding = {
    previewId: 'preview-a', scope, runId, source: structuredClone(source), runtime,
    createdAt: 1000, expiresAt: runtime.deadlineAt, revokedAt: null, reason: null,
  };
  return { binding, view: { intent, run } };
}

function portsFor(base: ReturnType<typeof candidate>, mutate?: (binding: PreviewBinding, count: number) => PreviewBinding) {
  let reads = 0, views = 0, starts = 0;
  const ports: PreviewTargetPorts & { start(): never } = {
    async binding() { reads++; return structuredClone(mutate ? mutate(base.binding, reads) : base.binding); },
    async view(runId) { views++; assert.equal(runId, base.binding.runId); return structuredClone(base.view); },
    start() { starts++; throw Error('start-must-not-be-called'); },
  };
  return { ports, counts: () => ({ reads, views, starts }) };
}

test('resolvePreviewTarget returns a fixed source/runtime match without starting anything', async () => {
  const base = candidate(), { ports, counts } = portsFor(base);
  const result = await resolvePreviewTarget(ports, base.binding.previewId, () => 1000);
  assert.deepEqual(result.binding, base.binding);
  assert.deepEqual(result.run, base.view.run);
  assert.deepEqual(counts(), { reads: 2, views: 1, starts: 0 });
});

test('resolvePreviewTarget rejects replacement, revocation, and expiry observed during the read', async () => {
  const replacement = candidate(), replacementBinding = { ...replacement.binding, runId: 'run-b', previewId: 'preview-b' };
  const changed = portsFor(replacement, (binding, count) => count === 2 ? replacementBinding : binding);
  await assert.rejects(resolvePreviewTarget(changed.ports, replacement.binding.previewId, () => 1000), /preview-target-unavailable/);

  const revoked = candidate(), revokedPorts = portsFor(revoked, (binding, count) => count === 2 ? { ...binding, revokedAt: 1050, reason: 'operator' } : binding);
  await assert.rejects(resolvePreviewTarget(revokedPorts.ports, revoked.binding.previewId, () => 1000), /preview-target-unavailable/);

  const expired = candidate(), expiredPorts = portsFor(expired);
  await assert.rejects(resolvePreviewTarget(expiredPorts.ports, expired.binding.previewId, () => 5000), /preview-target-unavailable/);
});

test('resolvePreviewTarget rejects stopping, unknown, null, and stopped intents or runs', async () => {
  const cases = [
    (v: ReturnType<typeof candidate>) => { v.view.intent.stopRequestedAt = 1050; },
    (v: ReturnType<typeof candidate>) => { v.view.intent.status = 'delivery-unknown'; },
    (v: ReturnType<typeof candidate>) => { v.view.run.status = 'stopping'; v.view.run.stopRequestedAt = 1050; },
    (v: ReturnType<typeof candidate>) => { v.view.run.status = 'unknown'; },
    (v: ReturnType<typeof candidate>) => { v.view.run = null as never; },
  ];
  for (const mutate of cases) {
    const base = candidate(); mutate(base);
    const { ports } = portsFor(base);
    await assert.rejects(resolvePreviewTarget(ports, base.binding.previewId, () => 1000), /preview-target-unavailable|service-view-conflict/);
  }
});

test('resolvePreviewTarget rejects source, runtime, and scope mismatches', async () => {
  const cases = [
    (v: ReturnType<typeof candidate>) => { v.binding.source = { ...v.binding.source, kind: 'initial-workspace' } as never; },
    (v: ReturnType<typeof candidate>) => { v.binding.runtime = { ...v.binding.runtime, runtimeId: 'runtime-other' }; },
    (v: ReturnType<typeof candidate>) => { v.view.run.scope = { ...scope, tenantId: 'tenant-other' }; },
  ];
  for (const mutate of cases) {
    const base = candidate(); mutate(base);
    const { ports } = portsFor(base);
    await assert.rejects(resolvePreviewTarget(ports, base.binding.previewId, () => 1000), /preview-target-unavailable|scope-denied|invalid-preview-source/);
  }
});
