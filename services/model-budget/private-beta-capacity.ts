import {DurableObject} from 'cloudflare:workers';
import {privateBetaReleaseDeadline} from './private-beta-release.ts';
import {privateBetaPolicy,privateBetaPolicyGates,assertPrivateBetaHistoricalIsolation,authorizePrivateBeta,PRIVATE_BETA_CAPACITY_ACTOR,type PrivateBetaPolicy,type PrivateBetaHistoricalLedger} from './private-beta-policy.ts';
import {scope as checkedScope,turnDigest,turnId,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {modelCallRequest,modelBudgetCallKey,type ModelCallRequest,type ModelCallRecord,modelBudgetTenantName} from './core.ts';
import {productionProfile,profileDigest,conservativeCost} from '../model-proxy/production-profile.ts';
import {trustedPiCapacityActorName} from '../capacity/client.ts';
import {betaMaintenanceInput,betaMaintenanceState,betaMaintenanceHeld,betaMaintenanceBarrier,beginBetaMaintenance,endBetaMaintenance,betaMaintenanceEndReplay,type BetaMaintenanceInput,type BetaMaintenanceControl} from './private-beta-maintenance.ts';

async function bounded<T>(operation:Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('private-beta-authority-timeout')),5000);})]);}
  finally{clearTimeout(timer);}
}

type Admission={scope:TurnScope;actor:TurnActor;sessionId:string;requestKey:string};
type Slot={key:string;user_id:string;document:string;created_at:number;turn_id:string|null;status:string};
interface Env {
  PRIVATE_BETA_POLICY_JSON?:string; PRODUCTION_MODEL_PROFILE_JSON:string; CATALOG:D1Database;
  PRIVATE_BETA_CAPACITY:DurableObjectNamespace<PrivateBetaCapacity>;
  TRUSTED_PI_CAPACITY?:{getByName(name:string):{maintenanceQuiescence():Promise<{actor:string;policyVersion:string;quiescent:boolean;coldUnresolved:number;pairUnresolved:number;actualContainerReleaseVerified:false}>}};
  TRUSTED_PI_CAPACITY_POLICY_VERSION?:string;
  TENANT_MODEL_BUDGET?:PrivateBetaHistoricalLedger;G5_TOKEN_BUDGET?:PrivateBetaHistoricalLedger;
  PI_DEVELOPER_BUDGET:{getByName(name:string):{privateBetaCall(identity:ModelCallRequest['identity'],callId:string):Promise<ModelCallRecord|null>}};
  WORKSPACE_AGENT:{getByName(name:string):{
    privateBetaReleaseState(input:Admission):Promise<{found:boolean;turnId:string|null;terminal:boolean;released:boolean;resourceWait:boolean;finishedAt:number|null;releaseGuard?:boolean;rejectedSession?:boolean;withdrawn?:boolean}>;
    cancelTurn(input:{scope:TurnScope;actor:TurnActor;turnId:string}):Promise<unknown>;
  }};
}

/** Coordination atom: the small Beta capacity pool only. Model records and
 * execution remain in per-tenant/per-workspace actors. Nothing dispatches here. */
export class PrivateBetaCapacity extends DurableObject<Env> {
  #tail:Promise<unknown>=Promise.resolve();
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS beta_policy(singleton INTEGER PRIMARY KEY, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS beta_slots(key TEXT PRIMARY KEY,user_id TEXT NOT NULL,document TEXT NOT NULL,created_at INTEGER NOT NULL,turn_id TEXT,status TEXT NOT NULL) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS beta_user_active ON beta_slots(user_id) WHERE status!='released';
      CREATE TABLE IF NOT EXISTS beta_calls(key TEXT PRIMARY KEY,slot_key TEXT NOT NULL,user_id TEXT NOT NULL,day TEXT NOT NULL,document TEXT NOT NULL,cost INTEGER NOT NULL,status TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS beta_operations(id INTEGER PRIMARY KEY, action TEXT NOT NULL, actor_json TEXT, at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS beta_alerts(key TEXT PRIMARY KEY,at INTEGER NOT NULL,code TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS beta_policy_migrations(from_digest TEXT PRIMARY KEY,to_digest TEXT NOT NULL,previous_document TEXT NOT NULL,next_document TEXT NOT NULL,ledger_digest TEXT NOT NULL,at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS beta_call_metering(call_key TEXT PRIMARY KEY,accepted_at INTEGER,billing_pending_at INTEGER) STRICT;`);
  }
  #serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.#tail.then(action);this.#tail=next.catch(()=>{});return next;}
  #slots(){return this.ctx.storage.sql.exec<Slot>("SELECT * FROM beta_slots WHERE status!='released'").toArray();}
  #policy(requireOpen=true){
    if(!this.env.PRIVATE_BETA_CAPACITY.idFromName(PRIVATE_BETA_CAPACITY_ACTOR).equals(this.ctx.id))throw Error('private-beta-actor-denied');
    const p=privateBetaPolicy(this.env.PRIVATE_BETA_POLICY_JSON);
    if(!p)throw Error('private-beta-unconfigured');
    if(requireOpen&&(this.ctx.storage.kv.get('beta-paused')===true||!p.enabled||Date.now()<p.startsAt||Date.now()>=p.reviewAt))throw Error('private-beta-paused');
    return p;
  }
  async #pin(p:PrivateBetaPolicy){
    // Kill switch is mutable; limits, epoch, price and identity policy are pinned.
    const digest=await turnDigest({...p,enabled:false});
    const prior=this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0];
    if(!prior&&p.schemaVersion===2)throw Error('private-beta-policy-unpinned');
    if(prior&&prior.digest!==digest)throw Error('private-beta-policy-conflict');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO beta_policy VALUES(1,?)',digest);
    await this.ctx.storage.sync();
  }
  async #assertPinned(p:PrivateBetaPolicy){
    const digest=await turnDigest({...p,enabled:false}),prior=this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0];
    if(!prior)throw Error('private-beta-policy-unpinned');if(prior.digest!==digest)throw Error('private-beta-policy-conflict');
  }
  async #alert(key:string,code:string){
    const prior=this.ctx.storage.sql.exec('SELECT key FROM beta_alerts WHERE key=?',key).toArray().length;
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO beta_alerts VALUES(?,?,?)',key,Date.now(),code);
    await this.ctx.storage.sync();
    if(!prior)console.error(JSON.stringify({event:'private-beta-alert',code,at:Date.now()}));
  }
  async #reconcile(p:PrivateBetaPolicy,releaseQuarantine=false){
    for(const slot of this.#slots()){
      const admission=JSON.parse(slot.document) as Admission;
      const workspace=this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(admission.scope.tenantId,admission.scope.workspaceId));
      try {
        // Read the original durable authority to repair a lost finish ACK. No
        // provider request is made, and missing records never release exposure.
        for(const call of this.ctx.storage.sql.exec<{document:string}>("SELECT document FROM beta_calls WHERE slot_key=? AND status IN ('reserved','dispatched','unknown')",slot.key).toArray()){
          const request=JSON.parse(call.document) as ModelCallRequest;
          const record=await bounded(this.env.PI_DEVELOPER_BUDGET.getByName(modelBudgetTenantName(request.identity.scope.tenantId)).privateBetaCall(request.identity,request.callId));
          if(record&&!['reserved','dispatched'].includes(record.status))await this.#applyObservation(record);
        }
        const state=await bounded(workspace.privateBetaReleaseState(admission));
        if(slot.turn_id===null&&!state.found&&state.turnId===null&&(state.rejectedSession===true||state.withdrawn===true)&&
          !this.ctx.storage.sql.exec('SELECT key FROM beta_calls WHERE slot_key=? LIMIT 1',slot.key).toArray().length){
          // Definitively rejected before a Turn existed, rather than an unknown
          // execution. Keep the original slot and alerts, with an audit entry.
          this.ctx.storage.sql.exec("UPDATE beta_slots SET status='released' WHERE key=?",slot.key);
          this.ctx.storage.sql.exec('INSERT INTO beta_operations(action,actor_json,at) VALUES(?,?,?)',(state.withdrawn?'release-withdrawn-intent:':'release-rejected-session:')+slot.key,JSON.stringify(admission.actor),Date.now());
          continue;
        }
        if((slot.status!=='quarantined'||releaseQuarantine)&&state.found&&(!slot.turn_id||state.turnId===slot.turn_id)&&state.terminal&&state.released&&!state.resourceWait){
          // Unknown model calls still occupy the slot even if a projection says released.
          const unresolved=this.ctx.storage.sql.exec("SELECT key FROM beta_calls WHERE slot_key=? AND status IN ('reserved','dispatched','unknown')",slot.key).toArray();
          if(!unresolved.length){this.ctx.storage.sql.exec("UPDATE beta_slots SET status='released',turn_id=? WHERE key=?",state.turnId,slot.key);continue;}
        }
        const deadline=privateBetaReleaseDeadline(slot.created_at,p,state);
        let revoked=false;try{await authorizePrivateBeta(this.env.CATALOG,admission.scope,admission.actor);}catch{revoked=true;}
        if(this.ctx.storage.kv.get('beta-paused')===true||slot.status==='quarantined'||!p.enabled||Date.now()>=p.reviewAt||revoked||Date.now()>=deadline){
          this.ctx.storage.sql.exec("UPDATE beta_slots SET status='quarantined' WHERE key=?",slot.key);
          await this.#alert(slot.key,'execution-or-release-unconfirmed');
          // Cancellation only, against the original identity. Never replay a model/tool.
          if(state.found&&!state.terminal&&state.turnId)await bounded(workspace.cancelTurn({scope:admission.scope,actor:admission.actor,turnId:state.turnId}));
        }
      } catch {await this.#alert(slot.key,'release-monitor-unavailable');}
    }
    await this.ctx.storage.sync();
  }
  async admitTurn(input:Admission){return this.#serial(async()=>{
    const p=this.#policy();await this.#pin(p);await authorizePrivateBeta(this.env.CATALOG,input.scope,input.actor);
    const key=await turnDigest({purpose:'private-beta-admission',...input});
    const prior=this.ctx.storage.sql.exec<Slot>('SELECT * FROM beta_slots WHERE key=?',key).toArray()[0];
    if(prior){if(prior.document!==JSON.stringify(input))throw Error('private-beta-identity-conflict');return {key,replayed:true};}
    if(betaMaintenanceHeld(this.ctx.storage))throw Error('private-beta-maintenance-held');
    await this.#reconcile(p);
    const slots=this.#slots();
    if(slots.some(s=>s.user_id===input.actor.userId))throw Error('private-beta-user-busy');
    if(slots.length>=p.maxActiveTurns)throw Error('private-beta-capacity-full');
    this.#policy();if(betaMaintenanceHeld(this.ctx.storage))throw Error('private-beta-maintenance-held');this.#checkLimits(p,input.actor.userId,0,null);
    this.ctx.storage.sql.exec("INSERT INTO beta_slots VALUES(?,?,?,?,NULL,'admitting')",key,input.actor.userId,JSON.stringify(input),Date.now());
    await this.ctx.storage.sync();await this.ctx.storage.setAlarm(Date.now()+p.monitorIntervalMs);
    return {key,replayed:false};
  });}
  async bindTurn(input:Admission,turnId:string){return this.#serial(async()=>{
    const p=this.#policy();await this.#assertPinned(p);const key=await turnDigest({purpose:'private-beta-admission',...input});
    const row=this.ctx.storage.sql.exec<Slot>('SELECT * FROM beta_slots WHERE key=?',key).toArray()[0];
    if(!row||row.document!==JSON.stringify(input)||!['admitting','active'].includes(row.status)||Date.now()>=row.created_at+p.maxTurnDurationMs||row.turn_id&&row.turn_id!==turnId)throw Error('private-beta-identity-conflict');
    this.ctx.storage.sql.exec("UPDATE beta_slots SET turn_id=?,status='active' WHERE key=?",turnId,key);await this.ctx.storage.sync();
  });}
  async turnBinding(input:Admission,rawTurnId:string){
    const p=this.#policy(false),expected=turnId(rawTurnId),key=await turnDigest({purpose:'private-beta-admission',...input});
    const row=this.ctx.storage.sql.exec<Slot>('SELECT * FROM beta_slots WHERE key=?',key).toArray()[0];
    const found=!!row&&row.document===JSON.stringify(input);if(!found)return {found:false,bound:false};await this.#assertPinned(p);return {found:true,bound:row.turn_id===expected&&row.status!=='admitting'};
  }
  #checkLimits(p:PrivateBetaPolicy,userId:string,cost:number,slot:string|null){
    if(!Number.isSafeInteger(cost)||cost<0)throw Error('private-beta-metering-invalid');
    const day=new Date(Date.now()).toISOString().slice(0,10);
    const totals=this.ctx.storage.sql.exec<{total:number;daily:number;user_daily:number;calls:number;user_calls:number;pending:number;pending_cost:number;turn_cost:number;turn_calls:number}>(`SELECT
      coalesce(sum(cost),0) total,coalesce(sum(CASE WHEN day=? THEN cost ELSE 0 END),0) daily,
      coalesce(sum(CASE WHEN day=? AND user_id=? THEN cost ELSE 0 END),0) user_daily,
      coalesce(sum(day=?),0) calls,coalesce(sum(day=? AND user_id=?),0) user_calls,
      coalesce(sum(status IN ('reserved','dispatched','unknown','billing-pending')),0) pending,
      coalesce(sum(CASE WHEN status IN ('reserved','dispatched','unknown','billing-pending') THEN cost ELSE 0 END),0) pending_cost,
      coalesce(sum(CASE WHEN slot_key=? THEN cost ELSE 0 END),0) turn_cost,coalesce(sum(slot_key=?),0) turn_calls FROM beta_calls`,day,day,userId,day,day,userId,slot,slot).one();
    if(Object.values(totals).some(n=>!Number.isSafeInteger(n)||n<0)||!Number.isSafeInteger(totals.total+cost))throw Error('private-beta-metering-invalid');
    if(p.schemaVersion===2)return totals;
    const increment=1;
    if(totals.total+cost>p.maxNanodollarsTotal||totals.daily+cost>p.maxNanodollarsPerDay||totals.user_daily+cost>p.maxNanodollarsPerUserDay||totals.calls+increment>p.maxCallsPerDay||totals.user_calls+increment>p.maxCallsPerUserDay||totals.pending+increment>p.maxPendingCalls||totals.pending_cost+cost>p.maxPendingNanodollars||slot&&(totals.turn_cost+cost>p.maxNanodollarsPerTurn||totals.turn_calls+1>p.maxCallsPerTurn))throw Error('private-beta-budget-limit');
    return totals;
  }
  async authorizeTurn(scope:TurnScope,actor:TurnActor,turnId:string){
    const p=this.#policy();await this.#pin(p);await authorizePrivateBeta(this.env.CATALOG,scope,actor);this.#policy();
    const slot=this.#slots().find(s=>s.user_id===actor.userId&&s.turn_id===turnId);
    if(!slot||slot.status!=='active'||Date.now()>=slot.created_at+p.maxTurnDurationMs)throw Error('private-beta-turn-denied');
    const admission=JSON.parse(slot.document) as Admission;
    if(JSON.stringify(admission.scope)!==JSON.stringify(scope)||JSON.stringify(admission.actor)!==JSON.stringify(actor))throw Error('private-beta-identity-conflict');
    return {deadlineAt:Math.min(slot.created_at+p.maxTurnDurationMs,p.reviewAt)};
  }
  async authorizeTool(scope:TurnScope,actor:TurnActor,turnId:string,deadlineAt:number){
    const grant=await this.authorizeTurn(scope,actor,turnId),p=this.#policy();
    if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()||deadlineAt>Date.now()+p.maxToolDurationMs||deadlineAt>grant.deadlineAt)throw Error('private-beta-time-limit');
    return grant;
  }
  async pause(actor?:TurnActor){this.#policy(false);this.ctx.storage.sql.exec('INSERT INTO beta_operations(action,actor_json,at) VALUES(?,?,?)','pause',actor?JSON.stringify(actor):null,Date.now());this.ctx.storage.kv.put('beta-paused',true);await this.ctx.storage.sync();await this.ctx.storage.setAlarm(Date.now()+1);return {paused:true};}
  async resume(actor?:TurnActor){return this.#serial(async()=>{const p=this.#policy(false);await this.#pin(p);await this.#reconcile(p,true);if(this.#slots().length)throw Error('private-beta-release-unconfirmed');this.ctx.storage.sql.exec('INSERT INTO beta_operations(action,actor_json,at) VALUES(?,?,?)','resume',actor?JSON.stringify(actor):null,Date.now());this.ctx.storage.kv.put('beta-paused',false);await this.ctx.storage.sync();return {paused:false};});}

  async #maintenanceControl():Promise<BetaMaintenanceControl>{
    const p=this.#policy(false),policySha256=await turnDigest({...p,enabled:false});
    if(JSON.stringify(p)!==JSON.stringify(this.#policy(false)))throw Error('private-beta-policy-conflict');
    return {policySha256,pinnedPolicySha256:this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0]?.digest??null,
      enabled:p.enabled&&Date.now()>=p.startsAt&&Date.now()<p.reviewAt,paused:this.ctx.storage.kv.get('beta-paused')===true,
      revision:this.ctx.storage.sql.exec<{revision:number}>("SELECT coalesce(max(id),0) revision FROM beta_operations WHERE action IN ('pause','resume')").one().revision};
  }
  #maintenanceLedger(){
    const slots=this.#slots(),unresolvedCalls=this.ctx.storage.sql.exec<{count:number}>("SELECT count(*) count FROM beta_calls WHERE status NOT IN ('observed','not-dispatched','billing-pending')").one().count;
    return {scope:'original-beta-ledger-only' as const,activeSlots:slots.length,quarantinedSlots:slots.filter(s=>s.status==='quarantined').length,unresolvedCalls,quiescent:slots.length===0&&unresolvedCalls===0};
  }
  /** No pin, monitor, reconcile, alarm, release or native call. Constructor
   * schema initialization is separate from the work performed by this read. */
  maintenanceStatus(requestId?:string,actor?:TurnActor){return this.#serial(async()=>({
    ...betaMaintenanceState(this.ctx.storage,await this.#maintenanceControl(),requestId,actor),ledger:this.#maintenanceLedger(),
    actualContainerReleaseVerified:false as const,
  }));}
  /** Fresh logical ledger proof while the original barrier remains held.
   * Read-only across both actors; not a physical Cloudflare instance proof. */
  maintenanceQuiescence(requestId:string,actor:TurnActor){return this.#serial(async()=>{
    const before=betaMaintenanceBarrier(this.ctx.storage,requestId,actor,await this.#maintenanceControl()),ledgerBefore=this.#maintenanceLedger();
    const native=this.env.TRUSTED_PI_CAPACITY;
    if(!native||!this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION)throw Error('private-beta-maintenance-proof-unavailable');
    const proof=await bounded(native.getByName(trustedPiCapacityActorName()).maintenanceQuiescence());
    if(proof?.actor!==trustedPiCapacityActorName()||proof.policyVersion!==this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION||typeof proof.quiescent!=='boolean'||!Number.isSafeInteger(proof.coldUnresolved)||proof.coldUnresolved<0||!Number.isSafeInteger(proof.pairUnresolved)||proof.pairUnresolved<0||proof.quiescent!==(proof.coldUnresolved===0&&proof.pairUnresolved===0)||proof.actualContainerReleaseVerified!==false)throw Error('private-beta-maintenance-proof-unavailable');
    const control=await this.#maintenanceControl(),current=betaMaintenanceBarrier(this.ctx.storage,requestId,actor,control),ledger=this.#maintenanceLedger();
    if(JSON.stringify(current)!==JSON.stringify(before))throw Error('private-beta-maintenance-conflict');
    return {schemaVersion:1 as const,requestId,checkedAt:Date.now(),...current,control,ledgerBefore,ledger,native:proof,
      quiescent:ledgerBefore.quiescent&&ledger.quiescent&&proof.quiescent,actualContainerReleaseVerified:false as const};
  });}
  beginMaintenance(raw:BetaMaintenanceInput,actor:TurnActor){return this.#serial(async()=>{
    const input=betaMaintenanceInput(raw),control=await this.#maintenanceControl();
    const result=beginBetaMaintenance(this.ctx.storage,input,actor,control);
    if(!result.replayed)await this.ctx.storage.sync();return result;
  });}
  endMaintenance(raw:BetaMaintenanceInput,actor:TurnActor){return this.#serial(async()=>{
    const input=betaMaintenanceInput(raw),prior=betaMaintenanceEndReplay(this.ctx.storage,input,actor);
    if(prior)return {...prior,replayed:true};
    if(!betaMaintenanceHeld(this.ctx.storage)||!this.#maintenanceLedger().quiescent)throw Error('private-beta-maintenance-release-unconfirmed');
    const native=this.env.TRUSTED_PI_CAPACITY;
    if(!native||!this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION)throw Error('private-beta-maintenance-release-unconfirmed');
    const proof=await bounded(native.getByName(trustedPiCapacityActorName()).maintenanceQuiescence());
    if(proof?.actor!==trustedPiCapacityActorName()||proof.policyVersion!==this.env.TRUSTED_PI_CAPACITY_POLICY_VERSION||proof.quiescent!==true)throw Error('private-beta-maintenance-release-unconfirmed');
    const control=await this.#maintenanceControl();
    if(!this.#maintenanceLedger().quiescent)throw Error('private-beta-maintenance-release-unconfirmed');
    const result=endBetaMaintenance(this.ctx.storage,input,actor,control);await this.ctx.storage.sync();return result;
  });}

  /** Deployment-only RPC: explicitly accept a later review date from the new
   * trusted configuration. No public route, reconciliation, release or dispatch.
   * Reconstructing the previous digest proves every other policy field stayed
   * fixed. The old pin keeps admission closed until this guarded step succeeds. */
  extendReview(input:{previousReviewAt:number;expectedPolicySha256:string},actor?:TurnActor){return this.#serial(async()=>{
    const policy=this.#policy(false);
    if(!input||Object.keys(input).sort().join(',')!=='expectedPolicySha256,previousReviewAt'||!Number.isSafeInteger(input.previousReviewAt)||input.previousReviewAt<=policy.startsAt||policy.reviewAt<=input.previousReviewAt||policy.reviewAt<=Date.now()||!/^[a-f0-9]{64}$/.test(input.expectedPolicySha256))throw Error('private-beta-review-extension-invalid');
    const previousDigest=await turnDigest({...policy,enabled:false,reviewAt:input.previousReviewAt});
    if(previousDigest!==input.expectedPolicySha256)throw Error('private-beta-policy-conflict');
    const digest=await turnDigest({...policy,enabled:false});
    const action=`extend-review:${input.previousReviewAt}:${policy.reviewAt}:${previousDigest}:${digest}`;
    const replayed=this.ctx.storage.transactionSync(()=>{
      const prior=this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0];
      if(!prior)throw Error('private-beta-policy-unpinned');
      if(prior.digest===digest&&this.ctx.storage.sql.exec('SELECT id FROM beta_operations WHERE action=?',action).toArray().length)return true;
      if(prior.digest!==previousDigest)throw Error('private-beta-policy-conflict');
      // An expired running Turn or unresolved call cannot gain time through an
      // extension. Operators must settle the original identities separately.
      if(this.#slots().length||this.ctx.storage.sql.exec("SELECT key FROM beta_calls WHERE status IN ('reserved','dispatched','unknown') LIMIT 1").toArray().length)throw Error('private-beta-release-unconfirmed');
      this.ctx.storage.sql.exec('UPDATE beta_policy SET digest=? WHERE singleton=1',digest);
      this.ctx.storage.sql.exec('INSERT INTO beta_operations(action,actor_json,at) VALUES(?,?,?)',action,actor?JSON.stringify(actor):null,Date.now());
      return false;
    });
    await this.ctx.storage.sync();
    return {previousReviewAt:input.previousReviewAt,reviewAt:policy.reviewAt,policySha256:digest,replayed};
  });}
  #migrationLedger(){return {
    slots:this.ctx.storage.sql.exec('SELECT * FROM beta_slots ORDER BY key').toArray(),
    calls:this.ctx.storage.sql.exec('SELECT * FROM beta_calls ORDER BY key').toArray(),
    alerts:this.ctx.storage.sql.exec('SELECT * FROM beta_alerts ORDER BY key').toArray(),
    operations:this.ctx.storage.sql.exec('SELECT * FROM beta_operations ORDER BY id').toArray(),
    metering:this.ctx.storage.sql.exec('SELECT * FROM beta_call_metering ORDER BY call_key').toArray(),
    paused:this.ctx.storage.kv.get('beta-paused')??null,
  };}
  /** Deployment-only read: redacted checksum of all original identities and
   * authoritative rows. No reconciliation, mutation or provider/tool request. */
  migrationState(){return this.#serial(async()=>{
    this.#policy(false);const ledger=this.#migrationLedger();
    return {actor:PRIVATE_BETA_CAPACITY_ACTOR,pinnedPolicySha256:this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0]?.digest??null,
      ledgerSha256:await turnDigest(ledger),slotSha256:await turnDigest(ledger.slots),callSha256:await turnDigest(ledger.calls),alertSha256:await turnDigest(ledger.alerts),operationSha256:await turnDigest(ledger.operations),slotCount:ledger.slots.length,callCount:ledger.calls.length,operationCount:ledger.operations.length,alertCount:ledger.alerts.length,paused:ledger.paused};
  });}
  /** Explicit, guarded schema evolution in the ORIGINAL actor. Unknown and
   * occupied slots may migrate, but cannot be released or gain a new identity,
   * epoch, deadline, profile or execution gate. No public route exposes this. */
  removeQuotas(input:{previousPolicy:unknown;expectedPolicySha256:string;expectedLedgerSha256:string},actor?:TurnActor){return this.#serial(async()=>{
    const policy=this.#policy(false);
    if(!input||Object.keys(input).sort().join(',')!=='expectedLedgerSha256,expectedPolicySha256,previousPolicy'||policy.schemaVersion!==2||![input.expectedPolicySha256,input.expectedLedgerSha256].every(d=>typeof d==='string'&&/^[a-f0-9]{64}$/.test(d)))throw Error('private-beta-quota-migration-invalid');
    const previous=privateBetaPolicy(input.previousPolicy);
    if(previous?.schemaVersion!==1)throw Error('private-beta-quota-migration-invalid');
    const previousDigest=await turnDigest({...previous,enabled:false}),digest=await turnDigest({...policy,enabled:false});
    if(previousDigest!==input.expectedPolicySha256||await turnDigest(privateBetaPolicyGates(previous))!==await turnDigest(privateBetaPolicyGates(policy)))throw Error('private-beta-policy-conflict');
    const ledger=this.#migrationLedger(),ledgerText=JSON.stringify(ledger),ledgerDigest=await turnDigest(ledger);
    const action=`remove-quotas:${previousDigest}:${digest}`;
    const replayed=this.ctx.storage.transactionSync(()=>{
      const prior=this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0];
      if(!prior)throw Error('private-beta-policy-unpinned');
      const migration=this.ctx.storage.sql.exec<{to_digest:string;ledger_digest:string}>('SELECT to_digest,ledger_digest FROM beta_policy_migrations WHERE from_digest=?',previousDigest).toArray()[0];
      if(prior.digest===digest&&migration?.to_digest===digest&&migration.ledger_digest===input.expectedLedgerSha256&&this.ctx.storage.sql.exec('SELECT id FROM beta_operations WHERE action=?',action).toArray().length)return true;
      if(prior.digest!==previousDigest||migration)throw Error('private-beta-policy-conflict');
      if(ledgerDigest!==input.expectedLedgerSha256||JSON.stringify(this.#migrationLedger())!==ledgerText)throw Error('private-beta-migration-state-conflict');
      this.ctx.storage.sql.exec('UPDATE beta_policy SET digest=? WHERE singleton=1',digest);
      this.ctx.storage.sql.exec('INSERT INTO beta_policy_migrations VALUES(?,?,?,?,?,?)',previousDigest,digest,JSON.stringify(previous),JSON.stringify(policy),ledgerDigest,Date.now());
      this.ctx.storage.sql.exec('INSERT INTO beta_operations(action,actor_json,at) VALUES(?,?,?)',action,actor?JSON.stringify(actor):null,Date.now());
      return false;
    });
    await this.ctx.storage.sync();return {actor:PRIVATE_BETA_CAPACITY_ACTOR,policySha256:digest,previousPolicySha256:previousDigest,ledgerSha256:input.expectedLedgerSha256,replayed};
  });}
  /** Runs share invitation, kill-switch and original execution isolation, with
   * their own resource admission. This method never reserves a Pi Turn slot. */
  authorizeRunAdmission(scope:TurnScope,actor:TurnActor){return this.#serial(async()=>{
    const p=this.#policy();if(p.schemaVersion!==2)throw Error('private-beta-meter-only-required');
    await this.#assertPinned(p);await authorizePrivateBeta(this.env.CATALOG,scope,actor);
    await assertPrivateBetaHistoricalIsolation(p,scope.tenantId,this.env.TENANT_MODEL_BUDGET,this.env.G5_TOKEN_BUDGET);
    // Original authority reads may await other actors; revoke/pause still wins.
    await authorizePrivateBeta(this.env.CATALOG,scope,actor);this.#policy();
    if(this.#slots().some(s=>s.status==='quarantined')||this.ctx.storage.sql.exec("SELECT key FROM beta_calls WHERE status IN ('reserved','dispatched','unknown') LIMIT 1").toArray().length)throw Error('private-beta-execution-unconfirmed');
    return {quotaMode:p.quotaMode,policySha256:await turnDigest({...p,enabled:false})};
  });}
  async reserve(raw:ModelCallRequest){return this.#serial(async()=>{
    const request=modelCallRequest(raw),p=this.#policy();await this.#pin(p);
    await authorizePrivateBeta(this.env.CATALOG,request.identity.scope,request.actor);
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON));
    if(await profileDigest(profile)!==p.profileSha256||request.provider!==profile.inferenceProvider||request.model!==profile.model)throw Error('private-beta-profile-denied');
    const key=await modelBudgetCallKey(request.identity,request.callId);
    const prior=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM beta_calls WHERE key=?',key).toArray()[0];
    if(prior){if(prior.document!==JSON.stringify(request))throw Error('private-beta-identity-conflict');return {key,replayed:true};}
    const slot=this.#slots().find(s=>s.user_id===request.actor.userId&&s.turn_id===request.identity.turnId);
    if(!slot||slot.status!=='active')throw Error('private-beta-turn-denied');
    const admission=JSON.parse(slot.document) as Admission;
    if(JSON.stringify(admission.scope)!==JSON.stringify(request.identity.scope)||admission.sessionId!==request.identity.sessionId||JSON.stringify(admission.actor)!==JSON.stringify(request.actor))throw Error('private-beta-identity-conflict');
    if(request.deadlineAt<=Date.now()||request.deadlineAt>Date.now()+p.maxCallDurationMs||request.deadlineAt>slot.created_at+p.maxTurnDurationMs||request.deadlineAt>p.reviewAt)throw Error('private-beta-time-limit');
    const cost=conservativeCost(profile,request.inputTokenUpperBound,request.maxOutputTokens);
    this.#checkLimits(p,request.actor.userId,cost,slot.key);
    this.ctx.storage.transactionSync(()=>{
      this.ctx.storage.sql.exec("INSERT INTO beta_calls VALUES(?,?,?,?,?,?,'reserved')",key,slot.key,request.actor.userId,new Date(Date.now()).toISOString().slice(0,10),JSON.stringify(request),cost);
      this.ctx.storage.sql.exec('INSERT INTO beta_call_metering VALUES(?,?,NULL)',key,Date.now());
    });
    await this.ctx.storage.sync();return {key,replayed:false};
  });}
  async checkDispatch(request:ModelCallRequest){return this.#serial(async()=>{
    request=modelCallRequest(request);
    const p=this.#policy();await this.#pin(p);await authorizePrivateBeta(this.env.CATALOG,request.identity.scope,request.actor);this.#policy();
    const key=await modelBudgetCallKey(request.identity,request.callId);
    const row=this.ctx.storage.sql.exec<{document:string;slot_key:string;day:string;status:string}>('SELECT * FROM beta_calls WHERE key=?',key).toArray()[0];
    const slot=this.#slots().find(s=>s.key===row?.slot_key);
    if(!row||row.document!==JSON.stringify(request)||!slot||slot.status!=='active'||Date.now()>=slot.created_at+p.maxTurnDurationMs||p.schemaVersion===1&&row.day!==new Date(Date.now()).toISOString().slice(0,10)||!['reserved','dispatched'].includes(row.status))throw Error('private-beta-turn-denied');
    this.ctx.storage.sql.exec("UPDATE beta_calls SET status='dispatched' WHERE key=?",key);await this.ctx.storage.sync();
  });}
  async observeCall(record:ModelCallRecord){return this.#serial(()=>this.#applyObservation(record));}
  async #applyObservation(record:ModelCallRecord){
    this.#policy(false);
    const row=this.ctx.storage.sql.exec<{document:string;slot_key:string}>('SELECT * FROM beta_calls WHERE key=?',record.callKey).toArray()[0];
    if(!row)throw Error('private-beta-record-missing');
    const request=JSON.parse(row.document) as ModelCallRequest;
    if(await modelBudgetCallKey(record.identity,record.callId)!==record.callKey||JSON.stringify(request.identity)!==JSON.stringify(record.identity))throw Error('private-beta-identity-conflict');
    const terminal=record.terminal;
    const ended=terminal&&terminal.providerRequestId&&(record.status==='completed'&&terminal.outcome==='completed'||record.status==='failed'&&terminal.outcome==='failed'&&['rejected-auth','rate-limited'].includes(String(terminal.errorCode)));
    const status=record.status==='not-dispatched'?'not-dispatched':ended?(terminal.usage.kind==='verified'?'observed':'billing-pending'):'unknown';
    // Reservations never shrink. An ACK loss can only over-count exposure.
    this.ctx.storage.sql.exec('UPDATE beta_calls SET status=? WHERE key=?',status,record.callKey);
    if(status==='billing-pending'){
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO beta_call_metering VALUES(?,NULL,?)',record.callKey,Date.now());
      this.ctx.storage.sql.exec('UPDATE beta_call_metering SET billing_pending_at=coalesce(billing_pending_at,?) WHERE call_key=?',Date.now(),record.callKey);
    }
    if(status==='unknown'){
      this.ctx.storage.sql.exec("UPDATE beta_slots SET status='quarantined' WHERE key=?",row.slot_key);
      await this.#alert(row.slot_key,'execution-unknown');await this.ctx.storage.setAlarm(Date.now()+1);
    }
    await this.ctx.storage.sync();
  }
  async alarm(){return this.monitor();}
  async monitor(){return this.#serial(async()=>{
    const p=this.#policy(false);await this.#pin(p);await this.#reconcile(p);
    const day=new Date(Date.now()).toISOString().slice(0,10);
    if(p.schemaVersion===1){
      const totals=this.ctx.storage.sql.exec<{cost:number}>('SELECT coalesce(sum(cost),0) cost FROM beta_calls WHERE day=?',day).one();
      if(totals.cost*100>=p.maxNanodollarsPerDay*p.alertPercent)await this.#alert('budget:'+day,'daily-budget-warning');
      const cumulative=this.ctx.storage.sql.exec<{cost:number}>('SELECT coalesce(sum(cost),0) cost FROM beta_calls').one();
      if(cumulative.cost*100>=p.maxNanodollarsTotal*p.alertPercent)await this.#alert('budget:total','cumulative-budget-warning');
    }else{
      const now=Date.now(),minute=Math.floor(now/60_000);
      const trend=this.ctx.storage.sql.exec<{calls:number;cost:number}>('SELECT count(*) calls,coalesce(sum(c.cost),0) cost FROM beta_calls c JOIN beta_call_metering m ON m.call_key=c.key WHERE m.accepted_at>?',now-60_000).one();
      if(!Number.isSafeInteger(trend.cost)||trend.cost<0)throw Error('private-beta-metering-invalid');
      if(trend.calls>=p.warningCallsPerMinute)await this.#alert('call-rate:'+minute,'call-rate-anomaly');
      if(trend.cost>=p.warningNanodollarsPerMinute)await this.#alert('fee-rate:'+minute,'fee-rate-anomaly');
      // Historical missing usage starts its age clock at the first observed
      // monitor; it is never silently cleared or called a zero charge.
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO beta_call_metering SELECT key,NULL,? FROM beta_calls WHERE status='billing-pending'",now);
      const pending=this.ctx.storage.sql.exec<{key:string}>("SELECT c.key FROM beta_calls c JOIN beta_call_metering m ON m.call_key=c.key WHERE c.status='billing-pending' AND m.billing_pending_at<=?",now-p.billingPendingWarningMs).toArray();
      for(const row of pending)await this.#alert('billing:'+row.key,'billing-pending-stale');
    }
    this.ctx.storage.kv.put('beta-last-monitor',Date.now());await this.ctx.storage.sync();
    if(this.#slots().length||p.schemaVersion===2&&this.ctx.storage.sql.exec("SELECT key FROM beta_calls WHERE status='billing-pending' LIMIT 1").toArray().length)await this.ctx.storage.setAlarm(Date.now()+p.monitorIntervalMs);
  });}
  #usage(){
    const usage=this.ctx.storage.sql.exec<{day:string;status:string;calls:number;reservedNanodollars:number}>('SELECT day,status,count(*) calls,sum(cost) reservedNanodollars FROM beta_calls GROUP BY day,status').toArray();
    let total=0;
    for(const row of usage){total+=row.reservedNanodollars;if(!Number.isSafeInteger(row.calls)||row.calls<0||!Number.isSafeInteger(row.reservedNanodollars)||row.reservedNanodollars<0||!Number.isSafeInteger(total))throw Error('private-beta-metering-invalid');}
    return usage;
  }
  async snapshot(){
    const policy=this.#policy(false);
    const policySha256=await turnDigest({...policy,enabled:false});
    const pinnedPolicySha256=this.ctx.storage.sql.exec<{digest:string}>('SELECT digest FROM beta_policy WHERE singleton=1').toArray()[0]?.digest??null;
    return {schemaVersion:1,policySchemaVersion:policy.schemaVersion,quotaMode:policy.schemaVersion===2?'meter-only':'limited',policyReady:policySha256===pinnedPolicySha256,policySha256,pinnedPolicySha256,enabled:policy.enabled&&Date.now()>=policy.startsAt&&Date.now()<policy.reviewAt,reviewAt:policy.reviewAt,limits:{maxActiveTurns:policy.maxActiveTurns,maxNanodollarsPerDay:policy.schemaVersion===1?policy.maxNanodollarsPerDay:null,maxNanodollarsTotal:policy.schemaVersion===1?policy.maxNanodollarsTotal:null},lastMonitorAt:this.ctx.storage.kv.get('beta-last-monitor')??null,paused:this.ctx.storage.kv.get('beta-paused')===true,active:this.#slots().length,quarantined:this.#slots().filter(s=>s.status==='quarantined').length,
      usage:this.#usage(),
      alerts:this.ctx.storage.sql.exec('SELECT at,code FROM beta_alerts ORDER BY at DESC LIMIT 100').toArray()};
  }
  /** Private metadata proof. Never monitors, releases or retries an execution. */
  async archiveQuiescence(rawScope:TurnScope){
    const scope=checkedScope(rawScope);this.#policy(false);
    const sameProject=(other:TurnScope)=>other.tenantId===scope.tenantId&&other.projectId===scope.projectId;
    const slots=this.#slots().filter(row=>sameProject((JSON.parse(row.document) as Admission).scope));
    const calls=this.ctx.storage.sql.exec<{document:string}>("SELECT document FROM beta_calls WHERE status IN ('reserved','dispatched','unknown')").toArray().filter(row=>sameProject(modelCallRequest(JSON.parse(row.document)).identity.scope));
    return {activeSlots:slots.length,unresolvedCalls:calls.length,quiescent:slots.length===0&&calls.length===0};
  }
  async userStatus(scope:TurnScope,actor:TurnActor){
    this.#policy(false);
    await authorizePrivateBeta(this.env.CATALOG,scope,actor);
    const slot=this.#slots().find(row=>row.user_id===actor.userId);
    if(!slot)return {state:'available' as const};
    if(slot.status==='quarantined')return {state:'review-required' as const};
    if(!slot.turn_id)return {state:'admitting' as const};
    try{
      const original=JSON.parse(slot.document) as Admission;
      const workspace=this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(original.scope.tenantId,original.scope.workspaceId));
      const state=await bounded(workspace.privateBetaReleaseState(original));
      return {state:state.terminal?'release-pending' as const:'running' as const};
    }catch{return {state:'unknown' as const};}
  }
}
