import test from 'node:test';
import assert from 'node:assert/strict';
import {runManualSave} from '../../services/workspace/manual-save-operation.ts';
import {TurnJournal} from '../../services/turn/journal.ts';
import {MemoryTurnStore} from '../../services/turn/store.ts';
import {manualDigest,manualSaveRequest,mergeManualArchive} from '../../services/turn-runtime/manual-save.ts';
import {commitManualRevision,inspectManualRevision} from '../../services/turn-runtime/manual-revision.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},actor={userId:'user',authVersion:1};
async function fixture(){
 const store=new MemoryTurnStore(),journal=new TurnJournal(store,()=>1000),objects=new Map<string,Uint8Array>();
 const bucket={async get(key:string){const value=objects.get(key);return value?{size:value.length,arrayBuffer:async()=>Uint8Array.from(value).buffer}:null;},async put(key:string,value:Uint8Array){if(!objects.has(key))objects.set(key,Uint8Array.from(value));return null;}} as unknown as Pick<R2Bucket,'get'|'put'>;
 const archive=initialWorkspaceArchive({'docs/data.json':new TextEncoder().encode('old')}),base={revisionId:null,filesSha256:await manualDigest(archive),workspaceGeneration:1};
 const body=manualSaveRequest({schema:'project.manual-save/v1',base,changes:[{path:'docs/data.json',encoding:'utf8',content:'new'}],deletes:[],artifacts:[{path:'docs/data.json',title:'Data'}]});
 let commits=0,allowed=true,failCommit=false,failReconcile=false;
 const options={journal,scope,actor,key:'same-key',body:body as unknown,authorize:async()=>{if(!allowed)throw Error('access-denied');},
  acquireFence:async()=>({state:'pending' as const}),releaseFence:async(_op:any)=>{},abandonUnacquired:async(_op:any)=>({state:'pending' as 'pending'|'released',terminal:null as {status:string;revisionId:string|null}|null}),
  current:async()=>({base,prepare:async(request:typeof body)=>({filesArchive:mergeManualArchive(archive,request),unchanged:false})}),
  reconcile:async(op:any)=>{if(failReconcile)throw Error('store-unavailable');return(await inspectManualRevision(bucket,op.identity,op.inputSha256))?.receipt??null;},
  commit:async(input:any)=>{commits++;if(failCommit)throw Error('store-unavailable');return commitManualRevision(bucket,input);},
  publish:(op:any,receipt:any,status?:'committed'|'unchanged')=>journal.publishManualSave(scope,actor,op.identity.operationId,receipt,status),
 };
 return {options,journal,store,body,base,objects,get commits(){return commits;},set allowed(v:boolean){allowed=v;},set failCommit(v:boolean){failCommit=v;},set failReconcile(v:boolean){failReconcile=v;}};
}
test('preflight invalid input and stale base return terminal rejection without reserving a new operation',async()=>{
 const f=await fixture();for(const body of [{...f.body,changes:[{path:'../x',encoding:'utf8',content:'x'}]},{...f.body,base:{...f.base,revisionId:'stale'}}]){
  const key='reject-'+await manualDigest(JSON.stringify(body)),r=await runManualSave({...f.options,key,body});assert.equal(r.status,'rejected');assert.equal(f.journal.getManualSave(scope,actor,key),null);assert.equal(f.journal.getManualSaveRejection(scope,actor,key)?.requestSha256,await manualDigest(JSON.stringify(body)));
 }assert.equal(f.commits,0);
 const r=await runManualSave(f.options);assert.equal(r.status,'committed');assert.equal(f.commits,1);
});
test('explicit same-key replay resumes the original pending operation after a confirmed absent immutable receipt',async()=>{
 const f=await fixture();f.failCommit=true;await assert.rejects(runManualSave(f.options),/store-unavailable/);
 const original=f.journal.getManualSave(scope,actor,'same-key');assert.equal(original?.status,'pending');
 f.failCommit=false;const r=await runManualSave(f.options);assert.equal(r.status,'committed');assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.createdAt,original?.createdAt);assert.equal(f.objects.size,2);
 await runManualSave(f.options);assert.equal(f.commits,2);
});
test('lost publish acknowledgement reconciles immutable receipt without writing a second revision',async()=>{
 const f=await fixture();let fail=true;const publish=f.options.publish;
 f.options.publish=async(...args)=>{if(fail){fail=false;throw Error('lost-publish-ack');}return publish(...args);};
 await assert.rejects(runManualSave(f.options),/lost-publish-ack/);assert.equal(f.commits,1);
 assert.equal((await runManualSave(f.options)).status,'committed');assert.equal(f.commits,1);
});
test('reconcile failure and revoked authorization never convert a pending save to rejected',async()=>{
 const f=await fixture();f.failCommit=true;await assert.rejects(runManualSave(f.options));f.failReconcile=true;
 await assert.rejects(runManualSave(f.options),/store-unavailable/);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'pending');
 f.allowed=false;await assert.rejects(runManualSave({...f.options,body:{}}),/access-denied/);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'pending');
});
test('concurrent identical retries serialize through external awaits and commit once',async()=>{
 const f=await fixture();const result=await Promise.all([runManualSave(f.options),runManualSave(f.options)]);assert.deepEqual(result.map(r=>r.status),['committed','committed']);assert.equal(f.commits,1);
});
test('reserved preparation rejection reports the original aborted operation',async()=>{
 const f=await fixture();const r=await runManualSave({...f.options,body:{...f.body,deletes:['missing.txt']}});assert.equal(r.status,'rejected');assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'aborted');assert.equal(f.commits,0);
});
test('unknown writes retain the fence; terminal release ACK can be reconciled without another write',async()=>{
 const f=await fixture();let releases=0,loseRelease=true;f.options.releaseFence=async op=>{assert.notEqual(op.status,'pending');releases++;if(loseRelease)throw Error('release-unknown');};
 f.failCommit=true;await assert.rejects(runManualSave(f.options));assert.equal(releases,0);
 f.failCommit=false;await assert.rejects(runManualSave(f.options),/release-unknown/);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'committed');const writes=f.commits;
 loseRelease=false;assert.equal((await runManualSave(f.options)).status,'committed');assert.equal(f.commits,writes);assert.equal(releases,2);
});
test('released fence with pending journal is quarantined instead of re-executing',async()=>{
 const f=await fixture();f.failCommit=true;await assert.rejects(runManualSave(f.options));f.failCommit=false;
 f.options.acquireFence=async()=>({state:'released' as never});await assert.rejects(runManualSave(f.options),/fence-released-pending/);assert.equal(f.commits,1);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'pending');
});
test('revocation between reservation and acquire releases only a provably unacquired original operation',async()=>{
 const f=await fixture();f.options.acquireFence=async()=>{f.allowed=false;throw Error('access-denied');};
 f.options.abandonUnacquired=async()=>({state:'released',terminal:{status:'aborted',revisionId:null}});
 await assert.rejects(runManualSave(f.options),/access-denied/);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'aborted');assert.equal((await f.journal.snapshot(scope)).activeManualOperation,null);assert.equal(f.commits,0);
});
test('lost acquire ACK with a pending Catalog lease never releases the journal reservation',async()=>{
 const f=await fixture();f.options.acquireFence=async()=>{throw Error('lost-acquire-ack');};
 await assert.rejects(runManualSave(f.options),/lost-acquire-ack/);assert.equal(f.journal.getManualSave(scope,actor,'same-key')?.status,'pending');assert.notEqual((await f.journal.snapshot(scope)).activeManualOperation,null);assert.equal(f.commits,0);
});
test('preflight rejection survives a lost response and journal restart; same key cannot acquire different content',async()=>{
 const f=await fixture(),body={...f.body,changes:[{path:'../bad',encoding:'utf8',content:'private body'}]};
 await runManualSave({...f.options,body});
 const restoredStore=new MemoryTurnStore(),snapshot=f.store.snapshot()!;await restoredStore.transact(()=>({state:snapshot,value:null}));const journal=new TurnJournal(restoredStore,()=>1001);
 const observed=journal.getManualSaveRejection(scope,actor,'same-key');assert.equal(observed?.status,'rejected');assert.equal(JSON.stringify(observed).includes('private body'),false);assert.equal((await journal.snapshot(scope)).activeManualOperation,null);
 const replay=await runManualSave({...f.options,journal,body});assert.equal(replay.status,'rejected');assert.equal(replay.requestSha256,observed?.requestSha256);assert.equal(f.commits,0);
 await assert.rejects(runManualSave({...f.options,journal}),/idempotency-conflict/);assert.throws(()=>journal.getManualSaveRejection(scope,{...actor,authVersion:2},'same-key'),/not-found/);
});
test('cold restore after reserve/revoke repairs the old key without revealing the retired request',async()=>{
 const f=await fixture(),digest=await manualDigest(JSON.stringify(f.body));await f.journal.reserveManualSave(scope,actor,'same-key',f.base,digest,f.base);
 const restoredStore=new MemoryTurnStore();await restoredStore.transact(()=>({state:f.store.snapshot()!,value:null}));const journal=new TurnJournal(restoredStore,()=>1001),currentActor={...actor,authVersion:2};
 const options={...f.options,journal,actor:currentActor,abandonUnacquired:async(op:any)=>{assert.equal(op.identity.actor.authVersion,1);return {state:'released' as const,terminal:{status:'aborted',revisionId:null}};}};
 const result=await runManualSave(options);assert.equal(result.status,'rejected');assert.equal('filesSha256' in result,false);assert.equal('revisionId' in result,false);assert.equal((await journal.snapshot(scope)).activeManualOperation,null);assert.equal(f.commits,0);
 assert.equal((await runManualSave(options)).status,'rejected');assert.throws(()=>journal.getManualSave(scope,currentActor,'same-key'),/not-found/);
});
test('new key after auth restoration repairs only the same user unacquired pending operation',async()=>{
 const f=await fixture(),digest=await manualDigest(JSON.stringify(f.body));await f.journal.reserveManualSave(scope,actor,'old-key',f.base,digest,f.base);
 const currentActor={...actor,authVersion:2};let abandoned=0;const result=await runManualSave({...f.options,key:'new-key',actor:currentActor,abandonUnacquired:async()=>{abandoned++;return {state:'released',terminal:{status:'aborted',revisionId:null}};},publish:(op,receipt,status)=>f.journal.publishManualSave(scope,currentActor,op.identity.operationId,receipt,status)});
 assert.equal(result.status,'committed');assert.equal(abandoned,1);assert.equal(f.journal.getManualSave(scope,actor,'old-key')?.status,'aborted');assert.equal(f.commits,1);
});
test('cold recovery leaves a real pending lease quarantined and does no work before current authorization',async()=>{
 const f=await fixture(),digest=await manualDigest(JSON.stringify(f.body));await f.journal.reserveManualSave(scope,actor,'old-key',f.base,digest,f.base);
 let abandoned=0;const options={...f.options,key:'new-key',actor:{...actor,authVersion:2},abandonUnacquired:async()=>{abandoned++;return {state:'pending' as const,terminal:null};}};
 f.allowed=false;await assert.rejects(runManualSave(options),/access-denied/);assert.equal(abandoned,0);
 f.allowed=true;await assert.rejects(runManualSave(options),/workspace-busy/);assert.equal(abandoned,1);assert.equal(f.journal.getManualSave(scope,actor,'old-key')?.status,'pending');assert.equal(f.commits,0);
});
