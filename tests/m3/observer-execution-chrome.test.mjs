import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {executeObserverCapability} from '../../services/observer-browser/executor.ts';
import {observerCoordinator} from '../../services/preview/observer-coordinator.ts';
import {SqlObserverCalls} from '../../services/preview/observer-calls.ts';
import {R2ObserverArtifacts} from '../../services/preview/observer-artifacts.ts';
import {observeWithPlaywright} from '../../services/observer-browser/playwright.mjs';
import {turnDigest} from '../../services/turn/protocol.ts';
import {scope,spec,reference,fixture} from './run-fixture.ts';

// Real Chrome + executor + private content store. Authority, runtime HTTP and R2
// transport are in-process fixtures; this does not prove production admission.
test('durable Chrome observation commits receipts and replays after SQLite reopen without a second browser execution',{timeout:25000},async t=>{
 const browser=await chromium.launch({channel:process.env.M1_BROWSER_CHANNEL||'chrome',headless:true});t.after(()=>browser.close());
 const now=Date.now(),deadlineAt=now+14000,ref={...reference('run-a'),deadlineAt:now+30000},plan=spec();plan.plan.declaration.observation={pagePath:'/observe',statePath:'/state'};
 const runtime={reference:ref,scope,spec:plan,lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:ref.generation,operation:'service-run',operationId:ref.dispatchId,deadlineAt:ref.deadlineAt,runId:ref.runId,leaseId:ref.leaseId}};
 const binding={previewId:'preview-a',scope,runId:ref.runId,source:plan.plan.source,runtime:ref,createdAt:now,expiresAt:ref.deadlineAt,revokedAt:null,reason:null};
 const command={schemaVersion:1,purpose:'observer',scope,sessionId:'session-current',turnId:'turn-current',dispatchId:'dispatch-current',commandId:'call-a',previewId:binding.previewId,operation:'screenshot',deadlineAt};
 const target={binding,runtime,policy:{origin:'https://p-'+'a'.repeat(40)+'.preview.example.test',pagePath:'/observe',statePath:'/state'},targetDigest:await turnDigest({binding,plan:plan.plan}),expiresAt:deadlineAt};
 const objects=new Map();const store=new R2ObserverArtifacts({async put(key,value){if(!objects.has(key))objects.set(key,Uint8Array.from(value));},async get(key){const value=objects.get(key);return value?{size:value.length,body:new Response(value).body}:null;}});
 const requests=[];let authorizations=0;
 const f=fixture(t);f.now=now;const calls=()=>new SqlObserverCalls(f.storage,scope,()=>f.now);
 const services={authorize:async()=>{authorizations++;return structuredClone(target);},artifacts:store,browser:{run:input=>observeWithPlaywright(browser,input)},forward:async(c,digest,request)=>{
  assert.deepEqual(c,command);assert.equal(digest,target.targetDigest);assert.equal(request.headers.get('x-riff-observer'),'read-only');assert.equal(request.headers.get('cookie'),null);requests.push(request.url);
  if(request.url==='http://localhost:8080/observe')return new Response('<html><body><h1>Queue: 3</h1></body></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
  assert.equal(request.url,'http://localhost:8080/state');assert.equal(browser.contexts().length,0);
  return Response.json({simulation_state_id:'queue-state',sequence:4,state:{queue:3}});
 }};
 // Exercise a transport method on the prototype with receiver semantics.
 const forward=services.forward;delete services.forward;Object.setPrototypeOf(services,{forward(...args){assert.equal(this,services);return forward(...args);}});
 const host=observerCoordinator(calls(),services,async()=>false);
 const execution=await host.run(command);assert.equal(execution.status,'completed');
 const r=execution.result;assert.equal(r.atomicSample,false);assert.equal(r.domainSideEffects,'unverified');assert.equal(r.filesSha256,'a'.repeat(64));assert.equal(r.state.simulationStateId,'queue-state');assert.equal(r.state.sequence,4);assert.equal(r.view.inline,null);
 assert.ok(r.view.startedAt<=r.view.completedAt);assert.ok(r.view.completedAt<=r.state.startedAt);assert.ok(r.state.startedAt<=r.state.completedAt);assert.ok(r.state.completedAt<=r.finishedAt);assert.ok(authorizations>5);
 assert.deepEqual(requests,['http://localhost:8080/observe','http://localhost:8080/state']);assert.equal(objects.size,2);
 const png=Buffer.from(await store.read(command,r.view.artifact));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),720);
 const state=JSON.parse(new TextDecoder().decode(await store.read(command,r.state.artifact)));assert.deepEqual(state.state,{queue:3});assert.equal(browser.contexts().length,0);
 f.reopen();const replay=await observerCoordinator(calls(),services,async()=>false).run(command);assert.deepEqual(replay.result,r);assert.equal(replay.status,'completed');assert.equal(requests.length,2);assert.equal(objects.size,2);
 // A failed browser call is not proof of resource exit. Reconstructed hosts
 // retain the occupied slot until the external executor supplies stop proof.
 services.browser.run=async()=>{throw Error('observer-browser-failed');};
 const uncertain={...command,commandId:'call-uncertain'};
 const unknown=await observerCoordinator(calls(),services,async()=>false).run(uncertain);assert.equal(unknown.status,'unknown');assert.equal(unknown.result,null);
 f.reopen();const reconstructed=observerCoordinator(calls(),services,async()=>false);
 await assert.rejects(reconstructed.run({...command,commandId:'call-next'}),/observer-call-busy/);
 assert.equal((await reconstructed.reconcile(uncertain)).status,'unknown');
 assert.equal((await observerCoordinator(calls(),services,async()=>true).reconcile(uncertain)).status,'failed');
 assert.equal(requests.length,2);assert.equal(objects.size,2);
 // Browser-side capability adapter uses the same actual Chrome and private
 // content store; this capability is an explicit in-process transport fixture.
 const remoteCommand={...command,commandId:'call-capability',operation:'snapshot'};let capabilityRequests=0;
 const adapted=await executeObserverCapability(remoteCommand,{authorize:services.authorize,cancelled:async()=>false,forward:async request=>{
  capabilityRequests++;assert.equal(request.headers.get('x-riff-observer'),'read-only');
  if(request.url==='http://localhost:8080/observe')return new Response('<body>Capability view</body>',{headers:{'content-type':'text/html; charset=utf-8'}});
  assert.equal(request.url,'http://localhost:8080/state');return Response.json({simulation_state_id:'cap-state',sequence:1,state:{value:2}});
 }},{browser:{run:input=>observeWithPlaywright(browser,input)},artifacts:store});
 assert.equal(adapted.stopped,true);assert.equal(adapted.result.view.inline.text,'Capability view');assert.equal(adapted.result.state.simulationStateId,'cap-state');assert.equal(capabilityRequests,2);assert.equal(browser.contexts().length,0);assert.equal(objects.size,4);
});
