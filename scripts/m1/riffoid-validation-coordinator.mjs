// Offline packet derivation and receipt/state validation only. No transport,
// credentials, publisher, retry, timers, browser automation or production RPC.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validationConfig,validationCanonical,validationTransport,
  VALIDATION_MAX_WINDOW_MS,VALIDATION_CLEANUP_MS} from '../../services/entry/validation-policy.ts';
import {hashJSON,stateMetadata,validateRedactedSecretKey,parseProtocolReceipt,protocolTerminalEvidence,pendingDecisions,restorationEligibility,approvalRecord} from './riffoid-validation-evidence.mjs';

import {assertPreservationReadback,validateFrozenAssetSnapshot} from './riffoid-validation-resources.mjs';

export const digest=hashJSON;
const copy=value=>structuredClone(value);
const marker='cloudflare-direct-visitor-waf-v1';
const configName='RIFFOID_VALIDATION_CONFIG_JSON';
function setBinding(metadata,name,text){
  const found=metadata.bindings.find(b=>b.name===name);
  if(found){assert.equal(found.type,'plain_text');found.text=text;}
  else metadata.bindings.push({name,type:'plain_text',text});
}
function removeBinding(metadata,name){metadata.bindings=metadata.bindings.filter(b=>b.name!==name);}
function validateBaseline(b){
  for(const k of ['worker','version','deployment','snapshotSHA256'])assert.ok(typeof b[k]==='string'&&b[k]);
  const m=b.metadata;
  assert.ok(m&&Array.isArray(m.bindings)&&m.main_module);
  assert.equal(new Set(m.bindings.map(b=>b.name)).size,m.bindings.length);
  assert.equal(m.observability?.logs?.persist,true,'baseline must independently establish persist=true');
  assert.equal(m.keep_assets,true,'full write metadata must explicitly preserve existing assets');
  assert.ok(!Object.hasOwn(m,'assets'),'explicit assets upload/configuration forbidden');
  assert.ok(!m.bindings.some(b=>b.name===configName||b.name==='ENTRY_NATIVE_IP_BOUNDARY'),'unexpected baseline temporary state');
  for(const b of m.bindings){
    if(b.type==='secret_text')assert.deepEqual(Object.keys(b).sort(),['name','type'],'redacted reference only');
    if(b.type==='secret_key')validateRedactedSecretKey(b);
    if(b.name==='ENTRY_SIGNING_PRIVATE_JWK')assert.ok(['secret_text','secret_key'].includes(b.type),'private key reference only');
  }
}
function validateModules(modules,metadata){
  assert.ok(Array.isArray(modules)&&modules.length);
  assert.ok(modules.some(m=>m.name===metadata.main_module),'main module bytes must be supplied');
  assert.equal(new Set(modules.map(m=>m.name)).size,modules.length);
  for(const m of modules){
    assert.deepEqual(Object.keys(m).sort(),['bytes','name','path','sha256'],'module descriptors only; no inline material');
    assert.match(m.sha256,/^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(m.bytes)&&m.bytes>0);
    assert.ok(typeof m.path==='string'&&/\.(mjs|js)$/.test(m.path),'code references only');
  }
}
function derivePhases(input,c){
  for(const b of Object.values(input.baselines))validateBaseline(b);
  assert.deepEqual(Object.keys(input.baselines).sort(),['entry','gateway']);
  const phases={};
  const add=(id,worker,metadata,modules)=>{
    validateModules(modules,metadata);
    phases[id]={worker,metadata:copy(metadata),modules:copy(modules),preparedMetadataSHA256:digest(metadata),metadataSHA256:digest(stateMetadata(metadata)),modulesSHA256:digest(modules)};
  };
  const entry=copy(input.baselines.entry.metadata),gateway=copy(input.baselines.gateway.metadata);
  for(const m of [entry,gateway]){
    m.observability.logs.persist=false;
    setBinding(m,'APP_ORIGIN',validationCanonical);setBinding(m,'APP_TRANSPORT_ORIGIN',validationTransport);
    setBinding(m,'TWO_ACCOUNT_AUTH_MODE','signed-entry-v1');setBinding(m,configName,JSON.stringify(c));
  }
  entry.main_module=input.validation.entry.main_module;gateway.main_module=input.validation.gateway.main_module;
  assert.deepEqual(input.validation.gateway.exports,input.baselines.gateway.metadata.exports,'all historical exports must be preserved');
  add('gatewayObserve','gateway',gateway,input.validation.gateway.modules);
  add('entryObserve','entry',entry,input.validation.entry.modules);
  const ready=copy(entry);setBinding(ready,'ENTRY_NATIVE_IP_BOUNDARY',marker);
  add('entryReady','entry',ready,input.validation.entry.modules);
  // Closes new signing without deleting the route needed for post-expiry cleanup.
  add('entryStop','entry',entry,input.validation.entry.modules);
  for(const worker of ['gateway','entry']){
    const baseline=input.baselines[worker];validateModules(baseline.modules,baseline.metadata);
    const privacy=copy(baseline.metadata);privacy.observability.logs.persist=false;
    add(worker+'RestorePrivacy',worker,privacy,baseline.modules);
    add(worker+'RestoreLogs',worker,baseline.metadata,baseline.modules);
  }
  return phases;
}
export function pendingPhaseTemplates(input){
  approvalRecord(input.riskAuthorization);
  const c={version:1,run:null,notBefore:null,expires:null,ips:{A:null,B:null}};
  assert.deepEqual(input.config,c,'template must contain no live window or visitor inputs');
  return {status:'NON_EXECUTABLE_PHASE_TEMPLATES',productionAuthorized:false,config:c,phases:derivePhases(input,c),
    blockedBy:['raw authenticated transport connection','frozen asset retention contract and container preservation evidence','fresh complete baseline consistency','original user execution inputs']};
}
export function buildPacket(input){
  const authorization=input.riskAuthorization?approvalRecord(input.riskAuthorization):null;
  const c=validationConfig({RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify(input.config)});
  assert.equal(c.expires-c.notBefore,VALIDATION_MAX_WINDOW_MS,'this packet freezes the reviewed 300s maximum');
  const phases=derivePhases(input,c);
  for(const w of ['entry','gateway'])validateFrozenAssetSnapshot(input.preservation?.[w]?.assets,{worker:input.baselines[w].worker},input.baselines[w].metadata);
  return {status:'OFFLINE_REVIEW_PACKET_NOT_AUTHORIZED_FOR_UPLOAD',run:c.run,config:c,configSHA256:digest(c),
    baselineGuards:Object.fromEntries(Object.entries(input.baselines).map(([k,b])=>[k,{worker:b.worker,version:b.version,deployment:b.deployment,snapshotSHA256:b.snapshotSHA256,metadataSHA256:digest(stateMetadata(b.metadata)),modulesSHA256:digest(b.modules),...(b.resourcesSHA256?{resourcesSHA256:b.resourcesSHA256}:{})}])),
    ...(input.preservation?{preservation:copy(input.preservation)}:{}),
    decisions:authorization?copy(authorization.decisions):copy(pendingDecisions),...(authorization?{riskAuthorization:authorization}:{}),productionAuthorized:false,
    budgets:{freshProofs:3,primaryAccepts:2,verifierCalls:4,observes:2,begins:2,normalOutgoingHTTPS:8,optionalCleanupHTTPS:1,windowMS:VALIDATION_MAX_WINDOW_MS,cleanupMS:VALIDATION_CLEANUP_MS},
    schedule:{start:c.notBefore,markerReadbackDeadline:c.notBefore+180_000,operatorCueDeadline:c.notBefore+225_000,
      latestAStart:c.expires-45_000,latestBStart:c.expires-10_000,stop:c.expires,cleanupBefore:c.expires+VALIDATION_CLEANUP_MS},
    phases,remainingExternalRequirements:['production publisher/readback authenticity and quiet publisher evidence','native A/B original browser receipts',...(!authorization?['user decision on application-scope restoration standard','user decision on unknown-state log closure policy']:[])]};
}
export function initialState(packet){
  const identities=Object.fromEntries(Object.entries(packet.baselineGuards).map(([worker,b])=>[worker,{
    versions:[{version:b.version,metadataSHA256:b.metadataSHA256,modulesSHA256:b.modulesSHA256}],
    deployments:[{deployment:b.deployment,version:b.version}]
  }]));
  return {run:packet.run,packetSHA256:digest(packet),phase:'frozen',observed:[],versions:{},identities,requests:{},cleanup:false,protocolReceipts:[],applicationTerminalEvidence:null,
    lastEventAt:null,markerAt:null,cueAt:null,stopAt:null,cleanupAt:null};
}
function readbacks(packet,state,ids,receipts,now,minimumStart=state.lastEventAt??0){
  assert.equal(receipts.length,ids.length);
  let earliest=minimumStart;
  for(let i=0;i<ids.length;i++){
    const phase=packet.phases[ids[i]],r=receipts[i],worker=phase.worker;
    assert.equal(r.phase,ids[i]);assert.equal(r.worker,packet.baselineGuards[worker].worker);
    assert.equal(r.run,packet.run);assert.equal(r.metadataSHA256,phase.metadataSHA256);assert.equal(r.modulesSHA256,phase.modulesSHA256);
    assert.equal(r.priorVersion,state.versions[worker]?.version??packet.baselineGuards[worker].version);
    assert.equal(r.priorDeployment,state.versions[worker]?.deployment??packet.baselineGuards[worker].deployment);
    for(const k of ['version','deployment','requestId'])assert.ok(typeof r[k]==='string'&&r[k]);
    assert.equal(r.activeVersion,r.version);assert.equal(r.latestVersion,r.version);
    assert.ok(Number.isSafeInteger(r.startedAt)&&r.startedAt>=earliest,'publication precedes required prior evidence');
    assert.ok(Number.isSafeInteger(r.readbackAt)&&r.readbackAt>=r.startedAt&&r.readbackAt<=now,'invalid publication/readback time');
    assertPreservationReadback(r,packet.preservation?.[worker]?.assets,{worker:r.worker});assert.equal(r.quietPublisher,true);assert.equal(r.pipelineGuardPassed,true);
    const registry=state.identities[worker],knownVersion=registry.versions.find(v=>v.version===r.version);
    if(knownVersion){
      assert.equal(r.metadataSHA256,knownVersion.metadataSHA256,'known Worker/version cannot change metadata');
      assert.equal(r.modulesSHA256,knownVersion.modulesSHA256,'known Worker/version cannot change modules');
    }else registry.versions.push({version:r.version,metadataSHA256:r.metadataSHA256,modulesSHA256:r.modulesSHA256});
    const knownDeployment=registry.deployments.find(d=>d.deployment===r.deployment);
    if(knownDeployment)assert.equal(r.version,knownDeployment.version,'known Worker/deployment cannot change version');
    else registry.deployments.push({deployment:r.deployment,version:r.version});
    state.versions[worker]={version:r.version,deployment:r.deployment};
    earliest=r.readbackAt;
  }
}
// Supplied receipts are validated for consistency; this module cannot establish
// their authenticity. Fixture receipts are never production evidence.
export function advance(packet,previous,event,now){
  assert.ok(Number.isSafeInteger(now)&&now>=0);assert.equal(previous.run,packet.run);assert.equal(event.run,packet.run);
  assert.equal(previous.packetSHA256,digest(packet),'frozen packet/baseline drift');
  assert.ok(previous.lastEventAt===null||now>=previous.lastEventAt,'journal event time moved backwards');
  assert.equal(digest(packet.config),packet.configSHA256,'frozen run/time/config drift');
  for(const phase of Object.values(packet.phases)){
    assert.equal(digest(phase.metadata),phase.preparedMetadataSHA256,'frozen upload metadata drift');
    assert.equal(digest(stateMetadata(phase.metadata)),phase.metadataSHA256,'frozen metadata drift');
    assert.equal(digest(phase.modules),phase.modulesSHA256,'frozen module inventory drift');
  }
  const s=copy(previous),c=packet.config;
  assert.notEqual(s.phase,'pending-unknown','only read-only reconciliation of the original request may resolve unknown state');
  if(event.type==='unknown'){
    assert.ok(typeof event.requestId==='string'&&event.requestId);
    return {...s,lastEventAt:now,phase:'pending-unknown',unknownRequestId:event.requestId,reportDueAt:now+600000,stopFurtherTest:true,automaticLogsRestore:false,requiredAction:'read-only reconcile original request; hold confirmed logs off; report within ten minutes; new approval required to restore'};
  }
  if(event.type==='observationPublished'){
    assert.equal(s.phase,'frozen');assert.ok(now<c.expires);
    readbacks(packet,s,['gatewayObserve','entryObserve'],event.receipts,now);s.phase='observing';
  }else if(event.type==='observed'){
    assert.equal(s.phase,'observing');assert.ok(now>=c.notBefore&&now<packet.schedule.markerReadbackDeadline);
    assert.ok(['A','B'].includes(event.slot)&&!s.observed.includes(event.slot));
    assert.equal(event.case,'observe');assert.equal(event.passed,true);assert.equal(event.nativeIpMatches,true);
    assert.equal(event.configSHA256,packet.configSHA256);
    const row=parseProtocolReceipt(packet,event.protocolReceipt);assert.equal(row.operation,'observe');assert.equal(row.slot,event.slot);assert.equal(row.receivedAt,now);
    assert.ok(!s.protocolReceipts.some(r=>r.requestId===row.requestId));s.protocolReceipts.push(copy(event.protocolReceipt));s.observed.push(event.slot);
  }else if(event.type==='markerPublished'){
    assert.equal(s.phase,'observing');assert.deepEqual([...s.observed].sort(),['A','B']);
    assert.ok(now<packet.schedule.markerReadbackDeadline,'late marker means stop, never extend config');
    readbacks(packet,s,['entryReady'],event.receipts,now);s.phase='ready';s.markerAt=now;
  }else if(event.type==='operatorCue'){
    assert.equal(s.phase,'ready');assert.ok(now<packet.schedule.operatorCueDeadline);s.phase='running';s.cueAt=now;
  }else if(event.type==='runReceipt'){
    assert.equal(s.phase,'running');assert.ok(['A','B'].includes(event.slot)&&!s.requests[event.slot]);
    assert.ok(Number.isSafeInteger(event.startedAt)&&event.startedAt>=c.notBefore&&event.startedAt<=now);
    assert.ok(Number.isSafeInteger(s.markerAt)&&Number.isSafeInteger(s.cueAt));
    assert.ok(event.startedAt>=s.markerAt&&event.startedAt>=s.cueAt,'Run began before marker/operator cue');
    assert.ok(event.startedAt<(event.slot==='A'?packet.schedule.latestAStart:packet.schedule.latestBStart));
    assert.ok(now<c.expires);assert.equal(event.passed,true);assert.equal(event.nativeIpMatches,true);
    const expected=event.slot==='A'?[['begin',200,'accepted'],['primary',200,'accepted'],['replay',403,'entry_replay_denied'],['expired',403,'entry_proof_denied']]:[['begin',200,'accepted'],['primary',200,'accepted']];
    assert.deepEqual(event.results.map(r=>[r.case,r.status,r.code]),expected);
    assert.equal(event.results.find(r=>r.case==='primary').ipMatches,true);
    if(event.slot==='A'){assert.equal(event.sameSignedInputsReplay,true);assert.equal(event.realUnusedProofExpiry,true);}
    const row=parseProtocolReceipt(packet,event.protocolReceipt);assert.equal(row.operation,'run');assert.equal(row.slot,event.slot);
    assert.equal(row.startedAt,event.startedAt);assert.equal(row.receivedAt,now);assert.deepEqual(row.body.results,event.results);
    assert.ok(!s.protocolReceipts.some(r=>r.requestId===row.requestId));s.protocolReceipts.push(copy(event.protocolReceipt));
    s.requests[event.slot]='terminal';
  }else if(event.type==='stop'){
    assert.ok(['observing','ready','running'].includes(s.phase));
    if(now<c.expires)readbacks(packet,s,['entryStop'],event.receipts,now);
    // Expiry closes new requests only. It does not prove execution completion.
    s.phase='stopped';s.stopAt=now;
  }else if(event.type==='cleanupReceipt'){
    assert.equal(s.phase,'stopped');assert.equal(s.cleanup,false);assert.ok(now>=c.expires&&now<c.expires+VALIDATION_CLEANUP_MS);
    assert.equal(event.case,'cleanup');assert.equal(event.passed,true);assert.equal(event.logsPersist,false);
    assert.equal(event.removed,2);
    const row=parseProtocolReceipt(packet,event.protocolReceipt);assert.equal(row.operation,'cleanup');assert.equal(row.receivedAt,now);
    assert.equal(row.body.results[0].removed,event.removed);assert.ok(!s.protocolReceipts.some(r=>r.requestId===row.requestId));
    s.protocolReceipts.push(copy(event.protocolReceipt));s.cleanup=true;s.cleanupAt=now;
  }else if(event.type==='applicationTerminalReceipt'){
    assert.equal(s.phase,'stopped');assert.equal(s.cleanup,true);
    const evidence=protocolTerminalEvidence(packet,s.protocolReceipts,s);
    assert.deepEqual(event.evidence,evidence);assert.ok(now>=evidence.completedAt);
    s.applicationTerminalEvidence=evidence;s.phase='application-terminal-pending-decision';
    s.restoration=restorationEligibility(packet,evidence);
  }else if(event.type==='restorePrivacy'||event.type==='restoreLogs'){
    assert.equal(restorationEligibility(packet,s.applicationTerminalEvidence).status,'ELIGIBLE_APPLICATION_SCOPE','BLOCKED_USER_DECISION');
    if(event.type==='restorePrivacy'){
      assert.equal(s.phase,'application-terminal-pending-decision');
      readbacks(packet,s,['gatewayRestorePrivacy','entryRestorePrivacy'],event.receipts,now);s.phase='privacy-restored';
    }else{
      assert.equal(s.phase,'privacy-restored');
      readbacks(packet,s,['gatewayRestoreLogs','entryRestoreLogs'],event.receipts,now);s.phase='restored';
    }
  }else assert.fail('unsupported event');
  s.lastEventAt=now;return s;
}
export async function verifyCodeReferences(input,inputPath){
  const {dirname,resolve}=await import('node:path');
  const all=[...Object.values(input.baselines).flatMap(b=>b.modules),...Object.values(input.validation).flatMap(b=>b.modules)];
  for(const module of all){
    assert.match(module.path,/\.(mjs|js)$/);const bytes=await readFile(resolve(dirname(inputPath),module.path));
    assert.equal(bytes.length,module.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),module.sha256,'module source drift');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const audit=process.argv[2]==='--audit',inputPath=process.argv[audit?3:2];
    assert.equal(process.argv.length,audit?5:3,'usage: coordinator.mjs [--audit] offline-input.json [receipt-journal.json]');
    const input=JSON.parse(await readFile(inputPath,'utf8'));
    const packet=buildPacket(input);await verifyCodeReferences(input,inputPath);
    if(audit){
      const journal=JSON.parse(await readFile(process.argv[4],'utf8'));let state=initialState(packet);
      for(const row of journal)state=advance(packet,state,row.event,row.now);
      process.stdout.write(JSON.stringify({status:'OFFLINE_RECEIPT_CONSISTENCY_ONLY',state,productionActionsExecuted:0},null,2)+'\n');
    }else process.stdout.write(JSON.stringify(packet,null,2)+'\n');
  }catch{process.stderr.write('offline packet rejected; check full baselines, module hashes and fixed window; no action executed\n');process.exitCode=1;}
}
