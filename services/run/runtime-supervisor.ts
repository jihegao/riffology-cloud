import {scope,sameScope,positive,type TurnScope} from '../turn/protocol.ts';
import type {ServiceRunStorage} from './service.ts';
import {serviceRuntimeInput,serviceRuntimeObservation,type ServiceRuntimeInput,type ServiceRuntimeObservation,type ServiceRuntimePort} from './runtime-protocol.ts';

/** Trusted native adapter, not a project API. start must deduplicate by the full
 * runtime identity. fenceAndStop MUST durably reject all delayed/in-flight start
 * requests for that identity and prove every descendant process has stopped.
 * Missing processes/containers alone cannot produce a stopped receipt. These
 * obligations require native integration tests; this journal cannot prove them. */
export interface ServiceNativeBackend {
 start(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
 observe(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
 fenceAndStop(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
}
type Row={input_json:string;attempted:number;fenced_at:number|null;receipt_json:string|null};
/** One private supervisor per immutable service runtime. No retries of a start
 * with an uncertain outcome; observation and irreversible stop remain available.
 * Stop is deliberately not queued behind a possibly hung native start. */
export class SqlServiceRuntimeSupervisor implements ServiceRuntimePort {
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #backend:ServiceNativeBackend;readonly #clock:()=>number;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,backend:ServiceNativeBackend,clock=Date.now){
  this.#storage=storage;this.#scope=scope(rawScope);this.#backend=backend;this.#clock=clock;
  storage.transactionSync(()=>{
   storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_runtime_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS service_runtime_fence(singleton INTEGER PRIMARY KEY CHECK(singleton=1),input_json TEXT NOT NULL,attempted INTEGER NOT NULL,fenced_at INTEGER,receipt_json TEXT);`);
   const rows=storage.sql.exec<{scope_json:string}>('SELECT scope_json FROM service_runtime_owner WHERE singleton=1').toArray();
   if(rows[0]&&rows[0].scope_json!==JSON.stringify(this.#scope))throw Error('service-runtime-scope-denied');
   if(!rows[0])storage.sql.exec('INSERT INTO service_runtime_owner VALUES(1,?)',JSON.stringify(this.#scope));
  });this.#ready=storage.sync();
 }
 #now(){return positive(this.#clock());}
 #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(!sameScope(input.scope,this.#scope))throw Error('service-runtime-scope-denied');return input;}
 #row(input:ServiceRuntimeInput):Row {
  let row=this.#storage.sql.exec<Row>('SELECT input_json,attempted,fenced_at,receipt_json FROM service_runtime_fence WHERE singleton=1').toArray()[0];
  const encoded=JSON.stringify(input);
  if(!row){this.#storage.sql.exec('INSERT INTO service_runtime_fence VALUES(1,?,0,NULL,NULL)',encoded);row={input_json:encoded,attempted:0,fenced_at:null,receipt_json:null};}
  if(row.input_json!==encoded)throw Error('service-runtime-identity-conflict');return row;
 }
 async #change<T>(input:ServiceRuntimeInput,fn:(row:Row)=>T):Promise<T>{await this.#ready;const result=this.#storage.transactionSync(()=>fn(this.#row(input)));await this.#storage.sync();return result;}
 #unknown(input:ServiceRuntimeInput):ServiceRuntimeObservation{return {reference:structuredClone(input.reference),scope:structuredClone(input.scope),status:'unknown',stop:null};}
 #receipt(input:ServiceRuntimeInput,row:Row):ServiceRuntimeObservation|null {
  return row.receipt_json===null?null:serviceRuntimeObservation({...this.#unknown(input),status:'stopped',stop:JSON.parse(row.receipt_json)},input,this.#now());
 }
 async #accept(input:ServiceRuntimeInput,raw:ServiceRuntimeObservation):Promise<ServiceRuntimeObservation>{
  const observation=serviceRuntimeObservation(raw,input,this.#now());
  return this.#change(input,row=>{
   const saved=this.#receipt(input,row);if(saved)return saved;
   if(observation.status==='stopped'){
    if(row.fenced_at===null||observation.stop!.observedAt<row.fenced_at)throw Error('service-runtime-unfenced-stop');
    this.#storage.sql.exec('UPDATE service_runtime_fence SET receipt_json=? WHERE singleton=1',JSON.stringify(observation.stop));return observation;
   }
   if(row.fenced_at!==null||input.reference.deadlineAt<=this.#now())return this.#unknown(input);
   return observation;
  });
 }
 /** Read-only forwarding gate; never allocates a runtime or contacts native code. */
 #forwardInput(raw:ServiceRuntimeInput):void{
  const input=this.#input(raw);
  const row=this.#storage.sql.exec<Row>('SELECT input_json,attempted,fenced_at,receipt_json FROM service_runtime_fence WHERE singleton=1').toArray()[0];
  if(!row||row.input_json!==JSON.stringify(input)||row.attempted!==1||row.fenced_at!==null||row.receipt_json!==null||input.reference.deadlineAt<=this.#now())throw Error('service-forward-denied');
 }
 async requireForward(raw:ServiceRuntimeInput):Promise<void>{await this.#ready;this.#forwardInput(raw);}
 async forward<T>(raw:ServiceRuntimeInput,invoke:()=>Promise<T>):Promise<T>{await this.#ready;this.#forwardInput(raw);return invoke();}
 async start(raw:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{
  const input=this.#input(raw);
  const dispatch=await this.#change(input,row=>{
   if(row.fenced_at!==null||row.attempted!==0||input.reference.deadlineAt<=this.#now())return false;
   this.#storage.sql.exec('UPDATE service_runtime_fence SET attempted=1 WHERE singleton=1');return true;
  });
  // A stop can commit while the dispatch durability acknowledgement is pending.
  const row=this.#row(input),saved=this.#receipt(input,row);if(saved)return saved;
  if(row.fenced_at!==null||input.reference.deadlineAt<=this.#now())return this.#unknown(input);
  if(!dispatch)return this.observe(input);
  return this.#accept(input,await this.#backend.start(structuredClone(input)));
 }
 async observe(raw:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{
  const input=this.#input(raw),saved=await this.#change(input,row=>this.#receipt(input,row));if(saved)return saved;
  return this.#accept(input,await this.#backend.observe(structuredClone(input)));
 }
 async stop(raw:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>{
  const input=this.#input(raw),saved=await this.#change(input,row=>{
   const receipt=this.#receipt(input,row);if(receipt)return receipt;
   if(row.fenced_at===null)this.#storage.sql.exec('UPDATE service_runtime_fence SET fenced_at=? WHERE singleton=1',this.#now());return null;
  });
  if(saved)return saved;
  return this.#accept(input,await this.#backend.fenceAndStop(structuredClone(input)));
 }
}
