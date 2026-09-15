import {MESA_SERVER_PROFILE,mesaSourcePackages} from './server-profile.ts';
import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {previewSource,previewSourceFilesSha256,type PreviewSource} from '../preview/source.ts';
import {parseModelSpec,type ModelSpec} from './model-spec.ts';
export type SimulationPlan={source:PreviewSource;spec:ModelSpec;specSha256:string;entrypointSha256:string;dependencyLockSha256:string;executionProfile?:typeof MESA_SERVER_PROFILE};
export async function digest(value:Uint8Array|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function readModel(raw:PreviewSource,bytes:Uint8Array){
 const source=previewSource(raw),archive=workspaceArchiveReader(bytes);
 if(await archive.sha256()!==previewSourceFilesSha256(source))throw Error('simulation-source-mismatch');
 let specBytes:Uint8Array;
 try{specBytes=archive.read([{path:'model/model-spec.json',maxBytes:32768}]).get('model/model-spec.json')!;}
 catch(error){if(error instanceof Error&&error.message==='workspace-content-missing')throw Error('model-spec-missing');throw Error('model-spec-invalid');}
 let spec:ModelSpec;try{spec=parseModelSpec(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(specBytes)));}catch{throw Error('model-spec-invalid');}
 return {source,archive,spec,specSha256:await digest(specBytes)};
}
async function checkedPlan(model:Awaited<ReturnType<typeof readModel>>):Promise<SimulationPlan>{
 const {source,archive,spec,specSha256}=model;
 let files:Map<string,Uint8Array>;
 try{files=archive.read([{path:spec.execution.entrypoint,maxBytes:1024*1024},{path:spec.execution.dependencyLock,maxBytes:65536}]);}catch{throw Error('model-contract-mismatch');}
 const lockBytes=files.get(spec.execution.dependencyLock)!;
 let lock;try{lock=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(lockBytes));}catch{throw Error('model-dependencies-invalid');}
 if(!lock||Object.keys(lock).sort().join(',')!=='packages,schemaVersion'||lock.schemaVersion!==1||!lock.packages||Array.isArray(lock.packages)||typeof lock.packages!=='object'||(!mesaSourcePackages(lock.packages)&&Object.entries(lock.packages).some(([k,v])=>k!=='simpy'||v!=='4.1.1')))throw Error('model-dependencies-unsupported');
 return {...(mesaSourcePackages(lock.packages)?{executionProfile:MESA_SERVER_PROFILE}:{}),source,spec,specSha256,entrypointSha256:await digest(files.get(spec.execution.entrypoint)!),dependencyLockSha256:await digest(lockBytes)};
}
export function modelVersion(plan:SimulationPlan){return {revisionId:plan.source.kind==='saved-turn'?plan.source.revision.revisionId:null,filesSha256:previewSourceFilesSha256(plan.source),specSha256:plan.specSha256};}

export type ModelInspection = {
 version: {revisionId:string|null;filesSha256:string;specSha256:string}|null;
 spec: ModelSpec|null;
 reasonCode: string|null;
 canRun: boolean;
};
/** Read the saved semantic model even when its execution contract is invalid. */
export async function inspectModel(raw:PreviewSource,bytes:Uint8Array,runtimeAvailable:boolean):Promise<ModelInspection>{
 let model:Awaited<ReturnType<typeof readModel>>;
 try{model=await readModel(raw,bytes);}catch(error){
  const code=error instanceof Error?error.message:'';
  if(['model-spec-missing','model-spec-invalid'].includes(code))return {version:null,spec:null,reasonCode:code,canRun:false};
  throw error;
 }
 const {source,spec,specSha256}=model;
 const version={revisionId:source.kind==='saved-turn'?source.revision.revisionId:null,filesSha256:previewSourceFilesSha256(source),specSha256};
 try{await checkedPlan(model);}catch(error){
  const code=error instanceof Error?error.message:'';
  if(['model-contract-mismatch','model-dependencies-invalid','model-dependencies-unsupported'].includes(code))return {version,spec,reasonCode:code,canRun:false};
  throw error;
 }
 return {version,spec,reasonCode:null,canRun:runtimeAvailable};
}
export async function simulationPlan(raw:PreviewSource,bytes:Uint8Array):Promise<SimulationPlan>{
 return checkedPlan(await readModel(raw,bytes));
}
