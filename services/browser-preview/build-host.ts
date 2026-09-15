import type { ModelSpec } from '../simulation/model-spec.ts';
import type { TurnScope } from '../turn/protocol.ts';
import {sameScope} from '../turn/protocol.ts';
import {canonicalPreviewJson,previewSha256,type PreviewBuildState,type PreviewRuntime} from './contract.ts';
import type {PreviewProfileRegistry,TrustedPreviewProfile} from './profiles.ts';
import {validateSavedPreview} from './validator.ts';
import {packageCompatiblePreview} from './packager.ts';
import {storePreviewPackage,type PreviewObjectBucket,type PreviewBuildIntent,type PreviewBuildReceipt,type PreviewReceiptPort} from './storage.ts';
import {discoveryKey,PREVIEW_DISCOVERY_PREFIX,type PreviewDiscovery} from './discovery.ts';
import {BROWSER_BUILD_WAKE_KEY,WORKSPACE_STATE_KEY,TURN_WAKE_KEY,SERVICE_WAKE_KEY,OBSERVER_WAKE_KEY,SIMULATION_WAKE_KEY,applyWorkspaceAlarm} from '../workspace/shared-alarm.ts';
type FrozenSource=Pick<PreviewDiscovery,'identity'|'receipt'>;
const ROW='browser-preview:build:',REFERENCE='browser-preview:reference:',RECEIPT='browser-preview:receipt:';
export interface SavedPreviewBuild {schemaVersion:1;state:PreviewBuildState;source:PreviewDiscovery;profile:TrustedPreviewProfile|null;modelSpec:ModelSpec|null;receipt:PreviewBuildReceipt|null}
const ids:PreviewRuntime['profileId'][]=['python-stdlib/v1','mesa-3.5.1/v1'];
function rowKey(revision:string,profile:string){return ROW+revision+':'+profile;}
function equal(a:unknown,b:unknown){return canonicalPreviewJson(a)===canonicalPreviewJson(b);}
async function project(tx:DurableObjectTransaction){
 const pending=[...(await tx.list<PreviewDiscovery>({prefix:PREVIEW_DISCOVERY_PREFIX})).values()].filter(r=>r.status==='pending');
 const wake=pending.length?Math.min(...pending.map(r=>r.nextAttemptAt!)):null;
 if(wake===null)await tx.delete(BROWSER_BUILD_WAKE_KEY);else await tx.put(BROWSER_BUILD_WAKE_KEY,wake);
 const ws=await tx.get<{wakeAt:number|null}>(WORKSPACE_STATE_KEY);
 await applyWorkspaceAlarm(tx,ws?.wakeAt??null,await tx.get(TURN_WAKE_KEY),await tx.get(SERVICE_WAKE_KEY),await tx.get(OBSERVER_WAKE_KEY),await tx.get(SIMULATION_WAKE_KEY),wake);
}
/** Durable references and receipts are written only by server-resolved builds. */
export class BrowserPreviewBuildHost{
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly ports:{registry:()=>Promise<PreviewProfileRegistry>;files:(source:PreviewDiscovery)=>Promise<Uint8Array>;bucket:PreviewObjectBucket};readonly now:()=>number;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:BrowserPreviewBuildHost['ports'],now=Date.now){this.storage=storage;this.scope=structuredClone(scope);this.ports=ports;this.now=now;}
 read(revision:string,profile?:PreviewRuntime['profileId']):SavedPreviewBuild|null{
  const rows=(profile?[profile]:ids).map(id=>this.storage.kv.get<SavedPreviewBuild>(rowKey(revision,id))).filter((r):r is SavedPreviewBuild=>!!r);
  const row=rows.find(r=>r.state.status==='ready')??rows.find(r=>r.state.status==='building')??rows[0]??null;
  if(row&&!sameScope(row.source.identity.scope,this.scope))throw Error('browser-preview-read-denied');return structuredClone(row);
 }
 receipt(identity:string):PreviewBuildReceipt|null{const r=this.storage.kv.get<PreviewBuildReceipt>(RECEIPT+identity)??null;if(r&&!equal(r.scope,{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId}))throw Error('browser-preview-read-denied');return structuredClone(r);}
 async #write(operation:(tx:DurableObjectTransaction)=>Promise<void>){await this.storage.transaction(async tx=>{await operation(tx);await project(tx);});await this.storage.sync();}
 async #settle(source:PreviewDiscovery,reason:string|null){await this.#write(async tx=>{const r=await tx.get<PreviewDiscovery>(discoveryKey(source.receipt.revisionId));if(!r||!equal(r.identity,source.identity)||!equal(r.receipt,source.receipt))throw Error('preview-discovery-conflict');await tx.put(discoveryKey(source.receipt.revisionId),{...r,status:'settled',nextAttemptAt:null,reasonCode:reason});});}
 #receipts(source:PreviewDiscovery,profile:TrustedPreviewProfile,spec:ModelSpec):PreviewReceiptPort{
  const scope={tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId};
  return {begin:async intent=>{if(!equal(intent.scope,scope)||intent.revisionId!==source.receipt.revisionId)throw Error('browser-preview-reference-denied');await this.#write(async tx=>{const key=REFERENCE+intent.buildIdentity,prior=await tx.get<{intent:PreviewBuildIntent;source:FrozenSource}>(key);const ref={intent,source:{identity:source.identity,receipt:source.receipt}};if(prior&&!equal(prior,ref))throw Error('browser-preview-reference-conflict');await tx.put(key,ref);});},persist:async receipt=>{
   let result=receipt;await this.#write(async tx=>{
    const ref=await tx.get<{intent:PreviewBuildIntent;source:FrozenSource}>(REFERENCE+receipt.buildIdentity);if(!ref||!equal(ref.source,{identity:source.identity,receipt:source.receipt})||!equal(ref.intent,{scope:receipt.scope,revisionId:receipt.revisionId,buildIdentity:receipt.buildIdentity,profileSha256:receipt.profileSha256})||receipt.trust!=='verified-platform')throw Error('browser-preview-reference-denied');
    const prior=await tx.get<PreviewBuildReceipt>(RECEIPT+receipt.packageIdentity);if(prior){const {verifiedAt:a,...old}=prior,{verifiedAt:b,...fresh}=receipt;if(!equal(old,fresh))throw Error('browser-preview-receipt-conflict');result=prior;}else await tx.put(RECEIPT+receipt.packageIdentity,receipt);
    const row:SavedPreviewBuild={schemaVersion:1,source,profile,modelSpec:spec,receipt:result,state:{status:'ready',revisionId:receipt.revisionId,profileId:profile.runtime.profileId,buildIdentity:receipt.buildIdentity,packageIdentity:receipt.packageIdentity,sha256:receipt.sha256,byteLength:receipt.byteLength}};
    await tx.put(rowKey(receipt.revisionId,profile.runtime.profileId),row);
   });return structuredClone(result);
  }};
 }
 /** One source per alarm, three bounded attempts. Intent is rearmed before I/O. */
 #active:Promise<void>|null=null;
 alarm():Promise<void>{if(this.#active)return this.#active;const work=this.#advance();this.#active=work;void work.finally(()=>{if(this.#active===work)this.#active=null;}).catch(()=>{});return work;}
 async #advance():Promise<void>{
  const due=[...(await this.storage.list<PreviewDiscovery>({prefix:PREVIEW_DISCOVERY_PREFIX})).values()].filter(r=>r.status==='pending'&&r.nextAttemptAt!<=this.now()&&sameScope(r.identity.scope,this.scope)).sort((a,b)=>a.nextAttemptAt!-b.nextAttemptAt!)[0];if(!due)return;
  const source={...due,attempts:due.attempts+1,nextAttemptAt:this.now()+Math.min(60000,2000*2**due.attempts)};
  await this.#write(async tx=>{await tx.put(discoveryKey(source.receipt.revisionId),source);});
  try{
   const registry=await this.ports.registry(),bytes=await this.ports.files(source);
   let built=false;
   for(const id of ids){
    const checked=await validateSavedPreview({projectId:this.scope.projectId,revisionId:source.receipt.revisionId,filesSha256:source.receipt.filesSha256},bytes,id,registry);
    if(checked.status==='unsupported'){
     if(!this.read(source.receipt.revisionId,id))await this.#write(async tx=>{await tx.put(rowKey(source.receipt.revisionId,id),{schemaVersion:1,source,profile:registry.resolve(id),modelSpec:null,receipt:null,state:{status:'unsupported',revisionId:source.receipt.revisionId,profileId:id,buildIdentity:await previewSha256(canonicalPreviewJson({revision:source.receipt,profileId:id})),reasonCode:checked.reasonCode}} satisfies SavedPreviewBuild);});continue;
    }
    const value=checked.value,prior=this.read(source.receipt.revisionId,id);
    if(prior?.profile&&!equal(prior.profile.runtime,value.profile.runtime))throw Error('browser-preview-profile-unavailable');
    const pkg=await packageCompatiblePreview(value);
    if(!this.read(source.receipt.revisionId,id)?.receipt)await this.#write(async tx=>{await tx.put(rowKey(source.receipt.revisionId,id),{schemaVersion:1,source,profile:value.profile,modelSpec:value.spec,receipt:null,state:{status:'building',revisionId:source.receipt.revisionId,profileId:id,buildIdentity:pkg.manifest.packageIdentity,attempt:source.attempts}} satisfies SavedPreviewBuild);});
    await storePreviewPackage(this.ports.bucket,this.#receipts(source,value.profile,value.spec),{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId},pkg,{now:this.now});built=true;
   }
   await this.#settle(source,built?null:'browser-preview-unsupported');
  }catch(error){
   if(source.attempts>=3){for(const id of ids){const row=this.read(source.receipt.revisionId,id);if(row?.state.status==='ready')continue;await this.#write(async tx=>{await tx.put(rowKey(source.receipt.revisionId,id),{schemaVersion:1,source,profile:row?.profile??null,modelSpec:row?.modelSpec??null,receipt:null,state:{status:'failed',revisionId:source.receipt.revisionId,profileId:id,buildIdentity:await previewSha256(canonicalPreviewJson({revision:source.receipt,profileId:id})),reasonCode:error instanceof Error&&error.message==='browser-preview-object-conflict'?'object-conflict':'source-unavailable'}} satisfies SavedPreviewBuild);});}await this.#settle(source,'browser-preview-build-failed');}
  }
 }
}
