/** Fixed original Gateway PUT + two original app rollouts. Default CLI is closed.
 * Owner connections/witnesses are capabilities supplied only after real handoff.
 */
import {reconcileGateway} from './reconcile-gateway.mjs';
import {extname} from 'node:path';
import {ACCOUNT,ACCOUNT_BASE,BASE,PUT,WORKER,APP_IDS,LIMITS as FIXED_LIMITS,isId} from './fixed-target.mjs';
import {guard,sha,safeCode,boundedTask,fullResponse,apiEnvelope} from './io-boundary.mjs';
import {originalWrite} from './io-boundary.mjs';
import {collectBaseline,preservationProjection} from './collect-baseline.mjs';
import {assertExecutionFacts,loadFinalClosure} from './load-final-closure.mjs';
import {hashJSON,imageOnlyRolloutRequest,assertImageOnlyAppReadback,assertSameContinuousHold} from './a2/ir-publication-candidate.mjs';
import {buildGatewayMetadata} from './gateway-metadata.mjs';
import {assertGatewayReadback,assertWorkerHistory} from './gateway-readback.mjs';
import {attachAssetCompletion} from './assets-config.mjs';
import {freezeMultipart,validateBuckets} from './a2/reviewed-wire-primitives.mjs';
// Only the operator-demand + native observation phase envelope changes.
const LIMITS=Object.freeze({...FIXED_LIMITS,phaseWitnessMs:110000});
const same=(a,b,code)=>guard(hashJSON(a)===hashJSON(b),code);
export function assertAppVersionDelta(before,after,appId,image){
  for(const id of Object.keys(before.appVersions)){
    if(id!==appId){same(after.appVersions[id],before.appVersions[id],'other-app-version-family-drift');continue;}
    const old=before.appVersions[id],next=after.appVersions[id];
    guard(new Set(next.map(x=>x.version)).size===next.length,'app-version-duplicate');
    for(const row of old){const actual=next.find(x=>x.version===row.version);if(!actual){guard(row.version!==before.apps.find(x=>x.id===id)?.version&&row.percentage===0,'previous-current-app-version-missing');continue;}same(Object.fromEntries(Object.entries(actual).filter(([k])=>k!=='percentage')),Object.fromEntries(Object.entries(row).filter(([k])=>k!=='percentage')),'old-app-version-data-drift');guard(actual.percentage===0,'old-app-version-still-serving');}
    const added=next.filter(row=>!old.some(x=>x.version===row.version)),app=after.apps.find(x=>x.id===id);guard(added.length===1&&added[0].version===app.version&&added[0].percentage===100&&added[0].configuration?.image===image,'one-fully-serving-root-version-required');const beforeApp=before.apps.find(x=>x.id===id),active=old.filter(row=>row.percentage===100);
    guard(active.length===1&&active[0].version===beforeApp?.version&&active[0].configuration&&typeof active[0].configuration==='object'&&!Array.isArray(active[0].configuration)&&typeof beforeApp?.configuration?.image==='string'&&active[0].configuration.image===beforeApp.configuration.image,'before-version-real-representation-link');
    guard(app.configuration?.image===image,'after-app-version-image-crosslink');
    same(added[0].configuration,{...active[0].configuration,image},'new-version-preserves-version-api-representation');
  }
}
export async function publicReadback({connection,closure,origin,store,key,deadline,signal,frameClosed=false}){
  guard(typeof connection.publicGet==='function','owner-public-get-not-bound');const paths=[...closure.assets];
  if(closure.build.frame)paths.push({path:closure.build.frame.path,bytes:closure.build.frame.bytes,sha256:closure.build.frame.sha256});
  const records=new Array(paths.length);let next=0,stopped=false;
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,paths.length)},async()=>{try{for(;;){if(stopped)return;const index=next++,row=paths[index];if(!row)return;const raw=await boundedTask(async childSignal=>fullResponse(await connection.publicGet({origin,path:row.path,credentials:'omit',signal:childSignal}),{signal:childSignal,maxBytes:LIMITS.maxAssetBytes,captureRejected:true}),{deadline,maxMs:LIMITS.requestMs,signal});const closedFrame=frameClosed&&row.path===closure.build.frame?.path;await store.write(key+'-public-'+String(index).padStart(3,'0')+'.safe.json',{path:row.path,status:raw.status,bytes:raw.body.length,sha256:raw.sha256,expectedClosed:closedFrame,clientUserAgent:'node',observedAt:raw.observedAt});const matches=closedFrame?raw.status===503&&raw.body.length===0:raw.status===200&&raw.body.length===row.bytes&&raw.sha256===row.sha256;if(!matches)await store.write(key+'-public-'+String(index).padStart(3,'0')+'-mismatch.private.bin',raw.body);guard(matches,'public-asset-body-drift');records[index]={path:row.path,status:raw.status,bytes:raw.body.length,sha256:raw.sha256,expectedClosed:closedFrame,observedAt:raw.observedAt};}}catch(e){stopped=true;throw e;}}));
  const failed=outcomes.find(x=>x.status==='rejected');if(failed)throw failed.reason;
  const receipt=await store.write(key+'-public-assets.safe.json',{schema:'riffoid-ir-public-full-byte-readback/v1',complete:true,origin,files:records,credentials:'omit',redirectsAccepted:false});return receipt;
}
export async function runPublication(options={}){
  assertExecutionFacts(options.facts);const deadline=Math.min(Date.parse(options.facts.endsAt),Date.now()+LIMITS.publicationMs);
  return boundedTask(signal=>publishOriginal({...options,signal}),{deadline,maxMs:LIMITS.publicationMs,signal:options.signal});
}
async function publishOriginal({facts,connection,phaseWitness,independentWitness,store,signal}={}){
  assertExecutionFacts(facts);guard(connection?.fullWireResponses===true&&typeof connection.request==='function'&&typeof phaseWitness==='function'&&typeof independentWitness==='function','actual-owner-connections-and-witnesses-required');
  const requestId=facts.requestId,deadline=Math.min(Date.parse(facts.endsAt),Date.now()+LIMITS.publicationMs);let phase='preflight',lastSnapshot,closure;
  // The fixed store belongs to this original publication segment. EEXIST never
  // unlocks or changes request identity; lost ACK must reconcile the original.
  await store.write('original-publication.lock.safe.json',{schema:'riffoid-ir-original-publication-lock/v1',requestId,accountId:ACCOUNT,worker:WORKER,createdAt:new Date().toISOString(),authorityEvidenceSha256:facts.authority.evidenceSha256,finalMain:facts.finalMain,noRetry:true,noAutomaticUnlock:true});
  async function gate(name,extra={}){
    guard(Date.now()<deadline&&!signal?.aborted,'publication-deadline-expired');
    const r=await boundedTask(s=>phaseWitness({phase:name,requestId,accountId:ACCOUNT,worker:WORKER,actualMainSha:facts.finalMain.sha,closureCanonicalSha256:hashJSON(facts.gatewayClosure),authorityEvidenceSha256:facts.authority.evidenceSha256,...extra,signal:s}),{deadline,maxMs:LIMITS.phaseWitnessMs,signal});
    guard(r?.schema==='riffoid-ir.live-ir-phase-witness/v1'&&r.requestId===requestId&&r.phase===name&&r.scope==='new-ir-publication-segment'&&r.accountId===ACCOUNT,'actual-ir-phase-witness');
    const at=Date.parse(r.observedAt);guard(Number.isFinite(at)&&at<=Date.now()+2000&&Date.now()-at<=30000,'phase-witness-freshness');
    guard(r.actualMainSha===facts.finalMain.sha&&r.closureCanonicalSha256===hashJSON(facts.gatewayClosure)&&r.authorityEvidenceSha256===facts.authority.evidenceSha256,'phase-main-closure-authority-binding');
    assertSameContinuousHold(facts.newIrMaintenance,r.maintenanceState);
    guard(r.productLogicalReleaseVerified===true&&r.processLeaseReleaseVerified===true&&r.physicalBoundaryVerified===true&&r.unknownRequests===false,'fresh-ir-release-boundary-required');
    guard(/^[a-f0-9]{64}$/.test(r.logicalReleaseEvidenceSha256??'')&&/^[a-f0-9]{64}$/.test(r.physicalBoundaryEvidenceSha256??''),'actual-release-evidence-binding');
    await store.write(name+'-phase-witness.safe.json',{schema:r.schema,requestId,phase:name,observedAt:r.observedAt,contentCanonicalSha256:hashJSON(r),maintenanceHoldSha256:hashJSON(r.maintenanceState.hold),physicalAndLogicalEvidenceSeparate:true});return r;
  }
  async function independent(name,snapshot,acknowledgedAt){
    const expected=hashJSON(preservationProjection(snapshot));
    const r=await boundedTask(s=>independentWitness({phase:name,requestId,accountId:ACCOUNT,worker:WORKER,afterOriginalAck:acknowledgedAt,expectedProjectionCanonicalSha256:expected,signal:s}),{deadline,maxMs:LIMITS.snapshotMs,signal});
    guard(r?.schema==='riffoid-ir.independent-full-readback/v1'&&r.requestId===requestId&&r.phase===name&&r.accountId===ACCOUNT&&r.worker===WORKER&&r.onlyGet===true&&r.complete===true&&r.projectionCanonicalSha256===expected,'independent-complete-preservation-required');
    guard(Date.parse(r.startedAt)>=Date.parse(acknowledgedAt)&&Date.parse(r.endedAt)>=Date.parse(r.startedAt)&&Date.parse(r.endedAt)<=Date.now()+2000,'independent-after-original-ack');
    guard(/^[a-f0-9]{64}$/.test(r.captureSha256??''),'independent-full-private-capture-binding');
    await store.write(name+'-independent.safe.json',{schema:r.schema,requestId,phase:name,accountId:ACCOUNT,worker:WORKER,onlyGet:true,complete:true,startedAt:r.startedAt,endedAt:r.endedAt,projectionCanonicalSha256:expected,captureSha256:r.captureSha256,receiptCanonicalSha256:hashJSON(r),rawBodiesNotIncluded:true});
  }
  const snapshot=async name=>(await collectBaseline({connection,store,deadline,signal,scope:name})).snapshot;
  const load=()=>boundedTask(s=>loadFinalClosure(facts,{signal:s,deadline:Math.min(deadline,Date.now()+60000)}),{deadline,maxMs:60000,signal});
  try{
    closure=await load();await gate('before-baseline');
    const before=await snapshot('before');lastSnapshot=before;
    const origin=facts.publicOrigin,configured=before.controls.settings.bindings.find(x=>x.name==='APP_ORIGIN')?.text;
    guard(typeof origin==='string'&&origin===configured&&new URL(origin).protocol==='https:'&&new URL(origin).origin===origin,'fresh-original-public-origin');
    const frameClosed=!before.controls.settings.bindings.some(x=>x.name==='PROJECT_VIEW_BROWSER_POLICY_JSON');
    const tag='ir-m3-m4-'+requestId,metadata=facts.gatewayResume?null:buildGatewayMetadata(before,{tag,message:facts.releaseMessage,baselineProjectionSha256:facts.baselineProjectionSha256});
    // Shape validation only; this discarded local value is never a credential
    // or request payload. Unknown fields stop before even the asset-session POST.
    if(!facts.gatewayResume)attachAssetCompletion(metadata,before,'classification-only-never-sent');
    const bodies=new Map();
    for(const appId of APP_IDS){const app=before.apps.find(x=>x.id===appId),registry=facts.registryByApp?.[appId];bodies.set(appId,imageOnlyRolloutRequest(app,registry?.receipt?.imageReference,{description:facts.releaseMessage,registryReadback:registry?.receipt,registryReadbackOwnerSeal:registry?.ownerSeal}));}
    let current,workerAck;
    if(facts.gatewayResume){phase='reconcile-original-gateway';const reconciled=await reconcileGateway(facts,closure,before);workerAck=reconciled.originalAck;current=before;await store.write('worker-source-identity-delta.safe.json',reconciled.delta);await store.write('gateway-resumed.safe.json',{requestId,originalAckSha256:workerAck.ack.sha256,putReplayed:false,assetsUploaded:false});}
    else {
    await gate('before-assets');phase='asset-session';
    const sessionAck=await originalWrite({connection,store,key:'asset-session',method:'POST',path:BASE+'/assets-upload-session',body:Buffer.from(JSON.stringify({manifest:closure.manifest})),contentType:'application/json',requestId,deadline,signal});
    const session=sessionAck.result;validateBuckets(session,closure.manifest);let completion=session.buckets.length?null:session.jwt;
    for(const [index,bucket]of session.buckets.entries()){
      phase='asset-upload-'+index;const form=new FormData();for(const address of bucket){const bytes=closure.assetBytes.get(address),path=closure.assets.find(x=>closure.manifest[x.path].hash===address)?.path;guard(Buffer.isBuffer(bytes)&&path,'server-requested-frozen-asset');const mime={'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};form.set(address,new Blob([bytes.toString('base64')],{type:mime[extname(path)]??'application/octet-stream'}),address);}
      const encoded=new Request('https://offline.invalid/',{method:'POST',body:form}),body=Buffer.from(await encoded.arrayBuffer());guard(body.length<=150*1024*1024,'asset-upload-body-bound');await gate('before-upload-'+index);
      const ack=await originalWrite({connection,store,key:phase,method:'POST',path:ACCOUNT_BASE+'/workers/assets/upload?base64=true',body,contentType:encoded.headers.get('content-type'),credentialKind:'asset',assetSession:{jwt:session.jwt},requestId,deadline,signal});if(ack.result?.jwt)completion=ack.result.jwt;
    }
    guard(typeof completion==='string'&&completion.length<16384,'asset-completion-required');
    phase='immediate-preput';const immediate=await snapshot('immediate');same(preservationProjection(immediate),preservationProjection(before),'full-baseline-drift-during-assets');
    closure=await load();const frozen=await freezeMultipart(attachAssetCompletion(metadata,before,completion),closure.module);
    await store.write('worker-multipart-binding.safe.json',{requestId,bodySha256:sha(frozen.body),bodyBytes:frozen.body.length,contentType:frozen.contentType,metadataWithoutCompletionCanonicalSha256:hashJSON(metadata),moduleSha256:sha(closure.module),completionSha256:sha(Buffer.from(completion)),credentialsAndMultipartBodyNotRetained:true});
    await gate('before-worker-put',{bodySha256:sha(frozen.body)});phase='worker-put';
    workerAck=await originalWrite({connection,store,key:'worker-put',method:'PUT',path:PUT,body:frozen.body,contentType:frozen.contentType,requestId,deadline,signal});
    phase='worker-readback';current=await snapshot('after-gateway');const sourceDelta=assertGatewayReadback(before,current,{expectedMetadata:metadata,expectedModule:{mainModule:'index.js',bytes:closure.module.length,sha256:sha(closure.module)},originalAck:workerAck,requestId,expectedMultipartSha256:sha(frozen.body)});await store.write('worker-source-identity-delta.safe.json',sourceDelta);
    }
    await publicReadback({connection,closure,origin,store,key:'gateway',deadline,signal,frameClosed});await gate('after-gateway',{originalAckSha256:workerAck.ack.sha256});await independent('after-gateway',current,workerAck.acknowledgedAt);lastSnapshot=current;
    for(const appId of APP_IDS){
      const short=appId===APP_IDS[0]?'project-tools':'trusted-pi';phase='pre-rollout-'+short;
      const immediateApp=await snapshot('before-'+short);same(preservationProjection(immediateApp),preservationProjection(current),'state-drift-before-original-app-rollout');
      await load();await gate('before-rollout-'+short);const body=bodies.get(appId),image=body.target_configuration.image;
      const ack=await originalWrite({connection,store,key:'rollout-'+short,method:'POST',path:ACCOUNT_BASE+'/containers/applications/'+appId+'/rollouts',body:Buffer.from(JSON.stringify(body)),contentType:'application/json',requestId,deadline,signal});
      guard(isId(ack.result?.id),'known-rollout-ack-id-required');phase='readback-'+short;
      const rolloutPath=ACCOUNT_BASE+'/containers/applications/'+appId+'/rollouts/'+ack.result.id;
      const raw=await boundedTask(async s=>fullResponse(await connection.request({method:'GET',path:rolloutPath,signal:s}),{signal:s}),{deadline,maxMs:LIMITS.requestMs,signal});const rollout=apiEnvelope(raw).result;
      guard(rollout?.id===ack.result.id&&rollout.target_configuration?.image===image,'original-rollout-full-get-binding');await store.write(short+'-original-rollout.private.bin',raw.body);
      const after=await snapshot('after-'+short),w=await gate('after-rollout-'+short,{rolloutId:ack.result.id,originalAckSha256:ack.ack.sha256,rolloutBodySha256:raw.sha256});
      guard(w.rolloutTerminalVerified===true&&w.rolloutId===ack.result.id,'original-rollout-terminal-witness-required');
      assertImageOnlyAppReadback(current.apps.find(x=>x.id===appId),after.apps.find(x=>x.id===appId),image,{explainedLifecycleChanges:w.explainedLifecycleChanges??{}});
      for(const app of current.apps)if(app.id!==appId)same(after.apps.find(x=>x.id===app.id),app,'untargeted-app-drift');
      same(after.controls,current.controls,'gateway-controls-drift-during-app-rollout');same(after.source,current.source,'gateway-source-drift-during-app-rollout');same(after.version,current.version,'gateway-runtime-drift-during-app-rollout');assertWorkerHistory(current,after);assertAppVersionDelta(current,after,appId,image);
      await independent('after-'+short,after,ack.acknowledgedAt);current=after;lastSnapshot=current;
    }
    await publicReadback({connection,closure,origin,store,key:'final',deadline,signal,frameClosed});await gate('final-preservation');
    const result={schema:'riffoid-ir-original-publication-result/v1',requestId,status:'gateway-and-two-original-apps-full-readback-passed',actualMain:facts.finalMain.sha,source:current.source,finalProjectionCanonicalSha256:hashJSON(preservationProjection(current)),authenticatedUserAcceptance:false,maintenanceEndPerformed:false,providerModelOrToolExecutionPerformed:false};await store.write('complete.safe.json',result);return result;
  }catch(e){await store.write('publication-stopped.safe.json',{schema:'riffoid-ir-original-publication-stopped/v1',requestId,phase,code:safeCode(e),outcome:'stop-retain-original-identity',lastCompleteSnapshotProjectionSha256:lastSnapshot?hashJSON(preservationProjection(lastSnapshot)):null,noRetry:true,noRollback:true,noAutomaticUnlock:true,actualUserAcceptance:false});throw e;}
}
