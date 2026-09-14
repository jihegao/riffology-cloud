import {ExportFiles,EXPORT_MAX_BYTES} from './zip.ts';
import {EXPORT_README,REPLAY_PY} from './replay.ts';
import {digest,modelVersion,simulationPlan,type SimulationPlan} from '../simulation/source.ts';
import {validateMetrics} from '../simulation/model-spec.ts';
import {publicExperiment,type SimulationRecord} from '../simulation/host.ts';
import type {ExperimentGroupRecord} from '../simulation/groups.ts';
import {previewSourceScope,previewSourceFilesSha256,type PreviewSource} from '../preview/source.ts';
import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
import {sameScope,scope as checkedScope,type TurnScope} from '../turn/protocol.ts';

export type ResearchSnapshot={schemaVersion:1;exportId:string;createdAt:number;scope:TurnScope;current:PreviewSource;runs:SimulationRecord[];groups:ExperimentGroupRecord[];claims:Record<string,unknown>[];assessments:Record<string,unknown>[]};
export type ExportPorts={source(source:PreviewSource,maxBytes:number):Promise<Uint8Array>;artifact(key:string,maxBytes:number):Promise<Uint8Array|null>;authorize():Promise<void>};
const encode=(value:string)=>new TextEncoder().encode(value),json=(value:unknown)=>encode(JSON.stringify(value,null,2));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fail(code='export-source-mismatch'):never{throw Error(code);}
const CLAIM_KEYS=['schemaVersion','claimId','createdAt','kind','metric','unit','value','version','experimentId','experimentStatus','armId','baselineMean','interventionMean','count','baselineCount','plannedCount','references','excluded','assumptions','limitations','scientificValidity'];
const ASSESSMENT_KEYS=['assessmentId','scope','runId','version','reason','createdAt'];
function evidence(record:Record<string,unknown>,keys:string[]){const value=Object.fromEntries(keys.filter(k=>Object.hasOwn(record,k)).map(k=>[k,record[k]]));const author=record.createdBy as {userId?:unknown}|undefined;return {...value,...(typeof author?.userId==='string'?{createdBy:{userId:author.userId}}:{})};}
/** One storage transaction fixes inventory membership and every mutable status before any R2 reads. */
export async function researchSnapshot(storage:DurableObjectStorage,scope:TurnScope,current:PreviewSource,authorize:()=>void):Promise<ResearchSnapshot>{
 checkedScope(scope);if(!sameScope(previewSourceScope(current),scope))fail();
 return storage.transaction(async tx=>{
  authorize();let total=0;
  async function collect<T>(prefix:string,max:number):Promise<T[]>{const result:T[]=[];let after:string|undefined;for(;;){const page=await tx.list<T>({prefix,limit:50,...(after?{startAfter:after}:{})});if(!page.size)break;for(const [key,value]of page){if(after&&key<=after)fail('export-inventory-invalid');after=key;total+=encode(JSON.stringify(value)).byteLength;if(result.length>=max||total>4*1024*1024)fail('export-too-large');result.push(value);}if(page.size<50)break;}return result;}
  const runs=await collect<SimulationRecord>('simulation:run:',1000),groups=await collect<ExperimentGroupRecord>('simulation:group:',100),claims=await collect<Record<string,unknown>>('research:evidence:',500),assessments=await collect<Record<string,unknown>>('research:rejection:',500);
  authorize();return {schemaVersion:1,exportId:crypto.randomUUID(),createdAt:Date.now(),scope,current:structuredClone(current),runs,groups,claims,assessments};
 });
}
/** Builds all selected content or fails explicitly. Never starts a runtime or writes research state. */
export async function buildResearchExport(snapshot:ResearchSnapshot,ports:ExportPorts){
 const scope=checkedScope(snapshot.scope),files=new ExportFiles(),sourceMap=new Map<string,{source:PreviewSource;plan?:SimulationPlan;revisions:Set<string|null>}>();
 const register=(source:PreviewSource,plan?:SimulationPlan)=>{if(!sameScope(previewSourceScope(source),scope))fail();const hash=previewSourceFilesSha256(source),revision=source.kind==='saved-turn'?source.revision.revisionId:null,prior=sourceMap.get(hash);if(prior){if(prior.plan&&plan&&!same({...prior.plan,source:null},{...plan,source:null}))fail();prior.plan??=plan;prior.revisions.add(revision);}else sourceMap.set(hash,{source,plan,revisions:new Set([revision])});return hash;};
 const currentKey=register(snapshot.current);
 for(const run of snapshot.runs){if(!sameScope(run.scope,scope)||run.runId!==run.input.runId)fail();register(run.input.plan.source,run.input.plan);}
 for(const group of snapshot.groups){if(!sameScope(group.scope,scope))fail();register(group.plan.source,group.plan);for(const child of group.children){const run=snapshot.runs.find(r=>r.runId===child.runId);if(run){const config=group.configurations.find(c=>c.configurationId===child.configurationId);if(!config||run.experimentId!==group.groupId||run.groupId!==group.groupId||!same(run.input.plan,group.plan)||run.input.seed!==child.seed||!same(run.input.parameters,config.parameters))fail();}}}
 if(snapshot.runs.some(run=>run.groupId&&!snapshot.groups.some(g=>g.groupId===run.groupId&&g.children.some(c=>c.runId===run.runId))))fail();
 await ports.authorize();const sources=[];
 for(const [key,entry]of sourceMap){
  const bytes=await ports.source(entry.source,Math.min(files.remaining,EXPORT_MAX_BYTES));if(bytes.byteLength>files.remaining||await digest(bytes)!==key)fail('export-source-mismatch');
  const index=workspaceFileIndex(bytes);for(const file of index.files){if(file.path.split('/').some(part=>/^\.env(?:\.|$)|^\.riffology$|^\.ssh$|^credentials(?:\.|$)|^cookies?(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(part)))fail('export-sensitive-file');}
  let checked:SimulationPlan;try{checked=await simulationPlan(entry.source,bytes);}catch(error){const code=error instanceof Error?error.message:'';fail(code.includes('dependencies')?'export-dependencies-invalid':'export-model-spec-invalid');}
  const inspection={spec:checked.spec,version:modelVersion(checked),reasonCode:null};
  if(entry.plan&&!same({...checked,source:null},{...entry.plan,source:null}))fail();
  const reader=workspaceArchiveReader(bytes),paths=reader.read([{path:'model/model-spec.json',maxBytes:32768},{path:inspection.spec.execution.dependencyLock,maxBytes:65536}]);
  const spec=paths.get('model/model-spec.json')!,lock=paths.get(inspection.spec.execution.dependencyLock)!;let lockData:{packages:Record<string,string>};try{lockData=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(lock));}catch{fail('export-dependencies-invalid');}
  if(!lockData.packages||typeof lockData.packages!=='object'||Array.isArray(lockData.packages))fail('export-dependencies-invalid');
  const archivePath=`sources/${key}/source.tar`,specPath=`sources/${key}/model-spec.json`,lockPath=`environment/${key}/requirements.lock`;
  files.add(archivePath,bytes);files.add(specPath,spec);files.add(lockPath,lock);files.add(`environment/${key}/requirements.txt`,encode(Object.entries(lockData.packages).map(([name,version])=>`${name}==${version}`).join('\n')+'\n'));
  sources.push({key,filesSha256:key,specSha256:inspection.version.specSha256,revisionIds:[...entry.revisions],archivePath,specPath,lockPath,dependencyLockSha256:await digest(lock),execution:inspection.spec.execution,reasonCode:inspection.reasonCode});
 }
 const runs=[];
 for(const run of snapshot.runs){
  const recordPath=`runs/${run.runId}/run.json`,sourceKey=previewSourceFilesSha256(run.input.plan.source),record={...publicExperiment(run,null),sourceKey,runtimeImage:run.input.runtimeImage,released:run.released};files.add(recordPath,json(record));let resultPath:string|null=null;
  if(run.status==='completed'&&!run.result)fail('export-result-missing');
  if(run.result){
   const prefix=`simulation-results-v1/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/${run.runId}`,bytes=await ports.artifact(`${prefix}/${run.result.artifactSha256}.json`,65536);if(!bytes)fail('export-result-missing');if(bytes.byteLength>65536||await digest(bytes)!==run.result.artifactSha256)fail();
   let raw:Record<string,unknown>;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail();}
   const allowed=['schemaVersion','runId','experimentId','version','parameters','seed','runtimeImage','pythonVersion','metrics','outputs'];if(!raw||Object.keys(raw).some(k=>!allowed.includes(k))||raw.schemaVersion!==1||raw.runId!==run.runId||raw.experimentId!==run.experimentId||!same(raw.version,modelVersion(run.input.plan))||!same(raw.parameters,run.input.parameters)||raw.seed!==run.input.seed||raw.runtimeImage!==run.input.runtimeImage||typeof raw.pythonVersion!=='string'||!/^3\.[0-9]+\.[0-9]+$/.test(raw.pythonVersion)||!same(raw.metrics,run.result.metrics)||!same(raw.outputs||[],run.result.outputs||[]))fail();
   validateMetrics(run.input.plan.spec,raw.metrics);resultPath=`results/${run.runId}/result.json`;files.add(resultPath,bytes);
   for(const output of run.result.outputs||[]){const value=await ports.artifact(`${prefix}/outputs/${output.sha256}`,16384);if(!value||value.byteLength!==output.size||await digest(value)!==output.sha256)fail();files.add(`results/${run.runId}/outputs/${output.path}`,value);}
  }
  runs.push({runId:run.runId,experimentId:run.experimentId,status:run.status,recordPath,resultPath,resultAvailability:resultPath?'included':'not-produced-at-snapshot'});
 }
 for(const claim of snapshot.claims){
  if(!Array.isArray(claim.references))fail('export-evidence-mismatch');
  for(const reference of claim.references){const ref=reference as Record<string,unknown>,run=snapshot.runs.find(r=>r.runId===ref.runId);
   if(!run?.result||ref.experimentId!==run.experimentId||!same(ref.version,modelVersion(run.input.plan))||ref.seed!==run.input.seed||ref.artifactSha256!==run.result.artifactSha256||typeof ref.metric!=='string'||ref.value!==run.result.metrics[ref.metric]||(ref.parameters!==undefined&&!same(ref.parameters,run.input.parameters)))fail('export-evidence-mismatch');
  }
 }
 for(const assessment of snapshot.assessments){const version=assessment.version as {filesSha256?:unknown;specSha256?:unknown}|undefined;
  if(!version||!sources.some(source=>source.filesSha256===version.filesSha256&&source.specSha256===version.specSha256)||(assessment.scope==='run'&&!snapshot.runs.some(run=>run.runId===assessment.runId)))fail('export-evidence-mismatch');
 }
 const groups=snapshot.groups.map(group=>{const path=`experiments/${group.groupId}.json`;files.add(path,json({schemaVersion:1,groupId:group.groupId,version:modelVersion(group.plan),sourceKey:previewSourceFilesSha256(group.plan.source),hypothesis:group.hypothesis,configurations:group.configurations,seeds:group.seeds,status:group.status,createdAt:group.createdAt,updatedAt:group.updatedAt,cancelledAt:group.cancelledAt,errorCode:group.errorCode,runs:group.children}));return {groupId:group.groupId,path};});
 files.add('evidence/claims.json',json(snapshot.claims.map(c=>evidence(c,CLAIM_KEYS))));files.add('evidence/assessments.json',json(snapshot.assessments.map(c=>evidence(c,ASSESSMENT_KEYS))));files.add('README.md',encode(EXPORT_README));files.add('replay.py',encode(REPLAY_PY));
 const inventory=[];for(const file of files.entries)inventory.push({path:file.path,bytes:file.bytes.byteLength,sha256:await digest(file.bytes)});
 const manifest={schemaVersion:1,exportId:snapshot.exportId,createdAt:snapshot.createdAt,projectId:scope.projectId,workspaceId:scope.workspaceId,currentSourceKey:currentKey,currentRevisionId:snapshot.current.kind==='saved-turn'?snapshot.current.revision.revisionId:null,sources,groups,runs,evidence:{claims:snapshot.claims.length,assessments:snapshot.assessments.length},replay:{relativeTolerance:1e-9,absoluteTolerance:1e-9,outputComparison:'sha256'},files:inventory};
 files.add('manifest.json',json(manifest));await ports.authorize();return {bytes:files.finish(),filename:`riffology-project-${scope.projectId}-${snapshot.exportId}.zip`,manifest};
}
