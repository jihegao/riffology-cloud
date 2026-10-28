/** Synthetic local build closure; never uses production bundles or credentials. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {sha,privateStore} from '../../scripts/ir-publication/core/io-boundary.mjs';
import {APP_IDS,ACCOUNT} from '../../scripts/ir-publication/core/fixed-target.mjs';
import {REQUEST} from '../../scripts/ir-publication/local-guards.mjs';
import {registryFor} from './synthetic-api.mjs';

export async function buildFixture(directory){
  const sourceRoot=join(directory,'source'),assetRoot=join(directory,'output/candidate-assets');
  await mkdir(sourceRoot,{recursive:true});await mkdir(assetRoot,{recursive:true});
  const store=await privateStore(join(directory,'inputs'));
  const reference=async(file,bytes)=>{await writeFile(file,bytes);return {file,bytes:bytes.length,sha256:sha(bytes)};};
  const files=[];
  for(const name of ['tools.py','bridge.mjs']){
    const bytes=Buffer.from('# synthetic fixture '+name+'\n'),ref=await reference(join(sourceRoot,name),bytes);
    files.push({path:name,bytes:ref.bytes,sha256:ref.sha256,gitBlob:'e'.repeat(40)});
  }
  const commit='a'.repeat(40),tree='b'.repeat(40),packageSha256='86b7a28a1b92652fb01b15ea6671414ecdd5e38c639878455e7abffb60d46ad6';
  const bundle=await reference(join(directory,'bundle.mjs'),Buffer.from('export default {fetch(){return new Response("synthetic")}}'));
  const asset=await reference(join(assetRoot,'test.js'),Buffer.from('/* synthetic asset */'));
  const req=createRequire(resolve('node_modules/wrangler/package.json')),blake3=req('blake3-wasm');
  const address=blake3.hash((await readFile(asset.file)).toString('base64')+'js').toString('hex').slice(0,32);
  const gatewayClosure={sourceCommit:commit,sourceTree:tree,sourceRoot,assetRoot,dependenciesRoot:resolve('node_modules'),packageSha256,bundle,
    sourceInventory:await store.write('source.json',{sourceCommit:commit,sourceTree:tree,files}),
    sourceGraph:await store.write('graph.json',[]),auxiliaryInputs:await store.write('aux.json',{tools:[],dependencyPackageMetadata:[]}),
    assetsInventory:await store.write('assets.json',[{path:'/test.js',bytes:asset.bytes,sha256:asset.sha256}]),
    assetsManifest:await store.write('manifest.json',{'/test.js':{hash:address,size:asset.bytes}}),
    packageIdentity:await store.write('package.json',{package:{sha256:packageSha256},fileCount:45}),
    buildManifest:await store.write('build.json',{sourceCommit:commit,sourceTree:tree,artifacts:{bundle}})};
  const repos=['riffology-20261001-project-tools','riffology-issue165-trusted-pi'];
  const digests=['402381b5b2c0f460e6af44bc4e953d53f6bdb648de4c9ccbeee837815580cd8f','dcd4a5fc6f02c9d0ee1290e07c268a8dba4aba1790e75b98c5f7bb83792da487'];
  const apps=APP_IDS.map((appId,i)=>{const repository='registry.cloudflare.com/'+ACCOUNT+'/'+repos[i],manifest='sha256:'+digests[i];return {appId,kind:i?'TrustedPi':'ProjectTools',knownHistoricalRepository:repository,manifest,desiredImageReference:repository+'@'+manifest};});
  const registryByApp=Object.fromEntries(apps.map(x=>[x.appId,registryFor(x)]));
  const imageSourceClosure=await store.write('images.json',{schema:'riffoid-ir.final-main-image-source-closure/v1',sourceCommit:commit,sourceTree:tree,
    images:Object.fromEntries(apps.map((x,i)=>[i?'trusted-pi':'project-tools',{rootDescriptor:registryByApp[x.appId].receipt.rootDescriptor,targetCount:1,nativeSourceProofSha256:'c'.repeat(64),files:[{sourcePath:files[i].path,bytes:files[i].bytes,sha256:files[i].sha256}]}]))});
  const sourceAuditReference=await store.write('source-audit.json',{synthetic:true}),authorityEvidenceReference=await store.write('authority.json',{synthetic:true,notUserAuthorization:true});
  const handoffEvidenceReference=await store.write('handoff.json',{synthetic:true});
  const facts={schema:'riffoid-ir.owner-bound-publication-facts/v1',syntheticFixture:true,executionEnabled:true,requestId:REQUEST,
    authority:{kind:'existing-user-conditional-m3-m4',evidenceSha256:authorityEvidenceReference.sha256},
    parent:{terminal:true,requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},handoff:{writerTransferred:true,safariTransferred:true},
    finalMain:{sha:commit,tree,sourceAuditSha256:sourceAuditReference.sha256},
    newIrMaintenance:{hold:{requestId:REQUEST,actor:{userId:'synthetic',authVersion:1},policySha256:'d'.repeat(64),controlRevision:19,beganAt:1},control:{revision:19,policySha256:'d'.repeat(64)},receipts:{}},
    endsAt:new Date(Date.now()+120000).toISOString(),releaseMessage:'SYNTHETIC OFFLINE INTEGRATION',publicOrigin:'https://offline-fixture.invalid',registryByApp,imageSourceClosure,gatewayClosure};
  return {facts,sourceAuditReference,authorityEvidenceReference,handoffEvidenceReference,
    a2:{target:{apps},frozenSource:{frame:{path:'/never'},pins:{buildRoot:directory}}}};
}
