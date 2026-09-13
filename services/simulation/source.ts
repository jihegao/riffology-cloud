import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {previewSource,previewSourceFilesSha256,type PreviewSource} from '../preview/source.ts';
import {parseModelSpec,type ModelSpec} from './model-spec.ts';
export type SimulationPlan={source:PreviewSource;spec:ModelSpec;specSha256:string;entrypointSha256:string;dependencyLockSha256:string};
export async function digest(value:Uint8Array|string){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function simulationPlan(raw:PreviewSource,bytes:Uint8Array):Promise<SimulationPlan>{
 const source=previewSource(raw),archive=workspaceArchiveReader(bytes);
 if(await archive.sha256()!==previewSourceFilesSha256(source))throw Error('simulation-source-mismatch');
 let specBytes:Uint8Array;
 try{specBytes=archive.read([{path:'model/model-spec.json',maxBytes:32768}]).get('model/model-spec.json')!;}
 catch(error){if(error instanceof Error&&error.message==='workspace-content-missing')throw Error('model-spec-missing');throw Error('model-spec-invalid');}
 let spec:ModelSpec;try{spec=parseModelSpec(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(specBytes)));}catch{throw Error('model-spec-invalid');}
 let files:Map<string,Uint8Array>;
 try{files=archive.read([{path:spec.execution.entrypoint,maxBytes:1024*1024},{path:spec.execution.dependencyLock,maxBytes:65536}]);}catch{throw Error('model-contract-mismatch');}
 const lockBytes=files.get(spec.execution.dependencyLock)!;
 let lock;try{lock=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(lockBytes));}catch{throw Error('model-dependencies-invalid');}
 if(!lock||Object.keys(lock).sort().join(',')!=='packages,schemaVersion'||lock.schemaVersion!==1||!lock.packages||Array.isArray(lock.packages)||typeof lock.packages!=='object'||Object.entries(lock.packages).some(([k,v])=>k!=='simpy'||v!=='4.1.1'))throw Error('model-dependencies-unsupported');
 return {source,spec,specSha256:await digest(specBytes),entrypointSha256:await digest(files.get(spec.execution.entrypoint)!),dependencyLockSha256:await digest(lockBytes)};
}
export function modelVersion(plan:SimulationPlan){return {revisionId:plan.source.kind==='saved-turn'?plan.source.revision.revisionId:null,filesSha256:previewSourceFilesSha256(plan.source),specSha256:plan.specSha256};}
