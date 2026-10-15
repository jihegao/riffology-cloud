import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { toolArtifactDescriptor } from '../../services/artifacts/protocol.ts';

test('ToolArtifactStore fences immutable large results and reconciles a lost R2 acknowledgement',{timeout:20_000},async()=>{
  const entry=`
    import {ToolArtifactStore as Base} from './services/artifacts/durable.ts';
    export class ToolArtifactStore extends Base{
      constructor(ctx,env){let lost=false;const bucket=new Proxy(env.WORKSPACE_CHECKPOINTS,{get(target,property){if(property==='put')return async(key,value,options)=>{if(String(key).includes('/effect-missing/'))throw Error('injected-artifact-put-before-write');const result=await target.put(key,value,options);if(!lost&&String(key).includes('/effect-lost/')){lost=true;throw Error('injected-artifact-put-ack-loss')}return result};const found=target[property];return typeof found==='function'?found.bind(target):found;}});super(ctx,{...env,WORKSPACE_CHECKPOINTS:bucket});}
    }
    export default {async fetch(request,env){if(request.method!=='POST')return new Response(null,{status:404});const body=await request.json(),stub=env.TOOL_ARTIFACT_STORE.getByName(body.wrong?'wrong-artifacts':'tool-artifacts-v1');try{const content=new TextEncoder().encode(body.content??'');if(body.action==='materialize')return Response.json({ok:true,value:await stub.materialize({identity:body.identity,mediaType:'application/json',content})});if(body.action==='reconcile')return Response.json({ok:true,value:await stub.reconcile(body.identity,body.intent)});if(body.action==='projectList')return Response.json({ok:true,value:await stub.projectList(body.scope,body.cursor??null)});if(body.action==='projectRead'){const value=await stub.projectRead(body.scope,body.artifactId);return Response.json({ok:true,value:{receipt:value.receipt,content:new TextDecoder().decode(value.content)}});}if(body.action==='read'){const value=await stub.read(body.scope,body.artifactId);return Response.json({ok:true,value:{receipt:value.receipt,content:new TextDecoder().decode(value.content)}});}if(body.action==='retain')return Response.json({ok:true,value:await stub.retain(body.reference)});if(body.action==='release')return Response.json({ok:true,value:await stub.release(body.reference)});if(body.action==='references')return Response.json({ok:true,value:await stub.references(body.scope,body.artifactId)});return new Response(null,{status:404});}catch(error){return Response.json({ok:false,error:error.message});}}};`;
  const bundle=await build({stdin:{contents:entry,sourcefile:'artifact-store-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
  const worker='tool-artifact-local',mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{TOOL_ARTIFACT_STORE:{type:'durable-object',worker,exportName:'ToolArtifactStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'tool-artifact-test'}},exports:{ToolArtifactStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
  const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
  const identity=(effectId='effect-a')=>({scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:`command-${effectId}`,effectId,operation:'read'});
  const call=async body=>{const response=await mf.dispatchFetch('http://artifact.test/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
  const content=JSON.stringify({kind:'read',path:'model/large.txt',content:'x'.repeat(20_000)});
  try{
    assert.deepEqual(await call({action:'materialize',wrong:true,identity:identity(),content}),{ok:false,error:'tool-artifact-store-actor-scope-denied'});
    assert.deepEqual(await call({action:'materialize',identity:identity('effect-small'),content:'{}'}),{ok:false,error:'invalid-tool-artifact-content'});
    assert.deepEqual(await call({action:'materialize',identity:identity('effect-invalid'),content:'x'.repeat(20_000)}),{ok:false,error:'invalid-tool-artifact-content'});
    const saved=await call({action:'materialize',identity:identity(),content});assert.equal(saved.ok,true);assert.equal(saved.value.receipt.bytes,new TextEncoder().encode(content).byteLength);assert.equal(saved.value.receipt.objectKey,undefined);assert.match(saved.value.receipt.artifactId,/^artifact-[a-f0-9]{60}$/);
    const artifactId=saved.value.receipt.artifactId,effectReference={schemaVersion:1,scope,artifactId,turnId:'turn-a',dispatchId:'dispatch-a',kind:'tool_effect',referenceId:'effect-a'},eventReference={...effectReference,kind:'turn_event',referenceId:'event-a'};
    assert.equal((await call({action:'projectList',scope})).value.items.length,0);
    assert.deepEqual(await call({action:'projectRead',scope,artifactId}),{ok:false,error:'tool-artifact-not-found'});
    const bornReferenced=await call({action:'references',scope,artifactId});assert.equal(bornReferenced.ok,true);assert.deepEqual(bornReferenced.value.map(({kind,referenceId,releasedAt})=>({kind,referenceId,releasedAt})),[{kind:'tool_effect',referenceId:'effect-a',releasedAt:null}]);
    const retained=await call({action:'retain',reference:eventReference});assert.equal(retained.ok,true);assert.equal(retained.value.kind,'turn_event');assert.equal(retained.value.releasedAt,null);assert.deepEqual(await call({action:'retain',reference:eventReference}),retained);
    assert.deepEqual(await call({action:'retain',reference:{...eventReference,scope:{...scope,tenantId:'tenant-b'}}}),{ok:false,error:'tool-artifact-not-found'});
    assert.deepEqual(await call({action:'retain',reference:{...eventReference,turnId:'turn-b'}}),{ok:false,error:'tool-artifact-reference-scope-denied'});
    const visible=await call({action:'projectList',scope});assert.deepEqual(visible.value.items,[saved.value.receipt]);assert.equal(visible.value.nextCursor,null);
    assert.equal((await call({action:'projectRead',scope,artifactId})).value.content,content);
    for(const changed of [{tenantId:'other'},{projectId:'other'},{workspaceId:'other'},{workspaceGeneration:2}]){
      assert.equal((await call({action:'projectList',scope:{...scope,...changed}})).value.items.length,0);
      assert.deepEqual(await call({action:'projectRead',scope:{...scope,...changed},artifactId}),{ok:false,error:'tool-artifact-not-found'});
    }
    const released=await call({action:'release',reference:eventReference});assert.equal(released.ok,true);assert.equal(typeof released.value.releasedAt,'number');assert.deepEqual(await call({action:'release',reference:eventReference}),released);
    assert.deepEqual(await call({action:'retain',reference:eventReference}),{ok:false,error:'tool-artifact-reference-released'});
    assert.equal((await call({action:'projectList',scope})).value.items.length,0);
    assert.notEqual((await call({action:'projectList',scope})).value.version,visible.value.version);
    assert.deepEqual(await call({action:'projectRead',scope,artifactId}),{ok:false,error:'tool-artifact-not-found'});
    const references=await call({action:'references',scope,artifactId});assert.equal(references.ok,true);assert.equal(references.value.length,2);assert.equal(references.value.filter(item=>item.releasedAt===null).length,1);
    assert.deepEqual(await call({action:'materialize',identity:identity(),content}),saved);
    const conflict=await call({action:'materialize',identity:identity(),content:JSON.stringify({kind:'read',path:'model/large.txt',content:'y'.repeat(20_000)})});assert.equal(conflict.ok,false);assert.equal(conflict.error,'tool-artifact-conflict');
    const read=await call({action:'read',scope,artifactId:saved.value.receipt.artifactId});assert.equal(read.ok,true);assert.equal(read.value.content,content);
    const denied=await call({action:'read',scope:{...scope,tenantId:'tenant-b'},artifactId:saved.value.receipt.artifactId});assert.deepEqual(denied,{ok:false,error:'tool-artifact-not-found'});
    const lostIdentity=identity('effect-lost'),lostInput={identity:lostIdentity,mediaType:'application/json',content:new TextEncoder().encode(content)},descriptor=await toolArtifactDescriptor(lostInput);
    const lost=await call({action:'materialize',identity:lostIdentity,content});assert.deepEqual(lost,{ok:false,error:'injected-artifact-put-ack-loss'});
    assert.deepEqual(await call({action:'materialize',identity:lostIdentity,content}),{ok:false,error:'tool-artifact-operation-unknown'});
    const reconciled=await call({action:'reconcile',identity:lostIdentity,intent:{operationId:descriptor.operationId,inputSha256:descriptor.inputSha256}});assert.equal(reconciled.ok,true);assert.equal(reconciled.value.artifactId,descriptor.artifactId);
    const missingIdentity=identity('effect-missing'),missingInput={identity:missingIdentity,mediaType:'application/json',content:new TextEncoder().encode(content)},missingDescriptor=await toolArtifactDescriptor(missingInput);
    assert.deepEqual(await call({action:'materialize',identity:missingIdentity,content}),{ok:false,error:'injected-artifact-put-before-write'});
    assert.deepEqual(await call({action:'materialize',identity:missingIdentity,content}),{ok:false,error:'tool-artifact-operation-unknown'});
    assert.deepEqual(await call({action:'reconcile',identity:missingIdentity,intent:{operationId:missingDescriptor.operationId,inputSha256:missingDescriptor.inputSha256}}),{ok:true,value:null});
    const bucket=await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker),listed=await bucket.list({prefix:'tool-artifacts/'});assert.equal(listed.objects.length,2);
    const ids=[];
    for(let n=0;n<34;n++){
      const item=await call({action:'materialize',identity:identity('page-'+n),content});assert.equal(item.ok,true);ids.push(item.value.receipt.artifactId);
      assert.equal((await call({action:'retain',reference:{...eventReference,artifactId:ids.at(-1),referenceId:'event-'+n}})).ok,true);
    }
    const first=(await call({action:'projectList',scope})).value;assert.equal(first.items.length,32);assert.ok(first.nextCursor);
    const second=(await call({action:'projectList',scope,cursor:first.nextCursor})).value;assert.equal(second.items.length,2);assert.equal(second.nextCursor,null);
    assert.equal(new Set([...first.items,...second.items].map(i=>i.artifactId)).size,34);
    assert.deepEqual(await call({action:'projectList',scope:{...scope,projectId:'other'},cursor:first.nextCursor}),{ok:false,error:'project-artifact-cursor-stale'});
    await call({action:'release',reference:{...eventReference,artifactId:ids[0],referenceId:'event-0'}});
    assert.deepEqual(await call({action:'projectList',scope,cursor:first.nextCursor}),{ok:false,error:'project-artifact-cursor-stale'});
    const corruptIdentity=identity('page-1'),corrupt=await toolArtifactDescriptor({identity:corruptIdentity,mediaType:'application/json',content:new TextEncoder().encode(content)});
    await bucket.put(corrupt.objectKey,'tampered');assert.deepEqual(await call({action:'projectRead',scope,artifactId:ids[1]}),{ok:false,error:'tool-artifact-object-corrupt'});
    assert.equal((await mf.dispatchFetch('http://artifact.test/')).status,404);
  }finally{await mf.dispose();}
});

test('ToolArtifactStore backfills the immutable tool-effect reference for pre-reference rows',{timeout:20_000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tool-artifact-reference-migration-')),worker='tool-artifact-migration';
  const legacy=`
    import {DurableObject} from 'cloudflare:workers';
    import {toolArtifactDescriptor} from './services/artifacts/protocol.ts';
    export class ToolArtifactStore extends DurableObject{
      constructor(ctx,env){super(ctx,env);ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tool_artifacts (artifact_id TEXT PRIMARY KEY, identity_json TEXT NOT NULL UNIQUE, input_sha256 TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, media_type TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('reserved','unknown','completed'))) STRICT");}
      async seed(raw){const input={identity:raw.identity,mediaType:'application/json',content:new Uint8Array(raw.content)},d=await toolArtifactDescriptor(input),createdAt=1500;this.ctx.storage.sql.exec('INSERT INTO tool_artifacts VALUES(?,?,?,?,?,?,?,?,?)',d.artifactId,JSON.stringify(d.identity),d.inputSha256,d.objectKey,'application/json',d.descriptor.bytes,d.descriptor.sha256,createdAt,'completed');await this.env.WORKSPACE_CHECKPOINTS.put(d.objectKey,input.content);await this.ctx.storage.sync();return {artifactId:d.artifactId};}
    }
    export default {async fetch(request,env){const body=await request.json(),stub=env.TOOL_ARTIFACT_STORE.getByName('tool-artifacts-v1');return Response.json(await stub.seed(body));}};`;
  const current=`
    export {ToolArtifactStore} from './services/artifacts/durable.ts';
    export default {async fetch(request,env){const body=await request.json(),stub=env.TOOL_ARTIFACT_STORE.getByName('tool-artifacts-v1');try{if(body.action==='references')return Response.json({ok:true,value:await stub.references(body.scope,body.artifactId)});const value=await stub.materialize({identity:body.identity,mediaType:'application/json',content:new Uint8Array(body.content)});return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,error:error.message});}}};`;
  const bundle=async(contents)=>build({stdin:{contents,sourcefile:'artifact-migration-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
  const options=(code)=>({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{TOOL_ARTIFACT_STORE:{type:'durable-object',worker,exportName:'ToolArtifactStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'tool-artifact-migration'}},exports:{ToolArtifactStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
  const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},identity={scope,turnId:'turn-old',dispatchId:'dispatch-old',commandId:'command-old',effectId:'effect-old',operation:'read'},content=new TextEncoder().encode(JSON.stringify({kind:'read',content:'z'.repeat(20_000)})),body={identity,content:[...content]};
  let mf;
  try{
    const legacyBundle=await bundle(legacy);mf=new Miniflare(options(legacyBundle.outputFiles[0].text));const seeded=await (await mf.dispatchFetch('http://artifact.test/',{method:'POST',body:JSON.stringify(body)})).json();await mf.dispose();mf=undefined;
    const currentBundle=await bundle(current);mf=new Miniflare(options(currentBundle.outputFiles[0].text));const call=async payload=>(await (await mf.dispatchFetch('http://artifact.test/',{method:'POST',body:JSON.stringify(payload)})).json());
    const refs=await call({action:'references',scope,artifactId:seeded.artifactId});assert.equal(refs.ok,true);assert.deepEqual(refs.value.map(({kind,referenceId,releasedAt})=>({kind,referenceId,releasedAt})),[{kind:'tool_effect',referenceId:'effect-old',releasedAt:null}]);
    const replay=await call(body);assert.equal(replay.ok,true);assert.equal(replay.value.receipt.artifactId,seeded.artifactId);
  }finally{try{await mf?.dispose();}finally{await rm(directory,{recursive:true,force:true});}}
});
