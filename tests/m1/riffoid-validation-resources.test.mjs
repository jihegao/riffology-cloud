import test from 'node:test';
import assert from 'node:assert/strict';
import {listMetadata,collectPipelineGuard,containerSnapshot,containerConfigurationSHA256,collectContainerAssociations,assetPreservationEvidence} from '../../scripts/m1/riffoid-validation-resources.mjs';
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
  const t=cloudflareTransport({mode:'read-only',authorizedFetch:fetch}),r=await t.request({path:`/accounts/${account}/workers/scripts/${worker}`});assert.equal(r.mainModule,'index.js');assert.deepEqual([...r.bytes],[0,255]);assert.equal(options.maxRetries,0);assert.equal(options.fetchOptions.redirect,'error');assert.equal(calls,1);
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
  const artifact={metadata:{keep_assets:true,bindings:[{type:'assets',name:'ASSETS'}]}},runtime={assets:{base_path:'/',serve_directly:true}},expected={hasAssets:true,configSHA256:hashJSON(runtime.assets)};
  const r=assetPreservationEvidence(artifact,runtime,{has_assets:true},expected);assert.equal(r.associationConfigMatches,true);assert.equal(r.coverageComplete,false);assert.equal(r.contentInventoryAudited,false);assert.equal(r.contentSHA256,null);
  runtime.assets.serve_directly=false;assert.equal(assetPreservationEvidence(artifact,runtime,{has_assets:true},expected).associationConfigMatches,false);
});

test('malformed destination script/field arrays cannot leak nested sensitive data into receipts',async()=>{
  for(const row of [{id:1,scripts:[{token:'synthetic-sensitive'}]},{id:1,output_options:{field_names:[{token:'synthetic-sensitive'}]}}]){const t={request:async({path})=>path===`/zones/${zone}`?ok({id:zone,account:{id:account}}):path.endsWith('/logpush/jobs')&&path.startsWith('/accounts/')?ok([row]):ok([])};await assert.rejects(()=>collectPipelineGuard(t,scope),e=>!String(e).includes('synthetic-sensitive'));}
});
