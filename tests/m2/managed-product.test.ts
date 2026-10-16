import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {managedCandidateFixture} from './fixtures/managed-candidate.ts';
const scope={tenantId:'tenant-managed',projectId:'project-managed',workspaceId:'workspace-managed',workspaceGeneration:1};
const actor={userId:'test-user',authVersion:1};
const policy={schemaVersion:1,policyId:'additional-production-v1',scope,userId:actor.userId,enabled:true,syntheticOnly:true,maxTurns:6,maxSessions:2,observedStopUsd:5,maxDurationMs:7200000,maxTurnObservationMs:300000,maxSimulationRuns:12};
const input=(number=1,session='local-session',base:unknown={workspace:null,session:null})=>({scope,sessionId:session,turnId:`local-turn-${number}`,dispatchId:`local-dispatch-${number}`,generation:1,actor,message:'Synthetic FCFS only',base,capacityLease:{operationId:`operation-${number}`,leaseId:`lease-${number}`}});
const spec={schemaVersion:1,researchQuestion:'How does service time affect FCFS waiting?',scope:'Synthetic deterministic single-server queue',entities:['customers','server'],mechanisms:['FCFS service'],assumptions:['One server'],parameters:{customers:{type:'integer',default:5,minimum:1,maximum:20},service_time:{type:'integer',default:3,minimum:1,maximum:5}},metrics:{completed:{},mean_wait:{}},limitations:['Synthetic deterministic arrivals'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
const candidate=JSON.stringify({schemaVersion:1,spec,files:{'model/model.py':'def run(config):\n return {"snapshots": []}\n','model/results.json':'[]','app/requirements.lock':'{"schemaVersion":1,"packages":{}}'}});
const workerSource=`
 import {ManagedProductRuntime as BaseManagedProductRuntime} from './services/turn-runtime/managed-product.ts';
 import {managedProductActorName} from './services/workspace/managed-route.ts';
 import {SqlExecutionBindingStore} from './services/turn-runtime/backend-contract.ts';
 import {turnDigest} from './services/turn/protocol.ts';
 import {RevisionStore as BaseRevisionStore} from './services/turn-runtime/revision-store.ts';
 import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';
 import {managedCandidateRecoveryFiles} from './services/turn-runtime/managed-candidate.ts';
 import {TurnDispatcher} from './services/turn/dispatcher.ts';
 import {TurnJournal} from './services/turn/journal.ts';
 import {MemoryTurnStore} from './services/turn/store.ts';
 import {initialCheckpoint} from './services/runtime/starter.ts';
 import {checkpointKey} from './services/runtime/core.ts';
 import {initialWorkspaceReferenceFromReady} from './services/turn-runtime/initial-workspace.ts';
 import {canonicalWorkspaceMarker,workspaceDigest} from './services/workspace/protocol.ts';
 export class RevisionStore extends BaseRevisionStore {async faultObserveForTest(enabled){this.ctx.storage.kv.put("test:observe-fault",enabled);await this.ctx.storage.sync();}async observe(input){if(this.ctx.storage.kv.get("test:observe-fault"))throw Error("synthetic-observe-unavailable");return super.observe(input);}async faultCommitForTest(mode){this.ctx.storage.kv.put('test:commit-fault',mode);await this.ctx.storage.sync();}async commitsForTest(){return this.ctx.storage.kv.get('test:commit-count')??0;}async commit(input){const mode=this.ctx.storage.kv.get('test:commit-fault');this.ctx.storage.kv.delete('test:commit-fault');this.ctx.storage.kv.put('test:commit-count',(this.ctx.storage.kv.get('test:commit-count')??0)+1);await this.ctx.storage.sync();if(mode==='before')throw Error('synthetic-commit-before-write');const result=await super.commit(input);if(mode==='late-accounting')await new Promise(resolve=>setTimeout(resolve,5));if(mode==='after')throw Error('synthetic-commit-lost-ack');return result;}}
 export class ManagedProductRuntime extends BaseManagedProductRuntime {async legacyStopForTest(){const b=this.ctx.storage.kv.get('budget');b.stopped='managed-execution-unknown';this.ctx.storage.kv.put('budget',b);await this.ctx.storage.sync();}async partialClosureForTest(){for(const [key,row]of this.ctx.storage.kv.list({prefix:"turn:"})){if(!row.deletion){row.closed=false;this.ctx.storage.kv.put(key,row);}}await this.ctx.storage.sync();}async tickForTest(){await super.alarm();}async pendingClosedForTest(){for(const [key,row]of this.ctx.storage.kv.list({prefix:"turn:"})){row.receipt=null;row.checkpoint=null;row.closed=true;this.ctx.storage.kv.put(key,row);}await this.ctx.storage.sync();}async seedUnreservedForTest(input,withBinding){const identity={scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation},managedInput={identity,actor:input.actor,message:input.message,base:input.base};this.ctx.storage.kv.put('turn:'+identity.turnId,{input,managedInput,reserved:false,operation:null,observation:null,checkpoint:null,persistenceError:null,closed:false,cleanupRequested:false,cost:null,cancelRequested:false,receipt:null});await this.ctx.storage.sync();if(withBinding)await new SqlExecutionBindingStore(this.ctx.storage).reserve({schemaVersion:1,identity,backend:'managed-agents',inputSha256:await turnDigest(managedInput),reservedAt:Date.now(),remoteSessionId:null,remoteTurnId:null});}async interruptedCleanupForTest(){for(const [key,row]of this.ctx.storage.kv.list({prefix:'turn:'})){row.cleanupRequested=true;this.ctx.storage.kv.put(key,row);}await this.ctx.storage.sync();throw Error('synthetic-cleanup-interrupted');}async expireForTest(){const budget=this.ctx.storage.kv.get('budget');budget.startedAt=Date.now()-7200001;this.ctx.storage.kv.put('budget',budget);await this.ctx.storage.sync();}}
 import {initialWorkspaceArchive} from './services/workspace/initial-archive.ts';
 export default {async fetch(request,env){
  const b=await request.json(),s=b.input?.scope??b.scope,stub=env.MANAGED.getByName(b.wrong?'wrong-actor':managedProductActorName(s));
  try{
   let value;
   if(b.action==='manual-base'){const filesArchive=initialWorkspaceArchive(Object.fromEntries(Object.entries(b.files).map(([p,t])=>[p,new TextEncoder().encode(t)])));value=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).commitManual({identity:{scope:s,actor:b.actor,operationId:b.operationId},base:b.base,inputSha256:'a'.repeat(64),filesArchive,artifacts:[],committedAt:Date.now()});}
   else if(b.action==='blank-initial'){
    const task={id:'initial-task',tenantId:s.tenantId,projectId:s.projectId,workspaceId:s.workspaceId,generation:s.workspaceGeneration,starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:2000};
    const runtime={taskId:task.id,tenantId:s.tenantId,projectId:s.projectId,workspaceId:s.workspaceId,generation:s.workspaceGeneration,runtimeId:'initial-runtime',leaseId:'initial-lease'},markerNonce='initial-nonce';
    const checkpoint=await initialCheckpoint({task,identity:runtime,markerNonce});await env.WORKSPACE_CHECKPOINTS.put(checkpointKey(runtime),checkpoint.text);
    const reference=await initialWorkspaceReferenceFromReady({scope:s,task,runtime,markerNonce,ready:{receiptId:'initial-receipt',initializedAt:1500,layoutVersion:'m1-empty-v1',markerSha256:await workspaceDigest(canonicalWorkspaceMarker(runtime,markerNonce)),checkpointRevision:checkpoint.revision}});
    const resolved=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).resolveInitial(reference,s);
    value={workspace:null,session:null,initial:{reference,filesSha256:resolved.filesSha256}};
   }
   else if(b.action==='dispatch-through-journal'){
    const store=new MemoryTurnStore(),journal=new TurnJournal(store),calls=[];let runtimeReceipt;
    const session=(await journal.createSession(s,b.actor,'pipeline-session',{title:'Managed pipeline'})).session;
    await journal.submit(s,b.actor,session.id,'pipeline-turn',{message:'Synthetic candidate pipeline'});
    // Delay the real commit ACK so ManagedProduct's unmodified report is
    // strictly later than the R2 Revision, independent of millisecond rounding.
    await env.REVISION_STORE.getByName(revisionStoreActorName(s)).faultCommitForTest('late-accounting');
    const runtime={async accept(input){calls.push('accept');runtimeReceipt=await stub.accept(input);return runtimeReceipt;},async observe(input){calls.push('observe');return stub.observe(input);},async cancel(input){calls.push('cancel');return stub.cancel(input);}};
    const dispatcher=new TurnDispatcher(journal,runtime),turn=await dispatcher.tick(s,s.workspaceGeneration),idle=await dispatcher.tick(s,s.workspaceGeneration);
    value={turn,idle,state:store.snapshot(),calls,runtimeReceipt};
   }
   else if(b.action==='legacy-stop')value=await stub.legacyStopForTest();
   else if(b.action==='partial-closure')value=await stub.partialClosureForTest();
   else if(b.action==='alarm')value=await stub.tickForTest();
   else if(b.action==='pending-closed')value=await stub.pendingClosedForTest();
   else if(b.action==='fault-observe')value=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).faultObserveForTest(b.enabled);
   else if(b.action==='accept')value=await stub.accept(b.input);
   else if(b.action==='seed-unreserved')value=await stub.seedUnreservedForTest(b.input,b.withBinding);
   else if(b.action==='observe')value=await stub.observe(b.input);
   else if(b.action==='cancel')value=await stub.cancel(b.input);
   else if(b.action==='recover-delivery')value=await stub.recoverInputDelivery(s,b.actor,b.turnId);
   else if(b.action==='preflight')value=await stub.preflight(s,b.actor);
   else if(b.action==='expire')value=await stub.expireForTest();
   else if(b.action==='interrupt-cleanup')value=await stub.interruptedCleanupForTest();
   else if(b.action==='status')value=await stub.budgetStatus(s);
   else if(b.action==='cleanup')value=await stub.cleanup(s);
   else if(b.action==='simulation')value=await stub.reserveSimulation(s,b.runId);
   else if(b.action==='fault-commit')value=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).faultCommitForTest(b.mode);
   else if(b.action==='commit-count')value=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).commitsForTest();
   else if(b.action==='restore'){const restored=await env.REVISION_STORE.getByName(revisionStoreActorName(s)).restore(b.input,b.receipt);value={backendState:restored.backendState,piSession:restored.piSession,bytes:restored.filesArchive.length,receipt:restored.receipt,files:managedCandidateRecoveryFiles(restored.filesArchive)};}
   else throw Error('unknown-test-action');
   return Response.json({ok:true,value});
  }catch(error){return Response.json({ok:false,error:error.message});}
 }};`;
let bundlePromise:ReturnType<typeof build>|undefined;
async function fixture(testing=false){
 bundlePromise??=build({stdin:{contents:workerSource,sourcefile:'managed-product-test.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const bundle=await bundlePromise,directory=await mkdtemp(join(tmpdir(),'managed-product-'));
 const calls:Array<{method:string;path:string;idempotencyKey:string|null}>=[];const sessions=new Map<string,any>();let inputTokens=100,unknownUsage=false,lostInput=false,lostCreate=false,hideOriginal=false,deleteUnconfirmed=false,deleteFails=false,artifactFails=false,running=false,lostDeleteAck=false,failAbsentReads=false,failReads=false,candidateOutput=candidate,dropInputs=0;
 const handler=async(request:Request)=>{
  assert.equal(new URL(request.url).hostname,'api.openai.com');const path=new URL(request.url).pathname,method=request.method;calls.push({method,path,idempotencyKey:request.headers.get('idempotency-key')});
  const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
  const page=(data:unknown[])=>json({object:'list',data,has_more:false,first_id:null,last_id:null});
  if(failReads&&method==='GET')return json({error:{message:'temporary read outage'}},503);
  const body=method==='POST'?await request.json() as any:null;
  if(path==='/v1/agents/sessions'&&method==='POST'){const session={id:`remote-session-${sessions.size+1}`,metadata:body.metadata,instructions:body.agent.instructions,status:'idle',items:[],turns:[],deleted:false};sessions.set(session.id,session);if(lostCreate)return json({error:{message:'synthetic create reply loss'}},500);return json(session);}
  if(path==='/v1/agents/sessions')return page([...sessions.values()].filter(s=>!s.deleted));
  const id=path.split('/')[4],s=sessions.get(id);if(s?.deleted&&failAbsentReads)return json({error:{message:'synthetic absence probe unavailable'}},500);if(!s||s.deleted)return json({error:{message:'missing'}},404);
  if(path.endsWith('/events')){
   if(body.events[0].type==='agent.session.input.cancel'){for(const turn of s.turns)if(turn.status==='in_progress'){turn.status='cancelled';turn.completed_at=Math.floor(Date.now()/1000);}s.status='idle';return new Response(null,{status:204});}
   if(dropInputs>0){dropInputs--;return json({error:{message:'input delivery unavailable before acceptance'}},503);}
   const turn={id:`remote-turn-${s.turns.length+1}`,session_id:id,subagent_id:null,status:running?'in_progress':'completed',completed_at:running?null:Math.floor(Date.now()/1000),usage:unknownUsage?null:{input_tokens:inputTokens,output_tokens:20,total_tokens:inputTokens+20}};
   s.turns.push(turn);s.status=running?'running':'idle';s.items.push({type:'message',role:'user',turn_id:turn.id,content:body.events[0].input[0].content});
   if(lostInput)return json({error:{message:'synthetic lost reply'}},500);return new Response(null,{status:204});
  }
  if(path.endsWith('/items'))return page(hideOriginal?[]:s.items);
  if(path.endsWith('/turns'))return page(s.turns);
  if(path.includes('/turns/'))return json(s.turns.find((t:any)=>t.id===path.split('/').at(-1)));
  if(artifactFails&&path.includes('/artifacts'))return json({error:{message:'synthetic artifact read failure'}},500);
  if(path.endsWith('/artifacts'))return page(s.turns.map((t:any)=>({id:`artifact-${t.id}`,session_id:id,turn_id:t.id,path:'/workspace/outputs/candidate.json',size_bytes:new TextEncoder().encode(candidateOutput).length})));
  if(path.endsWith('/content'))return new Response(candidateOutput);
  if(path.includes('/artifacts/')){const artifactId=path.split('/').at(-1)!;return json({id:artifactId,session_id:id,turn_id:artifactId.slice('artifact-'.length),path:'/workspace/outputs/candidate.json',size_bytes:new TextEncoder().encode(candidateOutput).length});}
  if(method==='DELETE'){if(deleteFails)return json({error:{message:'synthetic delete transport error'}},500);if(!deleteUnconfirmed)s.deleted=true;if(lostDeleteAck)return json({error:{message:'synthetic delete effect then lost ACK'}},500);return json({id,deleted:true});}
  return json(s);
 };
 const worker='managed-product-test';const options:any={host:'127.0.0.1',port:0,inspectorPort:0,cf:{},resourcePersistencePath:directory,telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-09',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles![0].text}}},env:{MANAGED:{type:'durable-object',worker,exportName:'ManagedProductRuntime'},MANAGED_TURN_RUNTIME:{type:'durable-object',worker,exportName:'ManagedProductRuntime'},REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'managed-checkpoints'},MODEL_CONTENT:{type:'r2',name:'managed-content'},...(testing?{MANAGED_TESTING_JSON:{type:'text',value:JSON.stringify({schemaVersion:2,policyId:'owner-online-test',tenantId:scope.tenantId,userId:actor.userId,enabled:true})}}:{MANAGED_ACCEPTANCE_JSON:{type:'text',value:JSON.stringify(policy)}}),MANAGED_OPENAI_API_KEY:{type:'text',value:'synthetic-key-no-network'}},exports:{ManagedProductRuntime:{type:'durable-object',storage:'sqlite'},RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler}}}]};
 let mf=new Miniflare(options);
 return {calls,sessions,highCost(){inputTokens=2000000;},async call(body:unknown):Promise<any>{const response=await mf.dispatchFetch('http://test/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();},async restart(){await mf.dispose();mf=new Miniflare(options);},async close(){await mf.dispose();await rm(directory,{recursive:true,force:true});},loseDeleteAck(){lostDeleteAck=true;},failAbsence(value=true){failAbsentReads=value;},unknownUsage(){unknownUsage=true;},loseInput(){lostInput=true;},loseCreate(){lostCreate=true;},hideOriginal(){hideOriginal=true;},failReads(value=true){failReads=value;},dropInputs(count=1){dropInputs=count;},setCandidate(value:unknown){candidateOutput=JSON.stringify(value);},invalidCandidate(value=true){candidateOutput=value?JSON.stringify({schemaVersion:1,spec,files:{'model/model.py':'invalid'}}):candidate;},deleteUnconfirmed(){deleteUnconfirmed=true;},failDelete(){deleteFails=true;},failArtifacts(value=true){artifactFails=value;},run(){running=true;}};
}
const posts=(f:Awaited<ReturnType<typeof fixture>>)=>f.calls.filter(c=>c.method==='POST');
for(const version of [1,2] as const)test('Managed Workerd candidate v'+version+' passes its actual late accounting receipt through Dispatcher and Journal',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  if(version===2)f.setCandidate(managedCandidateFixture('airport','javascript-canvas'));
  const result=await f.call({action:'dispatch-through-journal',scope,actor});assert.equal(result.ok,true,JSON.stringify(result));
  const {turn,state,runtimeReceipt,idle,calls}=result.value;assert.equal(turn.status,'completed');assert.equal(turn.persistenceOutcome,'saved');assert.deepEqual(turn.checkpoint,runtimeReceipt.checkpoint);
  assert.deepEqual(state.workspaceHead,turn.checkpoint);assert.deepEqual(state.sessions[turn.sessionId].head,turn.checkpoint);assert.equal(state.activeTurnId,null);assert.equal(state.releaseHold,null);assert.equal(idle,null);assert.deepEqual(calls,['accept']);
  const report=runtimeReceipt.events.at(-1);assert.ok(report.at>turn.checkpoint.committedAt);assert.equal(report.payload.candidateValidation.schemaVersion,version);assert.equal(report.payload.candidateValidation.execution,'not-recomputed');
  assert.deepEqual(state.events.find((event:any)=>event.eventId===report.eventId).payload,report.payload);
  const count=posts(f).length,identity={scope,sessionId:turn.sessionId,turnId:turn.id,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration};await f.restart();
  const observed=await f.call({action:'observe',input:{...identity,capacityLease:turn.resourceLease}});assert.deepEqual(observed.value,runtimeReceipt);assert.equal(posts(f).length,count);
  const restored=await f.call({action:'restore',input:identity,receipt:turn.checkpoint});assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(restored.value.receipt.revisionId,turn.checkpoint.revisionId);
 }finally{await f.close();}
});
test('Managed Workerd saves and restores v2 model/Spec/JS roles, then preserves that view for a legacy continuation',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  const candidate=managedCandidateFixture('airport','javascript-canvas');f.setCandidate(candidate);
  const request=input(),first=await f.call({action:'accept',input:request});assert.ok(first.value?.checkpoint,JSON.stringify(first));
  assert.equal(first.value.events.at(-1).payload.candidateValidation.traceValidation,'validated');
  assert.equal(first.value.events.at(-1).payload.candidateValidation.execution,'not-recomputed');
  const identity={scope,sessionId:request.sessionId,turnId:request.turnId,dispatchId:request.dispatchId,generation:1};
  const restored=await f.call({action:'restore',input:identity,receipt:first.value.checkpoint});
  for(const [path,text]of Object.entries(candidate.files))assert.equal(restored.value.files[path],text);
  assert.deepEqual(JSON.parse(restored.value.files['model/model-spec.json']),candidate.spec);
  await f.call({action:'cleanup',scope});await f.restart();
  const second=await f.call({action:'accept',input:input(2,request.sessionId,{workspace:first.value.checkpoint,session:first.value.checkpoint})});assert.ok(second.value?.checkpoint,JSON.stringify(second));
  const hosted=[...f.sessions.values()][1],context=JSON.parse(hosted.instructions.slice(hosted.instructions.lastIndexOf('\n')+1));
  for(const [path,text]of Object.entries(candidate.files))assert.equal(context.files[path],text);
  assert.deepEqual(JSON.parse(context.files['model/model-spec.json']),candidate.spec);
  assert.equal(context.files['model/run.py'],restored.value.files['model/run.py']);
  f.setCandidate({schemaVersion:1,spec:candidate.spec,files:Object.fromEntries(['model/model.py','model/results.json','app/requirements.lock'].map(path=>[path,candidate.files[path]]))});
  const thirdInput=input(3,request.sessionId,{workspace:second.value.checkpoint,session:second.value.checkpoint});
  const third=await f.call({action:'accept',input:thirdInput});assert.ok(third.value?.checkpoint,JSON.stringify(third));
  assert.equal(third.value.events.at(-1).payload.candidateValidation.traceValidation,'not-provided');
  const thirdIdentity={scope,sessionId:thirdInput.sessionId,turnId:thirdInput.turnId,dispatchId:thirdInput.dispatchId,generation:1};
  const legacy=await f.call({action:'restore',input:thirdIdentity,receipt:third.value.checkpoint});
  for(const path of ['model/visualization.json','frontend/main.mjs','frontend/manifest.json'])assert.equal(legacy.value.files[path],candidate.files[path]);
 }finally{await f.close();}
});
test('Managed Workerd rejects reported airport lane mismatch with a persisted file/frame/field diagnostic and no checkpoint',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  const candidate=managedCandidateFixture('airport','javascript-canvas');candidate.preview.trace.snapshots[1]!.space={type:'lane',lanes:['road']};f.setCandidate(candidate);
  const result=await f.call({action:'accept',input:input()});assert.equal(result.value.phase,'terminal');assert.equal(result.value.checkpoint,null);assert.equal(result.value.persistenceErrorCode,'managed-candidate-invalid');
  assert.deepEqual(result.value.events.at(-1).payload.candidateValidation,{status:'invalid',diagnostic:{file:'candidate.json',path:'preview.trace.snapshots[1].agents[0].lane',reason:'runtime-agent-invalid'}});
  const count=posts(f).length;await f.restart();assert.deepEqual(await f.call({action:'observe',input:input()}),result);assert.equal(posts(f).length,count);assert.equal((await f.call({action:'status',scope})).value.stopped,null);
 }finally{await f.close();}
});
test('Managed Workerd creates one real SDK input, saves R2 files-only Revision, restores and replays after actor restart',{timeout:60000},async()=>{
 const f=await fixture();try{
  const request=input(),result=await f.call({action:'accept',input:request});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.phase,'terminal');assert.ok(result.value.checkpoint,JSON.stringify(result));assert.equal(result.value.stopped.kind,'remote-terminal');assert.equal(result.value.resourceDisposition.status,'released');
  const saved=result.value.checkpoint,identity={scope,sessionId:request.sessionId,turnId:request.turnId,dispatchId:request.dispatchId,generation:1};
  const restored=await f.call({action:'restore',input:identity,receipt:saved});assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(restored.value.backendState.recovery,'files-only');assert.equal(restored.value.piSession,null);assert.ok(restored.value.bytes>0);
  const count=posts(f).length;assert.equal(count,2);await f.restart();assert.deepEqual(await f.call({action:'accept',input:request}),result);assert.equal(posts(f).length,count);
  const next=await f.call({action:'accept',input:input(2,request.sessionId,{workspace:saved,session:saved})});assert.equal(next.ok,true,JSON.stringify(next));assert.ok(next.value.checkpoint);assert.equal(posts(f).length,3);assert.equal(f.sessions.size,1);
  const status=await f.call({action:'status',scope});assert.equal(status.value.turnCount,2);assert.equal(status.value.sessionCount,1);assert.equal(status.value.liveSessions,1);assert.equal(status.value.cleanupPending,false);
  const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.ok,true,JSON.stringify(cleanup));assert.equal(cleanup.value.cleanupPending,false);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 }finally{await f.close();}
});
test('Managed policy rejects wrong user and scope before provider effects',{timeout:60000},async()=>{const f=await fixture();try{
 for(const request of [{...input(),actor:{...actor,userId:'other-user'}},{...input(),scope:{...scope,projectId:'other-project'}}]){const result=await f.call({action:'accept',input:request});assert.equal(result.ok,false);assert.match(result.error,/scope-denied|route-denied/);}
 assert.equal(posts(f).length,0);
}finally{await f.close();}});
test('Managed unknown usage permanently blocks new inputs while allowing verified Session cleanup',{timeout:60000},async()=>{const f=await fixture();try{
 f.unknownUsage();const first=await f.call({action:'accept',input:input()});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.phase,'terminal');const count=posts(f).length;
 const next=await f.call({action:'accept',input:input(2)});assert.equal(next.ok,false,JSON.stringify(next));assert.equal(posts(f).length,count);
 const status=await f.call({action:'status',scope});assert.equal(status.value.stopped,'managed-usage-unknown');assert.equal(status.value.unresolved,1);
 const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.value.cleanupPending,false);assert.equal(cleanup.value.stopped,'managed-usage-unknown');
}finally{await f.close();}});
test('Managed input response loss reconciles exact original without another POST across restart',{timeout:60000},async()=>{const f=await fixture();try{
 f.loseInput();const first=await f.call({action:'accept',input:input()});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.phase,'terminal');assert.equal(posts(f).length,2);await f.restart();assert.deepEqual(await f.call({action:'accept',input:input()}),first);assert.equal(posts(f).length,2);
 await f.call({action:'cleanup',scope});
}finally{await f.close();}});
test('Managed unconfirmed deletion retains cleanup liability and stops new inputs',{timeout:60000},async()=>{const f=await fixture();try{
 await f.call({action:'accept',input:input()});f.deleteUnconfirmed();const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.value.cleanupPending,true);assert.equal(cleanup.value.stopped,'managed-cleanup-unconfirmed');const count=posts(f).length;
 await f.call({action:'accept',input:input(2,'another-session')});assert.equal(posts(f).length,count);
}finally{await f.close();}});

test('Managed project budget cannot be reset by addressing a different actor name',{timeout:60000},async()=>{const f=await fixture();try{
 const result=await f.call({action:'accept',wrong:true,input:input()});assert.equal(result.ok,false);assert.match(result.error,/actor-scope-denied/);assert.equal(posts(f).length,0);
}finally{await f.close();}});
test('Managed continuation binds full latest checkpoint independently of lexical Turn identifiers',{timeout:60000},async()=>{const f=await fixture();try{
 const first=await f.call({action:'accept',input:input(9)});assert.ok(first.value.checkpoint);
 const second=await f.call({action:'accept',input:input(1,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint})});assert.ok(second.value.checkpoint,JSON.stringify(second));
 const count=posts(f).length;
 const stale=await f.call({action:'accept',input:input(2,'local-session',{workspace:second.value.checkpoint,session:first.value.checkpoint})});assert.equal(stale.ok,false);assert.equal(posts(f).length,count);
 const third=await f.call({action:'accept',input:input(3,'local-session',{workspace:second.value.checkpoint,session:second.value.checkpoint})});assert.ok(third.value.checkpoint,JSON.stringify(third));assert.equal(posts(f).length,count+1);await f.call({action:'cleanup',scope});
}finally{await f.close();}});

test('Managed lost provisioning ACK cleans exact idle Session without inventing usage or refunding its reservation',{timeout:60000},async()=>{const f=await fixture();try{
 f.loseCreate();const first=await f.call({action:'accept',input:input()});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.phase,'unknown');assert.equal(posts(f).length,1);
 const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.ok,true,JSON.stringify(cleanup));assert.equal(cleanup.value.cleanupPending,false);assert.equal(cleanup.value.liveSessions,0);assert.equal(cleanup.value.unresolved,1);assert.equal(cleanup.value.reservedUsd,1);assert.equal(cleanup.value.stopped,'managed-execution-unknown');assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 const next=await f.call({action:'accept',input:input(2,'another-session')});assert.equal(next.ok,false);assert.equal(posts(f).length,1);
}finally{await f.close();}});
test('Managed active cancellation reconciles remote outcome and usage before Session deletion',{timeout:60000},async()=>{const f=await fixture();try{
 const first=await f.call({action:'accept',input:input()});assert.ok(first.value.checkpoint);f.run();const second=await f.call({action:'accept',input:input(2,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint})});assert.equal(second.value.phase,'running');
 const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.ok,true,JSON.stringify(cleanup));assert.equal(cleanup.value.liveSessions,0);assert.equal(cleanup.value.unresolved,0);const cancelled=cleanup.value.records.find((r:any)=>r.identity.turnId==='local-turn-2');assert.equal(cancelled.execution,'cancelled');assert.equal(cancelled.usage.status,'observed');assert.equal(cancelled.closed,true);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
}finally{await f.close();}});
test('Managed fixed Turn reservations and formal simulation slots survive actor restart without rollover',{timeout:60000},async()=>{const f=await fixture();try{
 let checkpoint:any=null;
 for(let n=1;n<=6;n++){const r=await f.call({action:'accept',input:input(n,'local-session',{workspace:checkpoint,session:checkpoint})});assert.ok(r.value?.checkpoint,JSON.stringify(r));checkpoint=r.value.checkpoint;}
 const status=await f.call({action:'status',scope});assert.equal(status.value.turnCount,6);assert.equal(status.value.reservedUsd,4.75);const count=posts(f).length;await f.restart();
 const denied=await f.call({action:'accept',input:input(7,'local-session',{workspace:checkpoint,session:checkpoint})});assert.equal(denied.ok,false);assert.equal(denied.error,'managed-turn-limit');assert.equal(posts(f).length,count);
 for(let n=1;n<=12;n++)assert.equal((await f.call({action:'simulation',scope,runId:`run-${n}`})).ok,true);
 assert.equal((await f.call({action:'simulation',scope,runId:'run-1'})).ok,true);assert.equal((await f.call({action:'simulation',scope,runId:'run-13'})).error,'managed-simulation-limit');
 await f.call({action:'cleanup',scope});assert.equal((await f.call({action:'status',scope})).value.reservedUsd,4.75);
}finally{await f.close();}});
test('Managed two Session ceiling counts deleted Sessions and cannot be replenished by cleanup',{timeout:60000},async()=>{const f=await fixture();try{
 let saved:any=null;
 for(let n=1;n<=2;n++){const r=await f.call({action:'accept',input:input(n,`session-${n}`,{workspace:saved,session:null})});assert.ok(r.value?.checkpoint,JSON.stringify(r));saved=r.value.checkpoint;assert.equal((await f.call({action:'cleanup',scope})).value.liveSessions,0);}
 const count=posts(f).length;const denied=await f.call({action:'accept',input:input(3,'session-3',{workspace:saved,session:null})});assert.equal(denied.ok,false);assert.equal(denied.error,'managed-session-limit-or-cleanup-pending');assert.equal(posts(f).length,count);assert.equal(f.sessions.size,2);
 const status=await f.call({action:'status',scope});assert.equal(status.value.sessionCount,2);assert.equal(status.value.turnCount,2);assert.equal(status.value.reservedUsd,2);
}finally{await f.close();}});

test('Managed expired acceptance window permits original observation and cleanup but no fresh model or simulation input',{timeout:60000},async()=>{const f=await fixture();try{
 const first=await f.call({action:'accept',input:input()});assert.ok(first.value.checkpoint);const count=posts(f).length;await f.call({action:'expire',scope});
 assert.equal((await f.call({action:'accept',input:input(2,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint})})).error,'managed-window-expired');
 assert.deepEqual(await f.call({action:'observe',input:input()}),first);assert.equal((await f.call({action:'simulation',scope,runId:'run-expired'})).error,'managed-window-closed');assert.equal(posts(f).length,count);
 const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.value.liveSessions,0);assert.equal(cleanup.value.reservedUsd,1);
}finally{await f.close();}});


test('Managed cleanup transport failure blocks same-session continuation without another provider input',{timeout:60000},async()=>{const f=await fixture();try{
 const first=await f.call({action:'accept',input:input()});assert.ok(first.value.checkpoint);f.failDelete();const cleanup=await f.call({action:'cleanup',scope});assert.equal(cleanup.ok,true);assert.equal(cleanup.value.cleanupPending,true);assert.equal(cleanup.value.stopped,'managed-cleanup-unconfirmed');const count=posts(f).length;
 assert.equal((await f.call({action:'preflight',scope,actor})).ok,false);assert.equal((await f.call({action:'accept',input:input(2,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint})})).ok,false);assert.equal(posts(f).length,count);
}finally{await f.close();}});
test('Managed durable cleanup request blocks continuation after crash even before stopped reason was saved',{timeout:60000},async()=>{const f=await fixture();try{
 const first=await f.call({action:'accept',input:input()});assert.ok(first.value.checkpoint);const interrupted=await f.call({action:'interrupt-cleanup',scope});assert.equal(interrupted.ok,false);await f.restart();const status=await f.call({action:'status',scope});assert.equal(status.value.cleanupPending,true);assert.equal(status.value.stopped,null);const count=posts(f).length;
 const preflight=await f.call({action:'preflight',scope,actor});assert.equal(preflight.ok,false);assert.match(preflight.error,/cleanup/);const next=await f.call({action:'accept',input:input(2,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint})});assert.equal(next.ok,false);assert.equal(posts(f).length,count);
}finally{await f.close();}});


test('Managed lost checkpoint ACK recovers original immutable manifest after restart without provider input or artifact reread',{timeout:60000},async()=>{const f=await fixture();try{
 await f.call({action:'fault-commit',scope,mode:'after'});const first=await f.call({action:'accept',input:input()});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.phase,'running');assert.equal(first.value.checkpoint,null);assert.equal((await f.call({action:'status',scope})).value.stopped,null);const postCount=posts(f).length,artifactReads=f.calls.filter(c=>c.path.includes('/artifacts')).length;assert.equal((await f.call({action:'commit-count',scope})).value,1);
 await f.restart();f.failArtifacts();const recovered=await f.call({action:'observe',input:input()});assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.value.phase,'terminal');assert.ok(recovered.value.checkpoint);assert.equal(posts(f).length,postCount);assert.equal(f.calls.filter(c=>c.path.includes('/artifacts')).length,artifactReads);assert.equal((await f.call({action:'commit-count',scope})).value,1);const replay=await f.call({action:'observe',input:input()});assert.deepEqual(replay,recovered);
}finally{await f.close();}});
test('Managed checkpoint retry reuses frozen first candidate bytes rather than re-downloading mutable provider artifacts',{timeout:60000},async()=>{const f=await fixture();try{
 await f.call({action:'fault-commit',scope,mode:'before'});const first=await f.call({action:'accept',input:input()});assert.equal(first.value.phase,'running');const artifactReads=f.calls.filter(c=>c.path.includes('/artifacts')).length,postCount=posts(f).length;f.failArtifacts();await f.restart();const recovered=await f.call({action:'observe',input:input()});assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.value.phase,'terminal');assert.ok(recovered.value.checkpoint);assert.equal((await f.call({action:'commit-count',scope})).value,2);assert.equal(f.calls.filter(c=>c.path.includes('/artifacts')).length,artifactReads);assert.equal(posts(f).length,postCount);assert.equal((await f.call({action:'status',scope})).value.stopped,null);
}finally{await f.close();}});
test('Managed transient artifact GET failure stays pending and recovers without another paid input',{timeout:60000},async()=>{const f=await fixture();try{
 f.failArtifacts();const first=await f.call({action:'accept',input:input()});assert.equal(first.ok,true,JSON.stringify(first));assert.equal(first.value.phase,'running');assert.equal((await f.call({action:'status',scope})).value.stopped,null);const count=posts(f).length;f.failArtifacts(false);await f.restart();const recovered=await f.call({action:'observe',input:input()});assert.equal(recovered.value.phase,'terminal');assert.ok(recovered.value.checkpoint);assert.equal(posts(f).length,count);
}finally{await f.close();}});

test('Managed runtime absence before accept is an effect-free lease proof and exact original accept remains possible',{timeout:60000},async()=>{const f=await fixture();try{
 const absent=await f.call({action:'observe',input:input()});assert.equal(absent.ok,true,JSON.stringify(absent));assert.equal(absent.value.phase,'absent');assert.equal(absent.value.stopped,null);assert.equal(absent.value.resourceDisposition.status,'released');assert.equal(absent.value.resourceDisposition.operationId,input().capacityLease.operationId);assert.equal(posts(f).length,0);
 const saved=await f.call({action:'accept',input:input()});assert.ok(saved.value.checkpoint,JSON.stringify(saved));assert.equal(posts(f).length,2);await f.call({action:'cleanup',scope});
}finally{await f.close();}});
test('Managed cancel before runtime accept durably tombstones original identity without provisioning or input',{timeout:60000},async()=>{const f=await fixture();try{
 const cancelled=await f.call({action:'cancel',input:input()});assert.equal(cancelled.ok,true);assert.equal(cancelled.value.phase,'absent');assert.equal(cancelled.value.stopped,null);assert.equal(posts(f).length,0);await f.restart();
 assert.deepEqual(await f.call({action:'cancel',input:input()}),cancelled);assert.deepEqual(await f.call({action:'observe',input:input()}),cancelled);
 assert.equal((await f.call({action:'cancel',input:{...input(),dispatchId:'wrong-dispatch'}})).ok,false);assert.equal((await f.call({action:'cancel',input:{...input(),capacityLease:{...input().capacityLease,leaseId:'wrong-lease'}}})).ok,false);
 assert.equal((await f.call({action:'accept',input:input()})).error,'managed-cancelled-before-accept');assert.equal(posts(f).length,0);assert.equal((await f.call({action:'status',scope})).value.turnCount,0);
}finally{await f.close();}});
for(const withBinding of [false,true])test('Managed crash after unreserved '+(withBinding?'binding':'input')+' persistence resumes one exact original only',{timeout:60000},async()=>{const f=await fixture();try{
 await f.call({action:'seed-unreserved',input:input(),withBinding});await f.restart();assert.equal((await f.call({action:'observe',input:input()})).value.phase,'absent');assert.equal(posts(f).length,0);
 assert.equal((await f.call({action:'accept',input:{...input(),message:'changed original'}})).error,'managed-accept-conflict');assert.equal(posts(f).length,0);
 const saved=await f.call({action:'accept',input:input()});assert.ok(saved.value?.checkpoint,JSON.stringify(saved));assert.equal(posts(f).length,2);assert.deepEqual(await f.call({action:'accept',input:input()}),saved);assert.equal(posts(f).length,2);await f.call({action:'cleanup',scope});
}finally{await f.close();}});
for(const withBinding of [false,true])test('Managed Stop fences unreserved '+(withBinding?'binding':'input')+' persistence without starting it',{timeout:60000},async()=>{const f=await fixture();try{
 await f.call({action:'seed-unreserved',input:input(),withBinding});const cancelled=await f.call({action:'cancel',input:input()});assert.equal(cancelled.value.phase,'absent');await f.restart();assert.equal((await f.call({action:'accept',input:input()})).error,'managed-cancelled-before-accept');assert.deepEqual(await f.call({action:'observe',input:input()}),cancelled);assert.equal(posts(f).length,0);
}finally{await f.close();}});

for(const failure of ['artifact','revision-observe'] as const)test(`Managed unknown usage + ${failure} outage retains Session through cleanup and restart`,{timeout:60000},async()=>{
 const f=await fixture();try{
  f.unknownUsage();if(failure==='artifact')f.failArtifacts();else await f.call({action:'fault-observe',scope,enabled:true});
  const result=await f.call({action:'accept',input:input()});assert.equal(result.value.phase,'running');const count=posts(f).length;
  await f.call({action:'alarm',scope});let status=(await f.call({action:'status',scope})).value;
  assert.equal(status.cleanupPending,true);assert.equal(status.liveSessions,1);assert.equal(status.records[0].checkpoint,null);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
  await f.restart();await f.call({action:'alarm',scope});assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);assert.equal(posts(f).length,count);
  f.failArtifacts(false);await f.call({action:'fault-observe',scope,enabled:false});await f.call({action:'alarm',scope});
  status=(await f.call({action:'status',scope})).value;assert.ok(status.records[0].checkpoint);assert.equal(status.records[0].closed,true);assert.equal(status.cleanupPending,false);assert.equal(status.unresolved,1);assert.equal(status.reservedUsd,1);assert.equal(status.stopped,'managed-usage-unknown');assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);assert.equal(posts(f).length,count);
  await f.restart();const saved=await f.call({action:'observe',input:input()});assert.equal(saved.value.phase,'terminal');assert.deepEqual(saved.value.checkpoint,status.records[0].checkpoint);
 }finally{await f.close();}
});
for(const loseAck of [true,false])test(`Managed DELETE effect with ${loseAck?'lost':'received'} ACK and failed absence probe converges across restart`,{timeout:60000},async()=>{
 const f=await fixture();try{
  f.unknownUsage();const saved=await f.call({action:'accept',input:input()});assert.ok(saved.value.checkpoint);const count=posts(f).length;
  if(loseAck)f.loseDeleteAck();f.failAbsence();let status=(await f.call({action:'cleanup',scope})).value;
  assert.equal(status.cleanupPending,true);assert.equal([...f.sessions.values()][0].deleted,true);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
  await f.restart();f.failAbsence(false);await f.call({action:'alarm',scope});status=(await f.call({action:'status',scope})).value;
  assert.equal(status.cleanupPending,false);assert.equal(status.liveSessions,0);assert.equal(status.unresolved,1);assert.equal(status.reservedUsd,1);assert.equal(status.stopped,'managed-usage-unknown');assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);assert.equal(posts(f).length,count);assert.deepEqual(status.records[0].checkpoint,saved.value.checkpoint);
 }finally{await f.close();}
});
test('Managed resource-closed legacy record still reconciles its original durable checkpoint on alarm',{timeout:60000},async()=>{
 const f=await fixture();try{
  const saved=await f.call({action:'accept',input:input()});await f.call({action:'cleanup',scope});const count=posts(f).length;
  await f.call({action:'pending-closed',scope});await f.restart();await f.call({action:'alarm',scope});
  const recovered=await f.call({action:'observe',input:input()});assert.equal(recovered.value.phase,'terminal');assert.deepEqual(recovered.value.checkpoint,saved.value.checkpoint);assert.equal(posts(f).length,count);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 }finally{await f.close();}
});

test('Managed cleanup waits for every Turn sharing the Session and recovers a partially closed legacy sibling',{timeout:60000},async()=>{
 const f=await fixture();try{
  const first=await f.call({action:'accept',input:input()});f.unknownUsage();f.failArtifacts();
  const second=input(2,'local-session',{workspace:first.value.checkpoint,session:first.value.checkpoint});assert.equal((await f.call({action:'accept',input:second})).value.phase,'running');const count=posts(f).length;
  await f.call({action:'cleanup',scope});assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);await f.restart();await f.call({action:'alarm',scope});assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
  f.failArtifacts(false);await f.call({action:'alarm',scope});let status=(await f.call({action:'status',scope})).value;assert.equal(status.records.every((r:any)=>r.closed&&r.checkpoint),true);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
  // Model an older non-atomic closure or interrupted per-row migration: the
  // intent owner is closed, another reference to the same Session is not.
  await f.call({action:'partial-closure',scope});await f.restart();await f.call({action:'alarm',scope});status=(await f.call({action:'status',scope})).value;
  assert.equal(status.records.every((r:any)=>r.closed),true);assert.equal(status.cleanupPending,false);assert.equal(status.liveSessions,0);assert.equal(status.unresolved,1);assert.equal(status.reservedUsd,1.75);assert.equal(posts(f).length,count);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 }finally{await f.close();}
});

test('Account testing removes money, turn, session, simulation and total-duration quotas while preserving accounting',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.highCost();let checkpoint=null;
  for(let i=1;i<=8;i++){
   const result=await f.call({action:'accept',input:input(i,'local-session',{workspace:checkpoint,session:checkpoint})});
   assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.value.checkpoint,JSON.stringify(result));checkpoint=result.value.checkpoint;
   if(i===1)assert.equal((await f.call({action:'expire',scope})).ok,true);
  }
  for(let i=0;i<14;i++)assert.equal((await f.call({action:'simulation',scope,runId:'simulation-'+i})).ok,true);
  assert.equal((await f.call({action:'cleanup',scope})).ok,true);
  for(let i=9;i<=10;i++){
   const result=await f.call({action:'accept',input:input(i,'session-'+i,{workspace:checkpoint,session:null})});assert.equal(result.ok,true,JSON.stringify(result));checkpoint=result.value.checkpoint;
   assert.equal((await f.call({action:'cleanup',scope})).ok,true);
  }
  const status=(await f.call({action:'status',scope})).value;
  assert.equal(status.turnCount,10);assert.equal(status.sessionCount,3);assert.equal(status.simulationCount,14);assert.equal(status.deadline,null);assert.equal(status.stopped,null);assert.ok(status.observedUsd>5);assert.equal(status.policy.observedStopUsd,null);
 }finally{await f.close();}
});
test('Account testing retains unknown usage and recreates a cleaned Session from verified saved files',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.unknownUsage();const request=input(),first=await f.call({action:'accept',input:request});assert.equal(first.ok,true);const count=posts(f).length;
  assert.deepEqual(await f.call({action:'accept',input:request}),first);assert.equal(posts(f).length,count);
  await f.call({action:'cleanup',scope});await f.call({action:'legacy-stop',scope});await f.restart();
  const preflight=await f.call({action:'preflight',scope,actor});assert.equal(preflight.ok,true,JSON.stringify(preflight));assert.equal(posts(f).length,count);
  const state=(await f.call({action:'status',scope})).value;assert.equal(state.stopped,null);assert.equal(state.unresolved,1);assert.equal(state.records[0].cost,null);assert.equal(state.records[0].usage.status,'unknown');assert.equal(state.reservedUsd,1);
  const next=await f.call({action:'accept',input:input(2,request.sessionId,{workspace:first.value.checkpoint,session:first.value.checkpoint})});assert.equal(next.ok,true,JSON.stringify(next));assert.equal(next.value.outcome,'completed');assert.equal(f.sessions.size,2);
  const hosted=[...f.sessions.values()][1];assert.match(hosted.instructions,/def run/);assert.match(hosted.instructions,/Synthetic FCFS only/);assert.match(hosted.instructions,/saved project files/);
  assert.equal((await f.call({action:'status',scope})).value.records[0].cost,null);
  const third=await f.call({action:'accept',input:input(3,request.sessionId,{workspace:next.value.checkpoint,session:next.value.checkpoint})});assert.equal(third.ok,true,JSON.stringify(third));assert.equal(third.value.outcome,'completed');assert.equal(f.sessions.size,2);
 }finally{await f.close();}
});
test('Account testing observes transient read failures without cancelling or replaying original',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.run();f.failReads();const request=input(),first=await f.call({action:'accept',input:request});assert.equal(first.value.phase,'unknown');const count=posts(f).length;
  await f.call({action:'alarm',scope});assert.equal(posts(f).length,count);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
  assert.equal((await f.call({action:'preflight',scope,actor})).ok,false);
  await f.call({action:'legacy-stop',scope});assert.equal((await f.call({action:'preflight',scope,actor})).ok,false);
  f.failReads(false);const observed=await f.call({action:'observe',input:request});assert.equal(observed.value.phase,'running');assert.equal(posts(f).length,count);
 }finally{await f.close();}
});

test('Account testing build format failure retains last good revision and allows a corrected new request',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  const first=await f.call({action:'accept',input:input()});assert.ok(first.value.checkpoint);const base={workspace:first.value.checkpoint,session:first.value.checkpoint};
  f.invalidCandidate();const failed=await f.call({action:'accept',input:input(2,'local-session',base)});assert.equal(failed.value.persistenceErrorCode,'managed-candidate-schema');assert.equal(failed.value.checkpoint,null);assert.equal((await f.call({action:'status',scope})).value.stopped,null);
  await f.call({action:'cleanup',scope});await f.call({action:'legacy-stop',scope});
  assert.equal((await f.call({action:'preflight',scope,actor})).ok,true);
  f.invalidCandidate(false);const fixed=await f.call({action:'accept',input:input(3,'local-session',base)});assert.equal(fixed.ok,true,JSON.stringify(fixed));assert.ok(fixed.value.checkpoint);assert.equal(fixed.value.outcome,'completed');assert.equal(f.sessions.size,2);
 }finally{await f.close();}
});

test('Account testing retries lost delivery with the exact same idempotency key, one reservation and one execution',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.dropInputs();const request=input(),result=await f.call({action:'accept',input:request});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.outcome,'completed');assert.ok(result.value.checkpoint);
  const delivery=f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/events'));assert.equal(delivery.length,2);assert.ok(delivery[0].idempotencyKey);assert.equal(delivery[0].idempotencyKey,delivery[1].idempotencyKey);assert.equal([...f.sessions.values()][0].turns.length,1);assert.equal((await f.call({action:'status',scope})).value.turnCount,1);
  const count=posts(f).length;await f.restart();assert.deepEqual(await f.call({action:'accept',input:request}),result);assert.equal(posts(f).length,count);
 }finally{await f.close();}
});
test('Account testing explicit original-delivery recovery is owner scoped and keeps the original identity',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.dropInputs(8);const request=input(),initial=await f.call({action:'accept',input:request});assert.equal(initial.value.phase,'unknown');await f.call({action:'legacy-stop',scope});const count=posts(f).length;
  assert.equal((await f.call({action:'recover-delivery',scope,actor:{...actor,userId:'wrong'},turnId:request.turnId})).ok,false);assert.equal(posts(f).length,count);
  f.dropInputs(0);const recovered=await f.call({action:'recover-delivery',scope,actor,turnId:request.turnId});assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.value.outcome,'completed');assert.equal(recovered.value.turnId,request.turnId);assert.equal(f.sessions.size,1);assert.equal([...f.sessions.values()][0].turns.length,1);assert.equal((await f.call({action:'status',scope})).value.turnCount,1);
 }finally{await f.close();}
});


test('Managed answer creates no Revision and the next Turn continues the same hosted Session across restart',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.setCandidate({schemaVersion:3,operation:'answer'});
  const first=await f.call({action:'accept',input:input(1)});assert.equal(first.ok,true,JSON.stringify(first));assert.deepEqual(first.value.unchanged,{workspace:null,session:null});assert.equal(first.value.checkpoint,null);assert.equal(first.value.persistenceErrorCode,null);
  assert.equal((await f.call({action:'commit-count',scope})).value,0);
  await f.restart();const again=await f.call({action:'observe',input:input(1)});assert.deepEqual(again.value,first.value);
  const second=await f.call({action:'accept',input:input(2)});assert.equal(second.ok,true,JSON.stringify(second));assert.ok(second.value.unchanged);assert.equal(f.sessions.size,1);
  f.setCandidate(managedCandidateFixture('airport'));const third=await f.call({action:'accept',input:input(3)});assert.equal(third.ok,true,JSON.stringify(third));assert.ok(third.value.checkpoint);assert.equal(f.sessions.size,1);assert.equal((await f.call({action:'commit-count',scope})).value,1);
 }finally{await f.close();}
});
test('Managed design overlay after an answer restores original files after hosted Session cleanup',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.setCandidate(managedCandidateFixture('airport','javascript-canvas'));const first=await f.call({action:'accept',input:input(1)});assert.equal(first.ok,true,JSON.stringify(first));const checkpoint=first.value.checkpoint,base={workspace:checkpoint,session:checkpoint};
  f.setCandidate({schemaVersion:3,operation:'answer'});assert.equal((await f.call({action:'accept',input:input(2,'local-session',base)})).value.checkpoint,null);
  await f.call({action:'cleanup',scope});await f.restart();
  f.setCandidate({schemaVersion:3,operation:'design',artifacts:{schema:'riffology.model-artifacts/v1',files:[{path:'design/architecture.sysml',role:'sysml'}],views:[{id:'sysml',section:'model',title:'SysML',renderer:'source',source:'design/architecture.sysml'}]},files:{'design/architecture.sysml':'part def Crane;'}});
  const nextInput=input(3,'local-session',base),next=await f.call({action:'accept',input:nextInput});assert.equal(next.ok,true,JSON.stringify(next));assert.ok(next.value.checkpoint,JSON.stringify(next));
  const restored=await f.call({action:'restore',input:{scope,sessionId:nextInput.sessionId,turnId:nextInput.turnId,dispatchId:nextInput.dispatchId,generation:1},receipt:next.value.checkpoint});assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(restored.value.files['design/architecture.sysml'],'part def Crane;');assert.equal(restored.value.files['frontend/main.mjs'],managedCandidateFixture('airport','javascript-canvas').files['frontend/main.mjs']);
  assert.equal(f.sessions.size,2);assert.equal((await f.call({action:'commit-count',scope})).value,2);
 }finally{await f.close();}
});


test('Managed answer receipt passes real Dispatcher/Journal with zero Revision commits',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  f.setCandidate({schemaVersion:3,operation:'answer'});const result=await f.call({action:'dispatch-through-journal',scope,actor});assert.equal(result.ok,true,JSON.stringify(result));
  const {turn,state,idle}=result.value;assert.equal(turn.status,'completed');assert.equal(turn.persistenceOutcome,'unchanged');assert.equal(turn.checkpoint,null);assert.equal(state.workspaceHead,null);assert.equal(state.sessions[turn.sessionId].head,null);assert.equal(state.activeTurnId,null);assert.equal(idle,null);assert.equal((await f.call({action:'commit-count',scope})).value,0);
 }finally{await f.close();}
});

test('Managed saves bounded project text and loads each current explicit selection across warm continuation and cold recovery',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  const initial=await f.call({action:'blank-initial',scope});assert.equal(initial.ok,true,JSON.stringify(initial));
  const artifacts={schema:'riffology.model-artifacts/v1',files:[],views:[]};
  const skill=(text:string)=>'---\nname: pages\ndescription: Build project pages\n---\n'+text;
  f.setCandidate({schemaVersion:3,operation:'design',artifacts,files:{
   'AGENTS.md':'CURRENT_PROJECT_AGENT_GUIDANCE',
   '.pi/skills/pages/SKILL.md':skill('SKILL_VERSION_ONE $ARGUMENTS'),
   '.pi/skills/other/SKILL.md':'---\nname: other\ndescription: Other work\n---\nUNSELECTED_BODY_MUST_STAY_PRIVATE',
   '.pi/prompts/report.md':'CURRENT_PROMPT_BODY $@',
  }});
  const firstRequest={...input(1,'local-session',initial.value),message:'Save project instructions.'};
  const first=await f.call({action:'accept',input:firstRequest});assert.ok(first.value?.checkpoint,JSON.stringify(first));
  const checkpoint=first.value.checkpoint,base={workspace:checkpoint,session:checkpoint};
  f.setCandidate({schemaVersion:3,operation:'answer'});f.loseInput();
  const secondRequest={...input(2,'local-session',base),message:'/skill:pages make a blue dashboard',projectResourceText:'CALLER_RESOURCE_OVERRIDE_MUST_NOT_LOAD',projectResources:{scope:{projectId:'other-project'}}};
  const second=await f.call({action:'accept',input:secondRequest});assert.equal(second.value?.phase,'terminal',JSON.stringify(second));
  const session=[...f.sessions.values()][0],secondText=session.items.at(-1).content[0].text;
  assert.match(secondText,/CURRENT_PROJECT_AGENT_GUIDANCE/);assert.match(secondText,/SKILL_VERSION_ONE make a blue dashboard/);
  assert.match(secondText,new RegExp(checkpoint.filesSha256));assert.match(secondText,new RegExp(checkpoint.revisionId));
  assert.doesNotMatch(secondText,/UNSELECTED_BODY_MUST_STAY_PRIVATE|CURRENT_PROMPT_BODY|CALLER_RESOURCE_OVERRIDE_MUST_NOT_LOAD/);
  assert.equal(f.sessions.size,1);const count=posts(f).length;
  await f.restart();assert.deepEqual(await f.call({action:'accept',input:secondRequest}),second);assert.equal(posts(f).length,count);
  f.setCandidate({schemaVersion:3,operation:'design',artifacts,files:{'.pi/skills/pages/SKILL.md':skill('SKILL_VERSION_TWO $ARGUMENTS')}});
  const third=await f.call({action:'accept',input:{...input(3,'local-session',base),message:'Update the pages skill.'}});assert.ok(third.value?.checkpoint,JSON.stringify(third));
  const nextBase={workspace:third.value.checkpoint,session:third.value.checkpoint};
  f.setCandidate({schemaVersion:3,operation:'answer'});
  const fourth=await f.call({action:'accept',input:{...input(4,'local-session',nextBase),message:'/skill:pages fresh task'}});assert.equal(fourth.value?.phase,'terminal',JSON.stringify(fourth));
  const fourthText=session.items.at(-1).content[0].text;assert.match(fourthText,/SKILL_VERSION_TWO fresh task/);assert.doesNotMatch(fourthText,/SKILL_VERSION_ONE|UNSELECTED_BODY_MUST_STAY_PRIVATE/);assert.equal(f.sessions.size,1);
  await f.call({action:'cleanup',scope});await f.restart();const before=posts(f).length;
  const fifth=await f.call({action:'accept',input:{...input(5,'local-session',nextBase),message:'/report cold restore'}});assert.equal(fifth.value?.phase,'terminal',JSON.stringify(fifth));
  assert.equal(posts(f).length,before+2);assert.equal(f.sessions.size,2);
  const restored=[...f.sessions.values()][1],currentText=restored.items[0].content[0].text;
  assert.match(currentText,/CURRENT_PROMPT_BODY cold restore/);assert.match(currentText,/CURRENT_PROJECT_AGENT_GUIDANCE/);
  assert.doesNotMatch(currentText,/SKILL_VERSION_ONE|SKILL_VERSION_TWO|UNSELECTED_BODY_MUST_STAY_PRIVATE/);
  const frozenCount=posts(f).length;await f.restart();assert.deepEqual((await f.call({action:'observe',input:secondRequest})).value,second.value);assert.equal(posts(f).length,frozenCount);
 }finally{await f.close();}
});

test('Managed initial source hash and explicit missing skill fail before any provider reservation or POST',{timeout:60000},async()=>{
 const f=await fixture(true);try{
  const initial=await f.call({action:'blank-initial',scope});assert.equal(initial.ok,true,JSON.stringify(initial));
  const bad={...initial.value,initial:{...initial.value.initial,filesSha256:'f'.repeat(64)}};
  const changed=await f.call({action:'accept',input:input(1,'local-session',bad)});assert.equal(changed.ok,false);assert.match(changed.error,/project-resource-source-mismatch/);assert.equal(posts(f).length,0);
  const missing=await f.call({action:'accept',input:{...input(1,'local-session',initial.value),message:'/skill:missing'}});assert.equal(missing.ok,false);assert.match(missing.error,/managed-resource-command-unknown/);assert.equal(posts(f).length,0);
  assert.equal((await f.call({action:'status',scope})).value.turnCount,0);
 }finally{await f.close();}
});

 test('Managed reads a truthful manual head and frozen resources without a prior synthetic Turn',{timeout:60000},async()=>{const f=await fixture(true);try{const initial=await f.call({action:'blank-initial',scope});assert.equal(initial.ok,true);const manual=await f.call({action:'manual-base',scope,actor,operationId:'manual-authoring',base:{revisionId:null,filesSha256:initial.value.initial.filesSha256,workspaceGeneration:1},files:{'AGENTS.md':'MANUAL_CURRENT_GUIDANCE','.pi/prompts/report.md':'MANUAL_REPORT $ARGUMENTS','docs/manual.txt':'USER_CONTENT'}});assert.equal(manual.ok,true,JSON.stringify(manual));assert.equal(manual.value.source,'manual-save');assert.equal(manual.value.sessionSha256,null);f.setCandidate({schemaVersion:3,operation:'answer'});const response=await f.call({action:'accept',input:{...input(1,'manual-session',{workspace:manual.value,session:null}),message:'/report current manual data'}});assert.equal(response.value?.phase,'terminal',JSON.stringify(response));const session=[...f.sessions.values()][0],text=session.items[0].content[0].text;assert.match(text,/MANUAL_CURRENT_GUIDANCE/);assert.match(text,/MANUAL_REPORT current manual data/);assert.match(text,new RegExp(manual.value.revisionId));assert.equal((await f.call({action:'status',scope})).value.turnCount,1);}finally{await f.close();}});
