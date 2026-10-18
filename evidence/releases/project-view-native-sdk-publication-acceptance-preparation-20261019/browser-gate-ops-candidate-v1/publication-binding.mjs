// Pure original-receipt binding; no files, credentials, requests, or mutation.
import {createHash} from 'node:crypto';
import {stableProjection} from '../gateway-ops-candidate-v1/dated-baseline.mjs';
const PUB='1feadf24-3eb8-58be-abd7-872c68ab45e6',GATE='95b9b8c6-8d52-566d-8476-dfa3e02f6b79',SOURCE='304373a50d7a9ca8a99cdfbda0dcae261aa34d53727b757dfeb099c88efb5e0b';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hex=/^[a-f0-9]{64}$/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>sha(JSON.stringify(canonical(x))),check=(v)=>{if(!v)throw Error('original-sdk-publication-receipt-required');};
function doc(raw,max){check(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=max);return JSON.parse(raw);}
export function validatePublishedBase(proof){
 check(proof&&hex.test(proof.rootReviewedReceiptSha256??'')&&sha(proof.receiptRaw)===proof.rootReviewedReceiptSha256);
 const r=doc(proof.receiptRaw,128*1024),a=doc(proof.ackRaw,1024*1024),s=doc(proof.afterRaw,2*1024*1024);
 check(r.requestId===PUB&&r.result==='worker-and-independent-preservation-readback-passed'&&r.independentAll16AppsVersionsRegistryPreservation==='complete'&&r.source?.sha256===SOURCE&&r.source.bytes===5774988&&uuid.test(r.actualVersionId??''));
 check(sha(proof.ackRaw)===r.ackFile?.sha256&&sha(proof.afterRaw)===r.afterFile?.sha256&&a.id==='riffology-m1-gateway-staging'&&a.deployment_id===r.actualVersionId.replaceAll('-',''));
 check(s.version?.id===r.actualVersionId&&s.source?.sha256===SOURCE&&s.source.bytes===5774988&&s.active?.versions?.length===1&&s.active.versions[0].version_id===r.actualVersionId&&s.active.versions[0].percentage===100);
 const bindings=s.settings?.bindings,rt=s.version.resources?.script_runtime;
 check(bindings?.length===106&&!bindings.some(x=>x.name==='PROJECT_VIEW_BROWSER_POLICY_JSON')&&bindings.find(x=>x.name==='PROJECT_VIEW_POLICY_JSON')?.text==='{"enabled":false}'&&Object.keys(rt.exports).length===25&&rt.containers.length===6);
 check(hash(bindings)===hash(s.version.resources.bindings)&&s.settings.annotations?.['workers/triggered_by']==='upload'&&hash(s.settings.annotations)===hash(s.version.annotations));
 const names=bindings.filter(x=>['secret_text','secret_key'].includes(x.type)).map(x=>({name:x.name,type:x.type})).sort((a,b)=>a.name.localeCompare(b.name));check(names.length===11);
 const w=r.afterWitness?.data;check(w?.workerVersionId===r.actualVersionId&&w.actualServingModule?.sha256===SOURCE&&w.complete===true&&w.onlyGet===true&&w.cloudWrites===0&&w.counts?.apps===16&&w.counts?.appVersionLists===16);
 return {requestId:GATE,publisherRequestId:PUB,closedVersionId:r.actualVersionId,sourceSha256:SOURCE,stableMetadataSha256:hash(stableProjection(s.settings,s.version,s.source,names)),controlPlaneSha256:'47cffd4f19c05708438ad9824d69d38801cf48001d7da8b64e32cd03d89a6c68',receiptSha256:sha(proof.receiptRaw),ackSha256:sha(proof.ackRaw),afterSha256:sha(proof.afterRaw)};
}
export function deriveGatePlan({humanGrant,policy,identity},proof){const b=validatePublishedBase(proof);return {requestId:b.requestId,accountId:'8b0d70250211aa10d89e20605a1c7e5e',worker:'riffology-m1-gateway-staging',sourceSha256:b.sourceSha256,expectedVersionId:b.closedVersionId,stableMetadataSha256:b.stableMetadataSha256,controlPlaneSha256:b.controlPlaneSha256,humanGrant,policy,identity};}
