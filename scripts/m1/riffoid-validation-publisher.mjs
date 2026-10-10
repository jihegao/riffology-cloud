// Existing Workers only. CLI/package preparation is dry-run. Live operation
// requires an externally approved capability and a caller-authenticated transport.
import assert from 'node:assert/strict';
import {mkdir,open,unlink,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashJSON,hashBytes,stateMetadata,wireMetadata,approvalRecord,restorationEligibility,parseProtocolReceipt,protocolTerminalEvidence} from './riffoid-validation-evidence.mjs';
import {jsonResult} from './riffoid-validation-transport.mjs';
import {collectPipelineGuard,collectContainerAssociations,assetPreservationEvidence,collectNamespaces} from './riffoid-validation-resources.mjs';
export const publicationPhases=['gatewayObserve','entryObserve','entryReady','entryStop','gatewayRestorePrivacy','entryRestorePrivacy','gatewayRestoreLogs','entryRestoreLogs'];
const base=(account,worker)=>`/accounts/${account}/workers/scripts/${worker}`;
const identity=raw=>{const ds=raw.result.deployments;assert.ok(Array.isArray(ds)&&ds.length);const d=ds[0];assert.equal(d.strategy,'percentage');assert.equal(d.versions.length,1);assert.equal(d.versions[0].percentage,100);return {deployment:d.id,version:d.versions[0].version_id};};
export function buildWrite(packet,phase,moduleBytes,accountId,requestId){
  assert.ok(publicationPhases.includes(phase));assert.match(accountId,/^[a-f0-9]{32}$/);assert.match(requestId,/^[A-Za-z0-9_-]{1,128}$/);
  assert.ok(packet.riskAuthorization);approvalRecord(packet.riskAuthorization.record);
  const p=packet.phases[phase];assert.equal(hashJSON(p.metadata),p.preparedMetadataSHA256);assert.equal(hashJSON(stateMetadata(p.metadata)),p.metadataSHA256);assert.equal(hashJSON(p.modules),p.modulesSHA256);
  assert.equal(p.metadata.keep_assets,true);assert.ok(!Object.hasOwn(p.metadata,'assets'),'explicit assets upload/configuration forbidden');assert.equal(moduleBytes.length,p.modules.length);
  const boundary='riffoid-'+hashJSON({packet:hashJSON(packet),phase,requestId}).slice(0,24),wire=wireMetadata(p.metadata),parts=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(wire)}\r\n`)];
  for(let i=0;i<p.modules.length;i++){
    const m=p.modules[i];assert.ok(!['metadata','assets'].includes(m.name),'reserved multipart part forbidden');assert.match(m.name,/^[A-Za-z0-9_.-]+$/);assert.equal(moduleBytes[i].length,m.bytes);assert.equal(hashBytes(moduleBytes[i]),m.sha256);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${m.name}"; filename="${m.name}"\r\nContent-Type: application/javascript+module\r\n\r\n`),Buffer.from(moduleBytes[i]),Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {method:'PUT',path:base(accountId,packet.baselineGuards[p.worker].worker)+'?bindings_inherit=strict',contentType:`multipart/form-data; boundary=${boundary}`,body:Buffer.concat(parts)};
}
async function modulesFrom(raw,expected){
  assert.equal(raw.status,200);assert.ok(raw.mainModule,'cf-entrypoint readback required; never infer main module');
  const form=await new Response(raw.bytes,{headers:{'content-type':raw.contentType}}).formData(),values=[];
  for(const [name,value]of form){if(name==='metadata')continue;assert.ok(typeof value!=='string');values.push({name,bytes:Buffer.from(await value.arrayBuffer())});}
  assert.equal(values.length,expected.length);assert.equal(new Set(values.map(x=>x.name)).size,values.length);
  return expected.map(m=>{const x=values.find(v=>v.name===m.name);assert.ok(x);return {...m,bytes:x.bytes.length,sha256:hashBytes(x.bytes)};});
}
async function collectResourceEvidence(transport,accountId,worker,artifact,runtime,preservation){
  const resources=[];
  for(const row of preservation?.reads??[]){
    assert.match(row.path,new RegExp('^/accounts/'+accountId+'/(containers/applications/[a-zA-Z0-9_-]+|workers/durable_objects/namespaces/[a-zA-Z0-9_-]+)$'));
    const result=jsonResult(await transport.request({path:row.path})).result;assert.equal(hashJSON(result),row.sha256,'existing resource identity/config drift');resources.push({path:row.path,sha256:hashJSON(result)});
  }
  const namespaceIds=artifact.metadata.bindings.filter(b=>b.type==='durable_object_namespace').map(b=>b.namespace_id);let namespaceCoverage=namespaceIds.length===0;
  if(namespaceIds.length){const ns=await collectNamespaces(transport,accountId,namespaceIds,preservation?.namespaces);namespaceCoverage=ns.coverageComplete;resources.push({path:ns.path,sha256:ns.sha256});}
  let containers={associationMatches:false,configurationMatches:false};
  if(Array.isArray(runtime.containers)&&(runtime.containers.length===0||preservation?.containerSnapshots)){
    containers=await collectContainerAssociations(transport,accountId,artifact,runtime,preservation?.containerSnapshots);for(const x of containers.snapshots)resources.push({path:`/accounts/${accountId}/containers/applications/${x.id}`,sha256:hashJSON(x)});
  }
  let pipeline={pipelineGuardPassed:false};if(preservation?.pipelineScope){assert.equal(preservation.pipelineScope.accountId,accountId);assert.equal(preservation.pipelineScope.worker,worker);pipeline=await collectPipelineGuard(transport,preservation.pipelineScope);}
  return {resources,resourcesSHA256:hashJSON(resources),namespaceCoverage,containers,pipeline};
}
export async function collectReadback(transport,accountId,worker,artifact,preservation){
  const path=base(accountId,worker),get=async suffix=>jsonResult(await transport.request({path:path+suffix}));
  const first=identity(await get('/deployments')),versions=await get('/versions');assert.equal(versions.result.items[0].id,first.version,'latest inheritance source differs from active');
  const version=await get('/versions/'+first.version),settings=await get('/settings'),global=await get('/script-settings');
  assert.equal(version.result.id,first.version);
  // Reject key values before any evidence is persisted or returned.
  wireMetadata({...artifact.metadata,bindings:settings.result.bindings});
  const observed=structuredClone(settings.result);
  if(!('exports'in observed)&&'exports'in artifact.metadata)observed.exports=version.result.resources.script_runtime.exports??{};
  assert.equal(hashJSON(observed),hashJSON(stateMetadata(artifact.metadata)),'observable metadata/runtime export drift');
  assert.equal(hashJSON(version.result.resources.bindings),hashJSON(settings.result.bindings),'immutable version bindings differ');
  for(const k of ['compatibility_date','compatibility_flags'])assert.deepEqual(version.result.resources.script_runtime[k],settings.result[k]);
  if(version.result.resources.script_runtime.exports)assert.deepEqual(version.result.resources.script_runtime.exports,artifact.metadata.exports);
  for(const k of ['observability','logpush','tail_consumers'])assert.deepEqual(global.result[k],settings.result[k]);
  const content=await transport.request({path}),modules=await modulesFrom(content,artifact.modules);
  assert.equal(content.mainModule,artifact.metadata.main_module);assert.deepEqual(modules,artifact.modules);
  assert.equal(settings.result.logpush,false);assert.deepEqual(settings.result.tail_consumers,[]);
  assert.ok(!settings.result.observability.logs.destinations?.some(x=>x!=='cloudflare'));
  const runtime=version.result.resources.script_runtime;
  const firstResources=await collectResourceEvidence(transport,accountId,worker,artifact,runtime,preservation);
  const inventory=jsonResult(await transport.request({path:`/accounts/${accountId}/workers/scripts`}));assert.ok(Array.isArray(inventory.result));
  const script=inventory.result.find(s=>s.id===worker);assert.ok(script,'authoritative Worker inventory missing target');
  const assets=assetPreservationEvidence(artifact,runtime,script,preservation?.assets);
  const secondResources=await collectResourceEvidence(transport,accountId,worker,artifact,runtime,preservation);
  assert.equal(secondResources.resourcesSHA256,firstResources.resourcesSHA256,'resources changed during independent GETs');
  assert.equal(hashJSON(secondResources.pipeline),hashJSON({...firstResources.pipeline,...(secondResources.pipeline.observedAt!==undefined?{observedAt:secondResources.pipeline.observedAt}:{})}),'pipeline changed during independent GETs');
  const again=jsonResult(await transport.request({path:`/accounts/${accountId}/workers/scripts`})).result;assert.ok(Array.isArray(again));assert.equal(again.find(s=>s.id===worker)?.has_assets,script.has_assets,'asset presence changed during resource GETs');
  const {resources,namespaceCoverage,containers,pipeline}=secondResources;
  const coverage={mainModule:true,metadata:true,modules:true,namedResources:namespaceCoverage,assets:assets.coverageComplete,containers:containers.associationMatches&&containers.configurationMatches};
  // Public Worker settings omit container associations and there is no public
  // GET asset inventory in the reviewed contract. Resource GETs establish their
  // existing identities, but do not prove the Worker's complete association.
  // Bracket every namespace/container/pipeline read, not merely the source reads.
  assert.equal(hashJSON((await get('/settings')).result),hashJSON(settings.result),'settings changed during resource GETs');
  assert.equal(hashJSON((await get('/script-settings')).result),hashJSON(global.result),'global settings changed during resource GETs');
  assert.deepEqual(identity(await get('/deployments')),first,'deployment changed during resource GETs');
  assert.equal((await get('/versions')).result.items[0].id,first.version,'latest inheritance source changed during resource GETs');
  const fullStateMatches=Object.values(coverage).every(Boolean);
  return {...first,activeVersion:first.version,latestVersion:first.version,metadataSHA256:hashJSON(observed),modulesSHA256:hashJSON(modules),
    resourcesSHA256:hashJSON(resources),runtimeResources:{containers:structuredClone(runtime.containers),exports:structuredClone(runtime.exports)},coverage,fullStateMatches,assets,containers,pipeline,workerLoggingGuardPassed:true,pipelineGuardPassed:pipeline.pipelineGuardPassed,quietPublisher:false,productionAuthorized:false,
    limitations:['independent account/zone pipeline and publisher quiescence evidence required',...(fullStateMatches?[]:['full asset/container association proof unavailable; fail closed'])]};
}
export class FileJournal{
  constructor(directory){this.directory=directory;this.lockOwner=null;}
  async syncDirectory(){const d=await open(this.directory,'r');try{await d.sync();}finally{await d.close();}}
  async lock(){
    assert.equal(this.lockOwner,null);await mkdir(this.directory,{recursive:true,mode:0o700});
    const owner=randomUUID(),f=await open(join(this.directory,'publisher.lock'),'wx',0o600);
    try{await f.writeFile(JSON.stringify({schemaVersion:1,owner})+'\n');await f.sync();await this.syncDirectory();this.lockOwner=owner;}finally{await f.close();}
  }
  async lockState(){
    const path=join(this.directory,'publisher.lock');let st;
    try{st=await lstat(path);}catch(e){if(e.code==='ENOENT')return {status:'ABSENT',owned:false};throw e;}
    assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<1024,'invalid lock file; do not clear');
    const bytes=await readFile(path);let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{return {status:'UNVERIFIED_LEGACY_OR_INVALID',owned:false,sha256:hashBytes(bytes)};}
    const valid=Object.keys(value).sort().join(',')==='owner,schemaVersion'&&value.schemaVersion===1&&typeof value.owner==='string'&&/^[a-f0-9-]{36}$/.test(value.owner);
    return {status:valid?'PRESENT_OWNER_RECORDED':'UNVERIFIED_LEGACY_OR_INVALID',owned:valid&&this.lockOwner!==null&&this.lockOwner===value.owner,sha256:hashBytes(bytes),liveness:'NOT_PROVEN_NO_AUTOMATIC_UNLOCK'};
  }
  async unlock(){
    assert.ok(this.lockOwner,'only the instance that acquired this lock may release it');const state=await this.lockState();
    assert.equal(state.status,'PRESENT_OWNER_RECORDED');assert.equal(state.owned,true,'lock ownership changed; do not clear');
    await unlink(join(this.directory,'publisher.lock'));this.lockOwner=null;await this.syncDirectory();
  }
  async append(id,kind,value){assert.match(id,/^[A-Za-z0-9_-]{1,128}$/);assert.match(kind,/^[a-z-]+$/);await mkdir(this.directory,{recursive:true,mode:0o700});const f=await open(join(this.directory,id+'.'+kind+'.json'),'wx',0o600);try{await f.writeFile(JSON.stringify(value)+'\n');await f.sync();await this.syncDirectory();}finally{await f.close();}}
  async hasPending(){const {readdir}=await import('node:fs/promises');try{const names=await readdir(this.directory);return names.some(n=>n.endsWith('.unknown.json')||n.endsWith('.intent.json')&&!names.includes(n.replace('.intent.json','.terminal.json')));}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  async records(){
    const names=(await readdir(this.directory)).sort().filter(n=>/^[A-Za-z0-9_-]{1,128}\.(intent|terminal|skip|unknown)\.json$/.test(n));assert.ok(names.length<=25);
    const rows=[];for(const name of names){const path=join(this.directory,name),s=await lstat(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<65536);rows.push({name,value:JSON.parse(await readFile(path,'utf8'))});}return rows;
  }
}
export class Publisher{
  constructor({packet,accounts,transport,journal,liveCapability=null}){this.packet=structuredClone(packet);this.packetHash=hashJSON(packet);this.accounts=accounts;this.transport=transport;this.journal=journal;this.liveCapability=liveCapability;this.cursor=0;this.busy=false;this.pending=null;this.current=structuredClone(packet.baselineGuards);this.artifacts=Object.fromEntries(['entry','gateway'].map(w=>[w,packet.phases[w+'RestoreLogs']]));this.registry={};for(const w of ['entry','gateway']){const b=packet.baselineGuards[w],p=packet.preservation?.[w],rows=(p?.reads??[]).map(r=>({path:r.path,sha256:r.sha256}));if(p?.namespaces)rows.push({path:`/accounts/${accounts[w]}/workers/durable_objects/namespaces`,sha256:hashJSON([...p.namespaces].sort((a,b)=>a.id.localeCompare(b.id)))});if(p?.containerSnapshots)for(const c of packet.phases[w+'RestoreLogs'].metadata.containers){const x=p.containerSnapshots.find(s=>s.name===c.name);assert.ok(x);rows.push({path:`/accounts/${accounts[w]}/containers/applications/${x.id}`,sha256:hashJSON(x)});}const expected=hashJSON(rows);if(b.resourcesSHA256)assert.equal(b.resourcesSHA256,expected);this.registry[w]={versions:new Map([[b.version,[b.metadataSHA256,b.modulesSHA256,expected]]]),deployments:new Map([[b.deployment,b.version]])};}}
  async assertLockOwned(){const lock=await this.journal.lockState();assert.equal(lock.status,'PRESENT_OWNER_RECORDED','publisher lock lost; stop original request');assert.equal(lock.owned,true,'publisher lock owner changed; stop original request');}
  async prepare(phase,requestId,moduleBytes){assert.equal(this.transport.mode,'dry-run','prepare cannot dispatch an HTTP upload');const w=buildWrite(this.packet,phase,moduleBytes,this.accounts[this.packet.phases[phase].worker],requestId);return {dryRun:true,method:w.method,path:w.path,bytes:w.body.length,bodySHA256:hashBytes(w.body)};}
  async skipExpiredStop(state,now=Date.now()){
    assert.equal(this.cursor,3);assert.equal(this.pending,null);assert.equal(this.busy,false);
    assert.ok(now>=this.packet.config.expires);assert.equal(state.packetSHA256,this.packetHash);assert.equal(state.phase,'stopped');
    assert.equal(await this.journal.hasPending(),false);
    const checkpoint={packetSHA256:this.packetHash,phase:'entryStop',expires:this.packet.config.expires,recordedAt:now,statePhase:state.phase,current:structuredClone(this.current)};
    await this.journal.append(this.packet.run+'_natural_expiry','skip',checkpoint);
    this.cursor=4;return {phase:'entryStop',status:'NATURAL_EXPIRY_NO_UPLOAD',productionActionsExecuted:0};
  }
  async publish({phase,requestId,moduleBytes,now=Date.now(),coordinationState}){
    assert.equal(this.transport.mode,'live','default preparation cannot write');assert.equal(this.busy,false);assert.equal(this.pending,null);assert.equal(await this.journal.hasPending(),false,'original unresolved write journal');
    assert.equal(hashJSON(this.packet),this.packetHash);assert.equal(phase,publicationPhases[this.cursor]);
    const cap=this.liveCapability;assert.ok(cap&&cap.productionWritesPermitted===true&&cap.packetSHA256===this.packetHash&&cap.notBefore<=now&&cap.expires>now,'separate exact live approval required');
    assert.equal(cap.singlePublisher,true);assert.equal(cap.resourcesCoverageEstablished,true);
    assert.ok(coordinationState&&coordinationState.packetSHA256===this.packetHash&&coordinationState.phase!=='pending-unknown');
    const allowed={gatewayObserve:['frozen'],entryObserve:['frozen'],entryReady:['observing'],entryStop:['observing','ready','running'],gatewayRestorePrivacy:['application-terminal-pending-decision'],entryRestorePrivacy:['application-terminal-pending-decision'],gatewayRestoreLogs:['privacy-restored'],entryRestoreLogs:['privacy-restored']};
    assert.ok(allowed[phase].includes(coordinationState.phase));
    if(['gatewayObserve','entryObserve','entryReady'].includes(phase))assert.ok(now<this.packet.config.expires);
    if(phase==='entryReady')assert.ok(now<this.packet.schedule.markerReadbackDeadline);
    if(phase==='entryReady'){
      assert.deepEqual([...coordinationState.observed].sort(),['A','B']);
      const rows=coordinationState.protocolReceipts.filter(r=>r.operation==='observe');assert.equal(rows.length,2);
      for(const slot of ['A','B']){const r=parseProtocolReceipt(this.packet,rows.find(r=>r.slot===slot));assert.ok(r.receivedAt<=now);}
    }
    if(phase.includes('Restore')){
      assert.equal(restorationEligibility(this.packet,coordinationState.applicationTerminalEvidence).status,'ELIGIBLE_APPLICATION_SCOPE');
      assert.ok(coordinationState.cleanup&&coordinationState.requests.A==='terminal'&&coordinationState.requests.B==='terminal');
      const evidence=protocolTerminalEvidence(this.packet,coordinationState.protocolReceipts,{...coordinationState,versions:coordinationState.applicationTerminalEvidence.versions});
      assert.deepEqual(evidence,coordinationState.applicationTerminalEvidence);
    }
    const p=this.packet.phases[phase],w=p.worker,account=this.accounts[w],prior=this.current[w],write=buildWrite(this.packet,phase,moduleBytes,account,requestId);this.busy=true;let locked=false;
    try{
      await this.journal.lock();locked=true;
      if(this.cursor===0)assert.equal((await this.journal.records()).length,0,'existing completed chain must be reconstructed before publication');
      const pre=await collectReadback(this.transport,account,prior.worker,this.artifacts[w],this.packet.preservation?.[w]);assert.equal(pre.version,prior.version);assert.equal(pre.deployment,prior.deployment);assert.equal(pre.fullStateMatches,true,'pre-write full state incomplete');assert.equal(pre.pipelineGuardPassed,true,'independent pipeline evidence incomplete');
      await this.assertLockOwned();const at=Date.now();assert.ok(cap.notBefore<=at&&at<cap.expires,'live approval expired during preflight');
      if(['gatewayObserve','entryObserve','entryReady'].includes(phase))assert.ok(at<this.packet.config.expires);
      if(phase==='entryReady')assert.ok(at<this.packet.schedule.markerReadbackDeadline,'marker deadline passed during preflight');
      await this.journal.append(requestId,'intent',{packetSHA256:this.packetHash,phase,requestId,worker:w,priorVersion:prior.version,priorDeployment:prior.deployment,bodySHA256:hashBytes(write.body),startedAt:now});
      this.pending={requestId,phase,worker:w,prior:structuredClone(prior),startedAt:now};
      await this.assertLockOwned();const putAt=Date.now();assert.ok(cap.notBefore<=putAt&&putAt<cap.expires,'approval expired before PUT');
      if(['gatewayObserve','entryObserve','entryReady'].includes(phase))assert.ok(putAt<this.packet.config.expires);
      if(phase==='entryReady')assert.ok(putAt<this.packet.schedule.markerReadbackDeadline);
      const ack=jsonResult(await this.transport.request(write));const receipt=await collectReadback(this.transport,account,prior.worker,p,this.packet.preservation?.[w]);
      assert.equal(ack.result.id,prior.worker,'original upload acknowledgement script mismatch');
      this.checkIdentity(w,receipt);assert.equal(receipt.fullStateMatches,true,'post-write state incomplete');assert.equal(receipt.pipelineGuardPassed,true,'independent pipeline evidence incomplete');
      await this.assertLockOwned();await this.journal.append(requestId,'terminal',{phase,requestId,receipt,ackScript:ack.result.id,observedVersion:receipt.version,readbackAt:Date.now()});
      await this.assertLockOwned();this.registry[w].versions.set(receipt.version,[receipt.metadataSHA256,receipt.modulesSHA256,receipt.resourcesSHA256]);this.registry[w].deployments.set(receipt.deployment,receipt.version);
      this.current[w]={...prior,version:receipt.version,deployment:receipt.deployment};this.artifacts[w]=p;this.cursor++;this.pending=null;
      return {...receipt,phase,requestId,run:this.packet.run,worker:prior.worker,priorVersion:prior.version,priorDeployment:prior.deployment,startedAt:now,readbackAt:Date.now(),quietPublisher:cap.singlePublisher,provenance:'raw authenticated HTTP; external publisher exclusion is an operator prerequisite'};
    }catch(e){if(this.pending){await this.journal.append(requestId,'unknown',{requestId,phase,reportDueAt:Date.now()+600000,stopFurtherTest:true,automaticLogsRestore:false,requiredAction:'hold confirmed logs off; GET original identity only; no retry'}).catch(()=>{});}throw e;}finally{this.busy=false;if(locked&&!this.pending){const lock=await this.journal.lockState();if(lock.status==='PRESENT_OWNER_RECORDED'&&lock.owned)await this.journal.unlock();}}
  }
  checkIdentity(w,r){const x=this.registry[w];if(x.versions.has(r.version))assert.deepEqual(x.versions.get(r.version),[r.metadataSHA256,r.modulesSHA256,r.resourcesSHA256],'version identity changed content/resources');if(x.deployments.has(r.deployment))assert.equal(x.deployments.get(r.deployment),r.version,'deployment identity changed version');}
  replayRecords(rows,requestId,requirePending){
    const intents=rows.filter(r=>r.name.endsWith('.intent.json')).map(r=>r.value).sort((a,b)=>publicationPhases.indexOf(a.phase)-publicationPhases.indexOf(b.phase));
    const unknowns=rows.filter(r=>r.name.endsWith('.unknown.json'));assert.ok(unknowns.length<=1);
    const terminals=rows.filter(r=>r.name.endsWith('.terminal.json')),skips=rows.filter(r=>r.name.endsWith('.skip.json'));assert.ok(skips.length<=1);
    let pending=null,skipped=0,consumed=0,pendingTerminal=0,lastStarted=-Infinity;const requestIds=new Set();
    const applySkip=limit=>{
      assert.equal(this.cursor,3);assert.equal(skips.length,1,'durable natural-expiry checkpoint required');const row=skips[0],v=row.value;
      assert.equal(row.name,this.packet.run+'_natural_expiry.skip.json');assert.equal(v.packetSHA256,this.packetHash);assert.equal(v.phase,'entryStop');assert.equal(v.statePhase,'stopped');assert.equal(v.expires,this.packet.config.expires);
      assert.ok(v.recordedAt>=v.expires&&v.recordedAt<=limit);assert.deepEqual(v.current,this.current);this.cursor=4;skipped=1;
    };
    for(const intent of intents){
      if(this.cursor===3&&intent.phase==='gatewayRestorePrivacy')applySkip(intent.startedAt);
      assert.equal(intent.packetSHA256,this.packetHash);assert.equal(intent.phase,publicationPhases[this.cursor]);
      assert.ok(Number.isSafeInteger(intent.startedAt)&&intent.startedAt>=lastStarted);lastStarted=intent.startedAt;
      assert.match(intent.requestId,/^[A-Za-z0-9_-]{1,128}$/);assert.ok(!requestIds.has(intent.requestId));requestIds.add(intent.requestId);assert.ok(rows.some(r=>r.name===intent.requestId+'.intent.json'&&r.value===intent));assert.match(intent.bodySHA256,/^[a-f0-9]{64}$/);
      const w=this.packet.phases[intent.phase].worker;assert.equal(intent.worker,w);const prior=this.current[w];assert.equal(intent.priorVersion,prior.version);assert.equal(intent.priorDeployment,prior.deployment);
      const done=rows.find(r=>r.name===intent.requestId+'.terminal.json');
      const unknown=rows.find(r=>r.name===intent.requestId+'.unknown.json');if(unknown){assert.equal(unknown.value.requestId,intent.requestId);assert.equal(unknown.value.phase,intent.phase);assert.equal(unknown.value.stopFurtherTest,true);assert.equal(unknown.value.automaticLogsRestore,false);}
      if(!done||unknown){if(done)pendingTerminal=1;assert.equal(pending,null);if(requirePending)assert.equal(intent.requestId,requestId);pending={requestId:intent.requestId,phase:intent.phase,worker:w,prior:structuredClone(prior),startedAt:intent.startedAt,terminalCandidatePresent:!!done};break;}
      const r=done.value.receipt,p=this.packet.phases[intent.phase];assert.equal(done.value.requestId,intent.requestId);assert.equal(done.value.phase,intent.phase);assert.equal(done.value.ackScript,prior.worker);assert.equal(done.value.observedVersion,r.version);assert.ok(done.value.readbackAt>=intent.startedAt);
      assert.equal(r.fullStateMatches,true);assert.equal(r.pipelineGuardPassed,true);assert.equal(r.metadataSHA256,p.metadataSHA256);assert.equal(r.modulesSHA256,p.modulesSHA256);
      assert.equal(r.resourcesSHA256,this.registry[w].versions.get(prior.version)[2],'terminal resources differ from frozen ledger');this.checkIdentity(w,r);
      this.registry[w].versions.set(r.version,[r.metadataSHA256,r.modulesSHA256,r.resourcesSHA256]);this.registry[w].deployments.set(r.deployment,r.version);this.current[w]={...prior,version:r.version,deployment:r.deployment};this.artifacts[w]=p;this.cursor++;consumed++;
    }
    if(!pending&&this.cursor===3&&skips.length)applySkip(Infinity);
    assert.equal(terminals.length,consumed+pendingTerminal,'orphan terminal record');if(unknowns.length)assert.equal(unknowns[0].name,pending?.requestId+'.unknown.json','orphan unknown record');assert.equal(skips.length,skipped,'unexpected expiry checkpoint');assert.equal(intents.length,consumed+(pending?1:0),'no intents may follow unknown');
    if(requirePending)assert.ok(pending,'original unresolved intent required');else assert.equal(pending,null,'unknown intent: use original-identity reconciliation only');
    this.pending=pending;
  }
  shadow(){return new Publisher({packet:this.packet,accounts:this.accounts,transport:this.transport,journal:this.journal});}
  adopt(shadow){for(const k of ['cursor','pending','current','artifacts','registry'])this[k]=shadow[k];}
  async restoreOriginalPending(requestId){
    assert.equal(this.cursor,0);assert.equal(this.pending,null);assert.equal(this.busy,false);
    const shadow=this.shadow();shadow.replayRecords(await this.journal.records(),requestId,true);this.adopt(shadow);
    return {status:'ORIGINAL_PENDING_LOADED_READ_ONLY',requestId,productionAuthorized:false};
  }
  async restoreCompletedChain(){
    assert.equal(this.cursor,0);assert.equal(this.pending,null);assert.equal(this.busy,false);assert.ok(['read-only','live'].includes(this.transport.mode));
    const shadow=this.shadow();const records=await this.journal.records();shadow.replayRecords(records,null,false);
    const lock=await this.journal.lockState(),observed={};
    for(const w of ['gateway','entry']){
      const prior=shadow.current[w],r=await collectReadback(this.transport,this.accounts[w],prior.worker,shadow.artifacts[w],this.packet.preservation?.[w]);
      assert.equal(r.version,prior.version);assert.equal(r.deployment,prior.deployment);assert.equal(r.metadataSHA256,shadow.registry[w].versions.get(prior.version)[0]);assert.equal(r.modulesSHA256,shadow.registry[w].versions.get(prior.version)[1]);shadow.checkIdentity(w,r);observed[w]=r;
    }
    // Bracket the earlier Worker while the other account was read. These GETs
    // detect observed cross-account identity drift; they are not an atomic
    // account transaction or a replacement for external publisher exclusion.
    for(const w of ['gateway','entry']){
      const path=base(this.accounts[w],shadow.current[w].worker),get=async suffix=>jsonResult(await this.transport.request({path:path+suffix}));
      const r=observed[w],resource=await collectResourceEvidence(this.transport,this.accounts[w],shadow.current[w].worker,shadow.artifacts[w],r.runtimeResources,this.packet.preservation?.[w]);
      assert.equal(resource.resourcesSHA256,r.resourcesSHA256,'resources changed during cross-account reconstruction');assert.equal(resource.pipeline.evidenceSHA256,r.pipeline.evidenceSHA256,'pipeline changed during cross-account reconstruction');
      const latest=await get('/versions');assert.equal(latest.result.items[0].id,r.version,'latest changed during cross-account reconstruction');
      const settings=(await get('/settings')).result;wireMetadata({...shadow.artifacts[w].metadata,bindings:settings.bindings});
      if(!Object.hasOwn(settings,'exports')&&Object.hasOwn(shadow.artifacts[w].metadata,'exports'))settings.exports=shadow.artifacts[w].metadata.exports;
      assert.equal(hashJSON(settings),r.metadataSHA256,'settings changed during cross-account reconstruction');
      const globals=(await get('/script-settings')).result;for(const k of ['observability','logpush','tail_consumers'])assert.equal(hashJSON(globals[k]),hashJSON(settings[k]));
      assert.deepEqual(identity(await get('/deployments')),{version:r.version,deployment:r.deployment},'deployment changed during cross-account reconstruction');
    }
    assert.equal(hashJSON(await this.journal.records()),hashJSON(records),'journal changed during GET reconstruction');
    const after=await this.journal.lockState();assert.equal(hashJSON(lock),hashJSON(after),'lock changed during GET reconstruction');this.adopt(shadow);
    return {status:'COMPLETED_CHAIN_RESTORED_READ_ONLY',cursor:this.cursor,nextPhase:publicationPhases[this.cursor]??null,observed,lock,lockAcquisitionBlocked:lock.status!=='ABSENT',productionAuthorized:false,productionActionsExecuted:0};
  }
  async reconcile(requestId){assert.equal(this.busy,false);assert.ok(this.pending&&this.pending.requestId===requestId);const p=this.pending,w=p.worker;const observed=await collectReadback(this.transport,this.accounts[w],p.prior.worker,this.packet.phases[p.phase],this.packet.preservation?.[w]);this.checkIdentity(w,observed);return {status:'READ_ONLY_ORIGINAL_WRITE_PENDING',requestId,observed,productionAuthorized:false};}
}
