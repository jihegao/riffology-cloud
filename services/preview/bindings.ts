import {actor,positive,sameScope,scope,turnId,type TurnActor,type TurnScope} from '../turn/protocol.ts';
import {previewSource,type PreviewSource} from './source.ts';
import {serviceSourceCandidate,type ServiceIntentRecord} from '../workspace/service-intents.ts';
import {serviceRunTask} from '../run/host.ts';
import {matchedServiceRun} from '../run/view.ts';
import {serviceRuntimeReference,type ServiceRunRecord,type ServiceRunStorage,type ServiceRuntimeReference} from '../run/service.ts';
export type PreviewRevocationReason='stopped'|'replaced'|'operator'|'workspace-retired';
export type PreviewBinding={previewId:string;scope:TurnScope;runId:string;source:PreviewSource;runtime:ServiceRuntimeReference;createdAt:number;expiresAt:number;revokedAt:number|null;reason:PreviewRevocationReason|null};
type Row=Record<string,SqlStorageValue>;
const reasons=new Set(['stopped','replaced','operator','workspace-retired']);
function data(value:unknown):void{if(value===null||typeof value!=='object')return;if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-preview-binding');for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('invalid-preview-binding');data(d.value);}}
function equal(a:unknown,b:unknown):boolean{return canonical(a)===canonical(b);}
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
/** Persistent routing target only. Every actual request still requires fresh
 * ACL and Run checks; these records do not assert continuing runtime health. */
export class SqlPreviewBindings{
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #clock:()=>number;readonly #id:()=>string;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,clock=Date.now,id:()=>string=()=>crypto.randomUUID()){
  data(rawScope);this.#scope=scope(rawScope);this.#storage=storage;this.#clock=clock;this.#id=id;
  storage.transactionSync(()=>{storage.sql.exec(`CREATE TABLE IF NOT EXISTS preview_binding_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL,current_id TEXT); CREATE TABLE IF NOT EXISTS preview_bindings(preview_id TEXT PRIMARY KEY,record_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS preview_binding_intents(intent_key TEXT PRIMARY KEY,input_json TEXT NOT NULL,preview_id TEXT NOT NULL);`);const old=this.#rows('SELECT scope_json FROM preview_binding_meta WHERE singleton=1')[0];if(old&&old.scope_json!==canonical(this.#scope))throw Error('preview-binding-scope-denied');if(!old)storage.sql.exec('INSERT INTO preview_binding_meta VALUES(1,?,NULL)',canonical(this.#scope));});this.#ready=storage.sync();
 }
 #rows(sql:string,...values:(string|number|null)[]){return this.#storage.sql.exec<Row>(sql,...values).toArray();}
 #now(){return positive(this.#clock());}
 #read(id:string){const row=this.#rows('SELECT * FROM preview_bindings WHERE preview_id=?',turnId(id))[0];if(!row)return null;const r=JSON.parse(row.record_json as string) as PreviewBinding;data(r);const source=previewSource(r.source),s=source.kind!=='initial-workspace'?source.identity.scope:source.reference.scope,runtime=serviceRuntimeReference(r.runtime);if(r.previewId!==row.preview_id||!sameScope(scope(r.scope),this.#scope)||!sameScope(s,this.#scope)||r.runId!==runtime.runId||r.expiresAt!==runtime.deadlineAt||positive(r.createdAt)>=r.expiresAt||(r.revokedAt===null?r.reason!==null:!reasons.has(r.reason!)))throw Error('invalid-persisted-preview-binding');if(r.revokedAt!==null)positive(r.revokedAt);return r;}
 #current(){const id=this.#rows('SELECT current_id FROM preview_binding_meta WHERE singleton=1')[0]?.current_id;return typeof id==='string'?this.#read(id):null;}
 #write(r:PreviewBinding){this.#storage.sql.exec('UPDATE preview_bindings SET record_json=? WHERE preview_id=?',JSON.stringify(r),r.previewId);}
 async #change<T>(fn:()=>T){await this.#ready;const result=this.#storage.transactionSync(fn);await this.#storage.sync();return structuredClone(result);}
 async bind(rawActor:TurnActor,key:string,view:{intent:ServiceIntentRecord;run:ServiceRunRecord},expectedPreviewId:string|null):Promise<PreviewBinding>{
  data(rawActor);data(view);if(!view||Object.keys(view).length!==2||!Object.hasOwn(view,'intent')||!Object.hasOwn(view,'run'))throw Error('invalid-preview-binding');const who=actor(rawActor),requestKey=turnId(key);if(expectedPreviewId!==null)turnId(expectedPreviewId);
  const intent=structuredClone(view.intent);const intentKeys=['runId','scope','actor','requestKey','request','source','task','status','createdAt','updatedAt','deliveryDeadlineAt','nextAttemptAt','deliveryClaimedAt','stopRequestedAt','stopForwardedAt','errorCode'];if(!intent||Object.keys(intent).length!==intentKeys.length||intentKeys.some(key=>!Object.hasOwn(intent,key)))throw Error('invalid-preview-binding');if(!intent.task)throw Error('preview-binding-candidate-denied');const task=serviceRunTask(intent.task),run=matchedServiceRun(view.run,task);if(!run?.runtime)throw Error('preview-binding-candidate-denied');
  if(task.spec.plan.source.kind==='manual-save')throw Error('manual-preview-execution-unsupported');
  const candidate=serviceSourceCandidate(task.spec.plan.source.kind==='saved-turn'?task.spec.plan.source:{kind:'initial-workspace',reference:task.spec.plan.source.reference});
  if(!sameScope(scope(intent.scope),this.#scope)||!sameScope(task.scope,this.#scope)||intent.runId!==task.runId||intent.requestKey!==task.requestKey||!equal(actor(intent.actor),task.actor)||!equal(intent.source,candidate)||!equal(intent.request,{runtimeImage:task.spec.runtimeImage,maxDurationMs:task.spec.maxDurationMs}))throw Error('preview-binding-candidate-denied');
  const source=previewSource(task.spec.plan.source),runtime=serviceRuntimeReference(run.runtime),intentKey=JSON.stringify([who.userId,requestKey]),input=canonical({actor:who,runId:run.id,source,runtime});
  return this.#change(()=>{const replay=this.#rows('SELECT * FROM preview_binding_intents WHERE intent_key=?',intentKey)[0];if(replay){if(replay.input_json!==input)throw Error('preview-binding-intent-conflict');const old=this.#read(replay.preview_id as string);if(!old)throw Error('invalid-persisted-preview-binding');return old;}
   const now=this.#now();if(intent.status!=='delivered'||intent.stopRequestedAt!==null||run.status!=='running'||run.stopRequestedAt!==null||runtime.deadlineAt<=now)throw Error('preview-binding-candidate-denied');
   const current=this.#current();if(current&&current.revokedAt===null&&equal(current.runtime,runtime)&&equal(current.source,source)){this.#storage.sql.exec('INSERT INTO preview_binding_intents VALUES(?,?,?)',intentKey,input,current.previewId);return current;}
   if((current?.previewId??null)!==expectedPreviewId)throw Error('preview-binding-cas-conflict');
   if(current&&current.revokedAt===null){current.revokedAt=now;current.reason='replaced';this.#write(current);}
   const record:PreviewBinding={previewId:turnId(this.#id()),scope:this.#scope,runId:run.id,source,runtime,createdAt:now,expiresAt:runtime.deadlineAt,revokedAt:null,reason:null};
   this.#storage.sql.exec('INSERT INTO preview_bindings VALUES(?,?)',record.previewId,JSON.stringify(record));this.#storage.sql.exec('UPDATE preview_binding_meta SET current_id=? WHERE singleton=1',record.previewId);this.#storage.sql.exec('INSERT INTO preview_binding_intents VALUES(?,?,?)',intentKey,input,record.previewId);return record;
  });
 }
 async revoke(previewId:string,reason:PreviewRevocationReason){turnId(previewId);if(!reasons.has(reason))throw Error('invalid-preview-revocation');return this.#change(()=>{const r=this.#read(previewId);if(!r)throw Error('preview-binding-not-found');if(r.revokedAt===null){r.revokedAt=this.#now();r.reason=reason;this.#write(r);}return r;});}
 async snapshot(previewId:string){turnId(previewId);await this.#ready;return structuredClone(this.#read(previewId));}
 async current(){await this.#ready;return structuredClone(this.#current());}
  async authorizeTarget(previewId:string){turnId(previewId);await this.#ready;const r=this.#current();if(!r||r.previewId!==previewId||r.revokedAt!==null||r.expiresAt<=this.#now())throw Error('preview-target-denied');return structuredClone(r);}
  /** Final local check after remote authority reads. No await may separate
   * this comparison from the caller's decision to use the current binding. */
  matchesCurrent(binding:PreviewBinding):boolean{const current=this.#current();return !!current&&current.revokedAt===null&&current.expiresAt>this.#now()&&equal(current,binding);}
}
