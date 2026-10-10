// Read-only configuration evidence. No instance/event/log/Secret reads or writes.
import assert from 'node:assert/strict';
import {hashJSON} from './riffoid-validation-evidence.mjs';
import {jsonResult} from './riffoid-validation-transport.mjs';
const id=x=>assert.match(x,/^[a-f0-9]{32}$/);
const objectKeys=(x,keys)=>assert.ok(x&&Object.keys(x).every(k=>keys.includes(k)),'unsupported configuration field; do not inspect its value');
export async function listMetadata(transport,path,{kind='complete',maxPages=20}={}){
  let token,page=1;const items=[],seenTokens=new Set(),seenItems=new Set(),receipts=[];
  for(let n=0;n<maxPages;n++){
    const query=kind==='cursor'?`?per_page=500${token?'&page_token='+encodeURIComponent(token):''}`:['number','namespace'].includes(kind)?`?page=${page}&${kind==='namespace'?'per_page':'perPage'}=50`:'';
    const d=jsonResult(await transport.request({path:path+query}));assert.ok(Array.isArray(d.result),'authoritative array required');
    for(const x of d.result){const key=x.id??x.slug;assert.ok(['string','number'].includes(typeof key),'stable metadata item identity required');assert.ok(!seenItems.has(key),'duplicate/overlapping page');seenItems.add(key);items.push(x);}
    receipts.push({path:path+query,count:d.result.length});
    const info=d.result_info??{};
    if(kind==='cursor'){
      const next=info.next_page_token;if(!next)return {items,receipts,complete:true};assert.equal(typeof next,'string');assert.ok(!seenTokens.has(next),'repeated cursor');seenTokens.add(next);token=next;
    }else if(['number','namespace'].includes(kind)){
      if(info.page!==undefined)assert.equal(info.page,page);
      if(kind==='namespace'){assert.ok(!info.next_page_token);if(info.per_page!==undefined)assert.equal(info.per_page,50);if(info.total_count!==undefined)assert.ok(Number.isSafeInteger(info.total_count)&&info.total_count>=items.length);}
      if(info.total_pages!==undefined){assert.ok(Number.isSafeInteger(info.total_pages)&&info.total_pages>=page);if(page===info.total_pages){if(kind==='namespace'&&info.total_count!==undefined)assert.equal(items.length,info.total_count);return {items,receipts,complete:true};}}
      else if(d.result.length<50){if(kind==='namespace'&&info.total_count!==undefined)assert.equal(items.length,info.total_count);return {items,receipts,complete:true};}
      page++;
    }else{assert.ok(!info.next_page_token&&(!info.total_pages||info.total_pages===1),'unexpected pagination; incomplete');return {items,receipts,complete:true};}
  }
  throw Error('metadata page limit; unknown, no retry');
}
export async function collectPipelineGuard(transport,scope){
  const {accountId,zoneId,worker}=scope;id(accountId);id(zoneId);assert.match(worker,/^[a-z0-9_-]+$/);
  const zone=jsonResult(await transport.request({path:`/zones/${zoneId}`})).result;assert.equal(zone.id,zoneId);assert.equal(zone.account?.id,accountId,'zone ownership mismatch');
  const paths=[`/accounts/${accountId}/logpush/jobs`,`/zones/${zoneId}/logpush/jobs`,`/accounts/${accountId}/workers/observability/destinations`,`/accounts/${accountId}/workers/scripts/${worker}/tails`];
  const inventories=[];
  for(const path of paths){
    const r=await listMetadata(transport,path,{kind:path.endsWith('/destinations')?'number':'complete'});
    // Keep only allowlisted metadata; URLs, destination_conf, headers, filter
    // expressions and websocket URLs never become receipts.
    const names=(a,pattern)=>{if(a===undefined)return undefined;assert.ok(Array.isArray(a)&&a.length<=1000);assert.ok(a.every(v=>typeof v==='string'&&pattern.test(v)),'invalid metadata names; no values retained');return [...a];};
    const rows=r.items.map(x=>{assert.ok(x.enabled===undefined||typeof x.enabled==='boolean');assert.ok(x.dataset===undefined||typeof x.dataset==='string'&&/^[a-z0-9_-]{1,128}$/.test(x.dataset));return {id:x.id??x.slug,dataset:x.dataset,enabled:x.enabled,scripts:names(x.scripts,/^[a-z0-9_-]{1,128}$/),fieldNames:names(x.output_options?.field_names,/^[A-Za-z][A-Za-z0-9_]{0,127}$/),filterPresent:!!x.filter};});
    inventories.push({path,pages:r.receipts,complete:r.complete,rows});
  }
  let customFields={status:'NOT_APPLICABLE_NO_ZONE_LOGPUSH_JOBS'};
  if(inventories[1].rows.length){
    const path=`/zones/${zoneId}/rulesets/phases/http_log_custom_fields/entrypoint`,raw=await transport.request({path});
    const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.bytes));
    if(raw.status===404&&d.success===false&&d.errors?.some(e=>e.code===10003))customFields={path,status:'AUTHORITATIVE_NO_ENTRYPOINT'};
    else {const r=jsonResult(raw).result;assert.equal(r.phase,'http_log_custom_fields');assert.ok(Array.isArray(r.rules));customFields={path,status:'PRESENT',rules:r.rules.map(x=>({id:x.id,enabled:x.enabled,parameterFieldNames:Object.keys(x.action_parameters??{})}))};}
  }
  const pipelineGuardPassed=inventories.every(x=>x.complete&&x.rows.length===0);
  return {scope:structuredClone(scope),observedAt:Date.now(),pipelineGuardPassed,inventories,customFields,
    evidenceSHA256:hashJSON({scope,inventories,customFields}),scopeLimit:'only these account/zone/script configuration inventories; no telemetry drain or future absence claim'};
}
export function containerConfigurationSHA256(c){
  objectKeys(c,['image','vcpu','memory','memory_mib','disk','network','command','entrypoint','runtime','observability']);
  assert.ok(typeof c.image==='string'&&/^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-zA-Z0-9_.-]+@sha256:[a-f0-9]{64}$/.test(c.image),'fixed image identity required');
  for(const k of ['vcpu','memory_mib'])assert.ok(Number.isFinite(c[k])&&c[k]>0);
  assert.ok(/^\d+(?:MiB|GiB)$/.test(c.memory));objectKeys(c.disk,['size_mb','size']);assert.ok(c.disk.size_mb>0);assert.ok(/^\d+(?:MB|GB)$/.test(c.disk.size));
  objectKeys(c.network,['assign_ipv4','assign_ipv6','mode']);for(const v of Object.values(c.network))assert.ok(typeof v==='string'&&/^[a-z_ -]{1,32}$/.test(v),'network policy enum required');
  // Empty arguments prevent reading arbitrary command text or injected secrets.
  assert.ok(Array.isArray(c.command)&&c.command.length===0);assert.ok(Array.isArray(c.entrypoint)&&c.entrypoint.length===0);assert.ok(typeof c.runtime==='string'&&/^[a-z_-]{1,32}$/.test(c.runtime));
  objectKeys(c.observability,['logs']);objectKeys(c.observability.logs,['enabled']);assert.equal(typeof c.observability.logs.enabled,'boolean');
  return hashJSON(c);
}
export function containerSnapshot(x){
  id(x.account_id);id(x.durable_objects?.namespace_id);assert.match(x.id,/^[a-zA-Z0-9_-]+$/);assert.match(x.name,/^[a-z0-9_-]+$/);
  assert.ok(Number.isSafeInteger(x.version)&&x.version>=0);assert.ok(Number.isSafeInteger(x.max_instances));assert.ok(['default','durable_object'].includes(x.scheduling_policy));
  return {id:x.id,name:x.name,account_id:x.account_id,version:x.version,durable_objects:{namespace_id:x.durable_objects.namespace_id},max_instances:x.max_instances,scheduling_policy:x.scheduling_policy,configurationSHA256:containerConfigurationSHA256(x.configuration)};
}
export async function collectContainerAssociations(transport,accountId,artifact,runtime,expected){
  id(accountId);assert.deepEqual(runtime.containers,artifact.metadata.containers,'Worker container associations differ');
  if(runtime.containers.length===0)return {associationMatches:true,configurationMatches:true,snapshots:[]};
  assert.ok(Array.isArray(expected)&&expected.length===runtime.containers.length,'frozen existing application snapshots required');
  const listed=await listMetadata(transport,`/accounts/${accountId}/containers/applications`,{kind:'cursor'}),snapshots=[];
  for(const row of runtime.containers){
    const matches=listed.items.filter(x=>x.name===row.name);assert.equal(matches.length,1,'existing application name must be unique');
    assert.equal(runtime.exports[row.class_name]?.container,row.name,'export/application association differs');
    const baseline=expected.find(x=>x.name===row.name);assert.ok(baseline);assert.equal(matches[0].id,baseline.id);
    const actual=containerSnapshot(jsonResult(await transport.request({path:`/accounts/${accountId}/containers/applications/${baseline.id}`})).result);
    assert.equal(actual.account_id,accountId);assert.deepEqual(actual,baseline,'existing application configuration or identity drift');
    const bindings=artifact.metadata.bindings.filter(b=>b.type==='durable_object_namespace'&&b.class_name===row.class_name);assert.equal(bindings.length,1);assert.equal(bindings[0].namespace_id,actual.durable_objects.namespace_id,'DO/application namespace association differs');
    snapshots.push(actual);
  }
  return {associationMatches:true,configurationMatches:true,snapshots,evidenceSHA256:hashJSON(snapshots),scopeLimit:'application identity/version and reviewed configuration; operational health, instance census and full account inventory not asserted'};
}
export function assetPreservationEvidence(artifact,runtime,inventoryScript,expected){
  const result={keepAssetsRequested:artifact.metadata.keep_assets===true,hasAssets:inventoryScript.has_assets,configSHA256:runtime.assets===undefined?null:hashJSON(runtime.assets),contentInventoryAudited:false,contentSHA256:null,explicitAssetsUploadForbidden:!Object.hasOwn(artifact.metadata,'assets'),acceptanceStandard:'PENDING_CONTRACT_STANDARD_APPROVAL'};
  if(inventoryScript.has_assets===false&&!artifact.metadata.bindings.some(b=>b.type==='assets'))return {...result,coverageComplete:true,associationConfigMatches:true};
  assert.equal(result.keepAssetsRequested,true);
  assert.equal(result.explicitAssetsUploadForbidden,true,'explicit assets upload forbidden');
  const associationConfigMatches=!!expected&&expected.hasAssets===true&&result.hasAssets===true&&result.configSHA256===expected.configSHA256;
  return {...result,associationConfigMatches,contractCandidateReady:associationConfigMatches&&result.keepAssetsRequested&&result.explicitAssetsUploadForbidden,coverageComplete:false,scopeLimit:'keep_assets retains existing assets by upload contract; matching configuration proves configuration only, not every asset byte or asset-set identity'};
}

export async function collectNamespaces(transport,accountId,targetIds,expected){
  id(accountId);assert.ok(Array.isArray(targetIds));const targets=[...new Set(targetIds)].sort();
  assert.equal(targets.length,targetIds.length,'duplicate target namespace binding');assert.ok(targets.every(v=>typeof v==='string'&&v.length>0));
  const path=`/accounts/${accountId}/workers/durable_objects/namespaces`;
  const inventory=await listMetadata(transport,path,{kind:'namespace'});
  for(const n of inventory.items)objectKeys(n,['id','class','name','script','use_sqlite']);
  const selected=inventory.items.filter(n=>targets.includes(n.id)).sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(selected.map(n=>n.id),targets,'complete target namespace set required');
  const coverageComplete=Array.isArray(expected);
  if(coverageComplete){assert.deepEqual([...expected].map(n=>n.id).sort(),targets,'frozen namespace set must equal all target bindings');assert.equal(hashJSON(selected),hashJSON([...expected].sort((a,b)=>a.id.localeCompare(b.id))),'frozen namespace metadata drift');}
  return {path,selected,pages:inventory.receipts,coverageComplete,sha256:hashJSON(selected)};
}
