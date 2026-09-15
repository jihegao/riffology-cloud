import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXED_PROGRAM,FIXED_COMMAND,MODULES,frozenProbe,workerSource,validateContent} from './g4-release-content-probe.mjs';
test('content probe freezes six paths and provider-free policy inspection; HTTP cannot select actor or command',()=>{
 assert.equal(MODULES.length,6);assert.match(FIXED_PROGRAM,/BROWSER_PREVIEW_GENERATION_CONTRACT/);assert.match(FIXED_COMMAND,/^node --input-type=module -e /);
 for(const token of ['resolveOptions(', 'providerFetch(', 'fetch(', 'createProductTrustedPiRelease('])assert.equal(FIXED_PROGRAM.includes(token),false,token);
 const source=workerSource(frozenProbe('a'.repeat(24)).actor,frozenProbe('a'.repeat(24)).identity);assert.match(source,/Object.keys\(input\).length!==1/);assert.equal(source.includes('input.actor'),false);assert.equal(source.includes('input.command'),false);assert.equal(source.includes('startLifecycleProbe'),false);assert.equal(source.includes('/bin/sleep'),false);
 assert.throws(()=>workerSource('client-selected'),/actor-invalid/);
});
test('signed-off content requires exact modules, root protection, adapter and generation contract',()=>{
 const adapter='fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898';
 const modules=MODULES.map(name=>({name,sha256:'a'.repeat(64),byteLength:20,uid:0,gid:0,mode:0o444})),generationContract={schema:'frozen'},value={schemaVersion:1,modules,generationContract,adapterSha256:adapter,adapterActualSha256:adapter},expected={modules,generationContract};
 assert.equal(validateContent(value,expected),value);
 for(const change of [{...value,adapterActualSha256:'b'.repeat(64)},{...value,generationContract:{schema:'other'}},{...value,modules:modules.map((x,i)=>i===1?{...x,sha256:'b'.repeat(64)}:x)},{...value,modules:modules.map((x,i)=>i===4?{...x,mode:0o666}:x)}])assert.throws(()=>validateContent(change,expected));
});

test('health requires continuous success and bounded cleanup retries only fixed destroy after exact identity',async()=>{
 const {waitHealth,destroyBounded}=await import('./g4-release-content-probe.mjs');let now=0,n=0;
 const sleep=async ms=>{now+=ms;};
 await waitHealth(async()=>{n++;if(n===2)throw Error('404');return {ok:true};},{now:()=>now,sleep,stableMs:3000,pollMs:1000,deadlineMs:10000});assert.equal(n,6);
 now=0;await assert.rejects(waitHealth(async()=>{throw Error('404');},{now:()=>now,sleep,deadlineMs:3000,pollMs:1000}),/health-unconfirmed/);
 let proofs=0,destroys=0;
 const ack=await destroyBounded(async()=>{proofs++;},async()=>{destroys++;if(destroys<3)throw Error('transport-unknown');return {ok:true,destroyAcknowledged:true,running:false,nativeStopImmediatelyObserved:true};},{now:()=>now,sleep});
 assert.equal(ack.destroyAcknowledged,true);assert.equal(proofs,3);assert.equal(destroys,3);
 await assert.rejects(destroyBounded(async()=>{throw Error('version-changed');},async()=>{throw Error('must-not-call');},{now:()=>now,sleep}),/version-changed/);
 const source=workerSource(frozenProbe('a'.repeat(24)).actor,frozenProbe('a'.repeat(24)).identity);assert.match(source,/health.*GET/);assert.equal(source.indexOf("'/health'")<source.indexOf('const stub='),true);
});

test('destroy uses only compiled token identity and confirms immediate running false',()=>{
 const probe=frozenProbe('b'.repeat(24)),source=workerSource(probe.actor,probe.identity);
 assert.equal(probe.identity.sessionId,'session-'+ 'b'.repeat(24));assert.equal(probe.identity.generation,1);
 assert.match(source,/destroyAndReleaseState/);assert.equal(source.includes('input.identity'),false);assert.equal(source.includes('await stub.destroy()'),false);
 assert.throws(()=>workerSource(probe.actor,{...probe.identity,sessionId:'other'}),/identity-invalid/);
 assert.throws(()=>frozenProbe('client-selected'),/token-invalid/);
});

test('running true never becomes destroy acknowledgement',async()=>{
 const {destroyBounded}=await import('./g4-release-content-probe.mjs');let now=0,calls=0;
 await assert.rejects(destroyBounded(async()=>{},async()=>{calls++;return {ok:true,destroyAcknowledged:true,running:true,nativeStopImmediatelyObserved:true};},{now:()=>now,sleep:async ms=>{now+=ms;},maxAttempts:2}),/destroy-shape/);assert.equal(calls,2);
});

test('main app uses current fixed-ID detail despite stale aggregate list; namespace and rollout fail closed',async()=>{
 const {readMainApp,validateMainApp}=await import('./g4-release-content-probe.mjs');
 const id='a03628c4-f032-461f-a65b-612ccac11a06',namespace='ac0e9a31323e463b9a05696dad1b30d5',name='riffology-m3-trusted-pi-staging';
 const apps=[{id,name,image:'old-image',version:4}],detail={id,name,version:5,configuration:{image:'new-image'},durable_objects:{namespace_id:namespace},health:{errors:[]}},version={resources:{bindings:[{name:'TRUSTED_PI_SANDBOX',type:'durable_object_namespace',namespace_id:namespace}]}},expected={image:'new-image'},calls=[];
 const result=readMainApp((args,json)=>{calls.push(args);assert.equal(json,true);return args[1]==='list'?apps:detail;},'/fixed/config',version,expected);
 assert.equal(result.image,'new-image');assert.equal(result.version,5);assert.deepEqual(calls.map(x=>x.slice(0,3)),[['containers','list','--json'],['containers','info',id]]);
 for(const bad of [{...detail,configuration:{image:'old-image'}},{...detail,id:'other'},{...detail,durable_objects:{namespace_id:'wrong'}},{...detail,active_rollout_id:'pending'},{...detail,health:{errors:['error']}},{...detail,health:{}}])assert.throws(()=>validateMainApp(apps,bad,version,expected));
 assert.throws(()=>validateMainApp([...apps,...apps],detail,version,expected),/identity/);
 assert.throws(()=>validateMainApp(apps,detail,{resources:{bindings:[{...version.resources.bindings[0],namespace_id:'wrong'}]}},expected),/namespace/);
 assert.throws(()=>readMainApp(()=>[{...apps[0],id:'other'}],'/fixed',version,expected),/identity/);
});
