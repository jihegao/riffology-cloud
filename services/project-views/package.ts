import {parse} from 'acorn';
import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
import {previewSourceFilesSha256,previewSourceScope,type PreviewSource} from '../preview/source.ts';
export const PROJECT_VIEWS_MANIFEST='app/views.json';
export const VIEW_LIMITS={files:64,fileBytes:256*1024,totalBytes:2*1024*1024,views:16};
export type ProjectView={id:string;title:string;entrypoint:string};
export type ProjectViewsManifest={schema:'project.views/v1';files:string[];views:ProjectView[]};
export type ProjectViewPackage={schema:'project.view-package/v1';scope:{tenantId:string;projectId:string;workspaceId:string;workspaceGeneration:number};revisionId:string|null;filesSha256:string;manifest:ProjectViewsManifest;assets:Array<{path:string;mediaType:string;base64:string;sourceSha256:string;sha256:string}>;packageIdentity:string};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf8',{fatal:true});
const media:Record<string,string>={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',txt:'text/plain',md:'text/plain',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',woff2:'font/woff2',mp3:'audio/mpeg',mp4:'video/mp4'};
function fail(code:string):never{throw Error('project-view-'+code);}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function exact(v:unknown,keys:string[]):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))fail('manifest-invalid');}
export function viewAssetPath(v:unknown):v is string{return typeof v==='string'&&v.length<=200&&/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(v)&&!v.split('/').some(p=>p==='node_modules'||p==='vendor')&&Object.hasOwn(media,v.split('.').at(-1)!);}
export function resolveViewAsset(from:string,reference:string):string{
 if(!reference||/[\\?#%\s]/.test(reference)||reference.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(reference))fail('reference-invalid');
 const parts=from.split('/').slice(0,-1);
 for(const part of reference.split('/')){if(part==='.')continue;if(part==='..'){if(!parts.length)fail('reference-invalid');parts.pop();}else parts.push(part);}
 const path=parts.join('/');if(!viewAssetPath(path))fail('reference-invalid');return path;
}
export function parseProjectViews(raw:unknown):ProjectViewsManifest{
 exact(raw,['schema','files','views']);if(raw.schema!=='project.views/v1'||!Array.isArray(raw.files)||raw.files.length<1||raw.files.length>VIEW_LIMITS.files||!Array.isArray(raw.views)||raw.views.length<1||raw.views.length>VIEW_LIMITS.views)fail('manifest-invalid');
 const files=new Set<string>(),ids=new Set<string>();
 for(const path of raw.files){if(!viewAssetPath(path)||files.has(path))fail('manifest-invalid');files.add(path);}
 for(const v of raw.views){exact(v,['id','title','entrypoint']);if(typeof v.id!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(v.id)||ids.has(v.id)||typeof v.title!=='string'||!v.title.trim()||v.title.length>80||typeof v.entrypoint!=='string'||!v.entrypoint.endsWith('.html')||!files.has(v.entrypoint))fail('manifest-invalid');ids.add(v.id);}
 return raw as ProjectViewsManifest;
}
async function sha(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}
/** Parse references, not a JS behavior allowlist: DOM and arbitrary project
 * functions execute only inside the opaque frame under its network CSP. */
function moduleBytes(path:string,bytes:Uint8Array,files:Set<string>){
 const source=decoder.decode(bytes),replacements:Array<{start:number;end:number;text:string}>=[];
 const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
 function visit(value:unknown){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const n of value)visit(n);return;}
  const node=value as Record<string,unknown>;
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(String(node.type))&&node.source){
   const ref=node.source as {type:string;value?:unknown;start:number;end:number};
   if(ref.type!=='Literal'||typeof ref.value!=='string')fail('dynamic-import-invalid');
   // Bare dependency paths are not implicitly fetched or installed.
   if(!ref.value.startsWith('./')&&!ref.value.startsWith('../'))fail('reference-invalid');
   const target=resolveViewAsset(path,ref.value);if(!files.has(target)||! /\.(?:mjs|js)$/.test(target))fail('asset-missing');
   replacements.push({start:ref.start,end:ref.end,text:JSON.stringify('https://project.invalid/'+target)});
  }
  for(const child of Object.values(node))if(child&&typeof child==='object')visit(child);
 }
 visit(tree);let output=source;for(const r of replacements.sort((a,b)=>b.start-a.start))output=output.slice(0,r.start)+r.text+output.slice(r.end);
 return encoder.encode(output);
}
export async function buildProjectViews(source:PreviewSource,archive:Uint8Array):Promise<ProjectViewPackage|null>{
 const reader=workspaceArchiveReader(archive),index=workspaceFileIndex(archive);
 if(await reader.sha256()!==previewSourceFilesSha256(source))fail('source-mismatch');
 if(!index.files.some(f=>f.path===PROJECT_VIEWS_MANIFEST))return null;
 const manifest=parseProjectViews(JSON.parse(decoder.decode(reader.read([{path:PROJECT_VIEWS_MANIFEST,maxBytes:16384}]).get(PROJECT_VIEWS_MANIFEST)!)));
 const wanted=new Set(manifest.files);let total=0;
 const assets:ProjectViewPackage['assets']=[];
 for(const path of manifest.files){
  const entry=index.files.find(f=>f.path===path);if(!entry||entry.type!=='file')fail('asset-missing');
  total+=entry.size;if(entry.size>VIEW_LIMITS.fileBytes||total>VIEW_LIMITS.totalBytes)fail('size-limit');
  const original=reader.read([{path,maxBytes:VIEW_LIMITS.fileBytes}]).get(path)!,ext=path.split('.').at(-1)!,bytes=['js','mjs'].includes(ext)?moduleBytes(path,original,wanted):original;
  if(['html','css','json','txt','md','svg'].includes(ext))decoder.decode(original);
  if(bytes.length>VIEW_LIMITS.fileBytes)fail('size-limit');
  assets.push({path,mediaType:media[ext]!,base64:base64(bytes),sourceSha256:await sha(original),sha256:await sha(bytes)});
 }
 const body={schema:'project.view-package/v1' as const,scope:previewSourceScope(source),revisionId:source.kind==='saved-turn'?source.revision.revisionId:null,filesSha256:previewSourceFilesSha256(source),manifest,assets};
 return {...body,packageIdentity:await sha(encoder.encode(JSON.stringify(body)))};
}
