import {privateBetaPolicy,authorizePrivateBeta,PRIVATE_BETA_CAPACITY_ACTOR} from './private-beta-policy.ts';
import type {PrivateBetaCapacity} from './private-beta-capacity.ts';
import type {TurnActor} from '../turn/protocol.ts';
import {DurableObject} from 'cloudflare:workers';
import {SqlTenantModelBudget, modelBudgetTenantName, modelBudgetTurnKey, type ModelCallRequest, type ModelCallReference, type ModelCallTerminal, type ModelReleaseProof, type ModelCallRecord, type ModelExecutionIsolationManifest} from './core.ts';
import {piDeveloperPolicy, piDeveloperOwner, type PiDeveloperPolicyV2} from './pi-developer-policy.ts';
import {productionProfile, profileDigest, conservativeCost, type ProductionProfile} from '../model-proxy/production-profile.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {turnDigest,type TurnScope} from '../turn/protocol.ts';

type HistoricalLedger = {getByName(name:string):{assertExecutionIsolated(tenantId:string,manifest:ModelExecutionIsolationManifest):Promise<unknown>;assertExecutionQuiet(tenantId:string):Promise<unknown>}};
interface Env {
  PRIVATE_BETA_POLICY_JSON?:string;
  PRIVATE_BETA_CAPACITY?:DurableObjectNamespace<PrivateBetaCapacity>;
  CATALOG:D1Database;
  G4_CONTROLLED_WINDOW_JSON?:string;
  G5_CONTROLLED_WINDOW_JSON?:string;
  TENANT_MODEL_BUDGET?:HistoricalLedger;
  G5_TOKEN_BUDGET?:HistoricalLedger;
  PI_DEVELOPER_POLICY_JSON?:string;
  PI_DEVELOPER_BUDGET:DurableObjectNamespace<PiDeveloperBudget>;
  PRODUCTION_MODEL_PROFILE_JSON:string;
  M2_MODEL_BUDGET_POLICY_VERSION:string;
}
type Quote = {privateBeta?:true;policyId:string; profileSha256:string; profile:ProductionProfile; reservedNanodollars:number};

/** Separate, bounded acceptance accounting. Actor identity does not depend on
 * policy/period IDs, so policy changes cannot erase unknown execution. */
export class PiDeveloperBudget extends DurableObject<Env> {
  #ledger:SqlTenantModelBudget|null=null;
  #reserveTail:Promise<unknown>=Promise.resolve();

  #core(tenantId:string) {
    if(!this.env.PI_DEVELOPER_BUDGET.idFromName(modelBudgetTenantName(tenantId)).equals(this.ctx.id))throw Error('pi-developer-actor-denied');
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON));
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pi_developer_usage(call_key TEXT PRIMARY KEY,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pi_developer_turns(turn_key TEXT PRIMARY KEY,document TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS pi_developer_packet(singleton INTEGER PRIMARY KEY CHECK(singleton=1),document TEXT NOT NULL,digest TEXT NOT NULL UNIQUE) STRICT;`);
    // Packet-level Turns, dispatches, duration and money are enforced below.
    return this.#ledger??=new SqlTenantModelBudget(this.ctx.storage,{
      tenantId,version:this.env.M2_MODEL_BUDGET_POLICY_VERSION,
      maxReservationAttemptsPerTurn:128,maxDispatchedCallsPerTurn:64,
      maxInputTokensPerCall:profile.limits.maxInputTokens,maxOutputTokensPerCall:profile.limits.maxOutputTokens,
      maxReservedTokensPerTurn:4194304,
    });
  }

  #policy(scope:TurnScope,userId:string):PiDeveloperPolicyV2 {
    const policy=piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON);
    if(policy?.schemaVersion!==2||!piDeveloperOwner(policy,scope.tenantId,userId,scope.projectId))throw Error('pi-developer-admission-denied');
    return policy;
  }

  async #pinPacket(policy:PiDeveloperPolicyV2,profileSha256:string) {
    const document={schemaVersion:1 as const,purpose:'pi-developer-acceptance-packet' as const,policy,profileSha256},digest=await turnDigest(document);
    const prior=this.ctx.storage.sql.exec<{document:string;digest:string}>('SELECT document,digest FROM pi_developer_packet WHERE singleton=1').toArray()[0];
    if(prior){if(prior.digest!==digest||prior.document!==JSON.stringify(document))throw Error('pi-developer-policy-conflict');return digest;}
    this.ctx.storage.sql.exec('INSERT INTO pi_developer_packet VALUES(1,?,?)',JSON.stringify(document),digest);await this.ctx.storage.sync();return digest;
  }

  async #configured(policy:PiDeveloperPolicyV2) {
    const isolation=policy.historicalIsolation,manifestSha256=await turnDigest({schemaVersion:1,manifestId:isolation.manifestId,manifests:isolation.manifests});
    if(manifestSha256!==isolation.manifestSha256)throw Error('pi-developer-execution-isolation-unconfirmed');
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON)),profileSha256=await profileDigest(profile);
    const packetSha256=await this.#pinPacket(policy,profileSha256);
    return {profile,profileSha256,packetSha256};
  }

  async #assertHistoricalIsolation(policy:PiDeveloperPolicyV2) {
    const isolation=policy.historicalIsolation;
    const manifestSha256=await turnDigest({schemaVersion:1,manifestId:isolation.manifestId,manifests:isolation.manifests});
    if(manifestSha256!==isolation.manifestSha256)throw Error('pi-developer-execution-isolation-unconfirmed');
    if(!this.env.TENANT_MODEL_BUDGET||!this.env.G5_TOKEN_BUDGET)throw Error('pi-developer-historical-ledger-unavailable');
    for(const manifest of isolation.manifests){
      const namespace=manifest.ledger==='legacy'?this.env.TENANT_MODEL_BUDGET:this.env.G5_TOKEN_BUDGET;
      await namespace.getByName(modelBudgetTenantName(policy.tenantId)).assertExecutionIsolated(policy.tenantId,manifest);
    }
  }

  #betaControl(){const stub=this.env.PRIVATE_BETA_CAPACITY?.getByName(PRIVATE_BETA_CAPACITY_ACTOR);if(!stub)throw Error('private-beta-unconfigured');return stub;}
  async #betaQuiet(scope:TurnScope){
    const p=privateBetaPolicy(this.env.PRIVATE_BETA_POLICY_JSON);if(!p)throw Error('private-beta-unconfigured');
    if(!p.enabled||Date.now()<p.startsAt||Date.now()>=p.reviewAt)throw Error('private-beta-paused');
    if(!this.env.TENANT_MODEL_BUDGET||!this.env.G5_TOKEN_BUDGET)throw Error('pi-developer-historical-ledger-unavailable');
    const entry=p.historicalIsolation.find(h=>h.tenantId===scope.tenantId);
    for(const ledger of ['legacy','g5'] as const){
      const manifest=entry?.manifests.find(m=>m.ledger===ledger)??{schemaVersion:1 as const,ledger,proofs:[]};
      const namespace=ledger==='legacy'?this.env.TENANT_MODEL_BUDGET:this.env.G5_TOKEN_BUDGET;
      const ledgerActor=namespace.getByName(modelBudgetTenantName(scope.tenantId));
      if(manifest.proofs.length)await ledgerActor.assertExecutionIsolated(scope.tenantId,manifest);
      else await ledgerActor.assertExecutionQuiet(scope.tenantId);
    }
    await this.#core(scope.tenantId).assertExecutionQuiet();
  }
  async #betaReserve(tenantId:string,request:ModelCallRequest){
    if(request.identity.scope.tenantId!==tenantId)throw Error('private-beta-admission-denied');
    await authorizePrivateBeta(this.env.CATALOG,request.identity.scope,request.actor);
    const core=this.#core(tenantId),prior=await core.lookup(request.identity,request.callId);
    if(!prior)await this.#betaQuiet(request.identity.scope);
    await this.#betaControl().reserve(request);
    const p=privateBetaPolicy(this.env.PRIVATE_BETA_POLICY_JSON)!;
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON)),profileSha256=await profileDigest(profile);
    if(profileSha256!==p.profileSha256)throw Error('private-beta-profile-denied');
    const quote:Quote={privateBeta:true,policyId:p.policyId,profileSha256,profile,reservedNanodollars:conservativeCost(profile,request.inputTokenUpperBound,request.maxOutputTokens)};
    const result=await core.reserve(request);
    const existing=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM pi_developer_usage WHERE call_key=?',result.record.callKey).toArray()[0];
    if(existing&&existing.document!==JSON.stringify(quote))throw Error('pi-developer-policy-conflict');
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO pi_developer_usage VALUES(?,?)',result.record.callKey,JSON.stringify(quote));await this.ctx.storage.sync();return result;
  }
  async #observeBeta(core:SqlTenantModelBudget,reference:ModelCallReference){
    const record=await core.lookup(reference.identity,reference.callId);
    if(record&&this.#quote(record).privateBeta)await this.#betaControl().observeCall(record);
  }
  async assertQuiet(scope:TurnScope,userId:string) {
    if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)return this.#betaQuiet(scope);
    const core=this.#core(scope.tenantId),policy=this.#policy(scope,userId);
    await this.#configured(policy);
    await this.#assertHistoricalIsolation(policy);
    await core.assertExecutionQuiet();
  }

  async admitTurn(scope:TurnScope,userId:string,sessionId:string,requestKey:string,actor?:TurnActor) {
    if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined){if(!actor||actor.userId!==userId)throw Error('private-beta-admission-denied');await this.#betaQuiet(scope);return this.#betaControl().admitTurn({scope,actor,sessionId,requestKey});}
    const next=this.#reserveTail.then(async()=>{
      await this.assertQuiet(scope,userId);const policy=this.#policy(scope,userId);
      const document={schemaVersion:1 as const,policyId:policy.policyId,scope,sessionId,requestKey},key=await turnDigest({schemaVersion:1,purpose:'pi-developer-human-turn',scope,sessionId,requestKey});
      const prior=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM pi_developer_turns WHERE turn_key=?',key).toArray()[0];
      if(prior){if(prior.document!==JSON.stringify(document))throw Error('pi-developer-policy-conflict');return {replayed:true,usedTurns:Number(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM pi_developer_turns').toArray()[0]?.n??0)};}
      const used=Number(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM pi_developer_turns').toArray()[0]?.n??0);if(!Number.isSafeInteger(used)||used>=policy.maxTurns)throw Error('pi-developer-packet-limit');
      this.ctx.storage.sql.exec('INSERT INTO pi_developer_turns VALUES(?,?)',key,JSON.stringify(document));await this.ctx.storage.sync();return {replayed:false,usedTurns:used+1};
    });
    this.#reserveTail=next.catch(()=>{});return next;
  }

  reserve(tenantId:string,request:ModelCallRequest) {
    // External historical reads must not allow two workspace reservations to race.
    const next=this.#reserveTail.then(()=>this.#reserve(tenantId,request));
    this.#reserveTail=next.catch(()=>{});
    return next;
  }
  async #reserve(tenantId:string,request:ModelCallRequest) {
    if(this.env.PRIVATE_BETA_POLICY_JSON!==undefined)return this.#betaReserve(tenantId,request);
    if(request.identity.scope.tenantId!==tenantId)throw Error('pi-developer-admission-denied');
    const policy=this.#policy(request.identity.scope,request.actor.userId),core=this.#core(tenantId),prior=await core.lookup(request.identity,request.callId),now=Date.now(),configured=await this.#configured(policy);
    if(request.deadlineAt>policy.expiresAt||request.deadlineAt-now>policy.maxCallDurationMs)throw Error('pi-developer-packet-limit');
    const profile=configured.profile;
    if(request.provider!==profile.inferenceProvider||request.model!==profile.model)throw Error('pi-developer-profile-denied');
    const quote:Quote={policyId:policy.policyId,profileSha256:configured.profileSha256,profile,reservedNanodollars:conservativeCost(profile,request.inputTokenUpperBound,request.maxOutputTokens)};
    const callRows=this.ctx.storage.sql.exec<{call_key:string;turn_key:string}>('SELECT call_key,turn_key FROM model_calls ORDER BY call_key').toArray();
    const quoteRows=this.ctx.storage.sql.exec<{call_key:string;document:string}>('SELECT call_key,document FROM pi_developer_usage ORDER BY call_key').toArray();
    if(callRows.some(row=>!quoteRows.some(quoteRow=>quoteRow.call_key===row.call_key)&&row.call_key!==prior?.callKey))throw Error('pi-developer-usage-missing');
    const current=quoteRows.map(row=>({row,quote:this.#parseQuote(row.document)})).filter(item=>item.quote.policyId===policy.policyId);
    const currentKeys=new Set(current.map(item=>item.row.call_key));
    const turnKey=await modelBudgetTurnKey(request.identity),turnKeys=new Set(callRows.filter(row=>currentKeys.has(row.call_key)).map(row=>row.turn_key));
    const currentCost=current.reduce((sum,item)=>sum+item.quote.reservedNanodollars,0);
    if(!prior&&(current.length>=policy.maxCalls||!turnKeys.has(turnKey)&&turnKeys.size>=policy.maxTurns||currentCost+quote.reservedNanodollars>policy.maxNanodollars))throw Error('pi-developer-packet-limit');
    if(prior&&currentKeys.has(prior.callKey)&&JSON.stringify(this.#quote(prior))!==JSON.stringify(quote))throw Error('pi-developer-policy-conflict');
    if(prior&&!currentKeys.has(prior.callKey)&&(current.length>=policy.maxCalls||!turnKeys.has(turnKey)&&turnKeys.size>=policy.maxTurns||currentCost+quote.reservedNanodollars>policy.maxNanodollars))throw Error('pi-developer-packet-limit');
    if(!prior)await this.assertQuiet(request.identity.scope,request.actor.userId);
    const result=await core.reserve(request);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO pi_developer_usage VALUES(?,?)',result.record.callKey,JSON.stringify(quote));
    await this.ctx.storage.sync();
    return result;
  }

  #parseQuote(value:string):Quote {
    const quote=JSON.parse(value) as Quote;
    if(!quote||typeof quote!=='object'||typeof quote.policyId!=='string'||typeof quote.profileSha256!=='string'||!Number.isSafeInteger(quote.reservedNanodollars)||quote.reservedNanodollars<0)throw Error('pi-developer-usage-invalid');
    productionProfile(quote.profile);
    return quote;
  }
  #quote(record:ModelCallRecord):Quote {
    const row=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM pi_developer_usage WHERE call_key=?',record.callKey).toArray()[0];
    if(!row)throw Error('pi-developer-usage-missing');
    return this.#parseQuote(row.document);
  }
  async dispatch(tenantId:string,reference:ModelCallReference) {
    const core=this.#core(tenantId),record=await core.lookup(reference.identity,reference.callId);
    if(!record)throw Error('pi-developer-admission-denied');
    if(this.#quote(record).privateBeta){
      await authorizePrivateBeta(this.env.CATALOG,record.identity.scope,record.actor);
      const row=this.ctx.storage.sql.exec<{request_json:string}>('SELECT request_json FROM model_calls WHERE call_key=?',record.callKey).one();
      await this.#betaControl().checkDispatch(JSON.parse(row.request_json));
      const result=await core.dispatch(reference);if(!result.authorized)await this.#observeBeta(core,reference);return result;
    }
    const policy=this.#policy(record.identity.scope,record.actor.userId),configured=await this.#configured(policy),quote=this.#quote(record);
    await this.#assertHistoricalIsolation(policy);
    if(quote.policyId!==policy.policyId||quote.profileSha256!==configured.profileSha256)throw Error('pi-developer-profile-denied');
    return core.dispatch(reference);
  }
  async markUnknown(tenantId:string,reference:ModelCallReference) {const core=this.#core(tenantId),result=await core.markUnknown(reference);await this.#observeBeta(core,reference);return result;}
  async finish(tenantId:string,reference:ModelCallReference,terminal:ModelCallTerminal) {const core=this.#core(tenantId),result=await core.finish(reference,terminal);await this.#observeBeta(core,reference);return result;}
  async releaseUndispatched(tenantId:string,reference:ModelCallReference,proof:ModelReleaseProof) {const core=this.#core(tenantId),result=await core.releaseUndispatched(reference,proof);await this.#observeBeta(core,reference);return result;}

  /** Read-only original-call authority for capacity reconciliation after ACK loss. */
  async privateBetaCall(identity:TurnRuntimeIdentity,callId:string){
    const record=await this.#core(identity.scope.tenantId).lookup(identity,callId);
    if(record&&!this.#quote(record).privateBeta)throw Error('private-beta-identity-conflict');
    return record;
  }
  async snapshot(tenantId:string,identity:TurnRuntimeIdentity) {
    const snapshot=await this.#core(tenantId).snapshot(identity);
    const policy=piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON),quotes=this.ctx.storage.sql.exec<{call_key:string;document:string}>('SELECT call_key,document FROM pi_developer_usage').toArray().map(row=>({callKey:row.call_key,quote:this.#parseQuote(row.document)}));
    // Derive costs from the durable terminal, avoiding a second write/ACK gap.
    const usage=snapshot.records.map(record=>{
      const quote=this.#quote(record),tokens=record.terminal?.usage;
      return {callId:record.callId,...quote,
        observedNanodollars:tokens?.kind==='verified'?conservativeCost(quote.profile,tokens.inputTokens,tokens.outputTokens):null,
        billingStatus:record.status==='not-dispatched'?'not-dispatched':tokens?.kind==='verified'?'observed':record.terminal||record.status==='unknown'?'unknown':'pending',
        invoiceVerified:false,
      };
    });
    const current=policy?.schemaVersion===2?quotes.filter(item=>item.quote.policyId===policy.policyId):[],usedTurns=Number(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM pi_developer_turns').toArray()[0]?.n??0);
    return {...snapshot,usage,acceptancePolicy:policy?.schemaVersion===2?{policyId:policy.policyId,projectId:policy.projectId,maxTurns:policy.maxTurns,maxCalls:policy.maxCalls,maxNanodollars:policy.maxNanodollars,maxCallDurationMs:policy.maxCallDurationMs,startsAt:policy.startsAt,expiresAt:policy.expiresAt,usedTurns,usedCalls:current.length,reservedNanodollars:current.reduce((sum,item)=>sum+item.quote.reservedNanodollars,0)}:null};
  }
  async closeTurnAdmission(tenantId:string,identity:TurnRuntimeIdentity) {return this.#core(tenantId).closeTurnAdmission(identity);}
  async turnSettlement(tenantId:string,identity:TurnRuntimeIdentity) {return this.#core(tenantId).turnSettlement(identity);}
}
