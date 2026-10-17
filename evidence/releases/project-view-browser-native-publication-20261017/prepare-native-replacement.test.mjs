// Local synthetic protocol tests only. No token, fetch, API write or container.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ACCOUNT,WORKER,BASE,PUT,PINS,sha,hashJSON,loadInputs,buildMetadata,assertMetadata,assertTarget,prepare,createOfflineDummyClient,simulate,execute} from './prepare-native-replacement.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url)),requestId='8a55b99d-0747-4e35-aeb2-4f72f26043a1';
const i=await loadInputs(),metadata=buildMetadata(i.baseline,{requestId});
const jwt='offline.'+Buffer.from(JSON.stringify({wrangler_single_asset_uploads:false})).toString('base64url')+'.synthetic';
const sessionPath=BASE+'/assets-upload-session',uploadPath=`/accounts/${ACCOUNT}/workers/assets/upload?base64=true`;
const temporary=async fn=>{const directory=await mkdtemp(resolve(ROOT,'synthetic-native-'));try{return await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}};
const run=(directory,client,extra={})=>simulate({directory,requestId,metadata,baseline:i.baseline,module:i.module,manifest:i.manifest,assetBytes:i.assetBytes,client,...extra});
const noBuckets=()=>[{method:'POST',path:sessionPath,result:{jwt,buckets:[]}},{method:'PUT',path:PUT,result:{id:'synthetic-ack'}}];

test('metadata preserves every original nonsecret binding, setting, export and association',()=>{
 assertMetadata(metadata,i.baseline);assert.equal(metadata.bindings.length,95);assert.equal(i.baseline.settings.bindings.length,106);
 assert.equal(i.baseline.settings.bindings.filter(b=>['secret_text','secret_key'].includes(b.type)).length,11);
 assert.deepEqual(metadata.keep_bindings,['secret_text','secret_key']);
 assert.deepEqual(metadata.bindings,i.baseline.settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)));
 assert.deepEqual(metadata.exports,i.baseline.version.resources.script_runtime.exports);assert.equal(Object.keys(metadata.exports).length,25);
 assert.deepEqual(metadata.containers,i.baseline.version.resources.script_runtime.containers);assert.equal(metadata.containers.length,6);
 for(const key of ['compatibility_date','compatibility_flags','placement','usage_model','tags','tail_consumers','logpush','observability'])assert.deepEqual(metadata[key],i.baseline.settings[key]);
 assert.equal(metadata.bindings.some(b=>b.name==='PROJECT_VIEW_BROWSER_POLICY_JSON'),false);
 assert.equal(metadata.bindings.find(b=>b.name==='PROJECT_VIEW_POLICY_JSON').text,'{"enabled":false}');
});
test('metadata rejects adding migration, assets/JWT, binding, export or container',()=>{
 for(const mutate of [m=>{m.migrations={new_classes:['Unexpected']};},m=>{m.assets={jwt:'forbidden'};},m=>m.bindings.push({name:'NEW',type:'plain_text',text:'x'}),m=>{m.exports.Unexpected={type:'durable_object',storage:'sqlite'};},m=>m.containers.push({name:'new-app'})]){const m=structuredClone(metadata);mutate(m);assert.throws(()=>assertMetadata(m,i.baseline));}
});
test('counts alone cannot hide replacement of original records or policy/image drift',()=>{
 for(const mutate of [m=>{m.bindings[0]={...m.bindings[0],text:'tampered'};},m=>{m.keep_bindings=['secret_text'];},m=>{m.compatibility_flags=[];},m=>{const k=Object.keys(m.exports)[0];m.exports[k]={...m.exports[k],storage:'unexpected'};},m=>{m.containers[0]={name:'replaced'};},m=>{m.bindings.find(b=>b.name==='PROJECT_VIEW_POLICY_JSON').text='{"enabled":true}';}]){const m=structuredClone(metadata);mutate(m);assert.throws(()=>assertMetadata(m,i.baseline));}
});
test('frozen actual local bundle, 96 assets and complete namespace baseline are checked',()=>{
 assert.equal(i.module.length,5774614);assert.equal(sha(i.module),PINS.bundle);assert.equal(i.inventory.length,96);assert.equal(Object.keys(i.manifest).length,96);
 assert.equal(i.inventory.filter(a=>a.path.startsWith('/browser-preview-assets/')).length,68);assert.equal(i.baseline.namespaces.result.length,50);
 const incomplete=structuredClone(i.baseline);incomplete.namespaces.result_info.total_count=51;assert.throws(()=>buildMetadata(incomplete,{requestId}),/namespace-completeness/);
});
test('cross account/Worker is rejected before any dummy call or lock',async()=>temporary(async directory=>{
 for(const target of [{accountId:'0'.repeat(32),worker:WORKER},{accountId:ACCOUNT,worker:'other'}]){assert.throws(()=>assertTarget(target),/cross-target/);const client=createOfflineDummyClient(noBuckets());await assert.rejects(run(directory,client,{target}),/cross-target/);assert.equal(client.calls.length,0);}
 assert.deepEqual(await readdir(directory),[]);
}));
test('bad bundle hash or metadata fails before lock or dummy side effects',async()=>temporary(async directory=>{
 const client=createOfflineDummyClient(noBuckets()),module=Buffer.from(i.module);module[0]^=1;await assert.rejects(run(directory,client,{module}),/bundle-hash/);assert.equal(client.calls.length,0);assert.deepEqual(await readdir(directory),[]);
}));
test('an arbitrary injected function cannot become a real transport',async()=>temporary(async directory=>{
 let called=false;await assert.rejects(run(directory,{request:async()=>{called=true;}}),/only-closed-offline-dummy-client/);assert.equal(called,false);assert.deepEqual(await readdir(directory),[]);
}));
test('dummy protocol freezes exact multipart while never accepting publication or preservation',async()=>temporary(async directory=>{
 const client=createOfflineDummyClient(noBuckets()),result=await run(directory,client);assert.equal(result.dummyCalls,2);assert.equal(result.realNetworkRequests,0);assert.equal(result.realCloudWrites,0);assert.equal(result.publicationAccepted,false);assert.equal(result.postwritePreservationProved,false);
 const frozen=await readFile(resolve(directory,'simulation-multipart.private.bin')),r=JSON.parse(await readFile(resolve(directory,'simulation-multipart.json')));assert.equal(sha(frozen),r.sha256);
 const form=await new Response(frozen,{headers:{'content-type':r.contentType}}).formData(),m=JSON.parse(form.get('metadata'));
 assert.equal(m.assets.jwt,jwt);assert.deepEqual(m.assets.config,{html_handling:'none',not_found_handling:'none',run_worker_first:true});delete m.assets;assert.deepEqual(m,metadata);
 assert.equal(sha(Buffer.from(await form.get('index.js').arrayBuffer())),PINS.bundle);
 assert.equal((await stat(resolve(directory,'simulation-multipart.private.bin'))).mode&0o777,0o600);
}));
test('server requested bucket uploads only an already declared local asset',async()=>temporary(async directory=>{
 const hash=Object.values(i.manifest)[0].hash,client=createOfflineDummyClient([{method:'POST',path:sessionPath,result:{jwt,buckets:[[hash]]}},{method:'POST',path:uploadPath,result:{jwt}},{method:'PUT',path:PUT,result:{id:'synthetic-ack'}}]);await run(directory,client);assert.deepEqual(client.calls.map(x=>[x.method,x.path,x.credentialKind]),[['POST',sessionPath,'oauth'],['POST',uploadPath,'asset'],['PUT',PUT,'oauth']]);
}));
test('unknown bucket or real-looking completion stops before PUT',async()=>{
 for(const result of [{jwt,buckets:[['f'.repeat(32)]]},{jwt:'opaque.real-looking.jwt',buckets:[]}])await temporary(async directory=>{const client=createOfflineDummyClient([{method:'POST',path:sessionPath,result}]);await assert.rejects(run(directory,client));assert.equal(client.calls.length,1);assert.equal((await readdir(directory)).some(x=>x.startsWith('worker-put')),false);});
});
test('duplicate original request lock cannot send another dummy write',async()=>temporary(async directory=>{
 const client=createOfflineDummyClient(noBuckets());await run(directory,client);const original=await readFile(resolve(directory,'simulation.lock.json'));await assert.rejects(run(directory,client),e=>e.code==='EEXIST');assert.equal(client.calls.length,2);assert.deepEqual(await readFile(resolve(directory,'simulation.lock.json')),original);
}));
test('lost PUT ACK retains intent and stop record and never replays original request',async()=>temporary(async directory=>{
 const steps=noBuckets();steps[1]={method:'PUT',path:PUT,error:'lost-ack'};const client=createOfflineDummyClient(steps);await assert.rejects(run(directory,client),/synthetic-unknown/);assert.equal(client.calls.length,2);
 const intent=JSON.parse(await readFile(resolve(directory,'worker-put-intent.json'))),unknown=JSON.parse(await readFile(resolve(directory,'worker-put-unknown.json'))),stopped=JSON.parse(await readFile(resolve(directory,'simulation-stopped.json')));
 assert.equal(intent.requestId,requestId);assert.equal(unknown.noRetry,true);assert.equal(stopped.originalLockRetained,true);assert.equal(stopped.publicationAccepted,false);
 await assert.rejects(run(directory,client),e=>e.code==='EEXIST');assert.equal(client.calls.length,2);assert.equal((await readdir(directory)).includes('worker-put-ack.private.json'),false);
}));
test('execute always refuses, including CLI with no HOME/token path',()=>{
 assert.throws(()=>execute(),/execute-disabled/);const r=spawnSync(process.execPath,[resolve(ROOT,'prepare-native-replacement.mjs'),'--execute'],{encoding:'utf8',env:{PATH:process.env.PATH}});assert.equal(r.status,1);const result=JSON.parse(r.stderr);assert.match(result.code,/execute-disabled/);assert.equal(result.credentialsRead,false);assert.equal(result.networkRequests,0);assert.equal(result.cloudWrites,0);
});
test('real preparation emits review-only metadata, complete gaps and private permissions',async()=>{
 const result=await prepare();try{const m=JSON.parse(await readFile(resolve(result.directory,'metadata-without-jwt.private.json'))),p=JSON.parse(await readFile(resolve(result.directory,'plan.json')));assertMetadata(m,i.baseline);assert.equal(hashJSON(m.keep_bindings),hashJSON(['secret_text','secret_key']));assert.equal(p.executable,false);assert.equal(p.executeDisabled,true);assert.equal(p.baselineCoverage.all16AppsVersionsRegistryRoutesCronsDomains,false);assert.equal(p.credentialsRead,false);assert.equal(p.networkRequests,0);assert.equal(p.cloudWrites,0);assert.equal((await stat(resolve(result.directory,'metadata-without-jwt.private.json'))).mode&0o777,0o600);await assert.rejects(prepare({requestId:p.requestId}),e=>e.code==='EEXIST');}finally{await rm(result.directory,{recursive:true,force:true});}
});

test('factory client request cannot be replaced and calls are snapshots',async()=>temporary(async directory=>{
 const client=createOfflineDummyClient(noBuckets());let externalCalled=false;
 assert.throws(()=>{client.request=async()=>{externalCalled=true;};},TypeError);
 await run(directory,client);assert.equal(externalCalled,false);assert.equal(client.calls.length,2);
 const observed=client.calls;observed.push({method:'POST',path:'forged'});assert.equal(client.calls.length,2);
}));

test('v2 loader uses only candidate-v2 bytes and its pins cannot be reassigned',async()=>{
 assert.equal(Object.isFrozen(PINS),true);assert.throws(()=>{PINS.candidateDir='.';},TypeError);
 assert.equal(i.candidateDir,'candidate-v2');
 assert.deepEqual(i.module,await readFile(resolve(ROOT,'candidate-v2/gateway.mjs')));
 assert.notEqual(sha(i.module),sha(await readFile(resolve(ROOT,'gateway.mjs'))));
 assert.equal(i.build.frame.htmlSha256,'7f71d5ee385b0703471719289d25d4fc98d25b1e0a138bc2ded28a9c6ef06f4c');
});

test('dummy private request exposes no bind method to replace',async()=>temporary(async directory=>{
 let externalCalled=false;const client=createOfflineDummyClient(noBuckets());
 assert.equal(client.request,undefined);
 assert.throws(()=>{client.request.bind=()=>{externalCalled=true;return async()=>({});};},TypeError);
 assert.throws(()=>Object.defineProperty(client,'request',{value:async()=>{externalCalled=true;}}),TypeError);
 await run(directory,client);assert.equal(externalCalled,false);assert.equal(client.calls.length,2);
}));
