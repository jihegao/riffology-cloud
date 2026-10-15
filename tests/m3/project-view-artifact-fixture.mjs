import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {scope} from './project-views-fixture.mjs';
// Real local workerd SQLite + R2; no cloud credentials or outbound fetcher.
export async function artifactFixture(t){
 const entry=`export {ToolArtifactStore} from './services/artifacts/durable.ts';
 export default {async fetch(request,env){const b=await request.json(),s=env.TOOL_ARTIFACT_STORE.getByName('tool-artifacts-v1');try{
 if(b.op==='seed'){const identity={scope:b.scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-'+b.n,effectId:'effect-'+b.n,operation:'read'},saved=await s.materialize({identity,mediaType:'application/json',content:new TextEncoder().encode(JSON.stringify({message:b.text,body:'private local fixture '.repeat(2000)}))});const ref={schemaVersion:1,scope:b.scope,artifactId:saved.receipt.artifactId,turnId:'turn-a',dispatchId:'dispatch-a',kind:'turn_event',referenceId:'event-'+b.n};await s.retain(ref);return Response.json({receipt:saved.receipt,ref});}
 if(b.op==='release'){await s.release(b.ref);return Response.json({ok:true});}
 if(b.artifactId){const read=await s.projectRead(b.scope,b.artifactId),offset=b.offset??0,chunk=read.content.slice(offset,offset+16384);if(offset<0||offset>=read.content.length)throw Error('offset');let binary='';for(const n of chunk)binary+=String.fromCharCode(n);return Response.json({receipt:read.receipt,offset,base64:btoa(binary),nextOffset:offset+chunk.length<read.content.length?offset+chunk.length:null});}
 return Response.json(await s.projectList(b.scope,b.cursor??null));
 }catch{return new Response('{}',{status:403});}}};`;
 const bundle=await build({stdin:{contents:entry,sourcefile:'project-view-r2-fixture.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers'],logLevel:'silent'});
 const worker='project-view-r2',mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{TOOL_ARTIFACT_STORE:{type:'durable-object',worker,exportName:'ToolArtifactStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'project-view-r2'}},exports:{ToolArtifactStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response(null,{status:403})}}}]});
 t.after(()=>mf.dispose());
 const call=async b=>{const response=await mf.dispatchFetch('http://artifact.test/',{method:'POST',body:JSON.stringify({scope,...b})});if(!response.ok)throw Error('artifact denied');return response.json();};
 return {call};
}
