import type { CheckpointReceipt, TurnBaseCheckpoints } from '../turn/protocol.ts';
import { checkpointObjectKey, checkpointReceipt, positive, sameScope, scope as turnScope, sha, turnBaseCheckpoints, turnDigest, turnId } from '../turn/protocol.ts';
import { InitialWorkspaceResolver } from './initial-workspace.ts';
import { sameTurnRuntimeIdentity, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';

export type FrozenTurnSnapshot={identity:TurnRuntimeIdentity;filesArchive:Uint8Array;piSession:Uint8Array};
export type FrozenTurnSnapshotDescriptor={filesSha256:string;filesBytes:number;sessionSha256:string;sessionBytes:number};
export interface FrozenTurnSnapshotPort{freeze(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints):Promise<FrozenTurnSnapshot>}
export type TurnRevisionBucket=Pick<R2Bucket,'get'|'put'>;
type Manifest={schemaVersion:3;identity:TurnRuntimeIdentity;base:TurnBaseCheckpoints;outcome:'completed'|'failed'|'cancelled'|'interrupted';executionErrorCode:string|null;files:{objectKey:string;sha256:string;size:number};piSession:{objectKey:string;sha256:string;size:number};committedAt:number};
export type RestoredTurnRevision={identity:TurnRuntimeIdentity;receipt:CheckpointReceipt;filesArchive:Uint8Array;piSession:Uint8Array};
export type TurnRevisionObservation={identity:TurnRuntimeIdentity;receipt:CheckpointReceipt;outcome:Manifest['outcome'];executionErrorCode:string|null;base:TurnBaseCheckpoints;files:{sha256:string;size:number};piSession:{sha256:string;size:number}};
export type TurnRevisionWorkspaceFiles={filesArchive:Uint8Array;base:CheckpointReceipt|null;initial?:TurnBaseCheckpoints['initial']};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX_BLOB_BYTES=64*1024*1024,MAX_MANIFEST_BYTES=64*1024;
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);}
function same(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}
function size(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<1||(value as number)>MAX_BLOB_BYTES)reject('invalid-turn-revision-manifest');return value as number;}
async function digest(bytes:Uint8Array):Promise<string>{const value=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(value)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function putVerifiedObject(bucket:TurnRevisionBucket,key:string,bytes:Uint8Array,expectedSha:string):Promise<void>{let writeError:unknown=null;try{await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'}});}catch(error){writeError=error;}let saved:Uint8Array|null=null;try{saved=await readObject(bucket,key,bytes.byteLength||1);}catch(error){throw writeError??error;}if(saved&&saved.byteLength===bytes.byteLength&&await digest(saved)===expectedSha)return;if(writeError)throw writeError;reject('turn-revision-object-conflict');}
export function turnRevisionObjectKey(raw:TurnRuntimeIdentity):string{const id=turnRuntimeIdentity(raw);return checkpointObjectKey(`turns/${id.scope.tenantId}/${id.scope.projectId}/${id.scope.workspaceId}/${id.generation}/${id.sessionId}/${id.turnId}/${id.dispatchId}.json`);}
export function turnRevisionManifestPrefix(raw:TurnRuntimeIdentity['scope']):string{const scope=turnScope(raw);return `turns/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/`;}
export function turnRevisionBlobPrefix(raw:TurnRuntimeIdentity['scope']):string{const scope=turnScope(raw);return `turn-blobs-v3/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/`;}
export function turnRevisionBlobKey(scope:TurnRuntimeIdentity['scope'],kind:'files'|'sessions',value:string):string{return checkpointObjectKey(`${turnRevisionBlobPrefix(scope)}${kind}/${sha(value)}`);}
export function frozenTurnSnapshot(value:unknown,expected:TurnRuntimeIdentity):FrozenTurnSnapshot{
  exact(value,['identity','filesArchive','piSession'],'invalid-frozen-turn-snapshot');const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('turn-revision-scope-denied');
  if(!(value.filesArchive instanceof Uint8Array)||!(value.piSession instanceof Uint8Array)||value.filesArchive.byteLength<1||value.piSession.byteLength<1||value.filesArchive.byteLength>MAX_BLOB_BYTES||value.piSession.byteLength>MAX_BLOB_BYTES||value.filesArchive.byteLength+value.piSession.byteLength>MAX_BLOB_BYTES)reject('invalid-frozen-turn-snapshot');
  return {identity,filesArchive:Uint8Array.from(value.filesArchive),piSession:Uint8Array.from(value.piSession)};
}
function part(value:unknown,scope:TurnRuntimeIdentity['scope'],kind:'files'|'sessions'):Manifest['files']{exact(value,['objectKey','sha256','size'],'invalid-turn-revision-manifest');const digest=sha(value.sha256),objectKey=checkpointObjectKey(value.objectKey);if(objectKey!==turnRevisionBlobKey(scope,kind,digest))reject('invalid-turn-revision-manifest');return {objectKey,sha256:digest,size:size(value.size)};}
function manifest(value:unknown,expected:TurnRuntimeIdentity):Manifest{
  exact(value,['schemaVersion','identity','base','outcome','executionErrorCode','files','piSession','committedAt'],'invalid-turn-revision-manifest');if(value.schemaVersion!==3||!['completed','failed','cancelled','interrupted'].includes(value.outcome as string))reject('invalid-turn-revision-manifest');
  const identity=turnRuntimeIdentity(value.identity);if(!sameTurnRuntimeIdentity(identity,expected))reject('turn-revision-scope-denied');const base=turnBaseCheckpoints(value.base);if(base.initial&&!sameScope(base.initial.reference.scope,identity.scope))reject('turn-revision-base-scope-denied');const outcome=value.outcome as Manifest['outcome'],executionErrorCode=value.executionErrorCode===null?null:turnId(value.executionErrorCode);if(outcome==='completed'&&executionErrorCode!==null)reject('invalid-turn-revision-manifest');
  return {schemaVersion:3,identity,base,outcome,executionErrorCode,files:part(value.files,identity.scope,'files'),piSession:part(value.piSession,identity.scope,'sessions'),committedAt:positive(value.committedAt)};
}
async function readObject(bucket:TurnRevisionBucket,key:string,max:number):Promise<Uint8Array|null>{const object=await bucket.get(key);if(!object)return null;if(object.size>max){void object.body.cancel().catch(()=>{});reject('turn-revision-object-too-large');}const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.byteLength>max)reject('turn-revision-object-too-large');return bytes;}
async function readParts(bucket:TurnRevisionBucket,saved:Manifest):Promise<{filesArchive:Uint8Array;piSession:Uint8Array}>{
  if(saved.files.size+saved.piSession.size>MAX_BLOB_BYTES)reject('turn-revision-object-too-large');
  const values=[] as Uint8Array[];for(const item of [saved.files,saved.piSession]){const blob=await readObject(bucket,item.objectKey,MAX_BLOB_BYTES);if(!blob||blob.byteLength!==item.size||await digest(blob)!==item.sha256)reject('turn-revision-object-conflict');values.push(blob);}
  return {filesArchive:values[0]!,piSession:values[1]!};
}
async function readIdentityManifest(bucket:TurnRevisionBucket,identity:TurnRuntimeIdentity):Promise<{manifest:Manifest;receipt:CheckpointReceipt;filesArchive:Uint8Array;piSession:Uint8Array}|null>{
  const objectKey=turnRevisionObjectKey(identity),bytes=await readObject(bucket,objectKey,MAX_MANIFEST_BYTES);if(!bytes)return null;let parsed:unknown;try{parsed=JSON.parse(decoder.decode(bytes));}catch{reject('invalid-turn-revision-manifest');}const saved=manifest(parsed,identity),revisionId=await digest(bytes),parts=await readParts(bucket,saved);
  return {manifest:saved,receipt:{revisionId,objectKey,filesSha256:saved.files.sha256,sessionSha256:saved.piSession.sha256,committedAt:saved.committedAt},...parts};
}
async function readReceiptManifest(bucket:TurnRevisionBucket,receipt:CheckpointReceipt,identity:TurnRuntimeIdentity,sessionBound:boolean):Promise<{expected:CheckpointReceipt;parentIdentity:TurnRuntimeIdentity;saved:Manifest}>{
  const expected=checkpointReceipt(receipt),bytes=await readObject(bucket,expected.objectKey,MAX_MANIFEST_BYTES);if(!bytes)reject('turn-revision-base-missing');let parsed:unknown;try{parsed=JSON.parse(decoder.decode(bytes));}catch{reject('invalid-turn-revision-manifest');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))reject('invalid-turn-revision-manifest');const parentIdentity=turnRuntimeIdentity((parsed as Record<string,unknown>).identity),saved=manifest(parsed,parentIdentity),revisionId=await digest(bytes);
  if(turnRevisionObjectKey(parentIdentity)!==expected.objectKey||!sameScope(parentIdentity.scope,identity.scope)||(sessionBound&&parentIdentity.sessionId!==identity.sessionId))reject('turn-revision-base-scope-denied');
  if(revisionId!==expected.revisionId||saved.files.sha256!==expected.filesSha256||saved.piSession.sha256!==expected.sessionSha256||saved.committedAt!==expected.committedAt)reject('turn-revision-base-conflict');return {expected,parentIdentity,saved};
}
async function readReceipt(bucket:TurnRevisionBucket,receipt:CheckpointReceipt,identity:TurnRuntimeIdentity,sessionBound:boolean):Promise<RestoredTurnRevision>{
  const {expected,parentIdentity,saved}=await readReceiptManifest(bucket,receipt,identity,sessionBound),parts=await readParts(bucket,saved);
  return {identity:parentIdentity,receipt:expected,...parts};
}
async function readFilesPart(bucket:TurnRevisionBucket,saved:Manifest,maxBytes=MAX_BLOB_BYTES):Promise<Uint8Array>{if(saved.files.size>maxBytes)reject('turn-revision-object-too-large');const bytes=await readObject(bucket,saved.files.objectKey,maxBytes);if(!bytes||bytes.byteLength!==saved.files.size||await digest(bytes)!==saved.files.sha256)reject('turn-revision-object-conflict');return bytes;}
async function readFilesReceipt(bucket:TurnRevisionBucket,receipt:CheckpointReceipt,identity:TurnRuntimeIdentity,maxBytes=MAX_BLOB_BYTES):Promise<Uint8Array>{if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BLOB_BYTES)reject('turn-revision-object-too-large');const {saved}=await readReceiptManifest(bucket,receipt,identity,false);return readFilesPart(bucket,saved,maxBytes);}

/** Reads a committed immutable Revision for restore. A caller receives bytes
 * only after the receipt, canonical manifest key, complete scope and both
 * content-addressed blobs have been verified. */
export class R2TurnRevisionReader{
  readonly #bucket:TurnRevisionBucket;
  constructor(bucket:TurnRevisionBucket){if(!bucket?.get)reject('r2-turn-revision-required');this.#bucket=bucket;}
  async restore(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt,sessionBound=false):Promise<RestoredTurnRevision>{return readReceipt(this.#bucket,receipt,turnRuntimeIdentity(raw),sessionBound);}
  async files(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt,maxBytes=MAX_BLOB_BYTES):Promise<Uint8Array>{return readFilesReceipt(this.#bucket,receipt,turnRuntimeIdentity(raw),maxBytes);}
  async workspaceFiles(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<TurnRevisionWorkspaceFiles>{const identity=turnRuntimeIdentity(raw),{saved}=await readReceiptManifest(this.#bucket,receipt,identity,false),filesArchive=await readFilesPart(this.#bucket,saved);return {filesArchive,base:saved.base.workspace,...(saved.base.initial?{initial:saved.base.initial}:{})};}
  async load(raw:TurnRuntimeIdentity,receipt:CheckpointReceipt|null):Promise<Uint8Array|null>{if(receipt===null)return null;return (await this.restore(raw,receipt,true)).piSession;}
  async inspect(raw:TurnRuntimeIdentity):Promise<TurnRevisionObservation|null>{const identity=turnRuntimeIdentity(raw),saved=await readIdentityManifest(this.#bucket,identity);return saved&&{identity,receipt:saved.receipt,outcome:saved.manifest.outcome,executionErrorCode:saved.manifest.executionErrorCode,base:saved.manifest.base,files:{sha256:saved.manifest.files.sha256,size:saved.manifest.files.size},piSession:{sha256:saved.manifest.piSession.sha256,size:saved.manifest.piSession.size}};}
}

/** Restores the exact frozen snapshot staged by RevisionStore before a commit.
 * Content-addressed keys are re-derived instead of trusted from persisted JSON. */
export async function readFrozenTurnSnapshot(bucket:TurnRevisionBucket,rawIdentity:TurnRuntimeIdentity,raw:{filesSha256:string;filesBytes:number;sessionSha256:string;sessionBytes:number}):Promise<FrozenTurnSnapshot>{
  const identity=turnRuntimeIdentity(rawIdentity),filesSha256=sha(raw.filesSha256),sessionSha256=sha(raw.sessionSha256),filesBytes=size(raw.filesBytes),sessionBytes=size(raw.sessionBytes);
  if(filesBytes+sessionBytes>MAX_BLOB_BYTES)reject('turn-revision-object-too-large');
  const filesArchive=await readObject(bucket,turnRevisionBlobKey(identity.scope,'files',filesSha256),filesBytes),piSession=await readObject(bucket,turnRevisionBlobKey(identity.scope,'sessions',sessionSha256),sessionBytes);
  if(!filesArchive||!piSession)reject('turn-revision-staging-unavailable');if(filesArchive.byteLength!==filesBytes||await digest(filesArchive)!==filesSha256||piSession.byteLength!==sessionBytes||await digest(piSession)!==sessionSha256)reject('turn-revision-object-conflict');
  return {identity,filesArchive,piSession};
}
export async function stageFrozenTurnSnapshot(bucket:TurnRevisionBucket,raw:FrozenTurnSnapshot):Promise<FrozenTurnSnapshotDescriptor>{const snapshot=frozenTurnSnapshot(raw,raw.identity),filesSha256=await digest(snapshot.filesArchive),sessionSha256=await digest(snapshot.piSession);await putVerifiedObject(bucket,turnRevisionBlobKey(snapshot.identity.scope,'files',filesSha256),snapshot.filesArchive,filesSha256);await putVerifiedObject(bucket,turnRevisionBlobKey(snapshot.identity.scope,'sessions',sessionSha256),snapshot.piSession,sessionSha256);return {filesSha256,filesBytes:snapshot.filesArchive.byteLength,sessionSha256,sessionBytes:snapshot.piSession.byteLength};}

/** R2 materialization adapter for a frozen project archive plus trusted Pi
 * Session. Blobs and the identity-specific manifest are immutable and always
 * read back by hash. The returned receipt is evidence for the Workspace
 * TurnJournal to commit; R2 presence alone is not the authoritative Turn. */
export class R2TurnRevisionPort{
  readonly #bucket:TurnRevisionBucket;readonly #snapshots:FrozenTurnSnapshotPort;readonly #clock:()=>number;readonly #modelBucket?:R2Bucket;
  constructor(bucket:TurnRevisionBucket,snapshots:FrozenTurnSnapshotPort,clock:()=>number=Date.now,modelBucket?:R2Bucket){if(!bucket?.get||!bucket?.put)reject('r2-turn-revision-required');this.#bucket=bucket;this.#snapshots=snapshots;this.#clock=clock;this.#modelBucket=modelBucket;}
  async #putVerified(key:string,bytes:Uint8Array,expectedSha:string):Promise<void>{return putVerifiedObject(this.#bucket,key,bytes,expectedSha);}
  async #readManifest(identity:TurnRuntimeIdentity):Promise<{manifest:Manifest;receipt:CheckpointReceipt}|null>{
    const saved=await readIdentityManifest(this.#bucket,identity);return saved&&{manifest:saved.manifest,receipt:saved.receipt};
  }
  async #verifyBase(receipt:CheckpointReceipt,identity:TurnRuntimeIdentity,sessionBound:boolean):Promise<void>{
    await readReceipt(this.#bucket,receipt,identity,sessionBound);
  }
  async observe(raw:TurnRuntimeIdentity):Promise<CheckpointReceipt|null>{const identity=turnRuntimeIdentity(raw);return (await this.#readManifest(identity))?.receipt??null;}
  async commit(input:{identity:TurnRuntimeIdentity;outcome:Manifest['outcome'];executionErrorCode:string|null;base:TurnBaseCheckpoints}):Promise<CheckpointReceipt>{
    const identity=turnRuntimeIdentity(input.identity),base=turnBaseCheckpoints(input.base),executionErrorCode=input.executionErrorCode===null?null:turnId(input.executionErrorCode);if(input.outcome==='completed'&&executionErrorCode!==null)reject('invalid-turn-revision-outcome');
    const prior=await this.#readManifest(identity);if(prior){if(prior.manifest.outcome!==input.outcome||prior.manifest.executionErrorCode!==executionErrorCode||!same(prior.manifest.base,base))reject('turn-revision-conflict');return prior.receipt;}
    if(base.workspace)await this.#verifyBase(base.workspace,identity,false);if(base.session)await this.#verifyBase(base.session,identity,true);
    if(base.initial){const initial=await new InitialWorkspaceResolver(this.#bucket as R2Bucket,this.#modelBucket).resolve(base.initial.reference,identity.scope);if(initial.filesSha256!==base.initial.filesSha256)reject('initial-workspace-files-mismatch');}
    const snapshot=frozenTurnSnapshot(await this.#snapshots.freeze(identity,base),identity),filesSha256=await digest(snapshot.filesArchive),sessionSha256=await digest(snapshot.piSession),filesKey=turnRevisionBlobKey(identity.scope,'files',filesSha256),sessionKey=turnRevisionBlobKey(identity.scope,'sessions',sessionSha256);
    await this.#putVerified(filesKey,snapshot.filesArchive,filesSha256);await this.#putVerified(sessionKey,snapshot.piSession,sessionSha256);
    const value:Manifest={schemaVersion:3,identity,base,outcome:input.outcome,executionErrorCode,files:{objectKey:filesKey,sha256:filesSha256,size:snapshot.filesArchive.byteLength},piSession:{objectKey:sessionKey,sha256:sessionSha256,size:snapshot.piSession.byteLength},committedAt:positive(this.#clock())};
    const bytes=encoder.encode(JSON.stringify(value)),revisionId=await digest(bytes),objectKey=turnRevisionObjectKey(identity);await this.#putVerified(objectKey,bytes,revisionId);
    const confirmed=await this.#readManifest(identity);if(!confirmed||!same(confirmed.manifest,value)||confirmed.receipt.revisionId!==revisionId)reject('turn-revision-conflict');return confirmed.receipt;
  }
}

export const turnRevisionLimits={maxBlobBytes:MAX_BLOB_BYTES,maxManifestBytes:MAX_MANIFEST_BYTES};
