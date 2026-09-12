import {PreviewPlanResolver,previewSource,type PreviewSource} from '../preview/source.ts';
import { DurableObject } from 'cloudflare:workers';
import { InitialWorkspaceResolver, type InitialWorkspaceReference, type ResolvedInitialWorkspace } from './initial-workspace.ts';
import type { CheckpointReceipt, TurnScope } from '../turn/protocol.ts';
import { positive, scope as turnScope, sha, turnBaseCheckpoints, turnId } from '../turn/protocol.ts';
import type { TurnCheckpointInput, TurnCheckpointIntent } from './core.ts';
import { turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { frozenTurnSnapshot, readFrozenTurnSnapshot, R2TurnRevisionPort, R2TurnRevisionReader, stageFrozenTurnSnapshot, turnRevisionBlobPrefix, turnRevisionManifestPrefix, type FrozenTurnSnapshotDescriptor, type FrozenTurnSnapshotPort, type RestoredTurnRevision, type TurnRevisionBucket } from './revision.ts';
import { listed, readManifest, turnRevisionGcMaxR2Calls, type TurnRevisionGcOptions, type TurnRevisionGcResolution, type TurnRevisionGcResult } from './revision-gc.ts';
import { revisionStoreActorName, revisionCommitDigestInput, revisionCommitIntent, type RevisionCommitInput, type RevisionCommitPreparedInput, type RevisionCommitReconcileInput, type RevisionCommitResolution, type RevisionGcInput, type RevisionGcMaintenanceInput, type RevisionGcReconcileInput, type RevisionStoreRpc } from './revision-store-client.ts';
import { workspaceFileDiff, workspaceFileIndex } from './workspace-file-index.ts';
export interface RevisionStoreEnv{
  REVISION_STORE:DurableObjectNamespace<RevisionStore>;
  WORKSPACE_CHECKPOINTS:R2Bucket;
  MODEL_CONTENT?:R2Bucket;
}
type Operation={key:string;kind:'commit'|'gc';inputSha256:string;payloadJson:string;phase:'reserved'|'unknown'};
type CommitDescriptor={schemaVersion:2;identity:TurnRuntimeIdentity;outcome:RevisionCommitInput['outcome'];executionErrorCode:string|null;base:RevisionCommitInput['base'];snapshot:FrozenTurnSnapshotDescriptor;committedAt:number};
type Row=Record<string,SqlStorageValue>;
type GcPhase='scan_manifests'|'scan_blobs'|'delete_candidates'|'completed';
type GcStatus='running'|'yielded'|'unknown'|'completed';
type GcCandidate={kind:'manifest'|'blob';objectKey:string;uploadedAt:number;nextCursor:string|null};
type GcPageKind=GcCandidate['kind']|null;
/** Version 3 separates a normal cooperative yield from an uncertain external
 * effect and persists each listed page before advancing its opaque cursor.
 * deletingKey is persisted before delete so lost acknowledgements are safe. */
type GcState={version:3;scope:TurnScope;options:{now:number;minAgeMs:number;pageSize:number;maxObjects:number};status:GcStatus;phase:GcPhase;manifestCursor:string|null;blobCursor:string|null;pageKind:GcPageKind;pageNextCursor:string|null;candidate:GcCandidate|null;scannedManifests:number;scannedBlobs:number;deletedBlobs:number;retainedBlobs:number;deletingKey:string|null;result?:TurnRevisionGcResult};
const encoder=new TextEncoder();
const GC_PHASES=new Set<GcPhase>(['scan_manifests','scan_blobs','delete_candidates','completed']);
const GC_STATUSES=new Set<GcStatus>(['running','yielded','unknown','completed']);
const GC_BLOB_KEY=/^turn-blobs-v3\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/(files|sessions)\/[a-f0-9]{64}$/;
const GC_RETRY_MS=60_000;
const GC_MAINTENANCE_PERIOD_MS=24*60*60*1000;
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
function gcCandidate(value:unknown):GcCandidate|null{
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-revision-store-gc-state');
  const input=value as Record<string,unknown>,keys=['kind','objectKey','uploadedAt','nextCursor'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||!['manifest','blob'].includes(String(input.kind))||typeof input.objectKey!=='string'||!input.objectKey)reject('invalid-revision-store-gc-state');
  return {kind:input.kind as GcCandidate['kind'],objectKey:input.objectKey,uploadedAt:positive(input.uploadedAt),nextCursor:cursor(input.nextCursor)};
}
function gcState(value:unknown,fallbackScope?:TurnScope):GcState{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-revision-store-gc-state');
  let input=value as Record<string,unknown>;
  if(input.version===1){
    if(!fallbackScope)reject('invalid-revision-store-gc-state');
    const legacyBase=['version','options','phase','manifestCursor','blobCursor','scannedManifests','scannedBlobs','deletedBlobs','retainedBlobs','deletingKey'],legacyKeys=Object.hasOwn(input,'result')?[...legacyBase,'result']:legacyBase;
    if(Object.keys(input).length!==legacyKeys.length||legacyKeys.some(key=>!Object.hasOwn(input,key)))reject('invalid-revision-store-gc-state');
    input={...input,version:3,scope:turnScope(fallbackScope),status:input.phase==='completed'?'completed':'unknown',pageKind:null,pageNextCursor:null,candidate:null};
  }else if(input.version===2){
    input={...input,version:3,pageKind:null,pageNextCursor:null};
  }
  const base=['version','scope','options','status','phase','manifestCursor','blobCursor','pageKind','pageNextCursor','candidate','scannedManifests','scannedBlobs','deletedBlobs','retainedBlobs','deletingKey'];
  const keys=Object.hasOwn(input,'result')?[...base,'result']:base;
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.version!==3||typeof input.phase!=='string'||!GC_PHASES.has(input.phase as GcPhase)||typeof input.status!=='string'||!GC_STATUSES.has(input.status as GcStatus))reject('invalid-revision-store-gc-state');
  if(!input.options||typeof input.options!=='object'||Array.isArray(input.options)||Object.getPrototypeOf(input.options)!==Object.prototype)reject('invalid-revision-store-gc-state');
  const options=input.options as Record<string,unknown>,optionKeys=['now','minAgeMs','pageSize','maxObjects'];
  if(Object.keys(options).length!==optionKeys.length||optionKeys.some(key=>!Object.hasOwn(options,key)))reject('invalid-revision-store-gc-state');
  const now=positive(options.now),minAgeMs=positive(options.minAgeMs),pageSize=positive(options.pageSize),maxObjects=positive(options.maxObjects);
  if(pageSize>1000||maxObjects>10000)reject('invalid-revision-store-gc-state');
  const scope=turnScope(input.scope),status=input.status as GcStatus,phase=input.phase as GcPhase,candidate=gcCandidate(input.candidate),pageKind=input.pageKind===null?null:input.pageKind==='manifest'||input.pageKind==='blob'?input.pageKind:reject('invalid-revision-store-gc-state'),pageNextCursor=cursor(input.pageNextCursor),deletingKey=input.deletingKey===null?null:typeof input.deletingKey==='string'&&GC_BLOB_KEY.test(input.deletingKey)?input.deletingKey:reject('invalid-revision-store-gc-state');
  if(deletingKey!==null&&phase!=='delete_candidates'||candidate!==null&&!((candidate.kind==='manifest'&&phase==='scan_manifests')||(candidate.kind==='blob'&&phase==='scan_blobs'))||pageKind!==null&&!((pageKind==='manifest'&&phase==='scan_manifests')||(pageKind==='blob'&&phase==='scan_blobs')))reject('invalid-revision-store-gc-state');
  if(pageKind===null&&pageNextCursor!==null)reject('invalid-revision-store-gc-state');
  const state:GcState={version:3,scope,options:{now,minAgeMs,pageSize,maxObjects},status,phase,manifestCursor:cursor(input.manifestCursor),blobCursor:cursor(input.blobCursor),pageKind,pageNextCursor,candidate,scannedManifests:nonnegative(input.scannedManifests),scannedBlobs:nonnegative(input.scannedBlobs),deletedBlobs:nonnegative(input.deletedBlobs),retainedBlobs:nonnegative(input.retainedBlobs),deletingKey};
  if(phase==='completed'){
    if(status!=='completed'||!Object.hasOwn(input,'result')||deletingKey!==null||candidate!==null||pageKind!==null)reject('invalid-revision-store-gc-state');
    state.result=gcResult(input.result);
    if(JSON.stringify(state.result)!==JSON.stringify({scannedManifests:state.scannedManifests,scannedBlobs:state.scannedBlobs,deletedBlobs:state.deletedBlobs,retainedBlobs:state.retainedBlobs}))reject('invalid-revision-store-gc-state');
  }else if(status==='completed'||Object.hasOwn(input,'result'))reject('invalid-revision-store-gc-state');
  return state;
}
function gcResolution(state:GcState):TurnRevisionGcResolution{return state.status==='completed'?{status:'completed',result:state.result!}:state.status==='yielded'?{status:'yielded'}:{status:'unknown'};}
function sameRevisionShard(a:TurnScope,b:TurnScope):boolean{return a.tenantId===b.tenantId&&a.projectId===b.projectId&&a.workspaceId===b.workspaceId;}
function exactRecord(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
function commitDescriptor(value:unknown):CommitDescriptor{exactRecord(value,['schemaVersion','identity','outcome','executionErrorCode','base','snapshot','committedAt'],'invalid-revision-store-commit-descriptor');if(value.schemaVersion!==2||!['completed','failed','cancelled','interrupted'].includes(String(value.outcome)))reject('invalid-revision-store-commit-descriptor');const identity=turnRuntimeIdentity(value.identity),base=turnBaseCheckpoints(value.base),outcome=value.outcome as CommitDescriptor['outcome'],executionErrorCode=value.executionErrorCode===null?null:turnId(value.executionErrorCode);if(outcome==='completed'&&executionErrorCode!==null)reject('invalid-revision-store-commit-descriptor');exactRecord(value.snapshot,['filesSha256','filesBytes','sessionSha256','sessionBytes'],'invalid-revision-store-commit-descriptor');const filesBytes=positive(value.snapshot.filesBytes),sessionBytes=positive(value.snapshot.sessionBytes),snapshot={filesSha256:sha(value.snapshot.filesSha256),filesBytes,sessionSha256:sha(value.snapshot.sessionSha256),sessionBytes};return {schemaVersion:2,identity,outcome,executionErrorCode,base,snapshot,committedAt:positive(value.committedAt)};}
function sameJson(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}

/** One actor owns one tenant/project/workspace prefix. Its in-memory chain
 * prevents interleaving across awaits while the persisted operation fence
 * survives an eviction. An unknown writer/GC operation freezes only this
 * workspace shard until that exact operation is reconciled. */
export class RevisionStore extends DurableObject<RevisionStoreEnv> implements RevisionStoreRpc{
  #tail:Promise<unknown>;
  constructor(ctx:DurableObjectState,env:RevisionStoreEnv){
    super(ctx,env);
    ctx.storage.transactionSync(()=>{ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_store_operation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('commit','gc')), input_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('reserved','unknown'))) STRICT;");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_commit_tombstone (operation_key TEXT PRIMARY KEY, input_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_gc_reference (operation_key TEXT NOT NULL, object_key TEXT NOT NULL, PRIMARY KEY(operation_key,object_key)) STRICT");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_gc_candidate (operation_key TEXT NOT NULL, object_key TEXT NOT NULL, uploaded_at INTEGER NOT NULL, PRIMARY KEY(operation_key,object_key)) STRICT");ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS revision_gc_page (operation_key TEXT NOT NULL, position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('manifest','blob')), object_key TEXT NOT NULL, uploaded_at INTEGER NOT NULL, PRIMARY KEY(operation_key,position)) STRICT");ctx.storage.sql.exec("UPDATE revision_store_operation SET phase='unknown' WHERE phase='reserved'");});this.#tail=ctx.storage.sync();
  }
  #owned(rawScope:TurnScope){const scope=turnScope(rawScope);if(!this.env.REVISION_STORE.idFromName(revisionStoreActorName(scope)).equals(this.ctx.id))reject('revision-store-actor-scope-denied');if(!this.env.WORKSPACE_CHECKPOINTS?.get||!this.env.WORKSPACE_CHECKPOINTS.put||!this.env.WORKSPACE_CHECKPOINTS.list||!this.env.WORKSPACE_CHECKPOINTS.delete)reject('revision-store-r2-required');return scope;}
  #serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.#tail.then(work,work);this.#tail=next.catch(()=>{});return next;}
  #active():Operation|null{const row=this.ctx.storage.sql.exec<Row>('SELECT operation_key,kind,input_sha256,payload_json,phase FROM revision_store_operation WHERE singleton=1').toArray()[0];return row?{key:String(row.operation_key),kind:String(row.kind) as Operation['kind'],inputSha256:String(row.input_sha256),payloadJson:String(row.payload_json),phase:String(row.phase) as Operation['phase']}:null;}
  #tombstone(operationId:string):{inputSha256:string}|null{const row=this.ctx.storage.sql.exec<Row>('SELECT input_sha256 FROM revision_commit_tombstone WHERE operation_key=?',operationId).toArray()[0];return row?{inputSha256:String(row.input_sha256)}:null;}
  #completedGc(active:Operation):boolean{try{return active.kind==='gc'&&(JSON.parse(active.payloadJson) as Record<string,unknown>).phase==='completed';}catch{return false;}}
  #clearGcRows(operationKey:string){this.ctx.storage.sql.exec('DELETE FROM revision_gc_reference WHERE operation_key=?',operationKey);this.ctx.storage.sql.exec('DELETE FROM revision_gc_candidate WHERE operation_key=?',operationKey);this.ctx.storage.sql.exec('DELETE FROM revision_gc_page WHERE operation_key=?',operationKey);}
  async #reserve(operation:Operation){const active=this.#active();if(active){if(this.#completedGc(active))this.ctx.storage.transactionSync(()=>{this.#clearGcRows(active.key);this.ctx.storage.sql.exec('DELETE FROM revision_store_operation WHERE singleton=1');});else reject(active.phase==='unknown'?'revision-store-operation-unknown':'revision-store-operation-in-progress');}this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT INTO revision_store_operation VALUES(1,?,?,?,?,?)',operation.key,operation.kind,operation.inputSha256,operation.payloadJson,'reserved'));await this.ctx.storage.sync();}
  async #phase(phase:Operation['phase']){this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('UPDATE revision_store_operation SET phase=? WHERE singleton=1',phase));await this.ctx.storage.sync();}
  async #clear(){this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('DELETE FROM revision_store_operation WHERE singleton=1'));await this.ctx.storage.sync();}
  async #gcState(state:GcState,phase:Operation['phase']='reserved'){const payloadJson=JSON.stringify(gcState(state));this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('UPDATE revision_store_operation SET payload_json=?,phase=? WHERE singleton=1',payloadJson,phase));await this.ctx.storage.sync();}
  async #deferGc(){await this.ctx.storage.setAlarm(Date.now()+GC_RETRY_MS);}
  protected async finishGcAlarm(){await this.ctx.storage.deleteAlarm();}
  #gcOptions(raw:RevisionGcInput){const pageSize=raw.pageSize??100,maxObjects=raw.maxObjects??500;if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000||!Number.isSafeInteger(maxObjects)||maxObjects<1||maxObjects>10000)reject('invalid-turn-revision-gc-limit');return {now:positive(raw.now),minAgeMs:positive(raw.minAgeMs),pageSize,maxObjects};}
  async #persistGcPage(state:GcState,operationKey:string,kind:Exclude<GcPageKind,null>,items:Array<{key:string;uploaded:Date}>,nextCursor:string|null){
    state.pageKind=kind;state.pageNextCursor=nextCursor;const payloadJson=JSON.stringify(gcState(state));
    this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM revision_gc_page WHERE operation_key=?',operationKey);for(let position=0;position<items.length;position++){const item=items[position]!;this.ctx.storage.sql.exec('INSERT INTO revision_gc_page VALUES(?,?,?,?,?)',operationKey,position,kind,item.key,item.uploaded.getTime());}this.ctx.storage.sql.exec("UPDATE revision_store_operation SET payload_json=?,phase='reserved' WHERE singleton=1",payloadJson);});await this.ctx.storage.sync();
  }
  async #promoteGcPageCandidate(state:GcState,operationKey:string):Promise<boolean>{
    const row=this.ctx.storage.sql.exec<Row>('SELECT position,kind,object_key,uploaded_at FROM revision_gc_page WHERE operation_key=? ORDER BY position LIMIT 1',operationKey).toArray()[0];if(!row)return false;
    const kind=String(row.kind) as Exclude<GcPageKind,null>,objectKey=String(row.object_key),uploadedAt=positive(Number(row.uploaded_at)),position=nonnegative(Number(row.position));state.candidate={kind,objectKey,uploadedAt,nextCursor:state.pageNextCursor};const payloadJson=JSON.stringify(gcState(state));
    this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('DELETE FROM revision_gc_page WHERE operation_key=? AND position=?',operationKey,position);this.ctx.storage.sql.exec("UPDATE revision_store_operation SET payload_json=?,phase='reserved' WHERE singleton=1",payloadJson);});await this.ctx.storage.sync();return true;
  }
  async #finishGcPage(state:GcState){const kind=state.pageKind;if(!kind)return;const next=state.pageNextCursor;if(kind==='manifest')state.manifestCursor=next;else state.blobCursor=next;state.pageKind=null;state.pageNextCursor=null;if(next===null)state.phase=kind==='manifest'?'scan_blobs':'delete_candidates';await this.#gcState(state);}
  async #runGc(rawState:GcState):Promise<TurnRevisionGcResolution>{
    const state=gcState(rawState),scope=this.#owned(state.scope),active=this.#active();if(!active||active.kind!=='gc')reject('invalid-revision-store-gc-state');const bucket=this.env.WORKSPACE_CHECKPOINTS,manifestPrefix=turnRevisionManifestPrefix(scope),blobPrefix=turnRevisionBlobPrefix(scope),operationKey=active.key;let processed=0,r2Calls=0;const maxR2Calls=turnRevisionGcMaxR2Calls(state.options.maxObjects);
    while(state.phase!=='completed'){
      if(processed>=state.options.maxObjects||r2Calls>=maxR2Calls){state.status='yielded';await this.#gcState(state,'unknown');await this.#deferGc();return {status:'yielded'};}
      state.status='running';
      if(state.deletingKey){
        if(!state.deletingKey.startsWith(blobPrefix))reject('invalid-revision-store-gc-state');await this.#gcState(state);
        const deletingKey=state.deletingKey,object=await bucket.get(deletingKey);r2Calls++;if(object){await object.body?.cancel().catch(()=>{});await bucket.delete(deletingKey);r2Calls++;}
        this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('DELETE FROM revision_gc_candidate WHERE operation_key=? AND object_key=?',operationKey,deletingKey));state.deletedBlobs++;state.deletingKey=null;processed++;await this.#gcState(state);continue;
      }
      if(state.candidate){
        const candidate=state.candidate;
        if(candidate.kind==='manifest'){
          if(state.phase!=='scan_manifests'||!candidate.objectKey.startsWith(manifestPrefix)||!candidate.objectKey.endsWith('.json'))reject('invalid-revision-store-gc-state');await this.#gcState(state);
          const references=await readManifest(bucket,candidate.objectKey,scope);r2Calls++;this.ctx.storage.transactionSync(()=>{for(const reference of references)this.ctx.storage.sql.exec('INSERT OR IGNORE INTO revision_gc_reference VALUES(?,?)',operationKey,reference);});state.scannedManifests++;if(state.pageKind===null)state.manifestCursor=candidate.nextCursor;
        }else{
          if(state.phase!=='scan_blobs'||!candidate.objectKey.startsWith(blobPrefix)||!GC_BLOB_KEY.test(candidate.objectKey))reject('invalid-revision-store-gc-state');state.scannedBlobs++;const referenced=!!this.ctx.storage.sql.exec('SELECT 1 FROM revision_gc_reference WHERE operation_key=? AND object_key=?',operationKey,candidate.objectKey).toArray()[0];if(referenced||state.options.now-candidate.uploadedAt<state.options.minAgeMs)state.retainedBlobs++;else this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('INSERT OR IGNORE INTO revision_gc_candidate VALUES(?,?,?)',operationKey,candidate.objectKey,candidate.uploadedAt));if(state.pageKind===null)state.blobCursor=candidate.nextCursor;
        }
        const legacyPage=state.pageKind===null,end=legacyPage&&candidate.nextCursor===null;state.candidate=null;processed++;if(end)state.phase=candidate.kind==='manifest'?'scan_blobs':'delete_candidates';await this.#gcState(state);continue;
      }
      if(state.pageKind){if(await this.#promoteGcPageCandidate(state,operationKey))continue;await this.#finishGcPage(state);continue;}
      if(state.phase==='scan_manifests'||state.phase==='scan_blobs'){
        const kind=state.phase==='scan_manifests'?'manifest':'blob',prefix=kind==='manifest'?manifestPrefix:blobPrefix,currentCursor=kind==='manifest'?state.manifestCursor:state.blobCursor;await this.#gcState(state);
        const raw=await bucket.list({prefix,cursor:currentCursor??undefined,limit:state.options.pageSize});r2Calls++;if(!raw||!Array.isArray(raw.objects)||raw.objects.length>state.options.pageSize||typeof raw.truncated!=='boolean'||raw.truncated&&(typeof raw.cursor!=='string'||!raw.cursor)||raw.truncated&&raw.objects.length===0)reject('invalid-turn-revision-gc-list');
        if(raw.objects.length===0){if(kind==='manifest'){state.manifestCursor=null;state.phase='scan_blobs';}else{state.blobCursor=null;state.phase='delete_candidates';}await this.#gcState(state);continue;}
        const items=raw.objects.map(listed).filter(item=>kind==='manifest'?item.key.startsWith(manifestPrefix)&&item.key.endsWith('.json'):item.key.startsWith(blobPrefix)&&GC_BLOB_KEY.test(item.key)),nextCursor=raw.truncated?raw.cursor!:null;await this.#persistGcPage(state,operationKey,kind,items,nextCursor);continue;
      }
      const row=this.ctx.storage.sql.exec<Row>('SELECT object_key FROM revision_gc_candidate WHERE operation_key=? ORDER BY object_key LIMIT 1',operationKey).toArray()[0];
      if(!row){state.phase='completed';state.status='completed';state.result={scannedManifests:state.scannedManifests,scannedBlobs:state.scannedBlobs,deletedBlobs:state.deletedBlobs,retainedBlobs:state.retainedBlobs};await this.#gcState(state,'unknown');try{await this.finishGcAlarm();}catch{}return {status:'completed',result:state.result};}
      const candidate=String(row.object_key);if(!candidate.startsWith(blobPrefix)||!GC_BLOB_KEY.test(candidate))reject('invalid-revision-store-gc-state');state.deletingKey=candidate;await this.#gcState(state);
    }
    return gcResolution(state);
  }
  async #resumeGc(state:GcState):Promise<TurnRevisionGcResolution>{try{return await this.#runGc(state);}catch{const active=this.#active();if(active?.kind==='gc'){const persisted=gcState(JSON.parse(active.payloadJson),state.scope);if(persisted.phase==='completed')return gcResolution(persisted);persisted.status='unknown';await this.#gcState(persisted,'unknown');await this.#deferGc();}return {status:'unknown'};}}
  /** A commit may supersede a cooperatively paused scan because no R2 delete
   * can be in flight unless deletingKey is present. Abandoning the partial
   * reference set is safe; the next maintenance sweep rebuilds it. */
  async #interruptGcForCommit(scope:TurnScope):Promise<boolean>{let active=this.#active();if(!active||active.kind!=='gc'||this.#completedGc(active))return true;let state=gcState(JSON.parse(active.payloadJson),scope);if(!sameRevisionShard(state.scope,scope))return false;
    // deletingKey is a durable acknowledgement-loss fence. Reissue that exact
    // content-addressed delete before allowing a checkpoint to supersede GC.
    if(state.deletingKey!==null){await this.#resumeGc(state);active=this.#active();if(!active||active.kind!=='gc'||this.#completedGc(active))return true;state=gcState(JSON.parse(active.payloadJson),scope);if(state.deletingKey!==null)return false;}
    this.ctx.storage.transactionSync(()=>{this.#clearGcRows(active.key);this.ctx.storage.sql.exec('DELETE FROM revision_store_operation WHERE singleton=1 AND operation_key=?',active.key);});await this.ctx.storage.sync();try{await this.finishGcAlarm();}catch{}return true;}
  async #prepareCommit(raw:RevisionCommitInput):Promise<TurnCheckpointIntent>{
    const identity=turnRuntimeIdentity(raw.identity);this.#owned(identity.scope);const base=turnBaseCheckpoints(raw.base),snapshot=frozenTurnSnapshot(raw.snapshot,identity),input:TurnCheckpointInput={identity,outcome:raw.outcome,executionErrorCode:raw.executionErrorCode===null?null:turnId(raw.executionErrorCode),base},intent=await revisionCommitIntent(input,snapshot),snapshotDescriptor:FrozenTurnSnapshotDescriptor={filesSha256:await sha256(snapshot.filesArchive),filesBytes:snapshot.filesArchive.byteLength,sessionSha256:await sha256(snapshot.piSession),sessionBytes:snapshot.piSession.byteLength},descriptor:CommitDescriptor={schemaVersion:2,identity,outcome:input.outcome,executionErrorCode:input.executionErrorCode,base,snapshot:snapshotDescriptor,committedAt:positive(Date.now())},payloadJson=JSON.stringify(descriptor),key=intent.operationId,inputSha256=intent.inputSha256;
    const tombstone=this.#tombstone(key);if(tombstone)reject(tombstone.inputSha256===inputSha256?'revision-store-commit-aborted':'revision-store-commit-conflict');
    let active=this.#active();if(active?.kind==='gc'&&!this.#completedGc(active)){if(!await this.#interruptGcForCommit(identity.scope))reject('revision-store-operation-unavailable');active=this.#active();}
    if(active&&!this.#completedGc(active)){
      if(active.kind!=='commit'||active.key!==key||active.inputSha256!==inputSha256)reject('revision-store-commit-conflict');
      try{const saved=commitDescriptor(JSON.parse(active.payloadJson));if(!sameJson({...saved,committedAt:descriptor.committedAt},{...descriptor,committedAt:descriptor.committedAt}))reject('revision-store-commit-conflict');descriptor.committedAt=saved.committedAt;}catch(error){if(active.payloadJson!==JSON.stringify(revisionCommitDigestInput(input,snapshotDescriptor.filesSha256,snapshotDescriptor.filesBytes,snapshotDescriptor.sessionSha256,snapshotDescriptor.sessionBytes)))throw error;this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('UPDATE revision_store_operation SET payload_json=? WHERE singleton=1',JSON.stringify(descriptor)));await this.ctx.storage.sync();}
    }else await this.#reserve({key,kind:'commit',inputSha256,payloadJson,phase:'reserved'});
    try{const staged=await stageFrozenTurnSnapshot(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,snapshot);if(!sameJson(staged,snapshotDescriptor))reject('revision-store-commit-conflict');await this.#phase('unknown');return intent;}
    catch(error){try{await this.#phase('unknown');}catch{}throw error;}
  }
  prepareCommit(raw:RevisionCommitInput):Promise<TurnCheckpointIntent>{return this.#serial(()=>this.#prepareCommit(raw));}
  async #materialize(descriptor:CommitDescriptor):Promise<CheckpointReceipt>{const snapshot=await readFrozenTurnSnapshot(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,descriptor.identity,descriptor.snapshot),snapshots:FrozenTurnSnapshotPort={async freeze(){return snapshot;}},port=new R2TurnRevisionPort(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,snapshots,()=>descriptor.committedAt,this.env.MODEL_CONTENT);return port.commit({identity:descriptor.identity,outcome:descriptor.outcome,executionErrorCode:descriptor.executionErrorCode,base:descriptor.base});}
  async #commitPrepared(raw:RevisionCommitPreparedInput):Promise<RevisionCommitResolution>{const identity=turnRuntimeIdentity(raw.identity);this.#owned(identity.scope);const operationId=typeof raw.operationId==='string'?raw.operationId:reject('revision-store-reconcile-conflict'),inputSha256=sha(raw.inputSha256),base=turnBaseCheckpoints(raw.base),executionErrorCode=raw.executionErrorCode===null?null:turnId(raw.executionErrorCode);if(operationId!==commitKey(identity))return {status:'conflict'};const tombstone=this.#tombstone(operationId);if(tombstone)return {status:tombstone.inputSha256===inputSha256?'aborted':'conflict'};const active=this.#active();if(!active)return this.#resolveCommit(identity,operationId,inputSha256);if(active.kind!=='commit'||active.key!==operationId||active.inputSha256!==inputSha256)return {status:active.kind==='gc'?'unavailable':'conflict'};let descriptor:CommitDescriptor;try{descriptor=commitDescriptor(JSON.parse(active.payloadJson));}catch{return this.#resolveCommit(identity,operationId,inputSha256);}if(!sameJson({identity,outcome:raw.outcome,executionErrorCode,base},{identity:descriptor.identity,outcome:descriptor.outcome,executionErrorCode:descriptor.executionErrorCode,base:descriptor.base}))return {status:'conflict'};const prior=await this.#resolveCommit(identity,operationId,inputSha256);if(prior.status!=='absent'&&prior.status!=='pending')return prior;try{const receipt=await this.#materialize(descriptor);await this.#clear();return {status:'committed',receipt};}catch(error){if(error instanceof Error&&(error.message.includes('conflict')||error.message.startsWith('invalid-turn-revision')))return {status:'conflict'};try{await this.#phase('unknown');const observed=await this.#resolveCommit(identity,operationId,inputSha256);return observed.status==='absent'?{status:'pending'}:observed;}catch{return {status:'unavailable'};}}}
  commitPrepared(raw:RevisionCommitPreparedInput):Promise<RevisionCommitResolution>{return this.#serial(()=>this.#commitPrepared(raw));}
  commit(raw:RevisionCommitInput):Promise<RevisionCommitResolution>{return this.#serial(async()=>{let intent:TurnCheckpointIntent;try{intent=await this.#prepareCommit(raw);}catch(error){const code=error instanceof Error?error.message:'';if(code==='revision-store-commit-aborted')return {status:'aborted'};if(code==='revision-store-operation-unavailable')return {status:'unavailable'};if(code==='revision-store-commit-conflict')return {status:'conflict'};if(code.startsWith('invalid-')||code.includes('scope-denied')||code.endsWith('-required'))throw error;return {status:'pending'};}return this.#commitPrepared({...raw,operationId:intent.operationId,inputSha256:intent.inputSha256});});}
  async #previewFiles(raw:PreviewSource):Promise<Uint8Array>{
    const source=previewSource(raw);
    if(source.kind==='saved-turn')return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).files(source.identity,source.revision);
    const resolved=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(source.reference,source.reference.scope);
    if(resolved.filesSha256!==source.filesSha256)throw Error('preview-revision-mismatch');
    return resolved.filesArchive;
  }
  previewPlan(raw:PreviewSource){const source=previewSource(raw),scope=source.kind==='saved-turn'?source.identity.scope:source.reference.scope;return this.#serial(async()=>{this.#owned(scope);return new PreviewPlanResolver({files:s=>this.#previewFiles(s)}).resolve(source);});}
  serviceFiles(raw:PreviewSource):Promise<Uint8Array>{const source=previewSource(raw),scope=source.kind==='saved-turn'?source.identity.scope:source.reference.scope;return this.#serial(async()=>{this.#owned(scope);return this.#previewFiles(source);});}
  initialPreviewPlan(reference:InitialWorkspaceReference,expectedScope:TurnScope){const source=previewSource({kind:'initial-workspace',reference,filesSha256:'0'.repeat(64)});if(source.kind!=='initial-workspace')throw Error('invalid-preview-source');return this.#serial(async()=>{this.#owned(expectedScope);const resolved=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(source.reference,expectedScope);return new PreviewPlanResolver({async files(){return resolved.filesArchive;}}).resolve({kind:'initial-workspace',reference:resolved.reference,filesSha256:resolved.filesSha256});});}
  observe(raw:TurnRuntimeIdentity):Promise<CheckpointReceipt|null>{return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw);this.#owned(identity.scope);const reader=new R2TurnRevisionPort(this.env.WORKSPACE_CHECKPOINTS as TurnRevisionBucket,{async freeze(){reject('revision-store-observe-cannot-freeze');}});return reader.observe(identity);});}
  async #resolveCommit(identity:TurnRuntimeIdentity,operationId:string,inputSha256:string):Promise<RevisionCommitResolution>{if(operationId!==commitKey(identity))return {status:'conflict'};const tombstone=this.#tombstone(operationId);if(tombstone)return tombstone.inputSha256===inputSha256?{status:'aborted'}:{status:'conflict'};const active=this.#active();if(active?.kind==='gc')return {status:'unavailable'};if(active&&(active.key!==operationId||active.inputSha256!==inputSha256))return {status:'conflict'};if(active?.phase==='reserved')return {status:'pending'};let saved;try{saved=await new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).inspect(identity);}catch(error){const code=error instanceof Error?error.message:'';return code.includes('conflict')||code.startsWith('invalid-turn-revision')?{status:'conflict'}:{status:'unavailable'};}if(!saved)return {status:'absent'};const actual=revisionCommitDigestInput({identity,outcome:saved.outcome,executionErrorCode:saved.executionErrorCode,base:saved.base},saved.files.sha256,saved.files.size,saved.piSession.sha256,saved.piSession.size),actualSha256=await sha256(JSON.stringify(actual));if(actualSha256!==inputSha256){if(active)await this.#clear();return {status:'conflict'};}if(active){let expected:unknown;try{const descriptor=commitDescriptor(JSON.parse(active.payloadJson));expected=revisionCommitDigestInput({identity:descriptor.identity,outcome:descriptor.outcome,executionErrorCode:descriptor.executionErrorCode,base:descriptor.base},descriptor.snapshot.filesSha256,descriptor.snapshot.filesBytes,descriptor.snapshot.sessionSha256,descriptor.snapshot.sessionBytes);}catch{expected=JSON.parse(active.payloadJson);}if(!sameJson(actual,expected))return {status:'conflict'};await this.#clear();}return {status:'committed',receipt:saved.receipt};}
  async #reconcileCommit(identity:TurnRuntimeIdentity,operationId:string,inputSha256:string):Promise<RevisionCommitResolution>{const observed=await this.#resolveCommit(identity,operationId,inputSha256);if(observed.status!=='absent'&&observed.status!=='pending')return observed;const active=this.#active();if(!active||active.kind!=='commit'||active.key!==operationId||active.inputSha256!==inputSha256||active.phase==='reserved')return observed;let descriptor:CommitDescriptor;try{descriptor=commitDescriptor(JSON.parse(active.payloadJson));}catch{return observed;}try{const receipt=await this.#materialize(descriptor);await this.#clear();return {status:'committed',receipt};}catch(error){if(error instanceof Error&&(error.message.includes('conflict')||error.message.startsWith('invalid-turn-revision')))return {status:'conflict'};try{await this.#phase('unknown');return await this.#resolveCommit(identity,operationId,inputSha256);}catch{return {status:'unavailable'};}}}
  reconcileCommit(raw:RevisionCommitReconcileInput){return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw.identity);this.#owned(identity.scope);return this.#reconcileCommit(identity,typeof raw.operationId==='string'?raw.operationId:reject('revision-store-reconcile-conflict'),sha(raw.inputSha256));});}
  abandonCommit(raw:RevisionCommitReconcileInput){return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw.identity);this.#owned(identity.scope);const operationId=typeof raw.operationId==='string'?raw.operationId:reject('revision-store-reconcile-conflict'),inputSha256=sha(raw.inputSha256),resolution=await this.#resolveCommit(identity,operationId,inputSha256);if(resolution.status!=='absent')return resolution;this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec('INSERT INTO revision_commit_tombstone VALUES(?,?,?) ON CONFLICT(operation_key) DO NOTHING',operationId,inputSha256,Date.now());this.ctx.storage.sql.exec("DELETE FROM revision_store_operation WHERE singleton=1 AND operation_key=? AND input_sha256=? AND phase='unknown'",operationId,inputSha256);});await this.ctx.storage.sync();return {status:'aborted' as const};});}
  resolveInitial(reference:InitialWorkspaceReference,scope:TurnScope):Promise<ResolvedInitialWorkspace>{return this.#serial(async()=>{this.#owned(scope);return new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(reference,scope);});}
  restore(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound=false):Promise<RestoredTurnRevision>{return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw);this.#owned(identity.scope);return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).restore(identity,receipt,sessionBound);});}
  files(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt){return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw);this.#owned(identity.scope);const archive=await new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).files(identity,receipt);return workspaceFileIndex(archive);});}
  diff(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt){return this.#serial(async()=>{
    const identity=turnRuntimeIdentity(raw);this.#owned(identity.scope);
    const reader=new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS),current=await reader.workspaceFiles(identity,receipt);
    let base:Uint8Array|null=null;
    if(current.base)base=await reader.files(identity,current.base);
    else if(current.initial){
      const initial=await new InitialWorkspaceResolver(this.env.WORKSPACE_CHECKPOINTS,this.env.MODEL_CONTENT).resolve(current.initial.reference,identity.scope);
      if(initial.filesSha256!==current.initial.filesSha256)reject('initial-workspace-files-mismatch');
      base=initial.filesArchive;
    }
    return workspaceFileDiff(current.filesArchive,base);
  });}
  load(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt|null):Promise<Uint8Array|null>{return this.#serial(async()=>{const identity=turnRuntimeIdentity(raw);this.#owned(identity.scope);return new R2TurnRevisionReader(this.env.WORKSPACE_CHECKPOINTS).load(identity,receipt);});}
  #newGcState(scope:TurnScope,options:GcState['options']):GcState{return {version:3,scope,options,status:'running',phase:'scan_manifests',manifestCursor:null,blobCursor:null,pageKind:null,pageNextCursor:null,candidate:null,scannedManifests:0,scannedBlobs:0,deletedBlobs:0,retainedBlobs:0,deletingKey:null};}
  gc(raw:RevisionGcInput):Promise<TurnRevisionGcResolution>{return this.#serial(async()=>{
    const scope=this.#owned(raw.scope),operationId=turnId(raw.operationId),options=this.#gcOptions(raw),descriptor=JSON.stringify(options),inputSha256=await sha256(descriptor),key=`gc:${operationId}`,active=this.#active();
    if(active&&!this.#completedGc(active)){if(active.kind!=='gc'||active.key!==key||active.inputSha256!==inputSha256)reject('revision-store-gc-reconcile-conflict');const state=gcState(JSON.parse(active.payloadJson),scope);if(JSON.stringify(state.scope)!==JSON.stringify(scope))reject('revision-store-gc-reconcile-conflict');if(active.phase==='reserved'){state.status='unknown';await this.#gcState(state,'unknown');await this.#deferGc();return {status:'unknown'};}return this.#resumeGc(state);}
    if(active&&this.#completedGc(active)&&active.key===key){if(active.inputSha256!==inputSha256)reject('revision-store-gc-reconcile-conflict');return gcResolution(gcState(JSON.parse(active.payloadJson),scope));}
    const state=this.#newGcState(scope,options);await this.#reserve({key,kind:'gc',inputSha256,payloadJson:JSON.stringify(state),phase:'reserved'});return this.#resumeGc(state);
  });}
  reconcileGc(raw:RevisionGcReconcileInput):Promise<TurnRevisionGcResolution>{return this.#serial(async()=>{
    const scope=this.#owned(raw.scope),inputSha256=sha(raw.inputSha256),active=this.#active();if(!active||active.kind!=='gc'||active.key!==`gc:${turnId(raw.operationId)}`||active.inputSha256!==inputSha256)reject('revision-store-gc-reconcile-conflict');const state=gcState(JSON.parse(active.payloadJson),scope);if(JSON.stringify(state.scope)!==JSON.stringify(scope))reject('revision-store-gc-reconcile-conflict');if(state.status==='completed')return gcResolution(state);if(active.phase==='reserved'){state.status='unknown';await this.#gcState(state,'unknown');await this.#deferGc();return {status:'unknown'};}return this.#resumeGc(state);
  });}
  maintainGc(raw:RevisionGcMaintenanceInput):Promise<TurnRevisionGcResolution>{return this.#serial(async()=>{
    const scope=this.#owned(raw.scope),options=this.#gcOptions({...raw,operationId:'maintenance'}),active=this.#active();
    if(active?.kind==='commit')return {status:'unknown'};
    if(active?.kind==='gc'){
      const state=gcState(JSON.parse(active.payloadJson),scope);if(!sameRevisionShard(state.scope,scope))reject('revision-store-gc-reconcile-conflict');
      if(state.status!=='completed')return this.#resumeGc(state);
      const currentKey=`gc:maintenance-${Math.floor(options.now/GC_MAINTENANCE_PERIOD_MS)}`;if(active.key===currentKey)return gcResolution(state);
    }
    const operationId=`maintenance-${Math.floor(options.now/GC_MAINTENANCE_PERIOD_MS)}`,descriptor=JSON.stringify(options),inputSha256=await sha256(descriptor),key=`gc:${operationId}`,state=this.#newGcState(scope,options);await this.#reserve({key,kind:'gc',inputSha256,payloadJson:JSON.stringify(state),phase:'reserved'});return this.#resumeGc(state);
  });}
  async alarm():Promise<void>{await this.#serial(async()=>{const active=this.#active();if(!active||active.kind!=='gc'){await this.finishGcAlarm();return;}let state:GcState;try{state=gcState(JSON.parse(active.payloadJson));}catch{await this.#deferGc();return;}if(state.status==='completed'){await this.finishGcAlarm();return;}await this.#resumeGc(state);});}
}
