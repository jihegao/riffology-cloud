import {PreviewPlanResolver,previewSource,type PreviewSource} from '../preview/source.ts';
import { DurableObject } from 'cloudflare:workers';
import { InitialWorkspaceResolver, type InitialWorkspaceReference, type ResolvedInitialWorkspace } from './initial-workspace.ts';
import type { CheckpointReceipt, TurnScope } from '../turn/protocol.ts';
import { positive, sha, turnBaseCheckpoints, turnId } from '../turn/protocol.ts';
import type { TurnCheckpointInput } from './core.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { R2TurnRevisionPort, R2TurnRevisionReader, type FrozenTurnSnapshotPort, type RestoredTurnRevision, type TurnRevisionBucket } from './revision.ts';
import { sweepTurnRevisionBlobs, listed, readManifest, type TurnRevisionGcOptions, type TurnRevisionGcResult } from './revision-gc.ts';
import { REVISION_STORE_ACTOR, revisionCommitDigestInput, revisionCommitIntent, type RevisionCommitInput, type RevisionCommitReconcileInput, type RevisionGcInput, type RevisionGcReconcileInput, type RevisionStoreRpc } from './revision-store-client.ts';
import { workspaceFileDiff, workspaceFileIndex } from './workspace-file-index.ts';
export interface RevisionStoreEnv{
  REVISION_STORE:DurableObjectNamespace<RevisionStore>;
  WORKSPACE_CHECKPOINTS:R2Bucket;
  MODEL_CONTENT?:R2Bucket;
}
type Operation={key:string;kind:'commit'|'gc';inputSha256:string;payloadJson:string;phase:'reserved'|'unknown'};
type Row=Record<string,SqlStorageValue>;
type GcState={version:1;options:{now:number;minAgeMs:number;pageSize:number;maxObjects:number};phase:'scan_manifests'|'scan_blobs'|'delete_candidates'|'completed';manifestCursor:string|null;blobCursor:string|null;scannedManifests:number;scannedBlobs:number;deletedBlobs:number;retainedBlobs:number;deletingKey:string|null;result?:TurnRevisionGcResult};
const encoder=new TextEncoder();
const GC_PHASES=new Set<GcState['phase']>(['scan_manifests','scan_blobs','delete_candidates','completed']);
const GC_BLOB_KEY=/^turn-blobs\/(files|sessions)\/[a-f0-9]{64}$/;
function reject(code:string):never{throw Error(code);}
async function sha256(value:Uint8Array|string):Promise<string>{const bytes=typeof value==='string'?encoder.encode(value):value,digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function commitKey(identity:TurnRuntimeIdentity){return `commit:${identity.scope.tenantId}:${identity.scope.projectId}:${identity.scope.workspaceId}:${identity.generation}:${identity.sessionId}:${identity.turnId}:${identity.dispatchId}`;}
function nonnegative(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<0)reject('invalid-revision-store-gc-state');return value as number;}
function cursor(value:unknown):string|null{if(value===null)return null;if(typeof value!=='string'||!value)reject('invalid-revision-store-gc-state');return value;}
function gcResult(value:unknown):TurnRevisionGcResult{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-revision-store-gc-state');
  const input=value as Record<string,unknown>,keys=['scannedManifests','scannedBlobs','deletedBlobs','retainedBlobs'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))reject('invalid-revision-store-gc-state');
  return {scannedManifests:nonnegative(input.scannedManifests),scannedBlobs:nonnegative(input.scannedBlobs),deletedBlobs:nonnegative(input.deletedBlobs),retainedBlobs:nonnegative(input.retainedBlobs)};
}
function gcState(value:unknown):GcState{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-revision-store-gc-state');
  const input=value as Record<string,unknown>,base=['version','options','phase','manifestCursor','blobCursor','scannedManifests','scannedBlobs','deletedBlobs','retainedBlobs','deletingKey'];
  const keys=Object.hasOwn(input,'result')?[...base,'result']:base;
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.version!==1||typeof input.phase!=='string'||!GC_PHASES.has(input.phase as GcState['phase']))reject('invalid-revision-store-gc-state');
  if(!input.options||typeof input.options!=='object'||Array.isArray(input.options)||Object.getPrototypeOf(input.options)!==Object.prototype)reject('invalid-revision-store-gc-state');
  const options=input.options as Record<string,unknown>,optionKeys=['now','minAgeMs','pageSize','maxObjects'];
  if(Object.keys(options).length!==optionKeys.length||optionKeys.some(key=>!Object.hasOwn(options,key)))reject('invalid-revision-store-gc-state');
  const now=positive(options.now),minAgeMs=positive(options.minAgeMs),pageSize=positive(options.pageSize),maxObjects=positive(options.maxObjects);
  if(pageSize>1000||maxObjects>10000)reject('invalid-revision-store-gc-state');
  const phase=input.phase as GcState['phase'],deletingKey=input.deletingKey===null?null:typeof input.deletingKey==='string'&&GC_BLOB_KEY.test(input.deletingKey)?input.deletingKey:reject('invalid-revision-store-gc-state');
  if(deletingKey!==null&&phase!=='delete_candidates')reject('invalid-revision-store-gc-state');
  const state:GcState={version:1,options:{now,minAgeMs,pageSize,maxObjects},phase,manifestCursor:cursor(input.manifestCursor),blobCursor:cursor(input.blobCursor),scannedManifests:nonnegative(input.scannedManifests),scannedBlobs:nonnegative(input.scannedBlobs),deletedBlobs:nonnegative(input.deletedBlobs),retainedBlobs:nonnegative(input.retainedBlobs),deletingKey};
  if(phase==='completed'){
    if(!Object.hasOwn(input,'result')||deletingKey!==null)reject('invalid-revision-store-gc-state');
    state.result=gcResult(input.result);
    if(JSON.stringify(state.result)!==JSON.stringify({scannedManifests:state.scannedManifests,scannedBlobs:state.scannedBlobs,deletedBlobs:state.deletedBlobs,retainedBlobs:state.retainedBlobs}))reject('invalid-revision-store-gc-state');
  }else if(Object.hasOwn(input,'result'))reject('invalid-revision-store-gc-state');
  return state;
}

/** One actor owns the whole Revision bucket. Its in-memory chain prevents
 * interleaving across awaits while the persisted operation fence survives an
 * eviction. An unknown writer/GC operation must be reconciled by the exact
 * same operation before another mutating operation can start. */
export class RevisionStore extends DurableObject<RevisionStoreEnv> implements RevisionStoreRpc{
  #tail:Promise<unknown>;
  constructor(ctx:DurableObjectState,env:RevisionStoreEnv){
    super(ctx,env);
    ctx.storage.transactionSync(()=>{ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_store_operation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('commit','gc')), input_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('reserved','unknown'))) STRICT;");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_gc_reference (operation_key TEXT NOT NULL, object_key TEXT NOT NULL, PRIMARY KEY(operation_key,object_key)) STRICT");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_gc_candidate (operation_key TEXT NOT NULL, object_key TEXT NOT NULL, uploaded_at INTEGER NOT NULL, PRIMARY KEY(operation_key,object_key)) STRICT");ctx.storage.sql.exec("UPDATE revision_store_operation SET phase='unknown' WHERE phase='reserved'");});this.#tail=ctx.storage.sync();
  }
  #owned(){if(!this.env.REVISION_STORE.idFromName(REVISION_STORE_ACTOR).equals(this.ctx.id))reject('revision-store-actor-scope-denied');if(!this.env.WORKSPACE_CHECKPOINTS?.get||!this.env.WORKSPACE_CHECKPOINTS.put||!this.env.WORKSPACE_CHECKPOINTS.list||!this.env.WORKSPACE_CHECKPOINTS.delete)reject('revision-store-r2-required');}
  #serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.#tail.then(work,work);this.#tail=next.catch(()=>{});return next;}
  #active():Operation|null{const row=this.ctx.storage.sql.exec<Row>('SELECT operation_key,kind,input_sha256,payload_json,phase FROM revision_store_operation WHERE singleton=1').toArray()[0];return row?{key:String(row.operation_key),kind:String(row.kind) as Operation['kind'],inputSha256:String(row.input_sha256),payloadJson:String(row.payload_json),phase:String(row.phase) as Operation['phase']}:null;}
  #completedGc(active:Operation):boolean{return active.kind==='gc'&&gcState(JSON.parse(active.payloadJson)).phase==='completed';}
  #assertReadable(){const active=this.#active();if(active&&!this.#completedGc(active))reject('revision-store-operation-in-progress');}
  async #reserve(operation:Operation){const active=this.#active();if(active){if(this.#completedGc(active))this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM revision_gc_reference WHERE operation_key=?',active.key);this.ctx.storage.sql.exec('DELETE FROM revision_gc_candidate WHERE operation_key=?',active.key);this.ctx.storage.sql.exec('DELETE FROM revision_store_operation WHERE singleton=1');});else reject(active.phase==='unknown'?'revision-store-operation-unknown':'revision-store-operation-in-progress');}this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT INTO revision_store_operation VALUES(1,?,?,?,?,?)',operation.key,operation.kind,operation.inputSha256,operation.payloadJson,'reserved'));await this.ctx.storage.sync();}
  async #phase(phase:Operation['phase']){this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('UPDATE revision_store_operation SET phase=? WHERE singleton=1',phase));await this.ctx.storage.sync();}
  async #clear(){this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('DELETE FROM revision_store_operation WHERE singleton=1'));await this.ctx.storage.sync();}
  async #gcState(state:GcState,phase:Operation['phase']='reserved'){const payloadJson=JSON.stringify(state);this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('UPDATE revision_store_operation SET payload_json=?,phase=? WHERE singleton=1',payloadJson,phase));await this.ctx.storage.sync();}
  #gcOptions(raw:RevisionGcInput){const pageSize=raw.pageSize??100,maxObjects=raw.maxObjects??500;if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isSafeInteger(maxObjects)||maxObjects<1||maxObjects>10000)reject('invalid-turn-revision-gc-limit');return {now:positive(raw.now),minAgeMs:positive(raw.minAgeMs),pageSize,maxObjects};}
  async #runGc(rawState:GcState):Promise<TurnRevisionGcResult>{const state=gcState(rawState),bucket=this.env.WORKSPACE_CHECKPOINTS;const key=()=>String(this.#active()?.key);if(state.deletingKey){const gone=await bucket.get(state.deletingKey);if(gone){await gone.body?.cancel().catch(()=>{});await bucket.delete(state.deletingKey);}this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('DELETE FROM revision_gc_candidate WHERE operation_key=? AND object_key=?',key(),state.deletingKey));state.deletedBlobs++;state.deletingKey=null;await this.#gcState(state);}
    while(state.phase!=='completed'){
      if(state.phase==='scan_manifests'||state.phase==='scan_blobs'){
        const prefix=state.phase==='scan_manifests'?'turns/':'turn-blobs/',cursor=state.phase==='scan_manifests'?state.manifestCursor:state.blobCursor;
        const raw=await bucket.list({prefix,cursor:cursor??undefined,limit:state.options.pageSize});if(!raw||!Array.isArray(raw.objects)||typeof raw.truncated!=='boolean'||(raw.truncated&&(typeof raw.cursor!=='string'||!raw.cursor)))reject('invalid-turn-revision-gc-list');
        const items=raw.objects.map(item=>listed(item));
        if(state.phase==='scan_manifests') for(const item of items){if(!/^turns\/.+\.json$/.test(item.key))continue;if(++state.scannedManifests>state.options.maxObjects)reject('turn-revision-gc-limit');for(const ref of await readManifest(bucket,item.key))this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT OR IGNORE INTO revision_gc_reference VALUES(?,?)',key(),ref));}
        else for(const item of items){if(!/^turn-blobs\/(files|sessions)\/[a-f0-9]{64}$/.test(item.key))continue;if(++state.scannedBlobs>state.options.maxObjects)reject('turn-revision-gc-limit');const referenced=!!this.ctx.storage.sql.exec('SELECT 1 FROM revision_gc_reference WHERE operation_key=? AND object_key=?',key(),item.key).toArray()[0];if(referenced||state.options.now-item.uploaded.getTime()<state.options.minAgeMs)state.retainedBlobs++;else this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT OR IGNORE INTO revision_gc_candidate VALUES(?,?,?)',key(),item.key,item.uploaded.getTime()));}
        const next=raw.truncated?raw.cursor!:null;if(state.phase==='scan_manifests')state.manifestCursor=next;else state.blobCursor=next;if(!next&&state.phase==='scan_manifests'){state.phase='scan_blobs';state.blobCursor=null;}else if(!next)state.phase='delete_candidates';await this.#gcState(state);continue;
      }
      const row=this.ctx.storage.sql.exec<Row>('SELECT object_key FROM revision_gc_candidate WHERE operation_key=? ORDER BY object_key LIMIT 1',key()).toArray()[0];if(!row){state.phase='completed';state.result={scannedManifests:state.scannedManifests,scannedBlobs:state.scannedBlobs,deletedBlobs:state.deletedBlobs,retainedBlobs:state.retainedBlobs};await this.#gcState(state,'unknown');break;}const candidate=String(row.object_key);if(!GC_BLOB_KEY.test(candidate))reject('invalid-revision-store-gc-state');state.deletingKey=candidate;await this.#gcState(state);await bucket.delete(state.deletingKey);this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('DELETE FROM revision_gc_candidate WHERE operation_key=? AND object_key=?',key(),state.deletingKey));state.deletedBlobs++;state.deletingKey=null;await this.#gcState(state);
    }return state.result!;}
  async commit(raw:RevisionCommitInput):Promise<CheckpointReceipt>{return this.#serial(async()=>{
    this.#owned();const identity=turnRuntimeIdentity(raw.identity),base=turnBaseCheckpoints(raw.base),input:TurnCheckpointInput={identity,outcome:raw.outcome,executionErrorCode:raw.executionErrorCode===null?null:turnId(raw.executionErrorCode),base},intent=await revisionCommitIntent(input,raw.snapshot),payloadJson=JSON.stringify(revisionCommitDigestInput(input,await sha256(raw.snapshot.filesArchive),raw.snapshot.filesArchive.byteLength,await sha256(raw.snapshot.piSession),raw.snapshot.piSession.byteLength)),inputSha256=intent.inputSha256,key=intent.operationId;
    await this.#reserve({key,kind:'commit',inputSha256,payloadJson,phase:'reserved'});
    const snapshots:FrozenTurnSnapshotPort={async freeze(){return raw.snapshot;}};
    const port=new R2TurnRevisionPort(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,snapshots,Date.now,this.env.MODEL_CONTENT);
    try{const receipt=await port.commit({identity,outcome:raw.outcome,executionErrorCode:raw.executionErrorCode,base});await this.#clear();return receipt;}
    catch(error){
      try{await port.observe(identity);await this.#clear();}catch{await this.#phase('unknown');}
      throw error;
    }
  });}
  async #previewFiles(raw:PreviewSource):Promise<Uint8Array>{
    const source=previewSource(raw);
    if(source.kind==='saved-turn')return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).files(source.identity,source.revision);
    const resolved=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(source.reference,source.reference.scope);
    if(resolved.filesSha256!==source.filesSha256)throw Error('preview-revision-mismatch');
    return resolved.filesArchive;
  }
  previewPlan(raw:PreviewSource){return this.#serial(async()=>{this.#owned();this.#assertReadable();return new PreviewPlanResolver({files:s=>this.#previewFiles(s)}).resolve(raw);});}
  serviceFiles(raw:PreviewSource):Promise<Uint8Array>{return this.#serial(async()=>{this.#owned();this.#assertReadable();return this.#previewFiles(raw);});}
  initialPreviewPlan(reference:InitialWorkspaceReference,expectedScope:TurnScope){const source=previewSource({kind:'initial-workspace',reference,filesSha256:'0'.repeat(64)});if(source.kind!=='initial-workspace')throw Error('invalid-preview-source');return this.#serial(async()=>{this.#owned();this.#assertReadable();const resolved=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(source.reference,expectedScope);return new PreviewPlanResolver({async files(){return resolved.filesArchive;}}).resolve({kind:'initial-workspace',reference:resolved.reference,filesSha256:resolved.filesSha256});});}
  observe(raw:TurnRuntimeIdentity):Promise<CheckpointReceipt|null>{return this.#serial(async()=>{this.#owned();this.#assertReadable();const identity=turnRuntimeIdentity(raw),reader=new R2TurnRevisionPort(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,{async freeze(){reject('revision-store-observe-cannot-freeze');}});return reader.observe(identity);});}
  reconcileCommit(raw:RevisionCommitReconcileInput):Promise<CheckpointReceipt|null>{return this.#serial(async()=>{this.#owned();const identity=turnRuntimeIdentity(raw.identity),operationId=typeof raw.operationId==='string'?raw.operationId:reject('revision-store-reconcile-conflict'),inputSha256=sha(raw.inputSha256),key=commitKey(identity);if(operationId!==key)reject('revision-store-reconcile-conflict');const active=this.#active();if(active&&(active.kind!=='commit'||active.key!==operationId||active.inputSha256!==inputSha256))reject('revision-store-reconcile-conflict');if(active?.phase==='reserved')reject('revision-store-operation-in-progress');const saved=await new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).inspect(identity);if(!saved)return null;const actual=revisionCommitDigestInput({identity,outcome:saved.outcome,executionErrorCode:saved.executionErrorCode,base:saved.base},saved.files.sha256,saved.files.size,saved.piSession.sha256,saved.piSession.size),actualSha256=await sha256(JSON.stringify(actual));if(actualSha256!==inputSha256)reject('revision-store-reconcile-conflict');if(active){const expected=JSON.parse(active.payloadJson) as Record<string,unknown>;if(JSON.stringify(actual)!==JSON.stringify(expected))reject('revision-store-reconcile-conflict');await this.#clear();}return saved.receipt;});}
  resolveInitial(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedInitialWorkspace>{return this.#serial(async()=>{this.#owned();this.#assertReadable();return new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(reference,scope);});}
  restore(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound=false):Promise<RestoredTurnRevision>{return this.#serial(async()=>{this.#owned();this.#assertReadable();return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).restore(turnRuntimeIdentity(raw),receipt,sessionBound);});}
  files(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt){return this.#serial(async()=>{this.#owned();this.#assertReadable();const archive=await new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).files(turnRuntimeIdentity(raw),receipt);return workspaceFileIndex(archive);});}
  diff(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt){return this.#serial(async()=>{
    this.#owned();this.#assertReadable();
    const identity=turnRuntimeIdentity(raw),reader=new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS),current=await reader.workspaceFiles(identity,receipt);
    let base:Uint8Array|null=null;
    if(current.base)base=await reader.files(identity,current.base);
    else if(current.initial){
      const initial=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(current.initial.reference,identity.scope);
      if(initial.filesSha256!==current.initial.filesSha256)reject('initial-workspace-files-mismatch');
      base=initial.filesArchive;
    }
    return workspaceFileDiff(current.filesArchive,base);
  });}
  load(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt|null):Promise<Uint8Array|null>{return this.#serial(async()=>{this.#owned();this.#assertReadable();return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).load(turnRuntimeIdentity(raw),receipt);});}
  gc(raw:RevisionGcInput):Promise<TurnRevisionGcResult>{return this.#serial(async()=>{this.#owned();const operationId=turnId(raw.operationId),options=this.#gcOptions(raw),descriptor=JSON.stringify(options),inputSha256=await sha256(descriptor),key=`gc:${operationId}`;await this.#reserve({key,kind:'gc',inputSha256,payloadJson:JSON.stringify({version:1,options,phase:'scan_manifests',manifestCursor:null,blobCursor:null,scannedManifests:0,scannedBlobs:0,deletedBlobs:0,retainedBlobs:0,deletingKey:null}),phase:'reserved'});const state:GcState={version:1,options,phase:'scan_manifests',manifestCursor:null,blobCursor:null,scannedManifests:0,scannedBlobs:0,deletedBlobs:0,retainedBlobs:0,deletingKey:null};try{return await this.#runGc(state);}catch(error){await this.#phase('unknown');throw error;}});}
  reconcileGc(raw:RevisionGcReconcileInput):Promise<TurnRevisionGcResult|null>{return this.#serial(async()=>{this.#owned();const inputSha256=sha(raw.inputSha256),active=this.#active();if(!active||active.kind!=='gc'||active.key!==`gc:${turnId(raw.operationId)}`||active.inputSha256!==inputSha256)reject('revision-store-gc-reconcile-conflict');if(active.phase==='reserved')reject('revision-store-operation-in-progress');return this.#runGc(gcState(JSON.parse(active.payloadJson)));});}
}
