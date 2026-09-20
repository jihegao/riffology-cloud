import {DurableObject} from 'cloudflare:workers';
import {privateBetaReleaseDeadline} from './private-beta-release.ts';
import {privateBetaPolicy,authorizePrivateBeta,PRIVATE_BETA_CAPACITY_ACTOR,type PrivateBetaPolicy} from './private-beta-policy.ts';
import {turnDigest,turnId,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {modelCallRequest,modelBudgetCallKey,type ModelCallRequest,type ModelCallRecord,modelBudgetTenantName} from './core.ts';
import {productionProfile,profileDigest,conservativeCost} from '../model-proxy/production-profile.ts';

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
  PI_DEVELOPER_BUDGET:{getByName(name:string):{privateBetaCall(identity:ModelCallRequest['identity'],callId:string):Promise<ModelCallRecord|null>}};
  WORKSPACE_AGENT:{getByName(name:string):{
    privateBetaReleaseState(input:Admission):Promise<{found:boolean;turnId:string|null;terminal:boolean;released:boolean;resourceWait:boolean;finishedAt:number|null;releaseGuard?:boolean}>;
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
      CREATE TABLE IF NOT EXISTS beta_alerts(key TEXT PRIMARY KEY,at INTEGER NOT NULL,code TEXT NOT NULL) STRICT;`);
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
    await this.#reconcile(p);
    const slots=this.#slots();
    if(slots.some(s=>s.user_id===input.actor.userId))throw Error('private-beta-user-busy');
    if(slots.length>=p.maxActiveTurns)throw Error('private-beta-capacity-full');
    this.#policy();this.#checkLimits(p,input.actor.userId,0,null);
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
    const day=new Date(Date.now()).toISOString().slice(0,10);
    const totals=this.ctx.storage.sql.exec<{total:number;daily:number;user_daily:number;calls:number;user_calls:number;pending:number;pending_cost:number;turn_cost:number;turn_calls:number}>(`SELECT
      coalesce(sum(cost),0) total,coalesce(sum(CASE WHEN day=? THEN cost ELSE 0 END),0) daily,
      coalesce(sum(CASE WHEN day=? AND user_id=? THEN cost ELSE 0 END),0) user_daily,
      coalesce(sum(day=?),0) calls,coalesce(sum(day=? AND user_id=?),0) user_calls,
      coalesce(sum(status IN ('reserved','dispatched','unknown','billing-pending')),0) pending,
      coalesce(sum(CASE WHEN status IN ('reserved','dispatched','unknown','billing-pending') THEN cost ELSE 0 END),0) pending_cost,
      coalesce(sum(CASE WHEN slot_key=? THEN cost ELSE 0 END),0) turn_cost,coalesce(sum(slot_key=?),0) turn_calls FROM beta_calls`,day,day,userId,day,day,userId,slot,slot).one();
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
    this.ctx.storage.sql.exec("INSERT INTO beta_calls VALUES(?,?,?,?,?,?,'reserved')",key,slot.key,request.actor.userId,new Date(Date.now()).toISOString().slice(0,10),JSON.stringify(request),cost);
    await this.ctx.storage.sync();return {key,replayed:false};
  });}
  async checkDispatch(request:ModelCallRequest){return this.#serial(async()=>{
    request=modelCallRequest(request);
    const p=this.#policy();await this.#pin(p);await authorizePrivateBeta(this.env.CATALOG,request.identity.scope,request.actor);this.#policy();
    const key=await modelBudgetCallKey(request.identity,request.callId);
    const row=this.ctx.storage.sql.exec<{document:string;slot_key:string;day:string;status:string}>('SELECT * FROM beta_calls WHERE key=?',key).toArray()[0];
    const slot=this.#slots().find(s=>s.key===row?.slot_key);
    if(!row||row.document!==JSON.stringify(request)||!slot||slot.status!=='active'||Date.now()>=slot.created_at+p.maxTurnDurationMs||row.day!==new Date(Date.now()).toISOString().slice(0,10)||!['reserved','dispatched'].includes(row.status))throw Error('private-beta-turn-denied');
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
    const totals=this.ctx.storage.sql.exec<{cost:number}>('SELECT coalesce(sum(cost),0) cost FROM beta_calls WHERE day=?',day).one();
    if(totals.cost*100>=p.maxNanodollarsPerDay*p.alertPercent)await this.#alert('budget:'+day,'daily-budget-warning');
    const cumulative=this.ctx.storage.sql.exec<{cost:number}>('SELECT coalesce(sum(cost),0) cost FROM beta_calls').one();
    if(cumulative.cost*100>=p.maxNanodollarsTotal*p.alertPercent)await this.#alert('budget:total','cumulative-budget-warning');
    this.ctx.storage.kv.put('beta-last-monitor',Date.now());await this.ctx.storage.sync();
    if(this.#slots().length)await this.ctx.storage.setAlarm(Date.now()+p.monitorIntervalMs);
  });}
  async snapshot(){
    const policy=this.#policy(false);
    return {schemaVersion:1,enabled:policy.enabled&&Date.now()>=policy.startsAt&&Date.now()<policy.reviewAt,reviewAt:policy.reviewAt,limits:{maxActiveTurns:policy.maxActiveTurns,maxNanodollarsPerDay:policy.maxNanodollarsPerDay,maxNanodollarsTotal:policy.maxNanodollarsTotal},lastMonitorAt:this.ctx.storage.kv.get('beta-last-monitor')??null,paused:this.ctx.storage.kv.get('beta-paused')===true,active:this.#slots().length,quarantined:this.#slots().filter(s=>s.status==='quarantined').length,
      usage:this.ctx.storage.sql.exec('SELECT day,status,count(*) calls,sum(cost) reservedNanodollars FROM beta_calls GROUP BY day,status').toArray(),
      alerts:this.ctx.storage.sql.exec('SELECT at,code FROM beta_alerts ORDER BY at DESC LIMIT 100').toArray()};
  }
}
