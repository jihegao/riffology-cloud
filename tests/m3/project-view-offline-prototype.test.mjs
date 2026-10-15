import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {containerArgs,runPrototype,cleanupPrototype} from '../../scripts/m3/project-view-offline-prototype.mjs';
const image='sha256:'+'a'.repeat(64),name='riffoid-view-11111111-1111-4111-8111-111111111111',id='b'.repeat(64),label='io.riffoid.offline-view.operation';

test('offline launcher rejects tags, remote images and caller-controlled container names',()=>{
 for(const image of [undefined,'latest','node:22','registry.example/image','sha256:abc'])assert.throws(()=>containerArgs(image,name,''),/image-digest/);
 assert.throws(()=>containerArgs('sha256:'+'a'.repeat(64),'existing-production-container',''),/container-name/);
 const args=containerArgs(image,name,'trusted program');
 for(const required of ['unix:///var/run/docker.sock','--pull=never','--network=none','--read-only','10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges'])assert(args.includes(required));
 assert(!args.some(arg=>['--privileged','--network=host','--volume','--mount','-v','-p','--publish','--env-file'].includes(arg)));
});
// Deliberately incomplete PNG-like fixtures. Header-only acceptance is not a
// decode/CRC claim, and these bytes must never become a user-facing UI image.
function frame(marker){const bytes=Buffer.alloc(34);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(800,16);bytes.writeUInt32BE(600,20);bytes[33]=marker;return bytes.toString('base64');}
function fakeRunner(directory,{result,removeFails=false,foreign=false,onRun}={}){
 const calls=[];let exists=false,containerName,operationId;
 const runner=async(args,options={})=>{
  calls.push(args);assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
  const ok=stdout=>({status:0,stdout,stderr:''});
  if(args[2]==='image')return ok(image+'\n');
  if(args[2]==='run'){
   const pending=JSON.parse(await readFile(join(directory,'evidence.json'),'utf8'));
   assert.equal(pending.status,'pending');assert.equal(pending.runAttempted,true);assert.equal(pending.cleanupConfirmed,false);
   containerName=args[args.indexOf('--name')+1];operationId=pending.operationId;
   assert.equal(containerName,pending.containerName);assert.equal(containerName,'riffoid-view-'+operationId);assert(args.includes(label+'='+operationId));
   exists=true;if(onRun)return onRun({options,pending,ok});
   return result??ok(JSON.stringify({schema:'offline-synthetic-frames/v1',browser:'Chromium synthetic fixture',chromiumSandbox:true,nonLoopback:[],connectResult:'ENETUNREACH',frames:[frame(1),frame(2)]}));
  }
  if(args[3]==='ls'){assert(args.includes('label='+label+'='+operationId));return ok(exists?id+'\n':'');}
  if(args[3]==='inspect')return ok(JSON.stringify({Id:id,Name:foreign?'/foreign-container':'/'+containerName,Image:image,Config:{Labels:{[label]:operationId}}}));
  if(args[3]==='rm'){assert.equal(args.at(-1),id,'only verified immutable ID can be removed');if(removeFails)return {status:1,stdout:'',stderr:'synthetic rm failed'};exists=false;return ok(id+'\n');}
  throw Error('unexpected injected Docker command');
 };
 return {runner,calls,get exists(){return exists;},allowRemove(){removeFails=false;},setOriginal(evidence){exists=true;containerName=evidence.containerName;operationId=evidence.operationId;}};
}
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'offline-view-injected-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('injected valid result persists original intent first, saves header-only artifacts and confirms exact cleanup',async t=>{
 const dir=await directory(t),fake=fakeRunner(dir),result=await runPrototype({image,output:dir,runner:fake.runner});
 assert.equal(result.status,'local-experiment-passed');assert.equal(result.cleanupConfirmed,true);assert.equal(fake.exists,false);
 assert.equal(result.productionEligible,false);assert.equal(result.userUiEligible,false);assert.equal(result.frameValidation,'png-header-only');
 assert.equal(result.frameHashes.length,2);assert.equal((await readFile(join(dir,'frame-0.png'))).length,34);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'evidence.json'),'utf8')),result);
 await assert.rejects(runPrototype({image,output:dir,runner:fake.runner}),{code:'EEXIST'});
});
test('injected CLI timeout is blocked and still removes the original container',async t=>{
 const dir=await directory(t),fake=fakeRunner(dir,{result:{status:null,error:Error('docker-command-timeout'),stdout:'',stderr:''}});
 const result=await runPrototype({image,output:dir,runner:fake.runner});assert.equal(result.status,'blocked');assert.equal(result.reason,'container-or-browser-experiment-failed');assert.equal(result.cleanupConfirmed,true);assert.equal(fake.exists,false);
});
test('cleanup failure stays blocked and explicit original operation can recover without a new run',async t=>{
 const dir=await directory(t),fake=fakeRunner(dir,{removeFails:true}),first=await runPrototype({image,output:dir,runner:fake.runner});
 assert.equal(first.status,'blocked');assert.equal(first.reason,'container-cleanup-unconfirmed');assert.equal(first.cleanupConfirmed,false);
 const calls=fake.calls.length;await assert.rejects(cleanupPrototype({output:dir,operationId:'22222222-2222-4222-8222-222222222222',runner:fake.runner}),/invalid-original-operation/);assert.equal(fake.calls.length,calls);
 fake.allowRemove();const recovered=await cleanupPrototype({output:dir,operationId:first.operationId,runner:fake.runner});
 assert.equal(recovered.cleanupConfirmed,true);assert.equal(recovered.status,'blocked');assert.equal(recovered.reason,'cleanup-only-no-experiment-validation');assert.equal(fake.calls.filter(c=>c[2]==='run').length,1);assert.equal(fake.exists,false);
});
test('recovery refuses foreign container name or a changed persisted operation before removal',async t=>{
 const dir=await directory(t),fake=fakeRunner(dir,{foreign:true}),result=await runPrototype({image,output:dir,runner:fake.runner});
 assert.equal(result.cleanupConfirmed,false);assert.equal(result.cleanup.reason,'container-cleanup-identity-mismatch');assert.equal(fake.calls.some(c=>c[3]==='rm'),false);
 await writeFile(join(dir,'evidence.json'),JSON.stringify({...result,containerName:'existing-production-container'}));
 const count=fake.calls.length;await assert.rejects(cleanupPrototype({output:dir,operationId:result.operationId,runner:fake.runner}),/invalid-original-operation/);assert.equal(fake.calls.length,count);
});
test('injected SIGTERM aborts the CLI, waits for scoped cleanup and removes only its signal handlers',async t=>{
 const dir=await directory(t),signals=new EventEmitter(),foreign=()=>{};signals.on('SIGTERM',foreign);
 const fake=fakeRunner(dir,{onRun:({options})=>new Promise(resolve=>{options.signal.addEventListener('abort',()=>resolve({status:null,error:Error('aborted'),stdout:'',stderr:''}),{once:true});setImmediate(()=>signals.emit('SIGTERM'));})});
 const result=await runPrototype({image,output:dir,runner:fake.runner,signals});assert.equal(result.status,'blocked');assert.equal(result.interruptedBy,'SIGTERM');assert.equal(result.reason,'prototype-interrupted');assert.equal(result.cleanupConfirmed,true);assert.equal(fake.exists,false);assert.deepEqual(signals.listeners('SIGTERM'),[foreign]);assert.equal(signals.listenerCount('SIGINT'),0);
});
test('pending original operation recovers by verified ID; an empty list cannot fence an unresolved create',async t=>{
 const dir=await directory(t),operationId=name.slice(13),pending={schema:'riffology.offline-view-prototype/v1',operationId,containerName:name,image,runAttempted:true,status:'pending',productionEligible:false,userUiEligible:false,cleanupConfirmed:false};
 await writeFile(join(dir,'evidence.json'),JSON.stringify(pending));
 const absent=await cleanupPrototype({output:dir,operationId,runner:async()=>({status:0,stdout:'',stderr:''})});
 assert.equal(absent.cleanupConfirmed,false);assert.equal(absent.cleanup.reason,'original-create-unresolved');
 const fake=fakeRunner(dir);fake.setOriginal(pending);
 const recovered=await cleanupPrototype({output:dir,operationId,runner:async(args,options)=>{
  if(args[3]==='rm'){const recorded=JSON.parse(await readFile(join(dir,'evidence.json'),'utf8'));assert.equal(recorded.containerId,id,'verified ID must be durable before removal');}
  return fake.runner(args,options);
 }});
 assert.equal(recovered.cleanupConfirmed,true);assert.equal(recovered.status,'blocked');assert.equal(fake.calls.some(c=>c[2]==='run'),false);assert.equal(fake.exists,false);
});
for(const [description,stdout]of [['invalid JSON','not JSON'],['invalid frame header',JSON.stringify({schema:'offline-synthetic-frames/v1',browser:'fixture',chromiumSandbox:true,nonLoopback:[],connectResult:'ENETUNREACH',frames:[Buffer.alloc(24).toString('base64'),frame(2)]})],['malformed network evidence',JSON.stringify({schema:'offline-synthetic-frames/v1',browser:'fixture',chromiumSandbox:true,nonLoopback:'',connectResult:'ENETUNREACH',frames:[frame(1),frame(2)]})]])test('injected '+description+' is blocked and still cleaned',async t=>{
 const dir=await directory(t),fake=fakeRunner(dir,{result:{status:0,stdout,stderr:''}}),result=await runPrototype({image,output:dir,runner:fake.runner});assert.equal(result.status,'blocked');assert.equal(result.cleanupConfirmed,true);assert.equal(fake.exists,false);await assert.rejects(readFile(join(dir,'frame-0.png')),{code:'ENOENT'});
});
test('missing explicit image records blocked, never a successful isolation result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'offline-view-preflight-'));
 try{const result=await runPrototype({output:dir});assert.equal(result.status,'blocked');assert.equal(result.reason,'explicit-local-image-digest-required');assert.equal(result.productionEligible,false);assert.equal(result.cleanupConfirmed,true);assert.deepEqual(JSON.parse(await readFile(join(dir,'evidence.json'),'utf8')),result);}finally{await rm(dir,{recursive:true,force:true});}
});
