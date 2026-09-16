import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const hash=value=>value.toString(16).padStart(64,'0');
const fixtureId='queue-r1-1-create-model';
const source={revisionId:'revision-a',filesSha256:hash(701),specSha256:hash(702)};
const identity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const policy={schemaVersion:1,windowId:'g5-a',phase:'A',principals:[{tenantId:'tenant-a',userId:'user-a'}],profilePin:{provider:'openai',model:'gpt-5.6-luna',profileSha256:hash(801),rateCardSha256:hash(802),inputNanodollarsPerToken:500,outputNanodollarsPerToken:1800},totalNanodollars:20000000000,turnNanodollars:5000000000,maxUpstreamDispatches:147,maxSimulationRuns:39,maxServiceRuns:0,maxTasks:66,durationMs:7200000};

test('two-stage fixture authority persists stage 1, refuses unsupported terminal writes, and binds replay identity across restart',{timeout:45000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-fixture-authority-workerd-'));let mf;
 const bundle=await build({stdin:{contents:`
  import {DurableObject} from 'cloudflare:workers';
  import {G5ControlledWindow as ProductionWindow} from './services/model-budget/g5-window-durable.ts';
  import {G5_GLOBAL_ACTOR} from './services/model-budget/g5-window.ts';
  import {turnDigest} from './services/turn/protocol.ts';
  const SOURCE=${JSON.stringify(source)};
  export class FixtureWindow extends ProductionWindow {
   async inspectTask(input){return {schemaVersion:1,fixtureId:input.fixtureId,workspaceId:input.workspaceId,sessionId:input.sessionId,turnId:input.turnId,revisionId:SOURCE.revisionId,filesSha256:SOURCE.filesSha256,specSha256:SOURCE.specSha256,toolEventIds:['event-a'],provider:{dispatches:1,unknown:0,usageReceiptSha256:'${hash(901)}',moneyReceiptSha256:'${hash(902)}'},ledgers:[],receiptSha256:'${hash(903)}'};}
   fixtureRows(){this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS g5_fixture_authority(fixture_id TEXT PRIMARY KEY, fixture_order INTEGER NOT NULL UNIQUE, state TEXT NOT NULL, stage1_document TEXT NOT NULL, terminal_document TEXT)');return this.ctx.storage.sql.exec('SELECT fixture_id,fixture_order,state,stage1_document,terminal_document FROM g5_fixture_authority ORDER BY fixture_order').toArray();}
   async seedTerminal(input){const result={schemaVersion:2,stage:'terminal',manifestSha256:input.manifestSha256,fixtureId:input.fixtureId,category:'create-model',workspaceId:input.workspaceId,turnId:input.turnId,stage1ReceiptSha256:input.stage1ReceiptSha256,source:input.source,runIds:[...input.runIds].sort(),groupId:input.groupId,claimIds:[...input.claimIds].sort(),predecessorReceiptSha256:null,accepted:true};const receipt={...result,receiptSha256:await turnDigest({result,proof:{testSeed:'persisted-terminal-replay-branch'}})};this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec("UPDATE g5_fixture_authority SET state='terminal',terminal_document=? WHERE fixture_id=?",JSON.stringify(receipt),input.fixtureId));await this.ctx.storage.sync();return receipt;}
  }
  export class WorkspaceFixture extends DurableObject {
   async g5FixtureTerminalAuthority(input){return {runs:input.runIds.map((runId,index)=>({runId,requestKey:'g5-a-${fixtureId}-run-'+(index+1),parameters:{arrival_rate:0.8,customers:40,servers:1,service_rate:1},seed:104729})),group:null};}
  }
  export default {async fetch(request,env){const input=await request.json();try{const stub=env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR),value=await stub[input.method](...(input.args??[]));if(input.loseAck)throw Error('fixture-authority-ack-lost');return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,error:error.message});}}};
 `,resolveDir:process.cwd(),sourcefile:'g5-fixture-authority-workerd.ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
 const options={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:'g5-fixture-authority-test',compatibilityDate:'2026-09-06',manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{G5_CONTROLLED_WINDOW_JSON:{type:'text',value:JSON.stringify(policy)},G5_ADMISSION_ENABLED:{type:'text',value:'true'},G5_WINDOW_GUARD:{type:'durable-object',worker:'g5-fixture-authority-test',exportName:'FixtureWindow'},WORKSPACE_AGENT:{type:'durable-object',worker:'g5-fixture-authority-test',exportName:'WorkspaceFixture'}},exports:{FixtureWindow:{type:'durable-object',storage:'sqlite'},WorkspaceFixture:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('disabled',{status:403})}}}]};
 const rpc=async(method,args=[],loseAck=false)=>{const response=await mf.dispatchFetch('http://g5-fixture-authority.test/',{method:'POST',body:JSON.stringify({method,args,loseAck})}),body=await response.json();if(!body.ok)throw Error(body.error);return body.value;};
 const turnTask={tenantId:'tenant-a',userId:'user-a',kind:'turn',key:hash(1),digest:hash(101)};
 const runTask={tenantId:'tenant-a',userId:'user-a',kind:'simulation',key:hash(2),digest:hash(102),parentTurnKey:turnTask.key};
 const stage1Input={schemaVersion:1,fixtureId,workspaceId:'workspace-a',sessionId:'session-a',turnId:'turn-a',version:source};
 const terminalInput={schemaVersion:1,fixtureId,workspaceId:'workspace-a',turnId:'turn-a',runIds:['run-a'],groupId:null,claimIds:[hash(501)]};
 try{
  mf=new Miniflare(options);await mf.ready;
  await rpc('registerTask',[turnTask]);await rpc('claimTaskCreate',[turnTask.key]);await rpc('bindTask',[turnTask.key,'turn-a']);const turnGrant=await rpc('claimTaskStart',[turnTask.key,identity]);await rpc('confirmTaskStartGrant',[turnTask.key,turnGrant.grantId]);
  await rpc('registerTask',[runTask]);await rpc('claimTaskCreate',[runTask.key]);await rpc('bindTask',[runTask.key,'run-a']);const runGrant=await rpc('claimTaskStart',[runTask.key]);await rpc('confirmTaskStartGrant',[runTask.key,runGrant.grantId]);
  await assert.rejects(rpc('inspectFixtureTask',[stage1Input],true),/fixture-authority-ack-lost/);
  let rows=await rpc('fixtureRows');assert.equal(rows.length,1);assert.equal(rows[0].state,'turn-verified');assert.equal(rows[0].terminal_document,null);
  await mf.dispose();mf=null;mf=new Miniflare(options);await mf.ready;
  const stage1=await rpc('inspectFixtureTask',[stage1Input]);assert.equal(stage1.accepted,true);assert.equal(stage1.source.revisionId,source.revisionId);
  await assert.rejects(rpc('inspectFixtureTask',[{...stage1Input,sessionId:'session-b'}]),/stage1-conflict/);
  await assert.rejects(rpc('inspectFixtureTask',[{...stage1Input,version:{...source,filesSha256:hash(703)}}]),/stage1-conflict/);
  const refused=await rpc('inspectFixtureTerminal',[terminalInput]);assert.equal(refused.accepted,false);assert.ok(refused.unsupportedChecks.length>0);
  rows=await rpc('fixtureRows');assert.equal(rows[0].state,'turn-verified');assert.equal(rows[0].terminal_document,null,'unsupported terminal receipts must not advance durable state');
  await assert.rejects(rpc('inspectFixtureTerminal',[{...terminalInput,workspaceId:'workspace-b'}]),/terminal-conflict/);
  await assert.rejects(rpc('inspectFixtureTerminal',[{...terminalInput,turnId:'turn-b'}]),/terminal-conflict/);
  await mf.dispose();mf=null;mf=new Miniflare(options);await mf.ready;
  assert.deepEqual(await rpc('inspectFixtureTask',[stage1Input]),stage1);
  assert.deepEqual(await rpc('inspectFixtureTerminal',[terminalInput]),refused);
  rows=await rpc('fixtureRows');assert.equal(rows[0].state,'turn-verified');assert.equal(rows[0].terminal_document,null);
  const seeded=await rpc('seedTerminal',[{...terminalInput,manifestSha256:stage1.manifestSha256,stage1ReceiptSha256:stage1.receiptSha256,source:stage1.source}]);
  await mf.dispose();mf=null;mf=new Miniflare(options);await mf.ready;
  assert.deepEqual(await rpc('inspectFixtureTerminal',[terminalInput]),seeded,'persisted terminal receipt replays byte-for-byte after restart');
  await assert.rejects(rpc('inspectFixtureTerminal',[{...terminalInput,runIds:['run-b']}]),/terminal-conflict/);
  await assert.rejects(rpc('inspectFixtureTerminal',[{...terminalInput,claimIds:[hash(502)]}]),/terminal-conflict/);
 }finally{await mf?.dispose();await rm(directory,{recursive:true,force:true});}
});
