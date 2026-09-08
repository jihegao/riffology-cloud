import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const encoder=new TextEncoder();
async function digest(value){const bytes=typeof value==='string'?encoder.encode(value):value,hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

test('RevisionStore is the sole workerd RPC authority for immutable R2 revisions', {timeout:30_000}, async()=>{
  const entry=`
    import {RevisionStore as BaseRevisionStore} from './services/turn-runtime/revision-store.ts';
    import {initialWorkspaceReferenceFromReady,InitialWorkspaceResolver} from './services/turn-runtime/initial-workspace.ts';
    import {initialCheckpoint} from './services/runtime/starter.ts';
    import {initialWorkspaceArchive} from './services/turn-runtime/initial-workspace-archive.ts';
    import {checkpointKey} from './services/runtime/core.ts';
    import {canonicalWorkspaceMarker,workspaceDigest} from './services/workspace/protocol.ts';
    export class RevisionStore extends BaseRevisionStore {
      constructor(ctx,env){
        let lost=false;const bucket=new Proxy(env.WORKSPACE_CHECKPOINTS,{get(target,property){
          if(property==='delete')return async key=>{await target.delete(key);if(!lost&&String(key).endsWith('${'d'.repeat(64)}')){lost=true;throw Error('injected-delete-ack-loss')}};
          const value=target[property];return typeof value==='function'?value.bind(target):value;
        }});super(ctx,{REVISION_STORE:env.REVISION_STORE,WORKSPACE_CHECKPOINTS:bucket});
      }
    }
    export default {async fetch(request,env){
      if(request.method!=='POST')return new Response(null,{status:404});
      const body=await request.json(),actor=body.wrong?'wrong-store':'workspace-revisions-v1',stub=env.REVISION_STORE.getByName(actor);
      try{
        if(body.action==='seedInitial'){
          const scope=body.identity.scope,task={id:'initial-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:scope.workspaceGeneration,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000},runtime={taskId:task.id,tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,generation:task.generation,runtimeId:'initial-runtime',leaseId:'initial-lease'},markerNonce='initial-nonce';
          const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce});await env.WORKSPACE_CHECKPOINTS.put(checkpointKey(runtime),checkpoint.text);
          const ready={receiptId:'receipt-initial',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision};
          const reference=await initialWorkspaceReferenceFromReady({scope,task,runtime,markerNonce,ready}),resolved=await stub.resolveInitial(reference,scope);
          return Response.json({ok:true,value:{reference,filesSha256:resolved.filesSha256},key:checkpointKey(runtime)});
        }
        if(body.action==='resolveInitial')return Response.json({ok:true,value:await stub.resolveInitial(body.initial.reference,body.identity.scope)});
        if(body.action==='diff')return Response.json({ok:true,value:await stub.diff(body.identity,body.receipt)});
        if(body.action==='initialCommit'){
          const resolved=await stub.resolveInitial(body.initial.reference,body.identity.scope),snapshot={identity:body.identity,filesArchive:body.modified?initialWorkspaceArchive({'README.md':new TextEncoder().encode('Updated README'),'model/main.py':new TextEncoder().encode('print(1)')}):resolved.filesArchive,piSession:new TextEncoder().encode('session')};
          return Response.json({ok:true,value:await stub.commit({identity:body.identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null,initial:body.initial},snapshot})});
        }
        if(body.action==='previewPlan')return Response.json({ok:true,value:await stub.previewPlan(body.identity,body.receipt)});
        if(body.action==='serviceFiles')return Response.json({ok:true,value:Array.from(await stub.serviceFiles(body.identity,body.receipt))});
        if(body.action==='previewCommit'){
          const encode=value=>new TextEncoder().encode(value);
          const filesArchive=initialWorkspaceArchive({'app/preview.json':encode(JSON.stringify({schemaVersion:1,runtime:'python',entrypoint:'app/preview.py',dependencyLock:'app/requirements.lock',port:8080,healthPath:'/healthz'})),'app/preview.py':encode('print(1)'),'app/requirements.lock':encode('# stdlib')});
          return Response.json({ok:true,value:await stub.commit({identity:body.identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null},snapshot:{identity:body.identity,filesArchive,piSession:encode('private-session')}})});
        }
        if(body.action==='observe')return Response.json({ok:true,value:await stub.observe(body.identity)});
        if(body.action==='reconcile')return Response.json({ok:true,value:await stub.reconcileCommit({identity:body.identity,operationId:body.operationId,inputSha256:body.inputSha256})});
        if(body.action==='gc')return Response.json({ok:true,value:await stub.gc({operationId:body.operationId,now:body.now,minAgeMs:body.minAgeMs,pageSize:body.pageSize,maxObjects:body.maxObjects})});
        if(body.action==='reconcileGc')return Response.json({ok:true,value:await stub.reconcileGc({operationId:body.operationId,inputSha256:body.inputSha256})});
        const snapshot={identity:body.identity,filesArchive:new TextEncoder().encode(body.files),piSession:new TextEncoder().encode(body.session)};
        return Response.json({ok:true,value:await stub.commit({identity:body.identity,outcome:body.outcome,executionErrorCode:body.error,base:{workspace:null,session:null},snapshot})});
      }catch(error){return Response.json({ok:false,error:error.message});}
    }};`;
  const bundle=await build({stdin:{contents:entry,sourcefile:'revision-store-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
  const worker='revision-store-local',mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'revision-store-test'}},exports:{RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
  const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
  const call=async body=>{const response=await mf.dispatchFetch('http://revision.test/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
  try{
    assert.deepEqual(await call({action:'commit',wrong:true,identity,outcome:'completed',error:null,files:'files',session:'session'}),{ok:false,error:'revision-store-actor-scope-denied'});
    const saved=await call({action:'commit',identity,outcome:'completed',error:null,files:'files',session:'session'});assert.equal(saved.ok,true);assert.equal(saved.value.objectKey,'turns/tenant-a/project-a/workspace-a/1/session-a/turn-a/dispatch-a.json');
    assert.deepEqual(await call({action:'observe',identity}),saved);
    const operationId='commit:tenant-a:project-a:workspace-a:1:session-a:turn-a:dispatch-a',inputSha256=await digest(JSON.stringify({identity,outcome:'completed',executionErrorCode:null,base:{workspace:null,session:null},filesSha256:await digest('files'),filesBytes:5,sessionSha256:await digest('session'),sessionBytes:7}));
    assert.deepEqual(await call({action:'reconcile',identity,operationId,inputSha256}),saved);
    const wrongDigest=await call({action:'reconcile',identity,operationId,inputSha256:'0'.repeat(64)});assert.equal(wrongDigest.ok,false);assert.match(wrongDigest.error,/reconcile-conflict/);
    const missingIdentity={...identity,turnId:'turn-missing',dispatchId:'dispatch-missing'},missing=await call({action:'reconcile',identity:missingIdentity,operationId:'commit:tenant-a:project-a:workspace-a:1:session-a:turn-missing:dispatch-missing',inputSha256:'1'.repeat(64)});assert.deepEqual(missing,{ok:true,value:null});
    const conflict=await call({action:'commit',identity,outcome:'failed',error:'provider-failed',files:'files',session:'session'});assert.equal(conflict.ok,false);assert.match(conflict.error,/turn-revision-conflict/);
    const bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker);assert.ok(await bucket.get(saved.value.objectKey));
    const orphanKey='turn-blobs/files/'+'c'.repeat(64);await bucket.put(orphanKey,new TextEncoder().encode('orphan'));
    const gcOptions={operationId:'gc-a',now:Date.now()+1000,minAgeMs:1,pageSize:1,maxObjects:100};
    const gc=await call({action:'gc',...gcOptions});assert.deepEqual(gc.value,{scannedManifests:1,scannedBlobs:3,deletedBlobs:1,retainedBlobs:2});assert.equal(await bucket.get(orphanKey),null);
    assert.deepEqual(await call({action:'observe',identity}),saved);
    const gcDigest=await digest(JSON.stringify({now:gcOptions.now,minAgeMs:gcOptions.minAgeMs,pageSize:1,maxObjects:100}));
    assert.deepEqual(await call({action:'reconcileGc',operationId:'gc-a',inputSha256:gcDigest}),gc);
    const gcConflict=await call({action:'reconcileGc',operationId:'gc-a',inputSha256:'0'.repeat(64)});assert.equal(gcConflict.ok,false);assert.match(gcConflict.error,/gc-reconcile-conflict/);
    const lostAckKey='turn-blobs/files/'+'d'.repeat(64);await bucket.put(lostAckKey,new TextEncoder().encode('lost-ack-orphan'));
    const lostAckOptions={operationId:'gc-lost-ack',now:Date.now()+2000,minAgeMs:1,pageSize:1,maxObjects:100};
    const lostAck=await call({action:'gc',...lostAckOptions});assert.equal(lostAck.ok,false);assert.equal(lostAck.error,'injected-delete-ack-loss');assert.equal(await bucket.get(lostAckKey),null,'the external delete applied before its acknowledgement was lost');
    const lostAckDigest=await digest(JSON.stringify({now:lostAckOptions.now,minAgeMs:lostAckOptions.minAgeMs,pageSize:1,maxObjects:100}));
    const reconciled=await call({action:'reconcileGc',operationId:'gc-lost-ack',inputSha256:lostAckDigest});assert.deepEqual(reconciled.value,{scannedManifests:1,scannedBlobs:3,deletedBlobs:1,retainedBlobs:2});
    assert.deepEqual(await call({action:'reconcileGc',operationId:'gc-lost-ack',inputSha256:lostAckDigest}),reconciled);
    assert.deepEqual(await call({action:'observe',identity}),saved);
    const initialIdentity={...identity,turnId:'initial-turn',dispatchId:'initial-dispatch'},seed=await call({action:'seedInitial',identity:initialIdentity});assert.equal(seed.ok,true);
    assert.deepEqual(await call({action:'resolveInitial',wrong:true,identity:initialIdentity,initial:seed.value}),{ok:false,error:'revision-store-actor-scope-denied'});
    const cross=await call({action:'resolveInitial',identity:{...initialIdentity,scope:{...identity.scope,tenantId:'tenant-b'}},initial:seed.value});assert.equal(cross.ok,false);assert.match(cross.error,/scope-denied/);
    const first=await call({action:'initialCommit',identity:initialIdentity,initial:seed.value});assert.equal(first.ok,true);
    const diff=await call({action:'diff',identity:initialIdentity,receipt:first.value});assert.equal(diff.ok,true);assert.deepEqual(diff.value.summary,{added:0,modified:0,deleted:0});
    const modifiedIdentity={...initialIdentity,turnId:'modified-initial',dispatchId:'modified-initial-dispatch'},modified=await call({action:'initialCommit',identity:modifiedIdentity,initial:seed.value,modified:true});assert.equal(modified.ok,true);
    const changes=await call({action:'diff',identity:modifiedIdentity,receipt:modified.value});assert.equal(changes.ok,true);assert.deepEqual(changes.value.summary,{added:1,modified:1,deleted:0});
    await bucket.delete(seed.key);
    const unavailable=await call({action:'diff',identity:initialIdentity,receipt:first.value});assert.equal(unavailable.ok,false);assert.match(unavailable.error,/checkpoint-missing/);
    const previewIdentity={...identity,turnId:'preview-turn',dispatchId:'preview-dispatch'};
    const previewSaved=await call({action:'previewCommit',identity:previewIdentity});assert.equal(previewSaved.ok,true);
    const plan=await call({action:'previewPlan',identity:previewIdentity,receipt:previewSaved.value});assert.equal(plan.ok,true);
    assert.equal(plan.value.kind,'service');assert.deepEqual(plan.value.revision,previewSaved.value);
    assert.equal(plan.value.entrypointSha256,await digest('print(1)'));assert.equal(plan.value.dependencyLockSha256,await digest('# stdlib'));
    assert.equal(JSON.stringify(plan).includes('private-session'),false);
    assert.deepEqual(await call({action:'previewPlan',wrong:true,identity:previewIdentity,receipt:previewSaved.value}),{ok:false,error:'revision-store-actor-scope-denied'});
    const crossPreview=await call({action:'previewPlan',identity:{...previewIdentity,scope:{...identity.scope,tenantId:'tenant-b'}},receipt:previewSaved.value});assert.equal(crossPreview.ok,false);assert.match(crossPreview.error,/scope-denied/);
    const invalidPreview=await call({action:'previewPlan',identity,receipt:saved.value});assert.equal(invalidPreview.ok,false);
    await bucket.delete('turn-blobs/sessions/'+await digest('private-session'));
    const serviceFiles=await call({action:'serviceFiles',identity:previewIdentity,receipt:previewSaved.value});assert.equal(serviceFiles.ok,true,'service restore must not depend on the private Pi session blob');
    const serviceArchive=Uint8Array.from(serviceFiles.value);assert.equal(await digest(serviceArchive),previewSaved.value.filesSha256);
    assert.equal(new TextDecoder().decode(serviceArchive.slice(257,262)),'ustar');
    assert.equal(new TextDecoder().decode(serviceArchive).includes('private-session'),false);
    assert.deepEqual(await call({action:'serviceFiles',wrong:true,identity:previewIdentity,receipt:previewSaved.value}),{ok:false,error:'revision-store-actor-scope-denied'});
    const crossService=await call({action:'serviceFiles',identity:{...previewIdentity,scope:{...identity.scope,tenantId:'tenant-b'}},receipt:previewSaved.value});assert.equal(crossService.ok,false);assert.match(crossService.error,/scope-denied/);
    await bucket.put('turn-blobs/files/'+previewSaved.value.filesSha256,encoder.encode('corrupt archive'));
    const corruptService=await call({action:'serviceFiles',identity:previewIdentity,receipt:previewSaved.value});assert.equal(corruptService.ok,false);
    assert.equal((await mf.dispatchFetch('http://revision.test/')).status,404);
  }finally{await mf.dispose();}
});
