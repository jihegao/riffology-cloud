import {PreviewPlanResolver} from '../../services/preview/source.ts';
import {InitialWorkspaceResolver} from '../../services/turn-runtime/initial-workspace.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sandboxActorIds } from '../../services/sandbox/policy.ts';
import { assembleProductTurnRuntimeRelease, type ProductTurnRuntimeReleaseDependencies } from '../../services/turn-runtime/release.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';
import type { TrustedPiProcessView, TrustedPiSandboxProcessApi } from '../../services/turn-runtime/pi-native.ts';
import type { ProjectWorkspaceRpc } from '../../services/turn-runtime/workspace.ts';
import { R2TurnRevisionPort, R2TurnRevisionReader } from '../../services/turn-runtime/revision.ts';
import type { RevisionCommitInput, RevisionStoreRpc } from '../../services/turn-runtime/revision-store-client.ts';

const encoder=new TextEncoder();
const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:1},base={workspace:null,session:null};
async function digest(bytes:Uint8Array){const value=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array){return Buffer.from(bytes).toString('base64');}

class Bucket{
  objects=new Map<string,Uint8Array>();
  async put(key:string,value:Uint8Array){if(!this.objects.has(key))this.objects.set(key,Uint8Array.from(value));return null;}
  async get(key:string){const value=this.objects.get(key);if(!value)return null;const bytes=Uint8Array.from(value);return {size:bytes.byteLength,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}
}
class Store implements RevisionStoreRpc{
  readonly bucket:Bucket;
  constructor(bucket:Bucket){this.bucket=bucket;}
  resolveInitial(...args:Parameters<RevisionStoreRpc['resolveInitial']>){return new InitialWorkspaceResolver(this.bucket as never).resolve(...args);}
  previewPlan(...args:Parameters<RevisionStoreRpc['previewPlan']>){return new PreviewPlanResolver({files:source=>this.serviceFiles(source)}).resolve(...args);}
  serviceFiles(...args:Parameters<RevisionStoreRpc['serviceFiles']>){const [source]=args;if(source.kind!=='saved-turn')throw Error('fixture-source');return this.#reader().files(source.identity,source.revision);}
  async initialPreviewPlan(...args:Parameters<RevisionStoreRpc['initialPreviewPlan']>){const resolved=await this.resolveInitial(...args);return new PreviewPlanResolver({async files(){return resolved.filesArchive;}}).resolve({kind:'initial-workspace',reference:resolved.reference,filesSha256:resolved.filesSha256});}
  #reader(){return new R2TurnRevisionReader(this.bucket as never);}
  async commit(input:RevisionCommitInput){return new R2TurnRevisionPort(this.bucket as never,{async freeze(){return input.snapshot;}},()=>1000).commit(input);}
  async reconcileCommit(input:Parameters<RevisionStoreRpc['reconcileCommit']>[0]){const saved=await this.#reader().inspect(input.identity);return saved?{status:'committed' as const,receipt:saved.receipt}:{status:'absent' as const};}
  async abandonCommit(input:Parameters<RevisionStoreRpc['abandonCommit']>[0]){return this.reconcileCommit(input);}
  async observe(value:TurnRuntimeIdentity){return new R2TurnRevisionPort(this.bucket as never,{async freeze(){throw Error('must-not-freeze');}},()=>1000).observe(value);}
  restore(...args:Parameters<RevisionStoreRpc['restore']>){return this.#reader().restore(...args);}
  async files(...args:Parameters<RevisionStoreRpc['files']>){await this.#reader().files(args[0],args[1]);return {schemaVersion:1 as const,files:[]};}
  async diff(...args:Parameters<RevisionStoreRpc['diff']>){await this.#reader().workspaceFiles(args[0],args[1]);return {schemaVersion:1 as const,summary:{added:0,modified:0,deleted:0},changes:[]};}
  load(...args:Parameters<RevisionStoreRpc['load']>){return this.#reader().load(...args);}
  async gc():ReturnType<RevisionStoreRpc['gc']>{throw Error('must-not-gc');}
}
class PiSandbox implements TrustedPiSandboxProcessApi{
  files=new Map<string,string>();calls:string[];outcome:'completed'|'failed'|'cancelled'|'interrupted';
  constructor(calls:string[],outcome:'completed'|'failed'|'cancelled'|'interrupted'){this.calls=calls;this.outcome=outcome;}
  async writeFile(path:string,content:string){this.calls.push(`pi.write:${path}`);this.files.set(path,content);return {success:true,path,bytesWritten:encoder.encode(content).byteLength};}
  async readFile(path:string){this.calls.push(`pi.read:${path}`);if(!this.files.has(path))throw Error('not found');return {success:true,path,content:this.files.get(path)!};}
  async startProcess(_command:string,options:{processId:string}){
    this.calls.push('pi.start');const controlPath=[...this.files.keys()].find(path=>path.endsWith('.control.json'))!,control=JSON.parse(this.files.get(controlPath)!);
    const token=controlPath.match(/\/([^/]+)\.control\.json$/)![1]!,root=controlPath.slice(0,-'.control.json'.length),session=encoder.encode(JSON.stringify({format:'riffology-pi-session-v1',scope:{tenantId:control.identity.scope.tenantId,projectId:control.identity.scope.projectId,sessionId:control.identity.sessionId},createdAt:'2026-09-07T00:00:00.000Z',entries:[],leafId:null}));
    this.files.set(`${root}.output-session.json`,base64(session));this.files.set(`${root}.result.json`,JSON.stringify({schemaVersion:1,identity:control.identity,phase:'terminal',outcome:this.outcome,executionErrorCode:this.outcome==='completed'?null:'fixture-failure',events:[],outputSessionSha256:await digest(session)}));
    assert.ok(token);return {id:options.processId,status:'completed',exitCode:0,async getStatus(){return 'completed';},async kill(){throw Error('must-not-kill');}} as TrustedPiProcessView;
  }
  async getProcess(id:string){this.calls.push('pi.process');return {id,status:'completed',exitCode:0,async getStatus(){return 'completed';},async kill(){throw Error('must-not-kill');}} as TrustedPiProcessView;}
  async destroy(){this.calls.push('pi.destroy');}
  async releaseState(){this.calls.push('pi.releaseState');return {running:false};}
}

class ObserverPiSandbox implements TrustedPiSandboxProcessApi{
  readonly calls:string[]=[];
  readonly query:NonNullable<TrustedPiSandboxProcessApi['queryObserverExecution']>;
  constructor(query:NonNullable<TrustedPiSandboxProcessApi['queryObserverExecution']>){this.query=query;}
  async writeFile():Promise<never>{throw Error('ordinary-pi-write-must-not-run');}
  async readFile():Promise<never>{throw Error('ordinary-pi-read-must-not-run');}
  async startProcess():Promise<never>{throw Error('ordinary-pi-start-must-not-run');}
  async getProcess():Promise<never>{throw Error('ordinary-pi-process-must-not-run');}
  async destroy():Promise<never>{throw Error('ordinary-pi-destroy-must-not-run');}
  async releaseState():Promise<never>{throw Error('ordinary-pi-release-state-must-not-run');}
  async queryObserverExecution(identity:TurnRuntimeIdentity){this.calls.push('pi.queryObserverExecution');return this.query(identity);}
}

function fixture(outcome:'completed'|'failed'|'cancelled'|'interrupted'='completed'){
  const calls:string[]=[],bucket=new Bucket(),store=new Store(bucket),workspaceArchive=encoder.encode('canonical-workspace-archive'),sandbox=new PiSandbox(calls,outcome);
  const project:ProjectWorkspaceRpc={async restoreWorkspace(value,claimed,archive){calls.push('workspace.restore');assert.deepEqual(value,identity);assert.deepEqual(claimed,base);assert.equal(archive,null);return {sha256:await digest(workspaceArchive),bytes:workspaceArchive.byteLength};},async freezeWorkspace(value,claimed){calls.push('workspace.freeze');assert.deepEqual(value,identity);assert.deepEqual(claimed,base);return workspaceArchive;},async abortWorkspace(){calls.push('workspace.abort');return {running:false,fenced:true};}};
  const projectActors:string[]=[],trustedActors:string[]=[],dependencies:ProductTurnRuntimeReleaseDependencies={
    revisions:store,
    resolveProjectSandbox(name){projectActors.push(name);return project;},
    resolveTrustedPiSandbox(name){trustedActors.push(name);return sandbox;},
    clock:()=>1000,
  };
  return {calls,bucket,workspaceArchive,projectActors,trustedActors,release:assembleProductTurnRuntimeRelease(identity,dependencies)};
}

test('release restores the derived Project Sandbox before starting one derived Trusted Pi Sandbox and freezes one Revision',async()=>{
  const f=fixture(),expected=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId),result=await f.release.execution.start({...identity,actor,message:'Build model',base});
  assert.equal(result.phase,'terminal');assert.equal(result.outcome,'completed');assert.deepEqual(f.projectActors,[expected.project]);assert.deepEqual(f.trustedActors,[expected.trustedPi]);
  assert.ok(f.calls.indexOf('workspace.restore')<f.calls.indexOf('pi.start'));
  const input={identity,outcome:'completed' as const,executionErrorCode:null,base},intent=await f.release.checkpoints.prepare(input),receipt=await f.release.checkpoints.commit(input,intent);
  assert.equal(receipt.objectKey,'turns/tenant-a/project-a/workspace-a/2/session-a/turn-a/dispatch-a.json');assert.equal(f.calls.filter(value=>value==='workspace.freeze').length,1);assert.deepEqual(await f.release.checkpoints.reconcile(identity,intent),receipt);
  assert.deepEqual(await f.release.execution.release(identity),{running:false});assert.deepEqual(f.calls.slice(-2),['pi.destroy','pi.releaseState']);assert.deepEqual(f.trustedActors,[expected.trustedPi]);
  await f.release.execution.start({...identity,actor,message:'Build model',base});assert.equal(f.calls.filter(value=>value==='workspace.restore').length,1);assert.equal(f.calls.filter(value=>value==='pi.start').length,1);
});

for(const outcome of ['failed','cancelled','interrupted'] as const)test(`release preserves ${outcome} terminal outcome while materializing recoverable artifacts`,async()=>{
  const f=fixture(outcome),result=await f.release.execution.start({...identity,actor,message:'Build model',base});assert.equal(result.outcome,outcome);assert.equal(result.executionErrorCode,'fixture-failure');
  const input={identity,outcome,executionErrorCode:'fixture-failure',base},intent=await f.release.checkpoints.prepare(input),receipt=await f.release.checkpoints.commit(input,intent);assert.ok(f.bucket.objects.has(receipt.objectKey));assert.equal(f.calls.filter(value=>value==='workspace.freeze').length,1);
});

test('assembly and both returned ports reject missing dependencies or a different identity before external work',async()=>{
  let resolved=0;assert.throws(()=>assembleProductTurnRuntimeRelease(identity,{} as never),/dependencies-required/);assert.equal(resolved,0);
  const bucket=new Bucket(),release=assembleProductTurnRuntimeRelease(identity,{revisions:new Store(bucket),resolveProjectSandbox(){resolved++;return {} as never;},resolveTrustedPiSandbox(){resolved++;return {} as never;}});
  const other={...identity,dispatchId:'dispatch-b'};
  await assert.rejects(release.execution.observe(other),/release-scope-denied/);await assert.rejects(release.execution.release(other),/release-scope-denied/);await assert.rejects(release.checkpoints.reconcile(other,{operationId:'commit:x',inputSha256:'a'.repeat(64)}),/release-scope-denied/);assert.equal(resolved,0);assert.equal(bucket.objects.size,0);
});

test('currentObserverExecution uses only the derived Trusted Pi observer RPC',async()=>{
  const calls:string[]=[],sandbox=new ObserverPiSandbox(async value=>{
    calls.push(`query:${value.turnId}`);assert.deepEqual(value,identity);return {expiresAt:2000};
  }),expected=await sandboxActorIds(identity.scope,identity.turnId,identity.dispatchId),bucket=new Bucket(),store=new Store(bucket);
  store.load=async()=>{throw Error('revision-load-must-not-run');};
  store.restore=async()=>{throw Error('revision-restore-must-not-run');};
  const release=assembleProductTurnRuntimeRelease(identity,{revisions:store,resolveProjectSandbox(){calls.push('project.resolve');throw Error('project-must-not-resolve');},resolveTrustedPiSandbox(name){calls.push(`trusted.resolve:${name}`);assert.equal(name,expected.trustedPi);return sandbox;},clock:()=>1000});
  assert.ok(release.execution.currentObserverExecution);
  assert.deepEqual(await release.execution.currentObserverExecution(identity),{expiresAt:2000});
  assert.deepEqual(calls,[`trusted.resolve:${expected.trustedPi}`,'query:turn-a']);
  assert.deepEqual(sandbox.calls,['pi.queryObserverExecution']);
  assert.equal(bucket.objects.size,0);
});

test('currentObserverExecution rejects a scope mismatch before resolving the Trusted Pi Sandbox',async()=>{
  let resolved=0;const release=assembleProductTurnRuntimeRelease(identity,{revisions:new Store(new Bucket()),resolveProjectSandbox(){throw Error('project-must-not-resolve');},resolveTrustedPiSandbox(){resolved++;throw Error('trusted-must-not-resolve');},clock:()=>1000});
  assert.ok(release.execution.currentObserverExecution);
  await assert.rejects(release.execution.currentObserverExecution({...identity,dispatchId:'dispatch-b'}),/release-scope-denied/);
  assert.equal(resolved,0);
});

test('currentObserverExecution rejects without the dedicated RPC and never falls back to ordinary SDK methods',async()=>{
  const sandbox={
    writeFile:async()=>{throw Error('ordinary-pi-write-must-not-run');},
    readFile:async()=>{throw Error('ordinary-pi-read-must-not-run');},
    startProcess:async()=>{throw Error('ordinary-pi-start-must-not-run');},
    getProcess:async()=>{throw Error('ordinary-pi-process-must-not-run');},
    destroy:async()=>{throw Error('ordinary-pi-destroy-must-not-run');},
    releaseState:async()=>{throw Error('ordinary-pi-release-state-must-not-run');},
  } satisfies TrustedPiSandboxProcessApi;
  const release=assembleProductTurnRuntimeRelease(identity,{revisions:new Store(new Bucket()),resolveProjectSandbox(){throw Error('project-must-not-resolve');},resolveTrustedPiSandbox(){return sandbox;},clock:()=>1000});
  assert.ok(release.execution.currentObserverExecution);
  await assert.rejects(release.execution.currentObserverExecution(identity),/trusted-pi-observer-reader-required/);
});

test('currentObserverExecution rejects RPC errors and expired deadlines',async()=>{
  for(const query of [
    async()=>{throw Error('observer-query-failed');},
    async()=>({expiresAt:1000}),
  ]){
    const sandbox=new ObserverPiSandbox(query),release=assembleProductTurnRuntimeRelease(identity,{revisions:new Store(new Bucket()),resolveProjectSandbox(){throw Error('project-must-not-resolve');},resolveTrustedPiSandbox(){return sandbox;},clock:()=>1000});
    assert.ok(release.execution.currentObserverExecution);
  await assert.rejects(release.execution.currentObserverExecution(identity),/observer-query-failed|trusted-pi-observer-denied/);
    assert.deepEqual(sandbox.calls,['pi.queryObserverExecution']);
  }
});

test('candidate assembly imports no M0 probe, legacy runtime, pricing or provider implementation',()=>{
  const source=readFileSync(new URL('../../services/turn-runtime/release.ts',import.meta.url),'utf8'),imports=source.split('\n').filter(line=>line.startsWith('import ')).join('\n');
  assert.doesNotMatch(imports,/spikes|m0-|proxy-pi|go-pi-probe|pricing|model-proxy|provider/i);assert.doesNotMatch(source,/microusd|resolveCredential|providerDefinitions|R2TurnRevision|WORKSPACE_CHECKPOINTS/i);
});
