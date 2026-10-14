import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineWrite,OfflinePublisher,verifyFixtureReadback} from '../../scripts/m1/riffoid-validation-offline-publisher.mjs';
import {hashJSON,hashBytes,stateMetadata,wireMetadata} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {buildPacket} from '../../scripts/m1/riffoid-validation-coordinator.mjs';
import {packetFixture,inputFixture,moduleBytes,readbackFixture,stepFixture,shapes} from './fixtures/riffoid-offline-fixtures.mjs';

test('pure multipart builder preserves references/resources and validates actual module bytes; production target rejected',async()=>{
  const p=packetFixture(),phase=p.phases.gatewayObserve,bytes=moduleBytes(phase);
  const write=buildOfflineWrite(p,'gatewayObserve',bytes,'fixture-account','fixture-write');
  const form=await new Response(write.body,{headers:{'content-type':write.contentType}}).formData();
  const metadata=JSON.parse(form.get('metadata'));assert.deepEqual(metadata,wireMetadata(phase.metadata));
  assert.deepEqual(metadata.bindings.find(b=>b.name==='ENTRY_SIGNING_PRIVATE_JWK'),{name:'ENTRY_SIGNING_PRIVATE_JWK',type:'inherit',version_id:'latest'});
  assert.ok(write.path.endsWith('?bindings_inherit=strict'));assert.equal(hashJSON(metadata),write.preparedMetadataSHA256);
  assert.equal(hashBytes(await form.get(phase.metadata.main_module).arrayBuffer()),phase.modules[0].sha256);
  assert.equal(write.productionAuthorized,false);assert.equal(write.mode,'STATIC_FIXTURE_ONLY');
  assert.throws(()=>buildOfflineWrite(p,'gatewayObserve',[Buffer.from('wrong')],'fixture-account','fixture-write'));
  assert.throws(()=>buildOfflineWrite(p,'gatewayObserve',bytes,'actual-account','fixture-write'));
  assert.throws(()=>new OfflinePublisher(p,'actual-account'));
});

test('P2 secret guard: inline key fields, nested key data and legacy secret_key version_id reject at baseline and builder',()=>{
  const changes=[b=>b.key_jwk={kty:'OKP',d:'synthetic-not-a-key'},b=>b.key_base64='synthetic-not-a-key',b=>b.value='synthetic',b=>b.text='synthetic',
    b=>b.version_id='old-fixed-version',b=>b.algorithm={name:'Ed25519',key_jwk:{d:'synthetic'}}];
  for(const change of changes){
    const input=inputFixture();change(input.baselines.entry.metadata.bindings.find(b=>b.type==='secret_key'));assert.throws(()=>buildPacket(input));
    const p=packetFixture(),phase=p.phases.entryObserve;change(phase.metadata.bindings.find(b=>b.type==='secret_key'));
    phase.preparedMetadataSHA256=hashJSON(phase.metadata);phase.metadataSHA256=hashJSON(stateMetadata(phase.metadata));
    assert.throws(()=>buildOfflineWrite(p,'entryObserve',moduleBytes(phase),'fixture-account','fixture-write'));
  }
});

test('P2 inheritance: latest must equal the frozen prior active version before any fixture PUT',async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account'),step=stepFixture(p,pub,'gatewayObserve');
  step.preflight.latestVersions.result.items[0].id='new-upload-not-active';
  await assert.rejects(()=>pub.recordFixture(step));assert.equal(pub.trace.filter(x=>x.method==='PUT').length,0);
  const normal=new OfflinePublisher(p,'fixture-account'),r=await normal.recordFixture(stepFixture(p,normal,'gatewayObserve'));
  assert.equal(r.quietPublisher,false);assert.equal(r.productionAuthorized,false);
});

test('all phases simulate serial pre-write GET → one PUT → independent GET; readback coverage remains incomplete and approval blocked',async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account');
  for(const phase of ['gatewayObserve','entryObserve','entryReady','entryStop','gatewayRestorePrivacy','entryRestorePrivacy','gatewayRestoreLogs','entryRestoreLogs']){
    const r=await pub.recordFixture(stepFixture(p,pub,phase));
    assert.equal(r.metadataSHA256,hashJSON(stateMetadata(p.phases[phase].metadata)));
    assert.equal(r.fullStateMatches,false);assert.equal(r.quietPublisher,false);assert.equal(r.productionAuthorized,false);
    assert.deepEqual(r.unobservedUploadFields,['keep_assets','main_module','containers']);
  }
  assert.equal(pub.cursor,8);assert.equal(pub.trace.filter(x=>x.method==='PUT').length,8);
  assert.deepEqual(pub.trace.slice(0,5).map(x=>x.method),['GET','GET','GET','GET','PUT']);
  assert.ok(pub.trace.every(x=>x.fixtureOnly));assert.equal(p.decisions.restorationStandard,'pending-user-decision');
});

test('GET bytes/config drive hashes; upload hash claims and opaque platform etag cannot hide drift',async()=>{
  const p=packetFixture(),prior={version:'gateway-v0',deployment:'gateway-d0'};
  const raw=readbackFixture(p,'gatewayObserve',prior);
  raw.metadataSHA256=p.phases.gatewayObserve.metadataSHA256;raw.modulesSHA256=p.phases.gatewayObserve.modulesSHA256;
  raw.content.body=Buffer.from('tampered GET bytes').toString('base64');
  await assert.rejects(()=>verifyFixtureReadback(p,'gatewayObserve',prior,raw));
  const changed=readbackFixture(p,'gatewayObserve',prior);changed.scriptAndVersionSettings.result.observability.logs.persist=true;
  changed.scriptAndVersionSettingsAgain=structuredClone(changed.scriptAndVersionSettings);
  await assert.rejects(()=>verifyFixtureReadback(p,'gatewayObserve',prior,changed));
  const reordered=readbackFixture(p,'gatewayObserve',prior);
  reordered.scriptAndVersionSettings.result=Object.fromEntries(Object.entries(reordered.scriptAndVersionSettings.result).reverse());
  reordered.scriptAndVersionSettingsAgain=structuredClone(reordered.scriptAndVersionSettings);
  const r=await verifyFixtureReadback(p,'gatewayObserve',prior,reordered);assert.equal(r.metadataSHA256,p.phases.gatewayObserve.metadataSHA256);
  assert.notEqual(r.modulesSHA256,shapes.version.result.resources.script.etag);
});

for(const outcome of ['timeout','network-disconnected','receipt-lost'])test(`unknown ${outcome}: only GET reconciliation of original identity; never another PUT or automatic resume`,async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account'),step=stepFixture(p,pub,'gatewayObserve');step.outcome=outcome;
  const unknown=await pub.recordFixture(step);assert.equal(unknown.status,'PENDING_ORIGINAL_WRITE');
  const count=pub.trace.length;
  await assert.rejects(()=>pub.recordFixture({...step,requestId:'new-request'}));
  await assert.rejects(()=>pub.reconcileFixture('wrong-identity',step.readback));
  const reconciled=await pub.reconcileFixture(step.requestId,step.readback);
  assert.equal(reconciled.productionAuthorized,false);assert.equal(pub.cursor,0);assert.ok(pub.pending);
  assert.equal(pub.trace.filter(x=>x.method==='PUT').length,1);
  assert.ok(pub.trace.slice(count).every(x=>x.method==='GET'));
  await assert.rejects(()=>pub.recordFixture(step));
});

test('pre-write guard drift sends no fixture PUT; post-write rejected readback freezes without replay',async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account'),s=stepFixture(p,pub,'gatewayObserve');
  s.preflight.settings.result.logpush=true;
  await assert.rejects(()=>pub.recordFixture(s));assert.equal(pub.trace.filter(x=>x.method==='PUT').length,0);
  const other=new OfflinePublisher(p,'fixture-account'),bad=stepFixture(p,other,'gatewayObserve');bad.readback.content.body=Buffer.from('wrong').toString('base64');
  await assert.rejects(()=>other.recordFixture(bad));assert.ok(other.pending);assert.equal(other.cursor,0);
  await assert.rejects(()=>other.recordFixture({...bad,requestId:'retry'}));assert.equal(other.trace.filter(x=>x.method==='PUT').length,1);
});

test('serial lock, stale identities, changing deployments, partial rollouts and missing fields fail closed',async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account'),step=stepFixture(p,pub,'gatewayObserve');
  const first=pub.recordFixture(step);await assert.rejects(()=>pub.recordFixture(step));await first;
  for(const edit of [
    raw=>raw.afterDeploymentAgain.result.deployments[0].id='changed',
    raw=>raw.afterDeployment.result.deployments[0].versions.push({version_id:'another',percentage:1}),
    raw=>delete raw.scriptAndVersionSettings.result.bindings,
    raw=>raw.scriptAndVersionSettings.result.keep_assets=true,
    raw=>raw.latestVersions.result.items[0].id='stale',
    raw=>raw.version.result.resources.script_runtime.exports={},
    raw=>raw.scriptSettings.result.logpush=true,
  ]){
    const raw=readbackFixture(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'});edit(raw);
    await assert.rejects(()=>verifyFixtureReadback(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'},raw));
  }
  const reused=new OfflinePublisher(p,'fixture-account'),r=stepFixture(p,reused,'gatewayObserve');
  for(const d of [r.readback.afterDeployment,r.readback.afterDeploymentAgain])d.result.deployments[0].versions[0].version_id='gateway-v0';
  r.readback.version.result.id='gateway-v0';r.readback.latestVersions.result.items[0].id='gateway-v0';
  await assert.rejects(()=>reused.recordFixture(r));assert.ok(reused.pending);
});

test('multipart GET module parts are independently parsed and extras are rejected',async()=>{
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account'),step=stepFixture(p,pub,'gatewayObserve');
  const write=buildOfflineWrite(p,'gatewayObserve',moduleBytes(p.phases.gatewayObserve),'fixture-account','fixture-source');
  step.readback.content={status:200,bodyEncoding:'base64',contentType:write.contentType,body:write.body.toString('base64')};
  const receipt=await pub.recordFixture(step);assert.equal(receipt.modulesSHA256,p.phases.gatewayObserve.modulesSHA256);
  const raw=readbackFixture(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'});
  const f=new FormData();f.append('gateway-validation.mjs',new Blob(moduleBytes(p.phases.gatewayObserve)),'gateway-validation.mjs');f.append('extra.mjs',new Blob(['extra']),'extra.mjs');
  const body=new Response(f);raw.content={status:200,bodyEncoding:'base64',contentType:body.headers.get('content-type'),body:Buffer.from(await body.arrayBuffer()).toString('base64')};
  await assert.rejects(()=>verifyFixtureReadback(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'},raw));
});

async function pendingIdentityFixture(phase='gatewayObserve'){
  const p=packetFixture(),pub=new OfflinePublisher(p,'fixture-account');
  for(const id of ['gatewayObserve','entryObserve','entryReady','entryStop']){
    if(id===phase)break;
    await pub.recordFixture(stepFixture(p,pub,id));
  }
  const step=stepFixture(p,pub,phase);step.outcome='receipt-lost';await pub.recordFixture(step);
  return {pub,step};
}
function readbackIdentity(raw,{version,deployment}){
  for(const d of [raw.afterDeployment,raw.afterDeploymentAgain]){
    if(version)d.result.deployments[0].versions[0].version_id=version;
    if(deployment)d.result.deployments[0].id=deployment;
  }
  if(version){raw.version.result.id=version;raw.latestVersions.result.items[0].id=version;}
}
async function rejectsUnknownIdentity(pub,step,message){
  const state=structuredClone({pending:pub.pending,cursor:pub.cursor,current:pub.current,identities:pub.identities,artifacts:pub.artifacts,lastAt:pub.lastAt});
  const at=pub.trace.length,puts=pub.trace.filter(x=>x.method==='PUT').length;
  await assert.rejects(()=>pub.reconcileFixture(step.requestId,step.readback),message);
  assert.deepEqual({pending:pub.pending,cursor:pub.cursor,current:pub.current,identities:pub.identities,artifacts:pub.artifacts,lastAt:pub.lastAt},state);
  assert.equal(pub.trace.filter(x=>x.method==='PUT').length,puts);assert.ok(pub.trace.slice(at).every(x=>x.method==='GET'));
}
test('P2 unknown identity: baseline version/deployment cannot label temporary bytes/settings',async()=>{
  const {pub,step}=await pendingIdentityFixture();
  readbackIdentity(step.readback,{version:'gateway-v0',deployment:'gateway-d0'});
  await rejectsUnknownIdentity(pub,step,/version identity changed content/);
});
test('P2 unknown identity: historical published version cannot acquire restored bytes/settings',async()=>{
  const {pub,step}=await pendingIdentityFixture('gatewayRestorePrivacy');
  readbackIdentity(step.readback,{version:'gatewayObserve-version'});
  await rejectsUnknownIdentity(pub,step,/version identity changed content/);
});
test('P2 unknown identity: baseline and historical deployment cannot rebind to another version',async()=>{
  for(const [phase,deployment]of [['gatewayObserve','gateway-d0'],['gatewayRestorePrivacy','gatewayObserve-deployment']]){
    const {pub,step}=await pendingIdentityFixture(phase);readbackIdentity(step.readback,{deployment});
    await rejectsUnknownIdentity(pub,step,/deployment identity changed version/);
  }
});
test('P2 unknown identity: consistent GET leaves pending, cursor and identity ledger unchanged',async()=>{
  const {pub,step}=await pendingIdentityFixture(),at=pub.trace.length;
  const state=structuredClone({pending:pub.pending,cursor:pub.cursor,current:pub.current,identities:pub.identities,artifacts:pub.artifacts,lastAt:pub.lastAt});
  for(let i=0;i<2;i++){
    const r=await pub.reconcileFixture(step.requestId,step.readback);
    assert.equal(r.status,'READ_ONLY_STATE_CONSISTENT_PENDING_ORIGINAL_WRITE');assert.equal(r.productionAuthorized,false);
    assert.deepEqual({pending:pub.pending,cursor:pub.cursor,current:pub.current,identities:pub.identities,artifacts:pub.artifacts,lastAt:pub.lastAt},state);
  }
  assert.equal(pub.trace.filter(x=>x.method==='PUT').length,1);assert.ok(pub.trace.slice(at).every(x=>x.method==='GET'));
});
