// No credentials/network: the protocol only receives the module's closed dummy transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ACCOUNT,WORKER,BASE,EXPECTED,hashJSON,loadInputs,validateGrant,validateMergeProof,validateWitness,preGuard,postGuard,createOfflineDummyTransport,exerciseInjectedProtocol,execute,safetyCounters} from './publish-native-replacement.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url)),i=await loadInputs(),requestId='c36473bb-a69c-4970-8547-190c9155ec83';
const oldModule=await readFile(resolve(ROOT,'../jhg46-publication-review-20261017/gateway.mjs'));
const jwt='offline.'+Buffer.from(JSON.stringify({wrangler_single_asset_uploads:false})).toString('base64url')+'.synthetic';
const before={...structuredClone(i.complete.before),version:structuredClone(i.baseline.version),module:oldModule};before.active=before.deployments.deployments[0];before.source=i.safe.actualServingModule;
const after=structuredClone(before);after.module=i.module;after.version.id='33333333-3333-4333-8333-333333333333';after.version.number++;after.active.id='44444444-4444-4444-8444-444444444444';after.active.versions=[{version_id:after.version.id,percentage:100}];after.settings.annotations=structuredClone(i.metadata.annotations);after.source={mainModule:'index.js',bytes:EXPECTED.bundleBytes,sha256:EXPECTED.bundle};
const plan={requestId,planSha256:'a'.repeat(64)};
const temporary=async fn=>{const d=await mkdtemp(resolve(ROOT,'synthetic-real-sender-'));try{return await fn(d);}finally{await rm(d,{recursive:true,force:true});}};
const dummy=extra=>createOfflineDummyTransport({before,after,assetSession:{jwt,buckets:[]},uploadReply:{jwt},...extra});
const run=(directory,client)=>exerciseInjectedProtocol({i,plan,directory,client});
function witness(){return {...structuredClone(i.safe),schema:'project-view-browser-native-preservation-witness/v1',requestId,phase:'before-worker-put',startedAt:new Date(Date.now()-1000).toISOString(),endedAt:new Date(Date.now()-500).toISOString(),notExecutionWitness:false};}
function grant(){const now=Date.now();return {schema:'project-view-browser-native-publication-grant/v1',authority:'direct-human-instruction-recorded-by-root',rootReviewCompleted:true,humanInstruction:'Synthetic in-memory validator fixture only',accountId:ACCOUNT,worker:WORKER,prNumber:235,requestId,planSha256:'a'.repeat(64),publisherSha256:'b'.repeat(64),implementationCommit:EXPECTED.implementation,bundleSha256:EXPECTED.bundle,metadataSha256:EXPECTED.metadata,mergeProofSha256:'c'.repeat(64),operations:['asset-session','server-requested-asset-uploads','single-worker-put'],defaultClosed:true,noNewResources:true,allowContainerProviderTurnRun:false,allowNewSubscription:false,startsAt:new Date(now-1000).toISOString(),endsAt:new Date(now+60000).toISOString(),observedAt:new Date(now-500).toISOString()};}
const grantPlan={requestId,mergeProof:{sha256:'c'.repeat(64)}};

test('missing human grant cannot enter credential loader or real client',async()=>{
 const prior=safetyCounters();await assert.rejects(execute(),/explicit-new-human-grant/);await assert.rejects(execute({grantFile:'no-such-human-grant.json',expectedGrantSha256:'a'.repeat(64)}));assert.deepEqual(safetyCounters(),prior);
 const r=spawnSync(process.execPath,[resolve(ROOT,'publish-native-replacement.mjs'),'--execute'],{env:{PATH:process.env.PATH},encoding:'utf8'});assert.equal(r.status,1);const x=JSON.parse(r.stderr);assert.equal(x.credentialLoaderCalls,0);assert.equal(x.realNetworkRequests,0);
});
test('grant pins same exact target, plan, implementation, bytes, time and default-closed scope',()=>{
 const opts={planSha256:'a'.repeat(64),publisherSha256:'b'.repeat(64)};validateGrant(grant(),grantPlan,opts);
 for(const patch of [{worker:'other'},{accountId:'0'.repeat(32)},{prNumber:233},{requestId:'other'},{bundleSha256:'d'.repeat(64)},{metadataSha256:'d'.repeat(64)},{planSha256:'d'.repeat(64)},{mergeProofSha256:'d'.repeat(64)},{publisherSha256:'d'.repeat(64)},{defaultClosed:false},{allowContainerProviderTurnRun:true},{allowNewSubscription:true},{endsAt:new Date(Date.now()-100).toISOString()}])assert.throws(()=>validateGrant({...grant(),...patch},grantPlan,opts));
});
test('PR235 proof refuses unmerged, old PR, head-as-merge and stale observations',()=>{
 const p={schema:'project-view-github-merge-proof/v1',repository:'jihegao/riffology-cloud',prNumber:235,prUrl:'https://github.com/jihegao/riffology-cloud/pull/235',merged:true,state:'closed',draft:false,baseRef:'main',headSha:'a'.repeat(40),mergeCommitSha:'b'.repeat(40),freshMainSha:'b'.repeat(40),observedAt:new Date().toISOString()};validateMergeProof(p);
 for(const patch of [{prNumber:233},{merged:false},{mergeCommitSha:p.headSha,freshMainSha:p.headSha},{observedAt:new Date(Date.now()-601000).toISOString()}])assert.throws(()=>validateMergeProof({...p,...patch}));
});
test('complete original local snapshot passes while individual scope/runtime/routes/module drift fails',()=>{
 preGuard(before,i);for(const mutate of [s=>{s.settings.bindings[0].text='tampered';},s=>{s.version.resources.script_runtime.exports={};},s=>{s.namespaces.pop();},s=>{s.routes=[];},s=>{s.schedules={};},s=>{s.source.sha256='a'.repeat(64);},s=>{s.deployments.deployments[0].id='different';}]){const s=structuredClone(before);mutate(s);assert.throws(()=>preGuard(s,i));}
});
test('fresh Personal witness must bind original request, full16 versions, hashes and empty target list',()=>{
 const conditions={requestId,phase:'before-worker-put',workerVersionId:i.baseline.version.id};validateWitness(witness(),i,conditions);
 for(const patch of [{phase:'baseline-preparation'},{requestId:'different'},{workerVersionId:after.version.id},{startedAt:new Date(Date.now()-301000).toISOString()},{complete:false},{counts:{...i.safe.counts,apps:15}},{originalAppInstanceListCount:1},{appVersionsCanonicalSha256ById:{}}])assert.throws(()=>validateWitness({...witness(),...patch},i,conditions));
 const w=witness();w.controlCanonicalSha256.registries='a'.repeat(64);assert.throws(()=>validateWitness(w,i,conditions));
});
test('post witness must match actual new version/module/local hashes and start after original ACK',()=>{
 const ack=new Date(Date.now()-2000).toISOString(),w=witness();w.phase='after-worker-put';w.workerVersionId=after.version.id;w.controlCanonicalSha256.settings=hashJSON(after.settings);w.controlCanonicalSha256.deployments=hashJSON(after.deployments);w.workerVersionCanonicalSha256=hashJSON(after.version);w.actualServingModule=after.source;
 const opts={requestId,phase:'after-worker-put',workerVersionId:after.version.id,acknowledgedAt:ack,after};validateWitness(w,i,opts);assert.throws(()=>validateWitness({...w,startedAt:new Date(Date.parse(ack)-1).toISOString()},i,opts));assert.throws(()=>validateWitness({...w,actualServingModule:i.safe.actualServingModule},i,opts));
});
test('post guard preserves all106 bindings,25 exports,6 associations,50 records and closed policies',()=>{
 postGuard(after,i,before);for(const mutate of [s=>{s.settings.bindings[0].text='changed';},s=>{s.version.resources.script_runtime.containers.pop();},s=>{s.namespaces[0].id='replacement';},s=>{s.settings.compatibility_flags=[];},s=>{s.source.sha256='a'.repeat(64);},s=>{s.settings.annotations['workers/tag']='another';},s=>{s.settings.annotations['workers/message']='unexpected';},s=>{s.settings.annotations['workers/triggered_by']='unexpected';}]){const s=structuredClone(after);mutate(s);assert.throws(()=>postGuard(s,i,before));}
});
test('closed dummy transport cannot be replaced with arbitrary callback',async()=>temporary(async directory=>{
 let called=false;await assert.rejects(run(directory,{client:async()=>{called=true;}}),/closed-dummy/);assert.equal(called,false);const c=dummy();assert.throws(()=>{c.client=()=>{called=true;};},TypeError);await run(directory,c);assert.equal(called,false);const calls=c.calls;calls.push({method:'POST',path:'forged'});assert.equal(c.calls.some(x=>x.path==='forged'),false);
}));
test('dummy full protocol has one PUT, saves bounded multipart and remains independent-preservation pending',async()=>temporary(async directory=>{
 const c=dummy(),r=await run(directory,c);assert.equal(c.calls.filter(x=>x.method==='PUT').length,1);assert.equal(c.calls.filter(x=>x.method==='POST').length,1);assert.equal(r.result,'worker-local-readback-passed-independent-preservation-pending');assert.equal(r.independentAll16AppsVersionsRegistryPreservation,'pending');assert.equal(r.userAcceptance,false);assert.deepEqual(safetyCounters(),{credentialLoaderCalls:0,realNetworkRequests:0});
 const pending=JSON.parse(await readFile(resolve(directory,'worker-readback.pending.json')));for(const k of ['beforeFile','afterFile','ackTimeFile','ackFile','intentFile'])assert.match(pending[k].sha256,/^[a-f0-9]{64}$/);
}));
test('prewrite drift blocks all asset and Worker writes',async()=>temporary(async directory=>{
 const changed=structuredClone(before);changed.settings.bindings[0].text='changed';const c=dummy({before:changed});await assert.rejects(run(directory,c),/pre-settings-drift/);assert.equal(c.calls.some(x=>x.method!=='GET'),false);assert.equal((await readdir(directory)).includes('stopped.json'),true);
}));
test('drift after asset preparation blocks PUT and keeps original lock',async()=>temporary(async directory=>{
 const changed=structuredClone(before);changed.settings.bindings[0].text='changed';const c=dummy({immediate:changed});await assert.rejects(run(directory,c),/pre-settings-drift/);assert.equal(c.calls.filter(x=>x.method==='POST').length,1);assert.equal(c.calls.filter(x=>x.method==='PUT').length,0);assert.equal((await readdir(directory)).includes('simulation.lock.json'),true);
}));
test('lost PUT ACK retains original intent/lock and second run cannot replay',async()=>temporary(async directory=>{
 const c=dummy({failPut:true});await assert.rejects(run(directory,c),/synthetic-lost-ack/);const count=c.calls.length;assert.equal(c.calls.filter(x=>x.method==='PUT').length,1);await assert.rejects(run(directory,c),e=>e.code==='EEXIST');assert.equal(c.calls.length,count);const stop=JSON.parse(await readFile(resolve(directory,'stopped.json')));assert.equal(stop.phase,'single-worker-put');assert.equal(stop.noRetry,true);assert.equal(stop.noRollback,true);assert.equal((await readdir(directory)).includes('worker-put-ack.private.json'),false);
}));
test('copied real transport is byte-identical to reviewed old function, without invoking it',async()=>{
 const old=await readFile(resolve(ROOT,'../jhg46-publication-review-20261017/publish-default-closed.mjs'),'utf8'),current=await readFile(resolve(ROOT,'publish-native-replacement.mjs'),'utf8');const start='async function transport(directory){';assert.equal(current.slice(current.indexOf(start),current.indexOf('async function snapshot(client)')),old.slice(old.indexOf(start),old.indexOf('async function moduleHash(client)')));
});

test('sender v3 expected identity is frozen against importing caller mutation',()=>{
 assert.equal(Object.isFrozen(EXPECTED),true);const original={...EXPECTED};
 for(const key of ['finalCandidate','implementation','bundle','metadata','candidateDir','manifest','inventory','graph','frameHtml'])assert.throws(()=>{EXPECTED[key]='unreviewed';},TypeError);
 assert.deepEqual(EXPECTED,original);assert.equal(i.candidateDir,'candidate-v3');assert.equal(i.module.length,5775036);
});
