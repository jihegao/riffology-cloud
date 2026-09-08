import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeCore, checkpointKey, type NativeRuntimePort } from '../../services/runtime/core.ts';
import { initialFiles, initialCheckpoint } from '../../services/runtime/starter.ts';
import type { RuntimeInitialize } from '../../services/workspace/protocol.ts';
import type { QuotaStorage, Acquisition } from '../../services/quota/core.ts';
import { ModelContentError, type ModelContentPort } from '../../services/runtime/content.ts';

const input:RuntimeInitialize={task:{id:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,
  starterVersion:'blank-v1',authVersion:1,createdAt:1000,deadlineAt:10000},
 identity:{taskId:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,runtimeId:'runtime-a',leaseId:'lease-a'},markerNonce:'nonce-a'};
function fixture(t:{after(fn:()=>void):void}) {
 const directory=mkdtempSync(join(tmpdir(),'m1-runtime-')),filename=join(directory,'runtime.sqlite');let db=new DatabaseSync(filename);
 let now=2000,running=false,starts=0,installs=0,destroys=0,puts=0,lastProgram:string|null=null,lastManifest:unknown=null,lastContent:unknown=null,files:Record<string,string>|null=null,permitted=true,putFault:'none'|'before'|'after'='none',destroyFault=false,installHook:((attempt:number)=>void|Promise<void>)|null=null;
 let beforeAuthorize:(()=>Promise<void>)|null=null,beforeSync:(()=>Promise<void>)|null=null;
 const data=new Map<string,string>();
 const storage={sql:{exec(query:string,...values:(string|number|null)[]){const statement=db.prepare(query);
   const rows=statement.columns().length?statement.all(...values):(statement.run(...values),[]);return {toArray:()=>rows};}},
   async sync(){if(beforeSync)await beforeSync();},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}} as unknown as QuotaStorage;
 const native:NativeRuntimePort={get running(){return running;},start(program){lastProgram=program;starts++;running=true;},async installContent(content){installs++;lastContent=content;if(installHook)await installHook(installs);},async inspectFiles(manifest){lastManifest=manifest??null;return files;},async destroy(){destroys++;if(destroyFault)throw Error('lost-destroy');running=false;}};
 const authority={async verifyTask(){if(beforeAuthorize)await beforeAuthorize();return permitted;},async lookup():Promise<Acquisition>{return {outcome:'replayed',denial:null,lease:{...input.task,tenantId:input.task.tenantId,projectId:input.task.projectId,workspaceId:input.task.workspaceId,generation:1,operation:'workspace-runtime',operationId:input.task.id,deadlineAt:input.task.deadlineAt,leaseId:'lease-a',status:'dispatched',acquiredAt:1001,dispatchedAt:1002,unknownAt:null,stoppedAt:null,confirmation:null,expired:false}};}};
 const host=(content:ModelContentPort|null=null)=>new RuntimeCore(storage,native,{async read(key){return data.get(key)??null;},async putOnce(key,value){puts++;if(putFault==='before')throw Error('unknown-put');data.set(key,value);if(putFault==='after')throw Error('lost-put-ack');}},authority,()=>now,content);
 t.after(()=>{db.close();rmSync(directory,{recursive:true});});
 return {host,data,get starts(){return starts;},get installs(){return installs;},get destroys(){return destroys;},get puts(){return puts;},get running(){return running;},get lastProgram(){return lastProgram},get lastManifest(){return lastManifest},get lastContent(){return lastContent},
  complete(){files=initialFiles(input);},corrupt(){files={...initialFiles(input),'README.md':'corrupt'};},revoke(){permitted=false;},
  onInstall(hook:(attempt:number)=>void|Promise<void>){installHook=hook;},
  advance(value:number){now=value;},putFault(value:typeof putFault){putFault=value;},destroyFault(value:boolean){destroyFault=value;},
  blockAuthorize(fn:()=>Promise<void>){beforeAuthorize=fn;},blockSync(fn:(()=>Promise<void>)|null){beforeSync=fn;},
  nativeStopped(){running=false;},reopen(){db.close();db=new DatabaseSync(filename);}};
}
test('runtime requires observed real files, immutable checkpoint, native stop and survives actual SQLite reopen',async t=>{
 const f=fixture(t),h=f.host();assert.equal((await h.initialize(input)).ready,null);assert.equal(f.starts,1);
 f.complete();const ready=await h.observe(input.identity);assert.equal(ready.phase,'runtime_ready');assert.ok(ready.ready);
 const persisted=await initialCheckpoint(input);assert.equal(f.data.get(checkpointKey(input.identity)),persisted.text);assert.equal(ready.ready.checkpointRevision,persisted.revision);
 f.advance(3000);const stop=await h.stop(input.identity);assert.equal(stop.phase,'stopped');assert.equal(f.running,false);assert.ok(stop.stop);
 f.reopen();const next=f.host();assert.deepEqual(await next.initialize(input),stop);assert.equal(f.starts,1);assert.equal(f.puts,1);
});
test('stop before initialize permanently fences late starts, including across SQLite reopen',async t=>{
 const f=fixture(t);const stopped=await f.host().stop(input.identity);assert.equal(stopped.stop?.fenced,true);
 f.reopen();assert.equal((await f.host().initialize(input)).phase,'stopped');assert.equal(f.starts,0);
});
test('stop racing authority await prevents late start without releasing an active process',async t=>{
 const f=fixture(t);let unblock!:()=>void;const waiting=new Promise<void>(resolve=>{unblock=resolve;});f.blockAuthorize(()=>waiting);
 const h=f.host(),init=h.initialize(input);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await h.stop(input.identity)).phase,'stopped');unblock();assert.equal((await init).phase,'stopped');assert.equal(f.starts,0);
});
test('disk reservation and lost sync acknowledgment never permit initialize replay',async t=>{
 const f=fixture(t);f.blockSync(async()=>{throw Error('lost-sync');});await assert.rejects(f.host().initialize(input),/lost-sync/);
 f.blockSync(null);f.reopen();await f.host().initialize(input);assert.equal(f.starts,0);
});
test('revocation and deadline deny first native start',async t=>{
 const f=fixture(t);f.revoke();assert.equal((await f.host().initialize(input)).failureCode,'scope-denied');assert.equal(f.starts,0);
});
test('a frozen model reference cannot fall through to the blank starter before content materialization exists',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'r2://models/queue/2.1.0.tar',contentSha256:'d'.repeat(64)}}};
 const observation=await f.host().initialize(modelInput);
 assert.equal(observation.phase,'failed');assert.equal(observation.failureCode,'unsupported-starter');assert.equal(f.starts,0);assert.equal(f.puts,0);
});
test('content verification failures close before native start and preserve no blank checkpoint',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.tar',contentSha256:'d'.repeat(64)}}};
 const content:ModelContentPort={async resolve(){throw new ModelContentError('model-content-mismatch');}};
 const observation=await f.host(content).initialize(modelInput);
 assert.equal(observation.phase,'failed');assert.equal(observation.failureCode,'model-content-mismatch');assert.equal(f.starts,0);assert.equal(f.puts,0);
});
test('verified model package reaches native start with the same receipt and files',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.tar',contentSha256:'d'.repeat(64)}}};
 const content={receipt:{...modelInput.task.modelContent!,namespace:'model-content' as const,bytes:1,verifiedSha256:modelInput.task.modelContent!.contentSha256,fileCount:1,contentBytes:1},manifest:{schemaVersion:1 as const,files:[{path:'model/main.py',bytes:1,sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'}]},files:{'model/main.py':new Uint8Array([97])}};
 const observation=await f.host({async resolve(){return content;}}).initialize(modelInput);
 assert.equal(observation.phase,'pending');assert.equal(observation.failureCode,null);assert.equal(f.starts,1);assert.equal(f.installs,1);assert.doesNotMatch(f.lastProgram!,/modelFiles|YQ==/);assert.deepEqual(f.lastContent,content);assert.deepEqual(f.lastManifest,content.manifest);
 f.complete();const ready=await f.host({async resolve(){throw Error('must-not-resolve');}}).observe(modelInput.identity);assert.equal(ready.phase,'runtime_ready');assert.equal(ready.ready?.modelContent?.contentSha256,modelInput.task.modelContent!.contentSha256);assert.equal(ready.ready?.modelContent?.fileCount,1);
 const checkpoint=await initialCheckpoint(modelInput,content.receipt);assert.equal(f.data.get(checkpointKey(modelInput.identity)),checkpoint.text);
});
test('content resolution and native materialization are not repeated after a lost initialize response or reopen',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.tar',contentSha256:'d'.repeat(64)}}};
 const content={receipt:{...modelInput.task.modelContent!,namespace:'model-content' as const,bytes:1,verifiedSha256:modelInput.task.modelContent!.contentSha256,fileCount:1,contentBytes:1},manifest:{schemaVersion:1 as const,files:[{path:'model/main.py',bytes:1,sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'}]},files:{'model/main.py':new Uint8Array([97])}}; let resolves=0;
 const port={async resolve(){resolves++;return content;}}; assert.equal((await f.host(port).initialize(modelInput)).phase,'pending'); assert.equal(resolves,1); f.complete();f.reopen(); assert.equal((await f.host(port).initialize(modelInput)).phase,'runtime_ready'); assert.equal(resolves,1); assert.equal(f.starts,1);assert.equal(f.installs,1);
});
test('a lost install response is recovered by file observation without reinstalling',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.json',contentSha256:'d'.repeat(64)}}};
 const content={receipt:{...modelInput.task.modelContent!,namespace:'model-content' as const,bytes:1,verifiedSha256:modelInput.task.modelContent!.contentSha256,fileCount:1,contentBytes:1},manifest:{schemaVersion:1 as const,files:[{path:'model/main.py',bytes:1,sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'}]},files:{'model/main.py':new Uint8Array([97])}};let resolves=0;
 f.onInstall(attempt=>{if(attempt===1){f.complete();throw Error('lost-install-response');}});
 const port={async resolve(){resolves++;return content;}};
 assert.equal((await f.host(port).initialize(modelInput)).phase,'unknown');
 f.reopen();const recovered=await f.host(port).observe(modelInput.identity);
 assert.equal(recovered.phase,'runtime_ready');assert.equal(f.starts,1);assert.equal(f.installs,1);assert.equal(resolves,1);
});
test('a partial install is reconciled from the same frozen package without restarting native runtime',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.json',contentSha256:'d'.repeat(64)}}};
 const content={receipt:{...modelInput.task.modelContent!,namespace:'model-content' as const,bytes:1,verifiedSha256:modelInput.task.modelContent!.contentSha256,fileCount:1,contentBytes:1},manifest:{schemaVersion:1 as const,files:[{path:'model/main.py',bytes:1,sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'}]},files:{'model/main.py':new Uint8Array([97])}};let resolves=0;
 f.onInstall(attempt=>{if(attempt===1)throw Error('partial-install');f.complete();});const port={async resolve(){resolves++;return content;}};
 assert.equal((await f.host(port).initialize(modelInput)).phase,'unknown');f.reopen();const recovered=await f.host(port).observe(modelInput.identity);
 assert.equal(recovered.phase,'runtime_ready');assert.equal(f.starts,1);assert.equal(f.installs,2);assert.equal(resolves,2);
});
test('partial content is not retried after deadline or authority revocation',async t=>{
 const f=fixture(t),modelInput:RuntimeInitialize={...input,task:{...input.task,modelContent:{modelVersionId:'version-a',modelId:'queue',version:'2.1.0',contentRef:'models/queue/2.1.0.json',contentSha256:'d'.repeat(64)}}};
 const content={receipt:{...modelInput.task.modelContent!,namespace:'model-content' as const,bytes:1,verifiedSha256:modelInput.task.modelContent!.contentSha256,fileCount:1,contentBytes:1},manifest:{schemaVersion:1 as const,files:[{path:'model/main.py',bytes:1,sha256:'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'}]},files:{'model/main.py':new Uint8Array([97])}};
 f.onInstall(()=>{throw Error('partial-install');});const port={async resolve(){return content;}};await f.host(port).initialize(modelInput);
 f.advance(10001);await f.host(port).observe(modelInput.identity);assert.equal(f.installs,1);
 const g=fixture(t);g.onInstall(()=>{throw Error('partial-install');});await g.host(port).initialize(modelInput);g.revoke();await g.host(port).observe(modelInput.identity);assert.equal(g.installs,1);
});
test('deadline advancing while authority is awaited denies start',async t=>{
 const f=fixture(t);f.blockAuthorize(async()=>{f.advance(10001);});assert.equal((await f.host().initialize(input)).failureCode,'deadline');assert.equal(f.starts,0);
});
test('wrong generation/scope and modified nonce cannot observe or restart an accepted runtime',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);
 await assert.rejects(h.stop({...input.identity,generation:2}),/scope-denied/);
 await assert.rejects(h.observe({...input.identity,tenantId:'tenant-other'}),/scope-denied/);
 await assert.rejects(h.initialize({...input,markerNonce:'changed'}),/input-conflict/);assert.equal(f.starts,1);
});
test('corrupt files and an uncommitted unknown checkpoint cannot be promoted or retried',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);f.corrupt();assert.equal((await h.observe(input.identity)).ready,null);assert.equal(f.puts,0);
 f.complete();f.putFault('before');assert.equal((await h.observe(input.identity)).ready,null);f.putFault('none');
 f.reopen();assert.equal((await f.host().observe(input.identity)).ready,null);assert.equal(f.puts,1);
});
test('lost checkpoint acknowledgment is recovered by read with original observed time even after stop',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);f.complete();f.putFault('after');await h.observe(input.identity);
 f.advance(3000);const stopped=await h.stop(input.identity);f.advance(4000);f.reopen();const recovered=await f.host().observe(input.identity);
 assert.equal(recovered.ready?.initializedAt,2000);assert.equal(recovered.stop?.observedAt,stopped.stop?.observedAt);assert.equal(f.puts,1);assert.equal(recovered.phase,'stopped');
});
test('unknown destroy retains stop-unknown until native stopped is directly observed',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);f.destroyFault(true);const unknown=await h.stop(input.identity);
 assert.equal(unknown.phase,'unknown');assert.equal(unknown.stop,null);assert.equal(f.running,true);
 f.nativeStopped();f.reopen();const confirmed=await f.host().observe(input.identity);assert.equal(confirmed.stop?.nativeRunning,false);assert.equal(confirmed.phase,'stopped');assert.equal(f.destroys,1);
});
test('stop during checkpoint durability flush fences a not-yet-dispatched R2 PUT',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);f.complete();
 let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});
 const reserved=new Promise<void>(resolve=>{entered=resolve;});
 f.blockSync(async()=>{f.blockSync(null);entered();await blocked;});
 const observe=h.observe(input.identity);await reserved;
 await h.stop(input.identity);release();await observe;assert.equal(f.puts,0);
});
test('checkpoint creation past deadline cannot contaminate a valid stop receipt',async t=>{
 const f=fixture(t),h=f.host();await h.initialize(input);f.complete();f.advance(10001);
 assert.equal((await h.observe(input.identity)).ready,null);assert.equal(f.puts,0);
 const stopped=await h.stop(input.identity);assert.ok(stopped.stop);assert.equal(stopped.ready,null);
});
