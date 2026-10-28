/** Preparation only: I/O-free classifier of original captured bodies.
 * No entry point, file reader, authentication, network, mutation, or callback.
 * The protected caller must hash/own-check all source and raw refs beforehand.
 */
import {createHash} from 'node:crypto';
const REQUEST='560ada22-f507-48b9-b926-8df6d6b90ceb';
const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e';
const WORKER='riffology-m1-gateway-staging';
const PT='a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650';
const PI='a03628c4-f032-461f-a65b-612ccac11a06';
const APPS=[PT,PI],HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAIN='2dc5e7ce113a007a238d32eea732a29fb703745e';
const TREE='9db908c03431ab6da74afd3687d79c22de3ef8de';
const BASE='/accounts/'+ACCOUNT+'/containers/applications/';
const OLD={
  [PT]:{version:3,image:'registry.cloudflare.com/'+ACCOUNT+'/riffology-20261001-project-tools@sha256:e6341979a848f40c06328317759e52fefd700470fc4952d2301c382d16152c39'},
  [PI]:{version:13,image:'registry.cloudflare.com/'+ACCOUNT+'/riffology-issue165-trusted-pi@sha256:ec8dbe9efe229a1626ea3202b618653f82f8d29d9da8b19310c3b3838f2a2623'},
};
const CONFIG_WITHOUT_IMAGE='25ba997970bbcf6163200262ffaef9a972b000ef05e44887f5528d81c02a0ef4';
// Version API baselines preserve their complete own representation. They omit
// fields that the full application API returns; those fields are not invented.
const VERSION_CONFIG_WITHOUT_IMAGE={
  [PT]:'f35903f5fbfcfb88c7f9f35d32281ac2dc6fa5c65f7223aacac47ee33fe630a8',
  [PI]:'3b4de9568e975f4b39e50f427ae073762d6032e5d64e0bce18d2af78e2020b7a',
};
export const ROLLOUT_SCHEMA_PIN=Object.freeze({package:'wrangler',version:'4.129.0',file:'wrangler-dist/cli.js',sourceSha256:'0a7bc2107ca92b2cc6db58b6a36d38d44b549eebd7db7ec34c36db9da7a91264',excerptLines:[134302,134326],excerptSha256:'9cdde3571f55e2f4310e2b5fe018147bd09a9e0ab3ae121cbfc164550817f0f3',successfulStatus:'completed',otherStatuses:['pending','progressing','reverted','replaced']});
export const SOURCE_PINS=Object.freeze({
  sourceCommit:MAIN,sourceTree:TREE,
  predecessorCommit:'004e5cd5940c6e283b1b58501c3f409a569f6e20',
  authoritySourcesUnchangedFromPredecessor:true,
  files:Object.freeze({
    'services/capacity/core.ts':'4fa189f21286730df1a44226210c3da52eb2b824c4c8511ddb6506b381a541c8',
    'services/capacity/paired.ts':'ddbed73abcd4e5c6702f7f15407c7a84cd3447c5d5690805b20ecb667410e840',
    'services/capacity/durable.ts':'8b7787edba584f3966ad67596273cc0ea8256dada17df7ff447a0e4cfe843df1',
    'services/model-budget/private-beta-capacity.ts':'fc36f4de0ce6e79804b080e47a9b696c41c0627464bf4d373249ea7997bec74d',
    'services/model-budget/private-beta-maintenance.ts':'e4f6ba59521d0fad90fc619390b89f928e66c573a2500e286c2a8b055ab17c67',
    'services/turn-runtime/core.ts':'4791345a0cab39fe4dd3e7e8e35266dd54cc1ac10588d7702538f14eb04d198b',
    'services/workspace/runtime-handoff.ts':'466b84e1b75b8f856fb3821e7d57b2fce823e468c7a86601856b0bbfc9f59d44',
  }),
});
const need=(ok,code)=>{if(!ok){const e=new Error(code);e.code=code;throw e;}};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))??'undefined').digest('hex');
const equal=(a,b,code)=>need(hash(a)===hash(b),code);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const ref=x=>need(object(x)&&typeof x.file==='string'&&x.file.startsWith('/')&&Number.isSafeInteger(x.bytes)&&x.bytes>0&&HEX.test(x.sha256??''),'actual-raw-reference');
function fresh(value,now){const at=typeof value==='number'?value:Date.parse(value);need(Number.isFinite(at)&&at<=now+2000&&now-at<=30000,'actual-observation-not-fresh');return at;}
function logical(maintenance,facts,reference,now){
  ref(reference);
  need(maintenance?.schema==='riffoid-ir.operator-browser-response/v1'&&maintenance.method==='GET'&&maintenance.path==='/api/admin/private-beta/maintenance/quiescence'&&maintenance.httpStatus===200&&maintenance.requestId===REQUEST,'actual-maintenance-response');
  const q=maintenance.body;
  need(q?.schemaVersion===1&&q.requestId===REQUEST&&q.revision===5&&q.quiescent===true&&q.actualContainerReleaseVerified===false,'actual-global-release-projection');
  fresh(maintenance.observedAt,now);fresh(q.checkedAt,now);
  need(q.checkedAt<=Date.parse(maintenance.observedAt)+2000&&Date.parse(maintenance.observedAt)-q.checkedAt<=15000,'browser-server-observation-order');
  equal(q.hold,facts.newIrMaintenance?.hold,'same-original-hold');equal(q.control,facts.newIrMaintenance?.control,'same-original-control');
  need(!facts.newIrMaintenance?.receipts?.end&&q.hold?.requestId===REQUEST&&q.control?.revision===19&&q.hold.controlRevision===19&&q.hold.policySha256===q.control.policySha256&&q.control.policySha256===q.control.pinnedPolicySha256&&q.control.enabled===true&&q.control.paused===false,'same-live-ir-hold-five-control-nineteen');
  for(const l of [q.ledgerBefore,q.ledger])need(l?.scope==='original-beta-ledger-only'&&l.activeSlots===0&&l.quarantinedSlots===0&&l.unresolvedCalls===0&&l.quiescent===true,'original-beta-ledger-unsettled');
  const n=q.native;need(n?.actor==='trusted-pi-capacity:application'&&typeof n.policyVersion==='string'&&n.policyVersion.length>0&&n.coldUnresolved===0&&n.pairUnresolved===0&&n.quiescent===true&&n.actualContainerReleaseVerified===false,'original-cold-pair-proof-projection-unsettled');
  return q;
}
function phaseImages(phase,facts){
  const early=/^(?:before-credential|before-baseline|before-assets|before-upload-[0-9]+|before-multipart|before-worker-put|after-gateway|before-rollout-project-tools)$/;
  const mid=['after-rollout-project-tools','before-rollout-trusted-pi'].includes(phase);
  const late=['after-rollout-trusted-pi','final-preservation'].includes(phase);
  need(early.test(phase)||mid||late,'unknown-publication-phase');
  const images={};for(const id of APPS){
    const changed=late||mid&&id===PT;
    images[id]=changed?facts.registryByApp?.[id]?.receipt?.imageReference:OLD[id].image;
    need(typeof images[id]==='string'&&images[id].startsWith('registry.cloudflare.com/'+ACCOUNT+'/')&&/@sha256:[a-f0-9]{64}$/.test(images[id]),'actual-image-reference-required');
  }return images;
}
function captured(native,path,reference,now){
  ref(reference);const matches=native.captures.filter(x=>x.path===path&&x.reference?.sha256===reference.sha256&&x.reference?.bytes===reference.bytes&&x.reference?.file===reference.file);
  need(matches.length===1,'physical-body-reference-not-captured');fresh(matches[0].observedAt,now);
}
function classifyApp(native,id,image,now){
  const family=native.byApp[id],app=family?.application;
  need(app?.id===id&&app.account_id===ACCOUNT&&app.max_instances===1&&app.scheduling_policy==='default'&&Number.isSafeInteger(app.version)&&app.version>=OLD[id].version&&app.configuration?.image===image,'original-app-active-config-version');
  need(hash(Object.fromEntries(Object.entries(app.configuration).filter(([k])=>k!=='image')))===CONFIG_WITHOUT_IMAGE,'non-image-configuration-drift');
  if(image===OLD[id].image)need(app.version===OLD[id].version,'unexpected-original-app-version');
  else need(app.version>OLD[id].version,'new-image-requires-new-version');
  need(Array.isArray(family.versions)&&new Set(family.versions.map(x=>x.version)).size===family.versions.length,'complete-unique-version-family');
  const active=family.versions.filter(x=>x.percentage!==0);
  need(active.length===1&&active[0].percentage===100&&active[0].version===app.version&&object(active[0].configuration)&&active[0].configuration.image===app.configuration.image,'one-current-fully-serving-version');
  need(hash(Object.fromEntries(Object.entries(active[0].configuration).filter(([k])=>k!=='image')))===VERSION_CONFIG_WITHOUT_IMAGE[id],'version-api-original-shape-config-drift');
  for(const [key,value]of Object.entries(active[0].configuration))equal(value,app.configuration[key],'active-version-actual-shared-configuration-link');
  for(const row of family.versions)need(Number.isSafeInteger(row.version)&&row.version>0&&(row.percentage===0||row.percentage===100),'unknown-version-lifecycle');
  const legacy=family.legacy?.instances,v2=family.v2?.items;
  need(Array.isArray(legacy)&&Array.isArray(v2),'two-complete-logical-families');
  for(const rows of [legacy,v2]){
    need(new Set(rows.map(x=>x.id)).size===rows.length,'duplicate-logical-instance');
    for(const row of rows)need(row?.application_id===id&&typeof row.id==='string'&&row.status?.state==='inactive','logical-instance-active-or-unknown');
  }
  equal(legacy.map(x=>x.id).sort(),v2.map(x=>x.id).sort(),'logical-family-identity-conflict');
  if(app.health?.instances)for(const key of ['active','assigned','failed','scheduling','starting'])need(app.health.instances[key]===0,'application-lifecycle-pending-or-failed');
  if(app.health?.errors)need(Array.isArray(app.health.errors)&&app.health.errors.length===0,'application-health-error');
  need(app.active_rollout_id==null,'application-rollout-still-active');
  const p=family.physicalSupplement,d=p?.deployments;
  need(p?.schema==='riffoid-ir.actual-native-physical-supplement/v1'&&p.complete===true&&p.unfiltered===true&&p.vmAndContainerStatesKeptSeparate===true&&d?.complete===true&&Array.isArray(d.items)&&object(d.details),'complete-unfiltered-current-physical-family');
  need(d.items.length<=app.max_instances&&new Set(d.items.map(x=>x.id)).size===d.items.length&&Object.keys(d.details).sort().join(',')===d.items.map(x=>x.id).sort().join(','),'current-deployment-completeness-or-count');
  captured(native,BASE+id+'/deployments',d.listReference,now);
  need(Array.isArray(p.dash?.instances)&&p.dash.instances.length===0&&Array.isArray(p.dash.durable_objects),'dash-shape-or-active-instance');
  captured(native,'/accounts/'+ACCOUNT+'/containers/dash/applications/'+id+'/instances',p.dashReference,now);
  const placements=[];
  for(const row of d.items){
    need(UUID.test(row?.id??''),'deployment-uuid');const detail=d.details[row.id];
    captured(native,BASE+id+'/deployments/'+row.id,d.detailReferences?.[row.id],now);
    for(const value of [row,detail])need(value?.id===row.id&&value.app_id===id&&value.account_id===ACCOUNT&&value.app_version===app.version&&value.image===image,'current-deployment-app-version-image-link');
    need(detail.state?.current==='placed','deployment-lifecycle-not-known-placed');
    const a=row.current_placement,b=detail.current_placement;
    for(const placement of [a,b])need(UUID.test(placement?.id??'')&&placement.deployment_id===row.id&&placement.deployment_version===app.version&&placement.terminate===false&&placement.status?.container_status==='stopped'&&['running','stopped'].includes(placement.status?.health),'current-placement-not-known-idle');
    equal([a.id,a.deployment_id,a.deployment_version,a.terminate,a.status.health,a.status.container_status],[b.id,b.deployment_id,b.deployment_version,b.terminate,b.status.health,b.status.container_status],'list-detail-placement-conflict');
    placements.push({deploymentId:row.id,appVersion:detail.app_version,image:detail.image,deploymentState:detail.state.current,placementId:b.id,vmHealth:b.status.health,containerStatus:b.status.container_status,terminate:b.terminate});
  }
  if(d.items.length===0)need(app.instances===0&&(!app.health?.instances||app.health.instances.healthy===0),'empty-deployment-family-with-nonempty-app-runtime');
  return {appId:id,version:app.version,image,maxInstances:app.max_instances,schedulingPolicy:app.scheduling_policy,logicalCount:legacy.length,currentDeploymentCount:d.items.length,dashInstanceCount:p.dash.instances.length,placements};
}
function originalRollout(phase,native,known,priorBootstrap,images,now){
  const after=phase.startsWith('after-rollout-');
  if(!after){need(known==null,'unexpected-original-rollout');return null;}
  const id=phase==='after-rollout-project-tools'?PT:PI,cap=known?.capability,freshBody=native.byApp[id].physicalSupplement.freshOriginalRollout;
  need(known&&UUID.test(known.rolloutId??'')&&cap?.appId===id&&cap.rolloutId===known.rolloutId&&known.body?.success===true&&known.body.result?.id===known.rolloutId&&HEX.test(known.sha256??''),'known-original-rollout-identity');
  need(['originalAckSha256','originalIntentSha256','initialBodySha256'].every(k=>HEX.test(cap[k]??''))&&cap.initialBodySha256===known.sha256,'original-safe-ack-intent-and-first-get-binding');
  need(known.body.result.target_configuration?.image===images[id]&&cap.targetConfiguration?.image===images[id],'original-rollout-root-image');
  need(freshBody?.appId===id&&freshBody.rolloutId===known.rolloutId&&freshBody.originalAckSha256===cap.originalAckSha256&&freshBody.originalIntentSha256===cap.originalIntentSha256&&freshBody.initialBodySha256===known.sha256,'fresh-same-original-rollout-provenance');
  equal(known.fresh,freshBody,'actual-fresh-rollout-object-binding');fresh(freshBody.observedAt,now);
  captured(native,BASE+id+'/rollouts/'+known.rolloutId,freshBody.reference,now);
  const envelope=freshBody.body,result=envelope?.result,app=native.byApp[id].application;
  need(envelope?.success===true&&(!envelope.errors||Array.isArray(envelope.errors)&&envelope.errors.length===0)&&result?.id===known.rolloutId&&result.status===ROLLOUT_SCHEMA_PIN.successfulStatus,'original-rollout-not-successfully-completed');
  // The GET route capability binds the actual application even if the API
  // omits an app-id field. Any explicit app identity must agree with that route.
  for(const key of ['app_id','application_id'])if(result[key]!==undefined)need(result[key]===id,'rollout-explicit-application-conflict');
  equal(result.target_configuration,cap.targetConfiguration,'fresh-original-rollout-target-config');
  equal(freshBody.currentApplication,{version:app.version,configuration:app.configuration},'fresh-rollout-current-application-link');
  for(const [key,value]of Object.entries(result.target_configuration))equal(app.configuration[key],value,'rollout-target-active-configuration');
  for(const key of ['app_version','application_version','target_version'])if(result[key]!==undefined)need(result[key]===app.version,'rollout-active-version-conflict');
  need(app.active_rollout_id==null,'original-rollout-still-active');
  const prior=priorBootstrap?.byApp?.[id];need(prior?.application?.id===id&&Array.isArray(prior.versions),'original-prepublication-app-version-baseline');
  need(app.version>prior.application.version&&app.configuration.image!==prior.application.configuration?.image,'original-rollout-app-did-not-advance');
  equal(Object.fromEntries(Object.entries(app.configuration).filter(([k])=>k!=='image')),Object.fromEntries(Object.entries(prior.application.configuration).filter(([k])=>k!=='image')),'rollout-non-image-configuration-drift');
  const versions=native.byApp[id].versions,added=versions.filter(x=>!prior.versions.some(old=>old.version===x.version));
  need(added.length===1&&added[0].version===app.version&&added[0].percentage===100&&added[0].configuration?.image===images[id],'one-original-rollout-active-version-added');
  for(const old of prior.versions){const row=versions.find(x=>x.version===old.version);if(!row){need(old.version!==prior.application.version&&old.percentage===0,'previous-current-version-missing');continue;}need(row.percentage===0,'original-version-still-serving');equal(Object.fromEntries(Object.entries(row).filter(([k])=>k!=='percentage')),Object.fromEntries(Object.entries(old).filter(([k])=>k!=='percentage')),'original-version-history-drift');}
  const changes={},lifecycle=new Set(['version','active_rollout_id','updated_at','updated_on']);
  for(const key of new Set([...Object.keys(prior.application),...Object.keys(app)])){
    if(key==='configuration'||hash(prior.application[key])===hash(app[key]))continue;
    need(lifecycle.has(key)&&Object.hasOwn(app,key),'unexplained-original-app-lifecycle-delta');changes[key]=app[key];
  }
  return {rolloutTerminalVerified:true,rolloutId:known.rolloutId,explainedLifecycleChanges:changes,rolloutEvidence:{appId:id,originalAckRecordKind:'safe-ack-bound-to-original-intent',fullOriginalPostAckBodyIndependentlyRead:false,originalAckSha256:cap.originalAckSha256,originalIntentSha256:cap.originalIntentSha256,initialBodySha256:known.sha256,freshReference:freshBody.reference,status:result.status,currentAppVersion:app.version,currentImage:app.configuration.image,successfulTerminalSchema:ROLLOUT_SCHEMA_PIN}};
}
export async function evaluatePhysicalRelease(input){
  const {phase,requestId,facts,maintenance,native,nativeReference,maintenanceReference,priorBootstrap,knownOriginalRollout,signal,deadline}=input??{},now=Date.now();
  need(!signal?.aborted&&Number.isFinite(deadline)&&now<deadline,'original-assessment-deadline-or-cancel');
  need(requestId===REQUEST&&facts?.requestId===REQUEST&&facts.finalMain?.sha===MAIN&&facts.finalMain?.tree===TREE,'fixed-original-actual-main');
  const q=logical(maintenance,facts,maintenanceReference,now);ref(nativeReference);
  need(native?.schema==='riffoid-ir.native-original-app-physical-readback/v1'&&native.requestId===REQUEST&&native.accountId===ACCOUNT&&native.worker===WORKER&&native.onlyGet===true&&native.complete===true&&native.releaseInferred===false&&native.vmContainerProcessLeaseFactsDistinct===true&&object(native.byApp)&&Object.keys(native.byApp).sort().join(',')===[...APPS].sort().join(',')&&Array.isArray(native.captures),'actual-complete-two-original-app-capture');
  const start=fresh(native.startedAt,now),end=fresh(native.endedAt,now);need(end>=start&&q.hold.beganAt<=Math.min(start,q.checkedAt),'same-continuous-hold-fresh-native-and-authority-projection');
  for(const capture of native.captures){ref(capture.reference);const at=fresh(capture.observedAt,now);need(at>=start-2000&&at<=end+2000,'native-capture-time-bound');}
  const images=phaseImages(phase,facts),apps=APPS.map(id=>classifyApp(native,id,images[id],now));
  const rollout=originalRollout(phase,native,knownOriginalRollout,priorBootstrap,images,now);
  const derivation={schema:'riffoid-ir.scope-qualified-release-derivation/v1',scope:'two-original-applications-admitted-runtime-only',method:'original-global-terminal-proof-projection-plus-current-complete-native-container-state-and-continuous-maintenance-barrier',maintenanceReference,nativeReference,sourcePins:SOURCE_PINS,originalColdAndPairedProofsValidatedByAuthority:true,noNewAdmissionUnderSameHold:true,rawInternalStopLeaseAckIndependentlyRead:false,independentPidEnumerationPerformed:false,oldIdlePlacementGrantInherited:false,apps};
  const processEvidence={...derivation,domain:'admitted-workload-process'},leaseEvidence={...derivation,domain:'original-cold-and-paired-runtime-lease'},physicalEvidence={...derivation,domain:'currently-exposed-native-boundary',allHistoricalPlacementDisposalClaimed:false,allVmsAbsentClaimed:false,feesStoppedClaimed:false};
  need(!signal?.aborted&&Date.now()<deadline,'original-assessment-late-cancel-or-deadline');
  return {schema:'riffoid-ir.owner-native-release-assessment/v1',requestId:REQUEST,phase,observedAt:new Date(Math.min(q.checkedAt,end)).toISOString(),nativeCaptureSha256:nativeReference.sha256,maintenanceResponseSha256:maintenanceReference.sha256,unknownRequests:false,rawInternalStopLeaseAckIndependentlyRead:false,independentPidEnumerationPerformed:false,processes:{verified:true,activeCount:0,evidenceSha256:hash(processEvidence),derivation:processEvidence},leases:{verified:true,activeCount:0,evidenceSha256:hash(leaseEvidence),derivation:leaseEvidence},physical:{verified:true,vmAndContainerStatesKeptSeparate:true,evidenceSha256:hash(physicalEvidence),derivation:physicalEvidence},...(rollout??{})};
}
