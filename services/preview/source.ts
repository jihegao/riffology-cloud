import {manualSaveIdentity,manualReceipt,type ManualSaveIdentity,type ManualRevisionReceipt} from '../turn-runtime/manual-save.ts';
import {initialWorkspaceReference,type InitialWorkspaceReference} from '../turn-runtime/initial-workspace.ts';
import {checkpointReceipt,sha,type CheckpointReceipt} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {PREVIEW_DECLARATION_PATH,parsePreviewDeclaration,type PreviewDeclaration} from './declaration.ts';

export type PreviewSource={kind:'manual-save';identity:ManualSaveIdentity;revision:ManualRevisionReceipt}|{kind:'saved-turn';identity:TurnRuntimeIdentity;revision:CheckpointReceipt}|{kind:'initial-workspace';reference:InitialWorkspaceReference;filesSha256:string};
export interface PreviewRevisionSource{files(source:PreviewSource):Promise<Uint8Array>}
export type ResolvedPreviewPlan={schemaVersion:1;kind:'service';source:PreviewSource;declaration:PreviewDeclaration;declarationSha256:string;entrypointSha256:string;dependencyLockSha256:string};
function exact(raw:unknown,keys:string[]):asserts raw is Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-preview-source');
 const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key]!,'value')||!descriptors[key]!.enumerable))throw Error('invalid-preview-source');
}
// Reject accessors and hidden data recursively before older initial-source validators read fields.
function data(raw:unknown):void{if(raw===null||typeof raw!=='object')return;if(Object.getPrototypeOf(raw)!==Object.prototype&& !Array.isArray(raw))throw Error('invalid-preview-source');for(const key of Reflect.ownKeys(raw)){if(typeof key!=='string')throw Error('invalid-preview-source');const d=Object.getOwnPropertyDescriptor(raw,key)!;if(!('value'in d)||(!d.enumerable&&!(Array.isArray(raw)&&key==='length')))throw Error('invalid-preview-source');data(d.value);}}
export function previewSource(raw:unknown):PreviewSource{
 data(raw);const kind=(raw as {kind?:unknown})?.kind;
 if(kind==='manual-save'){exact(raw,['kind','identity','revision']);return {kind,identity:manualSaveIdentity(raw.identity),revision:manualReceipt(raw.revision)};}
 if(kind==='saved-turn'){exact(raw,['kind','identity','revision']);if(checkpointReceipt(raw.revision).sessionSha256===null)throw Error('invalid-preview-source');return {kind,identity:turnRuntimeIdentity(raw.identity),revision:checkpointReceipt(raw.revision)};}
 if(kind==='initial-workspace'){exact(raw,['kind','reference','filesSha256']);return {kind,reference:initialWorkspaceReference(raw.reference),filesSha256:sha(raw.filesSha256)};}
 throw Error('invalid-preview-source');
}
export function previewSourceScope(source:PreviewSource){const s=previewSource(source);return s.kind!=='initial-workspace'?s.identity.scope:s.reference.scope;}
export function previewSourceFilesSha256(source:PreviewSource){const s=previewSource(source);return s.kind!=='initial-workspace'?s.revision.filesSha256:s.filesSha256;}
export function resolvedPreviewPlan(raw:unknown):ResolvedPreviewPlan{
 exact(raw,['schemaVersion','kind','source','declaration','declarationSha256','entrypointSha256','dependencyLockSha256']);
 if(raw.schemaVersion!==1||raw.kind!=='service')throw Error('invalid-preview-plan');
 return {schemaVersion:1,kind:'service',source:previewSource(raw.source),declaration:parsePreviewDeclaration(raw.declaration),declarationSha256:sha(raw.declarationSha256),entrypointSha256:sha(raw.entrypointSha256),dependencyLockSha256:sha(raw.dependencyLockSha256)};
}
const MAX_DECLARATION=16*1024,MAX_ENTRYPOINT=1024*1024,MAX_LOCK=64*1024;
async function digest(bytes:Uint8Array){const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function message(error:unknown){return error instanceof Error?error.message:'';}
function readDeclaration(archive:ReturnType<typeof workspaceArchiveReader>){
 try{return archive.read([{path:PREVIEW_DECLARATION_PATH,maxBytes:MAX_DECLARATION}]).get(PREVIEW_DECLARATION_PATH)!;}
 catch(error){
  if(message(error)==='workspace-content-missing')throw Error('preview-declaration-missing');
  if(['workspace-content-not-file','workspace-content-limit'].includes(message(error)))throw Error('preview-declaration-invalid');
  throw error;
 }
}
function readTargets(archive:ReturnType<typeof workspaceArchiveReader>,declaration:PreviewDeclaration){
 try{return archive.read([{path:declaration.entrypoint,maxBytes:MAX_ENTRYPOINT},{path:declaration.dependencyLock,maxBytes:MAX_LOCK}]);}
 catch(error){
  if(message(error)==='workspace-content-missing')throw Error('preview-declaration-target-missing');
  if(['workspace-content-not-file','workspace-content-limit'].includes(message(error)))throw Error('preview-declaration-target-invalid');
  throw error;
 }
}

/** Resolves an immutable saved Turn or verified initial Workspace. This is an execution plan, not
 * evidence of a running service, installed dependencies or a read-only app. */
export class PreviewPlanResolver{
  readonly #source:PreviewRevisionSource;
  constructor(source:PreviewRevisionSource){if(!source?.files)throw Error('preview-revision-source-required');this.#source=source;}
  async resolve(rawSource:PreviewSource):Promise<ResolvedPreviewPlan>{
    const source=previewSource(rawSource);if(source.kind==='manual-save')throw Error('manual-preview-execution-unsupported');
    const raw=await this.#source.files(structuredClone(source));
    if(!(raw instanceof Uint8Array)||raw.length>56*1024*1024)throw Error('invalid-preview-revision');
    const archive=workspaceArchiveReader(raw);
    if(await archive.sha256()!==previewSourceFilesSha256(source))throw Error('preview-revision-mismatch');
    const declarationBytes=readDeclaration(archive);
    let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(declarationBytes));}catch{throw Error('preview-declaration-invalid');}
    const declaration=parsePreviewDeclaration(parsed);
    const files=readTargets(archive,declaration);
    return {schemaVersion:1,kind:'service',source,declaration,declarationSha256:await digest(declarationBytes),entrypointSha256:await digest(files.get(declaration.entrypoint)!),dependencyLockSha256:await digest(files.get(declaration.dependencyLock)!)};
  }
}
