import assert from 'node:assert/strict';
import test from 'node:test';
import {observerRuntimePublicRequest, observerRuntimeRequest} from '../../services/preview/observer-runtime.ts';
import {SERVICE_HTTP_ORIGIN} from '../../services/preview/http.ts';
import {scope, spec, reference} from './run-fixture.ts';
import type {ServiceRuntimeInput} from '../../services/run/runtime-protocol.ts';

const now = 1000;
const origin = `https://p-${'a'.repeat(40)}.preview.example.test`;
const pagePath = '/observe';
const statePath = '/api/state';

function runtimeInput(): ServiceRuntimeInput {
  const base = spec();
  const plan = {
    ...base.plan,
    declaration: {...base.plan.declaration, observation: {pagePath, statePath}},
  };
  const runtime = reference('run-a');
  return {
    reference: runtime,
    scope,
    spec: {...base, plan},
    lease: {
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      generation: 1,
      operation: 'service-run',
      operationId: runtime.dispatchId,
      deadlineAt: runtime.deadlineAt,
      runId: runtime.runId,
      leaseId: runtime.leaseId,
    },
  };
}

function policy() {
  return {origin, pagePath, statePath};
}

test('observer runtime request returns a closed descriptor bound to runtime observation', () => {
  const result = observerRuntimeRequest({purpose: 'observer', runtime: runtimeInput(), policy: policy(), deadlineAt: 4000}, () => now);
  assert.deepEqual(result, {purpose: 'observer', runtime: runtimeInput(), policy: policy(), deadlineAt: 4000});
  assert.deepEqual(Reflect.ownKeys(result), ['purpose', 'runtime', 'policy', 'deadlineAt']);
  for (const key of Reflect.ownKeys(result)) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key)!;
    assert.equal(descriptor.enumerable, true);
    assert.equal(Object.hasOwn(descriptor, 'value'), true);
  }
  assert.deepEqual(result.runtime.spec.plan.declaration.observation, {pagePath, statePath});
  assert.equal(Object.isFrozen(result.policy), true);
});

test('observer runtime rejects expired, overlong, run-expired, mismatched, or malformed descriptors', () => {
  const valid = () => ({purpose: 'observer' as const, runtime: runtimeInput(), policy: policy(), deadlineAt: 4000});
  for (const deadlineAt of [now, 16001, 5001]) {
    assert.throws(() => observerRuntimeRequest({...valid(), deadlineAt}, () => now), /observer-runtime-denied/);
  }
  assert.throws(() => observerRuntimeRequest({...valid(), policy: {...policy(), statePath: '/wrong'}}, () => now), /observer-runtime-denied/);
  assert.throws(() => observerRuntimeRequest({...valid(), purpose: 'browser'} as never, () => now), /observer-runtime-denied/);
});

test('unknown keys and getters are rejected without executing getters', () => {
  let getterCalls = 0;
  assert.throws(() => observerRuntimeRequest({...({purpose: 'observer', runtime: runtimeInput(), policy: policy(), deadlineAt: 4000}), extra: true} as never, () => now), /observer-runtime-denied/);
  const raw = Object.defineProperties({}, {
    purpose: {enumerable: true, get() { getterCalls++; return 'observer'; }},
    runtime: {enumerable: true, value: runtimeInput()},
    policy: {enumerable: true, value: policy()},
    deadlineAt: {enumerable: true, value: 4000},
  });
  assert.throws(() => observerRuntimeRequest(raw as never, () => now), /observer-runtime-denied/);
  assert.equal(getterCalls, 0);
});

test('public observer requests accept only fixed internal page and state paths and return public origin', () => {
  for (const path of [pagePath, statePath]) {
    const result = observerRuntimePublicRequest(new Request(SERVICE_HTTP_ORIGIN + path, {
      method: 'GET',
      headers: {cookie: 'secret=1', authorization: 'Bearer secret', 'x-riff-observer': 'forged'},
    }), policy());
    assert.equal(result.url, origin + path);
    assert.equal(result.method, 'GET');
    assert.equal(result.headers.get('cookie'), null);
    assert.equal(result.headers.get('authorization'), null);
    assert.equal(result.headers.get('x-riff-observer'), 'read-only');
    assert.equal(result.headers.get('accept'), path === statePath ? 'application/json' : 'text/html');
  }
});

test('public observer requests reject external, queried, POST, and websocket destinations', () => {
  const denied = [
    new Request(origin + pagePath),
    new Request(SERVICE_HTTP_ORIGIN + pagePath + '?x=1'),
    new Request(SERVICE_HTTP_ORIGIN + pagePath, {method: 'POST', body: 'x'}),
    new Request(SERVICE_HTTP_ORIGIN + pagePath, {headers: {upgrade: 'websocket'}}),
  ];
  for (const request of denied) assert.throws(() => observerRuntimePublicRequest(request, policy()), /observer-runtime-denied|observer-http-denied/);
});
