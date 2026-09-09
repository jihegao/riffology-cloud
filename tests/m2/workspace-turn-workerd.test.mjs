import {checkpointKey} from '../../services/runtime/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { workspaceAgentName } from '../../services/workspace/protocol.ts';

// Production WorkspaceAgent, Turn journal/dispatcher/shared alarm and SQLite
// storage. The two external runtimes are explicit receipt fixtures, so this
// proves the DO wiring and recovery contract without claiming a Pi VM run.
test('Workerd drives one durable Turn through the independent runtime actor', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'm2-workspace-turn-workerd-'));
  const entry = `
    import {DurableObject} from 'cloudflare:workers';
    import {WorkspaceAgent as ProductionWorkspaceAgent} from './services/workspace/durable.ts';
    import {DurableTurnAlarmPort} from './services/workspace/turn-alarm.ts';
    import {TurnJournal} from './services/turn/journal.ts';
    import {DurableTurnStore} from './services/turn/store.ts';
    import {DurableWorkspaceStore} from './services/workspace/store.ts';
    export class WorkspaceAgent extends ProductionWorkspaceAgent {
      async runAlarmForTest(){await new DurableTurnAlarmPort(this.ctx.storage).schedule(Date.now());return super.alarm();}
      async readinessForTest(confirmed){return new DurableWorkspaceStore(this.ctx.storage).update(state=>({...state,projectionConfirmed:confirmed}));}
      async compactForTest(scope){return new TurnJournal(new DurableTurnStore(this.ctx.storage)).compact(scope,1,4096);}
      async dispatchForTest(scope,id){return (await new TurnJournal(new DurableTurnStore(this.ctx.storage)).snapshot(scope)).turns[id].dispatchId;}
    }
    export {TenantQuota} from './services/quota/durable.ts';
    import {ToolArtifactStore as ProductionArtifactStore} from './services/artifacts/durable.ts';
    export class ToolArtifactStore extends ProductionArtifactStore {async sweepForTest(){await this.alarm();return this.ctx.storage.getAlarm();}}
    import {catalogDatabase} from './services/catalog/database.ts';
    import {ProjectCatalog} from './services/catalog/projects.ts';
    import {ProvisioningCatalog} from './services/catalog/provisioning.ts';
    import {canonicalWorkspaceMarker,workspaceDigest,workspaceAgentName} from './services/workspace/protocol.ts';
    import {TOOL_ARTIFACT_STORE_ACTOR} from './services/artifacts/protocol.ts';
    import {initialCheckpoint} from './services/runtime/starter.ts';
    import {checkpointKey} from './services/runtime/core.ts';
    import {InitialWorkspaceResolver} from './services/turn-runtime/initial-workspace.ts';

    export class WorkspaceReceiptFixture extends DurableObject {
      async initialize(input) {
        const prior=await this.ctx.storage.get('observation'); if(prior)return prior;
        const checkpoint=await initialCheckpoint(input);await this.env.WORKSPACE_CHECKPOINTS.put(checkpointKey(input.identity),checkpoint.text);
        const observation={identity:input.identity,phase:'runtime_ready',ready:{receiptId:'workspace-ready',initializedAt:Date.now(),layoutVersion:'m1-empty-v1',
          markerSha256:await workspaceDigest(canonicalWorkspaceMarker(input.identity,input.markerNonce)),checkpointRevision:checkpoint.revision},stop:null,failureCode:null};
        await this.ctx.storage.put('observation',observation);await this.ctx.storage.sync();return observation;
      }
      async observe(identity){return (await this.ctx.storage.get('observation'))??{identity,phase:'pending',ready:null,stop:null,failureCode:null};}
      async stop(identity){
        const observation=(await this.ctx.storage.get('observation'))??{identity,phase:'pending',ready:null,stop:null,failureCode:null};
        if(!observation.stop){observation.phase='stopped';observation.stop={confirmationId:'workspace-stop',observedAt:Date.now(),nativeRunning:false,fenced:true};
          await this.ctx.storage.put('observation',observation);await this.ctx.storage.sync();}return observation;
      }
    }

    export class ProductTurnReceiptFixture extends DurableObject {
      async accept(input) {
        const prior=await this.ctx.storage.get('receipt');if(prior)return prior;
        const mode=input.message==='drop-accept'?'drop-accept':input.message==='running-cancel'?'running-cancel':'normal';
        await this.ctx.storage.put('mode',mode);
        if(mode==='running-cancel'){
          await this.env.CATALOG.prepare('INSERT INTO fixture_turn_calls(turn_id,accept_count) VALUES(?,1) ON CONFLICT(turn_id) DO UPDATE SET accept_count=accept_count+1').bind(input.turnId).run();
          return {...input,phase:'running',outcome:null};
        }
        const now=Date.now(),artifact=mode==='normal'?(await this.env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR).materialize({identity:{scope:input.scope,turnId:input.turnId,dispatchId:input.dispatchId,commandId:'command-'+input.turnId,effectId:'effect-'+input.turnId,operation:'list'},mediaType:'application/json',content:new TextEncoder().encode(JSON.stringify({kind:'list',entries:['x'.repeat(17000)]}))})).receipt:null,
          events=[{eventId:'assistant-'+input.turnId,type:'assistant.message',at:now,payload:{text:'fixture complete'}}];
        if(artifact)events.push({eventId:'tool-'+input.turnId,type:'tool.completed',at:now,payload:{toolCallId:'call-'+input.turnId,name:'project_list',isError:false,artifact}});
        const receipt={scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,
          phase:'terminal',outcome:'completed',events,
          checkpoint:{revisionId:'revision-'+input.turnId,objectKey:'checkpoint-'+input.turnId,filesSha256:'b'.repeat(64),sessionSha256:'c'.repeat(64),committedAt:now},
          stopped:{confirmationId:'stop-'+input.turnId,observedAt:now,nativeRunning:false,fenced:true}};
        await this.ctx.storage.put('receipt',receipt);await this.ctx.storage.sync();
        await this.env.CATALOG.prepare('INSERT INTO fixture_turn_calls(turn_id,accept_count) VALUES(?,1) ON CONFLICT(turn_id) DO UPDATE SET accept_count=accept_count+1').bind(input.turnId).run();
        if(mode==='drop-accept')throw Error('fixture-dropped-accept-response');
        return receipt;
      }
      async observe(input){
        await this.env.CATALOG.prepare('INSERT INTO fixture_turn_calls(turn_id,observe_count) VALUES(?,1) ON CONFLICT(turn_id) DO UPDATE SET observe_count=observe_count+1').bind(input.turnId).run();
        const receipt=await this.ctx.storage.get('receipt');
        if(receipt)return receipt;
        return {...input,phase:'absent',outcome:null};
      }
      async cancel(input){
        const prior=await this.ctx.storage.get('receipt');if(prior)return prior;
        const mode=await this.ctx.storage.get('mode');
        if(mode!=='running-cancel')return this.observe(input);
        const now=Date.now(),receipt={scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation,
          phase:'terminal',outcome:'cancelled',events:[],checkpoint:{revisionId:'revision-'+input.turnId,objectKey:'checkpoint-'+input.turnId,filesSha256:'b'.repeat(64),sessionSha256:'c'.repeat(64),committedAt:now},
          stopped:{confirmationId:'stop-'+input.turnId,observedAt:now,nativeRunning:false,fenced:true}};
        await this.ctx.storage.put('receipt',receipt);await this.ctx.storage.sync();
        await this.env.CATALOG.prepare('INSERT INTO fixture_turn_calls(turn_id,cancel_count) VALUES(?,1) ON CONFLICT(turn_id) DO UPDATE SET cancel_count=cancel_count+1').bind(input.turnId).run();
        throw Error('fixture-dropped-cancel-response');
      }
    }

    export class RevisionStoreFixture extends DurableObject {
      // Selection fixture only; real declaration/content validation is covered
      // independently by RevisionStore Workerd tests.
      async previewPlan(source){return {selectionFixture:true,source};}
      async initialPreviewPlan(reference,scope){const initial=await this.resolveInitial(reference,scope);return this.previewPlan({kind:'initial-workspace',reference:initial.reference,filesSha256:initial.filesSha256});}
      async resolveInitial(reference,scope){return new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS).resolve(reference,scope);}
      async files(identity,receipt){return {schemaVersion:1,files:[{path:'model/'+identity.turnId+'.py',type:'file',size:17,mode:420}]};}
      async diff(identity,receipt){return {schemaVersion:1,summary:{added:1,modified:0,deleted:0},changes:[{path:'model/'+identity.turnId+'.py',change:'added',type:'file',size:17,mode:420}]};}
    }

    export default {async fetch(request,env){
      if(request.method!=='POST'||new URL(request.url).pathname!=='/_turn-test')return new Response(null,{status:404});
      const input=await request.json();try{
        const db=catalogDatabase(env.CATALOG),catalog=new ProvisioningCatalog(db);
        if(input.method==='create'){
          const {project}=await new ProjectCatalog(db,new Set(['blank-v1'])).create({userId:'alpha',authVersion:1},'tenant-alpha','workspace-turn-test',{title:'Fixture',starterVersion:'blank-v1'});
          return Response.json({ok:true,value:await catalog.kickProject({userId:'alpha',authVersion:1},'tenant-alpha',project.id)});
        }
        if(input.method==='calls')return Response.json({ok:true,value:await env.CATALOG.prepare('SELECT * FROM fixture_turn_calls WHERE turn_id=?').bind(input.turnId).first()});
        const stub=env.WORKSPACE_AGENT.getByName(input.actorName??workspaceAgentName(input.scope?.tenantId??input.task.tenantId,input.scope?.workspaceId??input.task.workspaceId));
        if(input.method==='accept'||input.method==='report')return Response.json({ok:true,value:await stub[input.method](input.task)});
        if(input.method==='createSession')return Response.json({ok:true,value:await stub.createSession({scope:input.scope,actor:input.actor,key:input.key,body:{title:input.title}})});
        if(input.method==='submitTurn')return Response.json({ok:true,value:await stub.submitTurn({scope:input.scope,actor:input.actor,sessionId:input.sessionId,key:input.key,body:{message:input.message}})});
        if(input.method==='cancelTurn')return Response.json({ok:true,value:await stub.cancelTurn({scope:input.scope,actor:input.actor,turnId:input.turnId})});
        if(input.method==='runAlarm'){await stub.runAlarmForTest();return Response.json({ok:true,value:true});}
        if(input.method==='snapshot')return Response.json({ok:true,value:await stub.turnSnapshot({scope:input.scope})});
        if(input.method==='previewPlan')return Response.json({ok:true,value:await stub.previewPlan({scope:input.scope})});
        if(input.method==='files')return Response.json({ok:true,value:await stub.listFiles({scope:input.scope})});
        if(input.method==='diff')return Response.json({ok:true,value:await stub.diffFiles({scope:input.scope})});
        if(input.method==='artifact'){const value=await stub.readArtifact({scope:input.scope,artifactId:input.artifactId});return Response.json({ok:true,value:{receipt:value.receipt,content:new TextDecoder().decode(value.content)}});}
        if(input.method==='sweepArtifacts')return Response.json({ok:true,value:await env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR).sweepForTest()});
        if(input.method==='artifactReferences')return Response.json({ok:true,value:await env.TOOL_ARTIFACT_STORE.getByName(TOOL_ARTIFACT_STORE_ACTOR).references(input.scope,input.artifactId)});
        if(input.method==='retireArtifact')return Response.json({ok:true,value:await stub.releaseRetiredArtifactEvent(input.reference)});
        if(input.method==='readiness')return Response.json({ok:true,value:await stub.readinessForTest(input.confirmed)});
        if(input.method==='compact')return Response.json({ok:true,value:await stub.compactForTest(input.scope)});
        if(input.method==='dispatch')return Response.json({ok:true,value:await stub.dispatchForTest(input.scope,input.turnId)});
        if(input.method==='events')return Response.json({ok:true,value:await stub.replayTurnEvents({scope:input.scope,afterSequence:0,limit:200})});
        return new Response(null,{status:404});
      }catch(error){return Response.json({ok:false,error:error.message});}
    }};`;

  const bundle = await build({ stdin: { contents: entry, sourcefile: 'workspace-turn-test.ts', resolveDir: process.cwd() }, bundle: true,
    write: false, format: 'esm', platform: 'neutral', target: 'es2024', external: ['cloudflare:workers'], logLevel: 'silent' });
  const workerName = 'm2-workspace-turn-local';
  const classes = {
    WORKSPACE_AGENT: 'WorkspaceAgent', TENANT_QUOTA: 'TenantQuota', PROJECT_RUNTIME: 'WorkspaceReceiptFixture', PRODUCT_TURN_RUNTIME: 'ProductTurnReceiptFixture', REVISION_STORE:'RevisionStoreFixture',
    TOOL_ARTIFACT_STORE:'ToolArtifactStore',
  };
  const options = {
    host: '127.0.0.1', port: 0, inspectorPort: 0, cf: {}, resourcePersistencePath: directory, telemetry: { enabled: false }, logRequests: false,
    workers: [{ config: { type: 'worker', name: workerName, compatibilityDate: '2026-09-06',
      manifest: { mainModule: 'workspace-turn.mjs', modules: { 'workspace-turn.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { CATALOG: { type: 'd1', id: 'turn-catalog', name: 'turn-catalog' }, M2_TURNS_ENABLED: { type: 'text', value: 'true' },
        WORKSPACE_CHECKPOINTS: { type: 'r2', name: 'turn-checkpoints' },
        TENANT_QUOTA_CAPACITY: { type: 'text', value: '1' }, TENANT_QUOTA_POLICY_VERSION: { type: 'text', value: 'm2-test' },
        ...Object.fromEntries(Object.entries(classes).map(([binding, exportName]) => [binding, { type: 'durable-object', worker: workerName, exportName }])) },
      exports: Object.fromEntries(Object.values(classes).map(name => [name, { type: 'durable-object', storage: 'sqlite' }])),
    }, dev: { unsafeRegisterWorker: false, outboundService: { type: 'fetcher', handler: () => new Response('outbound-disabled', { status: 403 }) } } }],
  };

  let mf;
  async function rpc(method, input = {}) {
    const response = await mf.dispatchFetch('http://workspace-turn.test/_turn-test', { method: 'POST', body: JSON.stringify({ method, ...input }) });
    assert.equal(response.status, 200); const result = await response.json(); if (!result.ok) throw Error(result.error); return result.value;
  }
  async function until(operation, predicate, ms = 15_000) {
    const end = Date.now() + ms; let last;
    while (Date.now() < end) { last = await operation(); if (predicate(last)) return last; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error(`workerd-turn-observation-deadline:${JSON.stringify(last)}`);
  }

  try {
    mf = new Miniflare(options); await mf.ready; const db = await mf.getD1Database('CATALOG', workerName);
    for (const path of ['0001_catalog.sql', '0003_provisioning.sql', '0004_operator_invitations.sql', '0005_initial_operator.sql', '0006_model_catalog.sql','0007_model_content_checks.sql']) {
      const sql = (await readFile(`services/catalog/migrations/${path}`, 'utf8')).replace(/--[^\n]*/g, '');
      const statements = sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? [];
      for (const statement of statements) if (statement.trim()) await db.prepare(statement).run();
    }
    await db.prepare('CREATE TABLE fixture_turn_calls(turn_id TEXT PRIMARY KEY, accept_count INTEGER NOT NULL DEFAULT 0, observe_count INTEGER NOT NULL DEFAULT 0, cancel_count INTEGER NOT NULL DEFAULT 0)').run();
    const now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES('alpha','test-only','alpha','alpha@example.test',?,?)").bind(now, now),
      db.prepare("INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',?,?)").bind(now, now),
      db.prepare("INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES('tenant-alpha','alpha',?,?)").bind(now, now),
    ]);

    const { task } = await rpc('create'); await rpc('accept', { task });
    const readyWorkspace=await until(() => rpc('report', { task }), value => value.projectionConfirmed && value.projection?.outcome === 'ready');
    const scope = { tenantId: task.tenantId, projectId: task.projectId, workspaceId: task.workspaceId, workspaceGeneration: task.generation };
    const actor = { userId: 'alpha', authVersion: 1 };
    const initialFiles=await rpc('files',{task,scope});
    assert.equal(initialFiles.revision,null);
    assert.deepEqual(initialFiles.files.map(file=>file.path),['README.md','app','docs','experiments','model','results']);
    const initialPlan=await rpc('previewPlan',{task,scope});assert.equal(initialPlan.source.kind,'initial-workspace');assert.deepEqual(initialPlan.source.reference.scope,scope);assert.equal(Object.hasOwn(initialPlan.source,'identity'),false);
    await assert.rejects(rpc('previewPlan',{task,scope:{...scope,projectId:'other-project'}}),/scope-denied/);
    const { session } = await rpc('createSession', { task, scope, actor, key: 'session-key', title: 'First session' });
    const initialBucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',workerName),initialKey=checkpointKey(readyWorkspace.identity);
    const initialText=await (await initialBucket.get(initialKey)).text();await initialBucket.delete(initialKey);
    await assert.rejects(rpc('previewPlan',{task,scope}),/checkpoint-missing/);
    const unavailable=await rpc('submitTurn',{task,scope,actor,sessionId:session.id,key:'missing-initial-turn',message:'Missing initial source'});
    const failedView=await until(()=>rpc('snapshot',{task,scope}),value=>value.turns[unavailable.turn.id]?.status==='failed');
    assert.equal(failedView.turns[unavailable.turn.id].errorCode,'turn-initial-base-unavailable');
    assert.equal(failedView.turns[unavailable.turn.id].checkpoint,null);
    assert.equal(await rpc('calls',{turnId:unavailable.turn.id}),null,'missing initial source must never dispatch a runtime');
    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    const failedReplay=await rpc('submitTurn',{task,scope,actor,sessionId:session.id,key:'missing-initial-turn',message:'Missing initial source'});
    assert.equal(failedReplay.replayed,true);assert.equal(failedReplay.turn.status,'failed');
    await (await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',workerName)).put(initialKey,initialText);
    const first = await rpc('submitTurn', { task, scope, actor, sessionId: session.id, key: 'turn-key', message: 'Build a queue model' });
    const replay = await rpc('submitTurn', { task, scope, actor, sessionId: session.id, key: 'turn-key', message: 'Build a queue model' });
    assert.equal(first.turn.id, replay.turn.id); assert.equal(replay.replayed, true);

    const snapshot = await until(() => rpc('snapshot', { task, scope }), value => value.turns[first.turn.id]?.status === 'completed');
    assert.equal(snapshot.activeTurnId, null); assert.equal(snapshot.turns[first.turn.id].persistenceOutcome, 'saved');
    const events = await rpc('events', { task, scope });
    assert.deepEqual(events.events.filter(event=>event.turnId===first.turn.id).map(event => event.type), ['turn.queued', 'turn.started', 'assistant.message', 'tool.completed', 'turn.checkpointing', 'turn.completed']);
    const toolEvent=events.events.find(event=>event.type==='tool.completed'),artifactId=toolEvent.payload.artifact.artifactId;
    const artifact=await rpc('artifact',{task,scope,artifactId});assert.equal(artifact.receipt.artifactId,artifactId);assert.equal(JSON.parse(artifact.content).entries[0].length,17000);
    const artifactReferences=await rpc('artifactReferences',{scope,artifactId});assert.deepEqual(artifactReferences.map(item=>[item.kind,item.referenceId,item.releasedAt]),[['tool_effect','effect-'+first.turn.id,null],['turn_event','tool-'+first.turn.id,null]]);
    await assert.rejects(rpc('artifact',{task,actorName:workspaceAgentName(scope.tenantId,scope.workspaceId),scope:{...scope,tenantId:'tenant-other'},artifactId}),/workspace-actor-scope-denied/);
    assert.deepEqual(await rpc('calls', { turnId: first.turn.id }), { turn_id: first.turn.id, accept_count: 1, observe_count: 0, cancel_count: 0 });
    const savedPlan=await rpc('previewPlan',{task,scope});assert.equal(savedPlan.source.kind,'saved-turn');assert.equal(savedPlan.source.identity.turnId,first.turn.id);assert.deepEqual(savedPlan.source.revision,snapshot.turns[first.turn.id].checkpoint);
    const files=await rpc('files',{task,scope});assert.deepEqual(files,{schemaVersion:1,revision:{revisionId:'revision-'+first.turn.id,filesSha256:'b'.repeat(64),committedAt:snapshot.turns[first.turn.id].checkpoint.committedAt},files:[{path:'model/'+first.turn.id+'.py',type:'file',size:17,mode:420}]});
    const diff=await rpc('diff',{task,scope});assert.deepEqual(diff,{schemaVersion:1,revision:files.revision,summary:{added:1,modified:0,deleted:0},changes:[{path:'model/'+first.turn.id+'.py',change:'added',type:'file',size:17,mode:420}]});

    const eventReference={schemaVersion:1,scope,artifactId,turnId:first.turn.id,dispatchId:await rpc('dispatch',{task,scope,turnId:first.turn.id}),kind:'turn_event',referenceId:toolEvent.eventId};
    assert.deepEqual(await rpc('retireArtifact',{task,scope,reference:eventReference}),{released:false,reason:'event-retained'});
    await rpc('compact',{task,scope});
    await assert.rejects(rpc('retireArtifact',{task,scope,reference:{...eventReference,scope:{...scope,tenantId:'other-tenant'}}}),/workspace-actor-scope-denied/);
    await rpc('readiness',{task,scope,confirmed:false});
    await assert.rejects(rpc('artifact',{task,scope,artifactId}),/workspace-not-ready/);
    await assert.rejects(rpc('previewPlan',{task,scope}),/workspace-not-ready/);
    const nextSweep=await rpc('sweepArtifacts',{task,scope});assert.ok(nextSweep>Date.now(),'independent ArtifactStore alarm remains armed');
    const sweptRefs=await rpc('artifactReferences',{scope,artifactId});assert.equal(typeof sweptRefs.find(r=>r.kind==='turn_event').releasedAt,'number','alarm must release event without manual retirement');
    const retired=await rpc('retireArtifact',{task,scope,reference:eventReference});assert.equal(retired.released,true);assert.equal(typeof retired.receipt.releasedAt,'number');
    assert.deepEqual(await rpc('retireArtifact',{task,scope,reference:eventReference}),retired);
    const afterRetirement=await rpc('artifactReferences',{scope,artifactId});
    assert.deepEqual(afterRetirement.filter(item=>item.releasedAt===null).map(item=>item.kind),['tool_effect']);
    await rpc('readiness',{task,scope,confirmed:true});
    assert.deepEqual(await rpc('artifact',{task,scope,artifactId}),artifact,'event retirement must preserve artifact bytes');

    await mf.dispose();mf=new Miniflare(options);await mf.ready;
    assert.deepEqual(await rpc('retireArtifact',{task,scope,reference:eventReference}),retired,'retirement acknowledgement survives Workerd restart');
    assert.deepEqual(await rpc('artifact',{task,scope,artifactId}),artifact);

    const dropped = await rpc('submitTurn', { task, scope, actor, sessionId: session.id, key: 'drop-accept-key', message: 'drop-accept' });
    await until(() => rpc('snapshot', { task, scope }), value => value.turns[dropped.turn.id]?.status === 'running');
    await rpc('runAlarm', { task, scope });
    assert.equal((await rpc('calls', { turnId: dropped.turn.id })).observe_count,1,'manual retry must observe the persisted terminal receipt');
    const recovered = await until(() => rpc('snapshot', { task, scope }), value => value.turns[dropped.turn.id]?.status === 'completed', 20_000);
    assert.equal(recovered.turns[dropped.turn.id].persistenceOutcome, 'saved');
    assert.deepEqual(await rpc('calls', { turnId: dropped.turn.id }), { turn_id: dropped.turn.id, accept_count: 1, observe_count: 1, cancel_count: 0 });

    const running = await rpc('submitTurn', { task, scope, actor, sessionId: session.id, key: 'running-cancel-key', message: 'running-cancel' });
    await until(() => rpc('snapshot', { task, scope }), value => value.turns[running.turn.id]?.status === 'running', 10_000);
    await assert.rejects(rpc('cancelTurn', { task, scope, actor, turnId: running.turn.id }), /fixture-dropped-cancel-response/);
    await rpc('runAlarm', { task, scope });
    const cancelled = await until(() => rpc('snapshot', { task, scope }), value => value.turns[running.turn.id]?.status === 'cancelled', 20_000);
    assert.equal(cancelled.turns[running.turn.id].persistenceOutcome, 'saved');
    assert.deepEqual(await rpc('calls', { turnId: running.turn.id }), { turn_id: running.turn.id, accept_count: 1, observe_count: 1, cancel_count: 1 });
    assert.equal((await rpc('cancelTurn', { task, scope, actor, turnId: running.turn.id })).status, 'cancelled');
    assert.deepEqual(await rpc('calls', { turnId: running.turn.id }), { turn_id: running.turn.id, accept_count: 1, observe_count: 1, cancel_count: 1 });
    await assert.rejects(rpc('snapshot', { task, scope: { ...scope, workspaceGeneration: 3 } }), /workspace-actor-scope-denied/);
    assert.equal((await mf.dispatchFetch('http://workspace-turn.test/')).status, 404);
  } finally {
    try { await mf?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
