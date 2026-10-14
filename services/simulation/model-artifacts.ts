import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';

export const ARTIFACT_MANIFEST='model/artifacts.json';
export const ARTIFACT_LIMIT=128*1024;
export type ArtifactRole='document'|'sysml'|'graph';
export type ArtifactView={id:string;section:'model'|'preview'|'runs';title:string;renderer:'document'|'source'|'graph'|'scene'|'metrics'|'history';source:string};
export type ModelArtifacts={schema:'riffology.model-artifacts/v1';files:Array<{path:string;role:ArtifactRole}>;views:ArtifactView[]};
export type DesignGraph={schema:'riffology.design-graph/v1';kind:'bdd'|'ibd'|'activity'|'parametric'|'general';nodes:Array<{id:string;label:string}>;edges:Array<{from:string;to:string;label:string}>};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const oneOf=(v:unknown,values:readonly string[]):v is string=>typeof v==='string'&&values.includes(v);
export function artifactPath(v:unknown):v is string{return typeof v==='string'&&v.length<=160&&/^design\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:md|txt|sysml|json)$/.test(v);}
export function parseDesignGraph(value:unknown):DesignGraph{
 if(!exact(value,['schema','kind','nodes','edges'])||value.schema!=='riffology.design-graph/v1'||!oneOf(value.kind,['bdd','ibd','activity','parametric','general'])||!Array.isArray(value.nodes)||value.nodes.length<1||value.nodes.length>64||!Array.isArray(value.edges)||value.edges.length>128)throw Error('design-graph-invalid');
 const ids=new Set<string>();
 for(const n of value.nodes){if(!exact(n,['id','label'])||!id(n.id)||ids.has(n.id)||!text(n.label,128))throw Error('design-graph-invalid');ids.add(n.id);}
 for(const e of value.edges)if(!exact(e,['from','to','label'])||!id(e.from)||!id(e.to)||!ids.has(e.from)||!ids.has(e.to)||typeof e.label!=='string'||e.label.length>128)throw Error('design-graph-invalid');
 return value as DesignGraph;
}
/** Declarative display only. No URLs, HTML, imports, code entrypoints or nested tabs. */
export function parseModelArtifacts(value:unknown):ModelArtifacts{
 if(!exact(value,['schema','files','views'])||value.schema!=='riffology.model-artifacts/v1'||!Array.isArray(value.files)||value.files.length>24||!Array.isArray(value.views)||value.views.length>24||encoder.encode(JSON.stringify(value)).length>32768)throw Error('model-artifacts-invalid');
 const roles=new Map<string,ArtifactRole>(),ids=new Set<string>();
 for(const f of value.files){if(!exact(f,['path','role'])||!artifactPath(f.path)||roles.has(f.path)||!oneOf(f.role,['document','sysml','graph'])||f.role==='graph'&&!f.path.endsWith('.json')||f.role==='sysml'&&!/\.(sysml|txt)$/.test(f.path)||f.role==='document'&&!/\.(md|txt)$/.test(f.path))throw Error('model-artifacts-invalid');roles.set(f.path,f.role as ArtifactRole);}
 for(const v of value.views){
  if(!exact(v,['id','section','title','renderer','source'])||!id(v.id)||ids.has(v.id)||!text(v.title,80)||!oneOf(v.section,['model','preview','runs'])||typeof v.source!=='string')throw Error('model-view-invalid');ids.add(v.id);
  const role=roles.get(v.source);
  const valid=v.section==='model'?(v.renderer==='document'&&role==='document'||v.renderer==='source'&&role==='sysml'||v.renderer==='graph'&&role==='graph'):v.section==='preview'?(oneOf(v.renderer,['scene','metrics'])&&v.source==='preview.trace'):(oneOf(v.renderer,['history','metrics'])&&v.source==='runs.records');
  if(!valid)throw Error('model-view-source-invalid');
 }
 return value as ModelArtifacts;
}
export function validateArtifactContents(manifest:ModelArtifacts,files:Readonly<Record<string,Uint8Array>>){
 let size=0;
 for(const entry of manifest.files){const bytes=files[entry.path];if(!bytes||bytes.length>ARTIFACT_LIMIT)throw Error('model-artifact-content-invalid');size+=bytes.length;if(size>512*1024)throw Error('model-artifacts-too-large');const source=decoder.decode(bytes);if(entry.role==='graph')parseDesignGraph(JSON.parse(source));}
}
/** Caller has already authorized and checked the complete Revision archive digest. */
export function readModelArtifacts(bytes:Uint8Array):{manifest:ModelArtifacts;contents:Record<string,string>}|null{
 if(!workspaceFileIndex(bytes).files.some(f=>f.path===ARTIFACT_MANIFEST))return null;
 const reader=workspaceArchiveReader(bytes),manifest=parseModelArtifacts(JSON.parse(decoder.decode(reader.read([{path:ARTIFACT_MANIFEST,maxBytes:32768}]).get(ARTIFACT_MANIFEST)!)));
 const files:Record<string,Uint8Array>={};
 for(const entry of manifest.files)files[entry.path]=reader.read([{path:entry.path,maxBytes:ARTIFACT_LIMIT}]).get(entry.path)!;
 validateArtifactContents(manifest,files);
 return {manifest,contents:Object.fromEntries(Object.entries(files).map(([path,content])=>[path,decoder.decode(content)]))};
}
