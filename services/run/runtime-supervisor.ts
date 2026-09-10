import {scope,sameScope,positive,turnDigest,type TurnScope} from '../turn/protocol.ts';
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
 recoverStop?(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
}
export type ServiceRuntimeReleaseContext={kind:'native-stop'|'platform-destroy';fencedAt:number;authorizedAt:number|null};
export type ServiceRuntimeRelease=(input:ServiceRuntimeInput,context:ServiceRuntimeReleaseContext)=>Promise<ServiceRuntimeObservation|null|void>;
export type ServiceRuntimeSupervisorOptions={stopRecoveryMs?:number;hardDestroyGraceMs?:number};
type Row={input_json:string;attempted:number;fenced_at:number|null;receipt_json:string|null;stop_attempted:number;recover_attempts:number;next_recover_at:number|null;hard_destroy_authorized_at:number|null;platform_proof_json:string|null};
/** One private supervisor per immutable service runtime. No retries of a start
 * with an uncertain outcome; observation and irreversible stop remain available.
 * Stop is deliberately not queued behind a possibly hung native start. */
export class SqlServiceRuntimeSupervisor implements ServiceRuntimePort {
 readonly #storage:ServiceRunStorage;readonly #scope:TurnScope;readonly #backend:ServiceNativeBackend;readonly #clock:()=>number;readonly #release:ServiceRuntimeRelease;readonly #stopRecoveryMs:number;readonly #hardDestroyGraceMs:number;readonly #ready:Promise<void>;
 constructor(storage:ServiceRunStorage,rawScope:TurnScope,backend:ServiceNativeBackend,clock=Date.now,release:ServiceRuntimeRelease=async()=>null,options:ServiceRuntimeSupervisorOptions={}){
  this.#storage=storage;this.#scope=scope(rawScope);this.#backend=backend;this.#clock=clock;this.#release=release;this.#stopRecoveryMs=options.stopRecoveryMs??10000;this.#hardDestroyGraceMs=options.hardDestroyGraceMs??30000;
  for(const value of [this.#stopRecoveryMs,this.#hardDestroyGraceMs])if(!Number.isSafeInteger(value)||value<1)throw Error('invalid-service-stop-recovery-policy');
  storage.transactionSync(()=>{
   storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_runtime_owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),scope_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS service_runtime_fence(singleton INTEGER PRIMARY KEY CHECK(singleton=1),input_json TEXT NOT NULL,attempted INTEGER NOT NULL,fenced_at INTEGER,receipt_json TEXT,stop_attempted INTEGER NOT NULL DEFAULT 0,recover_attempts INTEGER NOT NULL DEFAULT 0,next_recover_at INTEGER,hard_destroy_authorized_at INTEGER,platform_proof_json TEXT);`);
   const columns=storage.sql.exec<{name:string}>('PRAGMA table_info(service_runtime_fence)').toArray();
   if(!columns.some(column=>column.name==='stop_attempted')){
    storage.sql.exec('ALTER TABLE service_runtime_fence ADD COLUMN stop_attempted INTEGER NOT NULL DEFAULT 0');
    // A fence written by an older build may already have dispatched native stop.
    // Recover its proof read-only; never infer that replaying the mutation is safe.
    storage.sql.exec('UPDATE service_runtime_fence SET stop_attempted=1 WHERE fenced_at IS NOT NULL AND receipt_json IS NULL');
   }
   if(!columns.some(column=>column.name==='recover_attempts'))storage.sql.exec('ALTER TABLE service_runtime_fence ADD COLUMN recover_attempts INTEGER NOT NULL DEFAULT 0');
   if(!columns.some(column=>column.name==='next_recover_at'))storage.sql.exec('ALTER TABLE service_runtime_fence ADD COLUMN next_recover_at INTEGER');
   if(!columns.some(column=>column.name==='hard_destroy_authorized_at'))storage.sql.exec('ALTER TABLE service_runtime_fence ADD COLUMN hard_destroy_authorized_at INTEGER');
   if(!columns.some(column=>column.name==='platform_proof_json'))storage.sql.exec('ALTER TABLE service_runtime_fence ADD COLUMN platform_proof_json TEXT');
   const rows=storage.sql.exec<{scope_json:string}>('SELECT scope_json FROM service_runtime_owner WHERE singleton=1').toArray();
   if(rows[0]&&rows[0].scope_json!==JSON.stringify(this.#scope))throw Error('service-runtime-scope-denied');
   if(!rows[0])storage.sql.exec('INSERT INTO service_runtime_owner VALUES(1,?)',JSON.stringify(this.#scope));
  });this.#ready=storage.sync();
 }
 #now(){return positive(this.#clock());}
 #input(raw:ServiceRuntimeInput){const input=serviceRuntimeInput(raw);if(!sameScope(input.scope,this.#scope))throw Error('service-runtime-scope-denied');return input;}
 #row(input:ServiceRuntimeInput):Row {
  let row=this.#storage.sql.exec<Row>('SELECT input_json,attempted,fenced_at,receipt_json,stop_attempted,recover_attempts,next_recover_at,hard_destroy_authorized_at,platform_proof_json FROM service_runtime_fence WHERE singleton=1').toArray()[0];
  const encoded=JSON.stringify(input);
  if(!row){this.#storage.sql.exec('INSERT INTO service_runtime_fence(singleton,input_json,attempted,fenced_at,receipt_json,stop_attempted,recover_attempts,next_recover_at,hard_destroy_authorized_at,platform_proof_json) VALUES(1,?,0,NULL,NULL,0,0,NULL,NULL,NULL)',encoded);row={input_json:encoded,attempted:0,fenced_at:null,receipt_json:null,stop_attempted:0,recover_attempts:0,next_recover_at:null,hard_destroy_authorized_at:null,platform_proof_json:null};}
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
  const row=this.#storage.sql.exec<Row>('SELECT input_json,attempted,fenced_at,receipt_json,stop_attempted,recover_attempts,next_recover_at,hard_destroy_authorized_at,platform_proof_json FROM service_runtime_fence WHERE singleton=1').toArray()[0];
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
  const input=this.#input(raw),now=this.#now(),decision=await this.#change(input,row=>{
   const receipt=this.#receipt(input,row);if(receipt)return receipt;
   if(row.stop_attempted===0){
    this.#storage.sql.exec('UPDATE service_runtime_fence SET fenced_at=COALESCE(fenced_at,?),stop_attempted=1,next_recover_at=? WHERE singleton=1',now,now+this.#stopRecoveryMs);
    return {kind:'native' as const,fencedAt:row.fenced_at??now};
   }
   if(row.fenced_at===null)throw Error('invalid-service-stop-fence');
   if(row.hard_destroy_authorized_at!==null)return {kind:'hard' as const,fencedAt:row.fenced_at,authorizedAt:row.hard_destroy_authorized_at};
   if(now-row.fenced_at>=this.#hardDestroyGraceMs){
    this.#storage.sql.exec('UPDATE service_runtime_fence SET hard_destroy_authorized_at=?,next_recover_at=NULL WHERE singleton=1',now);
    return {kind:'hard' as const,fencedAt:row.fenced_at,authorizedAt:now};
   }
   if(row.next_recover_at!==null&&now<row.next_recover_at)return {kind:'idle' as const};
   this.#storage.sql.exec('UPDATE service_runtime_fence SET recover_attempts=recover_attempts+1,next_recover_at=? WHERE singleton=1',now+this.#stopRecoveryMs);
   return {kind:'recover' as const};
  });
  if('status' in decision){await this.#release(structuredClone(input),{kind:'native-stop',fencedAt:decision.stop!.observedAt,authorizedAt:null});return decision;}
  if(decision.kind==='native'){
   const stopped=await this.#accept(input,await this.#backend.fenceAndStop(structuredClone(input)));
   if(stopped.status==='stopped')await this.#release(structuredClone(input),{kind:'native-stop',fencedAt:decision.fencedAt,authorizedAt:null});
   return stopped;
  }
  if(decision.kind==='recover'){
   if(!this.#backend.recoverStop)return this.#unknown(input);
   try{
    const stopped=await this.#accept(input,await this.#backend.recoverStop(structuredClone(input)));
    if(stopped.status==='stopped')await this.#release(structuredClone(input),{kind:'native-stop',fencedAt:stopped.stop!.observedAt,authorizedAt:null});
    return stopped;
   }catch{return this.#unknown(input);}
  }
  if(decision.kind==='hard'){
   const raw=await this.#release(structuredClone(input),{kind:'platform-destroy',fencedAt:decision.fencedAt,authorizedAt:decision.authorizedAt});
   if(!raw)return this.#unknown(input);
   const stopped=serviceRuntimeObservation(raw,input,this.#now());
   if(stopped.status!=='stopped'||!stopped.stop||stopped.stop.observedAt<decision.authorizedAt)throw Error('invalid-service-platform-stop-proof');
   const confirmationId='platform-'+(await turnDigest({schemaVersion:1,purpose:'service-platform-destroy',input,fencedAt:decision.fencedAt,authorizedAt:decision.authorizedAt,confirmedAbsentAt:stopped.stop.observedAt})).slice(0,52);
   if(stopped.stop.confirmationId!==confirmationId)throw Error('invalid-service-platform-stop-proof');
   const inputSha256=await turnDigest(input);
   return this.#change(input,row=>{
    const saved=this.#receipt(input,row);if(saved)return saved;
    if(row.fenced_at!==decision.fencedAt||row.hard_destroy_authorized_at!==decision.authorizedAt)throw Error('service-platform-stop-authority-conflict');
    const proof={schemaVersion:1,kind:'platform-destroy',inputSha256,fencedAt:decision.fencedAt,authorizedAt:decision.authorizedAt,confirmedAbsentAt:stopped.stop!.observedAt,confirmationId};
    this.#storage.sql.exec('UPDATE service_runtime_fence SET receipt_json=?,platform_proof_json=? WHERE singleton=1',JSON.stringify(stopped.stop),JSON.stringify(proof));return stopped;
   });
  }
  return this.#unknown(input);
 }
}
