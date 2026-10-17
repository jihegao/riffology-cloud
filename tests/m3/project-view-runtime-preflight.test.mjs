import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareProjectViewImage} from '../../scripts/m3/prepare-project-view-image.mjs';
import {projectViewPreflightMain,readProjectViewPreflight} from '../../services/project-views/runtime-preflight.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const processInfo={platform:'linux',arch:'x64',uid:10001,gid:10001,euid:10001,egid:10001,status:'CapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapAmb:\t0000000000000000\n'};
const encoder=new TextEncoder();
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function fixture(t){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'project-view-preflight-')));t.after(()=>rm(directory,{recursive:true,force:true}));
 const dependencies=join(directory,'dependencies'),lock={packages:{}};
 for(const [name,count] of [['playwright',62],['playwright-core',114]]){
  const root=join(dependencies,name);await mkdir(join(root,'lib'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({name,version:'1.63.0',...(name==='playwright'?{dependencies:{'playwright-core':'1.63.0'}}:{})}));
  if(name==='playwright-core')await writeFile(join(root,'browsers.json'),JSON.stringify({browsers:[{name:'chromium',revision:'1243',browserVersion:'153.0.8010.12'}]}));
  for(let i=name==='playwright'?1:2;i<count;i++)await writeFile(join(root,'lib',`file-${i}.js`),`// ${name} ${i}\n`);
  lock.packages['node_modules/'+name]={version:'1.63.0',integrity:'sha512-'+Buffer.alloc(64).toString('base64')};
 }
 const lockPath=join(directory,'package-lock.json');await writeFile(lockPath,JSON.stringify(lock));
 const context=join(directory,'context');await prepareProjectViewImage(context,{dependencyRoot:dependencies,lockPath});
 const root=join(directory,'viewer');await mkdir(root);await mkdir(join(root,'node_modules'));
 for(const name of ['playwright','playwright-core']){
  const source=join(context,'vendor',name),target=join(root,'node_modules',name);await mkdir(target);await mkdir(join(target,'lib'));
  const receipt=JSON.parse(await readFile(join(context,'context-receipt.json'),'utf8'));
  for(const file of receipt.packages.find(pkg=>pkg.name===name).files)await writeFile(join(target,file.path),await readFile(join(source,file.path)));
 }
 const receiptPath=join(root,'context-receipt.json');await writeFile(receiptPath,await readFile(join(context,'context-receipt.json')));
 const f={directory,root,receiptPath};
 f.receipt=()=>readFile(receiptPath,'utf8').then(JSON.parse);
 f.pin=()=>readFile(receiptPath).then(hash);
 f.writeReceipt=receipt=>writeFile(receiptPath,JSON.stringify(receipt)+'\n');
 f.options=async(extra={})=>({root,expectedReceiptSha256:await f.pin(),processInfo:{...processInfo},environment:{PATH:'/usr/bin:/bin'},chromeVersion:async()=>'Chromium 153.0.8010.12',emit:()=>{},...extra});
 return f;
}
function report(pin){return {schema:'project-view-preflight/v1',contextReceiptSha256:pin,files:176,bytes:4096,uid:10001,gid:10001,chromium:'153.0.8010.12'};}
function output(bytes,{exitCode=Promise.resolve(0),close=true}={}){
 let controller;const stdout=new ReadableStream({start(value){controller=value;if(bytes!==undefined)value.enqueue(typeof bytes==='string'?encoder.encode(bytes):bytes);if(close)value.close();}});
 return {process:{stdout,exitCode},controller};
}

test('runtime preflight hashes all 176 frozen package files and emits only the bounded compatibility receipt',async t=>{
 const f=await fixture(t),emitted=[];await projectViewPreflightMain(await f.options({emit:value=>emitted.push(value)}));
 assert.equal(emitted.length,1);const actual=typeof emitted[0]==='string'?JSON.parse(emitted[0]):emitted[0];
 const receipt=await f.receipt();assert.deepEqual(actual,{...report(await f.pin()),bytes:receipt.packages.flatMap(pkg=>pkg.files).reduce((n,file)=>n+file.bytes,0)});
});

test('runtime preflight rejects receipt replacement and vendor byte changes before reporting readiness',async t=>{
 const f=await fixture(t),options=await f.options(),emitted=[];
 await assert.rejects(projectViewPreflightMain({...options,expectedReceiptSha256:'0'.repeat(64),emit:value=>emitted.push(value)}));
 const file=join(f.root,'node_modules','playwright','lib','file-1.js'),bytes=await readFile(file);bytes[0]^=1;await writeFile(file,bytes);
 await assert.rejects(projectViewPreflightMain({...options,emit:value=>emitted.push(value)}));assert.deepEqual(emitted,[]);
});

test('a pinned malformed manifest cannot escape paths, duplicate work, change package pins, or evade size bounds',async t=>{
 const f=await fixture(t),original=await f.receipt();
 const mutations=[
  receipt=>{receipt.schema='other';},
  receipt=>{receipt.platform='linux/arm64';},
  receipt=>{receipt.packages[0].version='1.63.1';},
  receipt=>{receipt.packages[0].integrity='not-an-sri';},
  receipt=>{receipt.packages[0].files.pop();},
  receipt=>{receipt.packages[0].files[1]={...receipt.packages[0].files[0]};},
  receipt=>{receipt.packages[0].files[0].bytes=16*1024*1024+1;},
  receipt=>{receipt.packages[0].files[0].sha256='x'.repeat(64);},
  ...['../outside','/absolute','lib//empty.js','lib/./dot.js','lib/../escape.js','lib/非ascii.js','a'.repeat(241)].map(path=>receipt=>{receipt.packages[0].files[0].path=path;}),
 ];
 for(const mutate of mutations){const receipt=structuredClone(original);mutate(receipt);await f.writeReceipt(receipt);await assert.rejects(projectViewPreflightMain(await f.options()));}
});

test('runtime preflight rejects linked package files and linked parent directories',async t=>{
 const f=await fixture(t),file=join(f.root,'node_modules','playwright','lib','file-1.js'),original=await readFile(file),outside=join(f.directory,'outside.js');
 await writeFile(outside,original);await rm(file);await symlink(outside,file);await assert.rejects(projectViewPreflightMain(await f.options()));
 await rm(file);await writeFile(file,original);
 const directory=join(f.root,'node_modules','playwright','lib'),moved=join(f.directory,'linked-lib');
 await mkdir(moved);const receipt=await f.receipt();for(const entry of receipt.packages[0].files.filter(item=>item.path.startsWith('lib/')))await writeFile(join(moved,entry.path.slice(4)),await readFile(join(f.root,'node_modules','playwright',entry.path)));
 await rm(directory,{recursive:true});await symlink(moved,directory);await assert.rejects(projectViewPreflightMain(await f.options()));
});

test('runtime preflight requires Linux amd64, the dedicated effective identity, and no process capabilities',async t=>{
 const f=await fixture(t);
 const changes=[{platform:'darwin'},{arch:'arm64'},{uid:0},{gid:0},{euid:0},{egid:0},
  ...['CapEff','CapPrm','CapAmb'].map(cap=>({status:processInfo.status.replace(`${cap}:\t0000000000000000`,`${cap}:\t0000000000000001`)})),
  {status:'CapEff:\t0000000000000000\nCapPrm:\t0000000000000000\n'},
  {status:processInfo.status.replace('CapEff:\t0000000000000000','CapEff:\tinvalid')}];
 for(const change of changes)await assert.rejects(projectViewPreflightMain(await f.options({processInfo:{...processInfo,...change}})));
 await assert.rejects(projectViewPreflightMain(await f.options({chromeVersion:async()=>'Chromium 152.0.0.0'})));
});

test('runtime preflight permits only an absolute nonempty PATH and refuses inherited home or credential variables',async t=>{
 const f=await fixture(t),emitted=[];
 const environments=[
  {PATH:'/usr/bin:/bin',HOME:'/home/viewer'},
  {PATH:'/usr/bin:/bin',OPENAI_API_KEY:'synthetic-preflight-credential'},
  {PATH:'/usr/bin:/bin',NODE_OPTIONS:'--require=/tmp/injected.js'},
  {},{PATH:''},{PATH:'bin'},{PATH:'/usr/bin:bin'},{PATH:':/usr/bin'},{PATH:'/usr/bin:'},
 ];
 for(const environment of environments)await assert.rejects(projectViewPreflightMain(await f.options({environment,emit:value=>emitted.push(value)})));
 assert.deepEqual(emitted,[]);
});

test('a correctly hashed receipt still rejects incompatible package metadata and Chromium revision',async t=>{
 const f=await fixture(t),original=await f.receipt();
 for(const [name,path,metadata] of [
  ['playwright','package.json',{name:'playwright',version:'1.63.1',dependencies:{'playwright-core':'1.63.0'}}],
  ['playwright-core','browsers.json',{browsers:[{name:'chromium',revision:'9999',browserVersion:'153.0.8010.12'}]}],
 ]){
  const receipt=structuredClone(original),bytes=Buffer.from(JSON.stringify(metadata)),record=receipt.packages.find(pkg=>pkg.name===name).files.find(file=>file.path===path);
  const target=join(f.root,'node_modules',name,path),saved=await readFile(target);await writeFile(target,bytes);record.bytes=bytes.length;record.sha256=hash(bytes);await f.writeReceipt(receipt);
  await assert.rejects(projectViewPreflightMain(await f.options()));await writeFile(target,saved);
 }
});

test('preflight reader waits for both EOF and successful process exit before opening the gate',async()=>{
 const pin='a'.repeat(64),exit=deferred(),stream=output(JSON.stringify(report(pin))+'\n',{close:false,exitCode:exit.promise});let settled=false;
 const pending=readProjectViewPreflight(stream.process,pin).then(value=>{settled=true;return value;});
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
 stream.controller.close();await Promise.resolve();await Promise.resolve();assert.equal(settled,false);
 exit.resolve(0);assert.deepEqual(await pending,report(pin));
});

test('preflight reader rejects EOF, floods, malformed receipts, mismatched pins, and nonzero exit',async()=>{
 const pin='b'.repeat(64),valid=report(pin);
 const candidates=[
  '',JSON.stringify(valid)+'\n'+JSON.stringify(valid)+'\n','{',
  JSON.stringify({...valid,extra:true})+'\n',JSON.stringify({...valid,contextReceiptSha256:'c'.repeat(64)})+'\n',
  ...[{files:175},{bytes:-1},{bytes:128*1024*1024+1},{uid:0},{gid:0},{chromium:'153.0.0.0'},{schema:'other'}].map(change=>JSON.stringify({...valid,...change})+'\n'),
  new Uint8Array(4097).fill(32),new Uint8Array([0xff,0xfe]),
 ];
 for(const bytes of candidates)await assert.rejects(readProjectViewPreflight(output(bytes).process,pin));
 await assert.rejects(readProjectViewPreflight(output(JSON.stringify(valid)+'\n',{exitCode:Promise.resolve(1)}).process,pin));
 await assert.rejects(readProjectViewPreflight(output(JSON.stringify(valid)+'\n',{exitCode:Promise.reject(Error('exec failed'))}).process,pin));
});
