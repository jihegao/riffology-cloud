import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('Workerd TrustedPiCapacity persists the singleton FIFO and rejects another actor', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trusted-pi-capacity-workerd-'));
  const methods = ['request', 'lookup', 'dispatch', 'cancelNeverStarted', 'confirmReleased', 'snapshot'];
  const bundle = await build({ stdin: { contents: `export {TrustedPiCapacity} from './services/capacity/durable.ts';
    export default {async fetch(request,env){
      if(request.method!=='POST'||new URL(request.url).pathname!=='/_capacity-test')return new Response('no-public-route',{status:404});
      const {actor,method,args}=await request.json();if(!${JSON.stringify(methods)}.includes(method))return new Response(null,{status:404});
      try{return Response.json({ok:true,value:await env.TRUSTED_PI_CAPACITY.getByName(actor)[method](...args)})}
      catch(error){return Response.json({ok:false,error:error.message})}
    }};`, resolveDir: fileURLToPath(new URL('../..', import.meta.url)), sourcefile: 'capacity-test-entry.ts' },
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  let mf;
  const options = version => ({ host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, resourcePersistencePath: directory,
    telemetry: { enabled: false }, logRequests: false, workers: [{ config: {
      type: 'worker', name: 'trusted-pi-capacity-test', compatibilityDate: '2026-09-06',
      manifest: { mainModule: 'capacity-test.mjs', modules: { 'capacity-test.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { TRUSTED_PI_CAPACITY_LIMIT: { type: 'text', value: '1' }, TRUSTED_PI_CAPACITY_POLICY_VERSION: { type: 'text', value: version },
        TRUSTED_PI_CAPACITY: { type: 'durable-object', worker: 'trusted-pi-capacity-test', exportName: 'TrustedPiCapacity' } },
      exports: { TrustedPiCapacity: { type: 'durable-object', storage: 'sqlite' } },
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }] });
  const actor = name => Object.fromEntries(methods.map(method => [method, async (...args) => {
    const response = await mf.dispatchFetch('http://capacity.test/_capacity-test', { method: 'POST', body: JSON.stringify({ actor: name, method, args }) });
    assert.equal(response.status, 200); const result = await response.json(); if (!result.ok) throw Error(result.error); return result.value;
  }]));
  const id = operationId => ({ tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', sessionId: 'session-a', operationId, turnId: `turn-${operationId}`, generation: 1 });
  try {
    mf = new Miniflare(options('trusted-pi-v1')); await mf.ready;
    const capacity = actor('trusted-pi-capacity:application');
    const a = await capacity.request(id('a')), b = await capacity.request(id('b'));
    assert.equal(a.ticket.status, 'held'); assert.equal(b.ticket.status, 'queued'); assert.equal(b.ticket.leaseId, null);
    await assert.rejects(actor('wrong-actor').request(id('wrong')), /actor-scope-denied/);
    const reference = { ...id('a'), ticketId: a.ticket.ticketId, leaseId: a.ticket.leaseId, dispatchId: 'dispatch-a' };
    assert.equal((await capacity.dispatch(reference)).authorized, true);
    await mf.dispose(); mf = null; mf = new Miniflare(options('trusted-pi-v1')); await mf.ready;
    assert.equal((await capacity.lookup(id('a'))).ticket.status, 'dispatched'); assert.equal((await capacity.lookup(id('b'))).ticket.status, 'queued');
    const release = await capacity.confirmReleased(reference, { kind: 'runtime-released', proofId: 'release-a', observedAt: Date.now() });
    assert.equal(release.next.operationId, 'b'); assert.equal(release.next.status, 'held'); assert.ok(release.next.leaseId);
    assert.equal((await mf.dispatchFetch('http://capacity.test/')).status, 404);
  } finally { try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
