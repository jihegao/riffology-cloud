import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {build} from 'esbuild';import {Miniflare} from 'miniflare';

test('ArtifactStore persists sweep upper bound across restart and defers new references to next sweep',{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'artifact-sweep-'));
  const source=`
    import {ToolArtifactStore as Base} from './services/artifacts/durable.ts';
    export class Store extends Base{
      constructor(ctx,env){super(ctx,{...env,WORKSPACE_AGENT:{getByName:()=>({artifactEventReleaseEligibility:async ref=>({eligible:Number(ref.referenceId.slice(6))>=50,reason:Number(ref.referenceId.slice(6))>=50?'event-retired':'event-retained'})})}});}
      async state(){return {cursor:await this.ctx.storage.get('retirement-cursor')??0,upper:await this.ctx.storage.get('retirement-upper')??null};}
      async sweep(){await this.alarm();await this.ctx.storage.setAlarm(Date.now()+3600000);return this.state();}
    }
    export default {async fetch(request,env){const b=await request.json(),s=env.TOOL_ARTIFACT_STORE.getByName('tool-artifacts-v1');try{let result;
      if(b.op==='materialize')result=await s.materialize({identity:b.identity,mediaType:'application/json',content:new TextEncoder().encode(JSON.stringify({content:'x'.repeat(20000)}))});
      if(b.op==='retain')result=await s.retain(b.reference);
      if(b.op==='refs')result=await s.references(b.scope,b.artifactId);
      if(b.op==='sweep')result=await s.sweep();
      if(b.op==='state')result=await s.state();
      return Response.json({result});}catch(e){return Response.json({error:e.message});}}};`;
  const bundle=await build({stdin:{contents:source,sourcefile:'sweep-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers'],logLevel:'silent'});
  const worker='artifact-sweep';const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{TOOL_ARTIFACT_STORE:{type:'durable-object',worker,exportName:'Store'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'sweep-bucket'}},exports:{Store:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]};
  let mf;const call=async body=>{const response=await mf.dispatchFetch('http://sweep.test/',{method:'POST',body:JSON.stringify(body)});const result=await response.json();assert.equal(result.error,undefined);return result.result;};
  const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
  const identity={scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',effectId:'effect-a',operation:'read'};
  try{
    mf=new Miniflare(options);const saved=await call({op:'materialize',identity}),artifactId=saved.receipt.artifactId;
    const retain=i=>call({op:'retain',reference:{schemaVersion:1,scope,artifactId,turnId:identity.turnId,dispatchId:identity.dispatchId,kind:'turn_event',referenceId:`event-${i}`}});
    for(let i=0;i<51;i++)await retain(i);
    const first=await call({op:'sweep'});assert.equal(first.cursor,51);assert.equal(first.upper,52);
    await retain(51);
    await mf.dispose();mf=new Miniflare(options);assert.deepEqual(await call({op:'state'}),first);
    assert.deepEqual(await call({op:'sweep'}),{cursor:0,upper:null});
    let refs=await call({op:'refs',scope,artifactId});assert.equal(typeof refs.find(r=>r.referenceId==='event-50').releasedAt,'number');assert.equal(refs.find(r=>r.referenceId==='event-51').releasedAt,null,'new reference lies beyond persisted sweep upper bound');
    await call({op:'sweep'});await call({op:'sweep'});
    refs=await call({op:'refs',scope,artifactId});assert.equal(typeof refs.find(r=>r.referenceId==='event-51').releasedAt,'number');assert.equal(refs.filter(r=>r.kind==='turn_event'&&r.releasedAt===null).length,50);assert.equal(refs.find(r=>r.kind==='tool_effect').releasedAt,null);
    assert.equal((await (await mf.getR2Bucket('WORKSPACE_CHECKPOINTS',worker)).list()).objects.length,1);
  }finally{try{await mf?.dispose();}finally{await rm(directory,{recursive:true,force:true});}}
});
