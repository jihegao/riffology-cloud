import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {parseModelSpec,type ModelSpec} from '../simulation/model-spec.ts';
import {BROWSER_PREVIEW_SCHEMA,BROWSER_PREVIEW_SOURCE_PATHS,previewSha256,type PreviewBuildReason,type PreviewPackageIdentityInput,type PreviewRuntime,type PreviewSourcePath} from './contract.ts';
import {PREVIEW_LIMITS,PREVIEW_SERVER_ADAPTER_SHA256,type PreviewProfileRegistry,type TrustedPreviewProfile} from './profiles.ts';
export type PreviewVisualization={schema:'riffology.visualization/v1';protocol:'riffology.visual/v0.1';renderer:'grid'|'lane';metricKeys:string[]};
export type SavedPreviewSource={projectId:string;revisionId:string;filesSha256:string};
export type CompatiblePreview={identity:PreviewPackageIdentityInput;files:Map<PreviewSourcePath,Uint8Array>;spec:ModelSpec;visualization:PreviewVisualization;profile:TrustedPreviewProfile};
export type PreviewCompatibility={status:'compatible';value:CompatiblePreview}|{status:'unsupported';reasonCode:PreviewBuildReason};
function reject(code:PreviewBuildReason):never{throw Error(code);}
function json(bytes:Uint8Array):unknown{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export function parsePreviewVisualization(raw:unknown,spec:ModelSpec):PreviewVisualization{
 const r=raw as Partial<PreviewVisualization>;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='metricKeys,protocol,renderer,schema'||r.schema!=='riffology.visualization/v1'||r.protocol!=='riffology.visual/v0.1'||!['grid','lane'].includes(r.renderer!)||!Array.isArray(r.metricKeys)||!r.metricKeys.length||r.metricKeys.length>64||r.metricKeys.some(k=>typeof k!=='string'||!Object.hasOwn(spec.metrics,k))||new Set(r.metricKeys).size!==r.metricKeys.length)reject('visualization-invalid');
 return {schema:r.schema,protocol:r.protocol,renderer:r.renderer!,metricKeys:[...r.metricKeys]};
}
/** Conservative token policy explains unsupported code; HTTP/Worker isolation is separate. */
function pythonPolicy(bytes:Uint8Array,profile:TrustedPreviewProfile,model:boolean){
 let source:string;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return reject('python-unsupported');}
 if(source.includes('\0')||source.includes('\\\n'))reject('python-unsupported');
 // Preserve line structure and identifiers while ignoring Python strings/comments.
 const tokens=source.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|#[^\n]*/g,m=>m.replace(/[^\n]/g,' '));
 const allowed=new Set(['math','random','heapq','collections','itertools','statistics','dataclasses','typing','enum','functools','json',...profile.runtime.dependencies.map(d=>d.name.replace(/-/g,'_')),...(!model?['argparse','pathlib','sys','model']:[])]);
 for(const match of tokens.matchAll(/(?:^|[;\n])\s*(from\s+([^\s]+)\s+import|import\s+([^\n;]+))/g)){
  const modules=match[2]?[match[2]]:match[3]!.split(',').map(s=>s.trim().split(/\s+/)[0]!);
  if(modules.some(name=>!allowed.has(name.split('.')[0]!)||name.startsWith('.')))reject('python-unsupported');
 }
 if(/\b(?:eval|exec|compile|__import__|importlib|micropip|js|pyodide|socket|subprocess|requests|urllib)\b/.test(tokens)||model&&/\b(?:open|input|globals|locals|vars|getattr|setattr|delattr|breakpoint)\b/.test(tokens))reject('python-unsupported');
 if(!model&&!/\bfrom\s+model\s+import\s+run\b|\bimport\s+model\b/.test(tokens))reject('python-unsupported');
 if(model&&!/^def\s+run\s*\(\s*config\s*\)\s*:/m.test(tokens))reject('python-unsupported');
 if(model)for(const line of tokens.split('\n'))if(line&&/^\S/.test(line)&&!/^\s*(?:def\s|class\s|from\s|import\s|@|[A-Za-z_][A-Za-z0-9_]*\s*=)/.test(line)&&!/^\s*[\])}]/.test(line))reject('python-unsupported');
 if(model)for(const line of tokens.split('\n'))if(/^[A-Za-z_][A-Za-z0-9_]*\s*=.*\b[A-Za-z_][A-Za-z0-9_.]*\s*\(/.test(line))reject('python-unsupported');
}
/** Caller must first authorize and resolve this saved Revision. No Session restore or runtime start. */
export async function validateSavedPreview(source:SavedPreviewSource,archiveBytes:Uint8Array,profileId:PreviewRuntime['profileId'],registry:PreviewProfileRegistry):Promise<PreviewCompatibility>{
 if(!source||Object.keys(source).sort().join(',')!=='filesSha256,projectId,revisionId'||typeof source.projectId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(source.projectId)||typeof source.revisionId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(source.revisionId)||typeof source.filesSha256!=='string'||! /^[a-f0-9]{64}$/.test(source.filesSha256))throw Error('browser-preview-source-invalid');
 const archive=workspaceArchiveReader(archiveBytes);
 if(await archive.sha256()!==source.filesSha256)throw Error('browser-preview-source-mismatch');
 const profile=registry.resolve(profileId);if(!profile)return {status:'unsupported',reasonCode:'profile-unavailable'};
 try{
  const files=new Map<PreviewSourcePath,Uint8Array>();
  // Reader bounds each request batch to 2 MiB, preserve that existing authority limit.
  for(const path of BROWSER_PREVIEW_SOURCE_PATHS){try{files.set(path,archive.read([{path,maxBytes:path==='model/model-spec.json'||path==='model/visualization.json'?32768:path==='app/requirements.lock'?65536:PREVIEW_LIMITS.sourceBytes}]).get(path)!);}catch(e){reject(e instanceof Error&&e.message==='workspace-content-limit'?'source-too-large':'source-missing');}}
  if([...files.values()].reduce((n,b)=>n+b.length,0)>PREVIEW_LIMITS.bundleBytes)reject('source-too-large');
  let spec:ModelSpec;try{spec=parseModelSpec(json(files.get('model/model-spec.json')!));}catch{reject('model-spec-invalid');}
  if(spec.execution.entrypoint!=='model/run.py'||spec.execution.dependencyLock!=='app/requirements.lock')reject('model-spec-invalid');
  if(spec.parameters.steps&&(spec.parameters.steps.type!=='integer'||typeof spec.parameters.steps.default!=='number'||spec.parameters.steps.default<1||spec.parameters.steps.default>PREVIEW_LIMITS.maxSteps||spec.parameters.steps.minimum===undefined||spec.parameters.steps.minimum<1||spec.parameters.steps.maximum===undefined||spec.parameters.steps.maximum>PREVIEW_LIMITS.maxSteps))reject('model-spec-invalid');
  let visualization:PreviewVisualization;try{visualization=parsePreviewVisualization(json(files.get('model/visualization.json')!),spec);}catch{reject('visualization-invalid');}
  let lock:unknown;try{lock=json(files.get('app/requirements.lock')!);}catch{reject('dependency-unsupported');}
  const r=lock as {schemaVersion?:number;packages?:unknown};
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='packages,schemaVersion'||r.schemaVersion!==1||!r.packages||typeof r.packages!=='object'||Array.isArray(r.packages)||JSON.stringify(Object.entries(r.packages).sort())!==JSON.stringify(Object.entries(profile.packages).sort()))reject('dependency-unsupported');
  // Verify must re-run this exact model, not a separate generated server implementation.
  if(await previewSha256(files.get('model/run.py')!)!==PREVIEW_SERVER_ADAPTER_SHA256)reject('python-unsupported');
  pythonPolicy(files.get('model/model.py')!,profile,true);pythonPolicy(files.get('model/run.py')!,profile,false);
  const sources=await Promise.all(BROWSER_PREVIEW_SOURCE_PATHS.map(async path=>({path,sha256:await previewSha256(files.get(path)!),byteLength:files.get(path)!.length})));
  return {status:'compatible',value:{identity:{schema:BROWSER_PREVIEW_SCHEMA,...source,sources,runtime:profile.runtime},files,spec,visualization,profile}};
 }catch(e){const reason=e instanceof Error?e.message:'';if(['source-missing','source-too-large','model-spec-invalid','visualization-invalid','dependency-unsupported','python-unsupported'].includes(reason))return {status:'unsupported',reasonCode:reason as PreviewBuildReason};throw e;}
}
