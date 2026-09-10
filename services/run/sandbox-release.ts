import {serviceRuntimeInput,type ServiceRuntimeInput} from './runtime-protocol.ts';

export interface ServiceSandboxReleasePort{
 running():Promise<boolean>;
 destroy():Promise<void>;
}
export type ServiceSandboxReleaseStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'|'setAlarm'|'deleteAlarm'>;
type Row={input_json:string;begun_at:number;quiet_since:number|null;last_running_at:number|null;attempts:number;completed_at:number|null};
export type ServiceSandboxReleaseOptions={retryMs?:number;assignmentGuardMs?:number;quietMs?:number;rpcMs?:number};

/** A stopped service's container may still have a pending platform assignment.
 * Keep destroying the exact run actor until the longest supported assignment
 * window has elapsed and repeated probes have remained absent. */
export class SqlServiceSandboxRelease{
 readonly #storage:ServiceSandboxReleaseStorage;readonly #port:(input:ServiceRuntimeInput)=>Promise<ServiceSandboxReleasePort>;readonly #clock:()=>number;readonly #retryMs:number;readonly #assignmentGuardMs:number;readonly #quietMs:number;readonly #rpcMs:number;readonly #ready:Promise<void>;
 constructor(storage:ServiceSandboxReleaseStorage,port:(input:ServiceRuntimeInput)=>Promise<ServiceSandboxReleasePort>,clock=Date.now,options:ServiceSandboxReleaseOptions={}){
  this.#storage=storage;this.#port=port;this.#clock=clock;this.#retryMs=options.retryMs??5000;this.#assignmentGuardMs=options.assignmentGuardMs??360000;this.#quietMs=options.quietMs??30000;this.#rpcMs=options.rpcMs??4000;
  for(const value of [this.#retryMs,this.#assignmentGuardMs,this.#quietMs,this.#rpcMs])if(!Number.isSafeInteger(value)||value<1)throw Error('invalid-service-sandbox-release-policy');
  storage.transactionSync(()=>storage.sql.exec(`CREATE TABLE IF NOT EXISTS service_sandbox_release(singleton INTEGER PRIMARY KEY CHECK(singleton=1),input_json TEXT NOT NULL,begun_at INTEGER NOT NULL,quiet_since INTEGER,last_running_at INTEGER,attempts INTEGER NOT NULL,completed_at INTEGER) STRICT`));this.#ready=storage.sync();
 }
 #now(){const now=this.#clock();if(!Number.isSafeInteger(now)||now<1)throw Error('invalid-service-sandbox-release-time');return now;}
 #row():Row|null{return this.#storage.sql.exec<Row>('SELECT input_json,begun_at,quiet_since,last_running_at,attempts,completed_at FROM service_sandbox_release WHERE singleton=1').toArray()[0]??null;}
 #input(row:Row){const input=serviceRuntimeInput(JSON.parse(row.input_json));if(JSON.stringify(input)!==row.input_json)throw Error('invalid-persisted-service-sandbox-release');return input;}
 async #change(fn:(row:Row|null)=>void){await this.#ready;this.#storage.transactionSync(()=>fn(this.#row()));await this.#storage.sync();}
 async #bounded<T>(operation:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const pending=Promise.resolve().then(operation);
  try{return await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('service-sandbox-release-timeout')),this.#rpcMs);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 async begin(raw:ServiceRuntimeInput){
  const input=serviceRuntimeInput(raw),encoded=JSON.stringify(input),now=this.#now();
  await this.#storage.setAlarm(now+1);await this.#storage.sync();
  await this.#change(row=>{
   if(row&&row.input_json!==encoded)throw Error('service-sandbox-release-identity-conflict');
   if(!row)this.#storage.sql.exec('INSERT INTO service_sandbox_release VALUES(1,?,?,NULL,NULL,0,NULL)',encoded,now);
  });
  return this.reconcile();
 }
 async reconcile(){
  await this.#ready;const initial=this.#row();
  if(!initial){await this.#storage.deleteAlarm();await this.#storage.sync();return false;}
  if(initial.completed_at!==null){await this.#storage.deleteAlarm();await this.#storage.sync();return true;}
  const input=this.#input(initial),now=this.#now();
  // Arm first so eviction or a bounded control-plane failure cannot lose work.
  await this.#storage.setAlarm(now+this.#retryMs);await this.#storage.sync();
  let before=false,after=false,confirmed=false,destroyed=false,seenRunning=false;
  try{
   const port=await this.#port(structuredClone(input));
   try{before=await this.#bounded(()=>port.running());seenRunning=before;}catch{}
   // begin() is reachable only after Runtime has durably validated the exact
   // run's fenced stop receipt. A legacy Sandbox may not expose running(), but
   // that must not block destroy() for this deterministically derived actor.
   try{await this.#bounded(()=>port.destroy());destroyed=true;}catch{}
   if(destroyed)try{after=await this.#bounded(()=>port.running());confirmed=true;seenRunning ||= after;}catch{}
  }catch{}
  const observedAt=this.#now();let complete=false;
  await this.#change(row=>{
   if(!row||row.input_json!==JSON.stringify(input)||row.completed_at!==null)return;
   const attempts=row.attempts+1;
   const quietSince=!confirmed||after?null:seenRunning||row.quiet_since===null?observedAt:row.quiet_since;
   complete=confirmed&&!after&&quietSince!==null&&observedAt-row.begun_at>=this.#assignmentGuardMs&&observedAt-quietSince>=this.#quietMs;
   this.#storage.sql.exec('UPDATE service_sandbox_release SET quiet_since=?,last_running_at=?,attempts=?,completed_at=? WHERE singleton=1',quietSince,seenRunning?observedAt:row.last_running_at,attempts,complete?observedAt:null);
  });
  if(complete){await this.#storage.deleteAlarm();await this.#storage.sync();}
  return complete;
 }
 async snapshot(){await this.#ready;const row=this.#row();if(!row)return null;this.#input(row);return structuredClone(row);}
}
