import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_DIRECTORY } from '../../services/runtime/release-probe.mjs';

const moduleURL=new URL('../../services/runtime/release-probe.mjs',import.meta.url).href;
const wrapper=`import {readFile} from 'node:fs/promises';
const {runReleaseProbe}=await import(process.argv[1]);
const result=await runReleaseProbe(JSON.parse(await readFile('/dev/stdin','utf8')),{storageDirectory:process.argv[2]});
process.stdout.write(JSON.stringify(result)+'\\n');if(result.status==='rejected')process.exitCode=1;`;
const input=(command,requestId='request-0001',extras={})=>({command,directory:RELEASE_DIRECTORY,requestId,...extras});
async function fixture(t){
 const parent=await mkdtemp(join(await realpath(tmpdir()),'m0-release-process-')),directory=join(parent,'state'),children=[];
 function launch(value,{cli=false,args=[]}={}){
  const child=spawn(process.execPath,cli?[fileURLToPath(moduleURL),...args]:['--input-type=module','-e',wrapper,moduleURL,directory],
   {stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>65536)child.kill('SIGKILL');});child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>4096)child.kill('SIGKILL');});
  child.stdin.on('error',()=>{});child.stdin.end(typeof value==='string'?value:JSON.stringify(value));
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr,pid:child.pid}));});
  children.push({child,closed});return {child,closed};
 }
 async function call(value,options){const result=await launch(value,options).closed;assert.equal(result.stderr,'');const lines=result.stdout.trim().split('\n');assert.equal(lines.length,1);return {...result,value:JSON.parse(lines[0])};}
 async function state(){return JSON.parse(await readFile(join(directory,'state.json'),'utf8'));}
 async function waitRunning(id){const deadline=Date.now()+3000;while(Date.now()<deadline){try{const value=await state();if(value.requests[id]?.status==='running'&&!(await readdir(directory)).includes('.mutation-lock'))return value;}catch{}await new Promise(resolve=>setTimeout(resolve,10));}throw Error('running intent was never observed after the commit lock released');}
 t.after(async()=>{for(const {child} of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.map(x=>x.closed));await rm(parent,{recursive:true,force:true});});
 return {parent,directory,launch,call,state,waitRunning};
}

test('independent real processes initialize, increment, read and persist an atomic counter',async t=>{
 const f=await fixture(t),first=await f.call(input('initialize'));
 assert.equal(first.code,0);assert.equal(first.value.counter,0);assert.equal(first.value.pid,first.pid);assert.equal(first.value.protocol,'m0-v1');assert.equal(first.value.format,1);
 const next=await f.call(input('increment','increment-0001'));assert.equal(next.code,0);assert.equal(next.value.counter,1);assert.notEqual(next.pid,first.pid);
 const before=await readFile(join(f.directory,'state.json'));
 const observed=await f.call(input('read','observe-0001'));assert.equal(observed.value.status,'observed');assert.equal(observed.value.counter,1);assert.equal(observed.value.active,null);
 assert.deepEqual(await readFile(join(f.directory,'state.json')),before);assert.equal((await stat(join(f.directory,'state.json'))).mode&0o777,0o600);
 assert.deepEqual(await readdir(f.directory),['state.json']);assert.equal((await f.state()).requests['increment-0001'].status,'completed');
});

test('completed request replay survives process restart and conflicting reuse never changes state',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));await f.call(input('increment','increment-0001'));await f.call(input('increment','increment-0002'));
 const before=await readFile(join(f.directory,'state.json'));
 const replay=await f.call(input('increment','increment-0001'));assert.equal(replay.code,0);assert.equal(replay.value.replayed,true);assert.equal(replay.value.counter,1);assert.equal(replay.value.currentCounter,2);assert.equal(replay.value.checkpoint.counter,1);
 assert.deepEqual(await readFile(join(f.directory,'state.json')),before);
 const conflict=await f.call(input('hold','increment-0001',{holdMs:1}));assert.equal(conflict.code,1);assert.equal(conflict.value.error,'request-conflict');
 assert.deepEqual(await readFile(join(f.directory,'state.json')),before);assert.equal((await f.state()).counter,2);
});

test('a fresh directory restores only the supplied confirmed format and remains writable',async t=>{
 const f=await fixture(t);const init=await f.call(input('initialize','restore-0001',{restore:{schema:1,counter:27}}));assert.equal(init.code,0);assert.equal(init.value.counter,27);
 assert.equal((await f.call(input('increment','increment-0001'))).value.counter,28);
 const rejected=await f.call(input('initialize','restore-0002',{restore:{schema:1,counter:100}}));assert.equal(rejected.value.error,'already-initialized');assert.equal((await f.state()).counter,28);
});

test('hold persists running intent before waiting, read observes its real PID without mutating and completion preserves counter',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));
 const running=f.launch(input('hold','hold-request-0001',{holdMs:700}));await f.waitRunning('hold-request-0001');
 const before=await readFile(join(f.directory,'state.json')),seen=await f.call(input('read','observe-running'));
 assert.deepEqual(seen.value.active,{requestId:'hold-request-0001',command:'hold',pid:running.child.pid,outcome:'unconfirmed'});
 assert.deepEqual(await readFile(join(f.directory,'state.json')),before);
 const blocked=await f.call(input('increment','blocked-increment'));assert.equal(blocked.value.error,'active-outcome-unconfirmed');
 const ended=await running.closed;assert.equal(ended.code,0);const result=JSON.parse(ended.stdout);assert.equal(result.counter,0);assert.equal(result.active,null);assert.equal(result.status,'completed');
 const replay=await f.call(input('hold','hold-request-0001',{holdMs:700}));assert.equal(replay.value.replayed,true);assert.equal((await f.state()).counter,0);
});

test('SIGKILL after durable hold intent leaves an unknown outcome that neither same nor new request can replay',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));
 const running=f.launch(input('hold','hold-interrupted',{holdMs:120000}));await f.waitRunning('hold-interrupted');
 running.child.kill('SIGKILL');const ended=await running.closed;assert.equal(ended.signal,'SIGKILL');assert.equal(ended.stdout,'');
 const before=await readFile(join(f.directory,'state.json'));
 const replay=await f.call(input('hold','hold-interrupted',{holdMs:120000}));assert.equal(replay.code,1);assert.equal(replay.value.error,'request-outcome-unknown');
 const alternate=await f.call(input('increment','another-request'));assert.equal(alternate.value.error,'active-outcome-unconfirmed');
 const observed=await f.call(input('read','observe-unknown'));assert.equal(observed.value.counter,0);assert.equal(observed.value.active.outcome,'unconfirmed');
 assert.equal(observed.value.active.pid,running.child.pid);assert.deepEqual(await readFile(join(f.directory,'state.json')),before);
});

test('concurrent mutations never double-dispatch one request and counter agrees with durable receipts',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));
 const children=Array.from({length:6},()=>f.launch(input('increment','concurrent-request')));const results=await Promise.all(children.map(c=>c.closed));
 const state=await f.state();assert.equal(state.counter,1);assert.equal(state.requests['concurrent-request'].status,'completed');
 assert.ok(results.some(result=>result.code===0));
 for(const result of results){const value=JSON.parse(result.stdout);assert.ok(value.status==='completed'||['mutation-locked','request-outcome-unknown'].includes(value.error));}
 assert.deepEqual(await readdir(f.directory),['state.json']);
});

test('intent owner waits for transient completion contention without replaying or stealing the lock',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));
 const running=f.launch(input('hold','completion-contention',{holdMs:500}));
 await f.waitRunning('completion-contention');
 const lock=join(f.directory,'.mutation-lock');await mkdir(lock);
 let completed=false;running.closed.then(()=>{completed=true;});
 // Retain the competing lock beyond the hold deadline. The owner must wait,
 // preserving both its durable intent and the competing process's lock.
 await new Promise(resolve=>setTimeout(resolve,700));
 assert.equal(completed,false);assert.ok((await stat(lock)).isDirectory());
 assert.equal((await f.state()).requests['completion-contention'].status,'running');
 await rmdir(lock);
 const result=await running.closed;assert.equal(result.code,0);
 assert.equal(JSON.parse(result.stdout).replayed,false);
 assert.equal((await f.state()).requests['completion-contention'].status,'completed');
 assert.deepEqual(await readdir(f.directory),['state.json']);
});

test('strict inputs reject arbitrary paths, fields, restore format and unbounded waits before creating storage',async t=>{
 const f=await fixture(t);
 const invalid=[input('initialize','bad'),input('initialize','valid-id-001',{directory:'/tmp/arbitrary'}),input('initialize','valid-id-001',{url:'https://example.com'}),
  input('initialize','valid-id-001',{restore:{schema:2,counter:0}}),input('initialize','valid-id-001',{restore:{schema:1,counter:-1}}),
  input('initialize','valid-id-001',{restore:{schema:1,counter:0,other:true}}),input('increment','valid-id-001',{restore:{schema:1,counter:0}}),
  input('read','valid-id-001',{holdMs:1}),input('hold','valid-id-001',{holdMs:120001}),input('hold','valid-id-001',{holdMs:0}),input('hold','valid-id-001',{holdMs:1.5})];
 for(const value of invalid){const result=await f.call(value);assert.equal(result.code,1);assert.equal(result.value.status,'rejected');}
 assert.deepEqual(await readdir(f.parent),[]);
});

test('corrupt state and symlink state are rejected without overwriting or executing an effect',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));await writeFile(join(f.directory,'state.json'),'broken-json');
 const corrupt=await f.call(input('increment','increment-0001'));assert.equal(corrupt.value.error,'invalid-state');assert.equal(await readFile(join(f.directory,'state.json'),'utf8'),'broken-json');
 const external=join(f.parent,'external.json');await writeFile(external,JSON.stringify({schema:1,initialized:true,counter:9,requests:{}}));
 await rm(join(f.directory,'state.json'));await symlink(external,join(f.directory,'state.json'));
 const linked=await f.call(input('increment','increment-0002'));assert.equal(linked.value.error,'invalid-state');assert.equal(JSON.parse(await readFile(external,'utf8')).counter,9);
});

test('stale mutation lock is never stolen, but atomic committed state remains readable',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));await mkdir(join(f.directory,'.mutation-lock'));
 const rejected=await f.call(input('increment','increment-0001'));assert.equal(rejected.value.error,'mutation-locked');
 const observed=await f.call(input('read','observe-0001'));assert.equal(observed.value.counter,0);assert.equal(observed.value.status,'observed');
 assert.ok((await readdir(f.directory)).includes('.mutation-lock'));
});

test('fixed read-only wire faults come from real processes and preserve committed state',async t=>{
 const f=await fixture(t);await f.call(input('initialize'));await f.call(input('increment','increment-0001'));
 const before=await readFile(join(f.directory,'state.json'));
 for(const fault of ['protocol','format']){
  const observed=await f.call(input('read','observe-fault-001',{fault}));assert.equal(observed.code,0);assert.equal(observed.value.status,'observed');
  assert.equal(observed.value.pid,observed.pid);assert.equal(observed.value.counter,1);
  assert.equal(observed.value.protocol,fault==='protocol'?'m0-unknown':'m0-v1');assert.equal(observed.value.format,fault==='format'?999:1);
 }
 for(const bad of [input('read','observe-fault-002',{fault:'arbitrary'}),input('increment','increment-0002',{fault:'protocol'}),input('hold','hold-fault-0001',{fault:'format'})]){
  const rejected=await f.call(bad);assert.equal(rejected.code,1);assert.equal(rejected.value.error,'invalid-fault');
 }
 assert.deepEqual(await readFile(join(f.directory,'state.json')),before);
});

test('CLI rejects malformed, excessive stdin and extra arguments with one fixed JSON error and no input echo',async t=>{
 const f=await fixture(t);
 for(const [value,args] of [['not-json-private-marker',[]],['x'.repeat(4097),[]],[input('read'),['--directory=/tmp/private-marker']]]){
  const result=await f.call(value,{cli:true,args});assert.equal(result.code,1);assert.equal(result.value.error,'invalid-cli-input');assert.ok(!result.stdout.includes('private-marker'));
 }
 assert.deepEqual(await readdir(f.parent),[]);
});
