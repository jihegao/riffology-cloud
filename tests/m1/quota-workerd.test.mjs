import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { leaseReference } from '../../services/quota/core.ts';

// Real local Workerd, actual SQLite DO storage and RPC, no deployed Worker,
// simulated identity, Containers or outbound network. Existing Wrangler-locked
// Miniflare/esbuild packages are reused; this test installs nothing.
test('Workerd SQLite DO: cross-project race, wrong-actor rejection, process restart and stopped fencing', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-quota-workerd-'));
  const bundle = await build({ stdin: { contents: `export {TenantQuota} from './services/quota/durable.ts';
    export default {async fetch(request,env){
      if(request.method!=='POST'||new URL(request.url).pathname!=='/_quota-test')return new Response('no-public-route',{status:404});
      const {actor,method,args}=await request.json();
      if(!['snapshot','acquire','lookup','dispatch','confirmStopped','markUnknown','reconcile'].includes(method))return new Response(null,{status:404});
      try{return Response.json({ok:true,value:await env.TENANT_QUOTA.getByName(actor)[method](...args)})}
      catch(error){return Response.json({ok:false,error:error.message})}
    }};`, resolveDir: fileURLToPath(new URL('../..', import.meta.url)), sourcefile: 'quota-test-entry.ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  let mf;
  const options = capacity => ({ host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, resourcePersistencePath: directory,
    telemetry: { enabled: false }, logRequests: false, workers: [{ config: {
      type: 'worker', name: 'm1-quota-local', compatibilityDate: '2026-09-05',
      manifest: { mainModule: 'quota-test.mjs', modules: { 'quota-test.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { TENANT_QUOTA_CAPACITY: { type: 'text', value: String(capacity) }, TENANT_QUOTA_POLICY_VERSION: { type: 'text', value: 'invite-v1' },
        TENANT_QUOTA: { type: 'durable-object', worker: 'm1-quota-local', exportName: 'TenantQuota' } },
      exports: { TenantQuota: { type: 'durable-object', storage: 'sqlite' } },
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }] });
  const namespace = { getByName: actor => Object.fromEntries(['snapshot','acquire','lookup','dispatch','confirmStopped','markUnknown','reconcile'].map(method => [method, async (...args) => {
    const response = await mf.dispatchFetch('http://quota-local.test/_quota-test', { method: 'POST', body: JSON.stringify({ actor, method, args }) });
    assert.equal(response.status, 200); const result = await response.json(); if (!result.ok) throw Error(result.error); return result.value;
  }])) };
  const request = (projectId, workspaceId, operationId, generation = 1) => ({ tenantId: 'tenant-a', projectId, workspaceId, operationId, generation, operation: 'workspace-runtime', deadlineAt: Date.now() + 60_000 });
  try {
    mf = new Miniflare(options(1)); await mf.ready;
    const actor = namespace.getByName('tenant-quota:tenant-a');
    await assert.rejects(namespace.getByName('wrong-actor').snapshot('tenant-a'), /actor-scope-denied/);
    await assert.rejects(actor.snapshot('tenant-b'), /actor-scope-denied/);
    const a = request('project-a', 'workspace-a', 'operation-a'), b = request('project-b', 'workspace-b', 'operation-b');
    const attempts = await Promise.all([actor.acquire(a), actor.acquire(b)]);
    assert.equal(attempts.filter(r => r.outcome === 'acquired').length, 1); assert.equal(attempts.filter(r => r.denial === 'quota-exhausted').length, 1);
    const winner = attempts.find(r => r.lease).lease, ref = leaseReference(winner);
    const dispatches = await Promise.all([actor.dispatch(ref), actor.dispatch(ref)]); assert.equal(dispatches.filter(r => r.authorized).length, 1);
    await actor.markUnknown(ref);
    const before = await actor.snapshot('tenant-a'); assert.equal(before.occupied, 1); assert.equal(before.unknown, 1);
    await assert.rejects(actor.confirmStopped(ref, { kind: 'never-started', confirmationId: 'bad-stop', observedAt: Date.now() }), /stop-not-confirmed/);
    await mf.dispose(); mf = null;
    assert.ok((await readdir(directory, { recursive: true })).some(path => path.endsWith('.sqlite')), 'persistent SQLite database exists after Workerd exits');
    mf = new Miniflare(options(2)); await mf.ready;
    const restored = await actor.snapshot('tenant-a'); assert.equal(restored.capacity, 1); assert.equal(restored.occupied, 1); assert.equal(restored.configuredPolicyMatches, false);
    assert.equal(restored.leases[0].leaseId, winner.leaseId);
    await assert.rejects(actor.acquire(request('project-c', 'workspace-c', 'operation-c')), /policy-conflict/);
    const confirmation = { kind: 'runtime-stopped', confirmationId: 'stop-winner', observedAt: Date.now() };
    assert.equal((await actor.confirmStopped(ref, confirmation)).released, true); assert.equal((await actor.confirmStopped(ref, confirmation)).released, false);
    await mf.dispose(); mf = null;

    mf = new Miniflare(options(1)); await mf.ready;
    const fresh = request(winner.projectId, winner.workspaceId, 'operation-next', 2);
    assert.equal(await actor.lookup('tenant-a', fresh.operationId), null); assert.equal((await actor.snapshot('tenant-a')).occupied, 0);
    const next = await actor.acquire(fresh); assert.equal(next.outcome, 'acquired');
    assert.equal((await actor.confirmStopped(ref, confirmation)).released, false); assert.equal((await actor.snapshot('tenant-a')).occupied, 1);
    await assert.rejects(actor.confirmStopped({ ...leaseReference(next.lease), generation: 1 }, { kind: 'runtime-stopped', confirmationId: 'old-generation', observedAt: Date.now() }), /scope-denied/);
    await actor.confirmStopped(leaseReference(next.lease), { kind: 'never-started', confirmationId: 'stop-next', observedAt: Date.now() });
    assert.equal((await actor.snapshot('tenant-a')).occupied, 0);
    const response = await mf.dispatchFetch('http://quota-local.test/'); assert.equal(response.status, 404);
  } finally { try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
