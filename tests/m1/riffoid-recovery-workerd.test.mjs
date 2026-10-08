import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {workspaceAgentName} from '../../services/workspace/protocol.ts';

test('production WorkspaceAgent recovery RPC reads persisted state without budget/runtime calls or new journal/alarm changes',{timeout:45000},async()=>{
  const source=`import {WorkspaceAgent as Production} from './services/workspace/durable.ts';
  import {TurnJournal} from './services/turn/journal.ts';import {DurableTurnStore} from './services/turn/store.ts';
  export class WorkspaceAgent extends Production {
    async seed(scope,actor){
      await this.ctx.storage.put('m1:workspace:initialization',{task:{id:'fixture-task',tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:scope.workspaceGeneration,starterVersion:'blank-v1',authVersion:1,createdAt:Date.now(),deadlineAt:Date.now()+60000},projection:{outcome:'ready'},projectionConfirmed:true});
      const journal=new TurnJournal(new DurableTurnStore(this.ctx.storage));const session=await journal.createSession(scope,actor,'original-session',{title:'Original'});await journal.submit(scope,actor,session.session.id,'original-key',{message:'Original draft'});return session;
    }
    async deniedReadForTest(input){try{await super.recoveryTurnSnapshot(input);return 'unexpected-success';}catch(error){return error.message;}}
    async records(){return JSON.stringify({kv:Object.fromEntries(await this.ctx.storage.list()),alarm:await this.ctx.storage.getAlarm()});}
  }export default {fetch(){return new Response('local-fixture');}};`;
  const code=(await build({stdin:{contents:source,resolveDir:process.cwd(),sourcefile:'recovery-do-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'})).outputFiles[0].text;
  let outbound=0;const mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},workers:[{config:{type:'worker',name:'recovery-do',compatibilityDate:'2026-09-06',compatibilityFlags:['nodejs_compat','nodejs_compat_do_not_populate_process_env'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env:{WORKSPACE_AGENT:{type:'durable-object',worker:'recovery-do',exportName:'WorkspaceAgent'}},exports:{WorkspaceAgent:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>{outbound++;return new Response('offline-denied',{status:403});}}}}]});
  try{
    await mf.ready;const namespace=await mf.getDurableObjectNamespace('WORKSPACE_AGENT','recovery-do'),scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},actor={userId:'user-a',authVersion:1},stub=namespace.get(namespace.idFromName(workspaceAgentName(scope.tenantId,scope.workspaceId)));
    const seeded=await stub.seed(scope,actor),before=await stub.records(),snapshot=await stub.recoveryTurnSnapshot({scope,actor});
    assert.equal(snapshot.sessions[seeded.session.id].title,'Original');assert.equal(snapshot.activeTurnId,null);assert.equal(Object.values(snapshot.turns)[0].status,'queued');assert.equal(Object.values(snapshot.turns)[0].requestKey,undefined);
    assert.deepEqual(await stub.records(),before);assert.equal(JSON.parse(before).alarm,null);assert.equal(outbound,0);
    assert.equal(await stub.deniedReadForTest({scope:{...scope,projectId:'other'},actor}),'workspace-actor-scope-denied');
  }finally{await mf.dispose();}
});
