import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {SqlToolLedger,readExistingToolCommand,toolCommandReference,type ToolLedgerStorage} from '../../services/tools/ledger.ts';
import {readPersistedProjectEffectTerminal,SqlProjectEffectSupervisor,type NativeProjectEffectPort,type ProjectEffectSupervisorStorage} from '../../services/project-tools/supervisor.ts';
import {persistedProjectEffectReceipt,type ProjectEffectProcessObservation} from '../../services/project-tools/effect.ts';
import {productToolCommandId,publicToolReceipt,toolReceiptCallId} from '../../services/tools/receipt.ts';
import type {ToolCommand} from '../../services/tools/protocol.ts';
import {toolCommandDigest} from '../../services/tools/protocol.ts';
import {workspaceToolReceiptAuthority} from '../../services/workspace/tool-receipt.ts';
import {historicalWorkspaceBinding,workspaceBindingToken,workspaceSandboxActor} from '../../services/sandbox/workspace-binding.ts';
import {workspaceBindingStorage} from '../../services/sandbox/workspace-native.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const identity={scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1};
const command=(commandId:string):ToolCommand=>({schemaVersion:1,scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId,deadlineAt:2_000,operation:'bash',arguments:{script:'printf ok',timeoutMs:1_000}});
function sqlite(){
 const db=new DatabaseSync(':memory:');let readOnly=false,writes=0,syncs=0;
 const storage={sql:{exec(query:string,...bindings:(string|number|null)[]){if(readOnly&&!/^SELECT\b/.test(query.trim()))throw Error('readonly-write');if(!/^SELECT\b/.test(query.trim()))writes++;if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query),rows=statement.columns().length?statement.all(...bindings):(statement.run(...bindings),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){if(readOnly)throw Error('readonly-transaction');db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){if(readOnly)throw Error('readonly-sync');syncs++;}};
 return {db,storage:storage as unknown as ToolLedgerStorage&ProjectEffectSupervisorStorage,readonly(){readOnly=true;},writable(){readOnly=false;},counts:()=>({writes,syncs})};
}

test('command id matches the product bridge formula and rejects coercion',async()=>{
 const input={schemaVersion:1,purpose:'product-tool-command',identity,toolCallId:'call-a|part-b',name:'project_bash'},expected=`cmd-${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0,60)}`;
 assert.equal(await productToolCommandId(identity,input.toolCallId,input.name),expected);
 for(const value of [undefined,null,1,{},'bad/value'])assert.throws(()=>toolReceiptCallId(value),/invalid-tool-receipt-call/);
});

test('absent ledger lookup is SELECT-only and does not create schema',()=>{
 const f=sqlite();try{f.readonly();const before=f.counts();assert.equal(readExistingToolCommand(f.storage,'cmd-'+ 'a'.repeat(60)),null);assert.equal(readPersistedProjectEffectTerminal(f.storage,'effect-a'),null);assert.deepEqual(f.counts(),before);assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get()!.n,0);}finally{f.db.close();}
});

test('terminal ledger read and public projection retain bounded result without command payload or effect identity',async()=>{
 const f=sqlite();try{const id=await productToolCommandId(identity,'call-a','project_bash'),ledger=new SqlToolLedger(f.storage,()=>1_000,()=> 'effect-a');await ledger.accept(command(id));const dispatched=await ledger.dispatch(id);await ledger.applyEffect({schemaVersion:1,scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:id,effectId:dispatched.record.effectId!,phase:'terminal',outcome:'completed',errorCode:null,result:{kind:'bash',exitCode:0,stdout:'ok',stderr:'',stdoutTruncated:false,stderrTruncated:false},observedAt:1_000});const before=f.counts();f.readonly();const record=readExistingToolCommand(f.storage,id)!;assert.deepEqual(f.counts(),before);const value=publicToolReceipt({identity,revisionId:'revision-a',toolCallId:'call-a',name:'project_bash',commandId:id,record,effect:null});assert.equal(value.state,'terminal');assert.equal(value.source,'ledger');assert.deepEqual(value.result,{kind:'bash',exitCode:0,stdout:'ok',stderr:'',stdoutTruncated:false,stderrTruncated:false});const text=JSON.stringify(value);for(const secret of ['printf ok','effect-a','arguments','digest','commandId'])assert.equal(text.includes(secret),false);assert.equal(Buffer.byteLength(text)<64*1024,true);}finally{f.db.close();}
});

test('persisted effect reader never calls native and distinguishes nonterminal from exited',async()=>{
 const f=sqlite();let nativeCalls=0;const native:NativeProjectEffectPort={async start(){nativeCalls++;throw Error('native-start');},async observe(){nativeCalls++;throw Error('native-observe');},async sealAndDrain(){nativeCalls++;throw Error('native-seal');}};try{const supervisor=new SqlProjectEffectSupervisor(f.storage,native,()=>1_000);await supervisor.ready();const id=await productToolCommandId(identity,'call-a','project_bash'),cmd=command(id);f.db.prepare("INSERT INTO project_effects VALUES ('effect-a','"+'a'.repeat(64)+"',?,'unknown',NULL,NULL,NULL,1000,1000)").run(JSON.stringify({effectId:'effect-a',program:'/opt/riffology/file_service.py',argv:[],cwd:'/workspace',env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:'/workspace'},stdin:'{}',timeoutMs:1000}));const before=f.counts();f.readonly();assert.equal(readPersistedProjectEffectTerminal(f.storage,'effect-a'),null);assert.deepEqual(f.counts(),before);assert.equal(nativeCalls,0);f.writable();f.db.prepare("UPDATE project_effects SET phase='exited',exit_code=0,stdout=?,stderr='',start_json=NULL WHERE effect_id='effect-a'").run(JSON.stringify({ok:true,result:{kind:'bash',exitCode:0,stdout:'checked',stderr:'',stdoutTruncated:false,stderrTruncated:false}}));f.readonly();const observation=readPersistedProjectEffectTerminal(f.storage,'effect-a')!;assert.equal(nativeCalls,0);const receipt=await persistedProjectEffectReceipt({reference:{scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:id,digest:await toolCommandDigest(cmd),effectId:'effect-a'},command:cmd,observation,observedAt:1_200});assert.equal(receipt.outcome,'completed');assert.equal(receipt.result?.stdout,'checked');}finally{f.db.close();}
});

test('unknown ledger and exited persisted effect remain separately visible',async()=>{
 const id=await productToolCommandId(identity,'call-a','project_bash'),record={schemaVersion:1 as const,scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:id,digest:'a'.repeat(64),deadlineAt:2_000,operation:'bash' as const,status:'unknown' as const,effectId:'effect-a',acceptedAt:1_000,updatedAt:1_100,dispatchedAt:1_010,unknownAt:1_020,finishedAt:null,lastObservedAt:null,outcome:null,errorCode:null,result:null,command:command(id)},effect={schemaVersion:1 as const,scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:id,effectId:'effect-a',phase:'terminal' as const,outcome:'completed' as const,errorCode:null,result:{kind:'bash',exitCode:0,stdout:'ok'},observedAt:1_200};
 const value=publicToolReceipt({identity,revisionId:'revision-a',toolCallId:'call-a',name:'project_bash',commandId:id,record,effect});assert.equal(value.state,'terminal');assert.equal(value.source,'persisted-effect');assert.equal(value.ledger.status,'unknown');assert.equal(value.effect?.outcome,'completed');assert.equal(value.usage,'unknown');
});

test('public receipt omits a large persisted result and keeps the full envelope below 64 KiB',async()=>{
 const id=await productToolCommandId(identity,'call-a','project_bash'),record={schemaVersion:1 as const,scope,turnId:identity.turnId,dispatchId:identity.dispatchId,commandId:id,digest:'a'.repeat(64),deadlineAt:2_000,operation:'bash' as const,status:'completed' as const,effectId:'effect-a',acceptedAt:1_000,updatedAt:1_100,dispatchedAt:1_010,unknownAt:null,finishedAt:1_100,lastObservedAt:1_100,outcome:'completed' as const,errorCode:null,result:{kind:'bash',exitCode:0,stdout:'x'.repeat(60*1024)},command:null};
 const value=publicToolReceipt({identity,revisionId:'revision-a',toolCallId:'call-a',name:'project_bash',commandId:id,record,effect:null});assert.equal(value.result,null);assert.equal(value.resultOmitted,true);assert.ok(value.resultBytes>48*1024);assert.ok(Buffer.byteLength(JSON.stringify(value))<64*1024);
});

test('workspace authority binds owner, terminal saved revision and one conflict-free completion',()=>{
 const actor={userId:'user-a',authVersion:1},checkpoint={revisionId:'revision-a',objectKey:'checkpoints/a',filesSha256:'a'.repeat(64),sessionSha256:'b'.repeat(64),committedAt:1_200},turn={id:'turn-a',sessionId:'session-a',scope,actor,requestKey:'request-a',payloadSha256:'c'.repeat(64),message:'private',status:'completed',createdAt:1_000,updatedAt:1_200,startedAt:1_010,finishedAt:1_200,startedSequence:1,terminalSequence:4,dispatchId:'dispatch-a',runtimeGeneration:1,cancelRequestedAt:null,cancelDisposition:null,base:null,resourceLease:null,executionOutcome:'completed',errorCode:null,persistenceOutcome:'saved',persistenceErrorCode:null,checkpoint},events=[{sequence:1,eventId:'event-start',turnId:'turn-a',workspaceId:'workspace-a',runtimeGeneration:1,type:'tool.started',at:1_050,payload:{toolCallId:'call-a',name:'project_bash'}},{sequence:2,eventId:'event-done',turnId:'turn-a',workspaceId:'workspace-a',runtimeGeneration:1,type:'tool.completed',at:1_100,payload:{toolCallId:'call-a',name:'project_bash',isError:true,artifact:null}}],state={schemaVersion:7,scope,nextSequence:3,oldestSequence:1,retentionBytes:1,activeTurnId:null,workspaceHead:checkpoint,resourceWait:null,releaseHold:null,recoveryHold:null,sessions:{},turns:{'turn-a':turn},sessionIntents:{},turnIntents:{},eventReceipts:{},events} as any;
 assert.equal(workspaceToolReceiptAuthority(state,scope,actor,'turn-a','revision-a','call-a','project_bash').identity.dispatchId,'dispatch-a');
 for(const [changed,label] of [[{actor:{userId:'user-b',authVersion:1}},'owner'],[{revision:'revision-b'},'revision'],[{name:'project_write'},'name'],[{turnId:'turn-b'},'turn']] as const)assert.throws(()=>workspaceToolReceiptAuthority(state,scope,changed.actor??actor,changed.turnId??'turn-a',changed.revision??'revision-a','call-a',changed.name??'project_bash'),/not-found/,label);
 const conflict=structuredClone(state);conflict.events.push({...events[0],sequence:3,eventId:'event-conflict',payload:{toolCallId:'call-a',name:'project_write'}});assert.throws(()=>workspaceToolReceiptAuthority(conflict,scope,actor,'turn-a','revision-a','call-a','project_bash'),/not-found/);
});

test('warm receipt storage is selected only by matching historical binding and epoch',async()=>{
 const f=sqlite(),kv=new Map<string,unknown>(),lease={scope,leaseId:'lease-a',leaseEpoch:1,runtimeVersion:'a'.repeat(64)},binding={lease,identity,bindingEpoch:3,filesSha256:'b'.repeat(64)},actorId=await workspaceSandboxActor(lease,'project'),token=await workspaceBindingToken(binding),storage={...f.storage,kv:{get:(key:string)=>structuredClone(kv.get(key)),put:(key:string,value:unknown)=>kv.set(key,structuredClone(value))}} as unknown as DurableObjectStorage;try{
  kv.set('workspace-binding-history:3',{schemaVersion:1,input:binding,token,status:'sealed',proof:{schemaVersion:1,bindingEpoch:token,status:'quiescent',remaining:0}});assert.equal((await historicalWorkspaceBinding(storage,{identity,lease,bindingEpoch:3},actorId,'project'))?.bindingEpoch,3);await assert.rejects(historicalWorkspaceBinding(storage,{identity:{...identity,turnId:'turn-other'},lease,bindingEpoch:3},actorId,'project'),/history-denied/);
  const warm=workspaceBindingStorage(storage,3),native:NativeProjectEffectPort={async start(){throw Error('native-start');},async observe(){throw Error('native-observe');},async sealAndDrain(){throw Error('native-seal');}},supervisor=new SqlProjectEffectSupervisor(warm,native,()=>1_000);await supervisor.ready();assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='wb_3_project_effects'").get()!.n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='project_effects'").get()!.n,0);
 }finally{f.db.close();}
});
