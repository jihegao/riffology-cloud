import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {canonicalPreviewJson,previewSha256,type PreviewSourcePath} from '../../services/browser-preview/contract.ts';
import {createTrustedPreviewRegistry,emptyPreviewRegistry,PREVIEW_LIMITS,PREVIEW_SERVER_ADAPTER_SHA256,type TrustedPreviewProfile} from '../../services/browser-preview/profiles.ts';
import {validateSavedPreview,type CompatiblePreview} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview,unpackPreviewPackage,type PreviewPackage} from '../../services/browser-preview/packager.ts';
import {readPreviewPackage,storePreviewPackage,previewObjectKey,type PreviewBuildIntent,type PreviewBuildReceipt,type PreviewReceiptPort} from '../../services/browser-preview/storage.ts';
const encode=(s:string)=>new TextEncoder().encode(s);
const spec={schemaVersion:1,researchQuestion:'How does capacity affect waits?',scope:'Queue',entities:['customer'],mechanisms:['service'],assumptions:['constant arrivals'],parameters:{steps:{type:'integer',default:2,minimum:1,maximum:500},variant:{type:'enum',default:'base',values:['base','other']}},metrics:{completed:{}},limitations:['synthetic fixture'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
const fileValues:Record<string,Uint8Array>={
 'model/model.py':encode('import random\n\ndef run(config):\n    rng = random.Random(config["seed"])\n    return {"model": "queue", "snapshots": []}\n'),
 'model/run.py':new Uint8Array(await readFile(new URL('../../services/run/model_run_adapter.py',import.meta.url))),
 'model/model-spec.json':encode(JSON.stringify(spec)),
 'model/visualization.json':encode(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'lane',metricKeys:['completed']})),
 'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}'),
 'docs/private.txt':encode('must-not-be-in-package'),
};
async function profileFixture():Promise<TrustedPreviewProfile>{
 const assets=[{path:'runtime/test-fixture.bin',sha256:await previewSha256('not-real-pyodide'),byteLength:16}];
 return {runtime:{profileId:'python-stdlib/v1',runtimeVersion:'pyodide-314.0.6/v1',adapterVersion:'riffology.model-run/v1',pythonVersion:'3.14.2',visualProtocol:'riffology.visual/v0.1',limitsSha256:await previewSha256(canonicalPreviewJson(PREVIEW_LIMITS)),assetSha256:await previewSha256(canonicalPreviewJson(assets)),dependencies:[]},assets,packages:{},trust:'test-fixture'};
}
async function fixture(overrides:Record<string,Uint8Array>={}){
 const archive=initialWorkspaceArchive({...fileValues,...overrides});
 const source={projectId:'project-test',revisionId:'revision-test',filesSha256:await workspaceArchiveReader(archive).sha256()};
 const profile=await profileFixture(),registry=await createTrustedPreviewRegistry([profile]);
 return {archive,source,profile,registry,async validate(){return validateSavedPreview(source,archive,'python-stdlib/v1',registry);}};
}
async function packageFixture(){const f=await fixture(),result=await f.validate();assert.equal(result.status,'compatible');if(result.status!=='compatible')throw Error('fixture-invalid');return {...f,candidate:result.value,packageValue:await packageCompatiblePreview(result.value)};}
const scope={tenantId:'tenant-test',projectId:'project-test',workspaceId:'workspace-test'};
class Bucket{
 objects=new Map<string,Uint8Array>();puts=0;loseResponse=false;failBeforeWrite=false;
 async put(key:string,bytes:Uint8Array,options:unknown){assert.deepEqual(options,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json; charset=utf-8'}});this.puts++;if(this.failBeforeWrite)throw Error('no-delivery');if(!this.objects.has(key))this.objects.set(key,Uint8Array.from(bytes));if(this.loseResponse)throw Error('delivery-unknown');return {};}
 async get(key:string){const bytes=this.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
}
class Receipts implements PreviewReceiptPort{
 intents:PreviewBuildIntent[]=[];saved:PreviewBuildReceipt|null=null;failPersist=false;failBegin=false;
 async begin(intent:PreviewBuildIntent){if(this.failBegin)throw Error('intent-unavailable');this.intents.push(structuredClone(intent));}
 async persist(receipt:PreviewBuildReceipt){if(this.failPersist)throw Error('receipt-unavailable');if(!this.saved)this.saved=structuredClone(receipt);else{const {verifiedAt:_a,...a}=this.saved,{verifiedAt:_b,...b}=receipt;assert.deepEqual(a,b);}return structuredClone(this.saved);}
}
const fixtureOptions={allowTestFixture:true,now:()=>1000};
test('saved archive builds byte-identical envelope with original hashes and source paths only',async()=>{
 const {candidate,packageValue}=await packageFixture();
 const again=await packageCompatiblePreview(candidate);assert.deepEqual(again.bytes,packageValue.bytes);assert.equal(again.sha256,packageValue.sha256);
 const unpacked=await unpackPreviewPackage(packageValue.bytes);assert.deepEqual(unpacked.manifest,packageValue.manifest);assert.equal(unpacked.files.size,5);
 for(const [path,bytes] of unpacked.files)assert.deepEqual(bytes,fileValues[path]);
 assert.equal(new TextDecoder().decode(packageValue.bytes).includes('must-not-be-in-package'),false);
 const changed=await fixture({'model/model.py':encode(new TextDecoder().decode(fileValues['model/model.py'])+'\n# preserve exact comment\n')});
 const result=await changed.validate();assert.equal(result.status,'compatible');if(result.status==='compatible')assert.notEqual((await packageCompatiblePreview(result.value)).manifest.packageIdentity,packageValue.manifest.packageIdentity);
 candidate.files.get('model/model.py')!.fill(0);await assert.rejects(packageCompatiblePreview(candidate),/source-mismatch/);
});
test('source authority mismatch and coercion fail before compatibility result',async()=>{
 const f=await fixture();await assert.rejects(validateSavedPreview({...f.source,filesSha256:'a'.repeat(64)},f.archive,'python-stdlib/v1',f.registry),/source-mismatch/);
 await assert.rejects(validateSavedPreview({...f.source,projectId:1} as never,f.archive,'python-stdlib/v1',f.registry),/source-invalid/);
 const missing=await fixture();assert.deepEqual(await validateSavedPreview(missing.source,missing.archive,'python-stdlib/v1',emptyPreviewRegistry),{status:'unsupported',reasonCode:'profile-unavailable'});
});
test('unsupported inputs have stable reasons and never execute or fetch generated Python',async()=>{
 const cases:Array<[Record<string,Uint8Array>,string]>=[
  [{'model/model-spec.json':encode('{}')},'model-spec-invalid'],
  [{'model/visualization.json':encode('{"script":"fetch(secret)"}')},'visualization-invalid'],
  [{'app/requirements.lock':encode('{"schemaVersion":1,"packages":{"requests":"1"}}')},'dependency-unsupported'],
  [{'model/model.py':encode('import js\ndef run(config):\n    return js.fetch("https://trap/")')},'python-unsupported'],
  [{'model/model.py':encode('import os\ndef run(config):\n    return os.getenv("SECRET")')},'python-unsupported'],
  [{'model/model.py':encode('def run(config):\n    if config["seed"] >= 0: import os\n    return {"model": "queue", "snapshots": []}')},'python-unsupported'],
  [{'model/model.py':encode('def run(config):\n    while False: from os import environ\n    return {"model": "queue", "snapshots": []}')},'python-unsupported'],
  [{'model/model.py':encode('def run(config):\n    return eval(config)')},'python-unsupported'],
  [{'model/model.py':encode('def run(config):\n    return {}\nrun({})')},'python-unsupported'],
  [{'model/run.py':encode('import json\nfrom model import run\nprint(json.dumps({"schemaVersion":1,"metrics":{"completed":999}}))\n')},'python-unsupported'],
  [{'model/model.py':new Uint8Array(PREVIEW_LIMITS.sourceBytes+1)},'source-too-large'],
 ];
 for(const [overrides,reasonCode] of cases){const f=await fixture(overrides);const result=await f.validate();assert.deepEqual(result,{status:'unsupported',reasonCode});assert.deepEqual(await f.validate(),result);}
 const files={...fileValues};delete files['model/visualization.json'];const archive=initialWorkspaceArchive(files),f=await fixture();assert.deepEqual(await validateSavedPreview({...f.source,filesSha256:await workspaceArchiveReader(archive).sha256()},archive,'python-stdlib/v1',f.registry),{status:'unsupported',reasonCode:'source-missing'});
});
test('browser compatibility binds exact platform adapter, even for legacy-looking valid imports',async()=>{
 assert.equal(await previewSha256(fileValues['model/run.py']),PREVIEW_SERVER_ADAPTER_SHA256);
 const f=await fixture({'model/run.py':encode(new TextDecoder().decode(fileValues['model/run.py'])+'\n# changed wrapper semantics or bytes\n')});
 assert.deepEqual(await f.validate(),{status:'unsupported',reasonCode:'python-unsupported'});
});
test('registry rejects tampered assets, limits, dependencies and unregistered source locks',async()=>{
 const profile=await profileFixture();
 for(const changed of [{...profile,runtime:{...profile.runtime,assetSha256:'a'.repeat(64)}},{...profile,runtime:{...profile.runtime,limitsSha256:'b'.repeat(64)}},{...profile,assets:[...profile.assets,...profile.assets]},{...profile,runtime:{...profile.runtime,dependencies:[{name:'numpy',version:'2.4.6',sha256:'c'.repeat(64)}]}},{...profile,packages:{requests:'1'}}])await assert.rejects(createTrustedPreviewRegistry([changed]),/profile-invalid/);
 const f=await fixture(),copy=f.registry.resolve('python-stdlib/v1')!;copy.runtime.assetSha256='d'.repeat(64);assert.notEqual(f.registry.resolve('python-stdlib/v1')!.runtime.assetSha256,copy.runtime.assetSha256);
});
test('Mesa source lock is six fixed roots while identity records full platform wheel closure',async()=>{
 const stdlib=await profileFixture();
 const packages={mesa:'3.5.1',networkx:'3.6.1',numpy:'2.4.6',pandas:'3.0.2',scipy:'1.18.0',tqdm:'4.67.3'};
 const dependencies=await Promise.all(Object.entries({...packages,micropip:'0.11.0'}).map(async([name,version])=>({name,version,sha256:await previewSha256('synthetic-wheel-'+name)})));
 const assets=[...stdlib.assets,...dependencies.map(d=>({path:'wheels/'+d.name+'.whl',sha256:d.sha256,byteLength:10}))].sort((a,b)=>a.path<b.path?-1:1);
 const profile:TrustedPreviewProfile={...stdlib,packages,assets,runtime:{...stdlib.runtime,profileId:'mesa-3.5.1/v1',dependencies,assetSha256:await previewSha256(canonicalPreviewJson(assets))}};
 const registry=await createTrustedPreviewRegistry([profile]);
 const archive=initialWorkspaceArchive({...fileValues,'app/requirements.lock':encode(JSON.stringify({schemaVersion:1,packages})),'model/model.py':encode('from mesa import Model\nfrom mesa.space import SingleGrid\n\ndef run(config):\n    model = Model(seed=config["seed"])\n    return {"model": "grid", "snapshots": []}\n'),'model/visualization.json':encode(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'grid',metricKeys:['completed']}))});
 const source={projectId:'project-test',revisionId:'revision-mesa',filesSha256:await workspaceArchiveReader(archive).sha256()};
 const result=await validateSavedPreview(source,archive,'mesa-3.5.1/v1',registry);assert.equal(result.status,'compatible');if(result.status!=='compatible')throw Error('mesa-fixture-invalid');
 const pkg=await packageCompatiblePreview(result.value);assert.equal(pkg.manifest.runtime.dependencies.length,7);assert.equal(pkg.trust,'test-fixture');
 await assert.rejects(storePreviewPackage(new Bucket(),new Receipts(),scope,pkg),/profile-unverified/);
 const changed=structuredClone(profile);changed.packages.micropip='0.11.0';await assert.rejects(createTrustedPreviewRegistry([changed]),/profile-invalid/);
});
test('package integrity rejects forged identity/content and noncanonical envelope',async()=>{
 const {packageValue}=await packageFixture();const envelope=JSON.parse(new TextDecoder().decode(packageValue.bytes));
 const forged=structuredClone(envelope);forged.manifest.packageIdentity='f'.repeat(64);await assert.rejects(unpackPreviewPackage(encode(canonicalPreviewJson(forged))),/contract-invalid/);
 const changed=structuredClone(envelope);changed.files[0].base64=btoa('different');await assert.rejects(unpackPreviewPackage(encode(canonicalPreviewJson(changed))),/source-mismatch/);
 await assert.rejects(unpackPreviewPackage(encode(JSON.stringify(envelope,null,2))),/noncanonical/);
});
test('create-only delivery-unknown reads same identity and durable receipt retry never rewrites',async()=>{
 const {packageValue}=await packageFixture(),bucket=new Bucket(),receipts=new Receipts();bucket.loseResponse=true;
 const first=await storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions);assert.equal(bucket.puts,1);assert.equal(receipts.intents.length,1);assert.equal(first.buildIdentity,packageValue.manifest.packageIdentity);
 const retry=await storePreviewPackage(bucket,receipts,scope,packageValue,{...fixtureOptions,now:()=>2000});assert.deepEqual(retry,first);assert.equal(bucket.puts,1);
 const read=await readPreviewPackage(bucket,scope,first,{allowTestFixture:true});assert.deepEqual(read.bytes,packageValue.bytes);
 await assert.rejects(readPreviewPackage(bucket,{...scope,tenantId:'other-tenant'},first,{allowTestFixture:true}),/read-denied/);
 await assert.rejects(readPreviewPackage(bucket,scope,first),/read-denied/);
});
test('unverified fixtures, reference failure, missing delivery and object conflicts cannot become ready',async()=>{
 const {packageValue}=await packageFixture(),bucket=new Bucket(),receipts=new Receipts();
 await assert.rejects(storePreviewPackage(bucket,receipts,scope,packageValue),/profile-unverified/);assert.equal(bucket.puts,0);assert.equal(receipts.saved,null);
 receipts.failBegin=true;await assert.rejects(storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions),/intent-unavailable/);assert.equal(bucket.puts,0);receipts.failBegin=false;
 bucket.failBeforeWrite=true;await assert.rejects(storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions),/storage-unavailable/);assert.equal(receipts.saved,null);
 bucket.failBeforeWrite=false;bucket.objects.set(previewObjectKey(scope,packageValue.manifest.packageIdentity),new Uint8Array(packageValue.bytes.length));await assert.rejects(storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions),/object-conflict/);assert.equal(receipts.saved,null);
});
test('receipt persistence failure recovers existing object, deletion refuses latest-head fallback',async()=>{
 const {packageValue}=await packageFixture(),bucket=new Bucket(),receipts=new Receipts();receipts.failPersist=true;
 await assert.rejects(storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions),/receipt-unavailable/);assert.equal(bucket.puts,1);assert.equal(receipts.saved,null);
 receipts.failPersist=false;const receipt=await storePreviewPackage(bucket,receipts,scope,packageValue,fixtureOptions);assert.equal(bucket.puts,1);
 await assert.rejects(readPreviewPackage(bucket,scope,{...receipt,revisionId:'new-head'},{allowTestFixture:true}),/read-denied/);
 bucket.objects.delete(receipt.objectKey);await assert.rejects(readPreviewPackage(bucket,scope,receipt,{allowTestFixture:true}),/source-unavailable/);
});
