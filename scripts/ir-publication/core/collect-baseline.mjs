/** Fixed account/worker collector. No auth or network implementation. */
import {ACCOUNT,ACCOUNT_BASE,BASE,WORKER,ZONE,APP_IDS,LIMITS,isId,allowedGet} from './fixed-target.mjs';
import {boundedTask,fullResponse,apiEnvelope,guard,GuardError,sha,safeCode} from './io-boundary.mjs';
import {hashJSON,assertCompleteBaseline} from './a2/ir-publication-candidate.mjs';

const query=(path,params)=>path+'?'+new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined)).toString();
const hasNext=info=>Boolean(info?.next_page_token||info?.cursor||info?.cursors?.after||info?.next||info?.has_more);
function noUnexpectedNext(info,count){
  guard(!hasNext(info),'unexpected-single-page-continuation');
  if(info?.total_pages!==undefined)guard(info.total_pages<=1,'unexpected-single-page-count');
  if(info?.total_count!==undefined)guard(info.total_count===count,'single-page-total-incomplete');
}
function unique(rows,name){const ids=rows.map(x=>x?.id);guard(ids.every(x=>typeof x==='string'&&x.length>0)&&new Set(ids).size===ids.length,'duplicate-or-missing-id-'+name);}
function rejectSecretBindingValues(value){
  const bindings=value?.bindings??value?.resources?.bindings;
  if(Array.isArray(bindings))for(const b of bindings)if(['secret_text','secret_key'].includes(b.type))guard(!['text','value','key_base64','key_jwk'].some(k=>Object.hasOwn(b,k)),'api-secret-value-disallowed');
}
export function preservationProjection(s){return {controls:s.controls,source:s.source,apps:s.apps,appVersions:s.appVersions,workerVersions:s.workerVersions,workerVersionDetails:s.workerVersionDetails,physical:s.physical};}
/** `store` persists full private artifacts, never raw logs/stdout.
 * A Response must contain complete untruncated wire bytes. A truncated MCP text
 * item is NOT a supported transport response and cannot produce a baseline.
 */
export async function collectBaseline(options={}){
  const deadline=Math.min(options.deadline??Infinity,Date.now()+LIMITS.snapshotMs);
  return boundedTask(signal=>captureBaseline({...options,deadline,signal}),{deadline,maxMs:LIMITS.snapshotMs,signal:options.signal});
}
async function captureBaseline({connection,store,deadline,signal,scope='baseline'}={}){
  guard(connection?.fullWireResponses===true&&typeof connection.request==='function','full-wire-owner-connection-required');
  guard(store?.write&&/^[a-z][a-z0-9-]{0,50}$/.test(scope),'collector-private-store-required');
  const ends=Math.min(deadline??Infinity,Date.now()+LIMITS.snapshotMs);guard(Number.isFinite(ends)&&ends>Date.now(),'snapshot-deadline-required');
  const stopped=new AbortController(),parentSignal=signal?AbortSignal.any([signal,stopped.signal]):stopped.signal;
  const startedAt=new Date().toISOString(),appIds=[],versionIds=[],captures=[],proofs={};let bytesTotal=0,serial=0;
  async function get(path,label,{raw=false}={}){
    guard(!parentSignal.aborted,'snapshot-already-stopped');
    guard(allowedGet(path,{appIds,versionIds}),'fixed-read-allowlist');
    const key=scope+'-'+String(++serial).padStart(4,'0')+'-'+label;
    const response=await boundedTask(async childSignal=>fullResponse(await connection.request({method:'GET',path,signal:childSignal}),{signal:childSignal,maxBytes:raw?LIMITS.maxModuleBytes:LIMITS.maxJsonBytes}),{deadline:ends,maxMs:LIMITS.requestMs,signal:parentSignal});
    guard(Date.now()<ends&&!parentSignal.aborted,'snapshot-deadline-expired');bytesTotal+=response.body.length;guard(bytesTotal<=LIMITS.maxSnapshotBytes,'snapshot-body-total-limit');
    const envelope=raw?null:apiEnvelope(response);if(envelope)rejectSecretBindingValues(envelope.result);
    const artifact=await store.write(key+'.private.bin',response.body);
    const url=new URL('https://api.cloudflare.com/client/v4'+path);
    captures.push({label,method:'GET',path:url.pathname,queryNames:[...url.searchParams.keys()].sort(),status:response.status,observedAt:response.observedAt,body:artifact,resultInfoPresent:envelope?Object.hasOwn(envelope,'result_info'):null});
    return raw?response:{envelope,result:envelope.result,info:envelope.result_info??null,artifact};
  }
  function proof(name,rows,pages){guard(rows.length<=LIMITS.maxItems,'snapshot-items-limit');proofs[name]={complete:true,paginationTerminal:true,truncated:false,itemCount:rows.length,totalCount:rows.length,itemsCanonicalSha256:hashJSON(rows),pages};}
  async function single(path,name,select=x=>x){const r=await get(path,name),rows=select(r.result);guard(Array.isArray(rows),'single-result-array-'+name);noUnexpectedNext(r.info,rows.length);proof(name,rows,[{body:r.artifact,result_info:r.info}]);return rows;}
  async function scalar(path,name){const r=await get(path,name);guard(r.result&&typeof r.result==='object','scalar-result-object-'+name);guard(!hasNext(r.info),'unexpected-scalar-continuation');return r.result;}
  async function tokenList(path,name,{legacyObject=false}={}){const rows=[],pages=[],pageObjects=[],seen=new Set();let token;
    for(let n=0;n<LIMITS.maxPages;n++){
      const r=await get(query(path,{per_page:'100',page_token:token}),name+'-page-'+n);let items=r.result;
      if(legacyObject){guard(items&&typeof items==='object'&&!Array.isArray(items)&&Object.keys(items).length===1&&Object.hasOwn(items,'instances'),'unclassified-legacy-instance-result-field');pageObjects.push(items);items=items.instances;}
      guard(Array.isArray(items)&&r.info&&typeof r.info==='object','token-pagination-envelope-'+name);
      guard(!r.info.cursor&&!r.info.cursors?.after&&!r.info.next&&!r.info.has_more,'unexpected-token-pagination-mode');
      if(Object.hasOwn(r.info,'page_token'))guard((r.info.page_token??'')===(token??''),'pagination-token-echo');
      if(Object.hasOwn(r.info,'per_page'))guard(r.info.per_page===100,'pagination-page-size');
      rows.push(...items);guard(rows.length<=LIMITS.maxItems,'snapshot-items-limit');pages.push({body:r.artifact,result_info:r.info});
      const next=r.info.next_page_token;guard(next===undefined||next===null||typeof next==='string','pagination-token-type');
      if(typeof next==='string')guard(next.length<=16384,'pagination-token-bound');
      if(!next){if(r.info.total_count!==undefined)guard(r.info.total_count===rows.length,'pagination-total-incomplete');proof(name,rows,pages);return legacyObject?{instances:rows,pageObjects}:rows;}
      guard(!seen.has(next)&&next!==token&&items.length>0,'pagination-token-repeat-or-empty');seen.add(next);token=next;
    }throw new GuardError('pagination-page-limit');
  }
  async function numbered(path,name,select,{retainObject=false}={}){const rows=[],pages=[],seen=new Set(),objects=[];let declaredTotal;
    for(let page=1;page<=LIMITS.maxPages;page++){
      const r=await get(query(path,{page:String(page),per_page:'100'}),name+'-page-'+page),items=select(r.result);guard(Array.isArray(items),'numbered-result-array-'+name);guard(!hasNext(r.info),'unexpected-numbered-pagination-mode');
      if(r.info?.page!==undefined)guard(r.info.page===page,'pagination-page-echo');
      if(r.info?.per_page!==undefined)guard(r.info.per_page===100,'pagination-page-size');
      if(r.info?.count!==undefined)guard(r.info.count===items.length,'pagination-count');
      if(r.info?.total_count!==undefined){guard(Number.isSafeInteger(r.info.total_count)&&r.info.total_count>=0,'pagination-total-type');if(declaredTotal===undefined)declaredTotal=r.info.total_count;else guard(declaredTotal===r.info.total_count,'pagination-total-drift');}
      if(r.info?.total_pages!==undefined)guard(Number.isSafeInteger(r.info.total_pages)&&r.info.total_pages>=page&&declaredTotal!==undefined&&r.info.total_pages===Math.ceil(declaredTotal/100),'pagination-total-pages');
      if(retainObject){guard(r.result&&typeof r.result==='object'&&!Array.isArray(r.result)&&Object.keys(r.result).length===1&&Object.hasOwn(r.result,'deployments'),'unclassified-worker-deployment-result-field');objects.push(r.result);}
      const fingerprint=hashJSON(items);guard(items.length===0||!seen.has(fingerprint),'pagination-repeat-page');seen.add(fingerprint);rows.push(...items);guard(rows.length<=LIMITS.maxItems,'snapshot-items-limit');pages.push({body:r.artifact,result_info:r.info,...(retainObject?{fullResultObject:r.result}:{})});
      const finish=()=>{proof(name,rows,pages);return retainObject?{...objects[0],deployments:rows}:rows;};
      if(declaredTotal!==undefined){guard(rows.length<=declaredTotal,'pagination-total-overflow');if(rows.length===declaredTotal)return finish();guard(items.length>0,'pagination-total-incomplete');}
      // Official SDK V4PagePagination also probes until an empty page when no
      // explicit total is supplied; a short page alone is never terminal proof.
      else if(items.length===0)return finish();
    }throw new GuardError('pagination-page-limit');
  }
  async function mapBounded(rows,fn){const out=new Array(rows.length);let index=0;const results=await Promise.allSettled(Array.from({length:Math.min(4,rows.length)},async()=>{try{for(;;){guard(!parentSignal.aborted,'snapshot-already-stopped');const i=index++;if(i>=rows.length)return;out[i]=await fn(rows[i],i);}}catch(e){stopped.abort();throw e;}}));const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;return out;}
  try{
    const controls={};
    controls.settings=await scalar(BASE+'/settings','settings');
    controls.deployments=await numbered(BASE+'/deployments','worker-deployments',x=>x?.deployments,{retainObject:true});const deployments=controls.deployments.deployments;
    guard(Array.isArray(deployments)&&deployments.length>0,'active-deployment-required');
    unique(deployments,'worker-deployments');
    const active=deployments[0]?.versions;guard(active?.length===1&&active[0].percentage===100&&isId(active[0].version_id),'single-active-version-required');
    const workerVersions=await numbered(BASE+'/versions','worker-versions',x=>x?.items);unique(workerVersions,'worker-versions');
    for(const row of workerVersions){guard(isId(row.id),'worker-version-id');versionIds.push(row.id);}guard(versionIds.includes(active[0].version_id),'active-version-list-link');
    // Immutable history is the complete metadata list. Full resources are read
    // only for the serving version; historical resources are not re-fetched at
    // every phase. A new PUT ACK must link to this same fully read active ID.
    const activeId=active[0].version_id,workerVersionDetails={[activeId]:await scalar(BASE+'/versions/'+activeId,'worker-version-'+activeId)};
    guard(workerVersionDetails[activeId].id===activeId,'worker-version-detail-id-link');
    const version=workerVersionDetails[active[0].version_id];
    controls.namespaces=await numbered(ACCOUNT_BASE+'/workers/durable_objects/namespaces','namespaces',x=>x);unique(controls.namespaces,'namespaces');
    controls.routes=await single('/zones/'+ZONE+'/workers/routes','routes');
    controls.domains=await single(query(ACCOUNT_BASE+'/workers/domains',{service:WORKER}),'domains');
    controls.schedules=await single(BASE+'/schedules','schedules',x=>Array.isArray(x)?x:x?.schedules);
    controls.registries=await single(ACCOUNT_BASE+'/containers/registries','registries');
    controls.subdomain=await scalar(BASE+'/subdomain','subdomain');
    const listedApps=await tokenList(ACCOUNT_BASE+'/containers/applications','apps-list');unique(listedApps,'apps-list');
    for(const app of listedApps){guard(isId(app.id),'application-id');appIds.push(app.id);}guard(APP_IDS.every(id=>appIds.includes(id)),'both-original-apps-required');
    const apps=await mapBounded(appIds,id=>scalar(ACCOUNT_BASE+'/containers/applications/'+id,'application-'+id));
    apps.forEach((app,i)=>guard(app.id===appIds[i],'application-detail-id-link'));
    proof('apps',apps,proofs['apps-list'].pages);
    const appVersions=Object.fromEntries(await mapBounded(appIds,async id=>[id,await single(ACCOUNT_BASE+'/containers/applications/'+id+'/versions','app-versions-'+id)]));
    for(const id of appIds){proofs['appVersions:'+id]=proofs['app-versions-'+id];delete proofs['app-versions-'+id];}
    const physical={scope:'Only both original IR application IDs; state omitted means all states.',vmContainerProcessAndLeaseFactsDistinct:true,releaseInferred:false,byApp:{}};
    for(const id of APP_IDS){physical.byApp[id]={legacy:await tokenList(ACCOUNT_BASE+'/containers/applications/'+id+'/instances','instances-'+id,{legacyObject:true}),v2:await tokenList(ACCOUNT_BASE+'/containers/applications/'+id+'/instances-v2','instances-v2-'+id)};}
    const raw=await get(BASE+'/content/v2','serving-module',{raw:true});
    let form;try{form=await new Response(raw.body,{headers:{'content-type':raw.contentType}}).formData();}catch{throw new GuardError('serving-module-multipart');}
    const entries=[...form.entries()],names=entries.map(([name])=>name).sort();
    guard(JSON.stringify(names)==='["index.js"]'||JSON.stringify(names)==='["gaoagent-model.mjs","index.js"]','serving-classified-module-set');
    const modules=[];
    for(const [name,value]of entries){guard(value instanceof Blob,'serving-module-blob');const bytes=Buffer.from(await value.arrayBuffer());guard(bytes.length<=LIMITS.maxModuleBytes,'serving-module-bound');modules.push({name,bytes:bytes.length,sha256:sha(bytes)});}
    modules.sort((a,b)=>a.name.localeCompare(b.name));
    const main=modules.find(x=>x.name==='index.js'),source={mainModule:'index.js',bytes:main.bytes,sha256:main.sha256,...(modules.length>1?{modules}:{})};
    // This is a closing active anchor, explicitly not a complete history page.
    // It binds the fully read source to the same still-serving 100% version.
    const anchor=await get(query(BASE+'/deployments',{page:'1',per_page:'1'}),'serving-anchor'),anchorRows=anchor.result?.deployments;
    guard(anchor.result&&Object.keys(anchor.result).length===1&&Array.isArray(anchorRows)&&anchorRows.length===1&&hashJSON(anchorRows[0])===hashJSON(deployments[0]),'source-active-deployment-anchor-drift');
    guard(anchor.info?.page===1&&anchor.info?.per_page===1&&anchor.info?.count===1&&anchor.info?.total_count===deployments.length,'source-active-history-total-drift');
    const activeServingAnchor={deploymentId:anchorRows[0].id,versionId:version.id,percentage:100,sourceObservedAt:raw.observedAt,anchorBodySha256:anchor.artifact.sha256};
    const snapshot={schema:'riffoid-ir.complete-baseline/private-v1',scope,startedAt,endedAt:new Date().toISOString(),accountId:ACCOUNT,worker:WORKER,completeBodiesCaptured:true,rawApiResultInfoPreserved:true,controls,version,workerVersions,workerVersionDetails,apps,appVersions,physical,source,activeServingAnchor,collectionProofs:proofs,captures};
    const counts=assertCompleteBaseline(snapshot);guard(Date.now()<ends&&!parentSignal.aborted,'snapshot-deadline-expired');
    const privateArtifact=await store.write(scope+'-complete.private.json',snapshot);
    guard(Date.now()<ends&&!parentSignal.aborted,'snapshot-deadline-expired');
    const safe={schema:'riffoid-ir.complete-baseline-safe/v1',scope,startedAt,endedAt:snapshot.endedAt,accountId:ACCOUNT,worker:WORKER,complete:true,onlyGet:true,cloudWrites:0,counts:{...counts,workerVersionList:workerVersions.length,workerDeploymentList:deployments.length,workerVersionDetails:Object.keys(workerVersionDetails).length,physicalOriginalAppFamilies:Object.keys(physical.byApp).length},historicalWorkerMetadataComplete:true,historicalWorkerResourcesRefetched:false,source,bodyBytes:bytesTotal,privateArtifact,projectionCanonicalSha256:hashJSON(preservationProjection(snapshot)),physicalReleaseInferred:false,physicalStateFieldsNeverConflated:true,privateBodiesOmitted:true,apiCalls:captures.map(({body,...x})=>({...x,bodyBytes:body.bytes,bodySha256:body.sha256}))};
    await store.write(scope+'-complete.safe.json',safe);return {snapshot,safe};
  }catch(e){stopped.abort();await store.write(scope+'-stopped.safe.json',{schema:'riffoid-ir-incomplete-baseline/v1',scope,startedAt,endedAt:new Date().toISOString(),complete:false,code:safeCode(e),onlyGet:true,cloudWrites:0,bodyBytes:bytesTotal,capturedResponses:captures.length,noRetry:true,privateBodiesNotPublished:true});throw e;}
}
