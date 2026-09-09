import test from 'node:test';import assert from 'node:assert/strict';
import {R2ObserverArtifacts,observerArtifactDescriptor,type ObserverArtifactBucket} from '../../services/preview/observer-artifacts.ts';
import {SqlObserverArtifactInventory} from '../../services/preview/observer-artifact-inventory.ts';
import {SqlObserverExecutorSupervisor} from '../../services/preview/observer-executor-supervisor.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
import {fixture,scope} from './run-fixture.ts';
const command:ObserverCommand={schemaVersion:1,purpose:'observer',scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',commandId:'command',previewId:'preview',operation:'snapshot',deadlineAt:15000};
const bytes=new TextEncoder().encode('{"simulation_state_id":"s","sequence":1,"state":{}}');
function bucket(){
 const values=new Map<string,Uint8Array>();let writes=0,lostAck=false;
 const port={put:async(key:string,content:Uint8Array)=>{writes++;values.set(key,Uint8Array.from(content));if(lostAck)throw Error('put-ack-lost');return {};},get:async(key:string)=>{const content=values.get(key);return content?{size:content.length,body:new Response(Uint8Array.from(content).buffer).body}:null;}} as unknown as ObserverArtifactBucket;
 return {port,get writes(){return writes;},loseAck(){lostAck=true;}};
}
test('write is registered before dispatch, and lost put acknowledgement stays uncertain after valid readback and restart',async t=>{
 const f=fixture(t),b=bucket(),inventory=new SqlObserverArtifactInventory(f.storage,command),store=new R2ObserverArtifacts(b.port,inventory);b.loseAck();
 const receipt=await store.save(command,'state',bytes);assert.equal(b.writes,1);
 assert.deepEqual(await inventory.snapshot(),[{receipt,writeState:'uncertain',contentVerified:true}]);
 f.reopen();const reopened=new SqlObserverArtifactInventory(f.storage,command);
 assert.deepEqual(await new R2ObserverArtifacts(b.port,reopened).save(command,'state',bytes),receipt);assert.equal(b.writes,1);
 assert.equal((await reopened.snapshot())[0]!.writeState,'uncertain');
});
test('lost claim sync acknowledgement prevents dispatch and never grants it again',async t=>{
 const f=fixture(t),b=bucket(),inventory=new SqlObserverArtifactInventory(f.storage,command);await inventory.snapshot();
 f.failNextSync();await assert.rejects(new R2ObserverArtifacts(b.port,inventory).save(command,'state',bytes),/ack-loss/);assert.equal(b.writes,0);
 f.reopen();const reopened=new SqlObserverArtifactInventory(f.storage,command);
 await assert.rejects(new R2ObserverArtifacts(b.port,reopened).save(command,'state',bytes));assert.equal(b.writes,0);
 assert.equal((await reopened.snapshot())[0]!.writeState,'pending');assert.equal((await reopened.snapshot())[0]!.contentVerified,false);
});
test('stop arriving during durable claim prevents subsequent R2 dispatch',async t=>{
 const f=fixture(t),b=bucket();let fenced=false,stopOnSync=false;
 const storage={...f.storage,async sync(){await f.storage.sync();if(stopOnSync)fenced=true;}};
 const inventory=new SqlObserverArtifactInventory(storage,command,()=>{if(fenced)throw Error('write-fenced');});await inventory.snapshot();stopOnSync=true;
 await assert.rejects(new R2ObserverArtifacts(b.port,inventory).save(command,'state',bytes),/write-fenced/);assert.equal(b.writes,0);
 assert.equal((await inventory.snapshot())[0]!.writeState,'pending');
});
test('executor result and retained roots commit together, and unverified content cannot be retained',async t=>{
 const f=fixture(t),b=bucket(),inventory=new SqlObserverArtifactInventory(f.storage,command),store=new R2ObserverArtifacts(b.port,inventory);
 const receipt=await store.save(command,'state',bytes);
 const supervisor=new SqlObserverExecutorSupervisor(f.storage,command,{execute:async()=>({stopped:true,result:{state:{artifact:receipt}}}),fenceAndStop:async()=>true},()=>f.now);
 await supervisor.execute();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM observer_artifact_roots').get()!.n,1);
 const result=f.db.prepare('SELECT result_json FROM observer_executor').get()!;assert.ok(result.result_json);
 f.reopen();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM observer_artifact_roots').get()!.n,1);
 const view=(await observerArtifactDescriptor(command,'view',new TextEncoder().encode('{}'))).receipt;
 const restored=new SqlObserverArtifactInventory(f.storage,command);await restored.claim(command,view);
 assert.throws(()=>f.storage.transactionSync(()=>SqlObserverArtifactInventory.retainResult(f.storage,command,{state:{artifact:receipt},view:{artifact:view}})),/unverified/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM observer_artifact_roots').get()!.n,1);
});
test('failure to commit executor result rolls back newly retained roots in the same transaction',async t=>{
 const f=fixture(t),b=bucket(),inventory=new SqlObserverArtifactInventory(f.storage,command);
 const receipt=await new R2ObserverArtifacts(b.port,inventory).save(command,'state',bytes);
 const supervisor=new SqlObserverExecutorSupervisor(f.storage,command,{execute:async()=>({stopped:true,result:{state:{artifact:receipt}}}),fenceAndStop:async()=>true},()=>f.now);
 f.db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE OF result_json ON observer_executor WHEN NEW.result_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'completion-fault'); END");
 await assert.rejects(supervisor.execute(),/completion-fault/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM observer_artifact_roots').get()!.n,0);
 assert.equal(f.db.prepare('SELECT result_json FROM observer_executor').get()!.result_json,null);
 assert.equal((await inventory.snapshot())[0]!.contentVerified,true);
});
