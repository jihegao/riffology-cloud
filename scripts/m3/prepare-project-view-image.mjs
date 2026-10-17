import {readFile,readdir,lstat,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const version='1.63.0',base='mcr.microsoft.com/playwright@sha256:957bb6b7cba151ced0b5bb841703e282c45df1d934af88933b1b655411ecba3a';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Offline only. Enumerate the exact two cached npm packages and refuse links,
 * special files, oversized inputs or an existing output. Never executes Docker. */
export async function prepareProjectViewImage(output,{dependencyRoot=resolve(repository,'node_modules'),lockPath=resolve(repository,'package-lock.json'),dockerfilePath=resolve(repository,'services/project-views/Dockerfile')}={}){
 if(typeof output!=='string'||!output)throw Error('image-context-output-required');
 const lockBytes=await readFile(lockPath),lock=JSON.parse(lockBytes),inputs=[];
 for(const name of ['playwright','playwright-core']){
  const source=await realpath(resolve(dependencyRoot,name)),metadata=JSON.parse(await readFile(join(source,'package.json'),'utf8')),pin=lock.packages?.['node_modules/'+name];
  if(metadata.name!==name||metadata.version!==version||pin?.version!==version||typeof pin.integrity!=='string'||! /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pin.integrity)||name==='playwright'&&metadata.dependencies?.['playwright-core']!==version)throw Error('image-context-package-pin');
  if(name==='playwright-core'){
   const browsers=JSON.parse(await readFile(join(source,'browsers.json'),'utf8'));
   if(!browsers.browsers?.some(browser=>browser.name==='chromium'&&browser.revision==='1243'&&browser.browserVersion==='153.0.8010.12'))throw Error('image-context-browser-pin');
  }
  const files=[];let total=0;
  async function walk(directory,prefix=''){
   for(const entry of (await readdir(directory)).sort()){
    const path=join(directory,entry),relative=prefix+entry,info=await lstat(path);
    if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory())throw Error('image-context-special-file');
    if(info.isDirectory()){await walk(path,relative+'/');continue;}
    if(info.size>16*1024*1024||(total+=info.size)>64*1024*1024||files.length>=4096)throw Error('image-context-limit');
    const bytes=await readFile(path);if(bytes.byteLength!==info.size)throw Error('image-context-input-changed');
    files.push({path:relative,bytes,sha256:sha(bytes),mode:info.mode&0o777});
   }
  }
  await walk(source);inputs.push({name,version,integrity:pin.integrity,files});
 }
 const dockerfile=await readFile(dockerfilePath);
 if(!dockerfile.toString().includes('FROM --platform=linux/amd64 '+base))throw Error('image-context-base-pin');
 const target=resolve(output);await mkdir(target,{recursive:false});
 for(const input of inputs)for(const file of input.files){const path=join(target,'vendor',input.name,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes,{flag:'wx',mode:file.mode});}
 await writeFile(join(target,'Dockerfile'),dockerfile,{flag:'wx'});
 const receipt={schema:'project-view-image-context/v1',preparedAt:new Date().toISOString(),platform:'linux/amd64',baseImage:base,dockerfileSha256:sha(dockerfile),lockSha256:sha(lockBytes),packages:inputs.map(({name,version,integrity,files})=>({name,version,integrity,files:files.map(({path,sha256,bytes})=>({path,sha256,bytes:bytes.length}))})),networkRequests:0,built:false,pushed:false,finalImage:null,productionEligible:false};
 const receiptText=JSON.stringify(receipt,null,2)+'\n';await writeFile(join(target,'context-receipt.json'),receiptText,{flag:'wx'});
 return {output:target,receiptSha256:sha(receiptText),fileCount:inputs.reduce((count,input)=>count+input.files.length,0),baseImage:base,built:false,pushed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==3)throw Error('usage: node scripts/m3/prepare-project-view-image.mjs NEW-OUTPUT-DIRECTORY');
 console.log(JSON.stringify(await prepareProjectViewImage(process.argv[2])));
}
