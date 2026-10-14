import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileJournal} from '../../scripts/m1/riffoid-validation-publisher.mjs';
import {hashJSON} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {formalNativeIntentAuthorizer} from '../../scripts/m1/riffoid-formal-native-intent-authorizer.mjs';
async function fixture(changeIntent=x=>x){
 const directory=await mkdtemp(join(tmpdir(),'riffoid-formal-guard-fixture-'));
 const journal=new FileJournal(directory);await journal.lock();
 const request={accountId:'fixture-account',method:'PUT',path:'/fixture/worker',bodySHA256:'a'.repeat(64),bytes:123};
 const expected={...request,requestId:'fixture_gatewayCanonical',worker:'fixture-worker'};delete expected.method;
 const frozenPlan={requests:{gatewayCanonical:expected},scope:'OFFLINE_FIXTURE_NO_HTTP'},frozenPlanSHA256=hashJSON(frozenPlan);
 const pending={requestId:expected.requestId,phase:'gatewayCanonical',prior:{version:'fixture-v',deployment:'fixture-d',metadataSHA256:'b'.repeat(64),modulesSHA256:'c'.repeat(64),resourcesSHA256:'d'.repeat(64)},startedAt:900};
 const publisher={frozenPlan,frozenPlanSHA256,pending,busy:true,allowedPhase:pending.phase,liveCapability:{frozenPlanSHA256,productionWritesPermitted:true,singlePublisher:true,resourcesCoverageEstablished:true,nativeProtocolComplete:true,formalAcceptanceCapabilitiesReady:true,failureDisposition:'exact-close-forward-rollback',notBefore:500,expires:5000,publisherConfirmedAt:500}};
 const intent={frozenPlanSHA256,phase:pending.phase,requestId:pending.requestId,accountId:expected.accountId,worker:expected.worker,priorVersion:pending.prior.version,priorDeployment:pending.prior.deployment,priorMetadataSHA256:pending.prior.metadataSHA256,priorModulesSHA256:pending.prior.modulesSHA256,priorResourcesSHA256:pending.prior.resourcesSHA256,bodySHA256:request.bodySHA256,bytes:request.bytes,startedAt:pending.startedAt};
 await journal.append(pending.requestId,'intent',changeIntent(intent));
 const originalOwner=journal.lockOwner;
 return {publisher,journal,request,authorize:formalNativeIntentAuthorizer({publisher,journal,now:()=>1000}),close:async()=>{journal.lockOwner=originalOwner;await journal.unlock();await rm(directory,{recursive:true});}};
}
test('consumes exact original dispatch once, including credential-failure retry',async()=>{
 const x=await fixture();try{await x.authorize(x.request);await assert.rejects(x.authorize(x.request),/dispatched twice/);}finally{await x.close();}
});
test('concurrent calls cannot both pass the original intent guard',async()=>{
 const x=await fixture();try{const values=await Promise.allSettled([x.authorize(x.request),x.authorize(x.request)]);assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal(values.filter(v=>v.status==='rejected').length,1);}finally{await x.close();}
});
for(const [name,mutate] of [
 ['different bytes',x=>x.request.bodySHA256='e'.repeat(64)],
 ['different account',x=>x.request.accountId='other-account'],
 ['different path',x=>x.request.path='/other-worker'],
 ['frozen plan drift',x=>x.publisher.frozenPlan.scope='changed'],
 ['maintenance incomplete',x=>x.publisher.liveCapability.nativeProtocolComplete=false],
 ['missing formal acceptance capability',x=>x.publisher.liveCapability.formalAcceptanceCapabilitiesReady=false],
 ['expired window',x=>x.publisher.liveCapability.expires=999],
 ['unbounded window',x=>x.publisher.liveCapability.expires=1800501],
 ['wrong transition',x=>x.publisher.allowedPhase='entryEnabled'],
 ['unowned lock',x=>x.journal.lockOwner=null],
 ['unknown original mutation',async x=>x.journal.append(x.publisher.pending.requestId,'unknown',{fixture:true})],
 ['other unresolved intent',async x=>x.journal.append('fixture_other','intent',{fixture:true})],
 ['terminal original intent',async x=>x.journal.append(x.publisher.pending.requestId,'terminal',{fixture:true})]
])test('blocks '+name,async()=>{
 const x=await fixture();try{await mutate(x);await assert.rejects(x.authorize(x.request));}finally{await x.close();}
});
test('rejects durable baseline identity mismatch before credential loading',async()=>{
 const x=await fixture(i=>({...i,priorVersion:'different-v'}));try{await assert.rejects(x.authorize(x.request));}finally{await x.close();}
});
