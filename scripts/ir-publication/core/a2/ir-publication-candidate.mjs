/** Pure candidate validators/builders only. This file has no live transport. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {GuardError,guard} from './reviewed-wire-primitives.mjs';
export {GuardError};
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hashJSON=x=>createHash('sha256').update(JSON.stringify(canonical(x))??'undefined').digest('hex');
const same=(a,b,code)=>guard(hashJSON(a)===hashJSON(b),code);
const clone=x=>structuredClone(x),secrets=new Set(['secret_text','secret_key']);
const omit=(x,keys)=>Object.fromEntries(Object.entries(x).filter(([k])=>!keys.includes(k)));
const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e';
const rolloutTargets={
  'a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650':{role:'project-tools',repository:'registry.cloudflare.com/'+ACCOUNT+'/riffology-20261001-project-tools',rootDescriptor:{mediaType:'application/vnd.oci.image.manifest.v1+json',digest:'sha256:402381b5b2c0f460e6af44bc4e953d53f6bdb648de4c9ccbeee837815580cd8f',size:7131}},
  'a03628c4-f032-461f-a65b-612ccac11a06':{role:'trusted-pi',repository:'registry.cloudflare.com/'+ACCOUNT+'/riffology-issue165-trusted-pi',rootDescriptor:{mediaType:'application/vnd.oci.image.manifest.v1+json',digest:'sha256:dcd4a5fc6f02c9d0ee1290e07c268a8dba4aba1790e75b98c5f7bb83792da487',size:12864}}
};
const targetApps=new Set(Object.keys(rolloutTargets));
function fixedRolloutTarget(app,image){
  const target=rolloutTargets[app?.id];guard(target,'same-existing-app-id');
  guard(app.configuration?.image?.split('@')[0]===target.repository,'fixed-original-app-repository');
  guard(image===target.repository+'@'+target.rootDescriptor.digest,'fixed-app-root-image-reference');
  return target;
}
/** The external owner seals this canonical receipt; this module cannot attest its live origin. */
export function assertRegistryReadback(app,image,receipt,ownerSeal){
  const target=fixedRolloutTarget(app,image);
  guard(ownerSeal?.schema==='riffoid-ir.registry-owner-seal/v1'&&ownerSeal.role==='ir-publication-owner'&&/^[a-f0-9]{64}$/.test(ownerSeal.receiptCanonicalSha256??''),'external-owner-registry-seal-required');
  guard(receipt?.schema==='riffoid-ir.registry-full-get-readback/v1','registry-readback-schema');
  guard(ownerSeal.receiptCanonicalSha256===hashJSON(receipt),'owner-registry-receipt-binding');
  guard(receipt.role===target.role&&receipt.accountId===ACCOUNT&&receipt.appId===app.id&&receipt.repository===target.repository&&receipt.imageReference===image,'registry-readback-target');
  same(receipt.rootDescriptor,target.rootDescriptor,'registry-readback-root-descriptor');
  guard(receipt.onlyGet===true&&receipt.fullReadback===true&&receipt.rootManifestAndAllReachableBlobsReadBack===true&&receipt.allDigestsAndSizesVerified===true,'complete-registry-get-readback-required');
}

function completeList(b,name,rows){
  guard(Array.isArray(rows),'complete-list-shape-'+name);
  const proof=b.collectionProofs?.[name];
  guard(proof?.complete===true&&proof.paginationTerminal===true&&proof.truncated===false&&proof.itemCount===rows.length,'incomplete-collection-'+name);
  guard(proof.itemsCanonicalSha256===hashJSON(rows),'collection-content-link-'+name);
  if(proof.totalCount!==null&&proof.totalCount!==undefined)guard(proof.totalCount===rows.length,'collection-total-'+name);
}
/** Requires full collector receipts. This checks linkage, not live authenticity. */
export function assertCompleteBaseline(b){
  guard(b?.completeBodiesCaptured===true&&b.rawApiResultInfoPreserved===true,'full-baseline-capture-required');
  const s=b.controls?.settings,rt=b.version?.resources?.script_runtime;
  guard(s&&Array.isArray(s.bindings)&&rt&&rt.exports&&Array.isArray(rt.containers),'baseline-runtime-shape');
  guard(new Set(s.bindings.map(x=>x.name)).size===s.bindings.length,'binding-name-unique');
  for(const binding of s.bindings)if(secrets.has(binding.type))guard(!['text','value','key_base64','key_jwk'].some(k=>Object.hasOwn(binding,k)),'secret-value-not-permitted');
  same(s.bindings,b.version.resources.bindings,'settings-version-bindings-link');
  for(const name of ['namespaces','routes','domains','schedules','registries'])completeList(b,name,b.controls[name]);
  completeList(b,'apps',b.apps);guard(new Set(b.apps.map(x=>x.id)).size===b.apps.length,'app-id-unique');
  same(Object.keys(b.appVersions??{}).sort(),b.apps.map(x=>x.id).sort(),'all-app-version-families-required');
  for(const app of b.apps)completeList(b,'appVersions:'+app.id,b.appVersions[app.id]);
  guard(b.controls.subdomain&&b.controls.deployments&&b.source,'all-controls-and-source-required');
  return {bindings:s.bindings.length,wireBindings:s.bindings.filter(x=>!secrets.has(x.type)).length,retainedSecrets:s.bindings.filter(x=>secrets.has(x.type)).length,exports:Object.keys(rt.exports).length,containerAssociations:rt.containers.length,apps:b.apps.length,appVersionLists:Object.keys(b.appVersions).length,namespaces:b.controls.namespaces.length,routes:b.controls.routes.length};
}
export function buildGatewayMetadata(b,{tag,message}={}){
  assertCompleteBaseline(b);guard(typeof tag==='string'&&tag.length>0&&typeof message==='string'&&message.length>0,'new-request-annotation-required');
  const s=b.controls.settings,rt=b.version.resources.script_runtime;
  guard(!Object.hasOwn(s,'assets')&&!Object.hasOwn(s,'migrations'),'settings-upload-fields-need-explicit-review');
  const m={...clone(s),main_module:'index.js',bindings:s.bindings.filter(x=>!secrets.has(x.type)).map(clone),keep_bindings:['secret_text','secret_key'],exports:clone(rt.exports),containers:clone(rt.containers)};
  m.annotations={...m.annotations,'workers/tag':tag,'workers/message':message,'workers/triggered_by':'upload'};
  assertMetadataPreserved(m,b,{tag,message});return m;
}
export function assertMetadataPreserved(m,b,{tag,message}){
  const counts=assertCompleteBaseline(b),s=b.controls.settings,rt=b.version.resources.script_runtime;
  guard(m.main_module==='index.js'&&!Object.hasOwn(m,'assets')&&!Object.hasOwn(m,'migrations'),'replacement-only-metadata');
  same(Object.keys(m).sort(),[...new Set([...Object.keys(s),'main_module','keep_bindings','exports','containers'])].sort(),'all-setting-fields-preserved');
  same(m.keep_bindings,['secret_text','secret_key'],'keep-all-secret-types');
  same(m.bindings,s.bindings.filter(x=>!secrets.has(x.type)),'all-nonsecret-bindings-preserved');
  guard(m.bindings.length===counts.wireBindings,'derived-wire-count');
  same(m.exports,rt.exports,'all-exports-preserved');same(m.containers,rt.containers,'all-container-associations-preserved');
  same(omit(m,['main_module','bindings','keep_bindings','exports','containers','annotations']),omit(s,['bindings','annotations']),'all-other-settings-preserved');
  const keys=['workers/tag','workers/message','workers/triggered_by'];
  same(omit(m.annotations,keys),omit(s.annotations??{},keys),'all-other-annotations-preserved');
  same(keys.map(k=>m.annotations[k]),[tag,message,'upload'],'only-release-annotations-change');
  return counts;
}
/** Only classified upload config fields are allowed; fresh unknown fields stop. */
export function attachAssetCompletion(metadata,b,completion){
  guard(typeof completion==='string'&&completion.length>0&&completion.length<16384,'completion-required');
  const a=b.version.resources.script_runtime.assets;
  guard(a&&Object.hasOwn(a,'html_handling')&&Object.hasOwn(a,'not_found_handling')&&Object.hasOwn(a,'raw_run_worker_first'),'fresh-asset-config-required');
  same(Object.keys(a).sort(),['html_handling','not_found_handling','raw_run_worker_first'],'unclassified-assets-field');
  guard(typeof a.html_handling==='string'&&typeof a.not_found_handling==='string'&&(typeof a.raw_run_worker_first==='boolean'||Array.isArray(a.raw_run_worker_first)&&a.raw_run_worker_first.every(x=>typeof x==='string')),'unclassified-assets-config-shape');
  const m=clone(metadata);m.assets={jwt:completion,config:{html_handling:a.html_handling,not_found_handling:a.not_found_handling,run_worker_first:clone(a.raw_run_worker_first)}};return m;
}
export function assertGatewayReadback(before,after,{expectedMetadata,expectedModule}){
  assertCompleteBaseline(before);assertCompleteBaseline(after);
  same(omit(after.controls.settings,['annotations']),omit(before.controls.settings,['annotations']),'post-all-settings-and-bindings');
  same(after.controls.settings.annotations,expectedMetadata.annotations,'post-release-annotations');
  same(after.version.resources,before.version.resources,'post-all-runtime-resources-and-assets');
  same(after.version.annotations,expectedMetadata.annotations,'post-version-annotations');
  for(const key of Object.keys(before.controls).filter(k=>!['settings','deployments'].includes(k)))same(after.controls[key],before.controls[key],'post-control-'+key);
  same(after.apps,before.apps,'gateway-preserves-all-apps');same(after.appVersions,before.appVersions,'gateway-preserves-all-app-versions');
  same(after.source,expectedModule,'actual-serving-frozen-module');guard(after.version.id!==before.version.id,'new-worker-version-required');
  const versions=after.controls.deployments.deployments?.[0]?.versions;
  guard(versions?.length===1&&versions[0].version_id===after.version.id&&versions[0].percentage===100,'actual-serving-version-link');
}
/** New minimal request, based on primary Rollouts schema; no app sender reused. */
export function imageOnlyRolloutRequest(app,image,{description,registryReadback,registryReadbackOwnerSeal}={}){
  guard(targetApps.has(app?.id)&&app.scheduling_policy==='default','same-original-default-scheduler-app');
  assertRegistryReadback(app,image,registryReadback,registryReadbackOwnerSeal);
  guard(typeof description==='string'&&description.length>0,'new-original-request-description');
  return {description,kind:'full_auto',strategy:'rolling',step_percentage:100,target_configuration:{image}};
}
/** API omission semantics are never trusted: compare the entire actual config. */
export function assertImageOnlyAppReadback(before,after,image,{explainedLifecycleChanges={}}={}){
  guard(targetApps.has(before?.id)&&after?.id===before.id,'same-existing-app-id');
  fixedRolloutTarget(before,image);
  guard(before.scheduling_policy==='default'&&after.scheduling_policy==='default','default-scheduler-preserved');
  guard(after.configuration?.image===image,'exact-root-manifest-image');
  same(omit(after.configuration,['image']),omit(before.configuration,['image']),'all-configuration-except-image-preserved');
  const lifecycle=new Set(['version','active_rollout_id','updated_at','updated_on']);
  for(const key of Object.keys(explainedLifecycleChanges))guard(lifecycle.has(key),'unrecognized-lifecycle-explanation');
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(key==='configuration')continue;
    if(hashJSON(before[key])===hashJSON(after[key]))continue;
    guard(lifecycle.has(key)&&Object.hasOwn(explainedLifecycleChanges,key),'unexplained-app-change-'+key);
    same(after[key],explainedLifecycleChanges[key],'app-lifecycle-value-'+key);
  }
}
export function assertSameContinuousHold(before,after){
  guard(before?.hold&&after?.hold&&!before.receipts?.end&&!after.receipts?.end,'continuous-hold-required');
  same(after.hold,before.hold,'same-original-maintenance-hold');same(after.control,before.control,'same-maintenance-control');
}
export function prepareOnly(candidate){
  const required=['parent','handoff','requestId','finalMain','sourceMergeProof','freshCompleteBaseline','freshIndependentWitness','sameContinuousMaintenanceHold','productLogicalRelease','physicalRelease','publicationOrder'];
  const missing=required.filter(key=>candidate[key]===null);
  return {schema:'riffoid-ir-disabled-preparation-status/v1',executeDisabled:true,liveTransportImplemented:false,parent:candidate.parent,handoff:candidate.handoff,missing,conditionalUserAuthorizationRecorded:candidate.authority.source,newHumanGrantRequiredByThisPreparation:false,credentialReads:0,networkRequests:0,cloudWrites:0};
}
export function execute(){throw new GuardError('disabled-candidate-no-live-transport');}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{guard(process.argv.length<=3&&(process.argv[2]??'--prepare-only')==='--prepare-only','disabled-candidate-no-live-transport');const p=join(dirname(fileURLToPath(import.meta.url)),'candidate.disabled.json');console.log(JSON.stringify(prepareOnly(JSON.parse(await readFile(p)))));}catch(error){console.error(JSON.stringify({status:'stopped',code:error.code??'local-candidate-error',credentialReads:0,networkRequests:0,cloudWrites:0}));process.exitCode=1;}
}
