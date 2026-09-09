import {observerArtifactReceipt,type ObserverArtifactReceipt} from './observer-artifacts.ts';
import {SqlObserverArtifactInventory} from './observer-artifact-inventory.ts';
import type {ServiceRunStorage} from '../run/service.ts';
import {positive} from '../turn/protocol.ts';
import {normalizeObserverCommand,validateObserverCommand,type ObserverCommand,type ObserverJson} from './observer-protocol.ts';
export type ObserverExecutorResult={stopped:true;result:{[key:string]:ObserverJson}};
/** The backend must persist its own fence before proving all browser processes
 * stopped, including delayed starts. Absence of an in-memory handle is no proof. */
export interface ObserverExecutorBackend {
 execute(command:ObserverCommand):Promise<ObserverExecutorResult>;
 fenceAndStop(command:ObserverCommand):Promise<boolean>;
}
type Row={command_json:string;attempted:number;fenced:number;stopped:number;result_json:string|null};
function json(value:unknown,depth=0,budget={nodes:65536}):void{
 if(depth>32||--budget.nodes<0)throw Error('observer-result-denied');
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='string'){if(value.length>65536)throw Error('observer-result-denied');return;}
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(!value||typeof value!=='object')throw Error('observer-result-denied');
 const array=Array.isArray(value),keys=Reflect.ownKeys(value);
 if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype)||keys.length>65536||(array&&keys.length!==value.length+1))throw Error('observer-result-denied');
 for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(value,key)!;
  if(typeof key!=='string'||!d.enumerable||!('value'in d)||(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||!Number.isSafeInteger(Number(key))||Number(key)>=(value as unknown[]).length)))throw Error('observer-result-denied');json(d.value,depth+1,budget);
 }
}
function result(raw:unknown):ObserverExecutorResult{
 json(raw);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('observer-result-denied');
 const r=raw as ObserverExecutorResult;
 if(Object.keys(r).length!==2||!Object.hasOwn(r,'stopped')||!Object.hasOwn(r,'result')||r.stopped!==true||!r.result||Object.getPrototypeOf(r.result)!==Object.prototype)throw Error('observer-result-denied');
 if(new TextEncoder().encode(JSON.stringify(r.result)).byteLength>65536)throw Error('observer-result-denied');
 return structuredClone(r);
}
/** One immutable command per actor. An attempted call is never retried, even
 * after a lost acknowledgement. Stop never queues behind execute. */
export class SqlObserverExecutorSupervisor {
 readonly #storage:ServiceRunStorage;readonly #command:ObserverCommand;readonly #encoded:string;readonly #backend:ObserverExecutorBackend;readonly #clock:()=>number;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,command:ObserverCommand,backend:ObserverExecutorBackend,clock=Date.now){
  this.#storage=storage;this.#command=normalizeObserverCommand(command);this.#encoded=JSON.stringify(this.#command);this.#backend=backend;this.#clock=clock;
  storage.transactionSync(()=>{
   storage.sql.exec('CREATE TABLE IF NOT EXISTS observer_executor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),command_json TEXT NOT NULL,attempted INTEGER NOT NULL,fenced INTEGER NOT NULL,stopped INTEGER NOT NULL,result_json TEXT)');
   const rows=storage.sql.exec<Row>('SELECT command_json,attempted,fenced,stopped,result_json FROM observer_executor').toArray();
   if(!rows.length)storage.sql.exec('INSERT INTO observer_executor VALUES(1,?,0,0,0,NULL)',this.#encoded);
   this.#row();
  });this.#ready=storage.sync();this.#ready.catch(()=>{});
 }
 #row():Row{
  const rows=this.#storage.sql.exec<Row>('SELECT command_json,attempted,fenced,stopped,result_json FROM observer_executor').toArray(),r=rows[0];
  if(rows.length!==1||!r||typeof r.command_json!=='string'||![0,1].includes(r.attempted)||![0,1].includes(r.fenced)||![0,1].includes(r.stopped)||(r.stopped===1&&r.fenced!==1)||(r.result_json!==null&&typeof r.result_json!=='string'))throw Error('observer-executor-persisted-invalid');
  try{if(JSON.stringify(normalizeObserverCommand(JSON.parse(r.command_json)))!==r.command_json)throw Error();if(r.result_json!==null){if(r.attempted!==1)throw Error();result(JSON.parse(r.result_json));}}catch{throw Error('observer-executor-persisted-invalid');}
  if(r.command_json!==this.#encoded)throw Error('observer-executor-command-conflict');return r;
 }
 /** Historical lookup is strictly read only: constructing a supervisor would
  * create an execution row and accidentally turn a miss into durable state. */
 static requireArtifact(storage:ServiceRunStorage,raw:ObserverCommand,rawReceipt:ObserverArtifactReceipt):void{
  const command=normalizeObserverCommand(raw),receipt=observerArtifactReceipt(rawReceipt);
  if(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name='observer_executor'").toArray().length!==1)throw Error('observer-artifact-not-completed');
  const rows=storage.sql.exec<Row>('SELECT command_json,attempted,fenced,stopped,result_json FROM observer_executor').toArray(),row=rows[0];
  if(rows.length!==1||!row||row.command_json!==JSON.stringify(command)||row.attempted!==1||![0,1].includes(row.fenced)||![0,1].includes(row.stopped)||(row.stopped===1&&row.fenced!==1)||typeof row.result_json!=='string')throw Error('observer-artifact-not-completed');
  const completed=result(JSON.parse(row.result_json));
  const attached=['state','view'].some(key=>{
   const value=completed.result[key];if(!value||typeof value!=='object'||Array.isArray(value))return false;
   try{return JSON.stringify(observerArtifactReceipt(value.artifact))===JSON.stringify(receipt);}catch{return false;}
  });
  if(!attached)throw Error('observer-artifact-not-completed');
 }
 static requireWritable(storage:ServiceRunStorage,raw:ObserverCommand):void{
  const command=normalizeObserverCommand(raw),rows=storage.sql.exec<Row>('SELECT command_json,attempted,fenced,stopped,result_json FROM observer_executor').toArray();
  if(rows.length!==1||rows[0]!.command_json!==JSON.stringify(command)||rows[0]!.attempted!==1||rows[0]!.fenced!==0||rows[0]!.stopped!==0||rows[0]!.result_json!==null||Date.now()>=command.deadlineAt)throw Error('observer-artifact-write-fenced');
 }
 async #change<T>(fn:(row:Row)=>T):Promise<T>{await this.#ready;const value=this.#storage.transactionSync(()=>fn(this.#row()));await this.#storage.sync();return value;}
 #live(row:Row){if(row.fenced!==0)throw Error('observer-execution-fenced');if(this.#command.deadlineAt<=positive(this.#clock()))throw Error('observer-execution-expired');}
 async execute():Promise<ObserverExecutorResult>{
  const claimed=await this.#change(row=>{
   if(row.fenced)throw Error('observer-execution-fenced');
   if(row.result_json!==null)return false;
   this.#live(row);if(row.attempted!==0)throw Error('observer-execution-unknown');
   validateObserverCommand(this.#command,this.#clock());
   this.#storage.sql.exec('UPDATE observer_executor SET attempted=1 WHERE singleton=1');return true;
  });
  const row=this.#row();if(row.fenced)throw Error('observer-execution-fenced');
  if(!claimed){if(row.result_json===null)throw Error('observer-execution-unknown');return result(JSON.parse(row.result_json));}
  this.#live(row);
  const completed=result(await this.#backend.execute(structuredClone(this.#command)));
  await this.#change(current=>{this.#live(current);if(current.attempted!==1||current.result_json!==null)throw Error('observer-execution-unknown');SqlObserverArtifactInventory.retainResult(this.#storage,this.#command,completed.result);this.#storage.sql.exec('UPDATE observer_executor SET result_json=? WHERE singleton=1',JSON.stringify(completed));});
  // A stop may have committed while completion durability was pending.
  this.#live(this.#row());return structuredClone(completed);
 }
 async stop():Promise<boolean>{
  const saved=await this.#change(row=>{if(!row.fenced)this.#storage.sql.exec('UPDATE observer_executor SET fenced=1 WHERE singleton=1');return row.stopped===1;});
  if(saved)return true;
  // Even an unattempted command needs the native fence for delayed delivery.
  if(await this.#backend.fenceAndStop(structuredClone(this.#command))!==true)return false;
  await this.#change(row=>{if(row.fenced!==1)throw Error('observer-executor-persisted-invalid');this.#storage.sql.exec('UPDATE observer_executor SET stopped=1 WHERE singleton=1');});
  return this.#row().stopped===1;
 }
}
