// STATIC FIXTURES ONLY. There is deliberately no fetch, HTTP client, credential
// loader, live transport callback, or command-line deployment entry point.
import assert from 'node:assert/strict';
import {hashJSON,hashBytes,stateMetadata,wireMetadata,pendingDecisions} from './riffoid-validation-evidence.mjs';
const phases=['gatewayObserve','entryObserve','entryReady','entryStop','gatewayRestorePrivacy','entryRestorePrivacy','gatewayRestoreLogs','entryRestoreLogs'];
const api=(account,worker)=>`/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(worker)}`;
function envelope(raw){assert.equal(raw.success,true);assert.ok(raw.result);return raw.result;}
function deployment(raw){
  const list=envelope(raw).deployments;assert.ok(Array.isArray(list)&&list.length);
  const d=list[0];assert.equal(d.strategy,'percentage');assert.equal(d.versions.length,1);
  assert.equal(d.versions[0].percentage,100);assert.ok(d.id&&d.versions[0].version_id);
  return {deployment:d.id,version:d.versions[0].version_id};
}
function validateIdentity(registry,receipt){
  if(registry.versions.has(receipt.version))assert.deepEqual(registry.versions.get(receipt.version),
    [receipt.metadataSHA256,receipt.modulesSHA256],'version identity changed content');
  if(registry.deployments.has(receipt.deployment))assert.equal(registry.deployments.get(receipt.deployment),
    receipt.version,'deployment identity changed version');
}
export function buildOfflineWrite(packet,phaseId,moduleBytes,accountId,requestId){
  assert.match(accountId,/^fixture-[a-z0-9-]+$/,'only symbolic fixture accounts; no production executor');
  assert.ok(phases.includes(phaseId));assert.ok(requestId);assert.deepEqual(packet.decisions,pendingDecisions);
  const p=packet.phases[phaseId];assert.equal(moduleBytes.length,p.modules.length);
  assert.equal(hashJSON(p.metadata),p.preparedMetadataSHA256);assert.equal(hashJSON(stateMetadata(p.metadata)),p.metadataSHA256);
  assert.equal(hashJSON(p.modules),p.modulesSHA256);assert.equal(p.metadata.keep_assets,true);
  const wire=wireMetadata(p.metadata);
  const boundary='riffoid-offline-'+hashJSON({phaseId,requestId}).slice(0,24),parts=[];
  const field=(name,type,bytes)=>{
    assert.match(name,/^[A-Za-z0-9_.-]+$/);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),Buffer.from(bytes),Buffer.from('\r\n'));
  };
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(wire)}\r\n`));
  for(let i=0;i<p.modules.length;i++){
    const m=p.modules[i],bytes=moduleBytes[i];assert.equal(bytes.length,m.bytes);assert.equal(hashBytes(bytes),m.sha256);
    field(m.name,'application/javascript+module',bytes);
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {mode:'STATIC_FIXTURE_ONLY',productionAuthorized:false,phase:phaseId,requestId,method:'PUT',
    path:api(accountId,packet.baselineGuards[p.worker].worker)+'?bindings_inherit=strict',contentType:`multipart/form-data; boundary=${boundary}`,
    body:Buffer.concat(parts),blockedBy:['restorationStandard','unknownLogClosure'],
    sourcePlanMetadataSHA256:hashJSON(p.metadata),preparedMetadataSHA256:hashJSON(wire),preparedModulesSHA256:hashJSON(p.modules),
    inheritance:'latest-only; live atomic binding/publisher quiescence not established'};
}
async function contentModules(raw,expected){
  assert.equal(raw.status,200);assert.equal(raw.bodyEncoding,'base64');
  const bytes=Buffer.from(raw.body,'base64');assert.equal(bytes.toString('base64'),raw.body);
  const contentType=raw.contentType;assert.ok(typeof contentType==='string');
  let values;
  if(contentType.startsWith('multipart/form-data;')){
    const form=await new Response(bytes,{headers:{'content-type':contentType}}).formData();values=[];
    for(const [name,v]of form){
      if(name==='metadata')continue;
      assert.ok(typeof v!=='string');values.push({name,bytes:Buffer.from(await v.arrayBuffer())});
    }
  }else{
    assert.ok(/^application\/(javascript|javascript\+module)(;|$)/.test(contentType));assert.equal(expected.length,1);
    values=[{name:expected[0].name,bytes}];
  }
  assert.equal(values.length,expected.length);assert.equal(new Set(values.map(v=>v.name)).size,values.length);
  return expected.map(m=>{
    const v=values.find(v=>v.name===m.name);assert.ok(v,'missing module readback');
    // path is a local descriptor association; bytes and SHA come from GET bytes.
    return {bytes:v.bytes.length,name:v.name,path:m.path,sha256:hashBytes(v.bytes)};
  });
}
export async function verifyFixtureReadback(packet,phaseId,prior,raw){
  const p=packet.phases[phaseId];assert.ok(p);
  const before=deployment(raw.beforeDeployment),after=deployment(raw.afterDeployment),afterAgain=deployment(raw.afterDeploymentAgain);
  assert.deepEqual(before,prior);assert.deepEqual(afterAgain,after,'deployment changed during readback');
  const version=envelope(raw.version);assert.equal(version.id,after.version);
  const list=envelope(raw.latestVersions).items;assert.ok(Array.isArray(list)&&list.length);assert.equal(list[0].id,after.version);
  const settings=envelope(raw.scriptAndVersionSettings),again=envelope(raw.scriptAndVersionSettingsAgain);
  assert.deepEqual(settings,again,'script-level settings changed during readback');
  const globals=envelope(raw.scriptSettings);assert.deepEqual(globals,envelope(raw.scriptSettingsAgain),'global settings changed during readback');
  for(const field of ['observability','logpush','tail_consumers'])assert.deepEqual(globals[field],settings[field],'independent global/script metadata mismatch');
  assert.ok(!('keep_assets'in settings),'upload intent cannot be supplied as readback evidence');
  assert.deepEqual(settings,stateMetadata(p.metadata),'full observable metadata mismatch');
  assert.deepEqual(version.resources.bindings,settings.bindings);
  for(const field of ['compatibility_date','compatibility_flags','exports']){
    assert.deepEqual(version.resources.script_runtime[field],settings[field],'version/runtime readback mismatch');
  }
  const modules=await contentModules(raw.content,p.modules);
  assert.deepEqual(modules,p.modules,'GET module bytes differ from prepared code');
  const metadataSHA256=hashJSON(settings),modulesSHA256=hashJSON(modules);
  assert.equal(metadataSHA256,p.metadataSHA256);assert.equal(modulesSHA256,p.modulesSHA256);
  assert.ok(settings.logpush===false&&settings.tail_consumers.length===0,'external logging sink present');
  assert.ok(!settings.observability.logs.destinations?.some(d=>d!=='cloudflare'),'external log destination present');
  return {...after,activeVersion:after.version,latestVersion:list[0].id,metadataSHA256,modulesSHA256,
    fullStateMatches:false,pipelineGuardPassed:true,
    unobservedUploadFields:['keep_assets','main_module','containers'],
    limitations:['readback projection only; no full asset/container preservation proof','fixtures do not establish publisher quiescence or production authenticity']};
}
export class OfflinePublisher {
  constructor(packet,accountId){
    assert.match(accountId,/^fixture-[a-z0-9-]+$/);this.packet=structuredClone(packet);this.accountId=accountId;
    this.packetSHA256=hashJSON(packet);
    this.cursor=0;this.trace=[];this.pending=null;this.used=new Set();this.identities={};this.lastAt=0;this.busy=false;this.artifacts={};
    this.current=Object.fromEntries(Object.entries(packet.baselineGuards).map(([w,b])=>[w,{version:b.version,deployment:b.deployment}]));
    for(const [w,b]of Object.entries(packet.baselineGuards)){
      this.identities[w]={versions:new Map([[b.version,[b.metadataSHA256,b.modulesSHA256]]]),deployments:new Map([[b.deployment,b.version]])};
      this.artifacts[w]=this.packet.phases[w+'RestoreLogs'];
    }
  }
  async recordFixture({phase,requestId,startedAt,readbackAt,outcome,moduleBytes,preflight,readback}){
    assert.equal(this.busy,false,'concurrent fixture publishers forbidden');
    assert.equal(hashJSON(this.packet),this.packetSHA256,'frozen packet changed');
    assert.equal(this.pending,null,'unknown write permits only read-only original-request reconciliation');
    assert.equal(phase,phases[this.cursor],'phases must remain serial');assert.ok(!this.used.has(requestId));
    assert.ok(Number.isSafeInteger(startedAt)&&startedAt>=this.lastAt&&Number.isSafeInteger(readbackAt)&&readbackAt>=startedAt);
    const write=buildOfflineWrite(this.packet,phase,moduleBytes,this.accountId,requestId);
    const worker=this.packet.phases[phase].worker,prior=structuredClone(this.current[worker]);
    this.busy=true;
    try{
    const base=api(this.accountId,this.packet.baselineGuards[worker].worker),artifact=this.artifacts[worker];
    for(const suffix of ['/deployments','/versions','/settings','/content/v2'])this.trace.push({method:'GET',path:base+suffix,fixtureOnly:true});
    assert.deepEqual(deployment(preflight.deployment),prior,'stale pre-write deployment');
    const latest=envelope(preflight.latestVersions).items;assert.ok(Array.isArray(latest)&&latest.length);assert.equal(latest[0].id,prior.version,'inherit latest is not the frozen prior active version');
    assert.deepEqual(envelope(preflight.settings),stateMetadata(artifact.metadata),'pre-write script settings drift');
    assert.deepEqual(await contentModules(preflight.content,artifact.modules),artifact.modules,'pre-write code drift');
    this.used.add(requestId);this.trace.push({method:'PUT',path:write.path,requestId,fixtureOnly:true});
    this.pending={phase,requestId,worker,prior,startedAt};
    if(outcome!=='acknowledged'){
      assert.ok(['timeout','network-disconnected','receipt-lost'].includes(outcome));
      return {status:'PENDING_ORIGINAL_WRITE',requestId,productionAuthorized:false};
    }
    const receipt=await this.read(phase,prior,readback);const registry=this.identities[worker];
    validateIdentity(registry,receipt);
    registry.versions.set(receipt.version,[receipt.metadataSHA256,receipt.modulesSHA256]);registry.deployments.set(receipt.deployment,receipt.version);
    this.current[worker]={version:receipt.version,deployment:receipt.deployment};this.cursor++;this.lastAt=readbackAt;this.artifacts[worker]=this.packet.phases[phase];this.pending=null;
    return {...receipt,phase,requestId,run:this.packet.run,worker:this.packet.baselineGuards[worker].worker,
      priorVersion:prior.version,priorDeployment:prior.deployment,startedAt,readbackAt,quietPublisher:false,
      provenance:'STATIC_FIXTURE_ONLY',productionAuthorized:false};
    }finally{this.busy=false;}
  }
  async read(phase,prior,raw){
    const worker=this.packet.phases[phase].worker,base=api(this.accountId,this.packet.baselineGuards[worker].worker);
    for(const suffix of ['/deployments','/versions','/versions/'+encodeURIComponent(deployment(raw.afterDeployment).version),'/settings','/script-settings','/content/v2','/deployments','/settings','/script-settings'])
      this.trace.push({method:'GET',path:base+suffix,fixtureOnly:true});
    return verifyFixtureReadback(this.packet,phase,prior,raw);
  }
  async reconcileFixture(requestId,readback){
    assert.equal(this.busy,false);assert.equal(hashJSON(this.packet),this.packetSHA256,'frozen packet changed');
    assert.ok(this.pending&&this.pending.requestId===requestId,'only original pending write identity');
    const p=this.pending;const observed=await this.read(p.phase,p.prior,readback);
    validateIdentity(this.identities[p.worker],observed);
    // Consistent current control-plane state is not an original mutation receipt
    // or approval. Do not clear pending, advance cursor, replay PUT, or restore.
    return {status:'READ_ONLY_STATE_CONSISTENT_PENDING_ORIGINAL_WRITE',requestId,observed,productionAuthorized:false};
  }
}
