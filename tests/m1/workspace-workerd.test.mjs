import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

// Production WorkspaceAgent + TenantQuota + ProvisioningCatalog, real local
// Workerd SQLite DO/D1 and alarm delivery. Only ProjectRuntime is an explicit
// durable receipt fixture: this test does not claim native VM or R2 readiness.
test('Workerd alarms resume a lost runtime receipt across process restart and project through actual D1', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm1-workspace-workerd-'));
  const entry = `
    import {DurableObject} from 'cloudflare:workers';
    export {WorkspaceAgent} from './services/workspace/durable.ts';
    export {TenantQuota} from './services/quota/durable.ts';
    import {catalogDatabase} from './services/catalog/database.ts';
    import {ProjectCatalog} from './services/catalog/projects.ts';
    import {ProvisioningCatalog} from './services/catalog/provisioning.ts';
    import {canonicalWorkspaceMarker,workspaceDigest,workspaceAgentName} from './services/workspace/protocol.ts';
    export class ReceiptFixture extends DurableObject {
      async initialize(input) {
        const prior=await this.ctx.storage.get('fixture'); if(prior)return prior.observation;
        const observation={identity:input.identity,phase:'runtime_ready',ready:{receiptId:'fixture-ready',initializedAt:Date.now(),layoutVersion:'m1-empty-v1',
          markerSha256:await workspaceDigest(canonicalWorkspaceMarker(input.identity,input.markerNonce)),checkpointRevision:'a'.repeat(64)},stop:null,failureCode:null};
        await this.ctx.storage.put('fixture',{initializeCount:1,stopCount:0,observation});await this.ctx.storage.sync();
        throw Error('test-only-lost-initialize-response');
      }
      async observe(identity){return (await this.ctx.storage.get('fixture'))?.observation??{identity,phase:'pending',ready:null,stop:null,failureCode:null};}
      async stop(identity){
        const state=await this.ctx.storage.get('fixture')??{initializeCount:0,stopCount:0,observation:{identity,ready:null,failureCode:null}};
        if(!state.observation.stop){state.stopCount++;state.observation.phase='stopped';state.observation.stop={confirmationId:'fixture-stop',observedAt:Date.now(),nativeRunning:false,fenced:true};
          await this.ctx.storage.put('fixture',state);await this.ctx.storage.sync();}return state.observation;
      }
      async facts(){return this.ctx.storage.get('fixture');}
    }
    export default {async fetch(request,env){
      if(request.method!=='POST'||new URL(request.url).pathname!=='/_workspace-test')return new Response(null,{status:404});
      const input=await request.json();try{
        const db=catalogDatabase(env.CATALOG),catalog=new ProvisioningCatalog(db);
        if(input.method==='create'){
          const {project}=await new ProjectCatalog(db,new Set(['blank-v1'])).create({userId:'alpha',authVersion:1},'tenant-alpha','workspace-test',{title:'Fixture',starterVersion:'blank-v1'});
          return Response.json({ok:true,value:await catalog.kickProject({userId:'alpha',authVersion:1},'tenant-alpha',project.id)});
        }
        if(input.method==='quota')return Response.json({ok:true,value:await env.TENANT_QUOTA.getByName('tenant-quota:tenant-alpha').snapshot('tenant-alpha')});
        if(input.method==='fixture')return Response.json({ok:true,value:await env.PROJECT_RUNTIME.getByName(input.runtimeId).facts()});
        if(!['accept','report','stop','reconcile'].includes(input.method))return new Response(null,{status:404});
        const actor=input.actor??workspaceAgentName(input.task.tenantId,input.task.workspaceId);
        return Response.json({ok:true,value:await env.WORKSPACE_AGENT.getByName(actor)[input.method](input.task)});
      }catch(error){return Response.json({ok:false,error:error.message})}
    }};`;
  const bundle = await build({ stdin: { contents: entry, sourcefile: 'workspace-test.ts', resolveDir: process.cwd() }, bundle: true,
    write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  const workerName = 'm1-workspace-local';
  const options = {
    host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, resourcePersistencePath: directory, telemetry: { enabled: false }, logRequests: false,
    workers: [{ config: { type: 'worker', name: workerName, compatibilityDate: '2026-09-06',
      manifest: { mainModule: 'workspace.mjs', modules: { 'workspace.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { CATALOG: { type: 'd1', id: 'workspace-catalog', name: 'workspace-catalog' },
        TENANT_QUOTA_CAPACITY: { type: 'text', value: '1' }, TENANT_QUOTA_POLICY_VERSION: { type: 'text', value: 'm1-test' },
        ...Object.fromEntries([['WORKSPACE_AGENT', 'WorkspaceAgent'], ['TENANT_QUOTA', 'TenantQuota'], ['PROJECT_RUNTIME', 'ReceiptFixture']]
          .map(([binding, exportName]) => [binding, { type: 'durable-object', worker: workerName, exportName }])) },
      exports: Object.fromEntries(['WorkspaceAgent', 'TenantQuota', 'ReceiptFixture'].map(name => [name, { type: 'durable-object', storage: 'sqlite' }])),
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }],
  };
  let mf;
  async function rpc(method, input = {}) {
    const response = await mf.dispatchFetch('http://workspace-local.test/_workspace-test', { method: 'POST', body: JSON.stringify({ method, ...input }) });
    const body=await response.text();assert.equal(response.status,200,body);const result=JSON.parse(body);if(!result.ok)throw Error(`${result.error} [${method}]`);return result.value;
  }
  async function until(predicate, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error('workerd-workspace-observation-deadline');
  }
  try {
    mf = new Miniflare(options); await mf.ready; let db = await mf.getD1Database('CATALOG', workerName);
    for (const path of ['0001_catalog.sql', '0003_provisioning.sql', '0004_operator_invitations.sql', '0005_initial_operator.sql', '0006_model_catalog.sql','0007_model_content_checks.sql']) {
      const sql = (await readFile(`services/catalog/migrations/${path}`, 'utf8')).replace(/--[^\n]*/g, '');
      // Preserve a trigger's internal semicolon as part of one SQL statement.
      const statements = sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? [];
      for (const statement of statements) if (statement.trim()) await db.prepare(statement).run();
    }
    const now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('alpha','test-only','alpha','alpha@example.test',?,?)").bind(now, now),
      db.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',?,?)").bind(now, now),
      db.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',?,?)").bind(now, now),
    ]);
    const { task } = await rpc('create');
    await assert.rejects(rpc('accept', { task, actor: 'wrong-actor' }), /actor-scope-denied/);
    await assert.rejects(rpc('accept', { task: { ...task, id: 'forged-task' } }), /not-known/);
    const accepted = await Promise.all([rpc('accept', { task }), rpc('accept', { task })]); assert.equal(accepted[0].runtimeId, accepted[1].runtimeId);
    const before = await until(async () => { const state = await rpc('report', { task }); return state.intents.initialize && !state.effect ? state : null; });
    assert.equal(before.runtimeReceipt, null); assert.equal(before.intents.initialize, true); assert.equal((await rpc('quota')).occupied, 1);
    const firstFixture = await rpc('fixture', { runtimeId: before.runtimeId }); assert.equal(firstFixture.initializeCount, 1);
    await mf.dispose(); mf = null;
    assert.ok((await readdir(directory, { recursive: true })).some(path => path.endsWith('.sqlite')));
    mf = new Miniflare(options); await mf.ready; db = await mf.getD1Database('CATALOG', workerName);
    const result = await until(async () => { const state = await rpc('report', { task }); return state.projectionConfirmed ? state : null; });
    assert.equal(result.runtimeId, before.runtimeId); assert.equal(result.projection.outcome, 'ready'); assert.equal(result.quotaReleased, true); assert.equal(result.wakeAt, null);
    const fixture = await rpc('fixture', { runtimeId: result.runtimeId }); assert.equal(fixture.initializeCount, 1); assert.equal(fixture.stopCount, 1);
    assert.equal((await rpc('quota')).occupied, 0); assert.deepEqual(result.runtimeReceipt, firstFixture.observation.ready);
    const row = await db.prepare('SELECT p.status,o.state,o.projection_sequence FROM catalog_projects p JOIN catalog_outbox o ON o.project_id=p.id WHERE p.id=?').bind(task.projectId).first();
    assert.equal(row.status, 'ready'); assert.equal(row.state, 'completed'); assert.equal(row.projection_sequence, 1);
    assert.deepEqual(await rpc('accept', { task }), result);
    await assert.rejects(rpc('stop', { task: { ...task, generation: 2 } }), /conflict/);
    assert.equal((await mf.dispatchFetch('http://workspace-local.test/')).status, 404);
  } finally { try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
