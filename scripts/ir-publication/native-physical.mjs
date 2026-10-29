/** Fresh fixed native GETs only. Keeps VM/container/process/lease semantics raw.
 * No release conclusion or application/instance stop operation exists here.
 */
import {need,hashJSON,REQUEST,ACCOUNT,WORKER,current,Stop} from './local-guards.mjs';
export const ORIGINAL_APPS=Object.freeze(['a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650','a03628c4-f032-461f-a65b-612ccac11a06']);
export function getOnlyConnection(native){return Object.freeze({fullWireResponses:true,close:()=>native.close(),request:input=>{need(input?.method==='GET'&&input.body===undefined&&!input.assetSession&&(!input.credentialKind||input.credentialKind==='oauth'),'bootstrap-and-witness-get-only');return native.request(input);}});}
const next=x=>x?.next_page_token||x?.next||x?.cursor||x?.cursors?.after||x?.has_more;
function completeNonpagedVersions(info,rows){
  need(info==null||typeof info==='object'&&!Array.isArray(info),'physical-versions-result-info');
  need(!next(info),'physical-versions-unexpected-continuation');
  if(info?.total_pages!==undefined)need(Number.isSafeInteger(info.total_pages)&&info.total_pages>=0&&info.total_pages<=1,'physical-versions-unexpected-page-count');
  if(info?.page!==undefined)need(info.page===1,'physical-versions-unexpected-page');
  for(const key of ['total_count','count'])if(info?.[key]!==undefined)need(Number.isSafeInteger(info[key])&&info[key]===rows.length,'physical-versions-incomplete-count');
}
function noPhysicalCredentialValues(v){if(Array.isArray(v)){for(const row of v)noPhysicalCredentialValues(row);}else if(v&&typeof v==='object'){for(const [key,value]of Object.entries(v)){if(key==='environment_variables'){need(value===null||Array.isArray(value),'physical-environment-shape');for(const row of value??[])need(row?.value===undefined||row.value===null||row.value==='','physical-environment-value-denied');}noPhysicalCredentialValues(value);}}}
export async function collectNativePhysical({connection,physicalConnection,originalRollout=null,api,store,scope,deadline,signal}={}){
  need(physicalConnection?.fullWireResponses===true,'actual-physical-get-supplement-required');
  const startedAt=new Date().toISOString(),root='/accounts/'+ACCOUNT+'/containers/applications',captures=[];let serial=0,total=0;
  const get=async(path,label,wire=connection)=>{current(signal,deadline);const raw=await api.boundedTask(async child=>api.fullResponse(await wire.request({method:'GET',path,signal:child}),{signal:child,captureRejected:true}),{deadline,maxMs:20000,signal});total+=raw.body.length;need(total<=64*1024*1024,'physical-complete-body-total-limit');
    if(raw.status<200||raw.status>=300){await store.write(scope+'-native-rejected.safe.json',{status:raw.status,bytes:raw.body.length,sha256:raw.sha256,retry:false});throw new Stop('native-physical-get-rejected');}
    const envelope=api.apiEnvelope(raw);if(wire===physicalConnection)noPhysicalCredentialValues(envelope.result);const reference=await store.write(scope+'-'+String(++serial).padStart(3,'0')+'-'+label+'.private.bin',raw.body);captures.push({label,path,observedAt:raw.observedAt,reference});return {result:envelope.result,info:envelope.result_info,envelope,reference,observedAt:raw.observedAt};};
  const freshRollout=originalRollout?get(root+'/'+originalRollout.appId+'/rollouts/'+originalRollout.rolloutId,'fresh-original-rollout',physicalConnection):null;freshRollout?.catch(()=>{});
  const list=async(path,label,legacy=false)=>{const rows=[],pageObjects=[],pages=[],seen=new Set();let token;for(let i=0;i<1000;i++){
    const r=await get(path+'?'+new URLSearchParams({per_page:'100',...(token?{page_token:token}:{})}),label+'-'+i);need(r.info&&(!Object.hasOwn(r.info,'per_page')||r.info.per_page===100)&&(!Object.hasOwn(r.info,'page_token')||(r.info.page_token??'')===(token??''))&&!r.info.next&&!r.info.cursor&&!r.info.cursors?.after&&!r.info.has_more,'physical-token-pagination');let items=r.result;
    if(legacy){need(items&&typeof items==='object'&&!Array.isArray(items)&&Object.keys(items).length===1&&Object.hasOwn(items,'instances'),'unclassified-physical-legacy-result');pageObjects.push(items);items=items.instances;}
    need(Array.isArray(items),'physical-array-result');rows.push(...items);need(rows.length<=100000,'physical-item-limit');pages.push(r.info);const t=r.info.next_page_token;need(t===null||t===undefined||typeof t==='string'&&t.length<=16384,'physical-next-token-type');
    if(!t){if(r.info.total_count!==undefined)need(r.info.total_count===rows.length,'physical-total-incomplete');return legacy?{instances:rows,pageObjects,pages}:{items:rows,pages};}
    need(items.length>0&&!seen.has(t)&&t!==token,'physical-token-repeat');seen.add(t);token=t;
  }throw new Stop('physical-page-limit');};
  const physicalSupplements=Promise.all(ORIGINAL_APPS.map(async(id,index)=>{const tag=index===0?'pt':'tp',base=root+'/'+id+'/deployments';
    const [listed,dash]=await Promise.all([get(base,'physical-deployments-'+tag,physicalConnection),get('/accounts/'+ACCOUNT+'/containers/dash/applications/'+id+'/instances','physical-dash-'+tag,physicalConnection)]);
    need(Array.isArray(listed.result),'physical-deployments-array');completeNonpagedVersions(listed.info,listed.result);const rows=listed.result,ids=rows.map(x=>x?.id);need(new Set(ids).size===ids.length&&rows.every(x=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x?.id??'')&&x.app_id===id&&x.account_id===ACCOUNT),'physical-deployments-original-identity');
    need(dash.result&&typeof dash.result==='object'&&!Array.isArray(dash.result)&&Object.keys(dash.result).every(k=>['instances','durable_objects'].includes(k))&&Array.isArray(dash.result.instances)&&Array.isArray(dash.result.durable_objects),'physical-dash-full-result-shape');completeNonpagedVersions(dash.info,dash.result.instances);
    const details={},detailReferences={};let at=0;await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{for(;;){const index=at++;if(index>=ids.length)return;const deployment=ids[index],detail=await get(base+'/'+deployment,'physical-detail-'+tag+'-'+deployment,physicalConnection);need(detail.result?.id===deployment&&detail.result.app_id===id&&detail.result.account_id===ACCOUNT,'physical-deployment-detail-identity');completeNonpagedVersions(detail.info,[detail.result]);details[deployment]=detail.result;detailReferences[deployment]=detail.reference;}}));
    return [id,{schema:'riffoid-ir.actual-native-physical-supplement/v1',complete:true,unfiltered:true,deployments:{items:rows,details,complete:true,listReference:listed.reference,detailReferences,resultInfo:listed.info??null},dash:dash.result,dashReference:dash.reference,dashResultInfo:dash.info??null,vmAndContainerStatesKeptSeparate:true}];
  }));physicalSupplements.catch(()=>{});
  const apps=await list(root,'applications');need(new Set(apps.items.map(x=>x?.id)).size===apps.items.length&&ORIGINAL_APPS.every(id=>apps.items.some(x=>x.id===id)),'both-original-apps-completely-listed');
  const byApp={};
  // Two original families in parallel; each family has all legacy/v2 pages.
  await Promise.all(ORIGINAL_APPS.map(async id=>{const [application,versions,legacy,v2]=await Promise.all([get(root+'/'+id,'app-'+id),get(root+'/'+id+'/versions','versions-'+id),list(root+'/'+id+'/instances','legacy-'+id,true),list(root+'/'+id+'/instances-v2','v2-'+id)]);need(application.result?.id===id&&Array.isArray(versions.result),'physical-original-app-and-version-family');completeNonpagedVersions(versions.info,versions.result);byApp[id]={application:application.result,versions:versions.result,legacy,v2};}));
  for(const [id,supplement]of await physicalSupplements)byApp[id].physicalSupplement=supplement;
  if(originalRollout){const actual=await freshRollout;need(actual.result?.id===originalRollout.rolloutId&&hashJSON(actual.result.target_configuration)===hashJSON(originalRollout.targetConfiguration),'fresh-original-rollout-id-and-target');completeNonpagedVersions(actual.info,[actual.result]);byApp[originalRollout.appId].physicalSupplement.freshOriginalRollout={appId:originalRollout.appId,rolloutId:originalRollout.rolloutId,body:actual.envelope,reference:actual.reference,observedAt:actual.observedAt,originalAckSha256:originalRollout.originalAckSha256,originalIntentSha256:originalRollout.originalIntentSha256,initialBodySha256:originalRollout.initialBodySha256,currentApplication:{version:byApp[originalRollout.appId].application.version,configuration:byApp[originalRollout.appId].application.configuration}};}
  current(signal,deadline);const data={schema:'riffoid-ir.native-original-app-physical-readback/v1',requestId:REQUEST,accountId:ACCOUNT,worker:WORKER,startedAt,endedAt:new Date().toISOString(),onlyGet:true,complete:true,releaseInferred:false,vmContainerProcessLeaseFactsDistinct:true,byApp,captures};
  const reference=await store.write(scope+'-native-complete.private.json',data);return {data,reference};
}
