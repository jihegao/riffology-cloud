import {positive,sameScope,scope,sha,turnId,type TurnScope} from '../turn/protocol.ts';
import type {ServiceRunStorage} from '../run/service.ts';
import {normalizeObserverCommand,validateObserverCommand,type ObserverCommand,type ObserverJson} from './observer-protocol.ts';
export type ObserverCallCommit=<T>(operation:()=>T)=>Promise<T>;
export type ObserverOutcome={status:'completed'|'failed'|'cancelled'|'unknown';result:{[key:string]:ObserverJson}|null;errorCode:string|null};
export type ObserverCallRecord={command:ObserverCommand;targetDigest:string;status:'accepted'|'running'|ObserverOutcome['status'];acceptedAt:number;startedAt:number|null;finishedAt:number|null;result:ObserverOutcome['result'];errorCode:string|null};
function canonical(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
function normalizeIDs(value:unknown):{turnId:string;dispatchId:string;commandId:string}{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error();
  const keys=['turnId','dispatchId','commandId'];if(Reflect.ownKeys(value).length!==3||Object.keys(value).length!==3||keys.some(key=>!Object.hasOwn(value,key)))throw Error();
  const out={} as Record<string,string>;
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key)!;if(!d.enumerable||!('value'in d))throw Error();out[key]=turnId(d.value);}
  return out as {turnId:string;dispatchId:string;commandId:string};
 }catch{throw Error('observer-call-reference-denied');}
}
/** Walk descriptors before serialization so getters, sparse arrays and toJSON
 * cannot change the durable value. Node and byte bounds apply before storage. */
function json(v:unknown,depth=0,budget={nodes:65536}):void{
 if(depth>32||--budget.nodes<0)throw Error('observer-result-denied');
 if(v===null||typeof v==='boolean')return;
 if(typeof v==='string'){if(v.length>65536)throw Error('observer-result-denied');return;}
 if(typeof v==='number'&&Number.isFinite(v))return;
 if(typeof v!=='object'||!v)throw Error('observer-result-denied');
 const array=Array.isArray(v);if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))throw Error('observer-result-denied');
 const keys=Reflect.ownKeys(v);if(keys.length>65536||(array&&keys.length!==v.length+1))throw Error('observer-result-denied');
 for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key)!;
  if(typeof key!=='string'||!d.enumerable||!('value'in d)||(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length)))throw Error('observer-result-denied');json(d.value,depth+1,budget);
 }
}
function outcome(raw:ObserverOutcome):ObserverOutcome{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('observer-outcome-denied');
 for(const key of Reflect.ownKeys(raw)){const d=Object.getOwnPropertyDescriptor(raw,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('observer-outcome-denied');}
 if(Object.keys(raw).length!==3||!['status','result','errorCode'].every(k=>Object.hasOwn(raw,k))||!['completed','failed','cancelled','unknown'].includes(raw.status))throw Error('observer-outcome-denied');
 if(raw.result!==null&&(!raw.result||Object.getPrototypeOf(raw.result)!==Object.prototype))throw Error('observer-result-denied');
 json(raw.result);
 if(raw.errorCode!==null&&(typeof raw.errorCode!=='string'||! /^[a-z0-9_-]{1,128}$/.test(raw.errorCode)))throw Error('observer-outcome-denied');
 if(raw.status==='completed'?(raw.result===null||raw.errorCode!==null):(raw.result!==null||raw.errorCode===null))throw Error('observer-outcome-denied');
 if(new TextEncoder().encode(JSON.stringify(raw.result)).byteLength>65536)throw Error('observer-result-denied');
 return structuredClone(raw);
}
/** One durable execution claim per command. Unknown delivery continues to hold
 * the workspace slot; clocks and restarts never release it automatically. */
export class SqlObserverCalls{
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #clock:()=>number;readonly #ready:Promise<void>;readonly #commit:ObserverCallCommit;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,clock=Date.now,commit?:ObserverCallCommit){
  json(rawScope);this.#scope=scope(rawScope);this.#storage=storage;this.#clock=clock;this.#commit=commit??(async operation=>storage.transactionSync(operation));
  storage.transactionSync(()=>{storage.sql.exec(`CREATE TABLE IF NOT EXISTS observer_call_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observer_calls(call_key TEXT PRIMARY KEY,record_json TEXT NOT NULL);`);
   const old=this.#rows('SELECT scope_json FROM observer_call_meta WHERE singleton=1')[0];if(old&&old.scope_json!==canonical(this.#scope))throw Error('observer-call-scope-denied');if(!old)storage.sql.exec('INSERT INTO observer_call_meta VALUES(1,?)',canonical(this.#scope));});this.#ready=storage.sync();
 }
 #rows(query:string,...args:(string|number|null)[]){return this.#storage.sql.exec<Record<string,SqlStorageValue>>(query,...args).toArray();}
 #command(raw:ObserverCommand){const command=normalizeObserverCommand(raw);if(!sameScope(command.scope,this.#scope))throw Error('observer-call-scope-denied');return command;}
 #key(c:ObserverCommand){return JSON.stringify([c.turnId,c.dispatchId,c.commandId]);}
 #decode(row:Record<string,SqlStorageValue>):ObserverCallRecord{
  try{
   const r=JSON.parse(row.record_json as string) as ObserverCallRecord;
   const keys=['command','targetDigest','status','acceptedAt','startedAt','finishedAt','result','errorCode'];
   if(!r||Object.getPrototypeOf(r)!==Object.prototype||Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))throw Error();
   const c=this.#command(r.command);if(canonical(c)!==canonical(r.command)||this.#key(c)!==row.call_key)throw Error();sha(r.targetDigest);
   const accepted=positive(r.acceptedAt);if(accepted>=c.deadlineAt||c.deadlineAt-accepted>15000)throw Error();
   if(r.startedAt!==null&&(positive(r.startedAt)<accepted||r.startedAt>=c.deadlineAt))throw Error();
   if(r.finishedAt!==null&&positive(r.finishedAt)<(r.startedAt??accepted))throw Error();
   if(r.status==='accepted'||r.status==='running'){
    if(r.finishedAt!==null||r.result!==null||r.errorCode!==null||(r.status==='accepted'?r.startedAt!==null:r.startedAt===null))throw Error();
   }else{
    outcome({status:r.status,result:r.result,errorCode:r.errorCode});
    if(r.status==='unknown'?r.finishedAt!==null:r.finishedAt===null)throw Error();
    if(r.status==='completed'&&(r.startedAt===null||r.finishedAt!>=c.deadlineAt))throw Error();
   }
   return r;
  }catch{throw Error('observer-call-persisted-invalid');}
 }
 #read(c:ObserverCommand):ObserverCallRecord|null{const row=this.#rows('SELECT call_key,record_json FROM observer_calls WHERE call_key=?',this.#key(c))[0];if(!row)return null;const r=this.#decode(row);if(canonical(r.command)!==canonical(c))throw Error('observer-call-conflict');return r;}
 #write(r:ObserverCallRecord){this.#storage.sql.exec('UPDATE observer_calls SET record_json=? WHERE call_key=?',JSON.stringify(r),this.#key(r.command));}
 async #change<T>(fn:()=>T):Promise<T>{await this.#ready;const value=await this.#commit(fn);await this.#storage.sync();return structuredClone(value);}
 async accept(raw:ObserverCommand,targetDigest:string):Promise<ObserverCallRecord>{const c=this.#command(raw);sha(targetDigest);return this.#change(()=>{
  const old=this.#read(c);if(old){if(old.targetDigest!==targetDigest)throw Error('observer-call-conflict');return old;}
  const now=positive(this.#clock());validateObserverCommand(c,now);const rows=this.#rows('SELECT call_key,record_json FROM observer_calls').map(row=>this.#decode(row));if(rows.length>=256)throw Error('observer-call-capacity');
  if(rows.some(row=>['accepted','running','unknown'].includes(row.status)))throw Error('observer-call-busy');
  const r:ObserverCallRecord={command:c,targetDigest,status:'accepted',acceptedAt:now,startedAt:null,finishedAt:null,result:null,errorCode:null};this.#storage.sql.exec('INSERT INTO observer_calls VALUES(?,?)',this.#key(c),JSON.stringify(r));return r;
 });}
 async start(raw:ObserverCommand):Promise<{record:ObserverCallRecord;shouldExecute:boolean}>{const c=this.#command(raw);return this.#change(()=>{const r=this.#read(c);if(!r)throw Error('observer-call-not-found');if(r.status!=='accepted')return {record:r,shouldExecute:false};const now=positive(this.#clock());if(now<r.acceptedAt||now>=c.deadlineAt)throw Error('observer-call-expired');r.status='running';r.startedAt=now;this.#write(r);return {record:r,shouldExecute:true};});}
 async finish(raw:ObserverCommand,rawOutcome:ObserverOutcome):Promise<ObserverCallRecord>{const c=this.#command(raw),o=outcome(rawOutcome);return this.#change(()=>{
  const r=this.#read(c);if(!r)throw Error('observer-call-not-found');const replay=canonical({status:r.status,result:r.result,errorCode:r.errorCode})===canonical(o);
  if(['completed','failed','cancelled'].includes(r.status)){if(!replay)throw Error('observer-call-terminal-conflict');return r;}if(replay)return r;
  const now=positive(this.#clock());if(now<(r.startedAt??r.acceptedAt))throw Error('observer-call-clock-denied');if(o.status==='completed'&&(r.startedAt===null||now>=c.deadlineAt))throw Error('observer-call-completion-denied');
  r.status=o.status;r.result=o.result;r.errorCode=o.errorCode;r.finishedAt=o.status==='unknown'?null:now;this.#write(r);return r;
 });}
 /** Called within the owning Workspace transaction to project its logical wake. */
 activeSync():ObserverCallRecord|null{
  const rows=this.#rows('SELECT call_key,record_json FROM observer_calls');
  if(rows.length>256)throw Error('observer-call-persisted-invalid');
  const active=rows.map(row=>this.#decode(row)).filter(row=>['accepted','running','unknown'].includes(row.status));
  if(active.length>1)throw Error('observer-call-persisted-invalid');return active[0]?structuredClone(active[0]):null;
 }
  async active():Promise<ObserverCallRecord|null>{await this.#ready;return this.activeSync();}
  async snapshot(raw:ObserverCommand):Promise<ObserverCallRecord|null>{const c=this.#command(raw);await this.#ready;return structuredClone(this.#read(c));}
  async lookup(reference:{turnId:string;dispatchId:string;commandId:string}):Promise<ObserverCallRecord|null>{
   const {turnId:turn,dispatchId:dispatch,commandId:command}=normalizeIDs(reference);await this.#ready;
   const row=this.#rows('SELECT call_key,record_json FROM observer_calls WHERE call_key=?',JSON.stringify([turn,dispatch,command]));
   return row[0]?structuredClone(this.#decode(row[0])):null;
  }
}
