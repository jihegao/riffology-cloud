import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SqlExecutionBindingStore,backendState,recoveryPlan,usageObservation,type ExecutionBinding} from '../../services/turn-runtime/backend-contract.ts';
import {OfflineManagedAdapter,selectProductBackend,type ManagedTransport,type ManagedReceipt} from '../../services/turn-runtime/managed-adapter.ts';
import type {ProductTurnRuntimeStorage} from '../../services/turn-runtime/core.ts';
const identity={scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'local-session',turnId:'local-turn',dispatchId:'local-dispatch',generation:1};
const input={identity,actor:{userId:'user',authVersion:1},message:'synthetic input',base:{workspace:null,session:null}};
function fixture(t:any){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let syncs=0,creates=0,continues=0,lookups=0,cancels=0,deletes=0,lose=false,deleteLost=false;
 const storage={sql:{exec(sql:string,...values:any[]){const q=db.prepare(sql);const rows=q.columns().length?q.all(...values):(q.run(...values),[]);return {toArray:()=>rows};}},transactionSync<T>(f:()=>T){db.exec('BEGIN');try{const result=f();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},async sync(){syncs++;}} as unknown as ProductTurnRuntimeStorage;
 const store=new SqlExecutionBindingStore(storage);
 let receipt:ManagedReceipt={schemaVersion:1,identity,sessionId:'remote-session',turnId:'remote-turn',phase:'completed',observedAt:1000,usage:null,events:[]};
 const transport:ManagedTransport={async create(){creates++;assert.ok(syncs>0);if(lose)throw Error('lost-ack');return structuredClone(receipt);},async continue(){continues++;return structuredClone(receipt);},async lookupOriginal(){lookups++;return structuredClone(receipt);},async retrieve(){return structuredClone(receipt);},async cancel(){cancels++;throw Error('lost-cancel-ack');},async deleteSession(){deletes++;if(deleteLost)throw Error('lost-delete-ack');return {sessionId:'remote-session',deleted:true,observedAt:1000};},async download(){return new Uint8Array();}};
 const adapter=()=>new OfflineManagedAdapter({mode:'offline',store:new SqlExecutionBindingStore(storage),transport,clock:()=>1000});
 return {store,adapter,setReceipt(v:ManagedReceipt){receipt=v;},get receipt(){return receipt;},lose(){lose=true;},loseDelete(){deleteLost=true;},get creates(){return creates;},get continues(){return continues;},get lookups(){return lookups;},get cancels(){return cancels;},get deletes(){return deletes;}};
}
test('managed delivery loss survives adapter reconstruction and never resubmits input',async t=>{
 const f=fixture(t);f.lose();assert.equal((await f.adapter().accept(input)).execution,'unknown');
 const recovered=await f.adapter().accept(input);assert.equal(recovered.execution,'completed');assert.equal(f.creates,1);assert.equal(f.lookups,1);assert.equal(recovered.nativeFence,null);assert.equal(recovered.checkpoint,'pending');assert.deepEqual(recovered.usage,{status:'unknown',reason:'missing'});
 await assert.rejects(f.adapter().accept({...input,message:'changed'}),/binding-conflict/);assert.equal(f.creates,1);
});
test('binding cannot change backend or provider identity and old generations remain scoped',async t=>{
 const f=fixture(t);await f.adapter().accept(input);const binding=(await f.store.read(identity))!;
 await assert.rejects(f.store.reserve({...binding,backend:'pi',remoteSessionId:null,remoteTurnId:null}),/binding-conflict/);
 await assert.rejects(f.store.attach(identity,{sessionId:'other',turnId:'remote-turn'}),/binding-conflict/);
 f.setReceipt({...f.receipt,identity:{...identity,generation:2,scope:{...identity.scope,workspaceGeneration:2}}});await assert.rejects(f.adapter().observe(identity),/scope-denied/);
});
test('cancel race and remote deletion never manufacture native fencing or settlement',async t=>{
 const f=fixture(t);await f.adapter().accept(input);assert.equal((await f.adapter().cancel(identity)).execution,'completed');assert.equal(f.cancels,1);
 const deleted=await f.adapter().deleteSession(identity);assert.equal(deleted.status,'remote-deleted');assert.equal(deleted.nativeFence,null);
 f.loseDelete();assert.equal((await f.adapter().deleteSession(identity)).status,'pending');
});
test('same-session continuation requires an exact terminal predecessor and original generation',async t=>{
 const f=fixture(t);await f.adapter().accept(input);const previous=(await f.store.read(identity))!;
 const next={...input,identity:{...identity,turnId:'next-turn',dispatchId:'next-dispatch'}};
 f.setReceipt({...f.receipt,phase:'running'});await assert.rejects(f.adapter().accept(next,previous),/not-terminal/);assert.equal(f.continues,0);
 await assert.rejects(f.adapter().accept({...next,identity:{...next.identity,sessionId:'other-local-session'}},previous),/scope-denied/);
});
test('only observable assistant output maps to UI; unknown tools do not become execution proof',async t=>{
 const f=fixture(t);f.setReceipt({...f.receipt,events:[{id:'output',type:'agent.session.turn.output_text.delta',at:1000,payload:{delta:'candidate'}},{id:'tool',type:'unrecognized.tool.event',at:1000,payload:{claimedSkill:'simulation'}}]});
 const result=await f.adapter().accept(input);assert.equal(result.events[0].type,'assistant.delta');assert.deepEqual(result.events[1].payload,{providerEventType:'unrecognized.tool.event',visibility:'unknown'});assert.equal(result.acceptance,'pending');assert.deepEqual((await f.adapter().observe(identity)).events,result.events);
});
test('usage and recovery contracts cannot convert missing usage to zero or remote references to Pi snapshots',()=>{
 for(const value of [null,{}, {input_tokens:-1,output_tokens:1,total_tokens:0},{input_tokens:2,output_tokens:3,total_tokens:6}])assert.equal(usageObservation(value).status,'unknown');
 assert.deepEqual(usageObservation({input_tokens:2,output_tokens:3,total_tokens:5}),{status:'observed',inputTokens:2,outputTokens:3,totalTokens:5,settlement:'pending'});
 const remote=backendState({schemaVersion:1,backend:'managed-agents',recovery:'remote-reference',identity,sessionId:'remote-session',turnId:'remote-turn'});
 assert.equal(recoveryPlan(remote,identity,true).action,'observe-original');assert.equal(recoveryPlan(remote,identity,true).portable,false);
 assert.throws(()=>backendState({schemaVersion:1,backend:'managed-agents',recovery:'full-session',sessionSha256:'a'.repeat(64)}));
 assert.equal(recoveryPlan({schemaVersion:1,backend:'managed-agents',recovery:'files-only'},identity,true).newExecution,true);
 assert.equal(selectProductBackend(),'pi');assert.throws(()=>selectProductBackend('managed-agents'),/route-disabled/);
});
test('same local branch cannot bypass an unknown Turn by silently creating another remote Session',async t=>{
 const f=fixture(t);f.lose();await f.adapter().accept(input);
 const next={...input,identity:{...identity,turnId:'new-turn',dispatchId:'new-dispatch'}};
 await assert.rejects(f.adapter().accept(next),/session-unresolved/);assert.equal(f.creates,1);
 await f.adapter().observe(identity);
 await assert.rejects(f.adapter().accept(next),/session-unresolved/);assert.equal(f.creates,1);
});
