import type { ModelSpec } from '../simulation/model-spec.ts';
import type { TurnScope } from '../turn/protocol.ts';
import {sameScope} from '../turn/protocol.ts';
import {canonicalPreviewJson,previewSha256,type PreviewBuildState,type PreviewRuntime} from './contract.ts';
import {createTrustedPreviewRegistry,type PreviewProfileRegistry,type TrustedPreviewProfile} from './profiles.ts';
import {validateSavedPreview} from './validator.ts';
import {packageCompatiblePreview} from './packager.ts';
import {storePreviewPackage,type PreviewObjectBucket,type PreviewBuildIntent,type PreviewBuildReceipt,type PreviewReceiptPort} from './storage.ts';
import {discoveryKey,PREVIEW_DISCOVERY_PREFIX,type PreviewDiscovery} from './discovery.ts';
import {BROWSER_BUILD_WAKE_KEY,WORKSPACE_STATE_KEY,TURN_WAKE_KEY,SERVICE_WAKE_KEY,OBSERVER_WAKE_KEY,SIMULATION_WAKE_KEY,applyWorkspaceAlarm} from '../workspace/shared-alarm.ts';
import {sourceScope,sourceRevision,sourceFilesSha,frozenSource,type BrowserBuildSource,type InitialBrowserSource} from './source.ts';
import type { ResolvedInitialWorkspace } from '../turn-runtime/initial-workspace.ts';
type FrozenSource=BrowserBuildSource;
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
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly ports:{registry:()=>Promise<PreviewProfileRegistry>;files:(source:PreviewDiscovery)=>Promise<Uint8Array>;resolveInitial?:(source:InitialBrowserSource)=>Promise<ResolvedInitialWorkspace>;checkSource?:(source:BrowserBuildSource)=>void;bucket:PreviewObjectBucket};readonly now:()=>number;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:BrowserPreviewBuildHost['ports'],now=Date.now){this.storage=storage;this.scope=structuredClone(scope);this.ports=ports;this.now=now;}
 read(revision:string,profile?:PreviewRuntime['profileId']):SavedPreviewBuild|null{
  const rows=(profile?[profile]:ids).map(id=>this.storage.kv.get<SavedPreviewBuild>(rowKey(revision,id))).filter((r):r is SavedPreviewBuild=>!!r);
  const row=rows.find(r=>r.state.status==='ready')??rows.find(r=>r.state.status==='building')??rows.find(r=>r.state.status==='failed')??rows[0]??null;
  if(row&&!sameScope(sourceScope(row.source),this.scope))throw Error('browser-preview-read-denied');return structuredClone(row);
 }
 receipt(identity:string):PreviewBuildReceipt|null{const r=this.storage.kv.get<PreviewBuildReceipt>(RECEIPT+identity)??null;if(r&&!equal(r.scope,{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId}))throw Error('browser-preview-read-denied');return structuredClone(r);}
 source(revision:string):PreviewDiscovery|null{const source=this.storage.kv.get<PreviewDiscovery>(discoveryKey(revision))??null;if(source&&!sameScope(sourceScope(source),this.scope))throw Error('browser-preview-read-denied');return structuredClone(source);}
 initial():PreviewDiscovery|null{const revision=this.storage.kv.get<string>('browser-preview:initial-source');return revision?this.source(revision):null;}
 async #guard(source:PreviewDiscovery){this.ports.checkSource?.(source);const current=await this.storage.get<PreviewDiscovery>(discoveryKey(sourceRevision(source)));if(!current||!equal(current,source))throw Error('preview-discovery-conflict');this.ports.checkSource?.(source);}
 async #checkTransactionSource(tx:DurableObjectTransaction,source:PreviewDiscovery){const current=await tx.get<PreviewDiscovery>(discoveryKey(sourceRevision(source)));this.ports.checkSource?.(source);if(!current||!equal(current,source))throw Error('preview-discovery-conflict');}
 async #write(operation:(tx:DurableObjectTransaction)=>Promise<void>,source?:PreviewDiscovery){await this.storage.transaction(async tx=>{
   const guarded=source?new Proxy(tx,{get:(target,key)=>key==='put'?async(...args:Parameters<DurableObjectTransaction['put']>)=>{await this.#checkTransactionSource(target,source);return target.put(...args);}:typeof target[key as keyof DurableObjectTransaction]==='function'?(target[key as keyof DurableObjectTransaction] as Function).bind(target):target[key as keyof DurableObjectTransaction]}):tx;
   await operation(guarded);await project(tx);
  });await this.storage.sync();}
 async #settle(source:PreviewDiscovery,reason:string|null){await this.#write(async tx=>{const r=await tx.get<PreviewDiscovery>(discoveryKey(sourceRevision(source)));if(!r||!equal(frozenSource(r),frozenSource(source)))throw Error('preview-discovery-conflict');await tx.put(discoveryKey(sourceRevision(source)),{...r,status:'settled',nextAttemptAt:null,reasonCode:reason});},source);}
 #receipts(source:PreviewDiscovery,profile:TrustedPreviewProfile,spec:ModelSpec):PreviewReceiptPort{
  const scope={tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId};
  return {begin:async intent=>{await this.#guard(source);if(!equal(intent.scope,scope)||intent.revisionId!==sourceRevision(source))throw Error('browser-preview-reference-denied');await this.#write(async tx=>{const key=REFERENCE+intent.buildIdentity,prior=await tx.get<{intent:PreviewBuildIntent;source:FrozenSource}>(key);const ref={intent,source:frozenSource(source)};if(prior&&!equal(prior,ref))throw Error('browser-preview-reference-conflict');await tx.put(key,ref);},source);},persist:async receipt=>{
   await this.#guard(source);let result=receipt;await this.#write(async tx=>{
    const ref=await tx.get<{intent:PreviewBuildIntent;source:FrozenSource}>(REFERENCE+receipt.buildIdentity);if(!ref||!equal(ref.source,frozenSource(source))||!equal(ref.intent,{scope:receipt.scope,revisionId:receipt.revisionId,buildIdentity:receipt.buildIdentity,profileSha256:receipt.profileSha256})||receipt.trust!=='verified-platform')throw Error('browser-preview-reference-denied');
    const prior=await tx.get<PreviewBuildReceipt>(RECEIPT+receipt.packageIdentity);if(prior){const {verifiedAt:a,...old}=prior,{verifiedAt:b,...fresh}=receipt;if(!equal(old,fresh))throw Error('browser-preview-receipt-conflict');result=prior;}else await tx.put(RECEIPT+receipt.packageIdentity,receipt);
    const row:SavedPreviewBuild={schemaVersion:1,source,profile,modelSpec:spec,receipt:result,state:{status:'ready',revisionId:receipt.revisionId,profileId:profile.runtime.profileId,buildIdentity:receipt.buildIdentity,packageIdentity:receipt.packageIdentity,sha256:receipt.sha256,byteLength:receipt.byteLength}};
    await tx.put(rowKey(receipt.revisionId,profile.runtime.profileId),row);
   },source);return structuredClone(result);
  }};
 }
 retryReceipt(serverKey:string):{revisionId:string;profileId:PreviewRuntime['profileId'];buildIdentity:string}|null{return structuredClone(this.storage.kv.get<{revisionId:string;profileId:PreviewRuntime['profileId'];buildIdentity:string}>('browser-preview:retry:'+serverKey)??null);}
 /** Explicit recovery only; the same key never resets an accepted retry. */
 async retry(revisionId:string,profileId:PreviewRuntime['profileId'],buildIdentity:string,serverKey:string):Promise<void>{
  const intent={revisionId,profileId,buildIdentity};
  await this.#write(async tx=>{
   const prior=await tx.get('browser-preview:retry:'+serverKey);if(prior){if(!equal(prior,intent))throw Error('browser-preview-idempotency-conflict');return;}
   const row=await tx.get<SavedPreviewBuild>(rowKey(revisionId,profileId));
   if(!row||!sameScope(sourceScope(row.source),this.scope)||row.state.status!=='failed'||row.state.buildIdentity!==buildIdentity)throw Error('browser-preview-retry-conflict');
   const discovery=await tx.get<PreviewDiscovery>(discoveryKey(revisionId));if(!discovery||!equal(frozenSource(discovery),frozenSource(row.source)))throw Error('browser-preview-source-unavailable');
   await tx.put('browser-preview:retry:'+serverKey,intent);await tx.put(discoveryKey(revisionId),{...discovery,status:'pending',attempts:0,nextAttemptAt:this.now(),reasonCode:null});
   await tx.put(rowKey(revisionId,profileId),{...row,state:{status:'building',revisionId,profileId,buildIdentity,attempt:0}});
  });
 }
 /** One source per alarm, three bounded attempts. Intent is rearmed before I/O. */
 async #fail(source:PreviewDiscovery,error:unknown){for(const id of ids){const row=this.read(sourceRevision(source),id);if(row?.state.status==='ready'||row?.state.status==='unsupported')continue;await this.#write(async tx=>{await tx.put(rowKey(sourceRevision(source),id),{schemaVersion:1,source,profile:row?.profile??null,modelSpec:row?.modelSpec??null,receipt:null,state:{status:'failed',revisionId:sourceRevision(source),profileId:id,buildIdentity:row&&'buildIdentity' in row.state?row.state.buildIdentity:await previewSha256(canonicalPreviewJson({revision:frozenSource(source),profileId:id})),reasonCode:error instanceof Error&&error.message==='browser-preview-object-conflict'?'object-conflict':'source-unavailable'}} satisfies SavedPreviewBuild);},source);}await this.#settle(source,'browser-preview-build-failed');}
 #active:Promise<void>|null=null;
 alarm():Promise<void>{if(this.#active)return this.#active;const work=this.#advance();this.#active=work;void work.finally(()=>{if(this.#active===work)this.#active=null;}).catch(()=>{});return work;}
 async #advance():Promise<void>{
  const due=[...(await this.storage.list<PreviewDiscovery>({prefix:PREVIEW_DISCOVERY_PREFIX})).values()].filter(r=>r.status==='pending'&&r.nextAttemptAt!<=this.now()&&sameScope(sourceScope(r),this.scope)).sort((a,b)=>a.nextAttemptAt!-b.nextAttemptAt!)[0];if(!due)return;
  if(due.attempts>=3){await this.#fail(due,Error('browser-preview-attempts-exhausted'));return;}
  let source:PreviewDiscovery={...due,attempts:due.attempts+1,nextAttemptAt:this.now()+Math.min(60000,2000*2**due.attempts)};
  await this.#write(async tx=>{await tx.put(discoveryKey(sourceRevision(source)),source);},due);
  try{
   const registry=await this.ports.registry();await this.#guard(source);
   let bytes:Uint8Array;
   if(source.kind==='initial-workspace'){
    if(!this.ports.resolveInitial)throw Error('browser-preview-source-unavailable');
    const resolved=await this.ports.resolveInitial(source);await this.#guard(source);
    if(!equal(resolved.reference,source.reference)||resolved.referenceSha256!==source.referenceSha256||!sameScope(resolved.reference.scope,this.scope)||source.filesSha256!==null&&source.filesSha256!==resolved.filesSha256)throw Error('browser-preview-source-unavailable');
    const next:PreviewDiscovery={...source,filesSha256:resolved.filesSha256};
    await this.#write(async tx=>{const current=await tx.get<PreviewDiscovery>(discoveryKey(sourceRevision(source)));if(!current||!equal(current,source))throw Error('preview-discovery-conflict');this.ports.checkSource?.(source);await tx.put(discoveryKey(sourceRevision(source)),next);},source);
    source=next;bytes=resolved.filesArchive;
   }else{bytes=await this.ports.files(source);await this.#guard(source);}
   const filesSha=sourceFilesSha(source);if(!filesSha)throw Error('browser-preview-source-unavailable');
   let built=false;
   for(const id of ids){
    const priorState=this.read(sourceRevision(source),id)?.state;
    if(priorState?.status==='ready'){built=true;continue;}
    if(priorState?.status==='unsupported')continue;
    const frozen=this.read(sourceRevision(source),id)?.profile;
    await this.#guard(source);
    const selected=frozen?.trust==='verified-platform'?await createTrustedPreviewRegistry([frozen]):registry;
    const checked=await validateSavedPreview({projectId:this.scope.projectId,revisionId:sourceRevision(source),filesSha256:sourceFilesSha(source)!},bytes,id,selected);
    if(checked.status==='unsupported'){
     if(this.read(sourceRevision(source),id))throw Error('browser-preview-source-unavailable');
     if(!this.read(sourceRevision(source),id))await this.#write(async tx=>{await tx.put(rowKey(sourceRevision(source),id),{schemaVersion:1,source,profile:registry.resolve(id),modelSpec:null,receipt:null,state:{status:'unsupported',revisionId:sourceRevision(source),profileId:id,buildIdentity:await previewSha256(canonicalPreviewJson({revision:frozenSource(source),profileId:id})),reasonCode:checked.reasonCode}} satisfies SavedPreviewBuild);},source);continue;
    }
    await this.#guard(source);
    const value=checked.value,prior=this.read(sourceRevision(source),id);
    if(prior?.profile&&!equal(prior.profile.runtime,value.profile.runtime))throw Error('browser-preview-profile-unavailable');
    const pkg=await packageCompatiblePreview(value);await this.#guard(source);
    if(!this.read(sourceRevision(source),id)?.receipt)await this.#write(async tx=>{await tx.put(rowKey(sourceRevision(source),id),{schemaVersion:1,source,profile:value.profile,modelSpec:value.spec,receipt:null,state:{status:'building',revisionId:sourceRevision(source),profileId:id,buildIdentity:pkg.manifest.packageIdentity,attempt:source.attempts}} satisfies SavedPreviewBuild);},source);
    await storePreviewPackage(this.ports.bucket,this.#receipts(source,value.profile,value.spec),{tenantId:this.scope.tenantId,projectId:this.scope.projectId,workspaceId:this.scope.workspaceId},pkg,{now:this.now});built=true;
   }
   await this.#settle(source,built?null:'browser-preview-unsupported');
  }catch(error){
   if(source.attempts>=3)await this.#fail(source,error);
  }
 }
}
