import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';
import { SqlProjectEffectSupervisor, type NativeProjectEffectPort, type ProjectEffectSupervisorStorage } from '../../services/project-tools/supervisor.ts';
import type { ProjectEffectProcessObservation, ProjectEffectStart } from '../../services/project-tools/effect.ts';

const request=(effectId='effect-a'):ProjectEffectStart=>({effectId,program:'/opt/riffology/file_service.py',argv:[],cwd:'/workspace',env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:'/workspace'},stdin:JSON.stringify({deadlineAt:2_000,operation:'write',arguments:{path:'model/a.py',content:'x'}}),timeoutMs:1_000});
const state=(effectId:string,phase:'absent'|'unknown'|'running'='running'):ProjectEffectProcessObservation=>({schemaVersion:1,effectId,phase,exitCode:null,stdout:null,stderr:null});
const exited=(effectId='effect-a'):ProjectEffectProcessObservation=>({schemaVersion:1,effectId,phase:'exited',exitCode:0,stdout:JSON.stringify({ok:true,result:{kind:'write',bytes:1,sha256:'a'.repeat(64)}}),stderr:''});
function fixture(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'m2-project-supervisor-')),file=join(dir,'state.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));let db=new DatabaseSync(file),starts=0,observes=0,startResult:ProjectEffectProcessObservation=state('effect-a'),observeResult:ProjectEffectProcessObservation=state('effect-a'),startError=false,quiescent=true;const configure=()=>db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');configure();const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){}} as unknown as ProjectEffectSupervisorStorage;const native:NativeProjectEffectPort={async sealAndDrain(){if(!quiescent)throw Error('project-effects-not-quiescent');return {schemaVersion:1,sealed:true,quiescent:true,projectUid:10001};},async start(){starts++;if(startError)throw Error('lost-native-start-response');return startResult;},async observe(effectId){observes++;return {...observeResult,effectId};}};const host=()=>new SqlProjectEffectSupervisor(storage,native,()=>1_000);return {host,setQuiescent(v:boolean){quiescent=v;},get starts(){return starts;},get observes(){return observes;},startResult(v:ProjectEffectProcessObservation){startResult=v;},observeResult(v:ProjectEffectProcessObservation){observeResult=v;},startError(v:boolean){startError=v;},sql(query:string){db.exec(query);},reopen(){db.close();db=new DatabaseSync(file);configure();}};}

test('persists preparation before the single native start and replays without starting twice',async t=>{const f=fixture(t);const host=f.host();await host.ready();assert.equal((await host.start(request())).phase,'running');assert.equal(f.starts,1);assert.equal((await host.start(request())).phase,'running');assert.equal(f.starts,1);await assert.rejects(host.start({...request(),stdin:'different'}),/project-effect-idempotency-conflict/);});
test('lost native start response becomes durable unknown and future calls only observe',async t=>{const f=fixture(t);f.startError(true);const host=f.host();await assert.rejects(host.start(request()),/lost-native-start-response/);assert.equal(f.starts,1);f.startError(false);f.observeResult(exited());assert.equal((await host.observe('effect-a')).phase,'exited');assert.equal(f.observes,1);assert.equal((await host.start(request())).phase,'exited');assert.equal(f.starts,1);});
test('exited output survives SQLite reopen and no native observation is required',async t=>{const f=fixture(t);f.startResult(exited());assert.equal((await f.host().start(request())).phase,'exited');f.reopen();const recovered=await f.host().observe('effect-a');assert.equal(recovered.phase,'exited');assert.equal(recovered.stdout,exited().stdout);assert.equal(f.observes,0);});
test('native absent after an authorized preparation is unknown, never replay permission',async t=>{const f=fixture(t);f.startResult(state('effect-a','absent'));const host=f.host();assert.equal((await host.start(request())).phase,'unknown');assert.equal((await host.start(request())).phase,'unknown');assert.equal(f.starts,1);});
test('unknown effect lookup is absent and cannot create a registry row',async t=>{const f=fixture(t);assert.equal((await f.host().observe('missing-effect')).phase,'absent');assert.equal(f.starts,0);assert.equal(f.observes,0);});
test('arbitrary programs, env, argv, paths and oversized stdin fail before persistence or native start',async t=>{const f=fixture(t),host=f.host();for(const changed of [{program:'/bin/sh'},{argv:['x']},{cwd:'/tmp'},{env:{LANG:'x'}},{stdin:'x'.repeat(1_100_001)}])await assert.rejects(host.start({...request(),...changed} as ProjectEffectStart),/invalid-project-effect-start/);assert.equal(f.starts,0);});
test('malformed persisted start payload and digest fail closed before native observation',async t=>{const f=fixture(t),host=f.host();await host.start(request());f.sql("UPDATE project_effects SET start_json='{}' WHERE effect_id='effect-a'");await assert.rejects(host.observe('effect-a'),/invalid-persisted-project-effect/);assert.equal(f.observes,0);f.sql("UPDATE project_effects SET start_json='"+JSON.stringify(request()).replaceAll("'","''")+"',start_digest='broken' WHERE effect_id='effect-a'");await assert.rejects(host.observe('effect-a'),/invalid-persisted-project-effect/);assert.equal(f.observes,0);});

test('checkpoint seal survives SQLite restart and denies every new effect while retaining replay',async t=>{
  const f=fixture(t);f.startResult(exited());const host=f.host();await host.start(request());await host.sealForCheckpoint();
  f.reopen();const recovered=f.host();await recovered.sealForCheckpoint();
  await assert.rejects(recovered.start(request('effect-b')),/project-effects-sealed/);
  assert.deepEqual(await recovered.start(request()),exited());assert.equal(f.starts,1);
});
test('unproven native quiescence rejects checkpoint and keeps the admission fence closed',async t=>{
  const f=fixture(t),host=f.host();await host.start(request());f.setQuiescent(false);
  await assert.rejects(host.sealForCheckpoint(),/project-effects-not-quiescent/);
  await assert.rejects(host.start(request('effect-b')),/project-effects-sealed/);
  f.observeResult(state('effect-a','absent'));await assert.rejects(host.sealForCheckpoint(),/project-effects-not-quiescent/);
  f.observeResult(exited());f.setQuiescent(true);await host.sealForCheckpoint();assert.equal(f.starts,1);
});
test('empty actor seals before a concurrently requested start can reach native execution',async t=>{
  const f=fixture(t),host=f.host();await host.ready();
  const sealing=host.sealForCheckpoint(),starting=host.start(request());
  await sealing;await assert.rejects(starting,/project-effects-sealed/);assert.equal(f.starts,0);
});
test('lost start response cannot be interpreted as a safe checkpoint after restart',async t=>{
  const f=fixture(t);f.startError(true);await assert.rejects(f.host().start(request()),/lost-native-start-response/);
  f.reopen();const host=f.host();f.observeResult(state('effect-a','absent'));f.setQuiescent(false);
  await assert.rejects(host.sealForCheckpoint(),/project-effects-not-quiescent/);
  await assert.rejects(host.start(request('effect-b')),/project-effects-sealed/);assert.equal(f.starts,1);
});

test('process quiescence never fabricates a terminal effect outcome',async t=>{
  const f=fixture(t),host=f.host();f.startError(true);await assert.rejects(host.start(request()),/lost-native-start-response/);
  await host.sealForCheckpoint();assert.equal((await host.start(request())).phase,'unknown');assert.equal(f.starts,1);
  f.reopen();f.setQuiescent(false);await assert.rejects(f.host().sealForCheckpoint(),/project-effects-not-quiescent/);
});
