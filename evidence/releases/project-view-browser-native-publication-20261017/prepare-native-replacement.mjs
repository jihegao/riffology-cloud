// Pure offline preparation and closed dummy-client simulation. No auth loader or network adapter.
import {readFile,lstat,realpath,open,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=dirname(fileURLToPath(import.meta.url));
const OLD=resolve(ROOT,'../jhg46-publication-review-20261017/publish-default-closed.mjs');
const OLD_SHA='9a866f448d4de0150a28b8dc2ececa542e44ed077aee7f559e75455d216b08c2';
export const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e',WORKER='riffology-m1-gateway-staging';
export const BASE=`/accounts/${ACCOUNT}/workers/scripts/${WORKER}`,PUT=BASE+'?bindings_inherit=strict';
export const PINS=Object.freeze({candidateDir:'candidate-v3',implementation:'bc4c0377dd4a59c6ddf6b9de71e3f0fcbe028999',sourceBinding:'e946c4050a70637ea9c93537d9ce4518273b78683c59c44652314fcaabc61a54',baseline:'ce8277c2cfb39feba6ce93e09754525e9a02e68c03a41402bbc9c0c14c99680a',bundle:'0475703a4ccda6d695709f6045b321431dc60b0e5369bc308bf08cee8279bd85',bundleBytes:5775036,manifest:'b24e87bf762801056e447c106600e1fcee9f23e43c01830436006b5dca8ce1ad',inventory:'b1fd4e1fe0b538af20cfb090242fa996f75bf26f8076e259a774ee2d5338b39a',graph:'bc6cad8a5bfe5f95f3533f8accca392f7a17e9be8db1c834712063b061de5db7',buildManifest:'497bcfd1a3027c27de6c55a1a7cbaa1ad954b0ce03333f3b67e230d7d7eb0aa2',frameHtml:'4bd78b2cf7c06051af24d97c2fd7665eea3b96ddbffe6b23daec485ee1e3eff2'});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hashJSON=x=>sha(JSON.stringify(canonical(x)));
const check=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b,code)=>check(hashJSON(a)===hashJSON(b),code);
async function readBounded(path,max){const s=await lstat(path);check(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'bounded-regular-file-required');return readFile(path);}
async function save(path,value){const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');const f=await open(path,'wx',0o600);try{await f.writeFile(b);await f.sync();}finally{await f.close();}return {bytes:b.length,sha256:sha(b)};}
async function helpers(){check(sha(await readBounded(OLD,128*1024))===OLD_SHA,'reviewed-helper-hash-mismatch');const m=await import(pathToFileURL(OLD).href);return {sendOnce:m.sendOnce,allowedRequest:m.allowedRequest,freezeMultipart:m.freezeMultipart,validateBuckets:m.validateBuckets,boundedResponse:m.boundedResponse};}
export function assertTarget(target){check(target?.accountId===ACCOUNT&&target.worker===WORKER,'cross-target-denied');}
export function validateBaseline(b){
 check(b?.schema==='project-view-browser-native-baseline/private-v1'&&b.stable===true&&b.secretValuesRequested===false,'baseline-authority');
 const bs=b.settings?.bindings,rt=b.version?.resources?.script_runtime;
 check(Array.isArray(bs)&&bs.length===106&&new Set(bs.map(x=>x.name)).size===106,'baseline-binding-count');
 check(bs.filter(x=>x.type==='secret_text'||x.type==='secret_key').length===11,'baseline-secret-count');
 same(bs,b.version.resources.bindings,'version-settings-binding-drift');
 check(Object.keys(rt?.exports??{}).length===25&&rt.containers?.length===6,'baseline-resource-count');
 check(b.namespaces?.result?.length===50&&b.namespaces.result_info?.total_count===50,'baseline-namespace-completeness');
 check(!bs.some(x=>x.name==='PROJECT_VIEW_BROWSER_POLICY_JSON'),'browser-policy-must-remain-absent');
 check(bs.find(x=>x.name==='PROJECT_VIEW_POLICY_JSON')?.text==='{"enabled":false}','remote-policy-must-remain-closed');
 check(b.version.id==='eae8764f-fda5-4241-9f51-cf01ecc46b00'&&b.deployments?.deployments?.[0]?.id==='0f9c6266-2541-41ff-877e-9e9bbb85f3a2','baseline-active-identity');
 check(b.deployments.deployments[0].versions?.length===1&&b.deployments.deployments[0].versions[0].version_id===b.version.id&&b.deployments.deployments[0].versions[0].percentage===100,'baseline-active-percentage');
}
export function buildMetadata(b,{requestId}){
 validateBaseline(b);check(UUID.test(requestId),'request-id');
 const metadata={...structuredClone(b.settings),main_module:'index.js',bindings:b.settings.bindings.filter(x=>!['secret_text','secret_key'].includes(x.type)).map(x=>structuredClone(x)),keep_bindings:['secret_text','secret_key'],exports:structuredClone(b.version.resources.script_runtime.exports),containers:structuredClone(b.version.resources.script_runtime.containers)};
 metadata.annotations={...metadata.annotations,'workers/tag':'jhg46-native-20261017-'+requestId.slice(0,8),'workers/message':'JHG-46 browser-native source/assets replacement; admission unchanged'};
 assertMetadata(metadata,b);return metadata;
}
export function assertMetadata(m,b){
 validateBaseline(b);check(m.main_module==='index.js'&&!Object.hasOwn(m,'migrations')&&!Object.hasOwn(m,'assets'),'no-migration-resource-or-jwt-addition');
 const allowed=[...Object.keys(b.settings),'main_module','keep_bindings','exports','containers'].sort();same(Object.keys(m).sort(),allowed,'metadata-unknown-field');
 check(m.bindings?.length===95&&new Set(m.bindings.map(x=>x.name)).size===95,'wire-binding-count');same(m.keep_bindings,['secret_text','secret_key'],'secret-keep-required');
 same(m.bindings,b.settings.bindings.filter(x=>!['secret_text','secret_key'].includes(x.type)),'all-original-wire-bindings-required');
 same(m.exports,b.version.resources.script_runtime.exports,'all-original-exports-required');same(m.containers,b.version.resources.script_runtime.containers,'all-original-container-associations-required');
 for(const k of Object.keys(b.settings).filter(k=>!['bindings','annotations'].includes(k)))same(m[k],b.settings[k],'original-setting-'+k);
 const omit=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['workers/tag','workers/message'].includes(k)));same(omit(m.annotations),omit(b.settings.annotations),'original-annotations-required');
 check(/^jhg46-native-20261017-[a-f0-9]{8}$/.test(m.annotations['workers/tag'])&&m.annotations['workers/message']==='JHG-46 browser-native source/assets replacement; admission unchanged','release-annotation');
}
export async function loadInputs(){
 const compressed=await readBounded(resolve(ROOT,'baseline-full.private.json.gz'),256*1024),raw=gunzipSync(compressed,{maxOutputLength:256*1024});check(sha(raw)===PINS.baseline,'baseline-hash');const baseline=JSON.parse(raw);validateBaseline(baseline);
 const candidate=resolve(ROOT,PINS.candidateDir);
 const module=await readBounded(resolve(candidate,'gateway.mjs'),8*1024*1024);check(module.length===PINS.bundleBytes&&sha(module)===PINS.bundle,'bundle-hash');
 const load=async(name,pin,max)=>{const bytes=await readBounded(resolve(candidate,name),max);check(sha(bytes)===pin,name+'-hash');return JSON.parse(bytes);};
 const manifest=await load('assets-manifest.json',PINS.manifest,128*1024),inventory=await load('assets-sha256.json',PINS.inventory,128*1024),graph=await load('source-graph.json',PINS.graph,2*1024*1024);
 check(inventory.length===96&&Object.keys(manifest).length===96&&new Set(inventory.map(x=>x.path)).size===96,'asset-set-count');
 check(inventory.filter(x=>x.path.startsWith('/browser-preview-assets/')).length===68&&inventory.some(x=>x.path==='/project-view-local.js'),'asset-split');
 const build=await load('build-manifest.json',PINS.buildManifest,128*1024);check(build.schema==='project-view-browser-native-local-build/v3'&&build.frame?.htmlSha256===PINS.frameHtml&&build.artifacts.bundle.sha256===PINS.bundle&&build.artifacts.sourceGraph.sha256===PINS.graph,'candidate-v3-closure');
 const binding=await load('source-commit-binding-v3.json',PINS.sourceBinding,128*1024);check(binding.schema==='project-view-browser-native-source-commit-binding/v1'&&binding.implementationCommit===PINS.implementation&&binding.candidateDir===PINS.candidateDir&&binding.sourceGraph.currentDiskAllHashesMatch===true&&binding.artifacts['gateway.mjs'].sha256===PINS.bundle&&binding.artifacts['source-graph.json'].sha256===PINS.graph&&binding.frame.htmlSha256===PINS.frameHtml,'candidate-v3-source-commit-binding');
 const assetRoot=resolve(candidate,'candidate-assets'),assetBytes=new Map();
 for(const a of inventory){check(typeof a.path==='string'&&a.path.startsWith('/')&&!a.path.includes('\\')&&!a.path.split('/').some(p=>p==='.'||p==='..'),'asset-path');const p=resolve(assetRoot,'.'+a.path),actual=await realpath(p);check(actual.startsWith(assetRoot+sep)&&actual===p,'asset-symlink-or-escape');const bytes=await readBounded(p,64*1024*1024);check(bytes.length===a.bytes&&sha(bytes)===a.sha256&&manifest[a.path]?.size===bytes.length&&/^[a-f0-9]{32}$/.test(manifest[a.path].hash),'asset-body-or-address');const h=manifest[a.path].hash;if(assetBytes.has(h))check(assetBytes.get(h).equals(bytes),'asset-address-collision');else assetBytes.set(h,bytes);}
 return {baseline,module,manifest,inventory,graph,assetBytes,candidateDir:PINS.candidateDir,build,binding};
}
export async function prepare({requestId=randomUUID(),target={accountId:ACCOUNT,worker:WORKER}}={}){
 assertTarget(target);check(UUID.test(requestId),'request-id');await helpers();const i=await loadInputs(),metadata=buildMetadata(i.baseline,{requestId});
 const parent=resolve(ROOT,'metadata-reviews');await mkdir(parent,{recursive:true,mode:0o700});const directory=resolve(parent,requestId);await mkdir(directory,{mode:0o700});
 const metadataFile=await save(resolve(directory,'metadata-without-jwt.private.json'),metadata);
 const plan={schema:'project-view-browser-native-replacement-review/v1',requestId,createdAt:new Date().toISOString(),target,reviewOnly:true,executable:false,executeDisabled:true,helperSha256:OLD_SHA,toolSha256:sha(await readBounded(fileURLToPath(import.meta.url),128*1024)),pins:PINS,metadata:metadataFile,assets:96,wireBindings:95,secretBindingsRetained:11,logicalBindings:106,exports:25,containerAssociations:6,namespaces:50,browserPolicyBindingAbsent:true,remotePolicyClosed:true,baselineCoverage:{worker:true,namespaces:true,newAppOnly:true,all16AppsVersionsRegistryRoutesCronsDomains:false},pending:['root-reviewed explicit publication grant/envelope','actual PR235 merge/source graph proof','fresh complete routes/crons/domains and 16-app/all-version/registry preservation witnesses','real asset-session/completion JWT; no synthetic credential may authorize publication'],prohibited:['new binding/export/namespace/app or migration','gate/image/policy changes','container/provider/Turn/Run','credentials or network in this tool','retry/rollback/unlock'],credentialsRead:false,networkRequests:0,cloudWrites:0};
 const receipt=await save(resolve(directory,'plan.json'),plan);return {directory,requestId,planSha256:receipt.sha256,metadataSha256:metadataFile.sha256,executable:false,credentialsRead:false,networkRequests:0,cloudWrites:0};
}
// Only clients created here are accepted. Steps contain inert synthetic bytes or
// a synthetic error marker, never callbacks, fetch functions or credential data.
const dummyClients=new WeakMap();
export function createOfflineDummyClient(steps){
 check(Array.isArray(steps)&&steps.length<=110,'dummy-steps');const script=JSON.parse(JSON.stringify(steps)),calls=[];
 const request=async(method,path,options)=>{const step=script[calls.length];calls.push({method,path,bodySha256:sha(options.body),requestId:options.requestId,credentialKind:options.credentialKind??'oauth'});check(step&&step.method===method&&step.path===path,'dummy-script-mismatch');if(step.error)throw Error('synthetic-unknown');return structuredClone(step.result);};
 const client=Object.freeze({get calls(){return structuredClone(calls);}});dummyClients.set(client,request);return client;
}
export async function simulate({directory,requestId,metadata,baseline,module,manifest,assetBytes,client,target={accountId:ACCOUNT,worker:WORKER}}){
 assertTarget(target);check(dummyClients.has(client),'only-closed-offline-dummy-client');check(UUID.test(requestId),'request-id');assertMetadata(metadata,baseline);
 check(module.length===PINS.bundleBytes&&sha(module)===PINS.bundle,'bundle-hash');check(Object.keys(manifest).length===96,'asset-set-count');
 const h=await helpers();await save(resolve(directory,'simulation.lock.json'),{requestId,target,offlineOnly:true,noAutomaticUnlock:true});let phase='asset-session';
 try{
  const session=await h.sendOnce({directory,key:'asset-session',method:'POST',path:BASE+'/assets-upload-session',body:Buffer.from(JSON.stringify({manifest})),contentType:'application/json',requestId,client:dummyClients.get(client)});h.validateBuckets(session,manifest);let completion=session.buckets.length?null:session.jwt;
  for(const [index,bucket]of session.buckets.entries()){phase='asset-upload-'+index;const form=new FormData();for(const hash of bucket){const bytes=assetBytes.get(hash);check(Buffer.isBuffer(bytes),'dummy-bucket-file-missing');form.set(hash,new Blob([bytes.toString('base64')],{type:'application/octet-stream'}),hash);}const r=new Request('https://offline.invalid/',{method:'POST',body:form});const body=Buffer.from(await r.arrayBuffer());check(body.length<=150*1024*1024,'asset-bucket-bound');const ack=await h.sendOnce({directory,key:phase,method:'POST',path:`/accounts/${ACCOUNT}/workers/assets/upload?base64=true`,body,contentType:r.headers.get('content-type'),credentialKind:'asset',requestId,client:dummyClients.get(client)});if(ack?.jwt)completion=ack.jwt;}
  check(typeof completion==='string'&&completion.startsWith('offline.')&&completion.endsWith('.synthetic'),'only-synthetic-completion');
  phase='worker-put';const m=structuredClone(metadata),a=baseline.version.resources.script_runtime.assets;m.assets={jwt:completion,config:{html_handling:a.html_handling,not_found_handling:a.not_found_handling,run_worker_first:a.raw_run_worker_first}};const frozen=await h.freezeMultipart(m,module);await save(resolve(directory,'simulation-multipart.private.bin'),frozen.body);await save(resolve(directory,'simulation-multipart.json'),{requestId,sha256:sha(frozen.body),bytes:frozen.body.length,contentType:frozen.contentType});
  await h.sendOnce({directory,key:'worker-put',method:'PUT',path:PUT,body:frozen.body,contentType:frozen.contentType,requestId,client:dummyClients.get(client)});
  const result={schema:'project-view-browser-native-offline-simulation/v1',result:'dummy-protocol-only',requestId,dummyCalls:client.calls.length,realNetworkRequests:0,realCloudWrites:0,publicationAccepted:false,postwritePreservationProved:false};await save(resolve(directory,'simulation-result.json'),result);return result;
 }catch(e){await save(resolve(directory,'simulation-stopped.json'),{requestId,phase,result:'dummy-unknown-or-rejected-stop',originalLockRetained:true,noRetry:true,publicationAccepted:false});throw e;}
}
export function execute(){throw Error('execute-disabled-no-human-publication-envelope-or-network-adapter');}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const args=process.argv.slice(2);if(args[0]==='--execute')execute();check(args.length===0||args.length===1&&args[0]==='--prepare-only'||args.length===3&&args[0]==='--prepare-only'&&args[1]==='--request-id','arguments');console.log(JSON.stringify(await prepare({...(args[2]?{requestId:args[2]}:{})})));}catch(e){console.error(JSON.stringify({result:'stopped',code:e.message,credentialsRead:false,networkRequests:0,cloudWrites:0}));process.exitCode=1;}}
