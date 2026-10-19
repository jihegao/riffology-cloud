import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {manualPageFixture,scopes} from './manual-page-broker-fixture.mjs';
import {projectIrFixture} from './project-ir-fixture.ts';

const clientId='11111111-1111-4111-8111-111111111111';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pageFiles=version=>({
 'app/views.json':JSON.stringify({schema:'project.views/v1',files:['app/home.html','docs/data.json'],views:[{id:'home',title:'Ordinary storage canary',entrypoint:'app/home.html'}]}),
 'app/home.html':'<h1>Synthetic ordinary page '+version+'</h1>',
 'docs/data.json':JSON.stringify({fixture:'synthetic-only',version}),
});
async function assets(){
 const base=new URL('../../vendor/riffoid-ir-plugin/',import.meta.url);
 const [runtimeSource,workerSource,pkg]=await Promise.all([readFile(new URL('browser/runtime.js',base),'utf8'),readFile(new URL('browser/worker.js',base),'utf8'),readFile(new URL('package.json',base),'utf8')]);
 return {runtimeSource,workerSource,pluginVersion:JSON.parse(pkg).version};
}
function evidenceWriter(){
 const raw=process.env.RIFFOID_IR_WORKERD_EVIDENCE;
 if(!raw)return async()=>{};
 const destination=resolve(raw),inside=relative(process.cwd(),destination);
 if(!isAbsolute(raw)||inside===''||inside!=='..'&&!inside.startsWith('..'+sep))throw Error('Workerd evidence must be outside the repository');
 return async(name,value)=>{if(!/^[a-z0-9.-]+$/.test(name))throw Error('invalid evidence name');await mkdir(destination,{recursive:true});await writeFile(resolve(destination,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
}
async function executeFrozen(claim){
 const runtime=await import('data:text/javascript;base64,'+Buffer.from(claim.runtimeSource).toString('base64'));
 const result=runtime.executePlan(claim.artifact.plan,claim.run.inputs);
 result.planFingerprint=claim.run.planFingerprint;
 return result;
}
async function recordBlob(f,runId){
 for(const object of (await f.bucket.list({prefix:'project-ir/v1/'})).objects){
  const value=await f.bucket.get(object.key),bytes=Buffer.from(await value.arrayBuffer());
  let json;try{json=JSON.parse(bytes.toString());}catch{continue;}
  if(json.runId===runId&&json.status==='succeeded')return {key:object.key,sha256:sha(bytes),byteLength:bytes.length,bytes};
 }
 throw Error('Saved terminal record is absent from real R2');
}

test('real local Workerd persists a frozen IR run through Gateway/Workspace and SQLite/R2 reconstruction without a Turn or canonical revision write',{timeout:90000},async t=>{
 const save=evidenceWriter(),f=await manualPageFixture(t,{browserLocal:true,projectIrTest:true}),sourceAssets=await assets(),fixture=await projectIrFixture(sourceAssets);
 const irPath=f.base('alpha')+'/project-ir';
 let packageIdentity,canonical,original,originalClaim,originalBlob,replayed;
 const observations={schema:'riffoid-ir.workerd-storage-evidence/v1',environment:'local-workerd-sqlite-d1-r2',nodeVersion:process.version,scope:scopes.alpha,identity:'synthetic-alpha/authVersion-1',source:'committed real compiler 0.1.0 B1 simpack + shared package runtime/worker',agent:'synthetic fixture Core registration/tool only; no Pi Turn or provider call',execution:'actual shared runtime in Node using the frozen sources returned by production Gateway/Workspace RPC',actualBrowserExecution:false,onlineAcceptance:false,checks:[]};
 const mark=async(name,details={})=>{observations.checks.push({name,passed:true,...details});await save('summary.json',observations);};
 const post=async(operation,input={},identity=packageIdentity,options={})=>f.request(irPath,{method:'POST',body:{packageIdentity:identity,operation,input},...options});
 const readIr=async(operation,input={})=>{const response=await post(operation,input);assert.equal(response.status,200,JSON.stringify(response));return response.body;};
 const synthetic=async body=>{const response=await f.request('/__fixture/project-ir-agent',{method:'POST',body});assert.equal(response.status,200,JSON.stringify(response));return response.body;};
 const sameCanonical=async expected=>{
  const files=await f.read(f.base('alpha')+'/files'),pkg=(await f.read(f.base('alpha')+'/project-views')).package;
  assert.deepEqual(files.revision,expected.revision);assert.equal(pkg.packageIdentity,expected.packageIdentity);assert.equal(pkg.revisionId,expected.revision.revisionId);
 };
 const captureCanonical=async()=>({revision:(await f.read(f.base('alpha')+'/files')).revision,packageIdentity:(await f.read(f.base('alpha')+'/project-views')).package.packageIdentity});

 await t.test('ordinary canonical page is saved through the real manual-save route before synthetic graph registration',async()=>{
  for(const user of ['alpha','beta']){const saved=await f.save(user,'ir-storage-page-'+user,pageFiles(user+'-v1'));assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.status,'committed');}
  canonical=await captureCanonical();packageIdentity=canonical.packageIdentity;
  const before=await f.footprint();await save('footprint-before.json',before);await save('canonical-before.json',canonical);await save('registration-b1.json',fixture.registration);
  const registered=await synthetic({operation:'register',effectId:'synthetic-compile-b1',registration:fixture.registration});
  assert.equal(registered.status,'succeeded',JSON.stringify(registered));assert.deepEqual(registered.browserArtifactRefs,[fixture.browserArtifactRef]);
  await sameCanonical(canonical);
  await mark('canonical-page-and-compiled-graph',{revisionId:canonical.revision.revisionId,packageIdentity,browserArtifactRef:fixture.browserArtifactRef,toolchain:fixture.artifact.toolchain});
 });
 await t.test('production Gateway/Workspace heartbeat claims one pending run and returns frozen R2 runtime/worker',async()=>{
  assert.deepEqual(await readIr('heartbeat',{clientId}),{connected:true});
  const accepted=await synthetic({operation:'project_ir_run',effectId:'synthetic-run-b1',input:{browserArtifactRef:fixture.browserArtifactRef,runOptions:{seed:13}}});
  assert.equal(accepted.accepted,true,JSON.stringify(accepted));
  originalClaim=await readIr('heartbeat',{clientId});assert.equal(originalClaim.run.runId,accepted.runId);assert.equal(originalClaim.run.status,'running');
  assert.equal(originalClaim.runtimeSource,sourceAssets.runtimeSource);assert.equal(originalClaim.workerSource,sourceAssets.workerSource);assert.equal(originalClaim.run.inputs.seed,13);assert.deepEqual(originalClaim.run.actor,{userId:'alpha',authVersion:1});
  assert.deepEqual(await readIr('heartbeat',{clientId}),{connected:true},'a repeated heartbeat never dispatches an executing run again');
  await save('claim-b1.json',originalClaim);await sameCanonical(canonical);
  await mark('gateway-workspace-claim',{runId:accepted.runId,runtimeSha256:sha(originalClaim.runtimeSource),workerSha256:sha(originalClaim.workerSource),seed:13});
 });
 await t.test('actual same-package Node runtime submits through production RPC and full terminal bytes exist in real R2',async()=>{
  const result=await executeFrozen(originalClaim);await save('runtime-result-b1.json',result);
  assert.equal(result.metrics.planned_sorties,2);assert.equal(result.metrics.launched_sorties,2);assert.equal(result.metrics.completed_sorties,2);assert.equal(result.metrics.elapsed_minutes,60);
  original=await readIr('submit',{runId:originalClaim.run.runId,clientId,result});
  assert.equal(original.status,'succeeded',JSON.stringify(original));assert.equal(original.execution.verification,'local-unverified');assert.deepEqual(original.events,result.events);
  assert.deepEqual(await readIr('project_ir_result',{runId:original.runId}),original);
  originalBlob=await recordBlob(f,original.runId);assert.match(originalBlob.key,/^project-ir\/v1\/[a-f0-9]{64}\/objects\/[a-f0-9]{64}$/);assert.ok(originalBlob.key.endsWith(originalBlob.sha256));
  await save('record-b1-r2.json',originalBlob.bytes);await save('record-b1-r2-identity.json',{key:originalBlob.key,sha256:originalBlob.sha256,byteLength:originalBlob.byteLength});
  const keys=(await f.bucket.list()).objects.map(x=>x.key).sort();
  assert.deepEqual(await readIr('submit',{runId:original.runId,clientId,result}),original,'lost submit ACK is reconciled idempotently');
  assert.deepEqual((await f.bucket.list()).objects.map(x=>x.key).sort(),keys);
  const records=await readIr('records');assert.equal(records.records.length,1);assert.equal('events'in records.records[0],false);
  await sameCanonical(canonical);await mark('real-r2-terminal-save',{runId:original.runId,recordSha256:originalBlob.sha256,eventCount:original.events.length,metrics:original.metrics});
 });
 await t.test('real Workerd/DO reconstruction reads the same frozen run before any new heartbeat',async()=>{
  const before=await f.footprint();await f.restart();
  const restored=await readIr('project_ir_result',{runId:original.runId});assert.deepEqual(restored,original);
  const restoredBlob=await recordBlob(f,original.runId);assert.equal(restoredBlob.sha256,originalBlob.sha256);assert.deepEqual(restoredBlob.bytes,originalBlob.bytes);
  const after=await f.footprint();assert.deepEqual(after.keys,before.keys);assert.equal(after.manualPosts,before.manualPosts);assert.equal(after.outbound,0);
  await sameCanonical(canonical);await save('record-b1-after-restart.json',restored);await save('footprint-after-restart.json',after);
  await mark('workerd-sqlite-r2-restart',{runId:original.runId,recordSha256:restoredBlob.sha256,unchangedObjectCount:after.keys.length,noRedispatch:true});
 });
 await t.test('later storage-only graph registration cannot change the original explicit replay identity',async()=>{
  const later=await projectIrFixture({...sourceAssets,runtimeSource:sourceAssets.runtimeSource+'\n// storage graph fixture only; domain compiler output unchanged\n',workerSource:sourceAssets.workerSource+'\n// storage graph fixture only\n',pluginVersion:'0.3.2-storage-fixture'});
  const registered=await synthetic({operation:'register',effectId:'synthetic-storage-graph-later',registration:later.registration});assert.equal(registered.status,'succeeded',JSON.stringify(registered));
  await save('registration-later-storage-only.json',later.registration);
  await readIr('heartbeat',{clientId});
  const accepted=await synthetic({operation:'project_ir_run',effectId:'synthetic-explicit-replay',input:{sourceRunId:original.runId}});assert.equal(accepted.accepted,true,JSON.stringify(accepted));assert.notEqual(accepted.runId,original.runId);
  const claim=await readIr('heartbeat',{clientId});assert.equal(claim.run.sourceRunId,original.runId);assert.equal(claim.run.browserArtifactRef,original.browserArtifactRef);assert.equal(claim.run.runtimeRef,original.runtimeRef);assert.deepEqual(claim.run.inputs,original.inputs);assert.equal(claim.runtimeSource,originalClaim.runtimeSource);assert.equal(claim.workerSource,originalClaim.workerSource);
  const result=await executeFrozen(claim);replayed=await readIr('submit',{runId:claim.run.runId,clientId,result});assert.equal(replayed.status,'succeeded',JSON.stringify(replayed));assert.deepEqual(replayed.metrics,original.metrics);assert.deepEqual(replayed.events,original.events);
  assert.deepEqual(await readIr('project_ir_result',{runId:original.runId}),original);
  await save('claim-replay.json',claim);await save('record-replay.json',replayed);await sameCanonical(canonical);
  await mark('explicit-frozen-source-replay',{sourceRunId:original.runId,runId:replayed.runId,browserArtifactRef:replayed.browserArtifactRef,runtimeSha256:sha(claim.runtimeSource),workerSha256:sha(claim.workerSource),seed:replayed.inputs.seed,laterGraphPurpose:'storage/graph fixture only, no claim of new domain compilation'});
 });
 await t.test('Gateway and Workspace reject cross-user, authVersion, scope/generation and browser-only tool escalation',async()=>{
  const beforeKeys=(await f.bucket.list()).objects.map(x=>x.key).sort(),denials=[];
  const foreign=await post('project_ir_result',{runId:original.runId},packageIdentity,{user:'beta'});assert.equal(foreign.status,404);denials.push({boundary:'Gateway',case:'foreign owner',status:foreign.status});
  const direct=async(body,options={})=>f.request('/__fixture/project-ir-workspace',{method:'POST',body:{packageIdentity,operation:'project_ir_result',input:{runId:original.runId},...body},...options});
  for(const [name,body,options]of [['foreign owner',{}, {user:'beta'}],['stale generation',{scope:{...scopes.alpha,workspaceGeneration:2}},{}],['stale authVersion',{authVersion:2},{}]]){
   const response=await direct(body,options);assert.equal(response.status,403,JSON.stringify(response));denials.push({boundary:'Workspace production browser RPC',case:name,status:response.status});
  }
  for(const body of [{packageIdentity,operation:'project_ir_run',input:{browserArtifactRef:fixture.browserArtifactRef}},{packageIdentity,operation:'records',input:{},scope:{...scopes.alpha,workspaceGeneration:2}},{packageIdentity,operation:'project_ir_result',input:{runId:original.runId,objectKey:originalBlob.key}}]){
   const response=await f.request(irPath,{method:'POST',body});assert.equal(response.status,400);denials.push({boundary:'Gateway',case:'unexpected operation/scope/object key',status:response.status});
  }
  assert.deepEqual((await f.bucket.list()).objects.map(x=>x.key).sort(),beforeKeys);assert.equal((await recordBlob(f,original.runId)).sha256,originalBlob.sha256);
  await save('denials-scope.json',denials);await sameCanonical(canonical);await mark('real-gateway-and-workspace-scope-rejections',{denials});
 });
 await t.test('new canonical page invalidates the old package and Catalog revocation leaves original R2 records intact',async()=>{
  const oldPackage=packageIdentity,saved=await f.save('alpha','ir-storage-page-alpha-v2',pageFiles('alpha-v2'));assert.equal(saved.body.status,'committed');
  canonical=await captureCanonical();packageIdentity=canonical.packageIdentity;assert.notEqual(packageIdentity,oldPackage);
  const stale=await post('project_ir_result',{runId:original.runId},oldPackage);assert.equal(stale.status,409,JSON.stringify(stale));
  assert.deepEqual(await readIr('project_ir_result',{runId:original.runId}),original);
  const before=(await f.bucket.list()).objects.map(x=>x.key).sort();
  await f.db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
  const gateway=await post('project_ir_result',{runId:original.runId});assert.equal(gateway.status,404,JSON.stringify(gateway));
  const workspace=await f.request('/__fixture/project-ir-workspace',{method:'POST',body:{packageIdentity,operation:'project_ir_result',input:{runId:original.runId}}});assert.equal(workspace.status,403);
  assert.deepEqual((await f.bucket.list()).objects.map(x=>x.key).sort(),before);assert.equal((await recordBlob(f,original.runId)).sha256,originalBlob.sha256);
  await f.db.prepare("UPDATE catalog_memberships SET status='active' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
  assert.deepEqual(await readIr('project_ir_result',{runId:original.runId}),original);assert.deepEqual(await readIr('project_ir_result',{runId:replayed.runId}),replayed);
  await sameCanonical(canonical);await mark('old-package-and-catalog-revocation',{oldPackageIdentity:oldPackage,currentPackageIdentity:packageIdentity,stalePackageStatus:stale.status,gatewayRevokedStatus:gateway.status,workspaceRevokedStatus:workspace.status,originalRecordSha256:originalBlob.sha256});
 });
 await t.test('authoritative journals and counted deny-only execution namespaces prove no Turns, Sessions, container/tool allocation or provider/network request',async()=>{
  const footprint=await f.footprint(),counts=await f.read('/__fixture/project-ir-counts');
  for(const user of ['alpha','beta']){assert.equal(footprint.journal[user].turns,0);assert.equal(footprint.journal[user].sessions,0);assert.equal(footprint.journal[user].active,null);assert.deepEqual(counts[user].executionAttempts,{runtime:0,capacity:0,tools:0,containers:0});}
  assert.equal(counts.alpha.ir.registrations,2);assert.equal(counts.alpha.ir.tools,2);assert.ok(counts.alpha.ir.browser>0);assert.ok(counts.alpha.ir.rejectedBrowser>=4);assert.equal(footprint.outbound,0);assert.equal(footprint.manualPosts,3);assert.equal(footprint.fences.length,3);assert.ok(footprint.fences.every(x=>x.state==='released'&&x.terminal_status==='committed'));
  await sameCanonical(canonical);await save('footprint-final.json',footprint);await save('authority-counts.json',counts);await save('canonical-final.json',canonical);
  await mark('zero-execution-and-canonical-preservation',{turns:0,sessions:0,executionNamespaceAttempts:counts.alpha.executionAttempts,outboundRequests:footprint.outbound,explicitManualSaves:footprint.manualPosts,syntheticRegistrations:counts.alpha.ir.registrations,syntheticRunTools:counts.alpha.ir.tools,productionBrowserRpcCalls:counts.alpha.ir.browser});
 });
 observations.passed=true;observations.completedAt=new Date().toISOString();await save('summary.json',observations);
});

test('ordinary saved canonical IR drafts override stale projection and display replies revalidate authority after real RevisionStore awaits',{timeout:90000},async t=>{
 const save=evidenceWriter(),f=await manualPageFixture(t,{browserLocal:true,projectIrTest:true}),sourceAssets=await assets(),fixture=await projectIrFixture(sourceAssets);
 const path=f.base('alpha')+'/project-ir',draftPath='model/business-ir.draft.json',settingsPath='.riffoid-ir/settings.json';
 let packageIdentity,head;
 const observations={schema:'riffoid-ir.canonical-display-evidence/v1',environment:'local-workerd-sqlite-d1-r2',actualBrowserExecution:false,onlineAcceptance:false,agent:'synthetic registration of stale IR projection; ordinary canonical edits use actual manual-save routes',checks:[]};
 const mark=async(name,details={})=>{observations.checks.push({name,passed:true,...details});await save('canonical-display-summary.json',observations);};
 const post=(operation,input={},identity=packageIdentity)=>f.request(path,{method:'POST',body:{packageIdentity:identity,operation,input}});
 const display=async operation=>{const response=await post(operation);assert.equal(response.status,200,JSON.stringify(response));return response.body;};
 const capture=async()=>{head=(await f.read(f.base('alpha')+'/files')).revision;packageIdentity=(await f.read(f.base('alpha')+'/project-views')).package.packageIdentity;return {head,packageIdentity};};
 const assertHead=async()=>{assert.deepEqual((await f.read(f.base('alpha')+'/files')).revision,head);assert.equal((await f.read(f.base('alpha')+'/project-views')).package.packageIdentity,packageIdentity);};
 const draft=duration=>{const business=structuredClone(fixture.business);delete business.fingerprint;business.payload.sections.time.properties.duration_minutes=duration;return '\n'+JSON.stringify(business,null,3)+'\n';};
 const writeDraft=async(key,content,mode='ir')=>{const response=await f.save('alpha',key,{...pageFiles(key),[draftPath]:content,[settingsPath]:JSON.stringify({mode})+'\n'});assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.body.status,'committed');await capture();};
 const irKeys=async()=>(await f.bucket.list({prefix:'project-ir/v1/'})).objects.map(x=>x.key).sort();
 const barrier=operation=>f.read('/__fixture/project-ir-source-barrier?operation='+operation);
 let registeredKeys;
 await t.test('stale registered draft is not displayed when the ordinary canonical page has no IR draft',async()=>{
  for(const user of ['alpha','beta'])assert.equal((await f.save(user,'ir-display-base-'+user,pageFiles(user+'-display-base'))).body.status,'committed');
  await capture();
  const registration=structuredClone(fixture.registration);registration.state.modelMode='code';
  const response=await f.request('/__fixture/project-ir-agent',{method:'POST',body:{operation:'register',effectId:'synthetic-stale-display',registration}});assert.equal(response.body.status,'succeeded',JSON.stringify(response));
  registeredKeys=await irKeys();
  assert.equal((await display('draft')).draft,'');const show=await display('show');assert.equal(show.currentModel,null);assert.equal(show.defaultMode,'code');
  await assertHead();assert.deepEqual(await irKeys(),registeredKeys);await mark('missing-canonical-draft-does-not-revive-stale-projection',{revisionId:head.revisionId,packageIdentity});
 });
 await t.test('ordinary valid draft/settings save appears byte-for-byte in production show/draft without advancing the saved head',async()=>{
  const content=draft(95);await writeDraft('ir-display-valid-v1',content);
  const before=await f.footprint(),read=await display('draft'),show=await display('show');
  assert.equal(read.draft,content);assert.equal(show.currentModel.type,'ir');assert.equal(show.currentModel.summary.durationMinutes,95);assert.equal(show.defaultMode,'ir');assert.equal(Object.hasOwn(show.currentModel,'fingerprint'),false);
  assert.notEqual(read.draft,fixture.registration.state.draft);await assertHead();assert.deepEqual(await irKeys(),registeredKeys);
  const after=await f.footprint();assert.equal(after.manualPosts,before.manualPosts);assert.deepEqual(after.keys,before.keys);
  await save('canonical-display-valid.json',{draft:read,show,head,packageIdentity});await mark('valid-canonical-draft-display',{draftSha256:sha(content),durationMinutes:95,revisionId:head.revisionId,packageIdentity});
 });
 await t.test('malformed saved JSON remains visible as its real canonical bytes and unknown model instead of old IR facts',async()=>{
  const malformed='{\n  "version": "aircraft-business-ir/v1",\n  "payload":\n';await writeDraft('ir-display-malformed',malformed,'code');
  const read=await display('draft'),show=await display('show');assert.equal(read.draft,malformed);assert.equal(show.currentModel.type,'unknown');assert.equal(show.currentModel.ref,draftPath);assert.equal('summary'in show.currentModel,false);assert.equal(show.defaultMode,'code');
  await assertHead();assert.deepEqual(await irKeys(),registeredKeys);await save('canonical-display-malformed.json',{draft:read,show,head,packageIdentity});await mark('malformed-canonical-json-is-preserved',{draftSha256:sha(malformed),type:show.currentModel.type,revisionId:head.revisionId});
 });
 await t.test('repair and real Workerd reconstruction keep ordinary saved display authoritative over old projection',async()=>{
  const content=draft(120);await writeDraft('ir-display-repaired',content);
  const before=await f.footprint();await f.restart();
  const read=await display('draft'),show=await display('show');assert.equal(read.draft,content);assert.equal(show.currentModel.summary.durationMinutes,120);assert.equal(show.defaultMode,'ir');await assertHead();
  const after=await f.footprint();assert.deepEqual(after.keys,before.keys);assert.equal(after.manualPosts,before.manualPosts);assert.deepEqual(await irKeys(),registeredKeys);
  await save('canonical-display-repaired-after-restart.json',{draft:read,show,head,packageIdentity});await mark('repaired-canonical-display-survives-restart',{draftSha256:sha(content),revisionId:head.revisionId,packageIdentity});
 });
 await t.test('a canonical save during the actual archive await rejects the old package reply before exposing old draft bytes',async()=>{
  const oldIdentity=packageIdentity;await barrier('arm');const pending=post('draft');let blocked,rejected;
  try{
   blocked=await barrier('wait');assert.equal(blocked.entered,true);assert.equal(blocked.sourceKind,'manual-save');
   await writeDraft('ir-display-race-new-head',draft(125));assert.notEqual(packageIdentity,oldIdentity);
  }finally{await barrier('release');rejected=await pending;}
  assert.equal(rejected.status,409,JSON.stringify(rejected));assert.equal(Object.hasOwn(rejected.body,'draft'),false);assert.equal(JSON.stringify(rejected.body).includes('duration_minutes'),false);
  const current=await display('draft');assert.equal(current.draft,draft(125));await assertHead();assert.deepEqual(await irKeys(),registeredKeys);
  await save('canonical-display-stale-await.json',{oldPackageIdentity:oldIdentity,currentPackageIdentity:packageIdentity,blocked,rejected});await mark('post-await-package-is-revalidated',{oldPackageIdentity:oldIdentity,currentPackageIdentity:packageIdentity,status:rejected.status,noDraftDelivered:true});
 });
 await t.test('Catalog revocation during the actual archive await prevents display data delivery without changing source storage',async()=>{
  await barrier('arm');const pending=post('show');let blocked,rejected;
  try{
   blocked=await barrier('wait');assert.equal(blocked.entered,true);
   await f.db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
  }finally{await barrier('release');rejected=await pending;}
  const workspaceRejection=(await f.read('/__fixture/project-ir-counts')).alpha.ir.lastRejection;
  try{
   // The actual DO rejected Catalog ownership with 404. Its remote exception is
   // intentionally opaque at this Gateway boundary and maps to generic 503.
   assert.equal(rejected.status,503,JSON.stringify(rejected));assert.deepEqual(workspaceRejection,{operation:'show',message:'not_found',status:404});
   assert.equal(Object.hasOwn(rejected.body,'currentModel'),false);assert.equal(JSON.stringify(rejected.body).includes('durationMinutes'),false);assert.deepEqual(await irKeys(),registeredKeys);
  }finally{await f.db.prepare("UPDATE catalog_memberships SET status='active' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();}
  assert.equal((await display('show')).currentModel.summary.durationMinutes,125);await assertHead();
  await save('canonical-display-revoked-await.json',{blocked,rejected,workspaceRejection,head,packageIdentity});await mark('post-await-catalog-is-revalidated',{gatewayStatus:rejected.status,workspaceRejection,noModelDelivered:true,revisionId:head.revisionId});
 });
 await t.test('display reads never create Turns/Sessions, mutate canonical head, write IR projection or allocate execution services',async()=>{
  const footprint=await f.footprint(),counts=await f.read('/__fixture/project-ir-counts');
  assert.equal(footprint.manualPosts,6);assert.equal(footprint.fences.length,6);assert.ok(footprint.fences.every(x=>x.state==='released'&&x.terminal_status==='committed'));
  for(const user of ['alpha','beta']){assert.equal(footprint.journal[user].turns,0);assert.equal(footprint.journal[user].sessions,0);assert.equal(footprint.journal[user].active,null);assert.deepEqual(counts[user].executionAttempts,{runtime:0,capacity:0,tools:0,containers:0});}
  assert.equal(counts.alpha.ir.registrations,1);assert.equal(counts.alpha.ir.tools,0);assert.equal(footprint.outbound,0);assert.deepEqual(await irKeys(),registeredKeys);await assertHead();
  await save('canonical-display-footprint.json',{footprint,counts,head,packageIdentity});await mark('canonical-display-has-zero-execution-and-no-write',{turns:0,sessions:0,executionAttempts:counts.alpha.executionAttempts,outbound:footprint.outbound,ordinaryManualSaves:footprint.manualPosts});
 });
 observations.passed=true;observations.completedAt=new Date().toISOString();await save('canonical-display-summary.json',observations);
});
