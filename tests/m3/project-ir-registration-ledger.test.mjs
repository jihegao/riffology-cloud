import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {SqlToolLedger} from '../../services/tools/ledger.ts';
import {ToolDispatcher} from '../../services/tools/dispatcher.ts';
import {createProjectIrEffects} from '../../services/project-tools/ir-routing.ts';
import {projectIrRegisterEffect,projectIrToolEffect} from '../../services/project-ir/effects.ts';
import {IrCommitUnknown,PROJECT_IR_INPUT_MAX_BYTES} from '../../services/project-ir/authority.ts';
import {createProductToolBridge} from '../../services/trusted-pi/product-tool-bridge.mjs';
import {projectIrFixture} from './project-ir-fixture.ts';

// Real SQL Ledger, Dispatcher, routing, registration core and ProductToolBridge.
// Native CLI receipts, identity and KV/R2 are synthetic. The immutable B1 graph
// comes from the committed compiler fixture, never a handwritten Plan. No cloud
// or provider request is sent and this does not claim online Agent acceptance.
const scope={tenantId:'tenant-registration',projectId:'project-registration',workspaceId:'workspace-registration',workspaceGeneration:1};
const actor={userId:'owner-registration',authVersion:1};
const identity={scope,sessionId:'session-registration',turnId:'turn-registration',dispatchId:'dispatch-registration',generation:1};
const callScope={tenantId:scope.tenantId,projectId:scope.projectId,sessionId:identity.sessionId};
class WorkspaceStorage{
 values=new Map();loseNextSyncAck=false;afterSync;
 kv={get:key=>structuredClone(this.values.get(key)),put:(key,value)=>this.values.set(key,structuredClone(value))};
 transactionSync(operation){const old=structuredClone(this.values);try{return operation();}catch(error){this.values=old;throw error;}}
 async sync(){if(this.loseNextSyncAck){this.loseNextSyncAck=false;throw Error('synthetic-workspace-sync-ACK-lost');}this.afterSync?.();}
}
class Bucket{
 values=new Map();writes=0;
 async get(key){const value=this.values.get(key);return value?{arrayBuffer:async()=>Uint8Array.from(value).buffer}:null;}
 async put(key,value){this.writes++;this.values.set(key,Uint8Array.from(value));}
}
let shared;
async function fixture(t,{padded=false}={}){
 if(!shared){const root=new URL('../../vendor/riffoid-ir-plugin/',import.meta.url),[runtimeSource,workerSource,pkg]=await Promise.all(['browser/runtime.js','browser/worker.js','package.json'].map(name=>readFile(new URL(name,root),'utf8')));shared=await projectIrFixture({runtimeSource,workerSource,pluginVersion:JSON.parse(pkg).version});}
 const f=structuredClone(shared);if(padded)f.registration.state.draft+=' '.repeat(190*1024);
 const database=new DatabaseSync(':memory:');t.after(()=>database.close());
 const ledgerStorage={sql:{exec(query,...bindings){if(query.includes('CREATE TABLE')){database.exec(query);return {toArray:()=>[]};}const statement=database.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync(operation){database.exec('BEGIN IMMEDIATE');try{const value=operation();database.exec('COMMIT');return value;}catch(error){database.exec('ROLLBACK');throw error;}},async sync(){}};
 let now=1000,effects=0,denyNext=false;const storage=new WorkspaceStorage(),bucket=new Bucket(),native=new Map(),commands=[],dispatchErrors=[],written=new Map(),counts={execute:0,observe:0};
 const authorize=async()=>{if(denyNext){denyNext=false;throw Error('synthetic-transient-authorization-denied');}};
 const context={storage,bucket,scope,actor,authorize,clock:()=>now},ledger=new SqlToolLedger(ledgerStorage,()=>now,()=>`effect-registration-${++effects}`);
 const source=(command,effectId,result)=>({schemaVersion:1,scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:'terminal',outcome:'completed',errorCode:null,result,observedAt:now});
 const files={async execute({command,effectId}){counts.execute++;let result;
  if(command.operation==='ir'){assert.equal(command.arguments.operation,'project_ir_compile');result={status:'succeeded',browserArtifactRef:f.browserArtifactRef,bundleRef:f.artifact.bundleRef,toolchain:f.artifact.toolchain,businessFingerprint:f.artifact.businessFingerprint,planFingerprint:f.artifact.planFingerprint,registration:structuredClone(f.registration)};}
  else{assert.equal(command.operation,'write');written.set(command.arguments.path,command.arguments.content);result={kind:'write',path:command.arguments.path,bytes:Buffer.byteLength(command.arguments.content)};}
  const receipt=source(command,effectId,result);native.set(effectId,receipt);return structuredClone(receipt);
 },async observe({reference}){counts.observe++;assert.ok(native.has(reference.effectId));return {...structuredClone(native.get(reference.effectId)),observedAt:++now};}};
 const ir=createProjectIrEffects(files,()=>({projectIrRegisterEffect:input=>projectIrRegisterEffect(context,input),projectIrToolEffect:input=>projectIrToolEffect(context,input)}));
 const dispatcher=new ToolDispatcher(ledger,{execute:input=>input.command.operation==='ir'?ir.execute(input):files.execute(input),observe:input=>input.command.operation==='ir'?ir.observe(input):files.observe(input)});
 const bridge=createProductToolBridge(identity,{clock:()=>now,executionDeadlineAt:60000,fetchImpl:async(_url,init)=>{const command=JSON.parse(init.body);commands.push(command);try{return Response.json(await dispatcher.runIntentUntilSettled(command));}catch(error){dispatchErrors.push(error);return Response.json({error:'tool_bridge_failed'},{status:500});}}});
 const compile=(toolCallId='compile-original')=>bridge.execute({scope:callScope,name:'project_ir_compile',toolCallId,args:{sealedRef:f.artifact.modelRef}});
 const original=()=>ledger.lookup(commands[0].commandId),coreKeys=()=>[...storage.values.keys()].filter(key=>key.startsWith('project-ir/v1/'));
 return {f,storage,bucket,native,commands,dispatchErrors,written,counts,context,ledger,bridge,compile,original,coreKeys,denyAfterCommit(){storage.afterSync=()=>{storage.afterSync=undefined;denyNext=true;};}};
}

test('determinate registration input_limit reaches the Agent, terminates the real ledger and permits a repair command',async t=>{
 const x=await fixture(t,{padded:true}),draft=x.f.registration.state.draft;
 assert.doesNotThrow(()=>JSON.parse(draft));assert.ok(Buffer.byteLength(draft)<PROJECT_IR_INPUT_MAX_BYTES);
 assert.ok(Buffer.byteLength(JSON.stringify(x.f.registration))>PROJECT_IR_INPUT_MAX_BYTES);assert.ok(Buffer.byteLength(JSON.stringify(x.f.registration))<1_000_000);
 const output=JSON.parse((await x.compile()).content[0].text),original=await x.original();
 assert.equal(output.status,'failed');assert.equal(output.diagnostics[0].code,'input_limit');assert.deepEqual(Object.keys(output).sort(),['diagnostics','status']);
 assert.equal(original.status,'completed');assert.equal(original.outcome,'completed');assert.deepEqual(original.result,output);assert.equal(x.dispatchErrors.length,0);
 const native=x.native.get(original.effectId);for(const key of ['scope','turnId','dispatchId','commandId','effectId'])assert.deepEqual(original[key],native[key]);
 assert.deepEqual(x.coreKeys(),[]);assert.equal(x.bucket.writes,0,'deterministic rejection has no R2 publication');
 const replay=JSON.parse((await x.compile()).content[0].text);assert.deepEqual(replay,output);assert.deepEqual(x.counts,{execute:1,observe:0},'same original command returns its terminal failure, never another native compile');
 const repaired=draft.trim();await x.bridge.execute({scope:callScope,name:'project_write',toolCallId:'repair-draft',args:{path:'model/business-ir.draft.json',content:repaired}});
 assert.equal(x.written.get('model/business-ir.draft.json'),repaired);assert.equal((await x.ledger.lookup(x.commands.at(-1).commandId)).status,'completed');
 // A later explicit compile after repair may succeed without replacing the old
 // failed effect or inheriting any rejected registration metadata.
 x.f.registration.state.draft=repaired;const saved=JSON.parse((await x.compile('compile-after-repair')).content[0].text);
 assert.equal(saved.status,'succeeded');assert.equal(saved.browserArtifactRef,x.f.browserArtifactRef);assert.equal(Object.hasOwn(saved,'registration'),false);
 assert.equal((await x.original()).result.status,'failed');assert.ok(x.coreKeys().length>0);assert.ok(x.bucket.writes>0);
});

test('lost failed-receipt publication ACK preserves unknown until observing the same original failure without native replay',async t=>{
 const x=await fixture(t,{padded:true});x.storage.loseNextSyncAck=true;
 await assert.rejects(x.compile(),/product-tool-request-failed/);const unknown=await x.original();
 assert.equal(unknown.status,'unknown');assert.equal(x.dispatchErrors[0].message,'synthetic-workspace-sync-ACK-lost');assert.deepEqual(x.coreKeys(),[]);assert.equal(x.bucket.writes,0);
 const result=JSON.parse((await x.compile()).content[0].text),settled=await x.original();
 assert.equal(settled.status,'completed');assert.equal(result.status,'failed');assert.equal(result.diagnostics[0].code,'input_limit');assert.equal(settled.effectId,unknown.effectId);
 assert.deepEqual(x.counts,{execute:1,observe:1});assert.equal(x.native.size,1);assert.equal(x.bucket.writes,0);assert.deepEqual(x.coreKeys(),[]);
});

test('real core KV commit uncertainty and post-commit authorization failure remain unknown and recover by original observation',async t=>{
 for(const mode of ['core-sync-ACK','final-authorization'])await t.test(mode,async t=>{
  const x=await fixture(t);if(mode==='core-sync-ACK')x.storage.loseNextSyncAck=true;else x.denyAfterCommit();
  await assert.rejects(x.compile(),/product-tool-request-failed/);const unknown=await x.original();assert.equal(unknown.status,'unknown');assert.ok(x.coreKeys().length>0);assert.ok(x.bucket.writes>0);
  assert.equal([...x.storage.values.keys()].some(key=>key.startsWith('project-ir:host-effect:')),false);
  if(mode==='core-sync-ACK')assert.ok(x.dispatchErrors[0] instanceof IrCommitUnknown);else assert.equal(x.dispatchErrors[0].code,'authorization_denied');
  const beforeR2=x.bucket.writes,result=JSON.parse((await x.compile()).content[0].text),settled=await x.original();
  assert.equal(result.status,'succeeded');assert.equal(result.browserArtifactRef,x.f.browserArtifactRef);assert.equal(Object.hasOwn(result,'registration'),false);assert.equal(settled.status,'completed');assert.equal(settled.effectId,unknown.effectId);
  assert.deepEqual(x.counts,{execute:1,observe:1});assert.equal(x.native.size,1);assert.equal(x.bucket.writes,beforeR2,'only the original registered graph is observed');
 });
});
