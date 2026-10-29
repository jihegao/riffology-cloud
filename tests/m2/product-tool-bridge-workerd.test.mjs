import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createProductToolBridge,PRODUCT_TOOL_BRIDGE_URL} from '../../services/trusted-pi/product-tool-bridge.mjs';
import * as irPlugin from '../../services/trusted-pi/ir-package.mjs';

const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const toolScope={tenantId:identity.scope.tenantId,projectId:identity.scope.projectId,sessionId:identity.sessionId};
const secret='tool-bridge-workerd-secret-'.padEnd(40,'x');
const entry=`
import {DurableObject} from 'cloudflare:workers';
import {handleToolBridgeRequest} from './services/tools/http.ts';
import {toolBridgeActorName} from './services/tools/identity.ts';
import {signTrustedToolRequest} from './services/tools/internal-auth.ts';
import {SqlToolLedger} from './services/tools/ledger.ts';
import {ToolDispatcher} from './services/tools/dispatcher.ts';
import {sandboxActorIds} from './services/sandbox/policy.ts';

export class TrustedPiFixture extends DurableObject{}
export class EffectFixture extends DurableObject{
 async execute(command,effectId){
  const prior=await this.ctx.storage.get('receipt');if(prior){if(prior.effectId!==effectId)throw Error('effect-id-conflict');return prior;}
  await this.ctx.storage.put('executions',(await this.ctx.storage.get('executions')??0)+1);
  const result=command.operation==='ir'?{runId:command.arguments.input.runId,events:Array.from({length:1200},(_,i)=>({sequence:i+1,time:i,phase:'tick',kind:'observed',entity:'aircraft-a'}))}:{text:'written'};
  const receipt={schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:'terminal',outcome:'completed',errorCode:null,result,observedAt:Date.now()};
  await this.ctx.storage.put('receipt',receipt);
  if(command.arguments.content==='lost-after-effect'&&!await this.ctx.storage.get('lost')){await this.ctx.storage.put('lost',true);throw Error('lost-after-effect');}
  return receipt;
 }
 async observe(reference){const receipt=await this.ctx.storage.get('receipt');return receipt?{...receipt,observedAt:Date.now()}:{schemaVersion:1,scope:reference.scope,turnId:reference.turnId,dispatchId:reference.dispatchId,commandId:reference.commandId,effectId:reference.effectId,phase:'absent',outcome:null,errorCode:null,result:null,observedAt:Date.now()};}
 async count(){return await this.ctx.storage.get('executions')??0;}
}
export class ToolBridgeAgent extends DurableObject{
 now=null;
 ledger=new SqlToolLedger(this.ctx.storage,()=>this.now??Date.now());
 dispatcher=new ToolDispatcher(this.ledger,{execute:({command,effectId})=>this.env.EFFECT.getByName('effect:singleton').execute(command,effectId),observe:({reference})=>this.env.EFFECT.getByName('effect:singleton').observe(reference)});
 async run(input){const name=await toolBridgeActorName(input.scope,input.turnId,input.dispatchId);if(!this.env.TOOL_BRIDGE_AGENT.idFromName(name).equals(this.ctx.id))throw Error('tool-bridge-actor-scope-denied');return this.dispatcher.runIntentUntilSettled(input,{clock:()=>this.now??Date.now(),wait:async()=>{}});}
 async setClock(now){this.now=now;}
 async lookup(commandId){return this.ledger.lookup(commandId);}
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(request.method!=='POST')return new Response(null,{status:404});
 if(url.pathname==='/bridge'){
  const body=await request.arrayBuffer(),intent=JSON.parse(new TextDecoder().decode(body)),trusted=(await sandboxActorIds(intent.scope,intent.turnId,intent.dispatchId)).trustedPi,containerId=env.TRUSTED_PI_SANDBOX.idFromName(trusted).toString(),requestAt=Date.now(),mac=await signTrustedToolRequest(env.M2_TOOL_BRIDGE_REQUEST_KEY,containerId,requestAt,body);
  return handleToolBridgeRequest(new Request('https://tool-bridge.riffology.internal/v1/tool',{method:'POST',headers:{'content-type':'application/json','x-riffology-sandbox-role':'trusted-pi','x-riffology-sandbox-id':containerId,'x-riffology-request-at':String(requestAt),'x-riffology-request-mac':mac},body}),env);
 }
 if(url.pathname==='/snapshot'){
  const input=await request.json(),bridge=env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(input.identity.scope,input.identity.turnId,input.identity.dispatchId));
  return Response.json({record:await bridge.lookup(input.commandId),effects:await env.EFFECT.getByName('effect:singleton').count()});
 }
 if(url.pathname==='/clock'){
  const input=await request.json(),bridge=env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(input.identity.scope,input.identity.turnId,input.identity.dispatchId));await bridge.setClock(input.now);return Response.json({ok:true});
 }
 return new Response(null,{status:404});
}};`;

async function bundledWorker(){return (await build({stdin:{contents:entry,sourcefile:'product-tool-bridge-workerd.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'})).outputFiles[0].text;}
function miniflare(workerModule,persistence){
 const worker='tool-bridge-workerd';return new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:persistence,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:workerModule}}},env:{M2_TOOL_BRIDGE_REQUEST_KEY:{type:'text',value:secret},TOOL_BRIDGE_AGENT:{type:'durable-object',worker,exportName:'ToolBridgeAgent'},TRUSTED_PI_SANDBOX:{type:'durable-object',worker,exportName:'TrustedPiFixture'},EFFECT:{type:'durable-object',worker,exportName:'EffectFixture'}},exports:{ToolBridgeAgent:{type:'durable-object',storage:'sqlite'},TrustedPiFixture:{type:'durable-object',storage:'sqlite'},EffectFixture:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
}
async function post(mf,path,body){return mf.dispatchFetch('http://tool-bridge.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}

test('real Bridge HTTP and SQLite ledger observe one effect after its response is lost, reconstruction, and deadline expiry',{timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tool-bridge-workerd-')),workerModule=await bundledWorker();let mf=miniflare(workerModule,directory),firstCommand;
 const call={scope:toolScope,name:'project_write',toolCallId:'provider-call-a',args:{path:'model/main.py',content:'lost-after-effect'}},executionDeadlineAt=Date.now()+60_000;
 const lostHost=createProductToolBridge(identity,{executionDeadlineAt,fetchImpl:async(url,init)=>{assert.equal(String(url),PRODUCT_TOOL_BRIDGE_URL);firstCommand=JSON.parse(init.body);return mf.dispatchFetch('http://tool-bridge.test/bridge',{method:'POST',body:init.body});}});
 try{
  await assert.rejects(lostHost.execute(call),/product-tool-request-failed/);
  const unknown=await (await post(mf,'/snapshot',{identity,commandId:firstCommand.commandId})).json();assert.equal(unknown.effects,1);assert.equal(unknown.record.status,'unknown');assert.equal(unknown.record.effectId!==null,true);
  await mf.dispose();mf=miniflare(workerModule,directory);
  assert.equal((await post(mf,'/clock',{identity,now:unknown.record.deadlineAt+1})).status,200);
  let replayCommand;const rebuiltHost=createProductToolBridge(identity,{executionDeadlineAt,fetchImpl:async(url,init)=>{assert.equal(String(url),PRODUCT_TOOL_BRIDGE_URL);replayCommand=JSON.parse(init.body);return mf.dispatchFetch('http://tool-bridge.test/bridge',{method:'POST',body:init.body});}}),result=await rebuiltHost.execute(call);
  assert.deepEqual(result,{content:[{type:'text',text:'{"text":"written"}'}],details:{operation:'write',status:'completed'}});assert.deepEqual(replayCommand,firstCommand);
  const snapshot=await (await post(mf,'/snapshot',{identity,commandId:firstCommand.commandId})).json();assert.equal(snapshot.effects,1);assert.equal(snapshot.record.commandId,unknown.record.commandId);assert.equal(snapshot.record.digest,unknown.record.digest);assert.equal(snapshot.record.effectId,unknown.record.effectId);assert.equal(snapshot.record.deadlineAt,unknown.record.deadlineAt);assert.equal(snapshot.record.deadlineAt<=executionDeadlineAt,true);assert.equal(snapshot.record.status,'completed');
  await assert.rejects(rebuiltHost.execute({...call,args:{path:'model/main.py',content:'print(2)'}}),/tool-idempotency-conflict/);const afterConflict=await (await post(mf,'/snapshot',{identity,commandId:firstCommand.commandId})).json();assert.equal(afterConflict.effects,1);assert.deepEqual(afterConflict.record,snapshot.record);

  let expiredCommand;const expiredHost=createProductToolBridge(identity,{executionDeadlineAt:Date.now()+20,fetchImpl:async(url,init)=>{assert.equal(String(url),PRODUCT_TOOL_BRIDGE_URL);expiredCommand=JSON.parse(init.body);await new Promise(resolve=>setTimeout(resolve,30));return mf.dispatchFetch('http://tool-bridge.test/bridge',{method:'POST',body:init.body});}});
  await assert.rejects(expiredHost.execute({...call,toolCallId:'provider-call-expired'}),/product-tool-request-failed/);const expired=await (await post(mf,'/snapshot',{identity,commandId:expiredCommand.commandId})).json();assert.equal(expired.record,null);assert.equal(expired.effects,1);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});


test('IR-specific large result survives the actual Workerd SQLite ledger and host bridge without truncation',{timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ir-tool-bridge-workerd-')),workerModule=await bundledWorker();let mf=miniflare(workerModule,directory),sent;
 const executionDeadlineAt=Date.now()+60_000,runId='run-11111111-1111-4111-8111-111111111111',call={scope:toolScope,name:'project_ir_result',toolCallId:'provider-ir-result',args:{runId}};
 const bridge=()=>createProductToolBridge(identity,{executionDeadlineAt,irPlugin,fetchImpl:async(_,init)=>{sent=JSON.parse(init.body);return mf.dispatchFetch('http://tool-bridge.test/bridge',{method:'POST',body:init.body});}});
 try{
  const original=await bridge().execute(call),record=JSON.parse(original.content[0].text);assert.equal(record.runId,runId);assert.equal(record.events.length,1200);assert.ok(Buffer.byteLength(original.content[0].text)>16384);
  const before=await (await post(mf,'/snapshot',{identity,commandId:sent.commandId})).json();assert.equal(before.effects,1);assert.equal(before.record.operation,'ir');assert.equal(before.record.status,'completed');assert.deepEqual(before.record.result,record);
  await mf.dispose();mf=miniflare(workerModule,directory);assert.deepEqual(await bridge().execute(call),original);
  const after=await (await post(mf,'/snapshot',{identity,commandId:sent.commandId})).json();assert.equal(after.effects,1);assert.deepEqual(after.record.result,record);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
