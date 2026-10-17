import {ManagedCandidateError,packageManagedCandidate,managedCandidateRecoveryFiles,type ManagedCandidateValidation} from './managed-candidate.ts';
import {initialWorkspaceArchive} from './initial-workspace-archive.ts';
import {overlayWorkspaceArchive,workspaceArchiveReader,workspaceFileIndex} from './workspace-file-index.ts';
import {ARTIFACT_MANIFEST,ARTIFACT_LIMIT,parseModelArtifacts,validateArtifactContents} from '../simulation/model-artifacts.ts';
import {resourceKind,resourceText,RESOURCE_LIMITS} from '../project-resources/text.mjs';
import {PROJECT_VIEWS_MANIFEST,parseProjectViews,projectViewTextAsset,readProjectViewsArchive} from '../project-views/package.ts';

const encoder=new TextEncoder();
type Result={operation:'answer';validation:ManagedCandidateValidation}|{operation:'save';filesArchive:Uint8Array;validation:ManagedCandidateValidation};
function archiveFiles(bytes:Uint8Array):Record<string,Uint8Array>{
 if(bytes.length>8*1024*1024)throw Error('managed-base-too-large');
 const entries=workspaceFileIndex(bytes).files.filter(f=>f.type==='file');if(entries.length>512)throw Error('managed-base-too-large');
 const reader=workspaceArchiveReader(bytes);
 return Object.fromEntries(entries.map(f=>[f.path,reader.read([{path:f.path,maxBytes:Math.max(1,f.size)}]).get(f.path)!]));
}
function archiveLimits(archive:Uint8Array){
 const index=workspaceFileIndex(archive),resources=index.files.filter(f=>resourceKind(f.path));
 if(resources.length>RESOURCE_LIMITS.files||resources.some(f=>f.type!=='file'||f.size>RESOURCE_LIMITS.fileBytes)||resources.reduce((sum,f)=>sum+f.size,0)>RESOURCE_LIMITS.totalBytes)throw Error('managed-resource-limit');
 if(archive.length>8*1024*1024||index.files.filter(f=>f.type==='file').length>512)throw Error('managed-base-too-large');
}
/** Pages are an explicit authoring role. They cannot replace model, design or
 * instruction files through a display manifest, and never delete base bytes. */
function pagesCandidate(v:Record<string,unknown>,base:Uint8Array|undefined):Result{
 if(Object.keys(v).sort().join(',')!=='files,manifest,operation,schemaVersion'||!v.files||Object.getPrototypeOf(v.files)!==Object.prototype)throw Error('pages-fields-invalid');
 const manifest=parseProjectViews(v.manifest),declared=new Set(manifest.files),updates:Record<string,Uint8Array>={};
 if(declared.has(PROJECT_VIEWS_MANIFEST))throw Error('pages-manifest-self-reference');
 for(const [path,value]of Object.entries(v.files)){
  if(!declared.has(path)||!projectViewTextAsset(path)||resourceKind(path)||/^(?:model|frontend|design)\//.test(path))throw Error('pages-file-role-invalid');
  if(typeof value!=='string'||!value.isWellFormed())throw Error('utf8-text-required');
  updates[path]=encoder.encode(value);
 }
 updates[PROJECT_VIEWS_MANIFEST]=encoder.encode(JSON.stringify(manifest));
 if(base)archiveLimits(base);
 const filesArchive=overlayWorkspaceArchive(base??initialWorkspaceArchive({}),updates,[]);
 archiveLimits(filesArchive);
 readProjectViewsArchive(filesArchive);
 // A newly saved page package must also fit the existing bounded cold-session
 // text context; opaque media remains in the immutable archive, never decoded.
 managedCandidateRecoveryFiles(filesArchive);
 return {operation:'save',filesArchive,validation:{status:'checked',schemaVersion:3,operation:'pages',traceValidation:'not-provided',execution:'not-recomputed'}};
}
/** v3 changes authoring intent, never the frozen v1/v2 execution contracts.
 * Design edits overlay the authorized base; omitted files are not deleted. */
export function resolveManagedCandidate(raw:unknown,base:Uint8Array|undefined,legacySaved:Readonly<Record<string,string>>={}):Result{
 if(!raw||typeof raw!=='object'||!('schemaVersion' in raw)||raw.schemaVersion!==3)return {operation:'save',...packageManagedCandidate(raw,legacySaved)};
 try{
  const v=raw as Record<string,unknown>;
  if(encoder.encode(JSON.stringify(v)).length>512*1024)throw Error('candidate-too-large');
  if(v.operation==='answer'){
   if(Object.keys(v).sort().join(',')!=='operation,schemaVersion')throw Error('answer-fields-invalid');
   return {operation:'answer',validation:{status:'checked',schemaVersion:3,operation:'answer',traceValidation:'not-provided',execution:'not-recomputed'}};
  }
  if(v.operation==='pages')return pagesCandidate(v,base);
  const expected=v.operation==='design'?'artifacts,files,operation,schemaVersion':v.operation==='model'?'artifacts,files,operation,preview,schemaVersion,spec':'';
  if(!expected||Object.keys(v).sort().join(',')!==expected||!v.files||typeof v.files!=='object'||Array.isArray(v.files))throw Error('schema-invalid');
  const manifest=parseModelArtifacts(v.artifacts),declared=new Set(manifest.files.map(f=>f.path)),patch:Record<string,Uint8Array>={},model:Record<string,string>={};
  for(const [path,value]of Object.entries(v.files)){
   if(typeof value!=='string')throw Error('utf8-text-required');
   if(resourceKind(path)){resourceText(path,value);patch[path]=encoder.encode(value);}
   else if(declared.has(path))patch[path]=encoder.encode(value);
   else if(v.operation==='model')model[path]=value;
   else throw Error('design-file-role-invalid');
  }
  const files:Record<string,Uint8Array>={},updates:Record<string,Uint8Array>={},removed:string[]=[];
  if(base){
   if(base.length>8*1024*1024||workspaceFileIndex(base).files.filter(f=>f.type==='file').length>512)throw Error('managed-base-too-large');
   const reader=workspaceArchiveReader(base);
   for(const entry of manifest.files)if(!Object.hasOwn(patch,entry.path))files[entry.path]=reader.read([{path:entry.path,maxBytes:ARTIFACT_LIMIT}]).get(entry.path)!;
  }
  let validation:ManagedCandidateValidation={status:'checked',schemaVersion:3,operation:'design',traceValidation:'not-provided',execution:'not-recomputed'};
  if(v.operation==='model'){
   const packaged=packageManagedCandidate({schemaVersion:2,spec:v.spec,files:model,preview:v.preview});
   delete files['frontend/manifest.json'];delete files['frontend/main.mjs'];
   const compute=archiveFiles(packaged.filesArchive);Object.assign(files,compute);Object.assign(updates,compute);
   for(const path of ['frontend/manifest.json','frontend/main.mjs'])if(!Object.hasOwn(compute,path))removed.push(path);
   if(packaged.validation.status!=='checked')throw Error('candidate-invalid');
   validation={...packaged.validation,schemaVersion:3,operation:'model'};
  }
  Object.assign(files,patch);Object.assign(updates,patch);validateArtifactContents(manifest,files);
  updates[ARTIFACT_MANIFEST]=encoder.encode(JSON.stringify(manifest));
  const filesArchive=overlayWorkspaceArchive(base??initialWorkspaceArchive({}),updates,removed);
  archiveLimits(filesArchive);
  return {operation:'save',filesArchive,validation};
 }catch(error){if(error instanceof ManagedCandidateError)throw error;throw new ManagedCandidateError('managed-candidate-invalid','candidate.json','$',error instanceof Error?error.message:'schema-invalid');}
}
