import type {InvitedRunAdmission} from './invited-policy.ts';
import {assessmentForRun,evidenceAssessments} from './evidence-adapter.ts';
import {actor as checkedActor,scope as checkedScope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {experimentRequest,projectSimulationWake,type SimulationHost,type SimulationRecord} from './host.ts';
import {resolveParameters,validateMetrics,type ParameterValues,type MetricDefinition} from './model-spec.ts';
import {digest,modelVersion,type SimulationPlan} from './source.ts';
import {GROUP_PREFIX,GROUP_INTENT,GROUP_RESERVATION,GROUP_WAKE_KEY} from './group-state.ts';

export type GroupConfigurationInput={label:string;parameters:ParameterValues};
export type ExperimentGroupRequest={revisionId:string|null;filesSha256:string;specSha256:string;hypothesis:string;baseline:GroupConfigurationInput;interventions:GroupConfigurationInput[];seeds:number[]};
export type GroupConfiguration=GroupConfigurationInput&{configurationId:string;role:'baseline'|'intervention'};
export type GroupStatus='queued'|'running'|'completed'|'partial'|'failed'|'cancelled';
type Child={runId:string;configurationId:string;seed:number;cancelled:boolean};
export type ExperimentGroupRecord={runAdmission?:InvitedRunAdmission;schemaVersion:1;groupId:string;scope:TurnScope;actor:TurnActor;key:string;requestJson:string;plan:SimulationPlan;runtimeImage:string;hypothesis:string;configurations:GroupConfiguration[];seeds:number[];children:Child[];status:GroupStatus;createdAt:number;updatedAt:number;cancelledAt:number|null;errorCode:string|null};
export type GroupRun={evidenceRejection?:{assessmentId:string;scope:'run'|'model';reason:string};runId:string;configurationId:string;seed:number;status:SimulationRecord['status']|'pending';errorCode:string|null;result:SimulationRecord['result'];released:boolean};
export type GroupMetric={count:number;missing:number;mean:number|null;baselineMean:number|null;delta:number|null;errorCode:null|'simulation-metric-overflow'};
export type ExperimentGroupView={groupId:string;version:ReturnType<typeof modelVersion>;hypothesis:string;configurations:GroupConfiguration[];seeds:number[];repetitions:number;metrics:Record<string,MetricDefinition>;status:GroupStatus;createdAt:number;updatedAt:number;cancelledAt:number|null;errorCode:string|null;stale:boolean;progress:{rejected:number;total:number;pending:number;active:number;completed:number;failed:number;cancelled:number};runs:GroupRun[];summary:Array<{configurationId:string;metrics:Record<string,GroupMetric>}>};
export function g5TerminalGroupAuthority(runs:Pick<SimulationRecord,'runId'|'status'|'released'|'releaseProof'>[],groups:Pick<ExperimentGroupRecord,'groupId'|'status'|'children'>[]){
 const runIds=new Set<string>();for(const run of runs){if(runIds.has(run.runId)||run.status!=='completed'||run.released!==true||run.releaseProof===null)throw Error('g5-window-simulation-authority-conflict');runIds.add(run.runId);}
 const groupIds=new Set<string>();for(const group of groups){if(groupIds.has(group.groupId)||group.status!=='completed'||group.children.length<1||group.children.some(child=>!runIds.has(child.runId)))throw Error('g5-window-group-authority-incomplete');groupIds.add(group.groupId);}
 return {runIds:[...runIds].sort(),groupIds:[...groupIds].sort()};
}
const FINAL=new Set(['completed','failed','cancelled']);
function invalid():never{throw Error('simulation-input-invalid');}
function object(raw:unknown,keys:string[]):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||Object.keys(raw).sort().join(',')!==keys.sort().join(','))invalid();
 return raw as Record<string,unknown>;
}
function text(raw:unknown,max:number){if(typeof raw!=='string'||!raw.trim()||raw.length>max||/[\u0000-\u001f\u007f]/u.test(raw))invalid();return raw;}
export function experimentGroupRequest(raw:unknown):ExperimentGroupRequest{
 const r=object(raw,['revisionId','filesSha256','specSha256','hypothesis','baseline','interventions','seeds']);
 if(new TextEncoder().encode(JSON.stringify(r)).byteLength>32768||!Array.isArray(r.seeds)||r.seeds.length<1||r.seeds.length>20||new Set(r.seeds).size!==r.seeds.length||!Array.isArray(r.interventions)||r.interventions.length<1||r.interventions.length>3)invalid();
 const configurations=[r.baseline,...r.interventions].map(value=>{
  const c=object(value,['label','parameters']);const label=text(c.label,80);
  for(const seed of r.seeds as unknown[])experimentRequest({revisionId:r.revisionId,filesSha256:r.filesSha256,specSha256:r.specSha256,parameters:c.parameters,seed});
  return {label,parameters:structuredClone(c.parameters as ParameterValues)};
 });
 if(new Set(configurations.map(c=>c.label)).size!==configurations.length)invalid();
 return {revisionId:r.revisionId as string|null,filesSha256:r.filesSha256 as string,specSha256:r.specSha256 as string,hypothesis:text(r.hypothesis,2000),baseline:configurations[0]!,interventions:configurations.slice(1),seeds:[...r.seeds] as number[]};
}
/** All child IDs and the frozen plan are persisted before any child is admitted.
 * Admission and cancellation both transact against this same Workspace storage. */
export class ExperimentGroupHost{
 #advancing=false;
 readonly storage:DurableObjectStorage;readonly scope:TurnScope;readonly runs:SimulationHost;readonly canRun:()=>boolean;readonly clock:()=>number;readonly maxChildren:number;readonly authorizeGroup?:(group:ExperimentGroupRecord)=>Promise<boolean>;
 constructor(storage:DurableObjectStorage,scope:TurnScope,runs:SimulationHost,canRun:()=>boolean,clock=Date.now,maxChildren=80,authorizeGroup?:(group:ExperimentGroupRecord)=>Promise<boolean>){this.storage=storage;this.scope=checkedScope(scope);this.runs=runs;this.canRun=canRun;this.clock=clock;this.maxChildren=maxChildren;this.authorizeGroup=authorizeGroup;}
 async #project(tx:DurableObjectTransaction){
  const active=[...(await tx.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].some(g=>!FINAL.has(g.status)&&g.status!=='partial');
  if(active)await tx.put(GROUP_WAKE_KEY,this.clock()+2000);else await tx.delete(GROUP_WAKE_KEY);
  await projectSimulationWake(tx,this.clock());
 }
 async #change(id:string,fn:(g:ExperimentGroupRecord)=>void){
  const g=await this.storage.transaction(async tx=>{const g=await tx.get<ExperimentGroupRecord>(GROUP_PREFIX+id);if(!g)throw Error('simulation-not-found');fn(g);g.updatedAt=this.clock();await tx.put(GROUP_PREFIX+id,g);await this.#project(tx);return g;});
  await this.storage.sync();return g;
 }
 async get(id:string){turnId(id);const g=await this.storage.get<ExperimentGroupRecord>(GROUP_PREFIX+id);if(!g)throw Error('simulation-not-found');return g;}
 async replay(actor:TurnActor,key:string,request:ExperimentGroupRequest){
  checkedActor(actor);turnId(key);const id=await this.storage.get<string>(GROUP_INTENT+await digest(JSON.stringify([actor.userId,key])));if(!id)return null;
  const g=await this.get(id);if(g.requestJson!==JSON.stringify(request)||g.actor.authVersion!==actor.authVersion)throw Error('simulation-idempotency-conflict');return g;
 }
 async submit(actor:TurnActor,key:string,raw:unknown,plan:SimulationPlan,runtimeImage:string,stillCurrent:()=>boolean,runAdmission?:InvitedRunAdmission){
  // v0.1 Business edits produce distinct immutable bundles. The existing group
  // contract compares parameter overrides within one frozen Plan.
  if(plan.compiler)throw Error('compiler-group-unsupported');
  const request=experimentGroupRequest(raw);if(request.seeds.length*(request.interventions.length+1)>this.maxChildren)throw Error('invited-runs-group-limit');const prior=await this.replay(actor,key,request);if(prior)return prior;
  if(!this.canRun()||!runtimeImage||runtimeImage.length>512)throw Error('simulation-unavailable');
  if(JSON.stringify(modelVersion(plan))!==JSON.stringify({revisionId:request.revisionId,filesSha256:request.filesSha256,specSha256:request.specSha256}))throw Error('simulation-model-stale');
  const configurations:GroupConfiguration[]=[request.baseline,...request.interventions].map((c,i)=>({...c,parameters:resolveParameters(plan.spec,c.parameters),configurationId:i===0?'baseline':`intervention-${i}`,role:i===0?'baseline':'intervention'}));
  // Seed-major order interleaves the baseline and interventions deterministically.
  const children=request.seeds.flatMap(seed=>configurations.map(c=>({runId:crypto.randomUUID(),configurationId:c.configurationId,seed,cancelled:false})));
  const groupId=crypto.randomUUID(),now=this.clock(),intent=GROUP_INTENT+await digest(JSON.stringify([actor.userId,key]));
  const record:ExperimentGroupRecord={...(runAdmission?{runAdmission}:{}),schemaVersion:1,groupId,scope:this.scope,actor:checkedActor(actor),key,requestJson:JSON.stringify(request),plan:structuredClone(plan),runtimeImage,hypothesis:request.hypothesis,configurations,seeds:request.seeds,children,status:'queued',createdAt:now,updatedAt:now,cancelledAt:null,errorCode:null};
  if(new TextEncoder().encode(JSON.stringify(record)).byteLength>120000)invalid();
  const g=await this.storage.transaction(async tx=>{
   const priorId=await tx.get<string>(intent);if(priorId){const prior=(await tx.get<ExperimentGroupRecord>(GROUP_PREFIX+priorId))!;if(prior.requestJson!==record.requestJson||prior.actor.authVersion!==actor.authVersion)throw Error('simulation-idempotency-conflict');return prior;}
   if(!this.canRun())throw Error('simulation-unavailable');
   if(!stillCurrent())throw Error('simulation-model-stale');
   const groups=[...(await tx.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()];
   const reserved=[...(await tx.list<string[]>({prefix:GROUP_RESERVATION})).values()].reduce((n,ids)=>n+ids.length,0);
   const runCount=(await tx.list({prefix:'simulation:run:'})).size;
   if(groups.length>=100||groups.filter(g=>!FINAL.has(g.status)&&g.status!=='partial').length>=8||runCount+reserved+children.length>1000)throw Error('simulation-capacity');
   await tx.put(GROUP_PREFIX+groupId,record);await tx.put(intent,groupId);await tx.put(GROUP_RESERVATION+groupId,children.map(c=>c.runId));await this.#project(tx);return record;
  });await this.storage.sync();return g;
 }
 async #children(g:ExperimentGroupRecord):Promise<GroupRun[]>{
  const records=await this.storage.get<SimulationRecord>(g.children.map(c=>'simulation:run:'+c.runId));
  return g.children.map(c=>{const r=records.get('simulation:run:'+c.runId);
   if(r){const configuration=g.configurations.find(v=>v.configurationId===c.configurationId);if(!configuration||r.runId!==c.runId||r.experimentId!==g.groupId||r.groupId!==g.groupId||r.input.runId!==c.runId||r.input.seed!==c.seed||r.input.runtimeImage!==g.runtimeImage||JSON.stringify(r.scope)!==JSON.stringify(g.scope)||JSON.stringify(r.actor)!==JSON.stringify(g.actor)||JSON.stringify(r.input.plan)!==JSON.stringify(g.plan)||JSON.stringify(r.input.parameters)!==JSON.stringify(configuration.parameters))throw Error('simulation-group-child-conflict');}
   return {runId:c.runId,configurationId:c.configurationId,seed:c.seed,status:r?.status??(c.cancelled?'cancelled':'pending'),errorCode:r?.errorCode??null,result:r?.result??null,released:r?.released??c.cancelled};});
 }
 async view(g:ExperimentGroupRecord,currentFilesSha:string|null):Promise<ExperimentGroupView>{
  const runs=await this.#children(g),assessments=await evidenceAssessments(this.storage),progress={rejected:0,total:runs.length,pending:0,active:0,completed:0,failed:0,cancelled:0};
  for(const r of runs){const assessment=assessmentForRun(assessments,r.runId,modelVersion(g.plan));if(assessment){r.evidenceRejection={assessmentId:assessment.assessmentId,scope:assessment.scope,reason:assessment.reason};progress.rejected++;}if(r.status==='pending')progress.pending++;else if(r.status==='completed'||r.status==='failed'||r.status==='cancelled')progress[r.status]++;else progress.active++;}
  const summaries=g.configurations.map(c=>{
   const members=runs.filter(r=>r.configurationId===c.configurationId),metrics:Record<string,GroupMetric>={};
   for(const name of Object.keys(g.plan.spec.metrics)){
    const values:number[]=[];
    for(const r of members){if(r.status!=='completed'||!r.result||r.evidenceRejection)continue;try{const checked=validateMetrics(g.plan.spec,r.result.metrics);values.push(checked[name]!);}catch{}}
    // Divide before summing to avoid overflow while keeping declared seed order.
    const mean=values.length?values.reduce((sum,value)=>sum+value/values.length,0):null;
    metrics[name]={count:values.length,missing:members.length-values.length,mean:mean!==null&&Number.isFinite(mean)?mean:null,baselineMean:null,delta:null,errorCode:mean!==null&&!Number.isFinite(mean)?'simulation-metric-overflow':null};
   }
   return {configurationId:c.configurationId,metrics};
  });
  for(const s of summaries)for(const [name,m]of Object.entries(s.metrics)){m.baselineMean=summaries[0]!.metrics[name]!.mean;m.delta=m.mean!==null&&m.baselineMean!==null?m.mean-m.baselineMean:null;if(m.delta!==null&&!Number.isFinite(m.delta)){m.delta=null;m.errorCode='simulation-metric-overflow';}}
  return {groupId:g.groupId,version:modelVersion(g.plan),hypothesis:g.hypothesis,configurations:g.configurations,seeds:g.seeds,repetitions:g.seeds.length,metrics:g.plan.spec.metrics,status:g.status,createdAt:g.createdAt,updatedAt:g.updatedAt,cancelledAt:g.cancelledAt,errorCode:g.errorCode,stale:currentFilesSha!==null&&currentFilesSha!==modelVersion(g.plan).filesSha256,progress,runs,summary:summaries};
 }
 async list(currentFilesSha:string|null,before?:string){
  if(before!==undefined)turnId(before);
  const all=[...(await this.storage.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].sort((a,b)=>b.createdAt-a.createdAt||b.groupId.localeCompare(a.groupId));
  const offset=before===undefined?0:all.findIndex(g=>g.groupId===before)+1;if(before!==undefined&&offset===0)invalid();
  const page=all.slice(offset,offset+10);return {items:await Promise.all(page.map(g=>this.view(g,currentFilesSha))),nextCursor:offset+10<all.length?page.at(-1)!.groupId:null};
 }
 async cancel(id:string,errorCode:string|null=null){
  turnId(id);
  const g=await this.storage.transaction(async tx=>{
   const g=await tx.get<ExperimentGroupRecord>(GROUP_PREFIX+id);if(!g)throw Error('simulation-not-found');
   if(FINAL.has(g.status)||g.status==='partial')return g;
   g.cancelledAt??=this.clock();g.errorCode??=errorCode;g.updatedAt=this.clock();
   for(const child of g.children){if(!await tx.get('simulation:run:'+child.runId))child.cancelled=true;}
   await tx.put(GROUP_RESERVATION+id,[]);await tx.put(GROUP_PREFIX+id,g);await this.#project(tx);return g;
  });await this.storage.sync();return g;
 }
 async alarm(){
  if(this.#advancing)return;this.#advancing=true;
  try{
   const groups=[...(await this.storage.list<ExperimentGroupRecord>({prefix:GROUP_PREFIX})).values()].filter(g=>!FINAL.has(g.status)&&g.status!=='partial').sort((a,b)=>a.createdAt-b.createdAt||a.groupId.localeCompare(b.groupId));
   for(const g of groups){try{await this.#advance(g.groupId);}catch(error){const code=error instanceof Error?error.message:'';await this.#change(g.groupId,v=>{v.errorCode=code==='simulation-capacity'?'simulation-capacity':'simulation-group-reconciling';});}}
  }finally{this.#advancing=false;await this.storage.transaction(tx=>this.#project(tx));await this.storage.sync();}
 }
 async #advance(id:string){
  let g=await this.get(id);let children=await this.#children(g);
  if(g.cancelledAt!==null){for(const child of children)if(child.status!=='pending'&&!FINAL.has(child.status))await this.runs.cancel(child.runId);}
  if(children.every(c=>c.released)){
   await this.#change(id,v=>{v.status=v.cancelledAt!==null?'cancelled':children.every(c=>c.status==='completed')?'completed':children.some(c=>c.status==='completed')?'partial':'failed';});return;
  }
  if(children.some(c=>c.status!=='pending'&&!c.released))return;
  if(g.cancelledAt!==null)return;
  if(!this.canRun()||this.authorizeGroup&&!await this.authorizeGroup(g)){if(g.runAdmission)await this.cancel(id,'invited-runs-paused');else await this.#change(id,v=>{v.errorCode='simulation-unavailable';});return;}
  if(!await this.runs.authorizeActor(g.actor)){await this.cancel(id,'simulation-access-revoked');return;}
  g=await this.get(id);children=await this.#children(g);
  const child=children.find(c=>c.status==='pending');if(!child||g.cancelledAt!==null)return;
  const configuration=g.configurations.find(c=>c.configurationId===child.configurationId)!;
  const body={...modelVersion(g.plan),parameters:configuration.parameters,seed:child.seed};
  await this.runs.submit(g.actor,`group-${child.runId}`,body,g.plan,g.runtimeImage,()=>true,{runId:child.runId,groupId:id,...(g.runAdmission?{runAdmission:g.runAdmission}:{}),permit:async tx=>{
   const current=await tx.get<ExperimentGroupRecord>(GROUP_PREFIX+id);
   if(!current||current.cancelledAt!==null||!this.canRun())return false;
   for(const sibling of current.children){if(sibling.runId===child.runId)break;const prior=await tx.get<SimulationRecord>('simulation:run:'+sibling.runId);if(!prior?.released)return false;}
   return true;
  }});
  await this.#change(id,v=>{v.status='running';v.errorCode=null;});
 }
}
