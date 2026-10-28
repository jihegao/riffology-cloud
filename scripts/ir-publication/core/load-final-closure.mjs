/** Only owner-bound ACTUAL final build closure is accepted. A2 bytes are reference. */
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {guard,sha} from './io-boundary.mjs';
import {hashJSON} from './a2/ir-publication-candidate.mjs';
import {isId} from './fixed-target.mjs';
const HEX=/^[a-f0-9]{64}$/,SHA40=/^[a-f0-9]{40}$/;
export function assertExecutionFacts(f){
  guard(f?.schema==='riffoid-ir.owner-bound-publication-facts/v1'&&f.executionEnabled===true,'actual-root-execution-facts-required');
  guard(isId(f.requestId)&&f.requestId!==f.parent?.requestId,'new-ir-request-identity-required');
  guard(f.authority?.kind==='existing-user-conditional-m3-m4'&&HEX.test(f.authority.evidenceSha256??''),'existing-conditional-authority-evidence-required');
  guard(f.parent?.terminal===true&&f.handoff?.writerTransferred===true&&f.handoff?.safariTransferred===true,'actual-terminal-and-owner-handoff-required');
  guard(SHA40.test(f.finalMain?.sha??'')&&SHA40.test(f.finalMain?.tree??'')&&HEX.test(f.finalMain?.sourceAuditSha256??''),'actual-final-main-audit-required');
  guard(f.newIrMaintenance?.hold&&f.newIrMaintenance?.receipts?.end==null,'new-ir-segment-maintenance-required');
  guard(f.gatewayClosure?.sourceCommit===f.finalMain.sha&&f.gatewayClosure?.sourceTree===f.finalMain.tree&&f.gatewayClosure?.packageSha256==='86b7a28a1b92652fb01b15ea6671414ecdd5e38c639878455e7abffb60d46ad6','actual-final-gateway-closure-required');
  guard(HEX.test(f.imageSourceClosure?.sha256??''),'actual-final-image-source-closure-required');
  guard(Number.isFinite(Date.parse(f.endsAt))&&Date.parse(f.endsAt)>Date.now(),'ir-execution-window-expired');
}
async function file(path,expected,max=256*1024*1024){const st=await lstat(path);guard(st.isFile()&&!st.isSymbolicLink()&&st.size<=max,'bounded-regular-closure-file');const b=await readFile(path);guard(b.length===expected.bytes&&HEX.test(expected.sha256??'')&&sha(b)===expected.sha256,'closure-file-sha-drift');return b;}
async function pinned(ref,max){guard(typeof ref?.file==='string'&&ref.file.startsWith('/'),'actual-closure-reference-required');return file(ref.file,ref,max);}
const confined=(root,path)=>{guard(typeof root==='string'&&root.startsWith('/')&&typeof path==='string'&&!path.startsWith('/')&&!path.split('/').some(x=>['..','.'].includes(x)),'closure-logical-path');const p=resolve(root,path);guard(p.startsWith(resolve(root)+'/'),'closure-path-confined');return p;};
export async function loadFinalClosure(facts,{signal,deadline=Date.now()+60000}={}){
  const check=()=>guard(!signal?.aborted&&Date.now()<deadline,'closure-read-deadline');check();
  assertExecutionFacts(facts);const c=facts.gatewayClosure;
  const source=JSON.parse(await pinned(c.sourceInventory)),graph=JSON.parse(await pinned(c.sourceGraph)),aux=JSON.parse(await pinned(c.auxiliaryInputs)),assets=JSON.parse(await pinned(c.assetsInventory)),manifest=JSON.parse(await pinned(c.assetsManifest)),packageIdentity=JSON.parse(await pinned(c.packageIdentity)),build=JSON.parse(await pinned(c.buildManifest));
  guard(source.sourceCommit===facts.finalMain.sha&&source.sourceTree===facts.finalMain.tree&&build.sourceCommit===source.sourceCommit&&build.sourceTree===source.sourceTree,'final-build-main-identity-link');
  guard(packageIdentity.package.sha256===c.packageSha256&&packageIdentity.fileCount===45,'fixed-package-file-identity');
  const imageSources=JSON.parse(await pinned(facts.imageSourceClosure));
  guard(imageSources.schema==='riffoid-ir.final-main-image-source-closure/v1'&&imageSources.sourceCommit===facts.finalMain.sha&&imageSources.sourceTree===facts.finalMain.tree,'final-main-image-source-link');
  for(const [role,appId]of [['project-tools','a03156a6-9bf5-43fb-8b7f-a1f5b8d1a650'],['trusted-pi','a03628c4-f032-461f-a65b-612ccac11a06']]){check();const image=imageSources.images?.[role],receipt=facts.registryByApp?.[appId]?.receipt;guard(image&&Array.isArray(image.files)&&image.files.length>0&&image.targetCount>=image.files.length&&HEX.test(image.nativeSourceProofSha256??''),'native-image-source-proof-required');guard(hashJSON(image.rootDescriptor)===hashJSON(receipt?.rootDescriptor),'current-image-root-receipt-link');for(const row of image.files){check();await file(confined(c.sourceRoot,row.sourcePath),row);}}
  for(const row of source.files){check();await file(confined(c.sourceRoot,row.path),row);}
  for(const row of graph){check();await file(row.path.startsWith('node_modules/')?confined(c.dependenciesRoot,row.path.slice('node_modules/'.length)):confined(c.sourceRoot,row.path),row);}
  for(const row of aux.tools){check();await file(row.realPath??row.path,row);}
  for(const row of aux.dependencyPackageMetadata){check();const path=confined(c.dependenciesRoot,row.path);if(row.present)await file(path,row);else{let absent=false;try{await lstat(path);}catch(e){if(e.code==='ENOENT')absent=true;else throw e;}guard(absent,'package-metadata-presence-drift');}}
  const module=await pinned(c.bundle,8*1024*1024);guard(c.bundle.sha256===build.artifacts.bundle.sha256&&c.bundle.bytes===build.artifacts.bundle.bytes,'actual-bundle-build-link');
  guard(Array.isArray(assets)&&new Set(assets.map(x=>x.path)).size===assets.length&&Object.keys(manifest).length===assets.length,'actual-asset-set-complete');
  const assetBytes=new Map();
  // Reuse the already installed local asset address library, never Wrangler CLI.
  const req=createRequire(join(c.dependenciesRoot,'wrangler/package.json')),blake3=req('blake3-wasm');
  for(const row of assets){check();guard(row.path.startsWith('/')&&!row.path.includes('\\'),'actual-asset-path');const b=await file(confined(c.assetRoot,row.path.slice(1)),row,64*1024*1024),address=blake3.hash(b.toString('base64')+extname(row.path).slice(1)).toString('hex').slice(0,32);guard(manifest[row.path]?.hash===address&&manifest[row.path]?.size===b.length,'actual-asset-address-binding');if(assetBytes.has(address))guard(assetBytes.get(address).equals(b),'asset-address-collision');else assetBytes.set(address,b);}
  check();
  return {module,manifest,assets,assetBytes,packageIdentity,build,source,graph,closure:c};
}
