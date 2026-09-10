import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SandboxTrustedPiHostPort, readCurrentObserverExecution, TRUSTED_PI_HOST_PROGRAM, TRUSTED_PI_NODE, type TrustedPiProcessView, type TrustedPiSandboxProcessApi } from '../../services/turn-runtime/pi-native.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2},encoder=new TextEncoder();
const actor={userId:'user-a',authVersion:1};
function snapshot(sessionId='session-a'){return encoder.encode(JSON.stringify({format:'riffology-pi-session-v1',scope:{tenantId:'tenant-a',projectId:'project-a',sessionId},createdAt:'2026-09-07T00:00:00.000Z',entries:[],leafId:null}));}
const checkpoint={revisionId:'revision-a',objectKey:'turns/tenant-a/project-a/workspace-a/2/session-a/previous/dispatch.json',filesSha256:'a'.repeat(64),sessionSha256:createHash('sha256').update(snapshot()).digest('hex'),committedAt:1};
const base={workspace:checkpoint,session:checkpoint};
const input=(message='Build model')=>({...identity,actor,message,base});
async function digest(bytes:Uint8Array){const value=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
class Process implements TrustedPiProcessView{id:string;status='running';exitCode?:number;kills=0;statusReads=0;killCompletes=true;onStatus?:()=>void;constructor(id:string){this.id=id;}async getStatus(){this.statusReads++;this.onStatus?.();return this.status;}async kill(){this.kills++;if(this.killCompletes){this.status='completed';this.exitCode=0;}}}
class Sandbox implements TrustedPiSandboxProcessApi{
  clock:()=>number=()=>1003;
  queryObserverExecution(identity:TurnRuntimeIdentity){return readCurrentObserverExecution(this,identity,this.clock);}
  files=new Map<string,string>();process:Process|null=null;starts=0;writes=0;reads=0;destroys=0;releaseRunning=false;loseStart=false;lastCommand='';lastOptions:any;onRead?:(path:string,read:number)=>void;onGetProcess?:()=>void;
  async writeFile(path:string,content:string){this.writes++;this.files.set(path,content);return {success:true,path};}
  async readFile(path:string){this.reads++;this.onRead?.(path,this.reads);const content=this.files.get(path);if(content===undefined)throw Error('ENOENT not found');return {success:true,path,content};}
  async startProcess(command:string,options:any){this.starts++;this.lastCommand=command;this.lastOptions=options;this.process=new Process(options.processId);if(this.loseStart)throw Error('lost-native-start-response');return this.process;}
  async getProcess(id:string){this.onGetProcess?.();return this.process?.id===id?this.process:null;}
  async destroy(){this.destroys++;}
  async releaseState(){return {running:this.releaseRunning};}
  prefix(){const control=[...this.files.keys()].find(key=>key.endsWith('.control.json'));assert.ok(control);return control.slice(0,-'.control.json'.length);}
  running(){const prefix=this.prefix();this.files.set(`${prefix}.result.json`,JSON.stringify({schemaVersion:1,identity,phase:'running',outcome:null,executionErrorCode:null,events:[],outputSessionSha256:null}));}
  async settle(outcome:'completed'|'failed'|'cancelled'|'interrupted'='completed',output=snapshot()){
    const prefix=this.prefix(),sessionSha=await digest(output);this.files.set(`${prefix}.output-session.json`,Buffer.from(output).toString('base64'));this.files.set(`${prefix}.result.json`,JSON.stringify({schemaVersion:1,identity,phase:'terminal',outcome,executionErrorCode:outcome==='completed'?null:'fixture-failure',events:[{sequence:1,at:1002,kind:'assistant.message',text:'done',stopReason:'stop'}],outputSessionSha256:sessionSha}));if(this.process){this.process.status='completed';this.process.exitCode=0;}
  }
}
function fixture(input:Uint8Array|null=snapshot(),clock:()=>number=()=>1003){const sandbox=new Sandbox();sandbox.clock=clock;let loads=0;const host=new SandboxTrustedPiHostPort(sandbox,{async load(){loads++;return input;}},clock);return {sandbox,host,get sessionLoads(){return loads;}};}

test('writes scoped session and control before one fixed Trusted Pi process start',async()=>{
  assert.equal(TRUSTED_PI_HOST_PROGRAM,'/opt/riffology/trusted-pi/trusted-pi-turn-host.mjs');
  const f=fixture(),first=await f.host.start(input());assert.equal(first.phase,'starting');assert.equal(f.sandbox.starts,1);assert.match(f.sandbox.lastCommand,new RegExp(`^${TRUSTED_PI_NODE} ${TRUSTED_PI_HOST_PROGRAM} [a-f0-9]{52}$`));assert.equal(f.sandbox.lastOptions.autoCleanup,false);assert.deepEqual(f.sandbox.lastOptions.env,{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'});
  const prefix=f.sandbox.prefix(),control=JSON.parse(f.sandbox.files.get(`${prefix}.control.json`)!);assert.deepEqual(control.identity,identity);assert.deepEqual(control.actor,actor);assert.equal(control.message,'Build model');assert.match(control.inputSessionSha256,/^[a-f0-9]{64}$/);assert.ok(f.sandbox.files.has(`${prefix}.input-session.json`));
  assert.equal((await f.host.start(input())).phase,'starting');assert.equal(f.sandbox.starts,1);
});

test('lost native start response is recovered only by observing the same process',async()=>{
  const f=fixture();f.sandbox.loseStart=true;await assert.rejects(f.host.start(input()),/lost-native-start-response/);assert.equal(f.sandbox.starts,1);f.sandbox.loseStart=false;assert.equal((await f.host.observe(identity)).phase,'starting');assert.equal(f.sandbox.starts,1);
});

test('terminal result requires exited process and matching frozen session digest',async()=>{
  const f=fixture();await f.host.start(input());await f.sandbox.settle();const terminal=await f.host.observe(identity);assert.equal(terminal.phase,'terminal');assert.equal(terminal.outcome,'completed');assert.deepEqual(terminal.stopped,{confirmationId:terminal.stopped!.confirmationId,observedAt:1003,nativeRunning:false,fenced:true});assert.deepEqual(await f.host.frozenSession(identity),snapshot());
  const bad=fixture();await bad.host.start(input());await bad.sandbox.settle('completed',snapshot('session-b'));await assert.rejects(bad.host.observe(identity),/scope-denied/);
});

test('terminal file while process runs fails closed and nonzero exit is unknown',async()=>{
  const f=fixture();await f.host.start(input());await f.sandbox.settle();f.sandbox.process!.status='running';f.sandbox.process!.exitCode=undefined;await assert.rejects(f.host.observe(identity),/terminal-process-running/);
  f.sandbox.process!.status='failed';f.sandbox.process!.exitCode=7;assert.equal((await f.host.observe(identity)).phase,'unknown');
});

test('terminal files without a process registry entry cannot prove native stop',async()=>{
  const f=fixture();await f.host.start(input());await f.sandbox.settle();f.sandbox.process=null;
  const observation=await f.host.observe(identity);assert.equal(observation.phase,'unknown');assert.equal(observation.stopped,null);
  await assert.rejects(f.host.frozenSession(identity),/not-frozen/);
});

test('cancel signals the existing process once and accepts only its cancelled terminal file',async()=>{
  const f=fixture();await f.host.start(input());await f.sandbox.settle('cancelled');f.sandbox.process!.status='running';f.sandbox.process!.exitCode=undefined;const cancelled=await f.host.cancel(identity);assert.equal(f.sandbox.process!.kills,1);assert.equal(cancelled.phase,'terminal');assert.equal(cancelled.outcome,'cancelled');
});

test('cancel remains nonterminal while SIGTERM drains and later observe proves the same process stopped',async()=>{
  const f=fixture();await f.host.start(input());f.sandbox.process!.killCompletes=false;
  const draining=await f.host.cancel(identity);assert.equal(draining.phase,'starting');assert.equal(draining.outcome,null);assert.equal(draining.stopped,null);assert.equal(f.sandbox.process!.kills,1);
  assert.equal((await f.host.observe(identity)).phase,'starting');assert.equal(f.sandbox.process!.kills,1);
  await f.sandbox.settle('cancelled');const terminal=await f.host.observe(identity);assert.equal(terminal.phase,'terminal');assert.equal(terminal.outcome,'cancelled');assert.equal(terminal.stopped?.nativeRunning,false);assert.equal(f.sandbox.process!.kills,1);
});

test('cross-session restore and changed immutable start payload fail before a second process',async()=>{
  const denied=fixture(snapshot('session-b'));await assert.rejects(denied.host.start(input()),/scope-denied/);assert.equal(denied.sandbox.files.size,0);assert.equal(denied.sandbox.starts,0);
  const f=fixture();await f.host.start(input());await assert.rejects(f.host.start(input('Changed')),/control-conflict/);assert.equal(f.sandbox.starts,1);
});

test('genesis and restored session bytes must exactly match the claimed base checkpoint',async()=>{
  const genesis=fixture(null);await genesis.host.start({...identity,actor,message:'Genesis',base:{workspace:null,session:null}});assert.equal([...genesis.sandbox.files.keys()].some(key=>key.endsWith('.input-session.json')),false);
  const unexpected=fixture();await assert.rejects(unexpected.host.start({...identity,actor,message:'Genesis',base:{workspace:null,session:null}}),/session-base-mismatch/);assert.equal(unexpected.sandbox.starts,0);
  const changed=encoder.encode(JSON.stringify({format:'riffology-pi-session-v1',scope:{tenantId:'tenant-a',projectId:'project-a',sessionId:'session-a'},createdAt:'2026-09-07T00:00:00.000Z',entries:[{type:'message'}],leafId:null})),mismatch=fixture(changed);
  await assert.rejects(mismatch.host.start(input()),/session-base-mismatch/);assert.equal(mismatch.sandbox.starts,0);
});

test('observe never creates a process and empty native state is absent',async()=>{const f=fixture();assert.equal((await f.host.observe(identity)).phase,'absent');assert.equal(f.sandbox.starts,0);});

test('explicit cancel settles an absent native execution as an interrupted fenced stop',async()=>{
  const f=fixture(),cancelled=await f.host.cancel(identity);
  assert.equal(cancelled.phase,'terminal');assert.equal(cancelled.outcome,'interrupted');assert.equal(cancelled.executionErrorCode,'turn-native-execution-absent');
  assert.deepEqual(cancelled.events,[]);assert.equal(cancelled.stopped?.nativeRunning,false);assert.equal(cancelled.stopped?.fenced,true);assert.equal(f.sandbox.starts,0);
  assert.deepEqual(await f.host.cancel(identity),cancelled);
});

test('release destroys only the identity-bound Sandbox and reports its post-destroy running state',async()=>{
  const f=fixture();assert.deepEqual(await f.host.release(identity),{running:false});assert.equal(f.sandbox.destroys,1);
  f.sandbox.releaseRunning=true;assert.deepEqual(await f.host.release(identity),{running:true});assert.equal(f.sandbox.destroys,2);
  await assert.rejects(f.host.release({...identity,dispatchId:''}),/turn-identifier/);assert.equal(f.sandbox.destroys,2);
});

test('schema 2 control is persisted and native start receives the remaining timeout',async()=>{
  const f=fixture();await f.host.start({...input(),executionDeadlineAt:1103});
  const control=JSON.parse(f.sandbox.files.get(`${f.sandbox.prefix()}.control.json`)!);
  assert.equal(control.schemaVersion,2);assert.equal(control.executionDeadlineAt,1103);assert.equal(f.sandbox.lastOptions.timeout,100);
});

test('expired deadline is rejected before any native state is written',async()=>{
  const f=fixture();await assert.rejects(f.host.start({...input(),executionDeadlineAt:1003}),/trusted-pi-execution-expired/);
  assert.equal(f.sandbox.writes,0);assert.equal(f.sandbox.starts,0);assert.equal(f.sessionLoads,0);
});

test('deadline expiry after control write rejects before a zero-timeout process start',async()=>{
  let reads=0;const f=fixture(snapshot(),()=>reads++<2?1003:1103);
  await assert.rejects(f.host.start({...input(),executionDeadlineAt:1103}),/trusted-pi-execution-expired/);
  assert.equal(f.sandbox.starts,0);assert.ok([...f.sandbox.files.keys()].some(key=>key.endsWith('.control.json')));assert.equal(f.sandbox.writes,2);
});

test('unchanged schema 2 deadline replay observes the existing process without a new start',async()=>{
  const f=fixture(),request={...input(),executionDeadlineAt:1103};await f.host.start(request);const writes=f.sandbox.writes;
  assert.equal((await f.host.start(request)).phase,'starting');assert.equal(f.sandbox.starts,1);assert.equal(f.sandbox.writes,writes);assert.equal(f.sessionLoads,2);
});

test('observer refuses an ordinary SDK without a dedicated reader before native I/O',async()=>{
  let calls=0;const forbidden=async()=>{calls++;throw Error('ordinary-sdk-called');};
  const host=new SandboxTrustedPiHostPort({writeFile:forbidden,readFile:forbidden,startProcess:forbidden,getProcess:forbidden,destroy:forbidden,releaseState:forbidden},{load:forbidden},()=>1003);
  await assert.rejects(host.currentObserverExecution(identity),/observer-reader-required/);assert.equal(calls,0);
});

test('legacy schema 1 control cannot establish observer execution authority',async()=>{
  const f=fixture();await f.host.start(input());await assert.rejects(f.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
});

test('observer execution requires real starting, absent, or terminal state to be rejected',async()=>{
  const absent=fixture();await assert.rejects(absent.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
  const starting=fixture();await starting.host.start({...input(),executionDeadlineAt:1103});await assert.rejects(starting.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
  const terminal=fixture();await terminal.host.start({...input(),executionDeadlineAt:1103});await terminal.sandbox.settle();await assert.rejects(terminal.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
});

test('read-only observer query returns the exact persisted deadline and denies at expiry',async()=>{
  let now=1003;const f=fixture(snapshot(),()=>now),request={...input(),executionDeadlineAt:1103};await f.host.start(request);f.sandbox.running();
  const writes=f.sandbox.writes,starts=f.sandbox.starts,loads=f.sessionLoads;assert.deepEqual(await f.host.currentObserverExecution(identity),{expiresAt:1103});
  assert.equal(f.sandbox.writes,writes);assert.equal(f.sandbox.starts,starts);assert.equal(f.sessionLoads,loads);
  now=1103;await assert.rejects(f.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);assert.equal(f.sandbox.writes,writes);assert.equal(f.sandbox.starts,starts);assert.equal(f.sessionLoads,loads);
});

test('observer query fails closed when awaited process status reaches the deadline',async()=>{
  let now=1003;const f=fixture(snapshot(),()=>now),request={...input(),executionDeadlineAt:1103};await f.host.start(request);f.sandbox.running();f.sandbox.process!.onStatus=()=>{now=1103;};
  await assert.rejects(f.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
});

test('observer query fails closed when the persisted control changes during the read sequence',async()=>{
  const f=fixture(snapshot(),()=>1003),request={...input(),executionDeadlineAt:1103};await f.host.start(request);
  f.sandbox.running();f.sandbox.onGetProcess=()=>{const key=`${f.sandbox.prefix()}.control.json`;const changed=JSON.parse(f.sandbox.files.get(key)!);changed.executionDeadlineAt=1104;f.sandbox.files.set(key,JSON.stringify(changed));};
  await assert.rejects(f.host.currentObserverExecution(identity),/trusted-pi-observer-denied/);
});

test('native adapter imports no M0 provider, token or probe implementation',async()=>{const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../services/turn-runtime/pi-native.ts',import.meta.url),'utf8'));assert.doesNotMatch(source,/proxy-pi|go-pi-probe|m0-|providerDefinitions|resolveCredential|globalThis\.fetch/);});
