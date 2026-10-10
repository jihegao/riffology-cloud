import test from 'node:test';
import assert from 'node:assert/strict';
import {listMetadata,collectPipelineGuard,containerSnapshot,containerConfigurationSHA256,collectContainerAssociations,assetPreservationEvidence,assetSnapshot,assertPreservationReadback} from '../../scripts/m1/riffoid-validation-resources.mjs';
import {connectorMetadataTransport,sdkReadOnlyFetch,cloudflareTransport} from '../../scripts/m1/riffoid-validation-transport.mjs';
import {hashJSON} from '../../scripts/m1/riffoid-validation-evidence.mjs';
const account='a'.repeat(32),zone='b'.repeat(32),worker='fixture-gateway',scope={accountId:account,zoneId:zone,worker};
const raw=(d,status=200)=>({status,contentType:'application/json',bytes:Buffer.from(JSON.stringify(d))});
const ok=result=>raw({success:true,result});
function configuration(){return {image:`registry.cloudflare.com/${account}/fixture@sha256:${'c'.repeat(64)}`,vcpu:0.25,memory:'1GiB',memory_mib:1024,disk:{size_mb:4000,size:'4GB'},network:{assign_ipv4:'none',assign_ipv6:'none',mode:'public'},command:[],entrypoint:[],runtime:'runc',observability:{logs:{enabled:true}}};}
function application(){return {id:'existing-app',name:'fixture-container',account_id:account,version:3,durable_objects:{namespace_id:'d'.repeat(32)},max_instances:1,scheduling_policy:'default',configuration:configuration(),health:{ignored:'not an activity proof'}};}
test('destination numeric pagination requires all pages and rejects overlap, loops and limits',async()=>{
  const calls=[],transport={async request({path}){calls.push(path);const page=Number(new URL('https://x'+path).searchParams.get('page'));return ok(page===1?Array.from({length:50},(_,i)=>({id:i})):[]);}};
  const r=await listMetadata(transport,'/destinations',{kind:'number'});assert.equal(r.items.length,50);assert.equal(calls.length,2);assert.ok(calls[1].includes('page=2'));
  await assert.rejects(()=>listMetadata(transport,'/destinations',{kind:'number',maxPages:1}));
  await assert.rejects(()=>listMetadata({request:async()=>ok(Array.from({length:50},(_,i)=>({id:i})))},'/destinations',{kind:'number'}),/overlapping/);
  await assert.rejects(()=>listMetadata({request:async()=>raw({success:true,result:[],result_info:{total_pages:2}})},'/jobs'),/pagination/);
});
test('container cursor pagination consumes next token and rejects duplicates/repeated token',async()=>{
  const calls=[],t={request:async({path})=>{calls.push(path);return path.includes('page_token')?ok([{id:'second'}]):raw({success:true,result:[{id:'first'}],result_info:{next_page_token:'next_token'}});}};
  const r=await listMetadata(t,'/applications',{kind:'cursor'});assert.equal(r.items.length,2);assert.ok(calls[1].includes('page_token=next_token'));
  await assert.rejects(()=>listMetadata({request:async()=>raw({success:true,result:[],result_info:{next_page_token:'same'}})},'/applications',{kind:'cursor'}),/repeated cursor/);
});
test('pipeline guard reads exact owned zone and every scoped inventory; no flag setter',async()=>{
  const calls=[],t={request:async({path})=>{calls.push(path);return path===`/zones/${zone}`?ok({id:zone,account:{id:account}}):ok([]);}};
  const r=await collectPipelineGuard(t,scope);assert.equal(r.pipelineGuardPassed,true);assert.equal(calls.length,5);assert.equal(r.inventories.length,4);assert.ok(calls.some(p=>p.includes('perPage=50')));assert.equal(r.customFields.status,'NOT_APPLICABLE_NO_ZONE_LOGPUSH_JOBS');
  await assert.rejects(()=>collectPipelineGuard({request:async()=>ok({id:zone,account:{id:'e'.repeat(32)}})},scope),/ownership/);
});
test('nonempty sinks remain blocked; evidence excludes destination and filter values',async()=>{
  const t={request:async({path})=>path===`/zones/${zone}`?ok({id:zone,account:{id:account}}):path.endsWith('/logpush/jobs')&&path.startsWith('/accounts/')?ok([{id:1,enabled:true,dataset:'workers_trace_events',destination_conf:'synthetic-sensitive',filter:'synthetic-expression',output_options:{field_names:['RequestHeaders']}}]):ok([])};
  const r=await collectPipelineGuard(t,scope);assert.equal(r.pipelineGuardPassed,false);const json=JSON.stringify(r);assert.ok(!json.includes('synthetic-sensitive'));assert.ok(!json.includes('synthetic-expression'));assert.equal(r.inventories[0].rows[0].filterPresent,true);
});
test('zone jobs trigger bounded custom-field metadata; structured absence accepted but guard still blocked',async()=>{
  const make=rules=>({request:async({path})=>path===`/zones/${zone}`?ok({id:zone,account:{id:account}}):path.includes('/rulesets/')?rules:path.startsWith(`/zones/${zone}/logpush`)?ok([{id:1,enabled:false,dataset:'http_requests'}]):ok([])});
  const r=await collectPipelineGuard(make(ok({phase:'http_log_custom_fields',rules:[{id:'rule',enabled:true,action:'excluded-action',expression:'excluded-expression',action_parameters:{request_fields:[{name:'excluded-value'}]}}]})),scope);assert.equal(r.pipelineGuardPassed,false);assert.ok(!JSON.stringify(r).includes('excluded'));assert.deepEqual(r.customFields.rules[0].parameterFieldNames,['request_fields']);
  const absent=await collectPipelineGuard(make(raw({success:false,errors:[{code:10003}]},404)),scope);assert.equal(absent.customFields.status,'AUTHORITATIVE_NO_ENTRYPOINT');
  await assert.rejects(()=>collectPipelineGuard(make(raw({success:false,errors:[{code:9109}]},403)),scope));
});
test('connector bridge supports decoded metadata only and rejects G5/source/other scopes/writes',async()=>{
  let calls=0;const t=connectorMetadataTransport({...scope,execute:async()=>{calls++;return {status:200,success:true,result:[]};}});
  const r=await t.request({path:`/accounts/${account}/workers/observability/destinations?page=1&perPage=50`});assert.equal(r.mainModule,null);assert.ok(r.provenance.includes('not raw'));
  for(const path of [`/accounts/${account}/workers/scripts/${worker}/settings`,`/accounts/${account}/workers/scripts/${worker}`,`/zones/${'c'.repeat(32)}/logpush/jobs`,`/accounts/${account}/workers/scripts/${worker}/secrets`])await assert.rejects(()=>t.request({path}));
  await assert.rejects(()=>t.request({method:'PUT',path:`/accounts/${account}/workers/scripts/${worker}?bindings_inherit=strict`}));assert.equal(calls,1);
});
test('SDK bridge preserves binary bytes/header with retries disabled; decoded objects do not fake raw HTTP',async()=>{
  let options,calls=0;const fetch=sdkReadOnlyFetch({get(path,o){calls++;options=o;return {asResponse:async()=>new Response(new Uint8Array([0,255]),{headers:{'cf-entrypoint':'index.js','content-type':'application/octet-stream','set-cookie':'excluded'}})};}});
  const t=cloudflareTransport({mode:'read-only',authorizedFetch:fetch}),r=await t.request({path:`/accounts/${account}/workers/scripts/${worker}`});assert.equal(r.mainModule,'index.js');assert.deepEqual([...r.bytes],[0,255]);assert.equal(options.maxRetries,0);assert.equal(options.fetchOptions.redirect,'manual');assert.equal(calls,1);
  await assert.rejects(()=>fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker,{method:'PUT'}));
  const missing=sdkReadOnlyFetch({get(){return {result:'decoded'};}});await assert.rejects(()=>missing('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker,{method:'GET'}),/decoded connector/);
  await assert.rejects(()=>fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/'+worker+'/secrets',{method:'GET'}));
});
test('expanded raw transport accepts only reviewed paths and query keys, with dry-run zero HTTP',async()=>{
  let calls=0;const t=cloudflareTransport({authorizedFetch:async()=>{calls++;}});
  await t.request({path:`/zones/${zone}/logpush/jobs`});await t.request({path:`/accounts/${account}/containers/applications?per_page=500&page_token=next_token`});
  for(const path of [`/zones/${zone}/dns_records`,`/accounts/${account}/workers/observability/destinations?token=secret`,`/accounts/${account}/workers/scripts/../${worker}`])await assert.rejects(()=>t.request({path}));assert.equal(calls,0);
});
test('existing container configuration, export/name, account and DO namespace must all match',async()=>{
  const app=application(),snapshot=containerSnapshot(app),metadata={containers:[{class_name:'Existing',name:app.name}],bindings:[{type:'durable_object_namespace',class_name:'Existing',namespace_id:app.durable_objects.namespace_id}]};
  const artifact={metadata},runtime={containers:structuredClone(metadata.containers),exports:{Existing:{container:app.name}}},t={request:async({path})=>path.includes('/applications?')?ok([app]):ok(app)};
  const r=await collectContainerAssociations(t,account,artifact,runtime,[snapshot]);assert.equal(r.configurationMatches,true);assert.equal(r.snapshots[0].configurationSHA256,hashJSON(app.configuration));
  for(const edit of [x=>x.version++,x=>x.configuration.memory_mib++,x=>x.durable_objects.namespace_id='e'.repeat(32)]){const x=structuredClone(app);edit(x);await assert.rejects(()=>collectContainerAssociations({request:async({path})=>path.includes('/applications?')?ok([x]):ok(x)},account,artifact,runtime,[snapshot]));}
  runtime.exports.Existing.container='other';await assert.rejects(()=>collectContainerAssociations(t,account,artifact,runtime,[snapshot]));
});
test('unsupported Secret/environment or command fields reject without inspecting/logging values',()=>{
  const env=configuration();Object.defineProperty(env,'environment_variables',{enumerable:true,get(){throw Error('secret getter must not be read');}});assert.throws(()=>containerConfigurationSHA256(env),e=>!String(e).includes('secret getter'));
  const command=configuration();command.command=['synthetic-sensitive'];assert.throws(()=>containerConfigurationSHA256(command),e=>!String(e).includes('synthetic-sensitive'));
});
test('asset preservation distinguishes contract/config match from full content inventory',()=>{
  const artifact={metadata:{keep_assets:true,bindings:[{type:'assets',name:'ASSETS'}]}},runtime={assets:{html_handling:'none',not_found_handling:'none'}},expected=assetSnapshot({accountId:account,worker},artifact,runtime,{id:worker,has_assets:true});
  const r=assetPreservationEvidence(artifact,runtime,{id:worker,has_assets:true},expected,{accountId:account,worker});assert.equal(r.associationConfigMatches,true);assert.equal(r.assetContractAccepted,true);assert.equal(r.assetBytesAudited,false);assert.equal(r.assetSetIdentityVerified,false);assert.equal(r.coverageComplete,false);assert.equal(r.contentInventoryAudited,false);assert.equal(r.contentSHA256,null);
  runtime.assets.html_handling='force-trailing-slash';assert.equal(assetPreservationEvidence(artifact,runtime,{id:worker,has_assets:true},expected,{accountId:account,worker}).associationConfigMatches,false);
});

test('malformed destination script/field arrays cannot leak nested sensitive data into receipts',async()=>{
  for(const row of [{id:1,scripts:[{token:'synthetic-sensitive'}]},{id:1,output_options:{field_names:[{token:'synthetic-sensitive'}]}}]){const t={request:async({path})=>path===`/zones/${zone}`?ok({id:zone,account:{id:account}}):path.endsWith('/logpush/jobs')&&path.startsWith('/accounts/')?ok([row]):ok([])};await assert.rejects(()=>collectPipelineGuard(t,scope),e=>!String(e).includes('synthetic-sensitive'));}
});

test('namespace pagination covers the exact frozen 23 targets across pages including unrelated namespaces',async()=>{
  const {collectNamespaces}=await import('../../scripts/m1/riffoid-validation-resources.mjs');const account='a'.repeat(32),targets=Array.from({length:23},(_,i)=>({id:'target-'+i,use_sqlite:true})),foreign=Array.from({length:37},(_,i)=>({id:'other-'+i}));const pages=[[...targets.slice(0,13),...foreign],targets.slice(13)],paths=[];
  const t={request:async({path})=>{paths.push(path);const page=Number(new URL('https://test.invalid'+path).searchParams.get('page'));return {status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify({success:true,result:pages[page-1],result_info:{page,per_page:50,total_pages:2,total_count:60}}))};}};
  const r=await collectNamespaces(t,account,targets.map(t=>t.id),targets);assert.equal(r.coverageComplete,true);assert.equal(r.selected.length,23);assert.equal(paths.length,2);assert.ok(paths[1].endsWith('?page=2&per_page=50'));
  await assert.rejects(()=>collectNamespaces(t,account,targets.map(t=>t.id),targets.slice(1)),/set must equal/);
  await assert.rejects(()=>collectNamespaces(t,account,[...targets.map(t=>t.id),'missing'],targets),/complete target/);
});
test('namespace repeated/overlapping pages, missing last page and page limit fail closed',async()=>{
  const {collectNamespaces,listMetadata}=await import('../../scripts/m1/riffoid-validation-resources.mjs');const account='a'.repeat(32),path=`/accounts/${account}/workers/durable_objects/namespaces`;
  const raw=(items,info)=>({status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify({success:true,result:items,result_info:info}))});
  await assert.rejects(()=>collectNamespaces({request:async()=>raw([{id:'same'}],{total_pages:2})},account,['same'],[{id:'same'}]),/duplicate/);
  await assert.rejects(()=>collectNamespaces({request:async()=>raw([{id:'target'}],{total_count:90})},account,['target'],[{id:'target'}]));
  let n=0;await assert.rejects(()=>listMetadata({request:async()=>raw(Array.from({length:50},(_,i)=>({id:(n++)+'-'+i})),{})},path,{kind:'namespace',maxPages:2}),/page limit/);
});
test('namespace transport accepts only bounded page/per_page GET and never namespace pagination on unrelated paths',async()=>{
  const {validateControlRequest}=await import('../../scripts/m1/riffoid-validation-transport.mjs');const p='/accounts/'+'a'.repeat(32)+'/workers/durable_objects/namespaces';
  assert.doesNotThrow(()=>validateControlRequest('GET',p+'?page=2&per_page=50'));for(const query of ['?page=0','?per_page=1001','?page=1&page=2','?page_token=anything'])assert.throws(()=>validateControlRequest('GET',p+query));assert.throws(()=>validateControlRequest('GET',p+'/id?page=2'));
});


test('retention snapshot cannot migrate scope, omit config, alter bindings, or accept overriding upload controls',()=>{
  const scope={accountId:account,worker},artifact={metadata:{keep_assets:true,bindings:[{type:'assets',name:'ASSETS'}]}},runtime={assets:{html_handling:'none'}},script={id:worker,has_assets:true};
  const expected=assetSnapshot(scope,artifact,runtime,script);
  for(const edit of [e=>e.accountId='c'.repeat(32),e=>e.worker='other-worker',e=>e.standard='other-standard',e=>e.extra=true]){
    const e=structuredClone(expected);edit(e);assert.throws(()=>assetPreservationEvidence(artifact,runtime,script,e,scope));
  }
  for(const value of [undefined,null,[],false])assert.throws(()=>assetPreservationEvidence(artifact,{assets:value},script,expected,scope));
  for(const bindings of [[],[{name:'OTHER',type:'assets'}],[{name:'ASSETS',type:'assets'},{name:'EXTRA',type:'assets'}]]){
    const a=structuredClone(artifact);a.metadata.bindings=bindings;assert.throws(()=>assetPreservationEvidence(a,runtime,script,expected,scope));
  }
  assert.throws(()=>assetPreservationEvidence(artifact,runtime,{...script,id:'other-worker'},expected,scope));
  for(const assets of [undefined,{}, {jwt:'fixture'}, {config:{html_handling:'none'}}]){const a=structuredClone(artifact);a.metadata.assets=assets;assert.throws(()=>assetPreservationEvidence(a,runtime,script,expected,scope));}
  for(const keep of [false,undefined,'true']){const a=structuredClone(artifact);a.metadata.keep_assets=keep;assert.throws(()=>assetPreservationEvidence(a,runtime,script,expected,scope));}
  assert.equal(assetPreservationEvidence(artifact,runtime,script,undefined,scope).assetContractAccepted,false);
});
test('no-assets receipt requires authoritative absence and cannot fake audit or preservation flags',()=>{
  const scope={accountId:account,worker},artifact={metadata:{keep_assets:true,bindings:[]}},script={id:worker,has_assets:false};
  const expected=assetSnapshot(scope,artifact,{},script),a=assetPreservationEvidence(artifact,{},script,expected,scope),r={assets:a,coverage:{mainModule:true,metadata:true,modules:true,namedResources:true,assets:true,assetsRetentionContract:true,containers:true},preservationMatches:true,fullStateMatches:true};
  assert.doesNotThrow(()=>assertPreservationReadback(r,expected,scope));
  for(const runtime of [{assets:{}},{assets:null}])assert.throws(()=>assetPreservationEvidence(artifact,runtime,script,undefined,scope));
  for(const edit of [x=>x.assets.assetBytesAudited=true,x=>x.assets.hasAssets=true,x=>x.coverage.namedResources=false,x=>x.assets.accountId='c'.repeat(32),x=>x.assets.worker='other',x=>x.assets.assetContractAccepted=false,x=>x.fullStateMatches=false]){const x=structuredClone(r);edit(x);assert.throws(()=>assertPreservationReadback(x,expected,scope));}
});


test('unexposed config is explicit narrow contract evidence, never a fake observed configuration or audit',()=>{
  const scope={accountId:account,worker},artifact={metadata:{keep_assets:true,bindings:[{name:'ASSETS',type:'assets'}]}},script={id:worker,has_assets:true};
  const expected=assetSnapshot(scope,artifact,{},script),a=assetPreservationEvidence(artifact,{},script,expected,scope);
  assert.equal(a.assetContractAccepted,true);assert.equal(a.configEvidence,'NOT_EXPOSED_BY_VERSION_API');assert.equal(a.configSHA256,null);assert.equal(a.assetConfigReadbackVerified,false);
  const r={assets:a,coverage:{mainModule:true,metadata:true,modules:true,namedResources:true,assets:false,assetsRetentionContract:true,containers:true},preservationMatches:true,fullStateMatches:false};assert.doesNotThrow(()=>assertPreservationReadback(r,expected,scope));
  for(const edit of [x=>x.assets.assetConfigReadbackVerified=true,x=>x.assets.configEvidence='OBSERVED_ROUTING_CONFIG',x=>x.fullStateMatches=true]){const x=structuredClone(r);edit(x);assert.throws(()=>assertPreservationReadback(x,expected,scope));}
  const observed=assetSnapshot(scope,artifact,{assets:{html_handling:'none'}},script);assert.equal(assetPreservationEvidence(artifact,{},script,observed,scope).assetContractAccepted,false);assert.equal(assetPreservationEvidence(artifact,{assets:{}},script,expected,scope).assetContractAccepted,false);
  for(const c of [null,[],{jwt:'fixture'},{headers:{authorization:'fixture'}},{html_handling:'unknown'},{run_worker_first:[1]},{run_worker_first:['https://example.test']},{run_worker_first:['!/private/*']},{run_worker_first:true}])assert.throws(()=>assetSnapshot(scope,artifact,{assets:c},script));
});
