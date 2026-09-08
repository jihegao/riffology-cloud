import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { leaseReference } from '../../services/quota/core.ts';

// Real local Workerd, actual SQLite DO storage and RPC, no deployed Worker,
// simulated identity, Containers or outbound network. Existing Wrangler-locked
// Miniflare/esbuild packages are reused; this test installs nothing.
test('Workerd service quota: shared capacity, restart, run scope and replacement fencing', { timeout: 45_000 }, async () => {
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
    mf = new Miniflare(options(2)); await mf.ready;
    const actor = namespace.getByName('tenant-quota:tenant-a');
    const workspace = request('project-a','workspace-a','workspace-operation');
    const service = {...workspace,operation:'service-run',operationId:'service-operation',runId:'run-a',generation:7};
    const [w,s] = await Promise.all([actor.acquire(workspace),actor.acquire(service)]);
    assert.equal(w.outcome,'acquired');assert.equal(s.outcome,'acquired');
    assert.equal((await actor.snapshot('tenant-a')).occupied,2);
    assert.equal((await actor.acquire({...service,operationId:'extra-run',runId:'run-b'})).denial,'quota-exhausted');
    assert.equal((await actor.acquire({...service,operationId:'same-run'})).denial,'run-held');
    await actor.dispatch(leaseReference(s.lease)); await actor.markUnknown(leaseReference(s.lease));
    await mf.dispose();mf=null;mf=new Miniflare(options(2));await mf.ready;
    assert.equal((await actor.snapshot('tenant-a')).unknown,1);
    assert.equal((await actor.acquire(service)).lease.leaseId,s.lease.leaseId);
    await assert.rejects(namespace.getByName('wrong-actor').acquire(service),/actor-scope-denied/);
    await assert.rejects(actor.dispatch({...leaseReference(s.lease),runId:'run-b'}),/scope-denied/);
    const proof={kind:'runtime-stopped',confirmationId:'service-stop',observedAt:Date.now()};
    await actor.confirmStopped(leaseReference(s.lease),proof);
    const replacement=await actor.acquire({...service,operationId:'replacement',generation:8});
    assert.equal(replacement.outcome,'acquired');
    assert.equal((await actor.confirmStopped(leaseReference(s.lease),proof)).released,false);
    assert.equal((await actor.snapshot('tenant-a')).occupied,2);
    await actor.confirmStopped(leaseReference(w.lease),{kind:'never-started',confirmationId:'workspace-stop',observedAt:Date.now()});
    assert.equal((await actor.acquire({...workspace,operationId:'next-workspace',generation:2})).outcome,'acquired');
    assert.equal((await mf.dispatchFetch('http://quota-local.test/')).status,404);
  } finally { try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
