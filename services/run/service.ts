import {actor,positive,sameScope,scope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {resolvedPreviewPlan,previewSourceScope,type ResolvedPreviewPlan} from '../preview/source.ts';

export type ServiceRunStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>;
export type ServiceRunSpec={plan:ResolvedPreviewPlan;runtimeImage:string;maxDurationMs:number};
export type ServiceRuntimeReference={runId:string;runtimeId:string;dispatchId:string;leaseId:string;generation:1;deadlineAt:number};
export type ServiceRunStatus='queued'|'starting'|'running'|'unknown'|'stopping'|'stopped'|'failed'|'cancelled';
export type ServiceRunRecord={id:string;kind:'service';scope:TurnScope;actor:TurnActor;spec:ServiceRunSpec;status:ServiceRunStatus;createdAt:number;updatedAt:number;startedAt:number|null;stopRequestedAt:number|null;runtime:ServiceRuntimeReference|null;errorCode:string|null};
type Row=Record<string,SqlStorageValue>;
const TERMINAL=new Set<ServiceRunStatus>(['stopped','failed','cancelled']);
function exact(raw:unknown,keys:string[]):asserts raw is Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-service-run-input');
 const descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key]!,'value')||!descriptors[key]!.enumerable))throw Error('invalid-service-run-input');
}
export function serviceRunSpec(raw:unknown):ServiceRunSpec{
 exact(raw,['plan','runtimeImage','maxDurationMs']);const p=raw.plan;
 const plan=resolvedPreviewPlan(p);
 if(typeof raw.runtimeImage!=='string'||raw.runtimeImage.length>300||! /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(raw.runtimeImage)||raw.runtimeImage.split('@')[0]!.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('invalid-service-runtime-image');
 const maxDurationMs=positive(raw.maxDurationMs);if(maxDurationMs>15*60_000)throw Error('invalid-service-duration');
 return {plan,runtimeImage:raw.runtimeImage,maxDurationMs};
}
export function serviceRuntimeReference(raw:unknown):ServiceRuntimeReference{
 exact(raw,['runId','runtimeId','dispatchId','leaseId','generation','deadlineAt']);
 if(raw.generation!==1)throw Error('invalid-service-runtime-generation');
 return {runId:turnId(raw.runId),runtimeId:turnId(raw.runtimeId),dispatchId:turnId(raw.dispatchId),leaseId:turnId(raw.leaseId),generation:1,deadlineAt:positive(raw.deadlineAt)};
}
/** Private lifecycle journal. Its inputs must come from an authenticated host,
 * a verified RevisionStore plan, and a trusted quota/runtime coordinator. It
 * neither grants a lease nor proves an OS process has stopped. */
export class SqlServiceRunJournal{
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #clock:()=>number;readonly #id:()=>string;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,clock=Date.now,id:()=>string=()=>crypto.randomUUID()){
  this.#storage=storage;this.#scope=scope(rawScope);this.#clock=clock;this.#id=id;
  storage.transactionSync(()=>{
   storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_run_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS service_runs(id TEXT PRIMARY KEY,intent_key TEXT NOT NULL UNIQUE,input_json TEXT NOT NULL,record_json TEXT NOT NULL,start_json TEXT,stop_json TEXT);`);
   const found=this.#rows('SELECT scope_json FROM service_run_meta WHERE singleton=1')[0];
   if(found&&found.scope_json!==JSON.stringify(this.#scope))throw Error('service-run-scope-denied');
   if(!found)storage.sql.exec('INSERT INTO service_run_meta VALUES(1,?)',JSON.stringify(this.#scope));
  });this.#ready=storage.sync();
 }
 #rows(query:string,...args:(string|number|null)[]):Row[]{return this.#storage.sql.exec<Row>(query,...args).toArray();}
 #now(){return positive(this.#clock());}
 #row(id:string){const row=this.#rows('SELECT * FROM service_runs WHERE id=?',turnId(id))[0];if(!row)throw Error('service-run-not-found');return row;}
 #record(row:Row):ServiceRunRecord{
  const r=JSON.parse(row.record_json as string) as ServiceRunRecord;
  if(r.id!==row.id||r.kind!=='service'||!sameScope(scope(r.scope),this.#scope)||!sameScope(previewSourceScope(serviceRunSpec(r.spec).plan.source),this.#scope))throw Error('invalid-persisted-service-run');
  return r;
 }
 #write(r:ServiceRunRecord){this.#storage.sql.exec('UPDATE service_runs SET record_json=? WHERE id=?',JSON.stringify(r),r.id);}
 async #change<T>(operation:()=>T):Promise<T>{await this.#ready;const result=this.#storage.transactionSync(operation);await this.#storage.sync();return structuredClone(result);}
 async get(id:string){await this.#ready;return this.#record(this.#row(id));}
 async create(rawActor:TurnActor,requestKey:string,rawSpec:ServiceRunSpec):Promise<ServiceRunRecord>{
  const who=actor(rawActor),key=turnId(requestKey),spec=serviceRunSpec(rawSpec);
  if(!sameScope(previewSourceScope(spec.plan.source),this.#scope))throw Error('service-run-scope-denied');
  const intent=JSON.stringify([who.userId,key]),input=JSON.stringify({actor:who,spec});
  return this.#change(()=>{
   const old=this.#rows('SELECT * FROM service_runs WHERE intent_key=?',intent)[0];
   if(old){if(old.input_json!==input)throw Error('service-run-intent-conflict');return this.#record(old);}
   const now=this.#now(),record:ServiceRunRecord={id:turnId(this.#id()),kind:'service',scope:this.#scope,actor:who,spec,status:'queued',createdAt:now,updatedAt:now,startedAt:null,stopRequestedAt:null,runtime:null,errorCode:null};
   this.#storage.sql.exec('INSERT INTO service_runs(id,intent_key,input_json,record_json) VALUES(?,?,?,?)',record.id,intent,input,JSON.stringify(record));return record;
  });
 }
 /** Persist before dispatch. A replay never grants another dispatch. After a
  * lost acknowledgement the coordinator must observe this exact runtime. */
 async begin(raw:ServiceRuntimeReference):Promise<{record:ServiceRunRecord;dispatch:boolean}>{
  const runtime=serviceRuntimeReference(raw),encoded=JSON.stringify(runtime);
  return this.#change(()=>{
   const row=this.#row(runtime.runId),r=this.#record(row);
   if(row.start_json!==null){if(row.start_json!==encoded)throw Error('service-run-start-conflict');return {record:r,dispatch:false};}
   const now=this.#now();if(r.status!=='queued'||runtime.deadlineAt<=now||runtime.deadlineAt-now>r.spec.maxDurationMs)throw Error('service-run-start-denied');
   r.status='starting';r.runtime=runtime;r.startedAt=now;r.updatedAt=now;this.#write(r);
   this.#storage.sql.exec('UPDATE service_runs SET start_json=? WHERE id=?',encoded,r.id);return {record:r,dispatch:true};
  });
 }
 #matched(raw:ServiceRuntimeReference){const row=this.#row(raw.runId),r=this.#record(row);if(row.start_json!==JSON.stringify(raw))throw Error('service-run-runtime-scope-denied');return {row,r};}
 async healthy(raw:ServiceRuntimeReference){const ref=serviceRuntimeReference(raw);return this.#change(()=>{
  const {r}=this.#matched(ref),now=this.#now();
  if(TERMINAL.has(r.status)||r.stopRequestedAt!==null||ref.deadlineAt<=now||!['starting','running','unknown'].includes(r.status))throw Error('service-run-health-denied');
  r.status='running';r.updatedAt=now;r.errorCode=null;this.#write(r);return r;
 });}
 async unknown(raw:ServiceRuntimeReference){const ref=serviceRuntimeReference(raw);return this.#change(()=>{const {r}=this.#matched(ref);if(!TERMINAL.has(r.status)){r.status=r.stopRequestedAt===null?'unknown':'stopping';r.updatedAt=this.#now();this.#write(r);}return r;});}
 async failQueued(id:string,errorCode:string){turnId(id);turnId(errorCode);return this.#change(()=>{const r=this.#record(this.#row(id));if(TERMINAL.has(r.status))return r;if(r.runtime!==null||r.status!=='queued')throw Error('service-run-already-started');r.status='failed';r.errorCode=errorCode;r.updatedAt=this.#now();this.#write(r);return r;});}
 async requestStop(id:string){turnId(id);return this.#change(()=>{
  const r=this.#record(this.#row(id));if(TERMINAL.has(r.status))return r;
  const now=this.#now();r.stopRequestedAt??=now;r.updatedAt=now;r.status=r.runtime===null?'cancelled':'stopping';this.#write(r);return r;
 });}
 async confirmStopped(raw:ServiceRuntimeReference,proof:{confirmationId:string;observedAt:number;outcome:'stopped'|'failed';errorCode:string|null}){
  const ref=serviceRuntimeReference(raw);exact(proof,['confirmationId','observedAt','outcome','errorCode']);turnId(proof.confirmationId);positive(proof.observedAt);
  if(!['stopped','failed'].includes(proof.outcome)||(proof.outcome==='failed'?proof.errorCode===null:proof.errorCode!==null))throw Error('invalid-service-stop-proof');
  if(proof.errorCode!==null)turnId(proof.errorCode);const confirmed={confirmationId:proof.confirmationId,observedAt:proof.observedAt,outcome:proof.outcome,errorCode:proof.errorCode},encoded=JSON.stringify(confirmed);
  return this.#change(()=>{
   const {row,r}=this.#matched(ref);if(row.stop_json!==null){if(row.stop_json!==encoded)throw Error('service-run-stop-conflict');return r;}
   const now=this.#now();if(r.startedAt===null||confirmed.observedAt<r.startedAt||confirmed.observedAt>now||TERMINAL.has(r.status))throw Error('invalid-service-stop-proof');
   r.status=confirmed.outcome;r.errorCode=confirmed.errorCode;r.updatedAt=now;this.#write(r);
   this.#storage.sql.exec('UPDATE service_runs SET stop_json=? WHERE id=?',encoded,r.id);return r;
  });
 }
}
