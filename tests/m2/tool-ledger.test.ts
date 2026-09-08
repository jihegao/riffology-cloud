import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlToolLedger, toolCommandReference, type ToolEffectReceipt, type ToolLedgerStorage } from '../../services/tools/ledger.ts';
import type { ToolCommand } from '../../services/tools/protocol.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const command=(commandId='command-a',operation:ToolCommand['operation']='write'):ToolCommand=>({schemaVersion:1,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId,deadlineAt:2_000,operation,arguments:operation==='write'?{path:'model/main.py',content:'print(1)'}:operation==='read'?{path:'model/main.py'}:{script:'python model/main.py',timeoutMs:1_000}});
function fixture(t:{after(fn:()=>void):void}){
  const directory=mkdtempSync(join(tmpdir(),'m2-tool-ledger-')),filename=join(directory,'ledger.sqlite');let database=new DatabaseSync(filename),now=1_000,failSync=false,id=0;
  const configure=()=>database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');configure();
  const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(query.includes('CREATE TABLE')){database.exec(query);return {toArray:()=>[]};}const statement=database.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(operation:()=>T):T{database.exec('BEGIN IMMEDIATE');try{const result=operation();database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}},async sync(){if(failSync)throw Error('injected-sync-unknown');}} as unknown as ToolLedgerStorage;
  const host=()=>new SqlToolLedger(storage,()=>now,()=>`effect-${++id}`);
  t.after(()=>{database.close();rmSync(directory,{recursive:true});});
  return {host,storage,get now(){return now;},advance(value:number){now=value;},failSync(value:boolean){failSync=value;},sql(query:string){database.exec(query);},reopen(){database.close();database=new DatabaseSync(filename);configure();}};
}
const receipt=(record:Awaited<ReturnType<SqlToolLedger['lookup']>>,overrides:Partial<ToolEffectReceipt>={}):ToolEffectReceipt=>{
  assert.ok(record?.effectId);return {schemaVersion:1,scope:record.scope,turnId:record.turnId,dispatchId:record.dispatchId,commandId:record.commandId,effectId:record.effectId,phase:'terminal',outcome:'completed',errorCode:null,result:{text:'ok'},observedAt:1_000,...overrides};
};

test('identical command retries replay one durable row and a changed payload conflicts',async t=>{
  const f=fixture(t),h=f.host(),first=await h.accept(command());assert.equal(first.replayed,false);assert.equal((await h.accept(command())).replayed,true);
  await assert.rejects(h.accept({...command(),arguments:{path:'model/main.py',content:'changed'}}),/idempotency-conflict/);assert.equal((await h.lookup('command-a'))?.command?.arguments.content,'print(1)');
});
test('only one active command is admitted for a turn until the first becomes terminal',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());await assert.rejects(h.accept(command('command-b','read')),/active-command/);
  const sent=await h.dispatch('command-a');assert.equal(sent.authorized,true);await h.applyEffect(receipt(sent.record));assert.equal((await h.accept(command('command-b','read'))).replayed,false);
});
test('dispatch authorizes exactly once; a lost response can only observe the same effect id',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());const first=await h.dispatch('command-a');assert.equal(first.authorized,true);assert.ok(first.record.effectId);
  const retry=await h.dispatch('command-a');assert.equal(retry.authorized,false);assert.equal(retry.observeOnly,true);assert.equal(retry.record.effectId,first.record.effectId);
  await h.markUnknown(toolCommandReference(retry.record));const unknown=await h.dispatch('command-a');assert.equal(unknown.authorized,false);assert.equal(unknown.observeOnly,true);assert.equal(unknown.record.status,'unknown');
});
test('deadline expiry before dispatch terminates without creating an effect',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());f.advance(2_001);const result=await h.dispatch('command-a');assert.equal(result.authorized,false);assert.equal(result.observeOnly,false);assert.equal(result.record.status,'failed');assert.equal(result.record.effectId,null);assert.equal(result.record.errorCode,'tool-deadline-expired');assert.equal(result.record.command,null);
});
test('effect receipt must bind scope, turn, dispatch, command and effect before terminal mutation',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());const sent=await h.dispatch('command-a'),valid=receipt(sent.record);
  for(const changed of [{scope:{...scope,workspaceGeneration:2}},{turnId:'turn-other'},{dispatchId:'dispatch-other'},{commandId:'command-other'},{effectId:'effect-other'}])await assert.rejects(h.applyEffect({...valid,...changed}),/scope-denied|not-found/);
  assert.equal((await h.lookup('command-a'))?.status,'dispatched');
});
test('unknown and absent observations never reauthorize; the same terminal receipt is idempotent and a different one conflicts',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());const sent=await h.dispatch('command-a'),unknown=receipt(sent.record,{phase:'absent',outcome:null,errorCode:null,result:null});
  assert.equal((await h.applyEffect(unknown)).status,'unknown');assert.equal((await h.dispatch('command-a')).authorized,false);
  const done=receipt(sent.record,{observedAt:f.now});assert.equal((await h.applyEffect(done)).status,'completed');assert.equal((await h.applyEffect(done)).status,'completed');
  await assert.rejects(h.applyEffect({...done,result:{text:'different'}}),/receipt-conflict/);
});
test('running receipts advance a durable observation timestamp without creating another effect',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());const sent=await h.dispatch('command-a');f.advance(1_100);const running=receipt(sent.record,{phase:'running',outcome:null,errorCode:null,result:null,observedAt:1_050}),record=await h.applyEffect(running);
  assert.equal(record.status,'dispatched');assert.equal(record.lastObservedAt,1_050);assert.equal((await h.dispatch('command-a')).authorized,false);
});
test('terminal rows strip the potentially large command payload and retain bounded result evidence',async t=>{
  const f=fixture(t),h=f.host(),large={...command(),arguments:{path:'model/main.py',content:'x'.repeat(900_000)}};await h.accept(large);const sent=await h.dispatch('command-a');const done=await h.applyEffect(receipt(sent.record));
  assert.equal(done.command,null);assert.deepEqual(done.result,{text:'ok'});assert.equal(done.digest.length,64);
});
test('disk reopen preserves dispatch fencing and terminal receipt',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());const sent=await h.dispatch('command-a');f.reopen();const reopened=f.host();assert.equal((await reopened.dispatch('command-a')).authorized,false);
  await reopened.applyEffect(receipt(await reopened.lookup('command-a')));f.reopen();assert.equal((await f.host().lookup('command-a'))?.status,'completed');
});
test('sync uncertainty cannot replay a committed dispatch and corrupted rows fail closed',async t=>{
  const f=fixture(t),h=f.host();await h.accept(command());f.failSync(true);await assert.rejects(h.dispatch('command-a'),/sync-unknown/);f.failSync(false);f.reopen();assert.equal((await f.host().dispatch('command-a')).authorized,false);
  f.sql("UPDATE tool_commands SET scope_json='{}' WHERE command_id='command-a'");await assert.rejects(f.host().lookup('command-a'),/invalid-persisted-tool-ledger/);
});
