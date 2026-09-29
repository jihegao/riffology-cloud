import {simulationToken} from './native.ts';
import {checkedNativeObservation} from './native-observation.ts';
import {checkedCompilerResult} from './compiler-result.ts';
import {digest,modelVersion,simulationPlan,type SimulationPlan} from './source.ts';
import {validateMetrics,resolveParameters} from './model-spec.ts';
import {scope as checkedScope,actor as checkedActor,turnId,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import {previewSourceScope} from '../preview/source.ts';
import type {SimulationRecord} from './host.ts';

export type EvidenceVersion=ReturnType<typeof modelVersion>;
export type EvidenceHead=Pick<EvidenceVersion,'revisionId'|'filesSha256'>;
export type EvidenceRequest={schemaVersion:1;kind:'run'|'mean'|'delta'|'percent-change';metric:string;runId?:string;experimentId?:string;armId?:string;expectedValue?:number;expectedVersion?:EvidenceVersion;expectedArtifactSha256?:string};
/** Adapter for the immutable Experiment grouping; never accept this from a client. */
export type EvidenceGroup={experimentId:string;status:string;version:EvidenceVersion;pendingStatuses?:Record<string,'pending'|'cancelled'>;inputs:Record<string,{parameters:SimulationRecord['input']['parameters'];seed:number}>;arms:{armId:string;role:'baseline'|'intervention';runIds:string[]}[]};
export type EvidencePorts={run(id:string):Promise<SimulationRecord>;group(id:string):Promise<EvidenceGroup>;artifact(key:string):Promise<Uint8Array|null>;source(source:SimulationPlan['source']):Promise<Uint8Array>};
export type EvidenceReference={experimentId:string;runId:string;armId:string|null;version:EvidenceVersion;metric:string;value:number;artifactSha256:string;seed:number;};
export type EvidenceExcluded={runId:string;armId:string|null;reason:string};
export type EvidenceClaim={schemaVersion:1;claimId:string;createdAt:number;createdBy:TurnActor;kind:EvidenceRequest['kind'];metric:string;unit:string|null;value:number;version:EvidenceVersion;experimentId:string;experimentStatus:string;armId:string|null;baselineMean:number|null;interventionMean:number|null;count:number;baselineCount:number;plannedCount:number;references:EvidenceReference[];excluded:EvidenceExcluded[];assumptions:string[];limitations:string[];scientificValidity:'unassessed';};
export type EvidenceAssessment={assessmentId:string;scope:'run'|'model';runId:string|null;version:EvidenceVersion;reason:string;createdBy:TurnActor;createdAt:number};
export type EvidenceView=EvidenceClaim&{currentScientificValidity:'unassessed'|'rejected';evidenceValidity:'verified'|'rejected'|'unavailable'|'recorded';reasonCode:string|null;stale:boolean;olderRevision:boolean;assessments:EvidenceAssessment[]};
const CLAIM='research:evidence:',INDEX='research:evidence-index:',REJECT='research:rejection:',MAX_RUNS=64,MAX_CLAIMS=500;
const SHA=/^[a-f0-9]{64}$/,NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function fail(code='evidence-input-invalid'):never{throw Error(code);}
function object(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();const keys=Object.keys(value);if(required.some(k=>!Object.hasOwn(value,k))||keys.some(k=>![...required,...optional].includes(k)))fail();return value as Record<string,unknown>;}
function finite(value:unknown){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)fail();return value;}
function version(raw:unknown):EvidenceVersion{const v=object(raw,['revisionId','filesSha256','specSha256']);if(v.revisionId!==null)turnId(v.revisionId);if(typeof v.filesSha256!=='string'||!SHA.test(v.filesSha256)||typeof v.specSha256!=='string'||!SHA.test(v.specSha256))fail();return {revisionId:v.revisionId as string|null,filesSha256:v.filesSha256,specSha256:v.specSha256};}
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value);}
function equal(a:unknown,b:unknown){return canonical(a)===canonical(b);}
function sameModel(a:EvidenceVersion,b:EvidenceVersion){return a.filesSha256===b.filesSha256&&a.specSha256===b.specSha256;}
export function evidenceRequest(raw:unknown):EvidenceRequest{
 const r=object(raw,['schemaVersion','kind','metric'],['runId','experimentId','armId','expectedValue','expectedVersion','expectedArtifactSha256']);
 if(r.schemaVersion!==1||!['run','mean','delta','percent-change'].includes(String(r.kind))||typeof r.metric!=='string'||!NAME.test(r.metric))fail();
 if(r.kind==='run'){turnId(r.runId);if(r.experimentId!==undefined||r.armId!==undefined)fail();}else{turnId(r.experimentId);turnId(r.armId);if(r.runId!==undefined||r.expectedArtifactSha256!==undefined)fail();}
 if(r.expectedValue!==undefined)finite(r.expectedValue);if(r.expectedVersion!==undefined)version(r.expectedVersion);if(r.expectedArtifactSha256!==undefined&&(typeof r.expectedArtifactSha256!=='string'||!SHA.test(r.expectedArtifactSha256)))fail();
 return structuredClone(r) as EvidenceRequest;
}
function artifactKey(scope:TurnScope,runId:string,sha:string){return `simulation-results-v1/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/${runId}/${sha}.json`;}
type VerificationPorts=EvidencePorts&{checkedPlan(source:SimulationPlan['source']):Promise<SimulationPlan>};
async function checkedReference(scope:TurnScope,ports:VerificationPorts,run:SimulationRecord,metric:string,armId:string|null):Promise<EvidenceReference>{
 if(!equal(run.scope,scope)||!equal(previewSourceScope(run.input.plan.source),scope)||run.runId!==run.input.runId)fail('evidence-source-mismatch');
 if(run.status!=='completed'||!run.result||run.errorCode!==null)fail('evidence-run-ineligible');
 let verifiedPlan:SimulationPlan;try{verifiedPlan=await ports.checkedPlan(run.input.plan.source);}catch{fail('evidence-source-mismatch');}if(!equal(verifiedPlan,run.input.plan))fail('evidence-source-mismatch');
 try{if(!equal(resolveParameters(verifiedPlan.spec,run.input.parameters),run.input.parameters)||!Number.isSafeInteger(run.input.seed)||run.input.seed<0||run.input.seed>4294967295)fail('evidence-source-mismatch');}catch{fail('evidence-source-mismatch');}
 const v=version(modelVersion(run.input.plan)),hash=run.result.artifactSha256;if(!SHA.test(hash))fail('evidence-source-mismatch');
 let saved:Record<string,number>;try{saved=validateMetrics(run.input.plan.spec,run.result.metrics);}catch{fail('evidence-source-mismatch');}if(!Object.hasOwn(saved,metric))fail('evidence-metric-missing');
 const bytes=await ports.artifact(artifactKey(scope,run.runId,hash));if(!bytes)fail('evidence-artifact-unavailable');if(bytes.byteLength>65536||await digest(bytes)!==hash)fail('evidence-source-mismatch');
 const compiler=verifiedPlan.compiler;
 let raw:Record<string,unknown>;try{
  raw=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),['schemaVersion','runId','experimentId','version','parameters','seed','runtimeImage','pythonVersion','metrics'],['outputs','nativeObservation',...(compiler?['compiler']:[])]);
  if(compiler&&raw.nativeObservation===undefined)fail('evidence-source-mismatch');
  if(raw.nativeObservation!==undefined)checkedNativeObservation(raw.nativeObservation,run.runId,modelVersion(run.input.plan).filesSha256,await simulationToken(run.input),await digest('simulation-stop:'+await simulationToken(run.input)));
  if(compiler&&(!equal(checkedCompilerResult(raw.compiler,compiler),run.result.compiler)||raw.outputs!==undefined)||!compiler&&run.result.compiler!==undefined)fail('evidence-source-mismatch');
 }catch{fail('evidence-source-mismatch');}
 if(raw.schemaVersion!==(compiler?2:1)||raw.runId!==run.runId||raw.experimentId!==run.experimentId||!equal(raw.version,v)||!equal(raw.parameters,run.input.parameters)||raw.seed!==run.input.seed||raw.runtimeImage!==run.input.runtimeImage||typeof raw.pythonVersion!=='string'||!/^3\.[0-9]+\.[0-9]+$/.test(raw.pythonVersion)||compiler&&raw.pythonVersion!=='3.14.2'||!equal(raw.metrics,saved)||!equal(raw.outputs??[],run.result.outputs??[]))fail('evidence-source-mismatch');
 return {experimentId:run.experimentId,runId:run.runId,armId,version:v,metric,value:saved[metric]!,artifactSha256:hash,seed:run.input.seed};
}
function indexKey(claim:Pick<EvidenceClaim,'createdAt'|'claimId'>){return INDEX+String(claim.createdAt).padStart(16,'0')+':'+claim.claimId;}
function mean(refs:EvidenceReference[]){if(!refs.length)fail('evidence-no-valid-runs');const n=refs.length,result=refs.reduce((sum,r)=>sum+r.value/n,0);if(!Number.isFinite(result))fail('evidence-number-overflow');return result;}

/** Workspace-local immutable numeric claims; rejection is a separate monotonic annotation. */
export class EvidenceLedger{
 readonly scope:TurnScope;readonly storage:DurableObjectStorage;readonly ports:EvidencePorts;readonly clock:()=>number;
 constructor(storage:DurableObjectStorage,scope:TurnScope,ports:EvidencePorts,clock=Date.now){this.scope=checkedScope(scope);this.storage=storage;this.ports=ports;this.clock=clock;}
 #verificationPorts():VerificationPorts{const plans=new Map<string,Promise<SimulationPlan>>(),artifacts=new Map<string,Promise<Uint8Array|null>>();return {...this.ports,checkedPlan:source=>{const key=canonical(source);if(!plans.has(key))plans.set(key,this.ports.source(source).then(bytes=>simulationPlan(source,bytes)));return plans.get(key)!;},artifact:key=>{if(!artifacts.has(key))artifacts.set(key,this.ports.artifact(key));return artifacts.get(key)!;}};}
 async assessments(){return [...(await this.storage.list<EvidenceAssessment>({prefix:REJECT})).values()];}
 #rejections(assessments:EvidenceAssessment[],refs:Pick<EvidenceReference,'runId'|'version'>[]){return assessments.filter(a=>refs.some(r=>a.scope==='run'?a.runId===r.runId:sameModel(a.version,r.version)));}
 async create(raw:unknown,actor:TurnActor,authorize:()=>void|Promise<void>=()=>{}){
  const ports=this.#verificationPorts(),request=evidenceRequest(raw),createdBy=checkedActor(actor),references:EvidenceReference[]=[],excluded:EvidenceExcluded[]=[];const assessments=await this.assessments();let pendingStatuses:EvidenceGroup['pendingStatuses'],groupInputs:EvidenceGroup['inputs']|undefined;
  let experimentId:string,experimentStatus:string,armId:string|null=null,plan:SimulationPlan|undefined,expected:EvidenceVersion,baselineId:string|null=null,selected:{armId:string|null;runIds:string[]}[];
  if(request.kind==='run'){const run=await this.ports.run(request.runId!);if(run.runId!==request.runId)fail('evidence-source-mismatch');plan=run.input.plan;expected=version(modelVersion(plan));experimentId=run.experimentId;experimentStatus=run.status;selected=[{armId:null,runIds:[run.runId]}];}
  else{const group=await this.ports.group(request.experimentId!);if(group.experimentId!==request.experimentId)fail('evidence-source-mismatch');expected=version(group.version);pendingStatuses=group.pendingStatuses;groupInputs=group.inputs;experimentId=group.experimentId;experimentStatus=group.status;armId=request.armId!;const arm=group.arms.find(a=>a.armId===armId),baseline=group.arms.filter(a=>a.role==='baseline');if(!arm||baseline.length!==1||group.arms.filter(a=>a.armId===armId).length!==1)fail('evidence-group-mismatch');baselineId=baseline[0]!.armId;if(request.kind!=='mean'&&arm.role!=='intervention')fail('evidence-group-mismatch');selected=request.kind==='mean'?[arm]:[baseline[0]!,arm];}
  const ids=selected.flatMap(a=>a.runIds);if(!ids.length||ids.length>MAX_RUNS||new Set(ids).size!==ids.length)fail('evidence-group-mismatch');
  if(request.expectedVersion&&!equal(request.expectedVersion,expected))fail('evidence-expectation-mismatch');
  for(const arm of selected)for(const id of arm.runIds){turnId(id);let run:SimulationRecord;try{run=await this.ports.run(id);}catch(error){if(request.kind!=='run'&&error instanceof Error&&error.message==='simulation-not-found'){excluded.push({runId:id,armId:arm.armId,reason:pendingStatuses?.[id]??'pending'});continue;}throw error;}if(run.runId!==id||!equal(run.scope,this.scope)||!equal(modelVersion(run.input.plan),expected)||request.kind!=='run'&&(run.groupId!==experimentId||run.experimentId!==experimentId||!groupInputs?.[id]||!equal(groupInputs[id],{parameters:run.input.parameters,seed:run.input.seed})))fail('evidence-group-mismatch');plan??=run.input.plan;
   if(this.#rejections(assessments,[{runId:id,version:expected}]).length){excluded.push({runId:id,armId:arm.armId,reason:'model-or-run-rejected'});continue;}
   if(run.status!=='completed'||!run.result||run.errorCode!==null){excluded.push({runId:id,armId:arm.armId,reason:run.status});continue;}
   references.push(await checkedReference(this.scope,ports,run,request.metric,arm.armId));
  }
  if(!plan)fail('evidence-no-valid-runs');let baselineMean:number|null=null,interventionMean:number|null=null,value:number;const chosen=references.filter(r=>request.kind==='run'||r.armId===armId),base=references.filter(r=>r.armId===baselineId);
  if(request.kind==='run'||request.kind==='mean')value=mean(chosen);else{baselineMean=mean(base);interventionMean=mean(chosen);if(request.kind==='percent-change'&&baselineMean===0)fail('evidence-zero-baseline');value=request.kind==='delta'?interventionMean-baselineMean:(interventionMean-baselineMean)/Math.abs(baselineMean)*100;if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)fail('evidence-number-overflow');}
  if(request.expectedValue!==undefined&&request.expectedValue!==value||request.expectedArtifactSha256!==undefined&&request.expectedArtifactSha256!==references[0]?.artifactSha256)fail('evidence-expectation-mismatch');
  const payload={schemaVersion:1 as const,kind:request.kind,metric:request.metric,unit:request.kind==='percent-change'?'%':plan.spec.metrics[request.metric]?.unit??null,value,version:expected,experimentId,experimentStatus,armId,baselineMean,interventionMean,count:chosen.length,baselineCount:request.kind==='run'||request.kind==='mean'?0:base.length,plannedCount:ids.length,references,excluded,assumptions:plan.spec.assumptions,limitations:plan.spec.limitations,scientificValidity:'unassessed' as const};
  if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>96*1024)fail('evidence-capacity');const claimId=await digest(canonical(payload));const claim=await this.storage.transaction(async tx=>{await authorize();const rejected=[...(await tx.list<EvidenceAssessment>({prefix:REJECT})).values()];if(this.#rejections(rejected,references).length)fail('evidence-source-rejected');const prior=await tx.get<EvidenceClaim>(CLAIM+claimId);if(prior)return prior;if((await tx.list({prefix:INDEX,limit:MAX_CLAIMS})).size>=MAX_CLAIMS)fail('evidence-capacity');const record={...payload,claimId,createdAt:this.clock(),createdBy};await tx.put(CLAIM+claimId,record);await tx.put(indexKey(record),{claimId,createdAt:record.createdAt});return record;});await this.storage.sync();await authorize();return claim;
 }
 async reject(raw:unknown,actor:TurnActor,authorize:()=>void|Promise<void>=()=>{}){
  const r=object(raw,['scope','runId','reason']);if(!['run','model'].includes(String(r.scope))||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1000||/[\u0000-\u001f]/.test(r.reason))fail();turnId(r.runId);const run=await this.ports.run(r.runId as string);if(!equal(run.scope,this.scope)||run.runId!==r.runId)fail('evidence-source-mismatch');const v=version(modelVersion(run.input.plan));const target={scope:r.scope as 'run'|'model',runId:r.scope==='run'?run.runId:null,version:v};const assessmentId=await digest(canonical({...target,reason:r.reason,createdBy:checkedActor(actor)}));
  const record=await this.storage.transaction(async tx=>{await authorize();const prior=await tx.get<EvidenceAssessment>(REJECT+assessmentId);if(prior)return prior;if((await tx.list({prefix:REJECT})).size>=MAX_CLAIMS)fail('evidence-capacity');const record={...target,assessmentId,reason:r.reason as string,createdBy:checkedActor(actor),createdAt:this.clock()};await tx.put(REJECT+assessmentId,record);return record;});await this.storage.sync();await authorize();return record;
 }
 async get(claimId:string,current:EvidenceHead|null,recheck=true):Promise<EvidenceView>{
  const ports=this.#verificationPorts();if(!SHA.test(claimId))fail();const claim=await this.storage.get<EvidenceClaim>(CLAIM+claimId);if(!claim)fail('evidence-not-found');let assessments=this.#rejections(await this.assessments(),claim.references);let evidenceValidity:EvidenceView['evidenceValidity']=assessments.length?'rejected':recheck?'verified':'recorded',reasonCode:string|null=assessments.length?'evidence-source-rejected':null;
  if(recheck&&!assessments.length)try{if(claim.kind!=='run'){const group=await this.ports.group(claim.experimentId);if(group.experimentId!==claim.experimentId||!equal(group.version,claim.version))fail('evidence-group-mismatch');for(const ref of claim.references){const arm=group.arms.find(a=>a.armId===ref.armId),run=await this.ports.run(ref.runId);if(!arm?.runIds.includes(ref.runId)||!equal(group.inputs[ref.runId],{parameters:run.input.parameters,seed:ref.seed}))fail('evidence-group-mismatch');}}for(const ref of claim.references){const run=await this.ports.run(ref.runId),checked=await checkedReference(this.scope,ports,run,claim.metric,ref.armId);if(!equal(checked,ref))fail('evidence-source-mismatch');}}catch(error){evidenceValidity='unavailable';const code=error instanceof Error?error.message:'';reasonCode=/^evidence-[a-z-]+$/.test(code)?code:'evidence-artifact-unavailable';}
  assessments=this.#rejections(await this.assessments(),claim.references);if(assessments.length){evidenceValidity='rejected';reasonCode='evidence-source-rejected';}
  return {...claim,currentScientificValidity:assessments.some(a=>a.scope==='model')?'rejected':'unassessed',evidenceValidity,reasonCode,stale:current===null||current.filesSha256!==claim.version.filesSha256,olderRevision:current===null||current.revisionId!==claim.version.revisionId,assessments};
 }
 async exportRecords(){const claims=[...(await this.storage.list<EvidenceClaim>({prefix:CLAIM})).values()],assessments=await this.assessments();return {schemaVersion:1 as const,claims:claims.map(c=>({...c,createdBy:{userId:c.createdBy.userId}})),assessments:assessments.map(a=>({...a,createdBy:{userId:a.createdBy.userId}}))};}

 async refreshViews(items:EvidenceView[]){const all=await this.assessments();return items.map(claim=>{const assessments=this.#rejections(all,claim.references);return assessments.length?{...claim,assessments,evidenceValidity:'rejected' as const,reasonCode:'evidence-source-rejected',currentScientificValidity:assessments.some(a=>a.scope==='model')?'rejected' as const:'unassessed' as const}:claim;});}
 async list(current:EvidenceHead|null,before?:string,limit=20){
  if(before!==undefined&&!SHA.test(before)||!Number.isSafeInteger(limit)||limit<1||limit>20)fail();let end:string|undefined;
  if(before){const previous=await this.storage.get<EvidenceClaim>(CLAIM+before);if(!previous)fail();end=indexKey(previous);}
  const index=[...(await this.storage.list<{claimId:string}>({prefix:INDEX,...(end?{end}:{}),reverse:true,limit:limit+1})).values()];const selected=index.slice(0,limit),records=await this.storage.get<EvidenceClaim>(selected.map(r=>CLAIM+r.claimId));const items:EvidenceView[]=selected.map(r=>{const c=records.get(CLAIM+r.claimId);if(!c)fail('evidence-source-mismatch');return {...c,evidenceValidity:'recorded',reasonCode:null,currentScientificValidity:'unassessed',stale:current===null||current.filesSha256!==c.version.filesSha256,olderRevision:current===null||current.revisionId!==c.version.revisionId,assessments:[]};});
  return {items:await this.refreshViews(items),nextCursor:index.length>limit?selected.at(-1)!.claimId:null};
 }
}
