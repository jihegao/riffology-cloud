#!/usr/bin/env node
import {cp,mkdir,readFile,writeFile,readdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const repo=resolve(fileURLToPath(new URL('../..',import.meta.url)));
function fixedIndex(root){const text=readFileSync(resolve(root,'services/browser-preview/execution/assets/static-index.ts'),'utf8'),match=text.match(/export const browserPreviewStaticIndex = (\{[\s\S]*\}) as const;/);if(!match)throw Error('fixed-index-invalid');return JSON.parse(match[1]);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(directory){const result=[];async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isSymbolicLink())throw Error('browser-preview-web-link-invalid');if(entry.isDirectory())await visit(file);else if(entry.isFile()){const bytes=await readFile(file);result.push({path:relative(directory,file),sha256:hash(bytes),byteLength:bytes.length});}else throw Error('browser-preview-web-entry-invalid');}}await visit(directory);return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
export function validateBrowserPreviewWebAssets(root=repo){
 try{const local=resolve(root,'.local/browser-preview'),receipt=JSON.parse(readFileSync(resolve(local,'gateway-assets-receipt.json'),'utf8'));if(receipt.schema!=='riffology.browser-gateway-assets/v1'||!Array.isArray(receipt.webFiles)||!receipt.webFiles.length)throw Error('receipt-invalid');
  const index=fixedIndex(root);if(receipt.staticIndexSha256!==hash(readFileSync(resolve(root,'services/browser-preview/execution/assets/static-index.ts'))))throw Error('index-source-drift');if(JSON.stringify(receipt.appAssets)!==JSON.stringify(index.assets.filter(a=>a.kind==='app'))||JSON.stringify(receipt.versions)!==JSON.stringify(index.versions)||JSON.stringify(receipt.runtimeProfiles)!==JSON.stringify(index.runtimeProfiles))throw Error('fixed-index-drift');
  const current=[];const scan=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('web-link');const file=join(dir,entry.name);if(entry.isDirectory())scan(file);else if(entry.isFile())current.push(relative(resolve(root,'services/web'),file));}};scan(resolve(root,'services/web'));if(JSON.stringify(current.sort())!==JSON.stringify(receipt.webFiles.map(f=>f.path).sort()))throw Error('web-inventory-drift');
  for(const file of receipt.webFiles){const source=readFileSync(resolve(root,'services/web',file.path)),built=readFileSync(resolve(local,'gateway-assets',file.path));if(hash(source)!==file.sha256||hash(built)!==file.sha256||built.length!==file.byteLength)throw Error('web-drift');}
  for(const asset of receipt.appAssets){const bytes=readFileSync(resolve(local,'gateway-assets',asset.file));if(hash(bytes)!==asset.sha256||bytes.length!==asset.byteLength)throw Error('static-drift');}
  return {name:'browser-preview-gateway-assets',status:'passed',detail:'Verified composite web and immutable runtime asset receipt',evidence:receipt};
 }catch{return {name:'browser-preview-gateway-assets',status:'blocked',detail:'Run node scripts/m3/materialize-browser-preview-web.mjs after verified runtime asset preparation; missing or drifted composite assets'};}
}
export async function materializeBrowserPreviewWeb(root=repo){
 const run=spawnSync(process.execPath,[resolve(root,'services/browser-preview/execution/materialize.mjs')],{cwd:root,encoding:'utf8',timeout:60000});
 if(run.status!==0)throw Error('browser-preview-static-materialization-failed: '+(run.stderr||run.stdout));
 const local=resolve(root,'.local/browser-preview'),index=JSON.parse(await readFile(resolve(local,'static-index.json'),'utf8')),directory=resolve(local,'gateway-assets'),staging=await mkdtemp(resolve(local,'gateway-assets-next-'));
 try{
  await cp(resolve(root,'services/web'),staging,{recursive:true});const webFiles=await inventory(staging),appAssets=index.assets.filter(a=>a.kind==='app');
  for(const asset of appAssets){const bytes=await readFile(resolve(local,'app-assets',asset.file));if(bytes.length!==asset.byteLength||hash(bytes)!==asset.sha256)throw Error('browser-preview-web-source-mismatch');const dest=resolve(staging,asset.file);if(!dest.startsWith(staging+'/'))throw Error('browser-preview-web-path-invalid');await mkdir(resolve(dest,'..'),{recursive:true});await writeFile(dest,bytes);}
  const receipt={schema:'riffology.browser-gateway-assets/v1',staticIndexSha256:hash(readFileSync(resolve(root,'services/browser-preview/execution/assets/static-index.ts'))),runtimeProfiles:index.runtimeProfiles,delivery:index.delivery,versions:index.versions,webFiles,appAssets,assetCount:appAssets.length};
  const backup=resolve(local,'gateway-assets-old-'+randomUUID());if(existsSync(directory))await rename(directory,backup);
  try{await rename(staging,directory);}catch(error){if(existsSync(backup))await rename(backup,directory);throw error;}
  await writeFile(resolve(local,'gateway-assets-receipt.json'),JSON.stringify(receipt,null,2)+'\n');await rm(backup,{recursive:true,force:true});return {directory,...receipt};
 }finally{await rm(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await materializeBrowserPreviewWeb(),null,2));
