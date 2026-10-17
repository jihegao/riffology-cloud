import {PROJECT_VIEW_SESSION_MS,projectViewSessionIdentity,runtimeObject,type ProjectViewRuntimeIdentity,type ProjectViewRuntimeStatus} from './runtime-protocol.ts';

export type ProjectViewCapacityStorage={
 sql:{exec(query:string,...bindings:(string|number|null)[]):{toArray():unknown[]}};
 transactionSync<T>(action:()=>T):T;
 sync():Promise<void>;
};
export type ProjectViewCapacityAuthority={status(identity:ProjectViewRuntimeIdentity):Promise<ProjectViewRuntimeStatus>};
type Slot={session_id:string;operation_id:string;identity_json:string;expires_at:number;state:'occupied'|'released';proof_id:string|null;released_at:number|null};
const deny=(reason:string):never=>{throw Error('project-view-capacity-'+reason);};

/** The single browser slot is a coordination atom, separate from Pi and Runs.
 * A deadline never proves cleanup. Every admitted identity and terminal proof
 * remains durable, including when a write succeeded but its ACK was lost. */
export class SqlProjectViewCapacity{
 readonly ready:Promise<void>;
 readonly storage:ProjectViewCapacityStorage;readonly authority:ProjectViewCapacityAuthority;readonly clock:()=>number;
 #tail:Promise<unknown>=Promise.resolve();
 constructor(storage:ProjectViewCapacityStorage,authority:ProjectViewCapacityAuthority,clock=Date.now){
  this.storage=storage;this.authority=authority;this.clock=clock;
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS project_view_capacity_slots(
   session_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,identity_json TEXT NOT NULL,
   expires_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('occupied','released')),
   proof_id TEXT UNIQUE,released_at INTEGER
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS project_view_capacity_one_slot ON project_view_capacity_slots((1)) WHERE state='occupied';`);
  this.ready=storage.sync();
 }
 #serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.#tail.then(action);this.#tail=next.catch(()=>{});return next;}
 #prior(identity:ProjectViewRuntimeIdentity){
  const rows=this.storage.sql.exec('SELECT * FROM project_view_capacity_slots WHERE session_id=? OR operation_id=? LIMIT 2',identity.sessionId,identity.operationId).toArray() as Slot[];
  if(rows.some(row=>row.identity_json!==JSON.stringify(identity)))deny('identity-conflict');
  return rows[0];
 }
 async acquire(input:{identity:ProjectViewRuntimeIdentity;expiresAt:number}):Promise<void>{return this.#serial(async()=>{
  runtimeObject(input,['identity','expiresAt']);const identity=projectViewSessionIdentity(input.identity),expiresAt=input.expiresAt;
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=this.clock()||expiresAt-this.clock()>PROJECT_VIEW_SESSION_MS)deny('deadline-invalid');
  await this.ready;
  const prior=this.#prior(identity);
  if(prior?.state==='released')deny('session-terminal');
  if(prior&&prior.expires_at!==expiresAt)deny('identity-conflict');
  // Only the original runtime can attest that this exact scope/package intent
  // exists. The durable adapter derives that actor; no caller supplies a name.
  const observed=await this.authority.status(identity);
  if(observed.id!==identity.sessionId||!['starting','running'].includes(observed.status)||observed.cleanupConfirmed||observed.cleanupProofId!==null)deny('runtime-denied');
  this.storage.transactionSync(()=>{
   if(expiresAt<=this.clock())deny('deadline-invalid');
   const current=this.#prior(identity);
   if(current){if(current.state!=='occupied'||current.expires_at!==expiresAt)deny('identity-conflict');return;}
   if(this.storage.sql.exec("SELECT 1 FROM project_view_capacity_slots WHERE state='occupied' LIMIT 1").toArray().length)deny('full');
   this.storage.sql.exec("INSERT INTO project_view_capacity_slots VALUES(?,?,?,?,'occupied',NULL,NULL)",identity.sessionId,identity.operationId,JSON.stringify(identity),expiresAt);
  });
  await this.storage.sync();
 });}
 async release(input:{identity:ProjectViewRuntimeIdentity;proof:{cleanupConfirmed:true;proofId:string}}):Promise<void>{return this.#serial(async()=>{
  runtimeObject(input,['identity','proof']);runtimeObject(input.proof,['cleanupConfirmed','proofId']);
  const identity=projectViewSessionIdentity(input.identity),proof=input.proof;
  if(proof.cleanupConfirmed!==true||typeof proof.proofId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(proof.proofId))deny('proof-invalid');
  await this.ready;const prior=this.#prior(identity);
  if(prior?.state==='released'){if(prior.proof_id!==proof.proofId)deny('proof-conflict');await this.storage.sync();return;}
  const observed=await this.authority.status(identity);
  if(observed.id!==identity.sessionId||observed.status!=='closed'||observed.cleanupConfirmed!==true||observed.cleanupProofId!==proof.proofId)deny('cleanup-unconfirmed');
  this.storage.transactionSync(()=>{
   const current=this.#prior(identity);
   if(current?.state==='released'){if(current.proof_id!==proof.proofId)deny('proof-conflict');return;}
   if(this.storage.sql.exec('SELECT 1 FROM project_view_capacity_slots WHERE proof_id=? AND session_id!=? LIMIT 1',proof.proofId,identity.sessionId).toArray().length)deny('proof-reused');
   // Close can reach the authority before an in-flight acquire. Preserve a
   // terminal fence even if no slot exists, so its late acquire cannot start.
   if(!current){this.storage.sql.exec("INSERT INTO project_view_capacity_slots VALUES(?,?,?,0,'released',?,?)",identity.sessionId,identity.operationId,JSON.stringify(identity),proof.proofId,this.clock());return;}
   this.storage.sql.exec("UPDATE project_view_capacity_slots SET state='released',proof_id=?,released_at=? WHERE session_id=?",proof.proofId,this.clock(),identity.sessionId);
  });
  await this.storage.sync();
 });}
 /** Internal diagnostics only; the durable class exposes no fetch/snapshot RPC. */
 async snapshot(){await this.ready;return this.storage.sql.exec("SELECT coalesce(sum(state='occupied'),0) occupied,coalesce(sum(state='released'),0) released,count(*) records FROM project_view_capacity_slots").toArray()[0] as {occupied:number;released:number;records:number};}
}
