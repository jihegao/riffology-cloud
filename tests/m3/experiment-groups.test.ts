import test from 'node:test';
import assert from 'node:assert/strict';
import {experimentGroupRequest} from '../../services/simulation/groups.ts';
import {modelVersion} from '../../services/simulation/source.ts';
import {GROUP_RESERVATION,GROUP_WAKE_KEY} from '../../services/simulation/group-state.ts';
import {SIMULATION_WAKE_KEY,TURN_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';
import {groupFixture,plan,actor,scope} from './group-fixture.ts';

test('group acceptance is atomic across lost acknowledgement/reopen and freezes all child identities without submitting runs',async t=>{
 const f=groupFixture(t);await f.storage.put(TURN_WAKE_KEY,1200);f.loseSync();
 await assert.rejects(f.groups.submit(actor,'key',f.request,plan,'image',()=>true),/lost-storage/);f.reopen();
 const g=await f.groups.submit(actor,'key',f.request,plan,'image',()=>{throw Error('no refreeze');});
 assert.equal(g.children.length,4);assert.equal(new Set(g.children.map(c=>c.runId)).size,4);assert.equal((await f.host.list()).items.length,0);assert.equal(f.starts.length,0);
 assert.equal(await f.storage.get('alarm'),1200);assert.equal(await f.storage.get(SIMULATION_WAKE_KEY),3000);assert.equal(await f.storage.get(GROUP_WAKE_KEY),3000);
 await assert.rejects(f.groups.submit(actor,'key',{...f.request,hypothesis:'Changed'},plan,'image',()=>true),/conflict/);
 await assert.rejects(f.groups.submit({...actor,authVersion:2},'key',f.request,plan,'image',()=>true),/conflict/);
 assert.equal((await f.groups.list(null)).items.length,1);
});

test('validation rejects duplicate/out-of-bounds seeds and configurations before admission',async t=>{
 const f=groupFixture(t);
 for(const request of [{...f.request,seeds:[]},{...f.request,seeds:[1,1]},{...f.request,seeds:[-1]},{...f.request,seeds:Array.from({length:21},(_,i)=>i)},{...f.request,interventions:[]},{...f.request,hypothesis:''},{...f.request,baseline:{...f.request.baseline,parameters:{servers:99}}}])await assert.rejects(f.groups.submit(actor,'bad',request,plan,'image',()=>true));
 assert.throws(()=>experimentGroupRequest({...f.request,extra:1}));
 await assert.rejects(f.groups.submit(actor,'stale',f.request,plan,'image',()=>false),/stale/);
 assert.equal((await f.groups.list(null)).items.length,0);assert.equal((await f.host.list()).items.length,0);
});

test('only one child admitted per group; next deadline begins after release, not group creation; frozen model survives drift',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true);
 await f.groups.alarm();let rows=(await f.host.list()).items;assert.equal(rows.length,1);const first=rows[0]!;assert.equal(first.runId,g.children[0]!.runId);
 await f.tick();f.complete(first.runId);await f.tick();assert.equal((await f.host.get(first.runId)).status,'completed');await f.groups.alarm();assert.equal((await f.host.list()).items.length,1);
 await f.tick();f.q.now+=20000;await f.tick();rows=(await f.host.list()).items;assert.equal(rows.length,2);const next=rows.find(r=>r.runId!==first.runId)!;assert.equal(next.input.deadlineAt,f.q.now+10000);assert.deepEqual(next.input.plan,g.plan);
 const view=await f.groups.view(await f.groups.get(g.groupId),'f'.repeat(64));assert.equal(view.stale,true);assert.deepEqual(view.version,modelVersion(plan));assert.equal(view.progress.completed,1);assert.equal(view.progress.pending,2);
});

test('partial results retain failed runs, missing counts and deterministic available-sample mean differences',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true);await f.groups.alarm();
 for(let i=0;i<g.children.length;i++){
  const child=g.children[i]!;await f.tick();f.complete(child.runId,i===3);await f.tick();await f.tick();await f.tick(101);
 }
 const view=await f.groups.view(await f.groups.get(g.groupId),modelVersion(plan).filesSha256);
 assert.equal(view.status,'partial',JSON.stringify(view.runs));assert.equal(view.progress.completed,3);assert.equal(view.progress.failed,1);assert.equal(view.summary[0]!.metrics.wait!.mean,11.5);assert.deepEqual(view.summary[1]!.metrics.wait,{count:1,missing:1,mean:21,baselineMean:11.5,delta:9.5,errorCode:null});
 assert.equal(view.runs[3]!.result,null);assert.equal(view.runs[3]!.errorCode,'simulation-result-invalid');f.reopen();assert.deepEqual((await f.groups.view(await f.groups.get(g.groupId),null)).summary,view.summary);
 assert.equal(await f.storage.get(SIMULATION_WAKE_KEY),undefined);
});

test('cancellation before admission removes reservations without native touch; cancel active waits for stop and release',async t=>{
 const f=groupFixture(t),first=await f.groups.submit(actor,'before',f.request,plan,'image',()=>true);await f.groups.cancel(first.groupId);await f.tick();
 let view=await f.groups.view(await f.groups.get(first.groupId),null);assert.equal(view.status,'cancelled');assert.equal(view.progress.cancelled,4);assert.equal(f.starts.length,0);assert.equal((await f.host.list()).items.length,0);assert.deepEqual(await f.storage.get(GROUP_RESERVATION+first.groupId),[]);
 const second=await f.groups.submit(actor,'after',f.request,plan,'image',()=>true);await f.groups.alarm();await f.tick();await f.groups.cancel(second.groupId);await f.tick();await f.tick();await f.tick();await f.tick(101);
 view=await f.groups.view(await f.groups.get(second.groupId),null);assert.equal(view.status,'cancelled');assert.equal(view.progress.cancelled,4);assert.equal(f.starts.length,1);assert.equal((await f.host.list()).items.length,1);
});

test('lost native acknowledgement/restart never starts a second child or repeats original execution',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'lost',f.request,plan,'image',()=>true);await f.groups.alarm();f.loseStart();await f.tick();f.reopen();await f.tick();
 assert.equal(f.starts.length,1);assert.equal((await f.host.list()).items.length,1);assert.deepEqual(f.observes,[g.children[0]!.runId]);
 f.complete(g.children[0]!.runId);await f.tick();await f.tick();f.loseRelease();await f.tick(101);assert.equal((await f.host.list()).items.length,1);f.reopen();await f.tick();assert.equal((await f.host.list()).items.length,2);
});

test('capacity remains eight active Runs; grouped children wait durably and gate pause does not discard them',async t=>{
 const f=groupFixture(t);for(let i=0;i<8;i++)await f.host.submit(actor,`legacy-${i}`,{...modelVersion(plan),parameters:{},seed:i},plan,'image',()=>true);
 const g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true);await f.groups.alarm();assert.equal((await f.host.list()).items.length,8);assert.equal((await f.groups.get(g.groupId)).errorCode,'simulation-capacity');
 f.enable(false);const legacy=(await f.host.list()).items[0]!;await f.host.cancel(legacy.runId);await f.host.alarm();await f.groups.alarm();assert.equal((await f.groups.get(g.groupId)).errorCode,'simulation-unavailable');
 f.enable(true);await f.groups.alarm();assert.equal((await f.host.list()).items.length,9);assert.equal((await f.host.get(g.children[0]!.runId)).status,'queued');
});

test('cancel racing first child admission closes transaction before any child creation',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'race',f.request,plan,'image',()=>true);let resolve!:(allowed:boolean)=>void,entered!:()=>void;const reached=new Promise<void>(r=>{entered=r;});f.ports.authorize=()=>{entered();return new Promise(r=>{resolve=r;});};
 const advancing=f.groups.alarm();await reached;await f.groups.cancel(g.groupId);resolve(true);await advancing;await f.groups.alarm();assert.equal((await f.host.list()).items.length,0);assert.equal(f.starts.length,0);assert.equal((await f.groups.get(g.groupId)).status,'cancelled');
});

test('revoked actor cancels pending group; no quota acquisition or native operation',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'revoked',f.request,plan,'image',()=>true);f.authorize(false);await f.groups.alarm();await f.groups.alarm();assert.equal((await f.groups.get(g.groupId)).status,'cancelled');assert.equal((await f.groups.get(g.groupId)).errorCode,'simulation-access-revoked');assert.equal(f.starts.length,0);
});

test('public single-run idempotency key cannot claim a planned group child identity',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true),child=g.children[0]!;
 const legacy=await f.host.submit(actor,`group-${child.runId}`,{...modelVersion(plan),parameters:g.configurations[0]!.parameters,seed:child.seed},plan,'image',()=>true);
 await f.groups.alarm();const grouped=await f.host.get(child.runId);
 assert.notEqual(legacy.runId,child.runId);assert.equal(legacy.experimentId,legacy.runId);assert.equal(grouped.experimentId,g.groupId);assert.equal(grouped.groupId,g.groupId);
 assert.equal((await f.storage.get<string[]>(GROUP_RESERVATION+g.groupId))!.includes(child.runId),false);
 f.reopen();await f.groups.alarm();assert.equal((await f.host.list()).items.length,2);
});

test('group read rejects wrong child association, plan, parameters and seed before calculating findings',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true);await f.groups.alarm();const original=await f.host.get(g.children[0]!.runId);
 for(const changed of [{...original,experimentId:'another'},{...original,scope:{...original.scope,tenantId:'another'}},{...original,input:{...original.input,seed:42}},{...original,input:{...original.input,parameters:{servers:3}}},{...original,input:{...original.input,plan:{...original.input.plan,specSha256:'f'.repeat(64)}}}]){
  await f.storage.put('simulation:run:'+original.runId,changed);await assert.rejects(f.groups.view(g,null),/child-conflict/);
 }
 await f.storage.put('simulation:run:'+original.runId,original);assert.equal((await f.groups.view(g,null)).progress.active,1);
});

test('eighty planned children do not consume eighty active slots or inherit a group-wide deadline',async t=>{
 const f=groupFixture(t),body={...f.request,interventions:[{label:'two',parameters:{servers:2}},{label:'three',parameters:{servers:3}},{label:'four',parameters:{servers:4}}],seeds:Array.from({length:20},(_,i)=>i)};
 const g=await f.groups.submit(actor,'eighty',body,plan,'image',()=>true);assert.equal(g.children.length,80);assert.equal((await f.host.list()).items.length,0);f.q.now+=20000;await f.groups.alarm();const runs=(await f.host.list()).items;assert.equal(runs.length,1);assert.equal(runs[0]!.input.deadlineAt,f.q.now+10000);assert.equal((await f.groups.view(await f.groups.get(g.groupId),null)).progress.pending,79);
});

test('child admission acknowledgement loss reconstructs association without duplicate Run',async t=>{
 const f=groupFixture(t),g=await f.groups.submit(actor,'group',f.request,plan,'image',()=>true);f.loseSync();await f.groups.alarm();f.reopen();await f.groups.alarm();assert.equal((await f.host.list()).items.length,1);assert.equal((await f.host.get(g.children[0]!.runId)).groupId,g.groupId);assert.equal((await f.storage.get<string[]>(GROUP_RESERVATION+g.groupId))!.length,3);
});

test('invited groups enforce eight children before any reservation and cancel pending children when the shared gate stops',async t=>{
 const {ExperimentGroupHost}=await import('../../services/simulation/groups.ts');const f=groupFixture(t);let authorized=true;
 const groups=new ExperimentGroupHost(f.storage,scope,f.host,()=>true,()=>f.q.now,8,async()=>authorized);
 await assert.rejects(groups.submit(actor,'oversized',{...f.request,seeds:[1,2,3,4,5]},plan,'image',()=>true,{kind:'invited-runs',policyId:'runs-v1'}),/invited-runs-group-limit/);
 assert.equal((await f.storage.list({prefix:GROUP_RESERVATION})).size,0);assert.equal((await f.host.list()).items.length,0);
 const group=await groups.submit(actor,'invited',f.request,plan,'image',()=>true,{kind:'invited-runs',policyId:'runs-v1'});assert.equal(group.runAdmission?.kind,'invited-runs');authorized=false;await groups.alarm();await groups.alarm();
 assert.equal((await groups.get(group.groupId)).status,'cancelled');assert.deepEqual(await f.storage.get(GROUP_RESERVATION+group.groupId),[]);assert.equal(f.starts.length,0);
});

test('new invited capability cannot revive planned legacy children under a replacement admission route',async t=>{
 const {ExperimentGroupHost}=await import('../../services/simulation/groups.ts');const f=groupFixture(t);let children=0;f.host.ports.admitRun=async(_actor,_key,_request,_runId,child)=>{children++;assert.equal(child?.runAdmission?.kind,'invited-runs');return child.runAdmission;};
 const groups=new ExperimentGroupHost(f.storage,scope,f.host,()=>true,()=>f.q.now,8,async group=>group.runAdmission?.kind==='invited-runs');
 const legacy=await groups.submit(actor,'old-window',f.request,plan,'image',()=>true);await groups.alarm();assert.equal(children,0);assert.equal((await groups.get(legacy.groupId)).errorCode,'simulation-unavailable');assert.equal((await f.host.list()).items.length,0);
 const invited=await groups.submit(actor,'new-window',f.request,plan,'image',()=>true,{kind:'invited-runs',policyId:'runs-v1'});await groups.alarm();assert.equal(children,1);assert.equal((await f.host.get(invited.children[0].runId)).runAdmission?.kind,'invited-runs');assert.equal((await groups.get(legacy.groupId)).status,'queued');
});
