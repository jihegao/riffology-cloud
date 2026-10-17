import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {ProjectViewRuntimeCore,type ProjectViewNativePort,type ProjectViewNativeSession,type ProjectViewRuntimeStorage} from '../../services/project-views/runtime-core.ts';
import {projectViewRuntimeCommand,projectViewRuntimeDigest,projectViewRuntimeIdentity,projectViewRuntimeStart,runtimeActorName,type ProjectViewCapacityPort,type ProjectViewRuntimeStart} from '../../services/project-views/runtime-protocol.ts';

const encoder=new TextEncoder();
const sha=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function input():Promise<ProjectViewRuntimeStart>{
 const html='<!doctype html><p>Frozen page</p>',view={id:'home',title:'Home',entrypoint:'app/home.html'};
 const body={schema:'project.view-package/v1' as const,scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},revisionId:'revision-a',filesSha256:'a'.repeat(64),manifest:{schema:'project.views/v1' as const,files:['app/home.html'],views:[view]},assets:[{path:'app/home.html',mediaType:'text/html',base64:btoa(html),sourceSha256:await sha(html),sha256:await sha(html)}]};
 const packageIdentity=await projectViewRuntimeDigest(body);
 return {identity:{schema:'project.view-session/v1',sessionId:'session-a',operationId:'operation-a',scope:body.scope,actor:{userId:'owner-a',authVersion:1},packageIdentity,viewId:'home',policyHash:'b'.repeat(64)},pkg:{...body,packageIdentity},view,expiresAt:201000};
}
function deferred(){let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(condition:()=>boolean){for(let n=0;n<30&&!condition();n++)await tick();assert.ok(condition(),'expected asynchronous boundary was reached');}

function fixture(t:{after(fn:()=>void):void}){
 const db=new DatabaseSync(':memory:');let alarm:number|null=null,now=1000,running=false,starts=0,destroys=0,closes=0,acquires=0,releases=0,occupied=false,released=false,failDestroy=false,failRelease=false;
 let startGate:ReturnType<typeof deferred>|null=null,acquireGate:ReturnType<typeof deferred>|null=null;
 const finished=deferred(),commands:unknown[]=[];let messages:unknown[]=[{type:'installed'}];
 const session:ProjectViewNativeSession={async send(command){commands.push(command);},poll(){const value={messages};messages=[];return value;},async close(){closes++;},finished:finished.promise};
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){},async setAlarm(at:number){alarm=at;},async deleteAlarm(){alarm=null;}} as unknown as ProjectViewRuntimeStorage;
 const native:ProjectViewNativePort={async start(){starts++;if(startGate)await startGate.promise;running=true;return session;},async running(){return running;},async destroy(){destroys++;if(failDestroy)throw Error('unavailable');running=false;}};
 let core!:ProjectViewRuntimeCore;
 const capacity:ProjectViewCapacityPort={
  async acquire(request){acquires++;assert.equal((await core.status({identity:request.identity})).status,'starting','start intent must be durable before acquire callback');if(acquireGate)await acquireGate.promise;if(released)throw Error('terminal-tombstone');occupied=true;},
  async release(request){releases++;const actual=await core.status({identity:request.identity});assert.equal(actual.status,'closed');assert.equal(actual.cleanupConfirmed,true);assert.equal(actual.cleanupProofId,request.proof.proofId);if(failRelease)throw Error('lost-ack');released=true;occupied=false;},
 };
 const create=()=>new ProjectViewRuntimeCore(storage,native,capacity,{clock:()=>now,startupMs:200,rpcMs:50,retryMs:5,assignmentGuardMs:100,quietMs:10});
 core=create();
 t.after(()=>db.close());
 return {storage,native,capacity,create,get core(){return core;},set core(value:ProjectViewRuntimeCore){core=value;},get now(){return now;},set now(value:number){now=value;},get alarm(){return alarm;},get starts(){return starts;},get destroys(){return destroys;},get closes(){return closes;},get acquires(){return acquires;},get releases(){return releases;},get occupied(){return occupied;},get running(){return running;},set running(value:boolean){running=value;},set failDestroy(value:boolean){failDestroy=value;},set failRelease(value:boolean){failRelease=value;},set startGate(value:ReturnType<typeof deferred>){startGate=value;},set acquireGate(value:ReturnType<typeof deferred>){acquireGate=value;},finished,commands,record(){return JSON.parse((db.prepare('SELECT value FROM project_view_runtime WHERE singleton=1').get() as {value:string}).value);}};
}

test('one frozen start, repeated request preserves original expiry, lookup is owner-only, and proof precedes release',async t=>{
 const f=fixture(t),v=await input();assert.equal(runtimeActorName(v.identity.sessionId),'project-view-session-a');
 const started=await f.core.start(v);assert.equal(started.status,'running');assert.equal(started.cleanupProofId,null);assert.equal(f.occupied,true);
 f.now+=50;assert.equal((await f.core.start({...v,expiresAt:v.expiresAt+50})).status,'running');assert.equal(f.record().expiresAt,v.expiresAt);assert.equal(f.starts,1);assert.equal(f.acquires,1);
 assert.deepEqual(await f.core.lookup({sessionId:v.identity.sessionId,actor:{...v.identity.actor,authVersion:2},workspaceId:v.identity.scope.workspaceId}),v.identity);
 assert.equal(await f.core.lookup({sessionId:v.identity.sessionId,actor:{userId:'other-owner',authVersion:1},workspaceId:v.identity.scope.workspaceId}),null);
 assert.deepEqual(await f.core.command({identity:v.identity,command:{type:'poll'}}),{messages:[{type:'installed'}]});
 assert.deepEqual(await f.core.command({identity:v.identity,command:{type:'input',event:{kind:'wheel',deltaY:.25}}}),{messages:[]});assert.equal(f.commands.length,1);
 assert.deepEqual(await f.core.close({identity:v.identity,reason:'user-closed'}),{closed:true,cleanupConfirmed:true});assert.equal(f.running,false);assert.equal(f.occupied,false);assert.match((await f.core.status({identity:v.identity})).cleanupProofId!,/^view-release-[a-f0-9]{64}$/);
 assert.equal((await f.core.start({...v,expiresAt:v.expiresAt+100})).status,'closed');assert.equal(f.starts,1);assert.equal(f.alarm,null);
 await assert.rejects(f.core.status({identity:{...v.identity,scope:{...v.identity.scope,projectId:'foreign'}}}),/identity-denied/);
});

test('tampered package, mismatched generation and write-like input do not reach native/capacity',async t=>{
 const f=fixture(t),v=await input();
 await assert.rejects(f.core.start({...v,pkg:{...v.pkg,assets:[{...v.pkg.assets[0]!,base64:btoa('different')}]}}),/input-denied/);
 await assert.rejects(f.core.start({...v,identity:{...v.identity,scope:{...v.identity.scope,workspaceGeneration:2}}}),/input-denied/);
 assert.throws(()=>projectViewRuntimeIdentity({...v.identity,extra:'scope'}),/input-denied/);
 assert.throws(()=>projectViewRuntimeCommand({type:'input',event:{kind:'key',key:'Control+L'}}),/input-denied/);
 assert.throws(()=>projectViewRuntimeCommand({type:'save',path:'/etc/token'}),/input-denied/);
 await assert.rejects(projectViewRuntimeStart({...v,view:{...v.view,entrypoint:'app/missing.html'}}),/input-denied/);
 assert.equal(f.starts,0);assert.equal(f.acquires,0);
});

test('cold reconstruction fences the original actor and retains capacity through delayed assignment and quiet proof',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.core=f.create();
 assert.equal((await f.core.status({identity:v.identity})).status,'running','status callback is read-only');assert.equal(f.destroys,0);
 await f.core.recover();assert.equal(f.starts,1);assert.equal(f.running,false);assert.equal(f.occupied,true);assert.equal((await f.core.status({identity:v.identity})).cleanupConfirmed,false);
 f.now=1050;f.running=true;await f.core.alarm();assert.equal(f.running,false);assert.equal(f.occupied,true);
 f.now=1101;await f.core.alarm();assert.equal(f.occupied,false);assert.equal((await f.core.status({identity:v.identity})).status,'closed');assert.equal(f.starts,1);assert.ok(f.destroys>=3);
});

test('close before acquire ACK creates terminal capacity proof and a late acquire cannot launch',async t=>{
 const f=fixture(t),v=await input(),gate=deferred();f.acquireGate=gate;
 const starting=f.core.start(v);await until(()=>f.acquires===1);
 await f.core.close({identity:v.identity,reason:'user-closed'});assert.equal(f.starts,0);assert.equal(f.releases,1);
 gate.resolve();assert.equal((await starting).status,'closed');assert.equal(f.starts,0);assert.equal(f.occupied,false);
});

test('close during native preparation blocks late output and destroys the same late original start',async t=>{
 const f=fixture(t),v=await input(),gate=deferred();f.startGate=gate;
 const starting=f.core.start(v);await until(()=>f.starts===1);
 assert.deepEqual(await f.core.close({identity:v.identity,reason:'user-closed'}),{closed:true,cleanupConfirmed:false});assert.equal(f.occupied,true);
 gate.resolve();await starting;assert.equal(f.running,false);assert.equal(f.starts,1);
 assert.deepEqual(await f.core.command({identity:v.identity,command:{type:'poll'}}),{closed:true,cleanupConfirmed:false});
 f.now=1110;await f.core.alarm();assert.equal(f.occupied,false);assert.equal(f.starts,1);
});

test('unknown destroy retains capacity and original alarm; successful original retry supplies proof',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.failDestroy=true;
 assert.deepEqual(await f.core.close({identity:v.identity,reason:'revoked'}),{closed:true,cleanupConfirmed:false});assert.equal((await f.core.status({identity:v.identity})).status,'unknown');assert.equal(f.occupied,true);assert.notEqual(f.alarm,null);
 f.failDestroy=false;await f.core.alarm();assert.equal(f.occupied,false);assert.equal(f.starts,1);
});

test('idle expiry closes rather than silently extending the original session',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.now=11001;await f.core.alarm();
 assert.deepEqual(await f.core.command({identity:v.identity,command:{type:'poll'}}),{closed:true,cleanupConfirmed:true});assert.equal(f.starts,1);assert.equal(f.occupied,false);
});

test('capacity release lost ACK preserves one durable proof and retries it after reconstruction',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.failRelease=true;await f.core.close({identity:v.identity,reason:'user-closed'});
 const proof=(await f.core.status({identity:v.identity})).cleanupProofId;assert.ok(proof);assert.equal(f.occupied,true);assert.notEqual(f.alarm,null);
 f.failRelease=false;f.core=f.create();await f.core.recover();assert.equal((await f.core.status({identity:v.identity})).cleanupProofId,proof);assert.equal(f.occupied,false);assert.equal(f.starts,1);
});

test('transient cold-recovery storage failure retries original cleanup without extending the persisted guard',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.core=f.create();
 const sync=f.storage.sync.bind(f.storage);let first=true;
 f.storage.sync=async()=>{if(first){first=false;throw Error('transient-storage-sync');}await sync();};
 await assert.rejects(f.core.recover(),/transient-storage-sync/);
 const begun=f.record().closeBeganAt,guard=f.record().guardUntil;assert.equal(begun,1000);assert.equal(guard,1100);assert.equal(f.occupied,true);
 f.now=1050;await f.core.alarm();assert.equal(f.record().closeBeganAt,begun);assert.equal(f.record().guardUntil,guard);assert.equal(f.running,false);assert.equal(f.occupied,true);
 f.now=1110;await f.core.alarm();assert.equal(f.occupied,false);assert.equal(f.starts,1);assert.equal((await f.core.status({identity:v.identity})).status,'closed');
});

test('browser failure closes the original runtime and never executes a replacement',async t=>{
 const f=fixture(t),v=await input();await f.core.start(v);f.finished.reject(Error('untrusted output'));await until(()=>!f.occupied);
 assert.equal((await f.core.status({identity:v.identity})).status,'closed');assert.equal(f.starts,1);assert.equal(f.running,false);
});
