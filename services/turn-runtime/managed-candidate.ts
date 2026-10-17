import {packageCandidateModel} from './candidate-artifact.ts';
import {managedRunner} from './managed-runner.ts';
import {workspaceArchiveReader,workspaceFileIndex} from './workspace-file-index.ts';
import {parseModelSpec,resolveParameters,validateMetrics,type ModelSpec} from '../simulation/model-spec.ts';
import {canonicalPreviewJson,parseBrowserJsManifest,type PreviewRuntime} from '../browser-preview/contract.ts';
import {PREVIEW_SOURCE_LOCKS} from '../browser-preview/profiles.ts';
import {parsePreviewVisualization,validatePreviewJavaScriptSource,validatePreviewPythonSource} from '../browser-preview/validator.ts';
import {validateInput,validateTrace,type RuntimeTrace} from '../browser-preview/runtime/protocol.mjs';
import {ARTIFACT_MANIFEST,readModelArtifacts} from '../simulation/model-artifacts.ts';
import {PROJECT_VIEWS_MANIFEST,projectViewTextAsset,readProjectViewsArchive} from '../project-views/package.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const core=['model/model.py','model/results.json','app/requirements.lock'] as const;
const frontend=['frontend/manifest.json','frontend/main.mjs'] as const;
const maximum:Readonly<Record<string,number>>={'model/model.py':128*1024,'model/results.json':128*1024,'app/requirements.lock':65536,'model/visualization.json':32768,'frontend/manifest.json':4096,'frontend/main.mjs':128*1024};
const recoveryMaximum={...maximum,'model/model.py':1024*1024,'model/model-spec.json':128*1024,'model/run.py':16384};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
export type ManagedCandidateDiagnostic={file:string;path:string;reason:string};
export type ManagedCandidateValidation={status:'checked';schemaVersion:1|2|3;operation?:'answer'|'design'|'model'|'pages';traceValidation:'not-provided'|'validated';execution:'not-recomputed';profileId?:PreviewRuntime['profileId']}|{status:'invalid';diagnostic:ManagedCandidateDiagnostic};
export class ManagedCandidateError extends Error{
 readonly diagnostic:ManagedCandidateDiagnostic;
 constructor(code:string,file:string,path:string,reason:string){super(code);this.diagnostic={file:file.slice(0,128),path:path.slice(0,256),reason:reason.slice(0,128)};}
}
function reject(file:string,path:string,reason:string,code='managed-candidate-invalid'):never{throw new ManagedCandidateError(code,file,path,reason);}
function check<T>(file:string,path:string,operation:()=>T):T{
 try{return operation();}catch(error){if(error instanceof ManagedCandidateError)throw error;reject(file,path,error instanceof Error&&/^[a-z0-9-]+$/.test(error.message)?error.message:'invalid-json');}
}
function json(files:Record<string,Uint8Array>,file:string):unknown{return check(file,'$',()=>JSON.parse(decoder.decode(files[file]!)));}

/** Error localization only; validateTrace remains the authoritative protocol check. */
function traceErrorPath(raw:unknown,reason:string):string{
 if(!object(raw))return 'trace';
 if(reason==='runtime-trace-invalid')return typeof raw.model!=='string'||!raw.model.length||raw.model.length>128?'trace.model':'trace.snapshots';
 if(!Array.isArray(raw.snapshots))return 'trace.snapshots';
 let previousFrame=-1,previousTime=-1;
 for(let i=0;i<raw.snapshots.length;i++){
  const snapshot=raw.snapshots[i],root='trace.snapshots['+i+']';
  if(object(snapshot)&&typeof snapshot.frame==='number'&&snapshot.frame<=previousFrame)return root+'.frame';
  if(object(snapshot)&&typeof snapshot.time==='number'&&snapshot.time<previousTime)return root+'.time';
  try{validateTrace({model:raw.model,snapshots:[snapshot]});}catch(error){
   if(!object(snapshot))return root;
   const code=error instanceof Error?error.message:'';
   if(code==='runtime-snapshot-invalid'){
    if(!exact(snapshot,['schemaVersion','frame','time','space','agents','metrics']))return root;
    if(snapshot.schemaVersion!=='riffology.visual/v0.1')return root+'.schemaVersion';
    if(!Number.isInteger(snapshot.frame))return root+'.frame';
    if(!finite(snapshot.time)||Number(snapshot.time)<0)return root+'.time';
    if(!object(snapshot.space))return root+'.space';
    if(!Array.isArray(snapshot.agents)||snapshot.agents.length>10000)return root+'.agents';
    return root+'.metrics';
   }
   if(code==='runtime-metric-invalid'&&object(snapshot.metrics)){
    const metric=Object.entries(snapshot.metrics).find(([key,value])=>key.length>128||!finite(value));
    return root+'.metrics'+(metric?'['+JSON.stringify(metric[0])+']':'');
   }
   if(code==='runtime-space-invalid'&&object(snapshot.space)){
    const space=snapshot.space;
    if(space.type!=='grid'&&space.type!=='lane')return root+'.space.type';
    if(space.type==='lane')return root+'.space.lanes';
    return root+'.space'+(!Number.isInteger(space.width)||Number(space.width)<1?'.width':'.height');
   }
   if(code==='runtime-agent-invalid'&&Array.isArray(snapshot.agents)&&object(snapshot.space)){
    const space=snapshot.space,ids=new Set();
    for(let j=0;j<snapshot.agents.length;j++){
     const agent=snapshot.agents[j],at=root+'.agents['+j+']';
     if(!object(agent))return at;
     const fields=space.type==='grid'?['id','type','state','x','y']:['id','type','state','lane','position'];
     if(!exact(agent,fields))return at;
     for(const key of ['id','type','state'])if(typeof agent[key]!=='string'||!agent[key].length||agent[key].length>128)return at+'.'+key;
     if(ids.has(agent.id))return at+'.id';ids.add(agent.id);
     if(space.type==='grid'){
      if(!Number.isInteger(agent.x)||Number(agent.x)<0||Number(agent.x)>=Number(space.width))return at+'.x';
      if(!Number.isInteger(agent.y)||Number(agent.y)<0||Number(agent.y)>=Number(space.height))return at+'.y';
     }else{
      if(!Array.isArray(space.lanes)||!space.lanes.includes(agent.lane))return at+'.lane';
      if(!finite(agent.position)||Number(agent.position)<0)return at+'.position';
     }
    }
   }
   return root;
  }
  if(object(snapshot)){previousFrame=Number(snapshot.frame);previousTime=Number(snapshot.time);}
 }
 return 'trace';
}
function trace(raw:unknown):RuntimeTrace{
 try{return validateTrace(raw);}catch(error){const reason=error instanceof Error?error.message:'runtime-trace-invalid';reject('candidate.json','preview.'+traceErrorPath(raw,reason),reason);}
}
/** Current saved roles only. Reads are bounded and never execute model/front-end code. */
export function managedCandidateRecoveryFiles(archive:Uint8Array):Record<string,string>{
 const entries=check('candidate.json','files',()=>workspaceFileIndex(archive).files.filter(entry=>entry.type==='file'&&Object.hasOwn(recoveryMaximum,entry.path)));
 const reader=check('candidate.json','files',()=>workspaceArchiveReader(archive)),files:Record<string,string>={};
 for(const entry of entries){
  const limit=recoveryMaximum[entry.path as keyof typeof recoveryMaximum]!;
  if(entry.size>limit)reject(entry.path,'$','recovery-file-too-large');
  const bytes=check(entry.path,'$',()=>reader.read([{path:entry.path,maxBytes:limit}]).get(entry.path)!);
  try{files[entry.path]=decoder.decode(bytes);}catch{reject(entry.path,'$','invalid-utf8');}
 }
 const artifacts=check(ARTIFACT_MANIFEST,'$',()=>readModelArtifacts(archive));
 if(artifacts){files[ARTIFACT_MANIFEST]=JSON.stringify(artifacts.manifest);Object.assign(files,artifacts.contents);}
 const pages=check(PROJECT_VIEWS_MANIFEST,'$',()=>readProjectViewsArchive(archive));
 if(pages){
  files[PROJECT_VIEWS_MANIFEST]=JSON.stringify(pages.manifest);
  for(const asset of pages.assets)if(projectViewTextAsset(asset.path))files[asset.path]=decoder.decode(asset.original);
 }
 if(encoder.encode(JSON.stringify(files)).byteLength>1024*1024)reject('candidate.json','files','managed-recovery-too-large');
 return files;
}
function parsedSpec(raw:unknown):ModelSpec{
 return check('candidate.json','spec',()=>{
  const spec=parseModelSpec(raw);
  if('kind' in spec.execution||spec.execution.entrypoint!=='model/run.py'||spec.execution.dependencyLock!=='app/requirements.lock')reject('candidate.json','spec.execution','profile-unsupported');
  return spec;
 });
}
function previewInput(raw:unknown){
 try{return validateInput(raw);}catch(error){
  const reason=error instanceof Error?error.message:'runtime-input-invalid';let path='preview.input';
  if(reason==='runtime-seed-invalid')path+='.seed';
  else if(reason==='runtime-steps-invalid')path+='.parameters.steps';
  else if(reason==='runtime-parameter-invalid'&&object(raw)&&object(raw.parameters))for(const [key,value]of Object.entries(raw.parameters)){
   try{validateInput({parameters:{[key]:value},seed:0});}catch{path+='.parameters['+JSON.stringify(key)+']';break;}
  }
  reject('candidate.json',path,reason);
 }
}
/** v2 checks reported candidate output, not execution provenance or Evidence.
 * v1 is retained for frozen legacy candidates; its missing trace is explicit. */
export function packageManagedCandidate(raw:unknown,saved:Readonly<Record<string,string>>={}):{filesArchive:Uint8Array;validation:ManagedCandidateValidation}{
 if(!object(raw)||!exact(raw,raw.schemaVersion===2?['schemaVersion','spec','files','preview']:['schemaVersion','spec','files'])||raw.schemaVersion!==1&&raw.schemaVersion!==2||!object(raw.files))reject('candidate.json','$','schema-invalid','managed-candidate-schema');
 if(encoder.encode(JSON.stringify(raw)).byteLength>512*1024)reject('candidate.json','$','candidate-too-large','managed-candidate-too-large');
 const version=raw.schemaVersion,keys=Object.keys(raw.files),required=version===1?[...core]:[...core,'model/visualization.json'];
 if(required.some(path=>!keys.includes(path))||keys.some(path=>!required.includes(path)&&!(version===2&&frontend.includes(path as typeof frontend[number]))))reject('candidate.json','files','file-roles-invalid','managed-candidate-schema');
 const files:Record<string,Uint8Array>={};
 for(const [path,value]of Object.entries(raw.files)){
  if(typeof value!=='string')reject('candidate.json','files['+JSON.stringify(path)+']','utf8-text-required','managed-candidate-schema');
  const bytes=encoder.encode(value),limit=version===1?128*1024:maximum[path]!;
  if(bytes.length>limit)reject(path,'$','file-too-large','managed-candidate-too-large');
  files[path]=bytes;
 }
 const spec=parsedSpec(raw.spec);
 if(version===1){
  for(const path of ['model/visualization.json',...frontend])if(saved[path]!==undefined)files[path]=encoder.encode(saved[path]!);
  if(files['model/visualization.json']){
   const visualization=check('model/visualization.json','$',()=>parsePreviewVisualization(json(files,'model/visualization.json'),spec));
   if(visualization.renderer==='javascript-canvas'&&frontend.some(path=>!files[path]))reject('candidate.json','files','frontend-roles-mismatch');
  }
  if(!files['model/visualization.json'])files['model/visualization.json']=encoder.encode(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'lane',metricKeys:Object.keys(spec.metrics)}));
  files['model/run.py']=encoder.encode(managedRunner);
  return {filesArchive:packageCandidateModel(files,spec),validation:{status:'checked',schemaVersion:1,traceValidation:'not-provided',execution:'not-recomputed'}};
 }
 if(encoder.encode(JSON.stringify(spec)).byteLength>32768)reject('candidate.json','spec','model-spec-too-large','managed-candidate-too-large');
 const steps=spec.parameters.steps;
 if(steps&&(steps.type!=='integer'||steps.minimum===undefined||steps.minimum<1||steps.maximum===undefined||steps.maximum>500))reject('candidate.json','spec.parameters.steps','steps-bounds-unsupported');
 const preview=raw.preview;
 if(!exact(preview,['profileId','input','trace']))reject('candidate.json','preview','schema-invalid','managed-candidate-schema');
 const profileId=preview.profileId;
 if(profileId!=='python-stdlib/v1'&&profileId!=='mesa-3.5.1/v1')reject('candidate.json','preview.profileId','profile-unsupported');
 const packages=PREVIEW_SOURCE_LOCKS[profileId],lock=json(files,'app/requirements.lock');
 if(!exact(lock,['schemaVersion','packages'])||lock.schemaVersion!==1||canonicalPreviewJson(lock.packages)!==canonicalPreviewJson(packages))reject('app/requirements.lock','packages','dependency-unsupported');
 const visualization=check('model/visualization.json','$',()=>parsePreviewVisualization(json(files,'model/visualization.json'),spec));
 const withFrontend=visualization.renderer==='javascript-canvas';
 if(frontend.some(path=>Object.hasOwn(files,path)!==withFrontend))reject('candidate.json','files','frontend-roles-mismatch','managed-candidate-schema');
 if(withFrontend){
  check('frontend/manifest.json','$',()=>parseBrowserJsManifest(json(files,'frontend/manifest.json')));
  check('frontend/main.mjs','$',()=>validatePreviewJavaScriptSource(files['frontend/main.mjs']!));
 }
 check('model/model.py','$',()=>validatePreviewPythonSource(files['model/model.py']!,packages,true,visualization.renderer==='python-canvas'));
 const input=previewInput(preview.input);
 const defaults=resolveParameters(spec,{});
 for(const key of Object.keys(input.parameters)){
  if(!Object.hasOwn(spec.parameters,key))reject('candidate.json','preview.input.parameters['+JSON.stringify(key)+']','parameter-undeclared');
  check('candidate.json','preview.input.parameters['+JSON.stringify(key)+']',()=>resolveParameters(spec,{[key]:input.parameters[key]}));
 }
 if(canonicalPreviewJson(input.parameters)!==canonicalPreviewJson(defaults))reject('candidate.json','preview.input.parameters','default-input-mismatch');
 const checked=trace(preview.trace);
 for(let i=0;i<checked.snapshots.length;i++)if((visualization.renderer==='grid'||visualization.renderer==='lane')&&checked.snapshots[i]!.space.type!==visualization.renderer)reject('candidate.json','preview.trace.snapshots['+i+'].space.type','renderer-space-mismatch');
 const final=checked.snapshots.at(-1)!,metrics:Record<string,number>={};
 for(const key of Object.keys(spec.metrics)){
  if(!Object.hasOwn(final.metrics,key))reject('candidate.json','preview.trace.snapshots['+(checked.snapshots.length-1)+'].metrics['+JSON.stringify(key)+']','metric-missing');
  metrics[key]=final.metrics[key]!;
 }
 check('candidate.json','preview.trace.snapshots['+(checked.snapshots.length-1)+'].metrics',()=>validateMetrics(spec,metrics));
 const result=json(files,'model/results.json');
 if(!exact(result,['seed','parameters','metrics','frameCount']))reject('model/results.json','$','summary-schema-invalid');
 if(result.seed!==input.seed)reject('model/results.json','seed','summary-input-mismatch');
 if(canonicalPreviewJson(result.parameters)!==canonicalPreviewJson(input.parameters))reject('model/results.json','parameters','summary-input-mismatch');
 if(result.frameCount!==checked.snapshots.length)reject('model/results.json','frameCount','summary-trace-mismatch');
 if(canonicalPreviewJson(result.metrics)!==canonicalPreviewJson(metrics))reject('model/results.json','metrics','summary-trace-mismatch');
 files['model/run.py']=encoder.encode(managedRunner);
 return {filesArchive:packageCandidateModel(files,spec),validation:{status:'checked',schemaVersion:2,traceValidation:'validated',execution:'not-recomputed',profileId}};
}
