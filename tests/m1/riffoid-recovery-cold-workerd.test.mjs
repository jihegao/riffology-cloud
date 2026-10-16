import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';
import {workspaceAgentName} from '../../services/workspace/protocol.ts';
const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1};
async function savedHistory(legacy){
  let clock=Date.now()+86400000;const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>++clock);
  const session=(await journal.createSession(scope,actor,'saved-session',{title:'Original'})).session,turn=(await journal.submit(scope,actor,session.id,'saved-key',{message:'Saved history'})).turn,claimed=(await journal.claim(scope,1)).turn;
  await journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:claimed.dispatchId,runtimeGeneration:1,outcome:'completed'});
  await journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:claimed.dispatchId,runtimeGeneration:1,checkpoint:{revisionId:'saved-revision',objectKey:'turns/saved.json',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:++clock}});
  const state=store.read();state.schemaVersion=7;delete state.manualOperations;delete state.activeManualOperation;delete state.manualRejections;if(legacy){state.schemaVersion=1;delete state.workspaceHead;for(const row of Object.values(state.sessions))delete row.head;for(const row of Object.values(state.turns))delete row.base;}
  return {state,session,turn};
}
const source=`import {WorkspaceAgent as Production} from './services/workspace/durable.ts';
export class WorkspaceAgent extends Production {
  async seed(state,scope,alarm){await this.ctx.storage.put('m1:workspace:initialization',{task:{id:'original-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:Date.now(),deadlineAt:Date.now()+60000},projection:{outcome:'ready'},projectionConfirmed:true});await this.ctx.storage.put('m2:turn-journal',state);if(alarm!==null){await this.ctx.storage.put('browser-preview:wake-at',alarm);await this.ctx.storage.setAlarm(alarm);}await this.ctx.storage.sync();}
  async records(){return JSON.stringify({kv:Object.fromEntries(await this.ctx.storage.list()),alarm:await this.ctx.storage.getAlarm()});}
  async changes(){return this.ctx.storage.sql.exec('SELECT total_changes() AS n').one().n;}
  async markBeta(turnId){await this.ctx.storage.put('pi-developer-turn:'+turnId,{privateBeta:true});}
  async markG5(turnId){await this.ctx.storage.delete('pi-developer-turn:'+turnId);await this.ctx.storage.put('g5-turn-route:'+turnId,{kind:'g5',taskKey:'original-task',windowId:'original-window'});}
  async deniedManual(input){try{await super.manualSave(input);return 'unexpected-success';}catch(error){return error.message;}}
  async deniedReceipt(input){try{await super.recoveryTurnReceipt(input);return 'unexpected-success';}catch(error){return error.message;}}
}
export default {fetch(){return new Response('offline-fixture');}};`;

for(const legacy of [false,true])test(`cold recovery preserves ${legacy?'legacy v1':'legacy v7'} saved journal/discovery/alarm; normal RPC still performs original maintenance`,{timeout:45000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'riffoid-cold-readonly-')),history=await savedHistory(legacy);
  const code=(await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'cold-recovery-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'})).outputFiles[0].text;
  let outbound=0,mf;const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},resourcePersistencePath:directory,workers:[{config:{type:'worker',name:'recovery-cold',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{WORKSPACE_AGENT:{type:'durable-object',worker:'recovery-cold',exportName:'WorkspaceAgent'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('offline-denied',{status:403});}}}}]};
  const stub=async()=>{const ns=await mf.getDurableObjectNamespace('WORKSPACE_AGENT','recovery-cold');return ns.get(ns.idFromName(workspaceAgentName(scope.tenantId,scope.workspaceId)));};
  try{
    mf=new Miniflare(options);await mf.ready;let target=await stub();const priorAlarm=legacy?Date.now()+2*86400000:null;await target.seed(history.state,scope,priorAlarm);const before=await target.records();assert.ok(await target.changes()>0,'counter observes fixture storage writes');
    await mf.dispose();mf=new Miniflare(options);await mf.ready;target=await stub();
    // First request after an actual runtime restart is the production recovery RPC.
    const snapshot=await target.recoveryTurnSnapshot({scope,actor});assert.equal(snapshot.turns[history.turn.id].status,'completed');
    const receipt=await target.recoveryTurnReceipt({scope,actor,sessionId:history.session.id,key:'saved-key'});assert.equal(receipt.turn.id,history.turn.id);
    for(const denied of [{...actor,userId:'another-user'},{...actor,authVersion:2}])assert.equal(await target.deniedReceipt({scope,actor:denied,sessionId:history.session.id,key:'saved-key'}),'turn-receipt-not-found');
    assert.equal(await target.deniedReceipt({scope,actor,sessionId:history.session.id,key:'another-key'}),'turn-receipt-not-found');
    assert.equal(await target.deniedManual({scope,actor,key:'denied-save',body:{}}),'manual-save-local-only-or-policy-denied');
    assert.equal(await target.records(),before);assert.equal(await target.changes(),0,'cold constructor and both recovery RPCs perform zero SQLite changes');assert.equal(outbound,0);
    const persisted=JSON.parse(before);assert.equal(persisted.kv['m2:turn-journal'].schemaVersion,legacy?1:7);assert.equal(persisted.kv['browser-preview:discovery-index-version'],undefined);
    await target.turnReceipt({scope,actor,sessionId:history.session.id,key:'saved-key'});
    const normal=JSON.parse(await target.records());assert.equal(normal.kv['m2:turn-journal'].schemaVersion,7);assert.equal(normal.kv['browser-preview:discovery-index-version'],1);assert.ok(Object.keys(normal.kv).some(key=>key.startsWith('browser-preview:discovery:')));assert.ok(normal.alarm>Date.now());assert.ok(await target.changes()>0);assert.equal(outbound,0);
    await target.markBeta(history.turn.id);const guarded=await target.records();assert.equal(await target.deniedReceipt({scope,actor,sessionId:history.session.id,key:'saved-key'}),'recovery-authority-unprepared');assert.equal(await target.records(),guarded,'no remote authority initialization or workspace write');
    await target.markG5(history.turn.id);const g5Guarded=await target.records();assert.equal(await target.deniedReceipt({scope,actor,sessionId:history.session.id,key:'saved-key'}),'recovery-authority-unprepared');assert.equal(await target.records(),g5Guarded);assert.equal(outbound,0);
  }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
