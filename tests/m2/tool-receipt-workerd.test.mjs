import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {productToolCommandId} from '../../services/tools/receipt.ts';
import {sandboxActorIds} from '../../services/sandbox/policy.ts';

const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const key='readonly-receipt-capability-key'.padEnd(40,'x');
const entry=`
import {ToolBridgeAgent as ProductionToolBridge} from './services/tools/durable.ts';
import {ProjectToolSandbox as ProductionProjectSandbox} from './services/sandbox/classes.ts';
import {SqlToolLedger,readExistingToolCommand,toolCommandReference} from './services/tools/ledger.ts';
import {toolBridgeActorName} from './services/tools/identity.ts';
import {sandboxActorIds} from './services/sandbox/policy.ts';

export class ToolBridgeAgent extends ProductionToolBridge{
 async seed(input){const ledger=new SqlToolLedger(this.ctx.storage,Date.now,()=>input.effectId);await ledger.accept(input.command);const sent=await ledger.dispatch(input.command.commandId);if(input.status==='unknown')await ledger.markUnknown(toolCommandReference(sent.record));else await ledger.applyEffect({...input.receipt,effectId:sent.record.effectId});return readExistingToolCommand(this.ctx.storage,input.command.commandId);}
 async fixtureSnapshot(commandId){const tables=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray().map(row=>row.name);return {tables,record:readExistingToolCommand(this.ctx.storage,commandId)};}
}
export class ProjectFixture extends ProductionProjectSandbox{
 nativeStarts=0;nativeExecs=0;nativeProcesses=0;
 async startAndWaitForPorts(){this.nativeStarts++;throw Error('native-start-forbidden');}
 async exec(){this.nativeExecs++;throw Error('native-exec-forbidden');}
 async startProcess(){this.nativeProcesses++;throw Error('native-process-forbidden');}
 seedEffect(effectId){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS project_effects (effect_id TEXT PRIMARY KEY,start_digest TEXT NOT NULL,start_json TEXT,phase TEXT NOT NULL,exit_code INTEGER,stdout TEXT,stderr TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)');this.ctx.storage.sql.exec('INSERT INTO project_effects VALUES (?,?,?,?,?,?,?,?,?)',effectId,'a'.repeat(64),null,'exited',0,JSON.stringify({ok:true,result:{kind:'bash',exitCode:0,stdout:'persisted',stderr:'',stdoutTruncated:false,stderrTruncated:false}}),'',Date.now(),Date.now());return true;}
 snapshot(){const tables=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray().map(row=>row.name);return {tables,nativeStarts:this.nativeStarts,nativeExecs:this.nativeExecs,nativeProcesses:this.nativeProcesses};}
}
export default {async fetch(request,env){const input=await request.json(),bridge=env.TOOL_BRIDGE_AGENT.getByName(await toolBridgeActorName(input.identity.scope,input.identity.turnId,input.identity.dispatchId)),ids=await sandboxActorIds(input.identity.scope,input.identity.turnId,input.identity.dispatchId),project=env.PROJECT_SANDBOX.getByName(ids.project);
 if(input.action==='seed'){const record=await bridge.seed(input);await project.seedEffect(input.effectId);return Response.json(record);}
 if(input.action==='read')return Response.json(await bridge.readPersistedReceipt(input.read));
 if(input.action==='snapshot')return Response.json({bridge:await bridge.fixtureSnapshot(input.commandId),project:await project.snapshot()});
 return new Response('not found',{status:404});}};
`;

async function bundled(){return (await build({stdin:{contents:entry,sourcefile:'tool-receipt-worker.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],plugins:[{name:'sandbox-do-fixture',setup(build){build.onResolve({filter:/^@cloudflare\/sandbox$/},()=>({path:'sandbox-do-fixture',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`import {DurableObject} from 'cloudflare:workers';export class Sandbox extends DurableObject{async destroy(){return undefined;}async writeFile(){throw Error('native-write-forbidden');}async readFile(){throw Error('native-read-forbidden');}async startAndWaitForPorts(){throw Error('native-start-forbidden');}async exec(){throw Error('native-exec-forbidden');}async startProcess(){throw Error('native-process-forbidden');}}export class ContainerProxy{}export function getSandbox(namespace,actorId){return namespace.getByName(actorId);}` }));}}],logLevel:'silent'})).outputFiles[0].text;}
async function serviceBundled(){const source=`
import {DurableObject} from 'cloudflare:workers';
import {createGatewayTurnServices} from './services/gateway/turn-services.ts';
export class WorkspaceAgent extends DurableObject{async toolReceipt(input){await this.ctx.storage.put('seen',{keys:Object.keys(input).sort(),turnId:input.turnId,name:input.name});return {schemaVersion:1,state:'unknown',binding:{turnId:input.turnId,revisionId:input.revisionId,toolCallId:input.toolCallId,name:input.name,operation:'bash'}};}async seen(){return await this.ctx.storage.get('seen')??null;}}
export default{async fetch(request,env){const input=await request.json(),services=createGatewayTurnServices(env),value=await services.toolReceipt(input.scope,input.actor,input.turnId,input.revisionId,input.toolCallId,input.name),stub=env.WORKSPACE_AGENT.getByName('workspace:'+input.scope.tenantId+':'+input.scope.workspaceId);return Response.json({value,seen:await stub.seen()});}};`;
 return (await build({stdin:{contents:source,sourcefile:'tool-receipt-service-worker.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'})).outputFiles[0].text;}
async function post(mf,body){const response=await mf.dispatchFetch('http://receipt.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),text=await response.text();assert.equal(response.status,200,text);return JSON.parse(text);}

test('ToolBridge receipt RPC reads unknown persisted effect without dispatcher or native execution',{timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tool-receipt-workerd-')),worker='tool-receipt',module=await bundled(),mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:directory,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:module}}},env:{M2_PROJECT_EFFECT_CAPABILITY_KEY:{type:'text',value:key},TOOL_BRIDGE_AGENT:{type:'durable-object',worker,exportName:'ToolBridgeAgent'},PROJECT_SANDBOX:{type:'durable-object',worker,exportName:'ProjectFixture'}},exports:{ToolBridgeAgent:{type:'durable-object',storage:'sqlite'},ProjectFixture:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]});
 try{const commandId=await productToolCommandId(identity,'call-a','project_bash'),command={schemaVersion:1,scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId,deadlineAt:Date.now()+60_000,operation:'bash',arguments:{script:'private command',timeoutMs:1_000}},ids=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId),receipt={schemaVersion:1,scope:identity.scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId,effectId:'ignored',phase:'terminal',outcome:'completed',errorCode:null,result:{kind:'bash',exitCode:0,stdout:'ledger',stderr:'',stdoutTruncated:false,stderrTruncated:false},observedAt:Date.now()};
  await post(mf,{action:'seed',identity,commandId,effectId:'effect-a',status:'unknown',command,receipt});const before=await post(mf,{action:'snapshot',identity,commandId}),read={identity,revisionId:'revision-a',commandId,toolCallId:'call-a',name:'project_bash',target:{actorId:ids.project,warm:null}},result=await post(mf,{action:'read',identity,commandId,read}),after=await post(mf,{action:'snapshot',identity,commandId});
  assert.equal(result.state,'terminal');assert.equal(result.source,'persisted-effect');assert.equal(result.ledger.status,'unknown');assert.equal(result.result.stdout,'persisted');assert.deepEqual(after.bridge,before.bridge);assert.deepEqual(after.project,before.project);assert.deepEqual(after.project,{tables:['project_effects'],nativeStarts:0,nativeExecs:0,nativeProcesses:0});const text=JSON.stringify(result);for(const privateValue of ['private command','effect-a','commandId','digest','capability'])assert.equal(text.includes(privateValue),false);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('absent ToolBridge schema returns not-admitted without creating ledger or touching ProjectSandbox',{timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tool-receipt-absent-')),worker='tool-receipt',module=await bundled(),mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:directory,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:module}}},env:{M2_PROJECT_EFFECT_CAPABILITY_KEY:{type:'text',value:key},TOOL_BRIDGE_AGENT:{type:'durable-object',worker,exportName:'ToolBridgeAgent'},PROJECT_SANDBOX:{type:'durable-object',worker,exportName:'ProjectFixture'}},exports:{ToolBridgeAgent:{type:'durable-object',storage:'sqlite'},ProjectFixture:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]});
 try{const commandId=await productToolCommandId(identity,'call-absent','project_bash'),ids=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId),read={identity,revisionId:'revision-a',commandId,toolCallId:'call-absent',name:'project_bash',target:{actorId:ids.project,warm:null}},result=await post(mf,{action:'read',identity,commandId,read}),snapshot=await post(mf,{action:'snapshot',identity,commandId});assert.equal(result.state,'not-admitted');assert.deepEqual(snapshot.bridge.tables,[]);assert.equal(snapshot.bridge.record,null);assert.deepEqual(snapshot.project,{tables:[],nativeStarts:0,nativeExecs:0,nativeProcesses:0});}
 finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('createGatewayTurnServices invokes the real Workspace Durable Object RPC method with serializable receipt input',{timeout:30_000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tool-receipt-service-')),worker='tool-receipt-service',module=await serviceBundled(),mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,resourcePersistencePath:directory,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:module}}},env:{M2_TURNS_ENABLED:{type:'text',value:'false'},WORKSPACE_AGENT:{type:'durable-object',worker,exportName:'WorkspaceAgent'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false}}]});
 try{const input={scope:identity.scope,actor:{userId:'reviewer',authVersion:9},turnId:identity.turnId,revisionId:'revision-a',toolCallId:'call-a',name:'project_bash'},response=await mf.dispatchFetch('http://receipt-service.test',{method:'POST',body:JSON.stringify(input)}),text=await response.text();assert.equal(response.status,200,text);const body=JSON.parse(text);assert.equal(body.value.state,'unknown');assert.deepEqual(body.value.binding,{turnId:'turn-a',revisionId:'revision-a',toolCallId:'call-a',name:'project_bash',operation:'bash'});assert.deepEqual(body.seen,{keys:['actor','name','revisionId','scope','toolCallId','turnId'],turnId:'turn-a',name:'project_bash'});}
 finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});
