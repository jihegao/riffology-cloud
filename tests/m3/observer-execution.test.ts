import assert from 'node:assert/strict';
import test from 'node:test';
import { executeObserver, type ObserverExecutionServices } from '../../services/preview/observer-execution.ts';
import { R2ObserverArtifacts, type ObserverArtifactBucket } from '../../services/preview/observer-artifacts.ts';
import type { ObserverCommand } from '../../services/preview/observer-protocol.ts';
import type { PreviewBinding } from '../../services/preview/bindings.ts';
import { scope, spec, reference } from './run-fixture.ts';
import { serviceRuntimeInput, type ServiceRuntimeInput } from '../../services/run/runtime-protocol.ts';
import { turnDigest } from '../../services/turn/protocol.ts';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const stateBytes = encode({ simulation_state_id: 'state-a', sequence: 7, state: { queue: 2 } });

function fixture(options: { operation?: ObserverCommand['operation']; expiresAt?: number } = {}) {
  const command: ObserverCommand = { schemaVersion: 1, purpose: 'observer', scope, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', commandId: 'command-a', previewId: 'preview-a', operation: options.operation ?? 'snapshot', deadlineAt: 4000 };
  const s = spec();
  s.plan.declaration.observation = { pagePath: '/observe', statePath: '/state' };
  const expiresAt = options.expiresAt ?? 3500;
  const runtime = { ...reference('run-a'), deadlineAt: expiresAt };
  const binding: PreviewBinding = { previewId: 'preview-a', scope, runId: 'run-a', source: structuredClone(s.plan.source), runtime, createdAt: 500, expiresAt, revokedAt: null, reason: null };
  const input: ServiceRuntimeInput = serviceRuntimeInput({ reference: runtime, scope, spec: s, lease: { tenantId: scope.tenantId, projectId: scope.projectId, workspaceId: scope.workspaceId, generation: 1, operation: 'service-run', operationId: runtime.dispatchId, deadlineAt: expiresAt, runId: runtime.runId, leaseId: runtime.leaseId } });
  const policy = { origin: 'https://p-' + 'a'.repeat(40) + '.preview.example.test', pagePath: '/observe', statePath: '/state' };
  const targetDigestPromise = turnDigest({ binding, plan: input.spec.plan });
  const objects = new Map<string, Uint8Array>();
  const bucket: ObserverArtifactBucket = {
    async put(key, value) { if (!objects.has(key)) objects.set(key, Uint8Array.from(value as Uint8Array)); return null; },
    async get(key) { const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, body: new ReadableStream({ start(c) { c.enqueue(Uint8Array.from(bytes)); c.close(); } }) } : null; },
  } as ObserverArtifactBucket;
  let revoked = false;
  let forgedReceipt = false;
  let badStateContentType = false;
  let malformedState = false;
  let artifactHang = false;
  let browser: ObserverExecutionServices['browser'] = { async run({ operation, fetchResource }) { await fetchResource(new Request(policy.origin + policy.pagePath)); return { stopped: true, payload: operation === 'snapshot' ? { type: 'snapshot', text: 'ok', truncated: false } : operation === 'reload' ? { type: 'reload', reloaded: true } : operation === 'console' ? { type: 'console', entries: [], truncated: false, dropped: 0 } : { type: 'screenshot', mimeType: 'image/png', bytes: new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,5,0,0,0,2,208,8,6,0,0,0]), width: 1280, height: 720 } }; } };
  const ports: ObserverExecutionServices = {
    async authorize() { if (revoked) throw Error('observer-authority-denied'); return { binding: structuredClone(binding), runtime: structuredClone(input), policy, targetDigest: await targetDigestPromise, expiresAt }; },
    async forward(_command, _digest, request) { const path = new URL(request.url).pathname; if (path === '/observe') return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }); if (path === '/state') return new Response(malformedState ? encode({ simulation_state_id: 'state-a', sequence: -1, state: {} }) : stateBytes, { status: 200, headers: { 'content-type': badStateContentType ? 'application/jsonbad' : 'application/json; charset=utf-8' } }); return new Response('missing', { status: 404 }); },
    browser,
    artifacts: { async save(c, kind, bytes) { if (artifactHang) await new Promise(() => {}); const store = new R2ObserverArtifacts(bucket); const receipt = await store.save(c, kind, bytes); return forgedReceipt ? { ...receipt, sha256: '0'.repeat(64) } : receipt; } },
  };
  Object.defineProperty(ports, 'browser', { get: () => browser, set: (v) => { browser = v; } });
  return { command, ports, objects, revoke: () => { revoked = true; }, badStateContentType: () => { badStateContentType = true; }, malformedState: () => { malformedState = true; }, hangArtifacts: () => { artifactHang = true; }, setBrowser: (v: ObserverExecutionServices['browser']) => { browser = v; }, forge: () => { forgedReceipt = true; } };
}

test('executeObserver emits verified receipts, bounded samples, and shared artifacts', async () => {
  const f = fixture();
  const out = await executeObserver(f.command, f.ports, undefined, () => 1000);
  const result = out.result as any;
  assert.equal(out.stopped, true);
  assert.deepEqual(result.state.simulationStateId, 'state-a');
  assert.equal(result.state.sequence, 7);
  assert.equal(result.view.inline?.type, 'snapshot');
  assert.equal(result.view.startedAt <= result.view.completedAt, true);
  assert.equal(result.state.startedAt <= result.state.completedAt, true);
  assert.equal(f.objects.size, 2);
  for (const value of Object.values(result)) assert.notEqual(value, undefined);
});

test('authorization revocation and parent cancellation stop execution', async () => {
  const revoked = fixture(); revoked.revoke(); await assert.rejects(executeObserver(revoked.command, revoked.ports, undefined, () => 1000), /observer-authority-denied/);
  const cancelled = fixture(); const ac = new AbortController(); let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  cancelled.setBrowser({ async run() { entered(); await new Promise(() => {}); return { stopped: true, payload: { type: 'snapshot', text: '', truncated: false } }; } });
  const pending = executeObserver(cancelled.command, cancelled.ports, ac.signal, () => 1000); await enteredPromise; ac.abort(); await assert.rejects(pending, /observer-execution-cancelled/);
});

test('browser exit must be confirmed and artifact receipts must match content', async () => {
  const exited = fixture(); exited.setBrowser({ async run() { return { stopped: false, payload: { type: 'snapshot', text: '', truncated: false } } as never; } });
  await assert.rejects(executeObserver(exited.command, exited.ports, undefined, () => 1000), /observer-exit-unconfirmed/);
  const forged = fixture(); forged.forge(); await assert.rejects(executeObserver(forged.command, forged.ports, undefined, () => 1000), /observer-artifact-mismatch/);
  const invalidState = fixture(); invalidState.badStateContentType(); await assert.rejects(executeObserver(invalidState.command, invalidState.ports, undefined, () => 1000), /observer-state-invalid/);
  const malformed = fixture(); malformed.malformedState(); await assert.rejects(executeObserver(malformed.command, malformed.ports, undefined, () => 1000), /observer-state-invalid/);
  const revoked = fixture(); revoked.setBrowser({ async run() { revoked.revoke(); return { stopped: true, payload: { type: 'snapshot', text: '', truncated: false } }; } });
  await assert.rejects(executeObserver(revoked.command, revoked.ports, undefined, () => 1000), /observer-authority-denied/);
});

test('one execution budget covers page resources and rejects over-budget browser work', async () => {
  const f = fixture();
  f.setBrowser({ async run({ fetchResource }) { for (let i = 0; i < 32; i++) await fetchResource(new Request('https://p-' + 'a'.repeat(40) + '.preview.example.test/observe')); return { stopped: true, payload: { type: 'snapshot', text: '', truncated: false } }; } });
  await assert.rejects(executeObserver(f.command, f.ports, undefined, () => 1000), /observer-resource-limit/);
});

test('an earlier authorization expiry cancels a hanging browser', async () => {
  const f = fixture({ expiresAt: 1100 });
  f.setBrowser({ async run() { await new Promise(() => {}); return { stopped: true, payload: { type: 'snapshot', text: '', truncated: false } }; } });
  await assert.rejects(executeObserver(f.command, f.ports, undefined, () => 1000), /observer-execution-cancelled/);
});

test('an earlier authorization expiry also cancels a hanging artifact save', async () => {
  const f = fixture({ expiresAt: 1100 }); f.hangArtifacts();
  await assert.rejects(executeObserver(f.command, f.ports, undefined, () => 1000), /observer-execution-cancelled/);
});
