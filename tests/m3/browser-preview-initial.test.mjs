import test from 'node:test';
import assert from 'node:assert/strict';
import {Storage} from './browser-preview-test-fixture.mjs';
import {projectInitialPreviewDiscovery,discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BrowserPreviewBuildHost} from '../../services/browser-preview/build-host.ts';
import {BrowserPreviewOrchestrator} from '../../services/browser-preview/orchestrator.ts';
import {frozenSource} from '../../services/browser-preview/source.ts';
import {SimulationHost} from '../../services/simulation/host.ts';
import {platformPreviewDelivery} from '../../services/browser-preview/platform-delivery.ts';
import {createTrustedPreviewRegistry} from '../../services/browser-preview/profiles.ts';
import {initial} from './browser-preview-initial-fixture.mjs';
const actor={userId:'user-a',authVersion:1};
for(const index of [0,1])test(`initial ${index} provenance resolves frozen model bytes and persists before create-only R2 without saved Turn`,async()=>{
 const s=await initial(index);await s.host().alarm();const row=s.host().read(s.revision);assert.equal(row.state.status,'ready');assert.equal(row.source.kind,'initial-workspace');assert.ok(row.source.filesSha256);assert.equal(row.source.revisionId,s.revision);assert.equal(Object.hasOwn(row.source,'identity'),false);assert.equal(Object.hasOwn(row.source,'receipt'),false);assert.equal(s.resolves,1);assert.equal(s.f.puts,1);
 const ref=[...s.f.storage.values].find(([key])=>key.startsWith('browser-preview:reference:'))[1];assert.deepEqual(ref.source,frozenSource(row.source));assert.equal(ref.source.filesSha256,row.source.filesSha256);assert.equal(s.f.storage.values.get(discoveryKey(s.revision)).status,'settled');assert.equal(s.f.storage.alarm,null);
 const before=structuredClone(s.f.storage.values);await s.host().alarm();assert.deepEqual(s.f.storage.values,before);assert.equal(s.resolves,1);
});
test('confirmed-ready projector admits only model-content transition and never mints discovery from legacy ready read',async()=>{
 const s=await initial(),storage=new Storage();
 for(const next of [{...s.state,projectionConfirmed:false},{...s.state,projection:{outcome:'unknown'}},{...s.state,task:{...s.state.task,modelContent:undefined}}])await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,next,null));
 await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,s.state));assert.equal(storage.values.size,0);
 await storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,{...s.state,projectionConfirmed:false}));assert.equal(storage.values.get('browser-preview:initial-source'),s.revision);assert.equal(storage.values.get(discoveryKey(s.revision)).filesSha256,null);
});
test('initial history uses existing native initial source, saved head wins, same-key Verify and read-only receipts survive restart',async()=>{
 const s=await initial();await s.host().alarm();let head=s.host().initial();
 const simulations=()=>new SimulationHost(s.f.storage,s.f.scope,{authorize:async()=>true,hold:()=>{},quota:{},start:async()=>{throw Error('no-native-on-submit');},observe:async()=>{},stop:async()=>{},destroy:async()=>{},running:async()=>false,publish:async()=>{}},()=>1000);
 const ports={authorize:async()=>{},checkScope:()=>{},checkSource:s.ports.checkSource,head:()=>head,saved:id=>id===s.revision?s.host().source(id):null,registry:s.ports.registry,builds:s.host(),bucket:s.f.ports.bucket,files:async source=>{assert.equal(source.kind,'initial-workspace');return (await s.resolver.resolve(source.reference,s.f.scope)).filesArchive;},simulations:simulations(),canVerify:()=>true,image:'fixture-image',delivery:hash=>platformPreviewDelivery('http://127.0.0.1:8795','http://localhost:8821',hash)};
 const service=()=>new BrowserPreviewOrchestrator(s.f.storage,s.f.scope,{...ports,simulations:simulations()}),body={revisionId:s.revision,packageIdentity:s.host().read(s.revision).state.packageIdentity,parameters:{},seed:42,intent:'experiment',idempotencyKey:'initial-verify-a'};
 const view=await service().view(actor);assert.equal(view.sourceKind,'initial-workspace');assert.equal(view.referenceSha256,s.source.referenceSha256);
 const a=await service().verify(actor,body);assert.equal(a.experiment.version.revisionId,null);assert.equal(a.experiment.version.filesSha256,s.host().source(s.revision).filesSha256);
 head={identity:s.f.source.identity,receipt:{...s.f.source.receipt,revisionId:'saved-new',filesSha256:'e'.repeat(64)}};
 const before=structuredClone(s.f.storage.values),receipt=await service().verification(actor,body.idempotencyKey);assert.equal(receipt.status,'accepted');assert.equal(receipt.experiment.runId,a.experiment.runId);assert.equal(receipt.experiment.stale,true);assert.deepEqual(s.f.storage.values,before);
 const b=await service().verify(actor,body);assert.equal(a.experiment.runId,b.experiment.runId);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('simulation:run:')).length,1);assert.equal([...s.f.storage.values].find(([k])=>k.startsWith('browser-preview:verify:'))[1].source.kind,'initial-workspace');
});
test('initial resolver tamper and revoked source after await never write private package; failed attempt can explicitly recover',async()=>{
 const s=await initial(),original=s.ports.resolveInitial;s.ports.resolveInitial=async source=>({...await original(source),referenceSha256:'f'.repeat(64)});
 await s.host().alarm();s.f.clock(3000); // custom host clock below exercises all three persisted attempts
 await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>3000).alarm();await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>7000).alarm();const row=s.host().read(s.revision);assert.equal(row.state.status,'failed');assert.equal(s.f.puts,0);
 s.ports.resolveInitial=original;await s.host().retry(s.revision,'python-stdlib/v1',row.state.buildIdentity,'retry-initial-a');await s.host().alarm();assert.equal(s.host().read(s.revision).state.status,'ready');
 const r=await initial();r.ports.resolveInitial=async source=>{const value=await r.resolver.resolve(source.reference,r.f.scope);r.revoke();return value;};await r.host().alarm();assert.equal(r.f.puts,0);assert.equal(r.host().source(r.revision).filesSha256,null);
 assert.throws(()=>new BrowserPreviewBuildHost(r.f.storage,{...r.f.scope,tenantId:'tenant-b'},r.ports).source(r.revision),/read-denied/);
 await assert.rejects(r.resolver.resolve(r.source.reference,{...r.f.scope,tenantId:'tenant-b'}),/scope-denied/);
});
test('settled initial reconfirmation cannot mint an orphan browser wake; pending wake remains unchanged',async()=>{
 const s=await initial();await s.host().alarm();await s.f.storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,{...s.state,projectionConfirmed:false}));assert.equal(s.f.storage.values.has('browser-preview:wake-at'),false);assert.equal(s.f.storage.alarm,null);
 const wakeKey=(await import('../../services/workspace/shared-alarm.ts')).BROWSER_BUILD_WAKE_KEY;s.f.storage.values.set(wakeKey,500);await s.f.storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,{...s.state,projectionConfirmed:false}));assert.equal(s.f.storage.values.get(wakeKey),500);
 // Alarm's no-due path also cleans a stale logical wake without source I/O.
 await s.host().alarm();assert.equal(s.f.storage.values.has(wakeKey),false);assert.equal(s.f.storage.alarm,null);
});
test('transaction-local source CAS fences a mutation after begin or persist reference await',async()=>{
 for(const phase of ['begin','persist']){
  const s=await initial(),transaction=s.f.storage.transaction;let referenceReads=0,injected=false;
  s.f.storage.transaction=op=>transaction(tx=>op({...tx,get:async key=>{const value=await tx.get(key);if(key.startsWith('browser-preview:reference:')&&++referenceReads===(phase==='begin'?1:2)){injected=true;const row=s.f.storage.values.get(discoveryKey(s.revision));s.f.storage.values.set(discoveryKey(s.revision),{...row,attempts:row.attempts+1});}return value;}}));
  await s.host().alarm();assert.equal(injected,true);assert.equal(s.host().read(s.revision)?.state.status==='ready',false);assert.equal([...s.f.storage.values.keys()].filter(k=>k.startsWith('browser-preview:receipt:')).length,0);assert.equal(s.f.puts,phase==='begin'?0:1);
 }
});
test('owned package GET rejects source/receipt mismatch and accepted GET rechecks captured source after replay await',async()=>{
 const s=await initial();await s.host().alarm();let ready=true,execution=0;
 const simulations=new SimulationHost(s.f.storage,s.f.scope,{authorize:async()=>true,hold:()=>{},quota:{},start:async()=>{execution++;throw Error('must not execute');},observe:async()=>{},stop:async()=>{},destroy:async()=>{},running:async()=>false,publish:async()=>{}},()=>1000);
 const ports={authorize:async()=>{},authorizeVerify:async()=>{if(!ready)throw Error('workspace-not-ready');},checkScope:()=>{},checkSource:s.ports.checkSource,head:()=>s.host().initial(),saved:id=>s.host().source(id),builds:s.host(),bucket:s.f.ports.bucket,files:async source=>(await s.resolver.resolve(source.reference,s.f.scope)).filesArchive,simulations,canVerify:()=>true,image:'fixture-image',delivery:hash=>platformPreviewDelivery('http://127.0.0.1:8795','http://localhost:8821',hash)};
 const service=()=>new BrowserPreviewOrchestrator(s.f.storage,s.f.scope,ports),body={revisionId:s.revision,packageIdentity:s.host().read(s.revision).state.packageIdentity,parameters:{},seed:42,intent:'experiment',idempotencyKey:'maintenance-a'};
 const a=await service().verify(actor,body);ready=false;
 for(const outcome of ['stopped','unknown']){s.state.projection={outcome};const before=structuredClone(s.f.storage.values),receipt=await service().verification(actor,body.idempotencyKey);assert.equal(receipt.status,'accepted');assert.equal(receipt.experiment.runId,a.experiment.runId);assert.ok((await service().bytes(actor,body.packageIdentity)).bytes.length);assert.deepEqual(s.f.storage.values,before);await assert.rejects(service().verify(actor,{...body,idempotencyKey:outcome+'-new'}),/not-ready/);assert.equal(execution,0);}
 const original=simulations.replay.bind(simulations);simulations.replay=async(...args)=>{const result=await original(...args),source=s.host().source(s.revision);s.f.storage.values.set(discoveryKey(s.revision),{...source,filesSha256:'f'.repeat(64)});return result;};
 await assert.rejects(service().verification(actor,body.idempotencyKey),/source-unavailable/);await assert.rejects(service().bytes(actor,body.packageIdentity),/source-unavailable/);assert.equal(execution,0);
});

test('pending initial reconfirmation preserves future retry due time and compatible row keeps original runtime',async()=>{
 const s=await initial(),wakeKey=(await import('../../services/workspace/shared-alarm.ts')).BROWSER_BUILD_WAKE_KEY;
 s.f.storage.values.set(discoveryKey(s.revision),{...s.source,nextAttemptAt:8000});s.f.storage.values.set(wakeKey,8000);
 await s.f.storage.transaction(tx=>projectInitialPreviewDiscovery(tx,s.state,{...s.state,projectionConfirmed:false}));assert.equal(s.f.storage.values.get(wakeKey),8000);
 s.f.storage.values.set(discoveryKey(s.revision),s.source);s.f.storage.failReceipt=true;await s.host().alarm();const frozen=s.host().read(s.revision).profile.runtime;
 s.ports.registry=async()=>await createTrustedPreviewRegistry([]);s.f.storage.failReceipt=false;
 await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>3000).alarm();assert.equal(s.host().read(s.revision).state.status,'ready');assert.deepEqual(s.host().read(s.revision).profile.runtime,frozen);assert.equal(s.f.puts,1);
});
test('retry admission rechecks authoritative source after awaited discovery and creates no intent when scope is revoked',async()=>{
 const s=await initial();s.ports.resolveInitial=async()=>{throw Error('source-transport-failed');};await s.host().alarm();await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>3000).alarm();await new BrowserPreviewBuildHost(s.f.storage,s.f.scope,s.ports,()=>7000).alarm();const row=s.host().read(s.revision),transaction=s.f.storage.transaction;
 s.f.storage.transaction=op=>transaction(tx=>op({...tx,get:async key=>{const value=await tx.get(key);if(key===discoveryKey(s.revision))s.revoke();return value;}}));
 const before=structuredClone(s.f.storage.values);await assert.rejects(s.host().retry(s.revision,'python-stdlib/v1',row.state.buildIdentity,'revoked-retry'),/source-unavailable/);assert.deepEqual(s.f.storage.values,before);assert.equal(s.host().retryReceipt('revoked-retry'),null);
});
