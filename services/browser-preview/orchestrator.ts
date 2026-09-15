import type {TurnActor,TurnScope,CheckpointReceipt} from '../turn/protocol.ts';
import {turnId} from '../turn/protocol.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {canonicalPreviewJson,previewSha256,parsePreviewVerifyRequest,type PreviewRuntime,type PreviewVerifyRequest} from './contract.ts';
import type {PreviewProfileRegistry} from './profiles.ts';
import {BrowserPreviewBuildHost} from './build-host.ts';
import {readPreviewPackage,type PreviewObjectBucket} from './storage.ts';
import {simulationPlan,modelVersion} from '../simulation/source.ts';
import {SimulationHost,experimentRequest,publicExperiment,type ExperimentRequest} from '../simulation/host.ts';
import type {PreviewSource} from '../preview/source.ts';
type Saved={identity:TurnRuntimeIdentity;receipt:CheckpointReceipt};
type Capture={schemaVersion:1;scope:TurnScope;actor:TurnActor;input:PreviewVerifyRequest;request:ExperimentRequest;serverKey:string};
export interface BrowserPreviewOrchestratorPorts{
 authorize(actor:TurnActor):Promise<void>;checkScope():void;
 head():Saved|null;saved(revisionId:string):Saved|null;
 registry():Promise<PreviewProfileRegistry>;builds:BrowserPreviewBuildHost;bucket:PreviewObjectBucket;
 files(source:PreviewSource):Promise<Uint8Array>;simulations:SimulationHost;canVerify():boolean;image:string;
 delivery():unknown;
}
function eq(a:unknown,b:unknown){return canonicalPreviewJson(a)===canonicalPreviewJson(b);}
export class BrowserPreviewOrchestrator{
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly ports:BrowserPreviewOrchestratorPorts;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:BrowserPreviewOrchestratorPorts){this.storage=storage;this.scope=structuredClone(scope);this.ports=ports;}
 async #authorize(actor:TurnActor){this.ports.checkScope();await this.ports.authorize(actor);this.ports.checkScope();}
 #saved(revision:string){turnId(revision);const saved=this.ports.saved(revision);if(!saved)throw Error('browser-preview-not-found');return saved;}
 #stillSaved(saved:Saved){this.ports.checkScope();if(!eq(this.ports.saved(saved.receipt.revisionId),saved))throw Error('browser-preview-source-unavailable');}
 async view(actor:TurnActor,revisionId?:string,profileId?:PreviewRuntime['profileId']){
  await this.#authorize(actor);const registry=await this.ports.registry();await this.#authorize(actor);
  if(profileId&&!registry.resolve(profileId))throw Error('browser-preview-input-invalid');
  const head=this.ports.head(),revision=revisionId??head?.receipt.revisionId??null;
  if(!revision)return {currentRevisionId:null,revisionId:null,build:null,stale:false,modelSpec:null,reasonCode:'preview-no-saved-revision',delivery:null};
  const saved=this.#saved(revision),row=this.ports.builds.read(revision,profileId);let delivery=null,reasonCode:string|null=null;
  if(row?.state.status==='ready'){
   if(!row.profile||row.profile.trust!=='verified-platform'||!eq(registry.resolve(row.profile.runtime.profileId)?.runtime,row.profile.runtime))reasonCode='preview-runtime-unavailable';
   else {const config=this.ports.delivery();if(!config||typeof config!=='object')reasonCode='preview-runtime-unavailable';else delivery={...config,profile:{runtime:row.profile.runtime,packages:row.profile.packages,assetManifest:row.profile.assets,verified:true}};}
  }
  this.#stillSaved(saved);const current=this.ports.head()?.receipt.revisionId??null;
  return {currentRevisionId:current,revisionId:revision,build:reasonCode?null:row?.state??null,stale:current!==null&&revision!==current,modelSpec:row?.modelSpec??null,reasonCode:reasonCode??(!row?'preview-discovery-pending':null),delivery};
 }
 async bytes(actor:TurnActor,identity:string){
  if(!/^[a-f0-9]{64}$/.test(identity))throw Error('browser-preview-input-invalid');await this.#authorize(actor);
  const receipt=this.ports.builds.receipt(identity);if(!receipt)throw Error('browser-preview-not-found');const saved=this.#saved(receipt.revisionId);
  const result=await readPreviewPackage(this.ports.bucket,{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId},receipt);
  const row=this.ports.builds.read(receipt.revisionId,result.manifest.runtime.profileId),registry=await this.ports.registry();
  if(!row?.profile||!eq(row.profile.runtime,result.manifest.runtime)||!eq(registry.resolve(result.manifest.runtime.profileId)?.runtime,result.manifest.runtime))throw Error('browser-preview-source-unavailable');
  await this.#authorize(actor);this.#stillSaved(saved);return result;
 }
 async #key(actor:TurnActor,key:string){turnId(key);return 'browser-preview:verify:'+await previewSha256(canonicalPreviewJson([actor.userId,key]));}
 async verification(actor:TurnActor,key:string){
  await this.#authorize(actor);const capture=this.storage.kv.get<Capture>(await this.#key(actor,key));await this.#authorize(actor);
  if(!capture)return {verificationId:key,status:'absent',captured:null,experiment:null};
  if(!eq(capture.scope,this.scope)||!eq(capture.actor,actor))throw Error('browser-preview-access-denied');this.#saved(capture.input.revisionId);
  const prior=await this.ports.simulations.replay(actor,capture.serverKey,capture.request);await this.#authorize(actor);
  return {verificationId:key,status:prior?'accepted':'absent',captured:capture.input,experiment:prior?publicExperiment(prior,this.ports.head()?.receipt.filesSha256??null):null};
 }
 async verify(actor:TurnActor,raw:unknown){
  const input=parsePreviewVerifyRequest(raw);await this.#authorize(actor);const key=await this.#key(actor,input.idempotencyKey),prior=this.storage.kv.get<Capture>(key);
  if(prior&&(!eq(prior.actor,actor)||!eq(prior.scope,this.scope)||!eq(prior.input,input)))throw Error('browser-preview-idempotency-conflict');
  const saved=this.#saved(input.revisionId),pack=await this.bytes(actor,input.packageIdentity);
  if(pack.manifest.revisionId!==input.revisionId||pack.manifest.filesSha256!==saved.receipt.filesSha256)throw Error('browser-preview-source-unavailable');
  const source:PreviewSource={kind:'saved-turn',identity:saved.identity,revision:saved.receipt},bytes=await this.ports.files(source);await this.#authorize(actor);this.#stillSaved(saved);
  const plan=await simulationPlan(source,bytes),request=experimentRequest({...modelVersion(plan),parameters:input.parameters,seed:input.seed}),capture:Capture={schemaVersion:1,scope:this.scope,actor,input,request,serverKey:'browserverify-'+key.slice(key.lastIndexOf(':')+1)};
  if(!this.ports.canVerify())throw Error('simulation-unavailable');
  await this.#authorize(actor);this.#stillSaved(saved);
  await this.storage.transaction(async tx=>{const existing=await tx.get<Capture>(key);if(existing&&!eq(existing,capture))throw Error('browser-preview-idempotency-conflict');this.#stillSaved(saved);await tx.put(key,capture);});await this.storage.sync();
  const replay=await this.ports.simulations.replay(actor,capture.serverKey,request);await this.#authorize(actor);this.#stillSaved(saved);
  const experiment=replay??await this.ports.simulations.submit(actor,capture.serverKey,request,plan,this.ports.image,()=>{this.#stillSaved(saved);return true;});
  await this.#authorize(actor);return {verificationId:input.idempotencyKey,experiment:publicExperiment(experiment,this.ports.head()?.receipt.filesSha256??null)};
 }
}
