import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,spec,scope,actor} from './run-fixture.ts';
import {SqlTenantQuota,type LeaseReference} from '../../services/quota/core.ts';
import {ServiceRunCoordinator,type ServiceQuotaPort} from '../../services/run/coordinator.ts';
import {SqlServiceRuntimeSupervisor,type ServiceNativeBackend} from '../../services/run/runtime-supervisor.ts';
import type {ServiceRuntimeInput,ServiceRuntimeObservation} from '../../services/run/runtime-protocol.ts';
function setup(t:Parameters<typeof fixture>[0]){
 const f=fixture(t),journal=f.host(),quota=new SqlTenantQuota(f.storage,{tenantId:scope.tenantId,capacity:1,version:'test-v1'},()=>f.now);
 let starts=0,stops=0,healthy=false,fenced=false,stopUnknown=false,delayStart:Promise<void>|null=null;
 const observation=(input:ServiceRuntimeInput,status:ServiceRuntimeObservation['status']):ServiceRuntimeObservation=>({scope:input.scope,reference:input.reference,status,stop:status==='stopped'?{scope:input.scope,reference:input.reference,confirmationId:'stop-a',observedAt:f.now,fenced:true}:null});
 const backend:ServiceNativeBackend={async start(input){starts++;if(delayStart)await delayStart;if(fenced)return observation(input,'stopped');healthy=true;return observation(input,'healthy');},async observe(input){return observation(input,fenced?'stopped':healthy?'healthy':'absent');},async fenceAndStop(input){stops++;fenced=true;healthy=false;return observation(input,stopUnknown?'unknown':'stopped');},async recoverStop(input){return observation(input,fenced&&!stopUnknown?'stopped':'unknown');}};
 let releases=0;const runtime=new SqlServiceRuntimeSupervisor(f.storage,scope,backend,()=>f.now,async()=>{releases++;});
 let lostAcquire=false,lostDispatch=false,lostRelease=false;
 const ports:ServiceQuotaPort={lookup:op=>quota.lookup(op),async acquire(request){const result=await quota.acquire(request);if(lostAcquire){lostAcquire=false;throw Error('lost-acquire');}return result;},async dispatch(ref){const result=await quota.dispatch(ref);if(lostDispatch){lostDispatch=false;throw Error('lost-dispatch');}return result;},markUnknown:ref=>quota.markUnknown(ref),async confirmStopped(ref,proof){const result=await quota.confirmStopped(ref,proof);if(lostRelease){lostRelease=false;throw Error('lost-release');}return result;}};
 const hold=(p:Promise<unknown>)=>{void p;};
 return {f,journal,quota,backend,runtime,ports,coordinator:()=>new ServiceRunCoordinator(f.storage,journal,ports,runtime,hold,()=>f.now,20),get starts(){return starts;},get stops(){return stops;},get releases(){return releases;},get healthy(){return healthy;},set lostAcquire(v:boolean){lostAcquire=v;},set lostDispatch(v:boolean){lostDispatch=v;},set lostRelease(v:boolean){lostRelease=v;},set stopUnknown(v:boolean){stopUnknown=v;},set delayStart(v:Promise<void>|null){delayStart=v;}};
}
test('real SQLite journal and tenant quota coordinate one start and release only after fenced stop',async t=>{
 const x=setup(t),c=x.coordinator(),run=await x.journal.create(actor,'request-a',spec());
 assert.equal((await c.reconcile(run.id)).status,'running');assert.equal(x.starts,1);assert.equal((await x.quota.snapshot()).occupied,1);
 assert.equal((await c.reconcile(run.id)).status,'running');assert.equal(x.starts,1);
 x.stopUnknown=true;assert.equal((await c.requestStop(run.id)).status,'stopping');assert.equal((await x.quota.snapshot()).occupied,1);
 x.stopUnknown=false;assert.equal((await c.reconcile(run.id)).status,'stopped');assert.equal((await x.quota.snapshot()).occupied,0);assert.equal((await c.state(run.id))?.released,true);
 assert.equal((await x.coordinator().reconcile(run.id)).status,'stopped');assert.equal(x.starts,1);
});
test('acquisition and release acknowledgement loss reconcile the same persisted operation',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec()),c=x.coordinator();x.lostAcquire=true;
 assert.equal((await c.reconcile(run.id)).status,'queued');assert.equal((await x.quota.snapshot()).occupied,1);
 assert.equal((await x.coordinator().reconcile(run.id)).status,'running');assert.equal(x.starts,1);
 x.lostRelease=true;assert.equal((await c.requestStop(run.id)).status,'stopped');assert.equal((await c.state(run.id))?.released,false);assert.equal((await x.quota.snapshot()).occupied,0);
 await x.coordinator().reconcile(run.id);assert.equal((await c.state(run.id))?.released,true);
});
test('saved stop proof re-enters only runtime teardown reconciliation',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec()),c=x.coordinator();await c.reconcile(run.id);
 assert.equal((await c.requestStop(run.id)).status,'stopped');assert.equal(x.stops,1);assert.equal(x.releases,1);
 assert.equal((await x.coordinator().reconcile(run.id)).status,'stopped');assert.equal(x.stops,1,'native stop receipt is not replayed');assert.equal(x.releases,2,'saved receipt retries teardown release');
});
test('lost dispatch acknowledgement cannot cause a second dispatch or early quota release',async t=>{
 const x=setup(t),c=x.coordinator(),run=await x.journal.create(actor,'request-a',spec());x.lostDispatch=true;
 assert.equal((await c.reconcile(run.id)).status,'unknown');assert.equal(x.starts,0);assert.equal((await x.quota.snapshot()).occupied,1);
 await x.coordinator().reconcile(run.id);assert.equal(x.starts,0);
 assert.equal((await c.requestStop(run.id)).status,'stopped');assert.equal((await x.quota.snapshot()).occupied,0);
});
test('a timed-out in-flight start cannot resurrect after confirmed stop',async t=>{
 const x=setup(t),c=x.coordinator(),run=await x.journal.create(actor,'request-a',spec());let resume!:()=>void;x.delayStart=new Promise<void>(resolve=>resume=resolve);
 assert.equal((await c.reconcile(run.id)).status,'unknown');assert.equal(x.starts,1);
 assert.equal((await c.requestStop(run.id)).status,'stopped');assert.equal((await x.quota.snapshot()).occupied,0);
 resume();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(x.healthy,false);assert.equal((await c.reconcile(run.id)).status,'stopped');assert.equal(x.starts,1);
});
test('quota denial fails before runtime allocation and concurrent ticks do not repeat start',async t=>{
 const x=setup(t),c=x.coordinator();await x.quota.acquire({tenantId:scope.tenantId,projectId:'other-project',workspaceId:'other-workspace',generation:1,operation:'workspace-runtime',operationId:'other-operation',deadlineAt:6000});
 const run=await x.journal.create(actor,'request-a',spec());assert.equal((await c.reconcile(run.id)).status,'failed');assert.equal(x.starts,0);
});
test('parallel coordinator instances share the durable start fence',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec());await Promise.all([x.coordinator().reconcile(run.id),x.coordinator().reconcile(run.id)]);
 assert.equal(x.starts,1);assert.equal((await x.coordinator().reconcile(run.id)).status,'running');assert.equal((await x.quota.snapshot()).occupied,1);
});
test('cancel before any coordination makes no quota or runtime calls',async t=>{
 const x=setup(t),c=x.coordinator(),run=await x.journal.create(actor,'request-a',spec());assert.equal((await c.requestStop(run.id)).status,'cancelled');assert.equal(await c.state(run.id),null);assert.equal(x.starts,0);assert.equal((await x.quota.snapshot()).occupied,0);
});
test('stopped receipt for another lease cannot release the real occupied slot',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec()),runtime={...x.runtime,start:x.runtime.start.bind(x.runtime),observe:x.runtime.observe.bind(x.runtime),async stop(input:ServiceRuntimeInput){return {reference:{...input.reference,leaseId:'wrong'},scope:input.scope,status:'stopped' as const,stop:null};}};
 const c=new ServiceRunCoordinator(x.f.storage,x.journal,x.ports,runtime,()=>{},()=>x.f.now,20);await c.reconcile(run.id);assert.equal((await c.requestStop(run.id)).status,'stopping');assert.equal((await x.quota.snapshot()).occupied,1);
});
test('stale pre-acquisition stop proof is not cached and a later valid proof can release quota',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec());let stopAt=1500;
 const ports={...x.ports,async acquire(request:Parameters<ServiceQuotaPort['acquire']>[0]){x.f.now=2000;await x.quota.acquire(request);throw Error('lost-ack');}};
 const runtime={start:x.runtime.start.bind(x.runtime),observe:x.runtime.observe.bind(x.runtime),async stop(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{return {scope:input.scope,reference:input.reference,status:'stopped',stop:{scope:input.scope,reference:input.reference,confirmationId:'stop-valid',observedAt:stopAt,fenced:true}};}};
 const c=new ServiceRunCoordinator(x.f.storage,x.journal,ports,runtime,()=>{},()=>x.f.now,20);await c.reconcile(run.id);x.f.now=3000;
 assert.equal((await c.requestStop(run.id)).status,'cancelled');assert.equal((await c.state(run.id))?.stop,null);assert.equal((await x.quota.snapshot()).occupied,1);
 stopAt=3000;await c.reconcile(run.id);assert.equal((await x.quota.snapshot()).occupied,0);assert.equal((await c.state(run.id))?.released,true);
});
test('runtime input mutation cannot change the expected immutable identity or pinned plan',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec());
 const runtime={async start(input:ServiceRuntimeInput){input.reference.leaseId='wrong';input.spec.plan.declaration.entrypoint='app/changed.py';return {reference:input.reference,scope:input.scope,status:'healthy' as const,stop:null};},observe:x.runtime.observe.bind(x.runtime),stop:x.runtime.stop.bind(x.runtime)};
 const c=new ServiceRunCoordinator(x.f.storage,x.journal,x.ports,runtime,()=>{},()=>x.f.now,20);assert.equal((await c.reconcile(run.id)).status,'unknown');
 assert.equal((await x.journal.get(run.id)).spec.plan.declaration.entrypoint,'app/main.py');assert.notEqual((await x.journal.get(run.id)).runtime?.leaseId,'wrong');
 assert.equal((await c.requestStop(run.id)).status,'stopped');assert.equal((await x.quota.snapshot()).occupied,0);
});
test('service deadline stops the runtime and records a failed run with explicit reason',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec()),c=x.coordinator();await c.reconcile(run.id);x.f.now=7000;
 const result=await c.reconcile(run.id);assert.equal(result.status,'failed');assert.equal(result.errorCode,'service-deadline');assert.equal((await x.quota.snapshot()).occupied,0);
});
test('expired cancelled run cannot claim acquisition closed when lookup is unconfirmed',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec()),c=x.coordinator();x.lostAcquire=true;await c.reconcile(run.id);await x.journal.requestStop(run.id);x.f.now=7000;
 const unavailable=new ServiceRunCoordinator(x.f.storage,x.journal,{...x.ports,async lookup(){throw Error('lookup-unavailable');}},x.runtime,()=>{},()=>x.f.now,20);
 assert.equal((await unavailable.reconcile(run.id)).status,'cancelled');assert.equal((await c.state(run.id))?.acquisitionClosed,false);assert.equal((await x.quota.snapshot()).occupied,1);
 await c.reconcile(run.id);assert.equal((await c.state(run.id))?.released,true);assert.equal((await x.quota.snapshot()).occupied,0);
});
test('expired acquisition closes only after a successful lookup confirms no lease exists',async t=>{
 const x=setup(t),run=await x.journal.create(actor,'request-a',spec());const c=new ServiceRunCoordinator(x.f.storage,x.journal,{...x.ports,async acquire(){throw Error('never-reached-quota');}},x.runtime,()=>{},()=>x.f.now,20);
 await c.reconcile(run.id);assert.equal((await c.state(run.id))?.acquisitionClosed,false);x.f.now=7000;
 assert.equal((await c.reconcile(run.id)).status,'failed');assert.equal((await c.state(run.id))?.acquisitionClosed,true);assert.equal((await x.quota.snapshot()).occupied,0);
});
