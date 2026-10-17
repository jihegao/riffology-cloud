import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {candidateContainerArgs,candidateExecArgs,validateCandidateImage,validateCandidateContainer,cleanupCandidateProbe,launchCandidateProcess,runCandidateProbe} from '../../scripts/m3/project-view-candidate-probe.mjs';
import {PROJECT_VIEW_BROWSER_PROGRAM} from '../../services/project-views/runtime-pipe.mjs';
import {PROJECT_VIEW_PREFLIGHT_PROGRAM} from '../../services/project-views/runtime-preflight.mjs';

// These are control-plane/pipe contract tests; no Docker, browser, provider or
// authenticated project is started. Actual image execution remains acceptance.
const IMAGE='sha256:'+'a'.repeat(64),ID='b'.repeat(64),PIN='c'.repeat(64),OP='12345678-1234-4234-8234-123456789abc';
const PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const LABEL='io.riffoid.candidate-view.operation',LEGACY='io.riffoid.offline-view.operation';
const profile=await readFile(new URL('../../scripts/m3/offline-view/chromium-userns-seccomp.json',import.meta.url));
const good=stdout=>({status:0,stdout:typeof stdout==='string'?stdout:JSON.stringify(stdout),stderr:''});
const absent=()=>({status:1,stdout:'',stderr:'Error: No such container: '+ID+'\n'});
const report=()=>({schema:'project-view-preflight/v1',contextReceiptSha256:PIN,files:176,bytes:1024,uid:10001,gid:10001,chromium:'153.0.8010.12'});
function record(){return {schema:'riffology.candidate-view-probe/v1',operationId:OP,containerName:'riffoid-view-'+OP,image:IMAGE,runAttempted:true,containerId:ID,status:'blocked'};}
function image(){return {Id:IMAGE,Architecture:'amd64',Os:'linux',Config:{User:'10001:10001',WorkingDir:'/opt/viewer',Env:['PATH='+PATH,'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright']}};}
function container(operation=OP){return {Id:ID,Name:'/riffoid-view-'+operation,Image:IMAGE,Config:{User:'10001:10001',WorkingDir:'/opt/viewer',Env:['PATH='+PATH,'HOME=/'],Labels:{[LABEL]:operation,[LEGACY]:operation}},Mounts:[],HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapAdd:[],CapDrop:['ALL'],Memory:805306368,NanoCpus:1000000000,CpusetCpus:'0,1',PidsLimit:128,ShmSize:134217728,IpcMode:'private',PidMode:'',PortBindings:{},Binds:[],SecurityOpt:['no-new-privileges=true','seccomp='+JSON.stringify(JSON.parse(profile))],Tmpfs:{'/tmp':'rw,nosuid,nodev,size=268435456'}}};}
async function directory(t){const root=await mkdtemp(join(tmpdir(),'candidate-probe-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('candidate uses only an explicit local image, original labels and reviewed sandbox flags',()=>{
 const args=candidateContainerArgs(IMAGE,OP);
 for(const value of ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpuset-cpus=0,1','--memory=768m','--cpus=1','--pids-limit=128','--shm-size=128m','/tmp:rw,nosuid,nodev,size=268435456'])assert.ok(args.includes(value),value);
 assert.ok(args.includes(LABEL+'='+OP));assert.ok(args.includes(LEGACY+'='+OP));assert.ok(args.some(value=>value.startsWith('seccomp=')&&value.endsWith('/chromium-userns-seccomp.json')));
 assert.ok(!args.some(value=>value==='--env'||value.startsWith('HOME=')||value==='--privileged'||value==='--mount'||value==='--volume'||value==='--publish'||value==='--no-sandbox'));
 for(const ref of ['latest','viewer:latest','registry/viewer@sha256:'+'a'.repeat(64)])assert.throws(()=>candidateContainerArgs(ref,OP));
 assert.throws(()=>candidateContainerArgs(IMAGE,'caller-selected-name'));
});

test('preflight and browser exec use exact programs, uid/cwd and PATH-only env without a shell',()=>{
 for(const program of [PROJECT_VIEW_PREFLIGHT_PROGRAM,PROJECT_VIEW_BROWSER_PROGRAM]){
  const args=candidateExecArgs(ID,program,PATH,program===PROJECT_VIEW_PREFLIGHT_PROGRAM?PIN:undefined),start=args.indexOf('/usr/bin/env');
  assert.deepEqual(args.slice(start),['/usr/bin/env','-i','PATH='+PATH,'node','--input-type=module','-e',program,...(program===PROJECT_VIEW_PREFLIGHT_PROGRAM?[PIN]:[])]);
  assert.ok(args.includes(ID));assert.ok(args.includes('10001:10001'));assert.ok(args.includes('/opt/viewer'));assert.ok(!args.some(value=>value==='sh'||value==='bash'||value.startsWith('HOME=')||value.startsWith('PLAYWRIGHT_')));
 }
 assert.throws(()=>candidateExecArgs(ID,'caller supplied source',PATH));
 assert.throws(()=>candidateExecArgs(ID,PROJECT_VIEW_PREFLIGHT_PROGRAM,PATH));
 assert.throws(()=>candidateExecArgs(ID,PROJECT_VIEW_BROWSER_PROGRAM,PATH,PIN));
 for(const path of ['',':/bin','/bin:','bin','/bin:bin','/bin/../evil','/bin//empty','/bin;touch /tmp/x','/bin\n'])assert.throws(()=>candidateExecArgs(ID,PROJECT_VIEW_BROWSER_PROGRAM,path));
});

test('image and actual container inspection reject privilege, path, mount and seccomp drift',()=>{
 assert.deepEqual(validateCandidateImage(image(),IMAGE),{id:IMAGE,architecture:'amd64',os:'linux',user:'10001:10001',cwd:'/opt/viewer',path:PATH,homeEnvironmentPresent:false});
 for(const mutate of [a=>{a.Id='sha256:'+'d'.repeat(64);},a=>{a.Architecture='arm64';},a=>{a.Config.User='0';},a=>{a.Config.WorkingDir='/tmp';},a=>{a.Config.Env.push('PATH=/tmp');},a=>{a.Config.Env.push('HOME=/tmp');}]){const a=image();mutate(a);assert.throws(()=>validateCandidateImage(a,IMAGE));}
 assert.equal(validateCandidateContainer(container(),record(),profile).containerHomeEnvironmentPresent,true,'Docker injected HOME is permitted only on keepalive; exec forcibly clears it');
 const mutations=[a=>{a.Id='e'.repeat(64);},a=>{a.Config.Labels[LABEL]='other';},a=>{a.HostConfig.NetworkMode='bridge';},a=>{a.HostConfig.ReadonlyRootfs=false;},a=>{a.HostConfig.Privileged=true;},a=>{a.HostConfig.CapAdd=['SYS_ADMIN'];},a=>{a.HostConfig.CpusetCpus='0';},a=>{a.HostConfig.Memory=0;},a=>{a.Mounts=[{Source:'/private'}];},a=>{a.HostConfig.Binds=['/private:/private'];},a=>{a.HostConfig.SecurityOpt=['seccomp=unconfined','no-new-privileges'];},a=>{a.HostConfig.SecurityOpt[0]='no-new-privileges=false';},a=>{a.HostConfig.Tmpfs['/extra']='rw';},a=>{a.HostConfig.Tmpfs['/tmp']='rw,size=268435456';}];
 for(const mutate of mutations){const a=container();mutate(a);assert.throws(()=>validateCandidateContainer(a,record(),profile));}
});

async function cleanupFixture(t,changes={}){const output=await directory(t),evidence={...record(),...changes};await writeFile(join(output,'candidate-evidence.json'),JSON.stringify(evidence));return {output,evidence};}
test('cleanup resolves lost rm ACK using scoped empty list AND explicit original-ID not-found',async t=>{
 const f=await cleanupFixture(t);let removed=false;const calls=[];
 const runner=async args=>{calls.push(args);if(args[3]==='ls')return good(removed?'':ID+'\n');if(args[3]==='inspect')return removed?absent():good(container());if(args[3]==='rm'){assert.equal(args.at(-1),ID);removed=true;return {status:null,error:Error('lost ACK'),stdout:'',stderr:''};}throw Error('unexpected');};
 const result=await cleanupCandidateProbe({output:f.output,operationId:OP,runner});assert.equal(result.cleanupConfirmed,true);assert.equal(result.status,'blocked');assert.equal(result.cleanup.originalIdNotFound,true);assert.ok(result.priorEvidenceSha256);assert.equal(calls.filter(args=>args[3]==='rm').length,1);assert.equal(calls.filter(args=>args[3]==='inspect').length,2);
});
test('Docker 29 formatted not-found newline confirms only the original cleanup',async t=>{
 const f=await cleanupFixture(t),calls=[];
 const observed={status:1,stdout:'\n',stderr:'Error response from daemon: No such container: '+ID+'\n'};
 const runner=async args=>{calls.push(args);if(args[3]==='ls')return good('');if(args[3]==='inspect'){assert.equal(args.at(-1),ID);return observed;}assert.fail('no new container or destructive command');};
 const result=await cleanupCandidateProbe({output:f.output,operationId:OP,runner});
 assert.equal(result.cleanupConfirmed,true);assert.equal(result.cleanup.originalIdNotFound,true);assert.equal(result.cleanup.scopedListEmpty,true);assert.equal(result.status,'blocked','cleanup-only cannot upgrade the original probe');assert.equal(calls.length,2);
});
for(const [name,inspection] of [
 ['daemon unavailable',{status:1,stdout:'',stderr:'Cannot connect to the Docker daemon'}],
 ['ambiguous empty failure',{status:1,stdout:'',stderr:''}],
 ['wrong-ID not-found',{status:1,stdout:'',stderr:'Error: No such container: '+'e'.repeat(64)+'\n'}],
 ['nonempty stdout with not-found',{...absent(),stdout:'{}\n'}],
 ['multiple newlines with not-found',{...absent(),stdout:'\n\n'}],
 ['existing original ID',good(container())],
 ['successful empty response',good('')],
])test('empty label list does not prove cleanup when original inspect is '+name,async t=>{
 const f=await cleanupFixture(t);const runner=async args=>args[3]==='ls'?good(''):args[3]==='inspect'?inspection:assert.fail('must not remove/recreate');
 const result=await cleanupCandidateProbe({output:f.output,operationId:OP,runner});assert.equal(result.cleanupConfirmed,false);assert.match(result.cleanup.reason,/absence-unconfirmed/);
});
test('unknown create and identity mismatches never remove a caller name or unrelated ID',async t=>{
 for(const changes of [{containerId:undefined},{}]){
  const f=await cleanupFixture(t,changes);const runner=async args=>{if(args[3]==='ls')return good(changes.containerId===undefined&&Object.hasOwn(changes,'containerId')?'':ID+'\n');if(args[3]==='inspect'){const actual=container();actual.Config.Labels[LEGACY]='another';return good(actual);}assert.fail('no destructive command');};
  const result=await cleanupCandidateProbe({output:f.output,operationId:OP,runner});assert.equal(result.cleanupConfirmed,false);
  await assert.rejects(cleanupCandidateProbe({output:f.output,operationId:'00000000-0000-4000-8000-000000000000',runner}));
 }
});

function fakeProcess(onWrite){
 let controller,finish,closed=false;const chunks=[],writes=[];
 const stdout=new ReadableStream({start(value){controller=value;}}),exitCode=new Promise(resolve=>{finish=resolve;});
 const output=bytes=>{const chunk=typeof bytes==='string'?Buffer.from(bytes):bytes;chunks.push(chunk);if(!closed)controller.enqueue(chunk);};
 const emit=value=>output(JSON.stringify(value)+'\n');
 const end=()=>{if(!closed){closed=true;controller.close();finish(0);}};
 const stdin=new WritableStream({write(bytes){const value=JSON.parse(new TextDecoder().decode(bytes));writes.push(value);onWrite?.(value,{emit,output,end});},close:end,abort:end});
 return {stdin,stdout,exitCode,kill:end,end,emit,output,writes,logs:()=>({stdout:Buffer.concat(chunks),stderr:Buffer.alloc(0),discardedStdoutBytes:0,discardedStderrBytes:0,exitStatus:closed?0:null,exitSignal:null})};
}
function frame(n){const bytes=Buffer.alloc(33);bytes.set([137,80,78,71,13,10,26,10]);bytes.writeUInt32BE(800,16);bytes.writeUInt32BE(600,20);bytes[32]=n;return {type:'frame',base64:bytes.toString('base64'),width:800,height:600};}
function simulation({preflight=report(),malformed=false,signal}={}){
 let operation,exists=false,serial=0,changed=0;const commands=[],stages=[],requests=new Map(),browserWrites=[];
 const keeper=fakeProcess(),pre=fakeProcess(),browser=fakeProcess((value,{emit,output})=>{
  browserWrites.push(value);const request=path=>{const id=++serial;requests.set(id,path);emit({type:'broker',message:{id,type:'files.read',path}});};
  if(value.type==='init'){
   assert.equal(stages.at(-1),'browser');assert.equal(value.package.scope.tenantId,'synthetic-probe');assert.ok(value.frameHtml.includes('<!doctype html>'));
   if(malformed){output('{malformed-json\n');return;}
   emit({type:'broker',message:{type:'installed'}});request('docs/initial.json');
  }else if(value.type==='capture')emit(frame(changed));
  else if(value.type==='broker'){
   const path=requests.get(value.message.id);assert.ok(path);assert.equal(value.message.value.path,path,'real broker must return the declared asset');assert.ok(value.message.value.text);
   if(path==='docs/initial.json')request('docs/rendered-initial.json');
   if(path==='docs/click.json')request('docs/rendered-click.json');
   if(path==='docs/text.json')request('docs/rendered-text.json');
  }else if(value.type==='input'){
   changed++;if(value.event.kind==='click'&&value.event.y===50)request('docs/click.json');if(value.event.kind==='text')request('docs/text.json');if(value.event.kind==='key')request('docs/key.json');
  }
 });
 pre.output(JSON.stringify(preflight)+'\n');pre.end();
 const launch=args=>{
  commands.push(args);
  if(args[2]==='run'){operation=args[args.indexOf('--name')+1].slice(13);exists=true;stages.push('container');return keeper;}
  assert.equal(args[2],'exec');assert.equal(args[args.indexOf('/usr/bin/env')-1],ID);
  if(args.includes(PROJECT_VIEW_PREFLIGHT_PROGRAM)){stages.push('preflight');return pre;}
  assert.ok(args.includes(PROJECT_VIEW_BROWSER_PROGRAM));stages.push('browser');if(signal)signal.emit('SIGTERM');return browser;
 };
 const runner=async args=>{
  commands.push(args);if(args[2]==='image')return good(image());
  if(args[3]==='ls')return good(exists?ID+'\n':'');
  if(args[3]==='inspect')return exists?good(container(operation)):absent();
  if(args[3]==='rm'){assert.equal(args.at(-1),ID);exists=false;keeper.end();browser.end();return good(ID+'\n');}
  throw Error('unexpected Docker control');
 };
 return {runner,launch,commands,stages,browserWrites,get exists(){return exists;}};
}
test('real runtime pipe and readonly broker exercise bootstrap, files, bounded input and exact-ID release',async t=>{
 const root=await directory(t),f=simulation(),output=join(root,'attempt');
 const result=await runCandidateProbe({image:IMAGE,contextReceiptSha256:PIN,output,...f,signals:new EventEmitter(),timeoutMs:2000,pollMs:1});
 assert.equal(result.status,'local-candidate-probe-passed');assert.equal(result.cleanupConfirmed,true);assert.deepEqual(f.stages,['container','preflight','browser']);assert.equal(f.exists,false);
 assert.deepEqual(result.execEnvironment.keys,['PATH']);assert.match(result.resourceScope,/not equivalent/);assert.equal(result.productionEligible,false);assert.equal(result.authenticatedAcceptance,false);assert.equal(result.cloudCalls,0);
 for(const path of ['docs/initial.json','docs/rendered-initial.json','docs/click.json','docs/rendered-click.json','docs/text.json','docs/rendered-text.json','docs/key.json'])assert.equal(result.brokerReads[path],1);
 assert.equal(f.browserWrites.filter(value=>value.type==='input').length,5);assert.equal(result.frames.length,2);assert.notEqual(result.frames[0].sha256,result.frames[1].sha256);assert.equal(result.preflight.files,176);
 assert.equal((await readFile(join(output,'browser-stdout.raw'))).length,result.cli.browser.stdoutBytes);assert.equal(result.cleanup.originalIdNotFound,true);
});
test('preflight failure sends no project init, retains raw failure and still destroys the original ID',async t=>{
 const root=await directory(t),f=simulation({preflight:{...report(),uid:0}}),output=join(root,'attempt');
 const result=await runCandidateProbe({image:IMAGE,contextReceiptSha256:PIN,output,...f,signals:new EventEmitter(),timeoutMs:1000,pollMs:1});
 assert.equal(result.status,'blocked');assert.equal(result.cleanupConfirmed,true);assert.deepEqual(f.stages,['container','preflight']);assert.deepEqual(f.browserWrites,[]);assert.match(await readFile(join(output,'preflight-stdout.raw'),'utf8'),/"uid":0/);
});
test('malformed browser stdout is preserved before parse failure and exact original cleanup',async t=>{
 const root=await directory(t),f=simulation({malformed:true}),output=join(root,'attempt');
 const result=await runCandidateProbe({image:IMAGE,contextReceiptSha256:PIN,output,...f,signals:new EventEmitter(),timeoutMs:1000,pollMs:1});
 assert.equal(result.status,'blocked');assert.equal(result.cleanupConfirmed,true);assert.equal(await readFile(join(output,'browser-stdout.raw'),'utf8'),'{malformed-json\n');assert.equal(f.exists,false);
});
test('signal after preflight blocks acceptance and preserves the same original cleanup identity',async t=>{
 const root=await directory(t),signals=new EventEmitter(),f=simulation({signal:signals});
 const result=await runCandidateProbe({image:IMAGE,contextReceiptSha256:PIN,output:join(root,'attempt'),...f,signals,timeoutMs:1000,pollMs:1});
 assert.equal(result.status,'blocked');assert.equal(result.reason,'candidate-probe-interrupted');assert.equal(result.cleanupConfirmed,true);assert.deepEqual(f.browserWrites,[],'interrupt observed before init must not deliver project input');assert.equal(signals.listenerCount('SIGTERM'),0);assert.equal(f.commands.filter(args=>args[3]==='rm').length,1);
});
test('CLI transport preserves malformed bytes and bounds raw logs before parsers',async()=>{
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});const kills=[];child.kill=signal=>{kills.push(signal);return true;};
 let invoked;const transport=launchCandidateProcess(['fixed'],{spawnProcess:(...args)=>{invoked=args;return child;}});
 const reader=transport.stdout.getReader(),first=reader.read();child.stdout.write(Buffer.from('{bad\xff\n','latin1'));await first;
 child.stderr.write(Buffer.alloc(1024*1024+1));child.stdout.end();child.stderr.end();child.emit('close',1,null);await transport.exitCode;
 const logs=transport.logs();assert.equal(invoked[0],'docker');assert.deepEqual(invoked[1],['fixed']);assert.deepEqual(invoked[2].stdio,['pipe','pipe','pipe']);assert.equal(logs.stdout.toString('hex'),Buffer.from('{bad\xff\n','latin1').toString('hex'));assert.equal(logs.stderr.length,1024*1024);assert.equal(logs.discardedStderrBytes,1);assert.deepEqual(kills,['SIGTERM']);await reader.cancel();
});
