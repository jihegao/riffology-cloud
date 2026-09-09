import {actor,positive,sameScope,scope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {previewSource,type PreviewSource} from '../preview/source.ts';
import {initialWorkspaceReference,type InitialWorkspaceReference} from '../turn-runtime/initial-workspace.ts';
import {serviceRunTask,type ServiceRunTask} from '../run/host.ts';
import type {ServiceRunStorage} from '../run/service.ts';
export type ServiceSourceCandidate=Extract<PreviewSource,{kind:'saved-turn'}>|{kind:'initial-workspace';reference:InitialWorkspaceReference};
export type ServiceIntentCommit=<T>(operation:()=>T)=>Promise<T>;
export type ServiceIntentCursor={createdAt:number;runId:string};
export type ServiceIntentListOptions={before?:ServiceIntentCursor;limit?:number};
export type ServiceIntentUserRequest={maxDurationMs:number};
export type ServiceIntentRequest={runtimeImage:string;maxDurationMs:number};
export type ServiceIntentRecord={runId:string;scope:TurnScope;actor:TurnActor;requestKey:string;request:ServiceIntentRequest;source:ServiceSourceCandidate;task:ServiceRunTask|null;status:'resolving'|'ready'|'delivery-unknown'|'delivered'|'cancelled'|'failed';createdAt:number;updatedAt:number;deliveryDeadlineAt:number;nextAttemptAt:number|null;deliveryClaimedAt:number|null;stopRequestedAt:number|null;stopForwardedAt:number|null;errorCode:string|null};
function data(raw:unknown):void{if(raw===null||typeof raw!=='object')return;if(Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-service-intent');for(const key of Reflect.ownKeys(raw)){const d=Object.getOwnPropertyDescriptor(raw,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('invalid-service-intent');data(d.value);}}
function exact(raw:unknown,keys:string[]):asserts raw is Record<string,unknown>{data(raw);if(!raw||typeof raw!=='object'||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))throw Error('invalid-service-intent');}
function request(raw:unknown):ServiceIntentRequest{exact(raw,['runtimeImage','maxDurationMs']);const image=raw.runtimeImage;if(typeof image!=='string'||image.length>300||! /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(image)||image.split('@')[0]!.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('invalid-service-runtime-image');const duration=positive(raw.maxDurationMs);if(duration>900000)throw Error('invalid-service-duration');return {runtimeImage:image,maxDurationMs:duration};}
export function serviceSourceCandidate(raw:unknown):ServiceSourceCandidate{data(raw);if((raw as {kind?:unknown})?.kind==='saved-turn')return previewSource(raw) as Extract<PreviewSource,{kind:'saved-turn'}>;exact(raw,['kind','reference']);if(raw.kind!=='initial-workspace')throw Error('invalid-service-source-candidate');return {kind:'initial-workspace',reference:initialWorkspaceReference(raw.reference)};}
function encoded(raw:unknown):string{if(raw===null||typeof raw!=='object')return JSON.stringify(raw);return '{'+Object.keys(raw).sort().map(k=>JSON.stringify(k)+':'+encoded((raw as Record<string,unknown>)[k])).join(',')+'}';}
const done=new Set(['cancelled','failed']);
/** Workspace outbox only: delivery acceptance never asserts that a process is running. */
export class SqlServiceIntentJournal{
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #clock:()=>number;readonly #id:()=>string;readonly #ready:Promise<void>;readonly #commit:ServiceIntentCommit;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,clock=Date.now,id:()=>string=()=>crypto.randomUUID(),commit?:ServiceIntentCommit){
  data(rawScope);this.#storage=storage;this.#scope=scope(rawScope);this.#clock=clock;this.#id=id;this.#commit=commit??(async operation=>storage.transactionSync(operation));
  storage.transactionSync(()=>{storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_intent_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS service_intents(run_id TEXT PRIMARY KEY,intent_key TEXT NOT NULL UNIQUE,input_json TEXT NOT NULL,record_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS service_intents_created ON service_intents(json_extract(record_json,'$.createdAt') DESC,run_id DESC);`);const row=this.#rows('SELECT scope_json FROM service_intent_meta WHERE singleton=1')[0];if(row&&row.scope_json!==encoded(this.#scope))throw Error('service-intent-scope-denied');if(!row)storage.sql.exec('INSERT INTO service_intent_meta VALUES(1,?)',encoded(this.#scope));});this.#ready=storage.sync();
 }
 #rows(sql:string,...args:(string|number)[]){return this.#storage.sql.exec<Record<string,SqlStorageValue>>(sql,...args).toArray();}
 #decode(row:Record<string,SqlStorageValue>){const record=JSON.parse(row.record_json as string) as ServiceIntentRecord;try{if(turnId(record.runId)!==row.run_id||!sameScope(scope(record.scope),this.#scope))throw Error('scope');const source=serviceSourceCandidate(record.source),sourceScope=source.kind==='saved-turn'?source.identity.scope:source.reference.scope;if(!sameScope(sourceScope,this.#scope))throw Error('source-scope');positive(record.createdAt);request(record.request);actor(record.actor);}catch{throw Error('invalid-persisted-service-intent');}return record;}
 #read(id:string){const row=this.#rows('SELECT run_id,record_json FROM service_intents WHERE run_id=?',turnId(id))[0];if(!row)throw Error('service-intent-not-found');return this.#decode(row);}
 #write(r:ServiceIntentRecord){this.#storage.sql.exec('UPDATE service_intents SET record_json=? WHERE run_id=?',JSON.stringify(r),r.runId);}
 #now(){return positive(this.#clock());}
 async #change<T>(fn:()=>T){await this.#ready;const result=await this.#commit(fn);await this.#storage.sync();return structuredClone(result);}
 async create(rawActor:TurnActor,requestKey:string,rawRequest:ServiceIntentRequest,freeze:()=>ServiceSourceCandidate){
  const req=request(rawRequest);return this.#create(rawActor,requestKey,req.maxDurationMs,()=>req,freeze,true);
 }
 async createFromPolicy(rawActor:TurnActor,requestKey:string,userRequest:ServiceIntentUserRequest,runtimeImage:string,freeze:()=>ServiceSourceCandidate){
  exact(userRequest,['maxDurationMs']);const duration=positive(userRequest.maxDurationMs);if(duration>900000)throw Error('invalid-service-duration');
  return this.#create(rawActor,requestKey,duration,()=>request({runtimeImage,maxDurationMs:duration}),freeze,false);
 }
 async #create(rawActor:TurnActor,requestKey:string,duration:number,configured:()=>ServiceIntentRequest,freeze:()=>ServiceSourceCandidate,strictImage:boolean){
  data(rawActor);const who=actor(rawActor),key=turnId(requestKey),intent=JSON.stringify([who.userId,key]);
  return this.#change(()=>{const old=this.#rows('SELECT * FROM service_intents WHERE intent_key=?',intent)[0];if(old){const record=this.#decode(old);if(encoded(record.actor)!==encoded(who)||record.request.maxDurationMs!==duration||(strictImage&&encoded(record.request)!==encoded(configured())))throw Error('service-intent-conflict');return record;}
   const req=configured(),input=encoded({actor:who,request:req}),source=serviceSourceCandidate(freeze()),s=source.kind==='saved-turn'?source.identity.scope:source.reference.scope;if(!sameScope(s,this.#scope))throw Error('service-intent-source-scope-denied');const now=this.#now(),deliveryDeadlineAt=positive(now+req.maxDurationMs);
   const r:ServiceIntentRecord={runId:turnId(this.#id()),scope:this.#scope,actor:who,requestKey:key,request:req,source,task:null,status:'resolving',createdAt:now,updatedAt:now,deliveryDeadlineAt,nextAttemptAt:now,deliveryClaimedAt:null,stopRequestedAt:null,stopForwardedAt:null,errorCode:null};this.#storage.sql.exec('INSERT INTO service_intents VALUES(?,?,?,?)',r.runId,intent,input,JSON.stringify(r));return r;});
 }
 async list(options:ServiceIntentListOptions={}){
  data(options);if(!options||typeof options!=='object'||Object.keys(options).some(k=>!['before','limit'].includes(k)))throw Error('invalid-service-intent-list');
  const limit=Object.hasOwn(options,'limit')?positive(options.limit):20;if(limit>50)throw Error('invalid-service-intent-limit');
  let before:ServiceIntentCursor|undefined;if(Object.hasOwn(options,'before')){exact(options.before,['createdAt','runId']);before={createdAt:positive(options.before.createdAt),runId:turnId(options.before.runId)};}
  await this.#ready;const ordering=" ORDER BY json_extract(record_json,'$.createdAt') DESC,run_id DESC LIMIT ?";
  const rows=before?this.#rows("SELECT run_id,record_json FROM service_intents WHERE json_extract(record_json,'$.createdAt') < ? OR (json_extract(record_json,'$.createdAt') = ? AND run_id < ?)"+ordering,before.createdAt,before.createdAt,before.runId,limit+1):this.#rows('SELECT run_id,record_json FROM service_intents'+ordering,limit+1);
  const decoded=rows.map(row=>this.#decode(row)),items=decoded.slice(0,limit),last=items.at(-1);return {items,nextCursor:decoded.length>limit&&last?{createdAt:last.createdAt,runId:last.runId}:null};
 }
 async get(id:string){turnId(id);await this.#ready;return structuredClone(this.#read(id));}
 async resolve(id:string,rawTask:ServiceRunTask){data(rawTask);const task=serviceRunTask(rawTask);return this.#change(()=>{const r=this.#read(id),source=serviceSourceCandidate(task.spec.plan.source.kind==='initial-workspace'?{kind:'initial-workspace',reference:task.spec.plan.source.reference}:task.spec.plan.source);
  if(task.runId!==r.runId||task.requestKey!==r.requestKey||!sameScope(task.scope,r.scope)||encoded(task.actor)!==encoded(r.actor)||encoded(source)!==encoded(r.source)||encoded(request({runtimeImage:task.spec.runtimeImage,maxDurationMs:task.spec.maxDurationMs}))!==encoded(r.request))throw Error('service-intent-task-conflict');
  if(r.task&&encoded(r.task)!==encoded(task))throw Error('service-intent-task-conflict');if(done.has(r.status)||r.task)return r;
  const now=this.#now();if(now>=r.deliveryDeadlineAt){r.status='failed';r.errorCode='service-deadline';r.nextAttemptAt=null;}else{r.task=task;r.status='ready';r.nextAttemptAt=now;}r.updatedAt=now;this.#write(r);return r;});}
 async claimDelivery(id:string){return this.#change(()=>{const r=this.#read(id);if(done.has(r.status)||r.status==='delivered')return r;if(!r.task)throw Error('service-intent-unresolved');const now=this.#now();if(r.deliveryClaimedAt===null&&now>=r.deliveryDeadlineAt){r.status='failed';r.errorCode='service-deadline';r.nextAttemptAt=null;}else{r.deliveryClaimedAt??=now;r.status='delivery-unknown';r.nextAttemptAt=now+5000;}r.updatedAt=now;this.#write(r);return r;});}
 async delivered(id:string){return this.#change(()=>{const r=this.#read(id);if(r.deliveryClaimedAt===null||!r.task)throw Error('service-intent-delivery-unclaimed');r.status='delivered';r.nextAttemptAt=r.stopRequestedAt===null||r.stopForwardedAt!==null?null:this.#now();r.updatedAt=this.#now();r.errorCode=null;this.#write(r);return r;});}
 async retry(id:string,nextAttemptAt:number,errorCode:string|null=null){positive(nextAttemptAt);if(errorCode!==null)turnId(errorCode);return this.#change(()=>{const r=this.#read(id);if(done.has(r.status)||(r.status==='delivered'&&(r.stopRequestedAt===null||r.stopForwardedAt!==null)))return r;r.nextAttemptAt=r.deliveryClaimedAt===null?Math.min(nextAttemptAt,r.deliveryDeadlineAt):nextAttemptAt;r.errorCode=errorCode;r.updatedAt=this.#now();this.#write(r);return r;});}
 async requestStop(id:string){return this.#change(()=>{const r=this.#read(id);if(done.has(r.status))return r;const now=this.#now();r.stopRequestedAt??=now;r.updatedAt=now;if(r.deliveryClaimedAt===null){r.status='cancelled';r.nextAttemptAt=null;}else if(r.stopForwardedAt===null)r.nextAttemptAt=now;this.#write(r);return r;});}
 async stopForwarded(id:string){return this.#change(()=>{const r=this.#read(id);if(r.status!=='delivered'||r.stopRequestedAt===null)throw Error('service-intent-stop-unclaimed');r.stopForwardedAt??=this.#now();r.nextAttemptAt=null;r.updatedAt=this.#now();this.#write(r);return r;});}
 async fail(id:string,errorCode:string){turnId(errorCode);return this.#change(()=>{const r=this.#read(id);if(done.has(r.status))return r;if(r.deliveryClaimedAt!==null)throw Error('service-intent-delivery-uncertain');r.status='failed';r.errorCode=errorCode;r.updatedAt=this.#now();r.nextAttemptAt=null;this.#write(r);return r;});}
 async listDue(at=this.#clock(),limit=32){positive(at);positive(limit);if(limit>128)throw Error('invalid-service-intent-limit');await this.#ready;return this.#rows("SELECT run_id,record_json FROM service_intents WHERE json_extract(record_json,'$.nextAttemptAt')<=? ORDER BY json_extract(record_json,'$.nextAttemptAt'),run_id LIMIT ?",at,limit).map(row=>this.#decode(row));}
 nextWakeSync(){return (this.#rows("SELECT MIN(json_extract(record_json,'$.nextAttemptAt')) AS wake FROM service_intents")[0]?.wake as number|null)??null;}
 async nextWake(){await this.#ready;return this.nextWakeSync();}
}
