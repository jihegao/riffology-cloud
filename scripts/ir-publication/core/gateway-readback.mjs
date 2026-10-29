/** Live fork: only the original known PUT may explain the source etag delta.
 * Opaque etag alone is insufficient: serving bytes, version and active deployment
 * must all bind to the same original response and frozen request body.
 */
import {ACCOUNT,WORKER,PUT,isId} from './fixed-target.mjs';
import {guard} from './io-boundary.mjs';
import {hashJSON,assertCompleteBaseline} from './a2/ir-publication-candidate.mjs';
const same=(a,b,code)=>guard(hashJSON(a)===hashJSON(b),code);
const omit=(x,keys)=>Object.fromEntries(Object.entries(x).filter(([k])=>!keys.includes(k)));
const HEX=/^[a-f0-9]{64}$/;
export function normalizeAckVersion(value){
  if(typeof value==='string'&&/^[a-f0-9]{32}$/.test(value))value=[value.slice(0,8),value.slice(8,12),value.slice(12,16),value.slice(16,20),value.slice(20)].join('-');
  guard(isId(value),'known-put-ack-version-required');return value;
}
export function assertWorkerHistory(before,after,{newActive=false}={}){
  const oldIds=new Set(before.workerVersions.map(x=>x.id));
  for(const row of before.workerVersions)same(after.workerVersions.find(x=>x.id===row.id),row,'old-worker-version-list-drift');
  const added=after.workerVersions.filter(x=>!oldIds.has(x.id));guard(added.length===(newActive?1:0)&&(!newActive||added[0].id===after.version.id),'unexpected-worker-version-delta');
  for(const [id,detail]of Object.entries(before.workerVersionDetails))if(Object.hasOwn(after.workerVersionDetails,id))same(after.workerVersionDetails[id],detail,'serving-worker-resources-drift');
  const old=before.controls.deployments.deployments,next=after.controls.deployments.deployments;
  for(const row of old)same(next.find(x=>x.id===row.id),row,'old-worker-deployment-metadata-drift');
  same(omit(after.controls.deployments,['deployments']),omit(before.controls.deployments,['deployments']),'worker-deployment-object-drift');
  const deployed=next.filter(x=>!old.some(v=>v.id===x.id));guard(deployed.length===(newActive?1:0)&&(!newActive||deployed[0].id===next[0].id),'unexpected-worker-deployment-delta');
}
export function assertGatewayReadback(before,after,{expectedMetadata,expectedModule,originalAck,requestId,expectedMultipartSha256}={}){
  assertCompleteBaseline(before);assertCompleteBaseline(after);
  const o=originalAck,request=o?.originalRequest;
  guard(request?.requestId===requestId&&request.method==='PUT'&&request.path===PUT&&request.bodySha256===expectedMultipartSha256&&HEX.test(expectedMultipartSha256??''),'original-put-intent-binding');
  guard(o?.responseStatus===200&&HEX.test(o?.ack?.sha256??'')&&HEX.test(o?.intent?.sha256??'')&&HEX.test(o?.responseSha256??'')&&Date.parse(after.startedAt)>=Date.parse(o.acknowledgedAt),'known-original-put-ack-binding');
  const versionId=normalizeAckVersion(o.result?.deployment_id),etag=o.result?.etag;
  guard(typeof etag==='string'&&etag.length>0&&etag.length<=256&&!/[\r\n\u0000]/.test(etag),'known-put-ack-etag-required');
  guard(after.accountId===ACCOUNT&&after.worker===WORKER&&after.version.id===versionId&&versionId!==before.version.id,'known-ack-new-serving-version');
  const deployment=after.controls.deployments.deployments[0],active=deployment?.versions;
  guard(isId(deployment?.id)&&active?.length===1&&active[0].version_id===versionId&&active[0].percentage===100,'known-ack-current-deployment-link');
  same(after.source,expectedModule,'actual-serving-frozen-module');
  const expected=structuredClone(before.version.resources);guard(expected.script&&typeof expected.script.etag==='string','classified-old-script-etag-required');
  if(before.source.sha256!==expectedModule.sha256)guard(etag!==expected.script.etag,'source-change-requires-new-ack-etag');
  expected.script.etag=etag;
  same(after.version.resources,expected,'post-all-resources-only-known-source-etag-delta');
  same(omit(after.controls.settings,['annotations']),omit(before.controls.settings,['annotations']),'post-all-settings-and-bindings');
  same(after.controls.settings.annotations,expectedMetadata.annotations,'post-release-annotations');same(after.version.annotations,expectedMetadata.annotations,'post-version-annotations');
  for(const key of Object.keys(before.controls).filter(k=>!['settings','deployments'].includes(k)))same(after.controls[key],before.controls[key],'post-control-'+key);
  same(after.apps,before.apps,'gateway-preserves-all-apps');same(after.appVersions,before.appVersions,'gateway-preserves-all-app-versions');
  assertWorkerHistory(before,after,{newActive:true});
  return {schema:'riffoid-ir-known-put-source-identity-delta/v1',requestId,originalIntentSha256:o.intent.sha256,originalAckArtifactSha256:o.ack.sha256,originalResponseSha256:o.responseSha256,requestBodySha256:expectedMultipartSha256,versionId,deploymentId:deployment.id,percentage:100,expectedEtag:etag,fullRawModule:expectedModule,onlyResourcesDelta:'script.etag'};
}
