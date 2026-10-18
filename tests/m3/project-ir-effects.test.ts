import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectIrToolEffect,projectIrRegisterEffect} from '../../services/project-ir/effects.ts';
import {ProjectIrAuthority} from '../../services/project-ir/authority.ts';
import {projectIrFixture} from './project-ir-fixture.ts';
import type {ToolCommand} from '../../services/tools/protocol.ts';
import type {ToolEffectReceipt} from '../../services/tools/ledger.ts';
const scope={tenantId:'tenant-ir',projectId:'project-ir',workspaceId:'workspace-ir',workspaceGeneration:1},actor={userId:'owner-ir',authVersion:1};
class Storage{
 values=new Map<string,unknown>();syncs=0;afterSync:(()=>void)|undefined;
 kv={get:<T>(key:string):T|undefined=>structuredClone(this.values.get(key)) as T|undefined,put:(key:string,value:unknown)=>{this.values.set(key,structuredClone(value));}};
 transactionSync<T>(callback:()=>T):T{const old=structuredClone(this.values);try{return callback();}catch(e){this.values=old;throw e;}}
 async sync(){this.syncs++;this.afterSync?.();}
}
class Bucket{
 values=new Map<string,Uint8Array>();puts=0;fail=false;onPut:(()=>void)|undefined;
 async get(key:string){const bytes=this.values.get(key);return bytes?{arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
 async put(key:string,bytes:Uint8Array){this.puts++;if(this.fail)throw Error('synthetic-r2-save-failed');this.values.set(key,Uint8Array.from(bytes));this.onPut?.();return {};}
}
async function setup(){
 const [runtimeSource,workerSource]=await Promise.all(['runtime.js','worker.js'].map(name=>readFile(new URL('../../vendor/riffoid-ir-plugin/browser/'+name,import.meta.url),'utf8')));
 const f=await projectIrFixture({runtimeSource:runtimeSource!,workerSource:workerSource!,pluginVersion:'0.3.1'}),storage=new Storage(),bucket=new Bucket();
 let authorized=true,denyNext=false;const authorize=async()=>{if(denyNext){denyNext=false;throw Error('transient-project-ir-access-denied');}if(!authorized)throw Error('project-ir-access-denied');};
 const context={storage:storage as unknown as Pick<DurableObjectStorage,'kv'|'sync'|'transactionSync'>,bucket:bucket as unknown as R2Bucket,scope,actor,authorize,clock:()=>1000};
 const command=(operation:string,input:Record<string,unknown>,commandId='command-ir'):ToolCommand=>({schemaVersion:1,scope,turnId:'turn-ir',dispatchId:'dispatch-ir',commandId,deadlineAt:60_000,operation:'ir',arguments:{operation,input}});
 const native=(command:ToolCommand,effectId='effect-compile',registration:unknown=f.registration):ToolEffectReceipt=>({schemaVersion:1,scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:'terminal',outcome:'completed',errorCode:null,result:{status:'succeeded',browserArtifactRef:f.browserArtifactRef,bundleRef:f.artifact.bundleRef,toolchain:f.artifact.toolchain,businessFingerprint:f.artifact.businessFingerprint,planFingerprint:f.artifact.planFingerprint,registration},observedAt:1000});
 const authority=()=>new ProjectIrAuthority(storage,bucket,scope,()=>1000,authorize,actor);
 return {f,storage,bucket,context,command,native,authority,revoke:()=>{authorized=false;},denyNextAuthorization:()=>{denyNext=true;}};
}
test('compiler registration publishes before tool success and observe is idempotent across timestamps',async()=>{
 const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef});
 const original=x.native(command),first=await projectIrRegisterEffect(x.context,{command,effectId:original.effectId,receipt:original});
 assert.equal(first.outcome,'completed');assert.equal(first.result?.status,'succeeded');assert.equal(Object.hasOwn(first.result!,'registration'),false);
 const writes=x.bucket.puts,second=await projectIrRegisterEffect(x.context,{command,effectId:original.effectId,receipt:{...original,observedAt:1001}});
 assert.deepEqual(second,first);assert.equal(x.bucket.puts,writes);
 const changed={...original,result:{...original.result!,status:'different'}};
 await assert.rejects(projectIrRegisterEffect(x.context,{command,effectId:original.effectId,receipt:changed}),/idempotency-conflict/);
});
test('bad graph and unavailable R2 cannot turn native compile success into a public success',async()=>{
 for(const badGraph of [false,true]){
  const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef});
  const registration=structuredClone(x.f.registration);
  if(badGraph)registration.files[0]!.sha256='0'.repeat(64);else x.bucket.fail=true;
  const failed=await projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:x.native(command,'effect-compile',registration)});
  assert.equal(failed.outcome,'completed');assert.equal(failed.result?.status,'failed');
  assert.deepEqual(Object.keys(failed.result!).sort(),['diagnostics','status']);
  assert.equal((failed.result!.diagnostics as Array<{code:string}>)[0]!.code,badGraph?'artifact_integrity':'storage_failed');
  assert.equal([...x.storage.values.keys()].some(k=>k.startsWith('project-ir:host-effect:')),true,'only the determinate failure receipt is published');
  assert.equal([...x.storage.values.keys()].some(k=>k.startsWith('project-ir/v1/')),false,'no artifact or registration metadata is published');
 }
});
test('fresh authorization is required even for original effect readback and observe-only absence',async()=>{
 const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef});
 await projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:x.native(command)});
 x.revoke();
 await assert.rejects(projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:x.native(command)}),/access-denied/);
 await assert.rejects(projectIrToolEffect(x.context,{command:x.command('project_ir_result',{runId:'run-00000000-0000-0000-0000-000000000000'}),effectId:'missing-effect',observeOnly:true}),/access-denied/);
});
test('authorization lost during R2 writes prevents a visible compile receipt',async()=>{
 const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef});x.bucket.onPut=()=>x.revoke();
 await assert.rejects(projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:x.native(command)}),/access-denied/);
 assert.equal([...x.storage.values.keys()].some(k=>k.startsWith('project-ir:host-effect:')),false);
});
test('run ACK-loss reconciliation uses the original effect and never allocates a second run',async()=>{
 const x=await setup();assert.equal((await x.authority().register({effectId:'fixture-register',registration:x.f.registration})).status,'succeeded');
 await x.authority().browser({operation:'heartbeat',input:{clientId:'11111111-1111-4111-8111-111111111111'}});
 const command=x.command('project_ir_run',{browserArtifactRef:x.f.browserArtifactRef}),first=await projectIrToolEffect(x.context,{command,effectId:'effect-run',observeOnly:false});
 assert.equal(first.result?.accepted,true);
 // Only lose the wrapper ACK publication; the durable core effect remains.
 for(const key of x.storage.values.keys())if(key.startsWith('project-ir:host-effect:'))x.storage.values.delete(key);
 const recovered=await projectIrToolEffect(x.context,{command,effectId:'effect-run',observeOnly:true});
 assert.equal(recovered.result?.runId,first.result?.runId);
 const records=await x.authority().browser({operation:'records',input:{}});assert.equal(records.records.length,1);
 const writes=x.bucket.puts,observed=await projectIrToolEffect(x.context,{command,effectId:'effect-run',observeOnly:true});
 assert.deepEqual(observed,recovered);assert.equal(x.bucket.puts,writes);
});
test('observe-only missing effect neither writes R2 nor starts an execution',async()=>{
 const x=await setup(),result=await projectIrToolEffect(x.context,{command:x.command('project_ir_run',{sourceRunId:'run-00000000-0000-0000-0000-000000000000'}),effectId:'absent-run',observeOnly:true});
 assert.equal(result.phase,'absent');assert.equal(x.bucket.puts,0);assert.equal(x.storage.values.size,0);
});
test('a native receipt from another original effect or scope is rejected',async()=>{
 const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef});
 for(const receipt of [{...x.native(command),effectId:'other-effect'},{...x.native(command),scope:{...scope,workspaceId:'other-workspace'}}]){
  await assert.rejects(projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt}),/effect-scope-denied/);
 }
 assert.equal(x.bucket.puts,0);
});

test('successful compiler output requires a matching durable graph and public references',async()=>{
 for(const change of ['missing-registration','wrong-ref','wrong-bundle','wrong-plan']){
  const x=await setup(),command=x.command('project_ir_compile',{sealedRef:x.f.artifact.modelRef}),native=x.native(command);
  if(change==='missing-registration')delete native.result!.registration;
  if(change==='wrong-ref')native.result!.browserArtifactRef='.riffoid-ir/artifacts/'+ '0'.repeat(64)+'/browser.json';
  if(change==='wrong-bundle')native.result!.bundleRef='.riffoid-ir/bundles/'+ '0'.repeat(64)+'/model.simpack';
  if(change==='wrong-plan')native.result!.planFingerprint='0'.repeat(64);
  await assert.rejects(projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:native}),/registration-required|registration-conflict/);
  assert.equal(x.bucket.puts,0);
 }
});
test('show overrides the temporary CLI browser flag with the real actor lease',async()=>{
 const x=await setup();await x.authority().browser({operation:'heartbeat',input:{clientId:'11111111-1111-4111-8111-111111111111'}});
 const command=x.command('show',{}),native=x.native(command);native.result={defaultMode:'ir',browserConnected:false,registration:x.f.registration};
 const saved=await projectIrRegisterEffect(x.context,{command,effectId:'effect-compile',receipt:native});assert.equal(saved.result?.browserConnected,true);
});


test('post-commit transient authorization failure cannot freeze a false failed wrapper receipt',async()=>{
 const x=await setup();assert.equal((await x.authority().register({effectId:'fixture-register',registration:x.f.registration})).status,'succeeded');
 await x.authority().browser({operation:'heartbeat',input:{clientId:'11111111-1111-4111-8111-111111111111'}});
 x.storage.afterSync=()=>{x.storage.afterSync=undefined;x.denyNextAuthorization();};
 const command=x.command('project_ir_run',{browserArtifactRef:x.f.browserArtifactRef}),input={command,effectId:'effect-final-authorization',observeOnly:false};
 await assert.rejects(projectIrToolEffect(x.context,input),(error:any)=>error.code==='authorization_denied');
 assert.equal([...x.storage.values.keys()].some(k=>k.startsWith('project-ir:host-effect:')),false,'a failed host receipt must never hide the committed original effect');
 const runs=[...x.storage.values.entries()].filter(([k])=>k.includes('/runs/'));assert.equal(runs.length,1);
 const original=(runs[0]![1] as Record<string,any>).record;assert.equal(original.status,'pending');
 const beforeWrites=x.bucket.puts,recovered=await projectIrToolEffect(x.context,{...input,observeOnly:true});
 assert.equal(recovered.outcome,'completed');assert.equal(recovered.result?.accepted,true);assert.equal(recovered.result?.status,'pending');assert.equal(recovered.result?.runId,original.runId);
 assert.equal(x.bucket.puts,beforeWrites,'reconciliation reads the original core effect without rewriting R2');
 const saved=[...x.storage.values.entries()].filter(([k])=>k.startsWith('project-ir:host-effect:'));assert.equal(saved.length,1);assert.equal((saved[0]![1] as any).receipt.result.accepted,true);
 assert.deepEqual(await projectIrToolEffect(x.context,{...input,observeOnly:true}),recovered);
 assert.equal([...x.storage.values.keys()].filter(k=>k.includes('/runs/')).length,1);
});

test('initial wrapper authorization rejection creates no core or host resources',async()=>{
 const x=await setup();x.revoke();
 await assert.rejects(projectIrToolEffect(x.context,{command:x.command('project_ir_run',{browserArtifactRef:x.f.browserArtifactRef}),effectId:'initially-denied-effect',observeOnly:false}),/access-denied/);
 assert.equal(x.storage.values.size,0);assert.equal(x.bucket.puts,0);
});
