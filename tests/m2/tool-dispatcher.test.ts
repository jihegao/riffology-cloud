import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqlToolLedger, type ToolCommandReference, type ToolEffectReceipt, type ToolLedgerStorage } from '../../services/tools/ledger.ts';
import { ToolDispatcher, type ToolEffectPort } from '../../services/tools/dispatcher.ts';
import type { ToolCommand } from '../../services/tools/protocol.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const command:ToolCommand={schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:2_000,operation:'write',arguments:{path:'model/main.py',content:'print(1)'}};
function fixture(){
  const database=new DatabaseSync(':memory:');let now=1_000,effects=0,observations=0,executeError=false,receiptPhase:ToolEffectReceipt['phase']='terminal';
  const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(query.includes('CREATE TABLE')){database.exec(query);return {toArray:()=>[]};}const statement=database.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){database.exec('BEGIN IMMEDIATE');try{const value=fn();database.exec('COMMIT');return value;}catch(error){database.exec('ROLLBACK');throw error;}},async sync(){}} as unknown as ToolLedgerStorage;
  const ledger=new SqlToolLedger(storage,()=>now,()=>`effect-${effects+1}`);
  const proof=(reference:ToolCommandReference):ToolEffectReceipt=>({schemaVersion:1,scope:reference.scope,turnId:reference.turnId,dispatchId:reference.dispatchId,commandId:reference.commandId,effectId:reference.effectId,phase:receiptPhase,outcome:receiptPhase==='terminal'?'completed':null,errorCode:null,result:receiptPhase==='terminal'?{text:'written'}:null,observedAt:now});
  const runtime:ToolEffectPort={async execute(input){effects++;if(executeError)throw Error('lost-project-sandbox-response');return proof({scope:input.command.scope,turnId:input.command.turnId,dispatchId:input.command.dispatchId,commandId:input.command.commandId,digest:'0'.repeat(64),effectId:input.effectId});},async observe(input){observations++;return proof(input.reference);}};
  return {database,ledger,runtime,dispatcher:new ToolDispatcher(ledger,runtime),get effects(){return effects;},get observations(){return observations;},setExecuteError(value:boolean){executeError=value;},setPhase(value:ToolEffectReceipt['phase']){receiptPhase=value;},advance(value:number){now=value;}};
}

test('first durable dispatch executes exactly one effect and persists its terminal receipt',async()=>{
  const f=fixture(),done=await f.dispatcher.run(command);assert.equal(f.effects,1);assert.equal(f.observations,0);assert.equal(done.status,'completed');assert.deepEqual(done.result,{text:'written'});
  const replay=await f.dispatcher.run(command);assert.equal(replay.status,'completed');assert.equal(f.effects,1);assert.equal(f.observations,0);f.database.close();
});
test('lost execute response burns authorization and retry only observes the original effect id',async()=>{
  const f=fixture();f.setExecuteError(true);await assert.rejects(f.dispatcher.run(command),/lost-project-sandbox-response/);assert.equal((await f.ledger.lookup('command-a'))?.status,'unknown');
  f.setExecuteError(false);const done=await f.dispatcher.run(command);assert.equal(done.status,'completed');assert.equal(f.effects,1);assert.equal(f.observations,1);f.database.close();
});
test('an absent execute receipt becomes unknown and can never execute a second time',async()=>{
  const f=fixture();f.setPhase('absent');assert.equal((await f.dispatcher.run(command)).status,'unknown');assert.equal(f.effects,1);
  assert.equal((await f.dispatcher.run(command)).status,'unknown');assert.equal(f.effects,1);assert.equal(f.observations,1);f.database.close();
});
test('deadline expiry before dispatch returns a no-effect failure',async()=>{
  const f=fixture();await f.ledger.accept(command);f.advance(2_001);const done=await f.dispatcher.run(command);assert.equal(done.status,'failed');assert.equal(done.errorCode,'tool-deadline-expired');assert.equal(f.effects,0);f.database.close();
});
test('a mismatched project Sandbox receipt is rejected and the effect remains unknown',async()=>{
  const f=fixture(),runtime:ToolEffectPort={async execute(input){return {schemaVersion:1,scope:{...scope,workspaceGeneration:2},turnId:input.command.turnId,dispatchId:input.command.dispatchId,commandId:input.command.commandId,effectId:input.effectId,phase:'terminal',outcome:'completed',errorCode:null,result:{},observedAt:1_000};},async observe(){throw Error('unused');}},dispatcher=new ToolDispatcher(f.ledger,runtime);
  await assert.rejects(dispatcher.run(command),/scope-denied/);assert.equal((await f.ledger.lookup('command-a'))?.status,'unknown');f.database.close();
});
test('a lost response after terminal ledger commit does not materialize or execute the result again',async()=>{
  const f=fixture();let materializations=0,lost=true;
  const ledger={accept:f.ledger.accept.bind(f.ledger),dispatch:f.ledger.dispatch.bind(f.ledger),markUnknown:f.ledger.markUnknown.bind(f.ledger),async applyEffect(value:unknown){const record=await f.ledger.applyEffect(value);if(lost){lost=false;throw Error('lost-after-ledger-commit');}return record;}};
  const dispatcher=new ToolDispatcher(ledger,f.runtime,{async materialize(receipt){materializations++;return {...receipt,result:{kind:'artifact',artifact:{artifactId:'artifact-a'}}};}});
  await assert.rejects(dispatcher.run(command),/lost-after-ledger-commit/);assert.equal((await f.ledger.lookup(command.commandId))?.status,'completed');assert.equal(f.effects,1);assert.equal(materializations,1);
  const replay=await dispatcher.run(command);assert.equal(replay.status,'completed');assert.equal(f.effects,1);assert.equal(materializations,1);f.database.close();
});

test('settled bridge response observes asynchronous native execution without redispatch',async()=>{
  const f=fixture();f.setPhase('running');let waits=0;
  const done=await f.dispatcher.runUntilSettled(command,{clock:()=>1000,wait:async()=>{waits++;if(waits===3)f.setPhase('terminal');}});
  assert.equal(done.status,'completed');assert.equal(f.effects,1);assert.equal(f.observations,3);f.database.close();
});
test('bounded bridge observation leaves unresolved effects unknown and does not retry transport failure',async()=>{
  const f=fixture();f.setPhase('unknown');let now=1000;
  const result=await f.dispatcher.runUntilSettled(command,{clock:()=>now,wait:async()=>{now=2000;f.advance(now);}});
  assert.equal(result.status,'unknown');assert.equal(f.effects,1);assert.equal(f.observations,1);f.database.close();
  const lost=fixture();lost.setExecuteError(true);await assert.rejects(lost.dispatcher.runUntilSettled(command,{clock:()=>1000}),/lost-project-sandbox-response/);
  assert.equal(lost.effects,1);assert.equal(lost.observations,0);lost.database.close();
});
