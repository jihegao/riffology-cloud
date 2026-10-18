import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
// Source and image layouts are fixed platform inputs. Neither a project path
// nor a package name from the user participates in this resolution.
const image = import.meta.url.startsWith('file:///opt/riffology/trusted-pi/');
export const IR_PACKAGE_ROOT = new URL(image ? '../vendor/riffoid-ir-plugin/' : '../../vendor/riffoid-ir-plugin/', import.meta.url);
const lockUrl = new URL('riffoid-ir-plugin.lock.json', new URL('../', IR_PACKAGE_ROOT));
const bad = () => {throw Error('trusted-ir-package-pin-mismatch');};
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key=>Object.hasOwn(value,key));
/** Reads image-owned package bytes only. A different root is exposed solely
 * for offline pin verification; no product request can choose either path. */
export async function verifyIrPackage(root=IR_PACKAGE_ROOT, lock=lockUrl) {
 const base=fileURLToPath(root).replace(/\/$/,''),lockPath=fileURLToPath(lock),rootInfo=await lstat(base),lockInfo=await lstat(lockPath);
 if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||!lockInfo.isFile()||lockInfo.isSymbolicLink()||lockInfo.nlink!==1||lockInfo.size>128*1024)bad();
 const pin=JSON.parse(await readFile(lockPath,'utf8'));
 if(!exact(pin,['schema','name','version','packageSha256','contractCommit','files'])||pin.schema!=='riffoid-ir.package-pin/v1'||pin.name!=='riffoid-ir-plugin'||typeof pin.version!=='string'||!/^\d+\.\d+\.\d+$/.test(pin.version)||! /^[a-f0-9]{64}$/.test(pin.packageSha256)||! /^[a-f0-9]{40}$/.test(pin.contractCommit)||!Array.isArray(pin.files)||pin.files.length<1||pin.files.length>256)bad();
 const expected=new Map(),directories=new Set();let total=0;
 for(const entry of pin.files){
  if(!exact(entry,['path','bytes','sha256'])||typeof entry.path!=='string'||! /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(entry.path)||entry.path.split('/').some(part=>['.','..'].includes(part))||expected.has(entry.path)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>1024*1024||! /^[a-f0-9]{64}$/.test(entry.sha256))bad();
  expected.set(entry.path,entry);total+=entry.bytes;if(total>8*1024*1024)bad();
  const parts=entry.path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));
 }
 const found=new Set();
 async function walk(relative=''){
  for(const name of await readdir(join(base,relative))){
   const path=relative?relative+'/'+name:name,info=await lstat(join(base,path));
   if(info.isSymbolicLink())bad();
   if(info.isDirectory()){if(!directories.has(path))bad();await walk(path);continue;}
   const entry=expected.get(path);if(!entry||!info.isFile()||info.nlink!==1||info.size!==entry.bytes)bad();
   const bytes=await readFile(join(base,path));if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)bad();found.add(path);
  }
 }
 await walk();if(found.size!==expected.size)bad();
 const manifest=JSON.parse(await readFile(join(base,'package.json'),'utf8'));
 if(manifest.name!==pin.name||manifest.version!==pin.version)bad();
 return Object.freeze({name:pin.name,version:pin.version,packageSha256:pin.packageSha256,contractCommit:pin.contractCommit,files:pin.files.length});
}
export const IR_PACKAGE_PIN = await verifyIrPackage();
const platform = await import(new URL('adapters/riffoid/platform.mjs', IR_PACKAGE_ROOT));
if(platform.IR_PLUGIN_VERSION!==IR_PACKAGE_PIN.version)bad();
export const irToolDefinitions = platform.irToolDefinitions;
export const IR_PLUGIN_VERSION = platform.IR_PLUGIN_VERSION;
export async function irFixedSkill(){
 const skill=await platform.irFixedSkill();
 const onboarding='Riffoid first-project workflow: a new IR page becomes available only after the ordinary Turn finishes and its files are saved as the canonical Revision. On first IR use in a project, including generate-only, call the existing project_ir_install to install the display page; this starts no check, compilation or run. For generate-only, write the draft, call project_ir_show, then finish and save the Turn without check/compile/run. Tell the user to open the saved IR Model project page. If a build-and-run request compiles successfully but no executable browser is connected, state that the artifact is compiled but no run has executed; finish and save the Turn, then explain how to open IR Model and continue in the same conversation. The browser step and resumed work use two Turns in that conversation. After the user opens the page and continues, use a new run effect with the already registered frozen browserArtifactRef, then read its saved result; do not automatically create another Turn, recompile for a connection failure, retry a disconnected original effect, or dispatch an unknown run again. An uncertain heartbeat closes the original page: read the original run, and use an explicit sourceRunId replay only when the user requests it.';
 return {...skill,content:skill.content+'\n\n'+onboarding+'\nFixed package SHA256: '+IR_PACKAGE_PIN.packageSha256+'; plugin '+IR_PACKAGE_PIN.version+'; '+IR_PACKAGE_PIN.files+' verified package files.\n'};
}
export const IR_OPERATION_NAMES = platform.IR_OPERATION_NAMES;
