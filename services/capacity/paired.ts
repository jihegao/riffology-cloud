import {scope as checkedScope,type TurnScope} from '../turn/protocol.ts';
import type {TrustedPiAdmissionHook,TrustedPiCapacityStorage} from './core.ts';
export type PairDomain='project'|'trustedPi';
export type WorkspaceLeaseRef={scope:TurnScope;leaseId:string;leaseEpoch:number};
export type TurnBinding={sessionId:string;turnId:string;dispatchId:string;bindingEpoch:number};
export type QuiescenceProof={schemaVersion:1;domain:PairDomain;leaseId:string;leaseEpoch:number;bindingEpoch:number;status:'quiescent';remaining:0;proofId:string;observedAt:number};
export type ProjectNotStartedProof={schemaVersion:1;domain:'project';leaseId:string;leaseEpoch:number;bindingEpoch:number;status:'not-started';allocation:'never-started'|'retained-sealed';retainedProofId:string|null;proofId:string;observedAt:number};
export type PairHandoffProofs={project:QuiescenceProof|ProjectNotStartedProof;trustedPi:QuiescenceProof};
export type DomainReleaseProof={schemaVersion:1;domain:PairDomain;leaseId:string;leaseEpoch:number;kind:'never-started'|'absent';proofId:string;observedAt:number;absentSince:number|null};
export type PairLease={schemaVersion:1;ref:WorkspaceLeaseRef;requestId:string;retireReason:'queued-work'|'idle-expired'|'max-age'|'cancelled'|'gate-disabled'|'runtime-changed'|null;status:'queued'|'held'|'bound'|'idle'|'releasing'|'released'|'cancelled';requestedAt:number;acquiredAt:number|null;idleAt:number|null;boundAt:number|null;drainAt:number|null;finishedAt:number|null;binding:TurnBinding|null;startClaims:Record<PairDomain,number|null>;bindingClaims:Record<PairDomain,boolean>;handoffProofs:PairHandoffProofs|null;projectSealProofId?:string|null;releaseProofs:Partial<Record<PairDomain,DomainReleaseProof>>};
export type PairPolicy={policyVersion:string;assignmentGuardMs:number;quietMs:number;idleMs:number;maxLeaseMs:number};
export type PairSnapshot={occupied:{project:0|1;trustedPi:0|1};active:PairLease|null;queue:Array<{kind:'cold'|'pair';id:string}>;nextDue:number|null};
const domains:PairDomain[]=['project','trustedPi'],identifier=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fail=(code='paired-capacity-invalid'):never=>{throw Error(code);};
function id(value:unknown):string{if(typeof value!=='string'||!identifier.test(value))fail();return value as string;}
function integer(value:unknown,min=1):number{if(!Number.isSafeInteger(value)||(value as number)<min)fail();return value as number;}
function exact(raw:unknown,keys:string[]):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||Object.keys(raw).sort().join(',')!==[...keys].sort().join(','))fail();return raw as Record<string,unknown>;}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function ref(raw:WorkspaceLeaseRef):WorkspaceLeaseRef{exact(raw,['scope','leaseId','leaseEpoch']);return {scope:checkedScope(raw.scope),leaseId:id(raw.leaseId),leaseEpoch:integer(raw.leaseEpoch)};}
function binding(raw:TurnBinding):TurnBinding{exact(raw,['sessionId','turnId','dispatchId','bindingEpoch']);return {sessionId:id(raw.sessionId),turnId:id(raw.turnId),dispatchId:id(raw.dispatchId),bindingEpoch:integer(raw.bindingEpoch)};}
type Row=Record<string,SqlStorageValue>;
export type PairArchiveRecord=Pick<PairLease,'ref'|'requestId'|'status'>;
/** The existing immutable release records are the authority; physical idle
 * state and gate rollback are never used to infer release in this reader. */
export function readWorkspacePairArchiveResources(storage:Pick<TrustedPiCapacityStorage,'sql'>,rawScope:TurnScope,requestId?:string){
 const scope=checkedScope(rawScope);if(requestId!==undefined)id(requestId);
 const tables=new Set(storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray().map(row=>row.name));let unresolved=0,pair:PairArchiveRecord|null=null;
 const family=['paired_capacity_meta','paired_capacity_owners','paired_capacity_leases','paired_capacity_queue','paired_capacity_cancelled_requests','paired_capacity_proofs','paired_capacity_bindings'];
 if(!family.some(table=>tables.has(table)))return {scope,unresolved,quiescent:true,pair};
 if(family.some(table=>!tables.has(table)))fail('paired-capacity-archive-proof-missing');
 const meta=storage.sql.exec<Row>('SELECT policy_json FROM paired_capacity_meta WHERE singleton=1').toArray()[0];if(!meta)fail('paired-capacity-archive-proof-missing');
 const policy=exact(JSON.parse(meta!.policy_json as string),['policyVersion','assignmentGuardMs','quietMs','idleMs','maxLeaseMs']);id(policy.policyVersion);integer(policy.assignmentGuardMs,0);integer(policy.quietMs,0);integer(policy.idleMs);integer(policy.maxLeaseMs);
 for(const row of storage.sql.exec<Row>('SELECT * FROM paired_capacity_leases WHERE tenant_id=?',scope.tenantId).toArray()){
  const lease=JSON.parse(row.record_json as string)as PairLease,reference=ref(lease.ref);
  if(lease.schemaVersion!==1||reference.scope.tenantId!==row.tenant_id||reference.scope.workspaceId!==row.workspace_id||reference.leaseId!==row.lease_id||id(lease.requestId)!==row.request_id||lease.status!==row.status)fail('paired-capacity-archive-proof-invalid');
  if(reference.scope.projectId!==scope.projectId&&reference.scope.workspaceId!==scope.workspaceId)continue;
  if(reference.scope.projectId!==scope.projectId||!['queued','held','bound','idle','releasing','released','cancelled'].includes(lease.status))fail('paired-capacity-archive-scope-denied');
  if(lease.status==='released'){
   integer(lease.finishedAt);integer(lease.drainAt);binding(lease.binding!);
   for(const domain of domains){
    const p=lease.releaseProofs[domain]??fail('paired-capacity-archive-proof-missing');
    exact(p,['schemaVersion','domain','leaseId','leaseEpoch','kind','proofId','observedAt','absentSince']);
    if(p.schemaVersion!==1||p.domain!==domain||p.leaseId!==reference.leaseId||p.leaseEpoch!==reference.leaseEpoch||!['never-started','absent'].includes(p.kind)||integer(p.observedAt)>lease.finishedAt!)fail('paired-capacity-archive-proof-invalid');
    if(lease.startClaims[domain]===null){if(p.kind!=='never-started'||p.absentSince!==null||p.observedAt<lease.drainAt!)fail('paired-capacity-archive-proof-invalid');}
    else if(p.kind!=='absent'||integer(p.absentSince)<lease.drainAt!||p.observedAt-p.absentSince!<(policy.quietMs as number)||p.observedAt-lease.drainAt!<(policy.assignmentGuardMs as number))fail('paired-capacity-archive-proof-invalid');
    const saved=storage.sql.exec<Row>("SELECT proof_json FROM paired_capacity_proofs WHERE proof_id=? AND lease_id=? AND kind='release'",id(p.proofId),reference.leaseId).toArray()[0];if(!saved||!same(JSON.parse(saved.proof_json as string),p))fail('paired-capacity-archive-proof-invalid');
   }
  }else if(lease.status==='cancelled'){integer(lease.finishedAt);if(lease.binding!==null||lease.startClaims.project!==null||lease.startClaims.trustedPi!==null)fail('paired-capacity-archive-proof-invalid');}
  else unresolved++;
  if(requestId===lease.requestId&&reference.scope.workspaceId===scope.workspaceId){if(!same(reference.scope,scope))fail('paired-capacity-archive-scope-denied');pair={ref:reference,requestId:lease.requestId,status:lease.status};}
 }
 return {scope,unresolved,quiescent:unresolved===0,pair};
}
/** One logical allocator for Pi + ProjectTool slots in the existing global
 * capacity actor. No native calls; hooks execute synchronously in cold's SQL
 * transaction. Cold active tickets conservatively occupy both resources. */
export class SqlWorkspacePairedCapacity{
 readonly storage:TrustedPiCapacityStorage;readonly policy:PairPolicy;readonly clock:()=>number;readonly makeId:()=>string;readonly coldPromote:()=>void;readonly ready:Promise<void>;
 constructor(storage:TrustedPiCapacityStorage,policy:PairPolicy,coldPromote:()=>void,clock:()=>number=Date.now,makeId:()=>string=()=>crypto.randomUUID()){
  this.storage=storage;this.policy={policyVersion:id(policy.policyVersion),assignmentGuardMs:integer(policy.assignmentGuardMs,0),quietMs:integer(policy.quietMs,0),idleMs:integer(policy.idleMs),maxLeaseMs:integer(policy.maxLeaseMs)};this.clock=clock;this.makeId=makeId;this.coldPromote=coldPromote;
  storage.transactionSync(()=>{
   if(!this.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='trusted_pi_capacity_tickets'").length)fail('paired-capacity-cold-ledger-required');
   storage.sql.exec(`CREATE TABLE IF NOT EXISTS paired_capacity_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),policy_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS paired_capacity_owners(tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,generation INTEGER NOT NULL,epoch INTEGER NOT NULL,PRIMARY KEY(tenant_id,workspace_id)) STRICT;
    CREATE TABLE IF NOT EXISTS paired_capacity_leases(lease_id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,request_id TEXT NOT NULL,status TEXT NOT NULL,record_json TEXT NOT NULL,UNIQUE(tenant_id,workspace_id,request_id)) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS paired_capacity_one_active ON paired_capacity_leases((1)) WHERE status IN ('held','bound','idle','releasing');
    CREATE TABLE IF NOT EXISTS paired_capacity_queue(sequence INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL CHECK(kind IN ('cold','pair')),candidate_id TEXT NOT NULL,UNIQUE(kind,candidate_id)) STRICT;
    CREATE TABLE IF NOT EXISTS paired_capacity_cancelled_requests(tenant_id TEXT NOT NULL,workspace_id TEXT NOT NULL,request_id TEXT NOT NULL,scope_json TEXT NOT NULL,cancelled_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,workspace_id,request_id)) STRICT;
    CREATE TABLE IF NOT EXISTS paired_capacity_proofs(proof_id TEXT PRIMARY KEY,lease_id TEXT NOT NULL,kind TEXT NOT NULL,proof_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS paired_capacity_bindings(lease_id TEXT NOT NULL,epoch INTEGER NOT NULL,binding_json TEXT NOT NULL,execution_key TEXT NOT NULL UNIQUE,PRIMARY KEY(lease_id,epoch)) STRICT;`);
   const saved=this.rows('SELECT policy_json FROM paired_capacity_meta WHERE singleton=1')[0];if(saved&&!same(JSON.parse(saved.policy_json as string),this.policy))fail('paired-capacity-policy-conflict');if(!saved)storage.sql.exec('INSERT INTO paired_capacity_meta VALUES(1,?)',JSON.stringify(this.policy));
   // Existing cold FIFO is imported by identity, never rewritten or reassigned.
   for(const row of this.rows("SELECT ticket_id FROM trusted_pi_capacity_tickets WHERE status IN ('queued','held','dispatched') ORDER BY sequence"))this.registerCold(row.ticket_id as string,true);
  });this.ready=storage.sync();
 }
 rows(query:string,...args:(string|number|null)[]):Row[]{return this.storage.sql.exec<Row>(query,...args).toArray();}
 now(){return integer(this.clock());}
 assertPolicy(){const row=this.rows('SELECT policy_json FROM paired_capacity_meta WHERE singleton=1')[0];if(!row||row.policy_json!==JSON.stringify(this.policy))fail('paired-capacity-policy-conflict');}
 read(leaseId:string):PairLease{const row=this.rows('SELECT record_json FROM paired_capacity_leases WHERE lease_id=?',id(leaseId))[0];if(!row)fail('paired-capacity-not-found');return JSON.parse(row!.record_json as string)as PairLease;}
 checked(raw:WorkspaceLeaseRef){const normalized=ref(raw),lease=this.read(normalized.leaseId);if(!same(lease.ref,normalized))fail('paired-capacity-reference-denied');return lease;}
 write(lease:PairLease){this.storage.sql.exec('UPDATE paired_capacity_leases SET status=?,record_json=? WHERE lease_id=?',lease.status,JSON.stringify(lease),lease.ref.leaseId);}
 active(){const row=this.rows("SELECT record_json FROM paired_capacity_leases WHERE status IN ('held','bound','idle','releasing')")[0];return row?JSON.parse(row.record_json as string)as PairLease:null;}
 coldActive(){return this.rows("SELECT ticket_id FROM trusted_pi_capacity_tickets WHERE status IN ('held','dispatched')").length>0;}
 queue(){return this.rows(`SELECT q.kind,q.candidate_id FROM paired_capacity_queue q WHERE (q.kind='cold' AND EXISTS(SELECT 1 FROM trusted_pi_capacity_tickets c WHERE c.ticket_id=q.candidate_id AND c.status='queued')) OR (q.kind='pair' AND EXISTS(SELECT 1 FROM paired_capacity_leases p WHERE p.lease_id=q.candidate_id AND p.status='queued')) ORDER BY q.sequence`).map(r=>({kind:r.kind as 'cold'|'pair',id:r.candidate_id as string}));}
 owner(scope:TurnScope){const owner=this.rows('SELECT * FROM paired_capacity_owners WHERE tenant_id=? AND workspace_id=?',scope.tenantId,scope.workspaceId)[0],cold=this.rows('SELECT * FROM trusted_pi_capacity_workspaces WHERE tenant_id=? AND workspace_id=?',scope.tenantId,scope.workspaceId)[0];for(const record of [owner,cold])if(record){if(record.project_id!==scope.projectId)fail('paired-capacity-owner-conflict');if(scope.workspaceGeneration<(record.generation as number))fail('paired-capacity-stale-generation');}return owner;}
 registerCold(ticketId:string,bootstrap=false){const row=this.rows('SELECT * FROM trusted_pi_capacity_tickets WHERE ticket_id=?',ticketId)[0];if(!row)fail('paired-capacity-cold-reference-denied');const scope={tenantId:row!.tenant_id as string,projectId:row!.project_id as string,workspaceId:row!.workspace_id as string,workspaceGeneration:row!.generation as number};if(!bootstrap)this.owner(scope);this.storage.sql.exec('INSERT INTO paired_capacity_owners VALUES(?,?,?,?,0) ON CONFLICT(tenant_id,workspace_id) DO UPDATE SET generation=MAX(generation,excluded.generation)',scope.tenantId,scope.workspaceId,scope.projectId,scope.workspaceGeneration);this.storage.sql.exec("INSERT OR IGNORE INTO paired_capacity_queue(kind,candidate_id) VALUES('cold',?)",ticketId);}
 /** Install these hooks on cold before exposing either ledger through RPC. */
 admissionHook():TrustedPiAdmissionHook{return {enqueued:(ticketId,_at)=>{this.assertPolicy();this.registerCold(ticketId);},beforePromote:()=>{this.assertPolicy();this.promotePair();},canPromote:ticketId=>{this.assertPolicy();return !this.active()&&!this.coldActive()&&this.queue()[0]?.kind==='cold'&&this.queue()[0]?.id===ticketId;}};}
 promotePair(){const active=this.active();if(active&&['idle','bound'].includes(active.status)&&this.queue().length){active.retireReason??='queued-work';if(active.status==='idle')this.drain(active);else this.write(active);}if(this.active()||this.coldActive())return;const first=this.queue()[0];if(first?.kind!=='pair')return;const lease=this.read(first.id);lease.status='held';lease.acquiredAt=this.now();this.write(lease);}
 promote(){this.promotePair();if(!this.active()&&!this.coldActive()&&this.queue()[0]?.kind==='cold')this.coldPromote();}
 async transaction<T>(fn:()=>T):Promise<T>{await this.ready;const result=this.storage.transactionSync(()=>{this.assertPolicy();return fn();});await this.storage.sync();return structuredClone(result);}
 async requestPair(rawScope:TurnScope,requestId:string){const scope=checkedScope(rawScope);id(requestId);return this.transaction(()=>{const prior=this.rows('SELECT record_json FROM paired_capacity_leases WHERE tenant_id=? AND workspace_id=? AND request_id=?',scope.tenantId,scope.workspaceId,requestId)[0];if(prior){const lease=JSON.parse(prior.record_json as string)as PairLease;if(!same(lease.ref.scope,scope))fail('paired-capacity-idempotency-conflict');return lease;}
  if(this.rows('SELECT 1 FROM paired_capacity_cancelled_requests WHERE tenant_id=? AND workspace_id=? AND request_id=?',scope.tenantId,scope.workspaceId,requestId).length)fail('paired-capacity-request-cancelled');
  const owner=this.owner(scope);if(this.rows("SELECT 1 FROM paired_capacity_leases WHERE tenant_id=? AND workspace_id=? AND status NOT IN ('released','cancelled')",scope.tenantId,scope.workspaceId).length)fail('paired-capacity-workspace-held');
  const epoch=integer((owner?.epoch as number||0)+1),lease:PairLease={schemaVersion:1,ref:{scope,leaseId:id(this.makeId()),leaseEpoch:epoch},requestId,retireReason:null,status:'queued',requestedAt:this.now(),acquiredAt:null,idleAt:null,boundAt:null,drainAt:null,finishedAt:null,binding:null,startClaims:{project:null,trustedPi:null},bindingClaims:{project:false,trustedPi:false},handoffProofs:null,releaseProofs:{}};
  this.storage.sql.exec('INSERT INTO paired_capacity_owners VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,workspace_id) DO UPDATE SET generation=excluded.generation,epoch=excluded.epoch',scope.tenantId,scope.workspaceId,scope.projectId,scope.workspaceGeneration,epoch);this.storage.sql.exec('INSERT INTO paired_capacity_leases VALUES(?,?,?,?,?,?)',lease.ref.leaseId,scope.tenantId,scope.workspaceId,requestId,lease.status,JSON.stringify(lease));this.storage.sql.exec("INSERT INTO paired_capacity_queue(kind,candidate_id) VALUES('pair',?)",lease.ref.leaseId);this.promote();return this.read(lease.ref.leaseId);
 });}
 async cancelPairRequest(rawScope:TurnScope,requestId:string){const scope=checkedScope(rawScope);id(requestId);return this.transaction(()=>{this.owner(scope);const prior=this.rows('SELECT scope_json,cancelled_at FROM paired_capacity_cancelled_requests WHERE tenant_id=? AND workspace_id=? AND request_id=?',scope.tenantId,scope.workspaceId,requestId)[0];if(prior&&prior.scope_json!==JSON.stringify(scope))fail('paired-capacity-idempotency-conflict');const row=this.rows('SELECT record_json FROM paired_capacity_leases WHERE tenant_id=? AND workspace_id=? AND request_id=?',scope.tenantId,scope.workspaceId,requestId)[0],lease:PairLease|null=row?JSON.parse(row.record_json as string):null;if(lease&&(!same(lease.ref.scope,scope)||lease.binding!==null))fail('paired-capacity-request-bound');const cancelledAt=prior?.cancelled_at as number??this.now();this.storage.sql.exec('INSERT OR IGNORE INTO paired_capacity_cancelled_requests VALUES(?,?,?,?,?)',scope.tenantId,scope.workspaceId,requestId,JSON.stringify(scope),cancelledAt);if(lease){lease.retireReason='cancelled';this.drain(lease);this.promote();}return {lease:lease?this.read(lease.ref.leaseId):null,cancelledAt};});}
 async lookupPair(rawScope:TurnScope,requestId:string){const scope=checkedScope(rawScope);id(requestId);return this.transaction(()=>{const row=this.rows('SELECT record_json FROM paired_capacity_leases WHERE tenant_id=? AND workspace_id=? AND request_id=?',scope.tenantId,scope.workspaceId,requestId)[0];if(!row)return null;const lease=JSON.parse(row.record_json as string)as PairLease;if(!same(lease.ref.scope,scope))fail('paired-capacity-idempotency-conflict');return lease;});}
 due(lease:PairLease){if(lease.acquiredAt===null)return null;return Math.min(lease.acquiredAt+this.policy.maxLeaseMs,lease.status==='idle'&&lease.idleAt!==null?lease.idleAt+this.policy.idleMs:Infinity);}
 drain(lease:PairLease){if(['released','cancelled','releasing'].includes(lease.status))return;if(lease.binding===null){lease.status='cancelled';lease.finishedAt=this.now();}else{lease.status='releasing';lease.drainAt=this.now();}this.write(lease);}
 async bind(rawRef:WorkspaceLeaseRef,rawBinding:TurnBinding){const expected=binding(rawBinding);return this.transaction(()=>{const lease=this.checked(rawRef);this.owner(lease.ref.scope);const executionKey=JSON.stringify({scope:lease.ref.scope,dispatchId:expected.dispatchId});const prior=this.rows('SELECT * FROM paired_capacity_bindings WHERE execution_key=?',executionKey)[0];if(prior){if(prior.lease_id!==lease.ref.leaseId||prior.binding_json!==JSON.stringify(expected)||!same(lease.binding,expected))fail('paired-capacity-execution-replayed');return lease;}
  if(!['held','idle'].includes(lease.status))fail('paired-capacity-not-bindable');if((this.due(lease)??Infinity)<=this.now()||(lease.status==='idle'&&this.queue().length)){lease.retireReason??=this.queue().length?'queued-work':lease.acquiredAt!==null&&this.now()>=lease.acquiredAt+this.policy.maxLeaseMs?'max-age':'idle-expired';this.drain(lease);this.promote();return lease;}
  if(expected.bindingEpoch!==(lease.binding?.bindingEpoch??0)+1)fail('paired-capacity-stale-binding');if(this.rows('SELECT 1 FROM paired_capacity_bindings WHERE lease_id=? AND binding_json=?',lease.ref.leaseId,JSON.stringify(expected)).length)fail('paired-capacity-stale-binding');
  this.storage.sql.exec('INSERT INTO paired_capacity_bindings VALUES(?,?,?,?)',lease.ref.leaseId,expected.bindingEpoch,JSON.stringify(expected),executionKey);lease.binding=expected;lease.bindingClaims={project:false,trustedPi:false};lease.handoffProofs=null;lease.status='bound';lease.idleAt=null;lease.boundAt=this.now();this.write(lease);return lease;
 });}
 async claimNativeStart(rawRef:WorkspaceLeaseRef,rawBinding:TurnBinding,domain:PairDomain){if(!domains.includes(domain))fail();const expected=binding(rawBinding);return this.transaction(()=>{const lease=this.checked(rawRef);this.owner(lease.ref.scope);if(lease.status!=='bound'||!same(lease.binding,expected))fail('paired-capacity-stale-binding');const authorized=!lease.bindingClaims[domain];if(authorized){lease.bindingClaims[domain]=true;if(domain==='project')lease.projectSealProofId=null;lease.startClaims[domain]??=this.now();this.write(lease);}return {authorized,lease};});}
 proof(lease:PairLease,raw:QuiescenceProof|ProjectNotStartedProof|DomainReleaseProof,kind:'handoff'|'release'){
  exact(raw,kind==='handoff'&&'status' in raw&&raw.status==='not-started'?['schemaVersion','domain','leaseId','leaseEpoch','bindingEpoch','status','allocation','retainedProofId','proofId','observedAt']:kind==='handoff'?['schemaVersion','domain','leaseId','leaseEpoch','bindingEpoch','status','remaining','proofId','observedAt']:['schemaVersion','domain','leaseId','leaseEpoch','kind','proofId','observedAt','absentSince']);
  if(raw.schemaVersion!==1||!domains.includes(raw.domain)||raw.leaseId!==lease.ref.leaseId||raw.leaseEpoch!==lease.ref.leaseEpoch||integer(raw.observedAt)<lease.requestedAt||raw.observedAt>this.now())fail('paired-capacity-proof-denied');id(raw.proofId);
  const prior=this.rows('SELECT * FROM paired_capacity_proofs WHERE proof_id=?',raw.proofId)[0];if(prior&&(prior.lease_id!==lease.ref.leaseId||prior.kind!==kind||prior.proof_json!==JSON.stringify(raw)))fail('paired-capacity-proof-conflict');
 }
 saveProof(lease:PairLease,proof:QuiescenceProof|ProjectNotStartedProof|DomainReleaseProof,kind:string){this.storage.sql.exec('INSERT OR IGNORE INTO paired_capacity_proofs VALUES(?,?,?,?)',proof.proofId,lease.ref.leaseId,kind,JSON.stringify(proof));}
 async confirmHandoff(rawRef:WorkspaceLeaseRef,rawBinding:TurnBinding,proofs:PairHandoffProofs){exact(proofs,domains);const expected=binding(rawBinding);return this.transaction(()=>{const lease=this.checked(rawRef);if(!same(lease.binding,expected))fail('paired-capacity-stale-binding');if(lease.handoffProofs){if(!same(lease.handoffProofs,proofs))fail('paired-capacity-proof-conflict');return lease;}if(lease.status!=='bound')fail('paired-capacity-not-bindable');
  for(const domain of domains){const p=proofs[domain];this.proof(lease,p,'handoff');if(p.domain!==domain||p.bindingEpoch!==expected.bindingEpoch||p.observedAt<lease.boundAt!)fail('paired-capacity-proof-denied');
   if(p.status==='not-started'){
    if(domain!=='project'||lease.bindingClaims.project)fail('paired-capacity-proof-denied');
    if(p.allocation==='never-started'){if(lease.startClaims.project!==null||p.retainedProofId!==null)fail('paired-capacity-proof-denied');}
    else if(p.allocation==='retained-sealed'){
     if(lease.startClaims.project===null||!lease.projectSealProofId||p.retainedProofId!==lease.projectSealProofId)fail('paired-capacity-proof-denied');
     const saved=this.rows("SELECT proof_json FROM paired_capacity_proofs WHERE proof_id=? AND lease_id=? AND kind='handoff'",id(p.retainedProofId),lease.ref.leaseId)[0],seal=saved?JSON.parse(saved.proof_json as string):null;
     if(!seal||seal.domain!=='project'||seal.status!=='quiescent'||seal.remaining!==0||seal.bindingEpoch>=expected.bindingEpoch)fail('paired-capacity-proof-denied');
    }else fail('paired-capacity-proof-denied');
   }else{if(p.status!=='quiescent'||p.remaining!==0)fail('paired-capacity-proof-denied');if(domain==='project')lease.projectSealProofId=p.proofId;}
   this.saveProof(lease,p,'handoff');}
  lease.handoffProofs=structuredClone(proofs);lease.status='idle';lease.idleAt=this.now();if(lease.retireReason||this.queue().length||(this.due(lease)??Infinity)<=this.now()){lease.retireReason??=this.queue().length?'queued-work':'max-age';this.drain(lease);}else this.write(lease);return lease;
 });}
 async retirePair(rawRef:WorkspaceLeaseRef,reason:'gate-disabled'|'runtime-changed'){if(!['gate-disabled','runtime-changed'].includes(reason))fail();return this.transaction(()=>{const lease=this.checked(rawRef);if(['released','cancelled','releasing'].includes(lease.status))return lease;lease.retireReason??=reason;if(lease.status==='bound')this.write(lease);else this.drain(lease);this.promote();return lease;});}
 async cancelPair(rawRef:WorkspaceLeaseRef){return this.transaction(()=>{const lease=this.checked(rawRef);if(!['released','cancelled','releasing'].includes(lease.status))lease.retireReason='cancelled';this.drain(lease);this.promote();return lease;});}
 async confirmPairReleased(rawRef:WorkspaceLeaseRef,proofs:Partial<Record<PairDomain,DomainReleaseProof>>){if(!proofs||typeof proofs!=='object'||Array.isArray(proofs)||Object.keys(proofs).some(k=>!domains.includes(k as PairDomain))||!Object.keys(proofs).length)fail();return this.transaction(()=>{const lease=this.checked(rawRef);if(!['releasing','released'].includes(lease.status))fail('paired-capacity-release-not-pending');
  for(const domain of domains){const p=proofs[domain];if(!p)continue;this.proof(lease,p,'release');if(p.domain!==domain)fail('paired-capacity-proof-denied');const existing=lease.releaseProofs[domain];if(existing){if(!same(existing,p))fail('paired-capacity-proof-conflict');continue;}
   if(lease.startClaims[domain]===null){if(p.kind!=='never-started'||p.absentSince!==null||p.observedAt<lease.drainAt!)fail('paired-capacity-never-started-denied');}else if(p.kind!=='absent'||p.absentSince===null||integer(p.absentSince)<lease.drainAt!||p.observedAt-p.absentSince<this.policy.quietMs||p.observedAt-lease.drainAt!<this.policy.assignmentGuardMs)fail('paired-capacity-release-unconfirmed');
   this.saveProof(lease,p,'release');lease.releaseProofs[domain]=structuredClone(p);
  }
  if(domains.every(d=>lease.releaseProofs[d])){lease.status='released';lease.finishedAt??=this.now();}this.write(lease);this.promote();return lease;
 });}
 async maintain(){return this.transaction(()=>{const lease=this.active();if(lease&&lease.status!=='releasing'&&((this.due(lease)??Infinity)<=this.now()||(lease.status==='idle'&&this.queue().length))){lease.retireReason??=lease.acquiredAt!==null&&this.now()>=lease.acquiredAt+this.policy.maxLeaseMs?'max-age':this.queue().length?'queued-work':'idle-expired';if(lease.status==='bound')this.write(lease);else this.drain(lease);}this.promote();return this.view();});}
 view():PairSnapshot{const active=this.active(),occupied=!!active||this.coldActive();return {occupied:{project:occupied?1:0,trustedPi:occupied?1:0},active,queue:this.queue(),nextDue:active?(active.status==='releasing'?active.drainAt:active.status==='bound'&&active.retireReason?null:this.due(active)):null};}
 async snapshot(){return this.transaction(()=>this.view());}
}
