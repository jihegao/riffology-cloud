import {DurableObject} from 'cloudflare:workers';
import {SqlTenantModelBudget, modelBudgetTenantName, type ModelCallRequest, type ModelCallReference, type ModelCallTerminal, type ModelReleaseProof, type ModelCallRecord} from './core.ts';
import {piDeveloperPolicy, piDeveloperOwner} from './pi-developer-policy.ts';
import {productionProfile, profileDigest, conservativeCost, type ProductionProfile} from '../model-proxy/production-profile.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {TurnScope} from '../turn/protocol.ts';

type HistoricalLedger = {getByName(name:string):{assertExecutionQuiet(tenantId:string):Promise<void>}};
interface Env {
  G4_CONTROLLED_WINDOW_JSON?:string;
  G5_CONTROLLED_WINDOW_JSON?:string;
  TENANT_MODEL_BUDGET?:HistoricalLedger;
  G5_TOKEN_BUDGET?:HistoricalLedger;
  PI_DEVELOPER_POLICY_JSON?:string;
  PI_DEVELOPER_BUDGET:DurableObjectNamespace<PiDeveloperBudget>;
  PRODUCTION_MODEL_PROFILE_JSON:string;
  M2_MODEL_BUDGET_POLICY_VERSION:string;
}
type Quote = {policyId:string; profileSha256:string; profile:ProductionProfile; reservedNanodollars:number};

/** Separate accounting with no monetary admission cap. Actor identity does not
 * depend on policy/period IDs, so policy changes cannot erase unknown execution. */
export class PiDeveloperBudget extends DurableObject<Env> {
  #ledger:SqlTenantModelBudget|null=null;
  #reserveTail:Promise<unknown>=Promise.resolve();

  #core(tenantId:string) {
    if(!this.env.PI_DEVELOPER_BUDGET.idFromName(modelBudgetTenantName(tenantId)).equals(this.ctx.id))throw Error('pi-developer-actor-denied');
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON));
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS pi_developer_usage(call_key TEXT PRIMARY KEY,document TEXT NOT NULL)');
    // These are per-turn operational bounds; they do not settle or cap money.
    return this.#ledger??=new SqlTenantModelBudget(this.ctx.storage,{
      tenantId,version:this.env.M2_MODEL_BUDGET_POLICY_VERSION,
      maxReservationAttemptsPerTurn:128,maxDispatchedCallsPerTurn:64,
      maxInputTokensPerCall:profile.limits.maxInputTokens,maxOutputTokensPerCall:profile.limits.maxOutputTokens,
      maxReservedTokensPerTurn:4194304,
    });
  }

  async assertQuiet(scope:TurnScope,userId:string) {
    const core=this.#core(scope.tenantId);
    if(!piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,scope.tenantId,userId))throw Error('pi-developer-admission-denied');
    // A fresh namespace must not bypass unknown execution in a closed window.
    if(this.env.G4_CONTROLLED_WINDOW_JSON!==undefined&&!this.env.TENANT_MODEL_BUDGET ||
       this.env.G5_CONTROLLED_WINDOW_JSON!==undefined&&!this.env.G5_TOKEN_BUDGET)throw Error('pi-developer-historical-ledger-unavailable');
    for(const namespace of [this.env.TENANT_MODEL_BUDGET,this.env.G5_TOKEN_BUDGET]) {
      if(namespace)await namespace.getByName(modelBudgetTenantName(scope.tenantId)).assertExecutionQuiet(scope.tenantId);
    }
    await core.assertExecutionQuiet();
  }

  reserve(tenantId:string,request:ModelCallRequest) {
    // External historical reads must not allow two workspace reservations to race.
    const next=this.#reserveTail.then(()=>this.#reserve(tenantId,request));
    this.#reserveTail=next.catch(()=>{});
    return next;
  }
  async #reserve(tenantId:string,request:ModelCallRequest) {
    if(!piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,tenantId,request.actor.userId)||request.identity.scope.tenantId!==tenantId)throw Error('pi-developer-admission-denied');
    const core=this.#core(tenantId),prior=await core.lookup(request.identity,request.callId);
    if(!prior)await this.assertQuiet(request.identity.scope,request.actor.userId);
    const profile=productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON));
    if(request.provider!==profile.inferenceProvider||request.model!==profile.model)throw Error('pi-developer-profile-denied');
    const quote:Quote={policyId:piDeveloperPolicy(this.env.PI_DEVELOPER_POLICY_JSON)!.policyId,profileSha256:await profileDigest(profile),profile,reservedNanodollars:conservativeCost(profile,request.inputTokenUpperBound,request.maxOutputTokens)};
    const result=await core.reserve(request);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO pi_developer_usage VALUES(?,?)',result.record.callKey,JSON.stringify(quote));
    await this.ctx.storage.sync();
    return result;
  }

  #quote(record:ModelCallRecord):Quote {
    const row=this.ctx.storage.sql.exec<{document:string}>('SELECT document FROM pi_developer_usage WHERE call_key=?',record.callKey).toArray()[0];
    if(!row)throw Error('pi-developer-usage-missing');
    return JSON.parse(row.document);
  }
  async dispatch(tenantId:string,reference:ModelCallReference) {
    const core=this.#core(tenantId),record=await core.lookup(reference.identity,reference.callId);
    if(!record||!piDeveloperOwner(this.env.PI_DEVELOPER_POLICY_JSON,tenantId,record.actor.userId))throw Error('pi-developer-admission-denied');
    if(this.#quote(record).profileSha256!==await profileDigest(productionProfile(JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON))))throw Error('pi-developer-profile-denied');
    return core.dispatch(reference);
  }
  async markUnknown(tenantId:string,reference:ModelCallReference) {return this.#core(tenantId).markUnknown(reference);}
  async finish(tenantId:string,reference:ModelCallReference,terminal:ModelCallTerminal) {return this.#core(tenantId).finish(reference,terminal);}
  async releaseUndispatched(tenantId:string,reference:ModelCallReference,proof:ModelReleaseProof) {return this.#core(tenantId).releaseUndispatched(reference,proof);}

  async snapshot(tenantId:string,identity:TurnRuntimeIdentity) {
    const snapshot=await this.#core(tenantId).snapshot(identity);
    // Derive costs from the durable terminal, avoiding a second write/ACK gap.
    const usage=snapshot.records.map(record=>{
      const quote=this.#quote(record),tokens=record.terminal?.usage;
      return {callId:record.callId,...quote,
        observedNanodollars:tokens?.kind==='verified'?conservativeCost(quote.profile,tokens.inputTokens,tokens.outputTokens):null,
        billingStatus:record.status==='not-dispatched'?'not-dispatched':tokens?.kind==='verified'?'observed':record.terminal||record.status==='unknown'?'unknown':'pending',
        invoiceVerified:false,
      };
    });
    return {...snapshot,usage};
  }
  async closeTurnAdmission(tenantId:string,identity:TurnRuntimeIdentity) {return this.#core(tenantId).closeTurnAdmission(identity);}
  async turnSettlement(tenantId:string,identity:TurnRuntimeIdentity) {return this.#core(tenantId).turnSettlement(identity);}
}
