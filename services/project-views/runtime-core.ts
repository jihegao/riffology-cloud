import {actor,turnId,type TurnActor} from '../turn/protocol.ts';
import {PROJECT_VIEW_IDLE_MS,PROJECT_VIEW_SESSION_MS,projectViewRuntimeCommand,projectViewRuntimeDigest,projectViewRuntimeIdentity,projectViewRuntimeStart,runtimeObject,sameProjectViewRuntimeIdentity,type ProjectViewCapacityPort,type ProjectViewRuntimeCommand,type ProjectViewRuntimeIdentity,type ProjectViewRuntimePort,type ProjectViewRuntimeReply,type ProjectViewRuntimeStart,type ProjectViewRuntimeStatus} from './runtime-protocol.ts';

export interface ProjectViewNativeSession{
 send(command:Exclude<ProjectViewRuntimeCommand,{type:'poll'}>):Promise<void>;
 poll():Exclude<ProjectViewRuntimeReply,{closed:true}>;
 close():Promise<void>;
 finished:Promise<void>;
}
export type ProjectViewNativeFence={beforeWrite:(type:string)=>void};
/** This port controls one immutable session actor, never an SDK auto-start API. */
export interface ProjectViewNativePort{
 start(input:ProjectViewRuntimeStart,fence:ProjectViewNativeFence):Promise<ProjectViewNativeSession>;
 running():Promise<boolean>;
 destroy():Promise<void>;
}
export type ProjectViewRuntimeStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'|'setAlarm'|'deleteAlarm'>;
type RecordValue={
 schema:'project.view-runtime-state/v1';identity:ProjectViewRuntimeIdentity;inputDigest:string;expiresAt:number;createdAt:number;lastPollAt:number;status:ProjectViewRuntimeStatus['status'];
 capacityAttempted:boolean;capacityReleased:boolean;startIssued:boolean;startSettled:boolean;closeBeganAt:number|null;guardUntil:number|null;quietSince:number|null;cleanupProofId:string|null;reason:string|null;
};
export type ProjectViewRuntimeOptions={clock?:()=>number;waitUntil?:(work:Promise<unknown>)=>void;startupMs?:number;rpcMs?:number;retryMs?:number;assignmentGuardMs?:number;quietMs?:number};
function fail(code:string):never{throw Error('project-view-runtime-'+code);}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0;
/** One persisted identity and one start. A lost pipe is fenced, never recreated.
 * Only immutable identities/digests/lifecycle are durable; project bytes are not. */
export class ProjectViewRuntimeCore implements ProjectViewRuntimePort{
 readonly #storage:ProjectViewRuntimeStorage;readonly #native:ProjectViewNativePort;readonly #capacity:ProjectViewCapacityPort;readonly #options:Required<ProjectViewRuntimeOptions>;readonly #ready:Promise<void>;
 readonly #cold:ProjectViewRuntimeIdentity|null;
 #session:ProjectViewNativeSession|null=null;#startWork:Promise<void>|null=null;#releaseWork:Promise<void>|null=null;#recoverWork:Promise<void>|null=null;
 constructor(storage:ProjectViewRuntimeStorage,native:ProjectViewNativePort,capacity:ProjectViewCapacityPort,options:ProjectViewRuntimeOptions={}){
  this.#storage=storage;this.#native=native;this.#capacity=capacity;
  this.#options={clock:Date.now,waitUntil:()=>{},startupMs:30_000,rpcMs:4_000,retryMs:5_000,assignmentGuardMs:360_000,quietMs:30_000,...options};
  for(const key of ['startupMs','rpcMs','retryMs','assignmentGuardMs','quietMs'] as const)if(!integer(this.#options[key]))fail('policy-invalid');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS project_view_runtime(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value TEXT NOT NULL) STRICT');
  const prior=this.#read();this.#cold=prior&&prior.status!=='closed'?prior.identity:null;
  this.#ready=storage.sync();
 }
 #now(){const now=this.#options.clock();if(!integer(now))fail('clock-invalid');return now;}
 #read():RecordValue|null{
  const row=this.#storage.sql.exec<{value:string}>('SELECT value FROM project_view_runtime WHERE singleton=1').toArray()[0];if(!row)return null;
  const r=JSON.parse(row.value) as RecordValue;
  if(r.schema!=='project.view-runtime-state/v1'||!integer(r.expiresAt)||!integer(r.createdAt)||!integer(r.lastPollAt)||!['starting','running','stopping','closed','unknown'].includes(r.status)||! /^[a-f0-9]{64}$/.test(r.inputDigest)||[r.capacityAttempted,r.capacityReleased,r.startIssued,r.startSettled].some(v=>typeof v!=='boolean')||[r.closeBeganAt,r.guardUntil,r.quietSince].some(v=>v!==null&&!integer(v))||r.cleanupProofId!==null&&! /^view-release-[a-f0-9]{64}$/.test(r.cleanupProofId)||r.reason!==null&&(typeof r.reason!=='string'||! /^[a-z0-9-]{1,80}$/.test(r.reason))||r.status==='closed'&&(r.cleanupProofId===null||r.closeBeganAt===null))fail('state-invalid');
  r.identity=projectViewRuntimeIdentity(r.identity);return r;
 }
 #checked(identity:ProjectViewRuntimeIdentity){const row=this.#read();if(!row||!sameProjectViewRuntimeIdentity(row.identity,identity))fail('identity-denied');return row;}
 #write(row:RecordValue){this.#storage.sql.exec('INSERT INTO project_view_runtime(singleton,value) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET value=excluded.value',JSON.stringify(row));}
 async #change(identity:ProjectViewRuntimeIdentity,change:(row:RecordValue)=>void){await this.#ready;this.#storage.transactionSync(()=>{const row=this.#checked(identity);change(row);this.#write(row);});await this.#storage.sync();}
 async #bounded<T>(work:Promise<T>,ms=this.#options.rpcMs):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('project-view-runtime-control-timeout')),ms);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}
 #track(work:Promise<unknown>){this.#options.waitUntil(work.catch(()=>{}));}
 async #schedule(){
  const row=this.#read();if(!row)return;
  if(row.status==='closed'&&(!row.capacityAttempted||row.capacityReleased)){await this.#storage.deleteAlarm();return;}
  const now=this.#now(),next=row.status==='running'?Math.min(row.expiresAt,row.lastPollAt+PROJECT_VIEW_IDLE_MS):row.status==='starting'?Math.min(row.expiresAt,row.createdAt+this.#options.startupMs):now+this.#options.retryMs;
  await this.#storage.setAlarm(Math.max(now+1,next));await this.#storage.sync();
 }
 async #status(identity:ProjectViewRuntimeIdentity):Promise<ProjectViewRuntimeStatus>{await this.#ready;const row=this.#checked(identity);return {id:identity.sessionId,status:row.status,cleanupConfirmed:row.status==='closed',cleanupProofId:row.cleanupProofId};}
 /** Intentionally read-only and unserialized: Capacity calls this during acquire/release. */
 async status(input:{identity:ProjectViewRuntimeIdentity}){runtimeObject(input,['identity']);return this.#status(projectViewRuntimeIdentity(input.identity));}
 async lookup(input:{sessionId:string;actor:TurnActor;workspaceId:string}){
  runtimeObject(input,['sessionId','actor','workspaceId']);const sessionId=turnId(input.sessionId),requester=actor(input.actor),workspaceId=turnId(input.workspaceId);
  await this.#ready;const row=this.#read();if(!row||row.identity.sessionId!==sessionId||row.identity.actor.userId!==requester.userId||row.identity.scope.workspaceId!==workspaceId)return null;return structuredClone(row.identity);
 }
 async start(raw:ProjectViewRuntimeStart):Promise<ProjectViewRuntimeStatus>{
  const input=await projectViewRuntimeStart(raw),digest=await projectViewRuntimeDigest({identity:input.identity,pkg:input.pkg,view:input.view});await this.#ready;
  const prior=this.#read();
  if(prior){this.#checked(input.identity);if(prior.inputDigest!==digest)fail('input-conflict');if(this.#startWork)await this.#bounded(this.#startWork,this.#options.startupMs).catch(()=>{});return this.#status(input.identity);}
  const now=this.#now();if(input.expiresAt<=now||input.expiresAt>now+PROJECT_VIEW_SESSION_MS)fail('deadline-denied');
  const row:RecordValue={schema:'project.view-runtime-state/v1',identity:input.identity,inputDigest:digest,expiresAt:input.expiresAt,createdAt:now,lastPollAt:now,status:'starting',capacityAttempted:false,capacityReleased:false,startIssued:false,startSettled:false,closeBeganAt:null,guardUntil:null,quietSince:null,cleanupProofId:null,reason:null};
  // Reservation happens synchronously before any capacity/native side effect.
  this.#write(row);
  const work=this.#begin(input);this.#startWork=work;this.#track(work);
  try{await this.#bounded(work,this.#options.startupMs);}catch{await this.close({identity:input.identity,reason:'startup-timeout'});}
  return this.#status(input.identity);
 }
 async #begin(input:ProjectViewRuntimeStart){
  const identity=input.identity;
  try{
   await this.#storage.sync();await this.#schedule();
   await this.#change(identity,row=>{if(row.status!=='starting')fail('fenced');row.capacityAttempted=true;});
   await this.#capacity.acquire({identity,expiresAt:input.expiresAt});
   await this.#change(identity,row=>{if(row.status!=='starting'||row.expiresAt<=this.#now())fail('fenced');row.startIssued=true;});
   // No native call occurs after a close that raced the durable start intent.
   if(this.#checked(identity).status!=='starting')fail('fenced');
   let session:ProjectViewNativeSession;
   try{session=await this.#native.start(input,{beforeWrite:type=>{
    if(type==='close')return;
    const current=this.#checked(identity),now=this.#now();
    // Synchronous: no await may separate this journal check from the native
    // writer.write call. A queued init/input cannot cross close or expiry.
    if(type==='init'?(current.status!=='starting'||now>=current.createdAt+this.#options.startupMs):current.status!=='running')fail('start-fenced');
    if(now>=current.expiresAt||type!=='init'&&now>=current.lastPollAt+PROJECT_VIEW_IDLE_MS)fail('start-fenced');
   }});}
   catch(error){await this.#change(identity,row=>{row.startSettled=true;row.guardUntil=Math.max(row.guardUntil??0,this.#now()+this.#options.assignmentGuardMs);});throw error;}
   this.#session=session;
   await this.#change(identity,row=>{row.startSettled=true;if(row.status==='starting'&&row.expiresAt>this.#now()){row.status='running';row.lastPollAt=this.#now();}});
   if(this.#checked(identity).status!=='running'){await this.close({identity,reason:'late-start-fenced'});return;}
   this.#track(session.finished.then(()=>this.close({identity,reason:'browser-exited'}),()=>this.close({identity,reason:'browser-failed'})));
   await this.#schedule();
  }catch{await this.close({identity,reason:'startup-failed'}).catch(()=>{});}
 }
 async command(input:{identity:ProjectViewRuntimeIdentity;command:ProjectViewRuntimeCommand}):Promise<ProjectViewRuntimeReply>{
  runtimeObject(input,['identity','command']);const identity=projectViewRuntimeIdentity(input.identity),command=projectViewRuntimeCommand(input.command);await this.#ready;
  const row=this.#checked(identity),now=this.#now();
  if(row.status!=='running')return {closed:true,cleanupConfirmed:row.status==='closed'};
  if(now>=row.expiresAt||now>=row.lastPollAt+PROJECT_VIEW_IDLE_MS||!this.#session){await this.close({identity,reason:!this.#session?'pipe-lost':'session-expired'});return {closed:true,cleanupConfirmed:this.#checked(identity).status==='closed'};}
  if(command.type==='poll'){
   await this.#change(identity,current=>{if(current.status!=='running')fail('fenced');current.lastPollAt=this.#now();});
   await this.#schedule();if(this.#checked(identity).status!=='running')return {closed:true,cleanupConfirmed:false};return this.#session.poll();
  }
  try{await this.#bounded(this.#session.send(command));if(this.#checked(identity).status!=='running')return {closed:true,cleanupConfirmed:this.#checked(identity).status==='closed'};return {messages:[]};}
  catch{await this.close({identity,reason:'command-failed'});return {closed:true,cleanupConfirmed:this.#checked(identity).status==='closed'};}
 }
 async close(input:{identity:ProjectViewRuntimeIdentity;reason:string}){
  runtimeObject(input,['identity','reason']);const identity=projectViewRuntimeIdentity(input.identity);if(typeof input.reason!=='string'||! /^[a-z0-9-]{1,80}$/.test(input.reason))fail('reason-invalid');
  await this.#change(identity,row=>{
   if(row.status==='closed')return;
   row.status='stopping';row.reason??=input.reason;row.closeBeganAt??=this.#now();
   if(row.startIssued&&!row.startSettled)row.guardUntil=Math.max(row.guardUntil??0,row.closeBeganAt+this.#options.assignmentGuardMs);
  });
  await this.#schedule();await this.#release(identity);const row=this.#checked(identity);return {closed:true as const,cleanupConfirmed:row.status==='closed'};
 }
 async #release(identity:ProjectViewRuntimeIdentity){
  if(this.#releaseWork)return this.#releaseWork;
  const work=this.#reconcileRelease(identity);this.#releaseWork=work;
  try{await work;}finally{if(this.#releaseWork===work)this.#releaseWork=null;}
 }
 async #reconcileRelease(identity:ProjectViewRuntimeIdentity){
  let row=this.#checked(identity);
  if(row.status==='closed'){await this.#releaseCapacity(row);return;}
  if(row.status!=='stopping'&&row.status!=='unknown')return;
  let confirmed=!row.startIssued,seenRunning=false;
  if(row.startIssued){
   try{await this.#bounded(this.#session?.close()??Promise.resolve());}catch{}
   try{seenRunning=await this.#bounded(this.#native.running());}catch{}
   try{await this.#bounded(this.#native.destroy());const running=await this.#bounded(this.#native.running());if(typeof running!=='boolean')fail('release-invalid');confirmed=!running;seenRunning||=running;}catch{confirmed=false;}
  }
  const now=this.#now();
  await this.#change(identity,current=>{
   if(current.status==='closed')return;
   current.quietSince=confirmed?seenRunning||current.quietSince===null?now:current.quietSince:null;
   if(!confirmed)current.status='unknown';
  });
  row=this.#checked(identity);
  const guardComplete=row.guardUntil===null||now>=row.guardUntil&&row.quietSince!==null&&now-row.quietSince>=this.#options.quietMs;
  if(confirmed&&guardComplete){
   const proofId='view-release-'+await projectViewRuntimeDigest({identity,closeBeganAt:row.closeBeganAt,observedAt:now,guardUntil:row.guardUntil});
   await this.#change(identity,current=>{current.status='closed';current.cleanupProofId??=proofId;});
   this.#session=null;await this.#releaseCapacity(this.#checked(identity));
  }
  await this.#schedule();
 }
 async #releaseCapacity(row:RecordValue){
  if(row.status!=='closed'||!row.cleanupProofId||!row.capacityAttempted||row.capacityReleased)return;
  try{await this.#bounded(this.#capacity.release({identity:row.identity,proof:{cleanupConfirmed:true,proofId:row.cleanupProofId}}));await this.#change(row.identity,current=>{current.capacityReleased=true;});}
  catch{/* Keep the original release alarm and capacity occupied on unknown ACK. */}
  await this.#schedule();
 }
 /** A new DO instance never adopts a saved pipe/process or repeats exec(). */
 async recover(){
  if(this.#recoverWork)return this.#recoverWork;
  const work=(async()=>{await this.#ready;const row=this.#read();if(!row)return;
   if(this.#cold&&row.status!=='closed'){
    await this.#change(row.identity,current=>{
     if(current.status==='closed')return;
     current.closeBeganAt??=this.#now();current.status='stopping';current.reason??='runtime-reconstructed';
     if(current.startIssued)current.guardUntil=Math.max(current.guardUntil??0,current.closeBeganAt+this.#options.assignmentGuardMs);
    });
    await this.close({identity:row.identity,reason:'runtime-reconstructed'});
   }else if(row.status==='closed')await this.#release(row.identity);
  })();
  const tracked=work.catch(error=>{if(this.#recoverWork===tracked)this.#recoverWork=null;throw error;});
  this.#recoverWork=tracked;return tracked;
 }
 async alarm(){
  await this.recover();const row=this.#read();if(!row)return;
  if(row.status==='closed'){await this.#release(row.identity);return;}
  const now=this.#now();
  if(row.status==='stopping'||row.status==='unknown')await this.#release(row.identity);
  else if(now>=row.expiresAt||row.status==='starting'&&now>=row.createdAt+this.#options.startupMs||row.status==='running'&&now>=row.lastPollAt+PROJECT_VIEW_IDLE_MS)await this.close({identity:row.identity,reason:'session-expired'});
  await this.#schedule();
 }
}
