import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
test('actual ToolBridgeAgent routes parameter effects to Workspace, recovers original receipt after restart and never calls Project Sandbox',{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'parameter-tool-'));
 const source=`import {DurableObject} from 'cloudflare:workers';export {ToolBridgeAgent} from './services/tools/durable.ts';import {toolBridgeActorName} from './services/tools/identity.ts';import {workspaceAgentName} from './services/workspace/protocol.ts';import {parameterDraftEffect,readParameterDraft} from './services/simulation/parameter-draft.ts';
 const scope=${JSON.stringify(scope)},version={revisionId:'rev',filesSha256:'a'.repeat(64),specSha256:'b'.repeat(64)},model={version,spec:{schemaVersion:1,researchQuestion:'Fire',scope:'forest',entities:['tree'],mechanisms:['burn'],assumptions:[],limitations:[],metrics:{burned:{}},execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'},parameters:{density:{type:'number',default:0.7,minimum:0,maximum:1},fires:{type:'integer',default:3,minimum:1,maximum:5}}},canRun:true,reasonCode:null};
 export class Workspace extends DurableObject{
  async experimentParameterEffect(input){const receipt=await parameterDraftEffect({...input,storage:this.ctx.storage,scope,model:async()=>model,authorize:async()=>{if(this.ctx.storage.kv.get('revoked'))throw Error('parameter-draft-turn-denied');},assertCurrent:()=>{}});if(!input.observeOnly&&receipt.outcome==='completed'&&!this.ctx.storage.kv.get('lost')){this.ctx.storage.kv.put('lost',true);throw Error('lost-draft-ack');}return receipt;}
  async draft(){return readParameterDraft(this.ctx.storage,version);}
  async revoke(){this.ctx.storage.kv.put('revoked',true);}
 }
 export class MustNotExecute extends DurableObject{async executeFileEffect(){throw Error('unexpected-project-execution');}async materialize(){throw Error('unexpected-artifact');}}
 export default{async fetch(req,env){const b=await req.json(),ws=env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));try{if(b.op==='draft')return Response.json({draft:await ws.draft()});if(b.op==='revoke')return Response.json(await ws.revoke()??null);return Response.json({record:await env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(b.intent.scope,b.intent.turnId,b.intent.dispatchId)).run(b.intent)});}catch(e){return Response.json({error:e.message});}}};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'parameter-tool.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const worker='parameter-tool';const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:dir,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{M2_PROJECT_EFFECT_CAPABILITY_KEY:{type:'text',value:'key'},...Object.fromEntries([['TOOL_BRIDGE_AGENT','ToolBridgeAgent'],['WORKSPACE_AGENT','Workspace'],['PROJECT_SANDBOX','MustNotExecute'],['TOOL_ARTIFACT_STORE','MustNotExecute']].map(([k,exportName])=>[k,{type:'durable-object',worker,exportName}]))},exports:Object.fromEntries(['ToolBridgeAgent','Workspace','MustNotExecute'].map(k=>[k,{type:'durable-object',storage:'sqlite'}]))},dev:{unsafeRegisterWorker:false}}]};
 let mf;const call=async body=>(await mf.dispatchFetch('https://tool.test/',{method:'POST',body:JSON.stringify(body)})).json();
 const intent={schemaVersion:2,scope,turnId:'turn',dispatchId:'dispatch',commandId:'cmd-a',executionDeadlineAt:Date.now()+60000,operation:'experiment_parameters',arguments:{revisionId:'rev',parameters:{density:0.5,fires:1},seed:42,comparison:null}};
 try{mf=new Miniflare(options);assert.equal((await call({intent})).error,'lost-draft-ack');assert.equal((await call({op:'draft'})).draft.parameters.density,0.5);await mf.dispose();mf=new Miniflare(options);await call({op:'revoke'});const restored=await call({intent});assert.equal(restored.record.status,'completed');assert.equal(restored.record.result.executionSubmitted,false);assert.equal(restored.record.result.draft.draftId,'cmd-a');assert.equal(restored.record.command,null);const before=await call({op:'draft'});
 const denied=await call({intent:{...intent,commandId:'cmd-b',arguments:{...intent.arguments,parameters:{density:0.6}}}});assert.equal(denied.record.status,'failed');assert.equal(denied.record.errorCode,'parameter-draft-turn-denied');assert.deepEqual(await call({op:'draft'}),before);
 const cross=await call({intent:{...intent,scope:{...scope,projectId:'other'},turnId:'turn-cross',commandId:'cmd-cross'}});assert.equal(cross.error,'parameter-draft-scope-denied');assert.deepEqual(await call({op:'draft'}),before);
 }finally{await mf?.dispose();await rm(dir,{recursive:true,force:true});}
});
