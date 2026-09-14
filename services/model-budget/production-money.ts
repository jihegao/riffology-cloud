import { actor, sha, turnDigest } from '../turn/protocol.ts';
import { turnRuntimeIdentity } from '../turn-runtime/identity.ts';
import type { ModelCallRequest, ModelBudgetStorage } from './core.ts';
import { conservativeCost, moneyInteger, productionProfile, profileDigest, type ProductionProfile } from '../model-proxy/production-profile.ts';

export const PRODUCTION_MONEY_ACTOR = 'production-money-global-v1';
export type MoneyPolicy = { version: string; period: string; enabled: boolean; profileSha256: string; caps: { turn: number; user: number; tenant: number; global: number } };
export type MoneyReservation = { request: ModelCallRequest; profile: ProductionProfile };
export type MoneyRecord = { key: string; digest: string; period: string; policyVersion: string; tenantId: string; userId: string; turnKey: string; request: ModelCallRequest; profile: ProductionProfile; profileSha256: string; reserved: number; accounted: number; state: 'reserved'|'dispatched'|'unknown'|'recorded'|'released'; acceptedAt: number; updatedAt: number; terminal: null | { inputTokens: number; outputTokens: number; providerRequestId: string; evidence: 'provider-usage-conservative-price' }; errorCategory: string|null; releaseProof: NoDispatchProof|null };
export type NoDispatchProof = { confirmationId: string; kind: 'token-fence-denied-before-provider'; tokenReservationId: string; observedAt: number };
export type MoneyReference = { key: string; digest: string };
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/;
function id(value: unknown): string { if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw Error('invalid-production-money-identity'); return value; }
function policy(value: MoneyPolicy): MoneyPolicy {
  if (!value || typeof value.enabled !== 'boolean') throw Error('invalid-production-money-policy');
  return {version:id(value.version),period:id(value.period),enabled:value.enabled,profileSha256:sha(value.profileSha256),caps:{turn:moneyInteger(value.caps.turn,1),user:moneyInteger(value.caps.user,1),tenant:moneyInteger(value.caps.tenant,1),global:moneyInteger(value.caps.global,1)}};
}
export const moneyReference = (record: MoneyRecord): MoneyReference => ({key:record.key,digest:record.digest});
/** One private SQLite actor serializes all four caps. Outstanding reservations
 * count in every period; recorded conservative charges count in their original
 * period. No alarm or deadline ever releases an uncertain upstream charge. */
export class ProductionMoneyLedger {
  readonly #storage: ModelBudgetStorage; readonly #policy: MoneyPolicy; readonly #now: () => number;
  constructor(storage: ModelBudgetStorage, configured: MoneyPolicy, now = Date.now) {
    this.#storage=storage; this.#policy=policy(configured); this.#now=now;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS production_money_calls (key TEXT PRIMARY KEY, digest TEXT NOT NULL, period TEXT NOT NULL, tenant TEXT NOT NULL, user TEXT NOT NULL, turn_key TEXT NOT NULL, state TEXT NOT NULL, accounted INTEGER NOT NULL, record TEXT NOT NULL)`);
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS production_money_policies (version TEXT PRIMARY KEY, document TEXT NOT NULL)`);
  }
  #read(key: string): MoneyRecord|null {
    const rows=this.#storage.sql.exec<{record:string}>('SELECT record FROM production_money_calls WHERE key=?',sha(key)).toArray();
    return rows[0] ? JSON.parse(rows[0].record) as MoneyRecord : null;
  }
  #save(record: MoneyRecord): void {
    this.#storage.sql.exec('INSERT INTO production_money_calls (key,digest,period,tenant,user,turn_key,state,accounted,record) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET state=excluded.state,accounted=excluded.accounted,record=excluded.record',record.key,record.digest,record.period,record.tenantId,record.userId,record.turnKey,record.state,record.accounted,JSON.stringify(record));
  }
  #reference(reference: MoneyReference): MoneyRecord { const row=this.#read(reference.key); if(!row || row.digest!==sha(reference.digest)) throw Error('production-money-reference-conflict'); return row; }
  #admit():void {
    if(!this.#policy.enabled) throw Error('production-provider-stopped');
    // Reusing a version with a changed cap/period/route fails closed. Stop is
    // deliberately excluded: it can change immediately without a policy edit.
    const document=JSON.stringify({...this.#policy,enabled:undefined});
    const prior=this.#storage.sql.exec<{document:string}>('SELECT document FROM production_money_policies WHERE version=?',this.#policy.version).toArray()[0];
    if(prior && prior.document!==document) throw Error('production-money-policy-conflict');
    if(!prior)this.#storage.sql.exec('INSERT INTO production_money_policies VALUES (?,?)',this.#policy.version,document);
  }
  /** Explicit, persisted-RPC rejection response. Transport failures stay throws. */
  async admit(value:MoneyReservation):Promise<{accepted:true;record:MoneyRecord;replayed:boolean}|{accepted:false;reason:string}>{
    try{return {accepted:true,...await this.reserve(value)};}catch(error){
      const reason=error instanceof Error?error.message:'';
      if(['production-money-cap-exceeded','production-money-profile-denied','production-provider-stopped','production-money-policy-conflict','production-money-call-conflict'].includes(reason))return {accepted:false,reason};
      throw error;
    }
  }
  async reserve(value: MoneyReservation): Promise<{record:MoneyRecord;replayed:boolean}> {
    const p=productionProfile(value.profile), profileSha256=await profileDigest(p), r=value.request;
    const identity=turnRuntimeIdentity(r.identity), attributed=actor(r.actor);
    if(r.schemaVersion!==1 || r.provider!=='openai' || r.model!==p.model || r.deadlineAt<=this.#now())throw Error('production-money-request-denied');
    const request:ModelCallRequest={schemaVersion:1,identity,actor:attributed,callId:id(r.callId),requestId:id(r.requestId),deadlineAt:moneyInteger(r.deadlineAt,1),provider:'openai',model:p.model,payloadSha256:sha(r.payloadSha256),inputTokenUpperBound:moneyInteger(r.inputTokenUpperBound,1),maxOutputTokens:moneyInteger(r.maxOutputTokens,16),inputBoundVersion:id(r.inputBoundVersion),budgetPolicyVersion:id(r.budgetPolicyVersion)};
    const stable={scope:identity.scope,sessionId:identity.sessionId,turnId:identity.turnId,generation:identity.generation};
    const turnKey=await turnDigest({purpose:'production-money-turn',...stable}), key=await turnDigest({purpose:'production-money-call',...stable,callId:request.callId});
    const digest=await turnDigest({purpose:'production-money-reservation',request,profileSha256}), reserved=conservativeCost(p,request.inputTokenUpperBound,request.maxOutputTokens);
    const result=this.#storage.transactionSync(()=>{
      const prior=this.#read(key); if(prior){if(prior.digest!==digest)throw Error('production-money-call-conflict');return {record:prior,replayed:true};}
      this.#admit();if(profileSha256!==this.#policy.profileSha256)throw Error('production-money-profile-denied');
      const dimensions:[string,string[],number,boolean][]=[['',[],this.#policy.caps.global,false],[' AND tenant=?',[identity.scope.tenantId],this.#policy.caps.tenant,false],[' AND user=?',[attributed.userId],this.#policy.caps.user,false],[' AND turn_key=?',[turnKey],this.#policy.caps.turn,true]];
      for(const [filter,args,cap,lifetime] of dimensions){
        // BigInt accumulation prevents SQL SUM overflow even near safe-integer
        // caps. Each persisted integer is independently validated on writes.
        let occupied=0n;for(const row of this.#storage.sql.exec<{accounted:number}>(`SELECT accounted FROM production_money_calls WHERE state!='released'${lifetime?'':" AND (state!='recorded' OR period=?)"}${filter}`,...(lifetime?[]:[this.#policy.period]),...args))occupied+=BigInt(row.accounted);
        if(occupied+BigInt(reserved)>BigInt(cap))throw Error('production-money-cap-exceeded');
      }
      const at=moneyInteger(this.#now(),1),record:MoneyRecord={key,digest,period:this.#policy.period,policyVersion:this.#policy.version,tenantId:identity.scope.tenantId,userId:attributed.userId,turnKey,request,profile:p,profileSha256,reserved,accounted:reserved,state:'reserved',acceptedAt:at,updatedAt:at,terminal:null,errorCategory:null,releaseProof:null};this.#save(record);return {record,replayed:false};
    });await this.#storage.sync();return result;
  }
  async dispatch(reference:MoneyReference):Promise<{authorized:boolean;record:MoneyRecord}>{
    const result=this.#storage.transactionSync(()=>{const record=this.#reference(reference);if(record.state!=='reserved')return {authorized:false,record};this.#admit();if(record.profileSha256!==this.#policy.profileSha256)throw Error('production-money-route-changed');if(record.request.deadlineAt<=this.#now())throw Error('production-money-deadline');record.state='dispatched';record.updatedAt=this.#now();this.#save(record);return {authorized:true,record};});await this.#storage.sync();return result;
  }
  async markUnknown(reference:MoneyReference,category:string):Promise<MoneyRecord>{
    const record=this.#storage.transactionSync(()=>{const r=this.#reference(reference);if(r.state==='dispatched'||r.state==='unknown'){r.state='unknown';r.errorCategory=id(category);r.updatedAt=this.#now();this.#save(r);}return r;});await this.#storage.sync();return record;
  }
  async finish(reference:MoneyReference,terminal:NonNullable<MoneyRecord['terminal']>):Promise<MoneyRecord>{
    if(terminal.evidence!=='provider-usage-conservative-price'||typeof terminal.providerRequestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(terminal.providerRequestId))throw Error('invalid-production-money-evidence');
    const evidence={inputTokens:moneyInteger(terminal.inputTokens),outputTokens:moneyInteger(terminal.outputTokens),providerRequestId:terminal.providerRequestId,evidence:'provider-usage-conservative-price' as const};
    const record=this.#storage.transactionSync(()=>{const r=this.#reference(reference);if(r.state==='recorded'){if(JSON.stringify(r.terminal)!==JSON.stringify(evidence))throw Error('production-money-terminal-conflict');return r;}if(r.state!=='dispatched'&&r.state!=='unknown')throw Error('production-money-not-dispatched');if(evidence.inputTokens>r.request.inputTokenUpperBound||evidence.outputTokens>r.request.maxOutputTokens)throw Error('production-money-usage-bound');r.accounted=conservativeCost(r.profile,evidence.inputTokens,evidence.outputTokens);r.terminal=evidence;r.state='recorded';r.updatedAt=this.#now();r.errorCategory=null;this.#save(r);return r;});await this.#storage.sync();return record;
  }
  /** Private proxy proof, only after an explicit token fence denied dispatch.
   * A thrown RPC / lost ACK is never such proof. The money fence ensures only
   * that original handler can reach this branch; replays are observe-only. */
  async releaseUndispatched(reference:MoneyReference,proof:NoDispatchProof):Promise<MoneyRecord>{
    if(proof.kind!=='token-fence-denied-before-provider')throw Error('invalid-production-release-proof');
    const normalized:NoDispatchProof={confirmationId:id(proof.confirmationId),kind:proof.kind,tokenReservationId:id(proof.tokenReservationId),observedAt:moneyInteger(proof.observedAt,1)};
    const record=this.#storage.transactionSync(()=>{const r=this.#reference(reference);if(r.state==='released'){if(JSON.stringify(r.releaseProof)!==JSON.stringify(normalized))throw Error('production-money-release-conflict');return r;}if(r.state!=='dispatched')throw Error('production-money-release-denied');r.state='released';r.accounted=0;r.releaseProof=normalized;r.updatedAt=this.#now();this.#save(r);return r;});await this.#storage.sync();return record;
  }
  async lookup(reference:MoneyReference):Promise<MoneyRecord>{return this.#reference(reference);}
}
