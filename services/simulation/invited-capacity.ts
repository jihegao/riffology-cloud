import {actor as checkedActor,type TurnActor} from '../turn/protocol.ts';
import {quotaIdentifier,leaseReference,type LeaseRequest,type LeaseReference,type Lease,type Acquisition,type StopConfirmation,type QuotaStorage} from '../quota/core.ts';
import {invitedRunsPolicy,type InvitedRunsPolicy} from './invited-policy.ts';
const pin=(policy:InvitedRunsPolicy)=>JSON.stringify(Object.fromEntries(Object.entries({...policy,enabled:false}).sort(([a],[b])=>a.localeCompare(b))));
type Row={tenant_id:string;operation_id:string;request_json:string;actor_json:string;lease_json:string|null;denial:Acquisition['denial']};
/** Private supervisor primitive. Persisted reservations span users/projects.
 * Unknown execution pauses this fixed actor until all release proofs settle and
 * an explicit operator resume occurs; changing a policy cannot erase the fence. */
export class SqlInvitedRunCapacity{
 readonly storage:QuotaStorage;readonly policy:InvitedRunsPolicy;readonly clock:()=>number;readonly ready:Promise<void>;
 constructor(storage:QuotaStorage,policy:InvitedRunsPolicy,clock=Date.now){
  this.storage=storage;this.policy=invitedRunsPolicy(policy)!;this.clock=clock;
  storage.transactionSync(()=>{storage.sql.exec(`CREATE TABLE IF NOT EXISTS invited_run_meta(singleton INTEGER PRIMARY KEY,policy_json TEXT NOT NULL,paused INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS invited_run_operations(tenant_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_json TEXT NOT NULL,actor_json TEXT NOT NULL,lease_json TEXT,denial TEXT,PRIMARY KEY(tenant_id,operation_id));CREATE TABLE IF NOT EXISTS invited_run_audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,at INTEGER NOT NULL);`);storage.sql.exec('INSERT OR IGNORE INTO invited_run_meta VALUES(1,?,0)',pin(policy));});
  this.ready=storage.sync();
 }
 #rows(){return this.storage.sql.exec<Row>('SELECT * FROM invited_run_operations').toArray();}
 #meta(){return this.storage.sql.exec<{policy_json:string;paused:number}>('SELECT * FROM invited_run_meta WHERE singleton=1').one();}
 #open(){const m=this.#meta();if(m.policy_json!==pin(this.policy))throw Error('invited-runs-policy-conflict');if(!this.policy.enabled||m.paused)throw Error('invited-runs-paused');}
 #request(input:LeaseRequest){
  if(!input||input.operation!=='simulation-run'||Object.keys(input).sort().join(',')!=='deadlineAt,generation,operation,operationId,projectId,runId,tenantId,workspaceId')throw Error('invited-runs-input-invalid');
  for(const k of ['tenantId','projectId','workspaceId','operationId','runId'] as const)quotaIdentifier(input[k]);
  if(!Number.isSafeInteger(input.generation)||input.generation<1||!Number.isSafeInteger(input.deadlineAt))throw Error('invited-runs-input-invalid');return {tenantId:input.tenantId,projectId:input.projectId,workspaceId:input.workspaceId,generation:input.generation,operation:input.operation,operationId:input.operationId,runId:input.runId,deadlineAt:input.deadlineAt};
 }
 #save(row:Row,lease:Lease){this.storage.sql.exec('UPDATE invited_run_operations SET lease_json=? WHERE tenant_id=? AND operation_id=?',JSON.stringify(lease),row.tenant_id,row.operation_id);}
 #expire(){let changed=false;for(const row of this.#rows()){if(!row.lease_json)continue;const lease=JSON.parse(row.lease_json) as Lease;if(lease.status!=='stopped'&&lease.status!=='unknown'&&this.clock()>=lease.deadlineAt+this.policy.releaseGuardMs){lease.status='unknown';lease.unknownAt=this.clock();lease.expired=true;this.#save(row,lease);changed=true;}}if(changed)this.storage.sql.exec('UPDATE invited_run_meta SET paused=1 WHERE singleton=1');return changed;}
 #find(ref:LeaseReference){const row=this.#rows().find(r=>r.tenant_id===ref.tenantId&&r.operation_id===ref.operationId),lease=row?.lease_json?JSON.parse(row.lease_json) as Lease:null;const {leaseId,...raw}=ref;quotaIdentifier(leaseId);const request=this.#request(raw);if(!row||!lease||lease.leaseId!==leaseId||row.request_json!==JSON.stringify(request))throw Error('invited-runs-lease-denied');return {row,lease};}
 async lookup(tenantId:string,operationId:string):Promise<Acquisition|null>{quotaIdentifier(tenantId);quotaIdentifier(operationId);await this.ready;const row=this.#rows().find(r=>r.tenant_id===tenantId&&r.operation_id===operationId);return row?{outcome:'replayed',lease:row.lease_json?JSON.parse(row.lease_json):null,denial:row.denial}:null;}
 async acquire(input:LeaseRequest,actor:TurnActor):Promise<Acquisition>{
  const request=this.#request(input),caller=checkedActor(actor);await this.ready;if(this.storage.transactionSync(()=>this.#expire()))await this.storage.sync();
  const result=this.storage.transactionSync(()=>{const prior=this.#rows().find(r=>r.tenant_id===request.tenantId&&r.operation_id===request.operationId);if(prior){if(prior.request_json!==JSON.stringify(request)||prior.actor_json!==JSON.stringify(caller))throw Error('invited-runs-idempotency-conflict');return {outcome:'replayed' as const,lease:prior.lease_json?JSON.parse(prior.lease_json) as Lease:null,denial:prior.denial};}
   this.#open();if(request.deadlineAt<=this.clock()||request.deadlineAt-this.clock()>this.policy.durationMs)throw Error('invited-runs-deadline-invalid');
   if(this.#rows().some(r=>r.lease_json&&JSON.parse(r.lease_json).runId===request.runId))throw Error('invited-runs-run-reused');
   const occupied=this.#rows().filter(r=>r.lease_json&&JSON.parse(r.lease_json).status!=='stopped');
   const denial:Acquisition['denial']=occupied.some(r=>JSON.parse(r.actor_json).userId===caller.userId)?'run-held':occupied.length>=this.policy.maxActiveRuns?'quota-exhausted':null;
   const lease:Lease|null=denial?null:{...request,leaseId:crypto.randomUUID(),status:'held',acquiredAt:this.clock(),dispatchedAt:null,unknownAt:null,stoppedAt:null,confirmation:null,expired:false};
   this.storage.sql.exec('INSERT INTO invited_run_operations VALUES(?,?,?,?,?,?)',request.tenantId,request.operationId,JSON.stringify(request),JSON.stringify(caller),lease?JSON.stringify(lease):null,denial);
   return {outcome:denial?'denied' as const:'acquired' as const,lease,denial};});await this.storage.sync();return result;
 }
 async owner(ref:LeaseReference){await this.ready;const {row}=this.#find(ref);return JSON.parse(row.actor_json) as TurnActor;}
 async dispatch(ref:LeaseReference){await this.ready;if(this.storage.transactionSync(()=>this.#expire()))await this.storage.sync();const result=this.storage.transactionSync(()=>{this.#open();const {row,lease}=this.#find(ref);if(lease.status!=='held')return {authorized:false,lease};lease.status='dispatched';lease.dispatchedAt=this.clock();this.#save(row,lease);return {authorized:true,lease};});await this.storage.sync();const current=this.#find(ref).lease;return {authorized:result.authorized&&current.status==='dispatched'&&this.clock()<current.deadlineAt&&!this.#meta().paused&&this.policy.enabled,lease:current};}
 async markUnknown(ref:LeaseReference){await this.ready;this.storage.transactionSync(()=>{const {row,lease}=this.#find(ref);if(lease.status==='stopped')return;lease.status='unknown';lease.unknownAt??=this.clock();this.#save(row,lease);this.storage.sql.exec('UPDATE invited_run_meta SET paused=1 WHERE singleton=1');});await this.storage.sync();}
 async confirmStopped(ref:LeaseReference,proof:StopConfirmation){await this.ready;const result=this.storage.transactionSync(()=>{const {row,lease}=this.#find(ref);if(lease.status==='stopped'){if(JSON.stringify(lease.confirmation)!==JSON.stringify(proof))throw Error('invited-runs-proof-conflict');return {released:false,lease};}
   if(!proof||Object.keys(proof).sort().join(',')!=='confirmationId,kind,observedAt'||!['never-started','runtime-stopped'].includes(proof.kind)||!Number.isSafeInteger(proof.observedAt)||proof.observedAt<lease.acquiredAt||proof.observedAt>this.clock())throw Error('invited-runs-stop-invalid');quotaIdentifier(proof.confirmationId);
   if(proof.kind==='never-started'&&lease.dispatchedAt!==null)throw Error('invited-runs-stop-invalid');
   if(this.#rows().some(r=>r.lease_json&&JSON.parse(r.lease_json).confirmation?.confirmationId===proof.confirmationId))throw Error('invited-runs-proof-reused');
   lease.status='stopped';lease.stoppedAt=this.clock();lease.confirmation=structuredClone(proof);lease.expired=false;this.#save(row,lease);return {released:true,lease};});await this.storage.sync();return result;}
 async resume(){await this.ready;this.storage.transactionSync(()=>{if(this.#rows().some(r=>r.lease_json&&JSON.parse(r.lease_json).status!=='stopped'))throw Error('invited-runs-release-unconfirmed');this.storage.sql.exec('UPDATE invited_run_meta SET paused=0 WHERE singleton=1');this.storage.sql.exec('INSERT INTO invited_run_audit(action,at) VALUES(?,?)','resume',this.clock());});await this.storage.sync();return {paused:false};}
 async snapshot(){await this.ready;this.storage.transactionSync(()=>this.#expire());await this.storage.sync();const leases=this.#rows().filter(r=>r.lease_json).map(r=>JSON.parse(r.lease_json!) as Lease),meta=this.#meta();return {schemaVersion:1,policyId:this.policy.policyId,policyReady:meta.policy_json===pin(this.policy),enabled:this.policy.enabled,paused:!!meta.paused,occupied:leases.filter(l=>l.status!=='stopped').length,unknown:leases.filter(l=>l.status==='unknown').length,limits:{maxActiveRuns:this.policy.maxActiveRuns,maxRunsPerUser:this.policy.maxRunsPerUser,maxGroupRuns:this.policy.maxGroupRuns,durationMs:this.policy.durationMs},observed:{runs:leases.length,dispatched:leases.filter(l=>l.dispatchedAt!==null).length,released:leases.filter(l=>l.status==='stopped').length,supervisedMs:leases.reduce((n,l)=>n+(l.stoppedAt!==null&&l.dispatchedAt!==null?Math.max(0,l.stoppedAt-l.dispatchedAt):0),0)},leases};}
}
