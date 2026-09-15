import {sourceRevision,sourceFilesSha,sourcePreview,frozenSource,type BrowserBuildSource} from './source.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {turnId} from '../turn/protocol.ts';
import {canonicalPreviewJson,previewSha256,parsePreviewVerifyRequest,type PreviewRuntime,type PreviewVerifyRequest} from './contract.ts';
import type {PreviewProfileRegistry} from './profiles.ts';
import {BrowserPreviewBuildHost} from './build-host.ts';
import {readPreviewPackage,type PreviewObjectBucket} from './storage.ts';
import {simulationPlan,modelVersion} from '../simulation/source.ts';
import {SimulationHost,experimentRequest,publicExperiment,type ExperimentRequest} from '../simulation/host.ts';
import type {PreviewSource} from '../preview/source.ts';
type Saved=BrowserBuildSource;
type Capture={schemaVersion:1;scope:TurnScope;actor:TurnActor;input:PreviewVerifyRequest;request:ExperimentRequest;serverKey:string;source?:BrowserBuildSource};
export interface BrowserPreviewOrchestratorPorts{
 authorize(actor:TurnActor):Promise<void>;authorizeVerify?(actor:TurnActor):Promise<void>;checkScope():void;
 head():Saved|null;saved(revisionId:string):Saved|null;checkSource?(source:BrowserBuildSource):void;
 registry():Promise<PreviewProfileRegistry>;builds:BrowserPreviewBuildHost;bucket:PreviewObjectBucket;
 files(source:PreviewSource):Promise<Uint8Array>;simulations:SimulationHost;canVerify():boolean;image:string;
 delivery(assetSha256:string):unknown;
}
function eq(a:unknown,b:unknown){return canonicalPreviewJson(a)===canonicalPreviewJson(b);}
export class BrowserPreviewOrchestrator{
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly ports:BrowserPreviewOrchestratorPorts;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:BrowserPreviewOrchestratorPorts){this.storage=storage;this.scope=structuredClone(scope);this.ports=ports;}
 async #authorize(actor:TurnActor){this.ports.checkScope();await this.ports.authorize(actor);this.ports.checkScope();}
 async #authorizeVerify(actor:TurnActor){this.ports.checkScope();await (this.ports.authorizeVerify??this.ports.authorize)(actor);this.ports.checkScope();}
 #saved(revision:string){turnId(revision);const saved=this.ports.saved(revision);if(!saved)throw Error('browser-preview-not-found');this.ports.checkSource?.(saved);return frozenSource(saved);}
 #stillSaved(saved:Saved){this.ports.checkScope();this.ports.checkSource?.(saved);const current=this.ports.saved(sourceRevision(saved));if(!current||!eq(frozenSource(current),frozenSource(saved)))throw Error('browser-preview-source-unavailable');}
 #currentRevision(){const head=this.ports.head();return head?sourceRevision(head):null;}
 #currentFilesSha(){const head=this.ports.head();return head?sourceFilesSha(head):null;}
 async view(actor:TurnActor,revisionId?:string,profileId?:PreviewRuntime['profileId']){
  await this.#authorize(actor);
  if(profileId!==undefined&&(typeof profileId!=='string'||!['python-stdlib/v1','mesa-3.5.1/v1'].includes(profileId)))throw Error('browser-preview-input-invalid');
  const head=this.ports.head(),revision=revisionId??(head?sourceRevision(head):null)??null;
  if(!revision)return {currentRevisionId:null,revisionId:null,build:null,stale:false,modelSpec:null,reasonCode:'preview-no-saved-revision',delivery:null};
  const saved=this.#saved(revision),row=this.ports.builds.read(revision,profileId);let delivery=null,reasonCode:string|null=null;
  if(row?.state.status==='ready'){
   if(!row.profile||row.profile.trust!=='verified-platform')reasonCode='preview-runtime-unavailable';
   else {let config:unknown=null;try{config=this.ports.delivery(row.profile.runtime.assetSha256);}catch{/* Historical immutable delivery may be unavailable. */}if(!config||typeof config!=='object')reasonCode='preview-runtime-unavailable';else delivery={...config,profile:{runtime:row.profile.runtime,packages:row.profile.packages,assetManifest:row.profile.assets,verified:true}};}
  }
  this.#stillSaved(saved);const current=this.#currentRevision()??null;
  return {currentRevisionId:current,revisionId:revision,sourceKind:saved.kind==='initial-workspace'?'initial-workspace':'saved-turn',referenceSha256:saved.kind==='initial-workspace'?saved.referenceSha256:null,build:reasonCode?null:row?.state??null,stale:current!==null&&revision!==current,modelSpec:row?.modelSpec??null,reasonCode:reasonCode??(!row?'preview-discovery-pending':null),delivery};
 }
 async bytes(actor:TurnActor,identity:string){
  if(!/^[a-f0-9]{64}$/.test(identity))throw Error('browser-preview-input-invalid');await this.#authorize(actor);
  const receipt=this.ports.builds.receipt(identity);if(!receipt)throw Error('browser-preview-not-found');const saved=this.#saved(receipt.revisionId);
  const result=await readPreviewPackage(this.ports.bucket,{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId},receipt);
  const row=this.ports.builds.read(receipt.revisionId,result.manifest.runtime.profileId);
  try{this.ports.delivery(result.manifest.runtime.assetSha256);}catch{throw Error('browser-preview-source-unavailable');}
  if(!row?.profile||!eq(row.profile.runtime,result.manifest.runtime))throw Error('browser-preview-source-unavailable');
  await this.#authorize(actor);this.#stillSaved(saved);return result;
 }
 async retry(actor:TurnActor,raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='buildIdentity,idempotencyKey,profileId,revisionId')throw Error('browser-preview-input-invalid');
  const r=raw as Record<string,unknown>;for(const key of ['revisionId','idempotencyKey'])turnId(r[key]);
  if(typeof r.buildIdentity!=='string'||!/^[a-f0-9]{64}$/.test(r.buildIdentity)||!['python-stdlib/v1','mesa-3.5.1/v1'].includes(r.profileId as string))throw Error('browser-preview-input-invalid');
  await this.#authorize(actor);const saved=this.#saved(r.revisionId as string),row=this.ports.builds.read(r.revisionId as string,r.profileId as PreviewRuntime['profileId']);
  if(row?.profile&&row.profile.trust!=='verified-platform')throw Error('browser-preview-source-unavailable');
  const key=await this.#key(actor,r.idempotencyKey as string);await this.#authorize(actor);this.#stillSaved(saved);
  await this.ports.builds.retry(r.revisionId as string,r.profileId as PreviewRuntime['profileId'],r.buildIdentity,key);
  await this.#authorize(actor);return {...await this.view(actor,r.revisionId as string,r.profileId as PreviewRuntime['profileId']),retryId:r.idempotencyKey,status:'accepted',revisionId:r.revisionId,profileId:r.profileId,buildIdentity:r.buildIdentity};
 }
 async retryVerification(actor:TurnActor,key:string){
  await this.#authorize(actor);const receipt=this.ports.builds.retryReceipt(await this.#key(actor,key));await this.#authorize(actor);
  if(receipt)this.#saved(receipt.revisionId);return {retryId:key,status:receipt?'accepted':'absent',captured:receipt};
 }
 async #key(actor:TurnActor,key:string){turnId(key);return 'browser-preview:verify:'+await previewSha256(canonicalPreviewJson([actor.userId,key]));}
 async verification(actor:TurnActor,key:string){
  await this.#authorize(actor);const capture=this.storage.kv.get<Capture>(await this.#key(actor,key));await this.#authorize(actor);
  if(!capture)return {verificationId:key,status:'absent',captured:null,experiment:null};
  if(!eq(capture.scope,this.scope)||!eq(capture.actor,actor))throw Error('browser-preview-access-denied');const saved=this.#saved(capture.input.revisionId);if(capture.source&&!eq(frozenSource(saved),capture.source))throw Error('browser-preview-source-unavailable');
  const prior=await this.ports.simulations.replay(actor,capture.serverKey,capture.request);await this.#authorize(actor);
  return {verificationId:key,status:prior?'accepted':'absent',captured:(({idempotencyKey:_,...captured})=>captured)(capture.input),experiment:prior?publicExperiment(prior,this.#currentFilesSha()??null):null};
 }
 async verify(actor:TurnActor,raw:unknown){
  const input=parsePreviewVerifyRequest(raw);await this.#authorizeVerify(actor);const key=await this.#key(actor,input.idempotencyKey),prior=this.storage.kv.get<Capture>(key);
  if(prior&&(!eq(prior.actor,actor)||!eq(prior.scope,this.scope)||!eq(prior.input,input)))throw Error('browser-preview-idempotency-conflict');
  const saved=this.#saved(input.revisionId);if(prior?.source&&!eq(prior.source,frozenSource(saved)))throw Error('browser-preview-source-unavailable');const pack=await this.bytes(actor,input.packageIdentity);
  if(pack.manifest.revisionId!==input.revisionId||pack.manifest.filesSha256!==sourceFilesSha(saved))throw Error('browser-preview-source-unavailable');
  const source:PreviewSource=sourcePreview(saved),bytes=await this.ports.files(source);await this.#authorizeVerify(actor);this.#stillSaved(saved);
  const plan=await simulationPlan(source,bytes),request=experimentRequest({...modelVersion(plan),parameters:input.parameters,seed:input.seed}),capture:Capture={schemaVersion:1,scope:this.scope,actor,input,request,serverKey:'browserverify-'+key.slice(key.lastIndexOf(':')+1),source:frozenSource(saved)};
  if(!this.ports.canVerify())throw Error('simulation-unavailable');
  await this.#authorizeVerify(actor);this.#stillSaved(saved);
  await this.storage.transaction(async tx=>{const existing=await tx.get<Capture>(key);if(existing&&!eq({...existing,source:existing.source??frozenSource(saved)},capture))throw Error('browser-preview-idempotency-conflict');this.#stillSaved(saved);await tx.put(key,capture);});await this.storage.sync();
  const replay=await this.ports.simulations.replay(actor,capture.serverKey,request);await this.#authorizeVerify(actor);this.#stillSaved(saved);
  const experiment=replay??await this.ports.simulations.submit(actor,capture.serverKey,request,plan,this.ports.image,()=>{this.#stillSaved(saved);return true;});
  await this.#authorizeVerify(actor);return {verificationId:input.idempotencyKey,experiment:publicExperiment(experiment,this.#currentFilesSha()??null)};
 }
}
