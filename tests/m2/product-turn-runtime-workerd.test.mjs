import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('production ProductTurnRuntime binding validates its actor and fails closed before release', async () => {
  const entry = `
    export {ProductTurnRuntime} from './services/turn-runtime/durable.ts';
    import {turnRuntimeActorName} from './services/turn-runtime/identity.ts';
    export default {async fetch(request,env){
      if(request.method!=='POST')return new Response(null,{status:404});
      const input=await request.json(),name=input.wrong?'wrong-runtime-actor':await turnRuntimeActorName(input.identity);
      try{return Response.json({ok:true,value:await env.PRODUCT_TURN_RUNTIME.getByName(name).accept({...input.identity,actor:{userId:'user-a',authVersion:1},message:'Build model',base:{workspace:null,session:null}})});}
      catch(error){return Response.json({ok:false,error:error.message});}
    }};`;
  const bundle = await build({ stdin: { contents: entry, sourcefile: 'product-turn-runtime-test.ts', resolveDir: process.cwd() }, bundle: true,
    write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  const workerName = 'm2-product-turn-runtime-local';
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, telemetry: { enabled: false }, logRequests: false,
    workers: [{ config: { type: 'worker', name: workerName, compatibilityDate: '2026-09-06',
      manifest: { mainModule: 'runtime.mjs', modules: { 'runtime.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { PRODUCT_TURN_RUNTIME: { type: 'durable-object', worker: workerName, exportName: 'ProductTurnRuntime' } },
      exports: { ProductTurnRuntime: { type: 'durable-object', storage: 'sqlite' } },
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }],
  });
  const identity = { scope: { tenantId: 'tenant-a', projectId: 'project-a', workspaceId: 'workspace-a', workspaceGeneration: 2 },
    sessionId: 'session-a', turnId: 'turn-a', dispatchId: 'dispatch-a', generation: 2 };
  async function invoke(wrong) {
    const response = await mf.dispatchFetch('http://product-turn-runtime.test/', { method: 'POST', body: JSON.stringify({ identity, wrong }) });
    assert.equal(response.status, 200); return response.json();
  }
  try {
    assert.deepEqual(await invoke(true), { ok: false, error: 'product-turn-runtime-actor-scope-denied' });
    assert.deepEqual(await invoke(false), { ok: false, error: 'product-turn-runtime-release-not-configured' });
    assert.equal((await mf.dispatchFetch('http://product-turn-runtime.test/')).status, 404);
  } finally { await mf.dispose(); }
});
