import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
import {freezeProjectResources,resourceKind,resourceText,RESOURCE_LIMITS} from './text.mjs';
import {previewSourceFilesSha256,previewSourceScope,type PreviewSource} from '../preview/source.ts';
/** Only canonical immutable Revision bytes enter the text loader. No project
 * directory is mounted in the trusted host and links never enter this reader. */
export async function projectResourcesFromArchive(source:PreviewSource,archive:Uint8Array){
 const reader=workspaceArchiveReader(archive);
 if(await reader.sha256()!==previewSourceFilesSha256(source))throw Error('project-resource-source-mismatch');
 const entries=workspaceFileIndex(archive).files.filter(entry=>resourceKind(entry.path)!==null);
 if(entries.length>RESOURCE_LIMITS.files)throw Error('project-resource-count-limit');
 let total=0;
 for(const entry of entries){if(entry.type!=='file'||entry.size>RESOURCE_LIMITS.fileBytes)throw Error('project-resource-file-limit');total+=entry.size;}
 if(total>RESOURCE_LIMITS.totalBytes)throw Error('project-resource-total-limit');
 const bytes=entries.length?reader.read(entries.map(entry=>({path:entry.path,maxBytes:RESOURCE_LIMITS.fileBytes}))):new Map<string,Uint8Array>();
 const digest=async(raw:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(raw)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const files:Array<{path:string;content:string}>=[],diagnostics:Array<{path:string;code:string;sha256:string}>=[];
 for(const entry of entries){
  const raw=bytes.get(entry.path)!;let content:string;
  try{content=new TextDecoder('utf8',{fatal:true}).decode(raw);}catch{diagnostics.push({path:entry.path,code:'encoding-invalid',sha256:await digest(raw)});continue;}
  try{resourceText(entry.path,content);}catch(error){
   const code=error instanceof Error?error.message.replace(/^project-resource-/,''):'';
   if(!['invalid-text','frontmatter-invalid','empty-text','name-mismatch','description-required'].includes(code))throw error;
   diagnostics.push({path:entry.path,code,sha256:await digest(raw)});continue;
  }
  files.push({path:entry.path,content});
 }
 return freezeProjectResources({scope:previewSourceScope(source),revisionId:source.kind!=='initial-workspace'?source.revision.revisionId:null,filesSha256:previewSourceFilesSha256(source),files,diagnostics});
}
