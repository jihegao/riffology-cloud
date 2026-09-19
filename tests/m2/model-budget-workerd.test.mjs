import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { modelBudgetTenantName, modelCallReference } from '../../services/model-budget/core.ts';

test('Workerd TenantModelBudget preserves tenant scope, dispatch fence and policy across restart', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm2-model-budget-workerd-'));
  const methods = ['reserve', 'lookup', 'dispatch', 'markUnknown', 'finish', 'releaseUndispatched', 'snapshot', 'closeTurnAdmission', 'executionIsolationCandidate', 'recordExecutionIsolation'];
  const bundle = await build({ stdin: { contents: `export {TenantModelBudget} from './services/model-budget/durable.ts';
    export default {async fetch(request,env){
      if(request.method!=='POST'||new URL(request.url).pathname!=='/_model-budget-test')return new Response('no-public-route',{status:404});
      const {actor,method,args}=await request.json();
      if(!${JSON.stringify(methods)}.includes(method))return new Response(null,{status:404});
      try{return Response.json({ok:true,value:await env.TENANT_MODEL_BUDGET.getByName(actor)[method](...args)})}
      catch(error){return Response.json({ok:false,error:error.message})}
    }};`, resolveDir: fileURLToPath(new URL('../..', import.meta.url)), sourcefile: 'model-budget-workerd-entry.ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  let mf;
  const options = (version, attempts = 3) => ({ host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, resourcePersistencePath: directory,
    telemetry: { enabled: false }, logRequests: false, workers: [{ config: {
      type: 'worker', name: 'm2-model-budget-local', compatibilityDate: '2026-09-06',
      manifest: { mainModule: 'model-budget.mjs', modules: { 'model-budget.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: {
        MODEL_BUDGET_POLICY_VERSION: { type: 'text', value: version },
        MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN: { type: 'text', value: String(attempts) },
        MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN: { type: 'text', value: '2' },
        MODEL_BUDGET_MAX_INPUT_TOKENS_PER_CALL: { type: 'text', value: '80' },
        MODEL_BUDGET_MAX_OUTPUT_TOKENS_PER_CALL: { type: 'text', value: '20' },
        MODEL_BUDGET_MAX_RESERVED_TOKENS_PER_TURN: { type: 'text', value: '120' },
        M2_MODEL_TURN_CAPABILITY_KEY: { type: 'text', value: 'fixture-model-turn-capability-key-32-bytes' },
        TENANT_MODEL_BUDGET: { type: 'durable-object', worker: 'm2-model-budget-local', exportName: 'TenantModelBudget' },
      },
      exports: { TenantModelBudget: { type: 'durable-object', storage: 'sqlite' } },
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }] });
  const namespace = { getByName: actor => Object.fromEntries(methods.map(method => [method, async (...args) => {
    const response = await mf.dispatchFetch('http://model-budget-local.test/_model-budget-test', { method: 'POST', body: JSON.stringify({ actor, method, args }) });
    assert.equal(response.status, 200); const result = await response.json(); if (!result.ok) throw Error(result.error); return result.value;
  }])) };
  const identity = tenantId => ({ scope: { tenantId, projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 1 }, sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 1 });
  const request = (tenantId, overrides = {}) => ({ schemaVersion: 1, identity: identity(tenantId), actor: { userId: 'user-a', authVersion: 1 }, callId: 'call-a', requestId: `request-${tenantId}`, deadlineAt: Date.now() + 60_000, provider: 'provider-a', model: 'model-a', payloadSha256: 'a'.repeat(64), inputTokenUpperBound: 60, maxOutputTokens: 20, inputBoundVersion: 'bound-v1', budgetPolicyVersion: 'policy-v1', ...overrides });
  const actorA = namespace.getByName(modelBudgetTenantName('tenant-a'));
  try {
    mf = new Miniflare(options('policy-v1')); await mf.ready;
    await assert.rejects(namespace.getByName('wrong-actor').reserve('tenant-a', request('tenant-a')), /actor-scope-denied/);
    await assert.rejects(actorA.reserve('tenant-b', request('tenant-b')), /actor-scope-denied/);
    const concurrentRequest=request('tenant-a');
    const reservations = await Promise.all([actorA.reserve('tenant-a', concurrentRequest), actorA.reserve('tenant-a', concurrentRequest)]);
    assert.equal(reservations.filter(value => !value.replayed).length, 1);
    const reference = modelCallReference(reservations[0].record);
    const dispatches = await Promise.all([actorA.dispatch('tenant-a', reference), actorA.dispatch('tenant-a', reference)]);
    assert.equal(dispatches.filter(value => value.authorized).length, 1);
    await actorA.markUnknown('tenant-a', reference);
    assert.equal((await actorA.snapshot('tenant-a', identity('tenant-a'))).pending, 1);
    await mf.dispose(); mf = null;
    assert.ok((await readdir(directory, { recursive: true })).some(path => path.endsWith('.sqlite')), 'persistent SQLite database exists after Workerd exits');

    mf = new Miniflare(options('policy-v1')); await mf.ready;
    assert.equal((await actorA.dispatch('tenant-a', reference)).observeOnly, true);
    await actorA.finish('tenant-a', reference, { outcome: 'completed', errorCode: null, providerRequestId: 'provider-request-a', usage: { kind: 'verified', inputTokens: 10, outputTokens: 5, source: 'provider-usage', observedAt: Date.now() } });
    const restored = await actorA.snapshot('tenant-a', identity('tenant-a'));
    assert.equal(restored.attempts, 1); assert.equal(restored.dispatchedCalls, 1); assert.equal(restored.accountedTokens, 15);
    await mf.dispose(); mf = null;

    mf = new Miniflare(options('policy-v2', 4)); await mf.ready;
    assert.equal((await actorA.snapshot('tenant-a', identity('tenant-a'))).configuredPolicyMatches, false);
    await assert.rejects(actorA.reserve('tenant-a', request('tenant-a', { callId: 'call-b', requestId: 'request-b', budgetPolicyVersion: 'policy-v2' })), /policy-conflict/);
    const actorB = namespace.getByName(modelBudgetTenantName('tenant-b'));
    const tenantB = await actorB.reserve('tenant-b', request('tenant-b', { budgetPolicyVersion: 'policy-v2' }));
    assert.equal(tenantB.record.identity.scope.tenantId, 'tenant-b');
    assert.equal((await actorB.snapshot('tenant-b', identity('tenant-b'))).attempts, 1);
    const tenantCIdentity=identity('tenant-c'),actorC=namespace.getByName(modelBudgetTenantName('tenant-c')),tenantCRequest=request('tenant-c',{budgetPolicyVersion:'policy-v2',deadlineAt:Date.now()+100});
    const tenantC=await actorC.reserve('tenant-c',tenantCRequest),tenantCRef=modelCallReference(tenantC.record);await actorC.dispatch('tenant-c',tenantCRef);await actorC.markUnknown('tenant-c',tenantCRef);await actorC.closeTurnAdmission('tenant-c',tenantCIdentity);await new Promise(resolve=>setTimeout(resolve,120));
    const candidate=await actorC.executionIsolationCandidate('tenant-c',tenantC.record.callKey),proof={schemaVersion:1,callKey:candidate.blocker.callKey,turnKey:candidate.blocker.turnKey,recordDigest:candidate.recordDigest,evidenceSha256:'e'.repeat(64),isolatedAt:Date.now(),classification:'runtime-absent-and-fenced'};
    await assert.rejects(actorC.recordExecutionIsolation('tenant-c',proof,'f'.repeat(64)),/authority-invalid/);
    assert.equal((await mf.dispatchFetch('http://model-budget-local.test/')).status, 404);
  } finally { try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
