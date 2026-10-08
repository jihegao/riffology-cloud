import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
// Local preparation only. These review requests deliberately are not complete
// deploy payloads. Refresh/compare the cloud baseline before any future write.
const root='.local/riffoid-live-freeze-20261008';const out=root+'/candidates';
await mkdir(out,{recursive:true,mode:0o700});
const json=async name=>JSON.parse(await readFile(root+'/'+name,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gateway=await json('riffology-m1-gateway-staging.snapshot.json');
const execution=await json('riffology-browser-execution.snapshot.json');
const namespaces=await json('namespaceMetadata.json');
const extra=await json('extra-readback.json');
const bindings=gateway.version.resources.bindings;const runtime=gateway.version.resources.script_runtime;
assert.equal(gateway.version.id,'aeddf112-a2be-45da-868c-ed576c55d5ec');
assert.equal(execution.version.id,'c94df077-02a1-460f-8158-e47a338e68af');
assert.equal(bindings.length,93);assert.equal(execution.version.resources.bindings.length,4);
assert.deepEqual(runtime.compatibility_flags,['nodejs_compat','nodejs_compat_do_not_populate_process_env']);
assert.deepEqual(gateway.settings.bindings,bindings);assert.equal(runtime.compatibility_date,'2026-09-09');
assert.equal(bindings.find(x=>x.name==='APP_ORIGIN').text,'https://m1.riff-demo.gaojihe.cn');
assert.equal(execution.version.resources.bindings.find(x=>x.name==='APP_ORIGIN').text,'https://m1.riff-demo.gaojihe.cn');
assert(!bindings.some(x=>['ENTRY_REPLAY','ENTRY_SIGNING_PUBLIC_KEYS_JSON','APP_TRANSPORT_ORIGIN','TWO_ACCOUNT_AUTH_MODE','LEGACY_RECOVERY_ORIGIN','LEGACY_RECOVERY_UNTIL'].includes(x.name)));
const exported=Object.keys(runtime.exports).sort();assert.equal(exported.length,22);
assert.deepEqual(namespaces.map(x=>x.class).sort(),exported);assert(namespaces.every(x=>x.use_sqlite));
const namespaceIdentity=bindings.filter(x=>x.type==='durable_object_namespace').map(x=>({binding:x.name,className:x.class_name,namespaceId:x.namespace_id}));
assert.equal(namespaceIdentity.length,22);assert(namespaceIdentity.every(b=>namespaces.some(n=>n.id===b.namespaceId&&n.class===b.className)));
const exportsAfter={...runtime.exports,EntryReplayGuard:{type:'durable-object',storage:'sqlite'}};
const inherited=bindings.map(x=>({name:x.name,type:'inherit'}));
const metadata={...gateway.settings,main_module:'index.js',bindings:[...inherited,{name:'ENTRY_REPLAY',type:'durable_object_namespace',class_name:'EntryReplayGuard'}],compatibility_date:runtime.compatibility_date,compatibility_flags:[...runtime.compatibility_flags,'enable_request_signal'],exports:exportsAfter,containers:runtime.containers,keep_assets:true,keep_bindings:['secret_text','secret_key']};
// Pending public pin is deliberately outside metadata. No publish command or
// usable signed-entry configuration exists until the strict public ring arrives.
const common={status:'NON_EXECUTABLE_PUBLIC_PIN_AND_ALLOCATED_NAMESPACE_PENDING',baseVersion:gateway.version.id,baseDeployment:gateway.activeDeployment.id,originalBindingCount:93,originalNamespaceIdentity:namespaceIdentity,lifecycleMode:'modern-exports',legacyMigrationTag:null,legacyMigrationsAllowed:false,replayNamespaceId:null,publicPin:null,privateKeyHandled:false,pendingPublicBinding:{name:'ENTRY_SIGNING_PUBLIC_KEYS_JSON',type:'plain_text',text:null},metadata,originalAssetsConfig:runtime.assets,assetsAction:'Preserve existing asset namespace and exact config; verify keep_assets in actual platform response, no replacement upload',productionChanges:false};
await writeFile(out+'/gateway-stage.request.json',JSON.stringify({...common,APP_ORIGIN:'Retain original via inherited APP_ORIGIN; no transport/mode/recovery vars in this stage'},null,2)+'\n');
await writeFile(out+'/forward-rollback.request.json',JSON.stringify({...common,mustResolveBeforeFreeze:['User public ring without d','Actual ENTRY_REPLAY namespace ID allocated once','Post-lifecycle full exports/bindings snapshot'],removeVarsTogether:['APP_TRANSPORT_ORIGIN','TWO_ACCOUNT_AUTH_MODE','LEGACY_RECOVERY_ORIGIN','LEGACY_RECOVERY_UNTIL'],requiredNamespaceAction:'Retain exact allocated namespace and all original22 IDs; never clear/delete/recreate or raw rollback'},null,2)+'\n');
const artifacts=[];
for(const [name,source] of [['gateway','services/gateway/index.ts'],['forward-rollback','services/gateway/forward-rollback.ts']]){
 const built=await build({entryPoints:[source],bundle:true,write:false,metafile:true,format:'esm',platform:'neutral',target:'es2024',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent'});
 const bytes=built.outputFiles[0].contents;
 await writeFile(out+'/'+name+'.worker.mjs',bytes);
 const codeExports=Object.values(built.metafile.outputs)[0].exports.sort();assert(Object.keys(exportsAfter).every(x=>codeExports.includes(x)));
 artifacts.push({name,source,sha256:hash(bytes),bytes:bytes.length,codeExports});
}
assert.deepEqual(artifacts[0].codeExports,artifacts[1].codeExports);
const executionModules=extra.workers.find(x=>x.worker==='riffology-browser-execution').modules;assert.equal(executionModules.length,1);
const executionBytes=await readFile(root+'/'+executionModules[0].localName);assert.equal(hash(executionBytes),executionModules[0].sha256);
await copyFile(root+'/'+executionModules[0].localName,out+'/execution-preserved.worker.mjs');
artifacts.push({name:'execution-preserved',sha256:hash(executionBytes),bytes:executionBytes.length,source:'Exact downloaded current production module; no recompilation or code change'});
await writeFile(out+'/execution-origin-only.request.json',JSON.stringify({status:'NON_EXECUTABLE_COORDINATED_CUTOVER_ONLY',baseVersion:execution.version.id,baseSnapshot:execution,codeSha256:hash(executionBytes),compatibilityDate:'2026-09-05',compatibilityFlags:execution.version.resources.script_runtime.compatibility_flags,onlyProposedChange:{binding:'APP_ORIGIN',from:'https://m1.riff-demo.gaojihe.cn',to:'https://app.riffoid.com'},assets:'Preserve exact existing assets/config with keep_assets; snapshot hash in manifest',publicPinAndReplayAndOldWafMustBeReady:true,productionChanges:false},null,2)+'\n');
const manifest={status:'CODE_AND_CURRENT_NONSECRET_BASE_FROZEN_FINAL_PRODUCTION_ROLLBACK_PENDING',baseline:{gatewayVersion:gateway.version.id,executionVersion:execution.version.id,gatewayBindingCount:93,executionBindingCount:4,originalNamespaceCount:22},lifecycle:{mode:'modern-exports',currentLegacyMigrationTag:null,legacyEntryReplayV1TagSuperseded:true,noLegacyArrayOrInventedMigrationHistory:true,requestedAddOnlyExport:{EntryReplayGuard:exportsAfter.EntryReplayGuard},allOriginalExportsExact:true,allOriginalNamespaceIdentityExact:true,replayNamespaceId:null},artifacts,namespaceIdentity,privateKeyGeneratedReadTransmitted:false,publicPin:null,productionChanges:false};
manifest.frozenInputSha256=Object.fromEntries(await Promise.all(['riffology-m1-gateway-staging.snapshot.json','riffology-browser-execution.snapshot.json','namespaceMetadata.json','extra-readback.json'].map(async name=>[name,hash(await readFile(root+'/'+name))])));
manifest.originalAssetsConfig={gateway:runtime.assets,execution:execution.version.resources.script_runtime.assets};
await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({out,status:manifest.status,artifacts:artifacts.map(({name,sha256,bytes})=>({name,sha256,bytes})),lifecycle:manifest.lifecycle,productionChanges:false}));
