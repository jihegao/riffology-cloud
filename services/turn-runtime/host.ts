import type {ToolCommand} from '../tools/protocol.ts';
import { actor, message, turnBaseCheckpoints, turnDigest, type TurnResourceLease } from '../turn/protocol.ts';
import type { TurnRuntimePort } from '../turn/dispatcher.ts';
import { ProductTurnRuntimeCore, readProductTurnArchiveState, storedProductTurnRuntimeIdentity, type ProductTurnRuntimeStorage } from './core.ts';
import { sameTurnRuntimeIdentity, turnRuntimeActorName, turnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import type { ProductTurnRuntimeRelease } from './release.ts';

type RuntimeObjectId={equals(other:unknown):boolean};
type RuntimeNamespace={idFromName(name:string):RuntimeObjectId};
export type ProductTurnRuntimeHostEnv={PRODUCT_TURN_RUNTIME:RuntimeNamespace;M2_TURNS_ENABLED?:unknown};
export type ProductTurnRuntimeReleaseFactory=(ctx:DurableObjectState,env:ProductTurnRuntimeHostEnv,identity:TurnRuntimeIdentity)=>ProductTurnRuntimeRelease|Promise<ProductTurnRuntimeRelease>;

/** Identity-bound host separated from the Cloudflare wrapper so actor and
 * pre-mutation release gates can be verified independently. */
export class ProductTurnRuntimeHost implements TurnRuntimePort{
  readonly #ctx:DurableObjectState;readonly #env:ProductTurnRuntimeHostEnv;readonly #release:ProductTurnRuntimeReleaseFactory;
  #ports:Promise<ProductTurnRuntimeRelease>|null=null;
  #core:{identity:TurnRuntimeIdentity;value:ProductTurnRuntimeCore;project:ProductTurnRuntimeRelease['project']}|null=null;
  #isolationTail:Promise<unknown>=Promise.resolve();
  constructor(ctx:DurableObjectState,env:ProductTurnRuntimeHostEnv,release:ProductTurnRuntimeReleaseFactory){
    if(!ctx?.storage||!env?.PRODUCT_TURN_RUNTIME?.idFromName||typeof release!=='function')throw Error('product-turn-runtime-host-required');
    this.#ctx=ctx;this.#env=env;this.#release=release;
  }
  #cachedCore(){return this.#core?.value??null;}
  async #isolation(identity:TurnRuntimeIdentity){
    if(!this.#ctx.storage.sql?.exec)return null;
    const exists=this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_execution_isolations'").toArray().length;
    if(!exists)return null;
    const digest=await turnDigest(identity),row=this.#ctx.storage.sql.exec<{identity_json:string;fenced_at:number;classification:string}>('SELECT identity_json,fenced_at,classification FROM product_turn_execution_isolations WHERE identity_digest=?',digest).toArray()[0];
    if(!row)return null;
    if(!sameTurnRuntimeIdentity(turnRuntimeIdentity(JSON.parse(row.identity_json)),identity)||!Number.isSafeInteger(row.fenced_at)||row.fenced_at<1||!['runtime-released','runtime-absent-and-fenced'].includes(row.classification))throw Error('product-turn-runtime-isolation-invalid');
    return {identityDigest:digest,fencedAt:row.fenced_at,classification:row.classification as 'runtime-released'|'runtime-absent-and-fenced'};
  }
  async #assertNotIsolated(identity:TurnRuntimeIdentity){if(await this.#isolation(identity))throw Error('product-turn-runtime-isolated');}
  #isolationExclusive<T>(operation:()=>Promise<T>):Promise<T>{
    // Durable Object input gates may interleave at awaits. Runtime creation and
    // an absent-runtime tombstone must therefore share one actor-local critical
    // section so neither can pass a stale pre-await observation of the other.
    const next=this.#isolationTail.then(operation,operation);this.#isolationTail=next.catch(()=>{});return next;
  }
  async #assertActor(identity:TurnRuntimeIdentity){const expected=this.#env.PRODUCT_TURN_RUNTIME.idFromName(await turnRuntimeActorName(identity));if(!expected.equals(this.#ctx.id))throw Error('product-turn-runtime-actor-scope-denied');}
  async #for(raw:TurnRuntimeIdentity,existingOnly=false):Promise<ProductTurnRuntimeCore>{
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);
    if(this.#core){if(!sameTurnRuntimeIdentity(this.#core.identity,identity))throw Error('product-turn-runtime-scope-denied');return this.#core.value;}
    // The release factory must succeed before ProductTurnRuntimeCore creates
    // its SQLite table or reserves an external execution.
    if(existingOnly&&!this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length)throw Error('product-turn-observer-denied');
    let ports:ProductTurnRuntimeRelease;try{ports=await (this.#ports??=Promise.resolve(this.#release(this.#ctx,this.#env,identity)));}catch(error){this.#ports=null;throw error;}
    const initialized=this.#cachedCore();if(initialized)return initialized;
    if(!ports?.execution||!ports.checkpoints)throw Error('product-turn-runtime-release-not-configured');
    const value=new ProductTurnRuntimeCore(this.#ctx.storage as ProductTurnRuntimeStorage,ports.execution,ports.checkpoints,Date.now,existingOnly,{retryMs:5000,assignmentGuardMs:360000,quietMs:30000,deadlineMs:600000,holdRetryMs:60000},ports.capacity??null,ports.trace,ports.retention??null);
    this.#core={identity,value,project:ports.project};return value;
  }
  accept(raw:Omit<Parameters<TurnRuntimePort['accept']>[0],'capacityLease'>&{capacityLease?:TurnResourceLease}){return this.#isolationExclusive(()=>this.#accept(raw));}
  async #accept(raw:Omit<Parameters<TurnRuntimePort['accept']>[0],'capacityLease'>&{capacityLease?:TurnResourceLease}){
    const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});
    await this.#assertActor(identity);
    await this.#assertNotIsolated(identity);
    if(this.#env.M2_TURNS_ENABLED!=='true'){
      if(!this.#ctx.storage.sql?.exec)throw Error('product-turn-runtime-release-not-configured');
      const table=this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length;
      const exists=table&&this.#ctx.storage.sql.exec('SELECT singleton FROM product_turn_runtime WHERE singleton=1').toArray().length;
      if(!exists)throw Error('product-turn-runtime-release-not-configured');
    }
    const input={...identity,actor:actor(raw.actor),message:message(raw.message),base:turnBaseCheckpoints(raw.base),...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})};
    return (await this.#for(identity)).accept(input);
  }
  async workspaceRuntimeState(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw),core=await this.#for(identity,true);await core.ready();return core.workspaceRuntimeState(identity);}
  archiveRuntimeResources(raw:TurnRuntimeIdentity){return this.#isolationExclusive(async()=>{
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);
    const isolation=await this.#isolation(identity),runtime=readProductTurnArchiveState(this.#ctx.storage,identity);
    if(isolation&&runtime&&(isolation.classification==='runtime-absent-and-fenced'||runtime.phase!=='terminal'||runtime.resourceDisposition?.status!=='released'))throw Error('product-turn-runtime-isolation-invalid');
    return {identity,runtime,isolation};
  });}
  fenceExecution(raw:TurnRuntimeIdentity){return this.#isolationExclusive(()=>this.#fenceExecution(raw));}
  async #fenceExecution(raw:TurnRuntimeIdentity){
    const identity=turnRuntimeIdentity(raw);await this.#assertActor(identity);const prior=await this.#isolation(identity);if(prior)return {...prior,runtime:null};
    const table=this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length;
    const exists=table&&this.#ctx.storage.sql.exec('SELECT singleton FROM product_turn_runtime WHERE singleton=1').toArray().length;
    let runtime:ReturnType<ProductTurnRuntimeCore['workspaceRuntimeState']>|null=null;
    if(exists){const core=await this.#for(identity,true);await core.ready();runtime=core.workspaceRuntimeState(identity);if(runtime.phase!=='terminal'||runtime.resourceDisposition.status!=='released'||runtime.executionDeadlineAt!==null&&runtime.executionDeadlineAt>Date.now())throw Error('product-turn-runtime-isolation-denied');}
    const identityDigest=await turnDigest(identity),fencedAt=Date.now(),classification=runtime?'runtime-released' as const:'runtime-absent-and-fenced' as const;
    this.#ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS product_turn_execution_isolations(identity_digest TEXT PRIMARY KEY,identity_json TEXT NOT NULL,fenced_at INTEGER NOT NULL,classification TEXT NOT NULL CHECK(classification IN ('runtime-released','runtime-absent-and-fenced'))) STRICT");
    this.#ctx.storage.sql.exec('INSERT OR IGNORE INTO product_turn_execution_isolations VALUES(?,?,?,?)',identityDigest,JSON.stringify(identity),fencedAt,classification);await this.#ctx.storage.sync();
    const stored=await this.#isolation(identity);if(!stored)throw Error('product-turn-runtime-isolation-unconfirmed');
    return {...stored,runtime};
  }
  async projectPreparationRequired(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);await (await this.#for(identity,true)).ready();return this.#core?.project?.lazy===true;}
  async prepareProjectTool(input:{identity:TurnRuntimeIdentity;command:ToolCommand;observeOnly:boolean}){
    const identity=turnRuntimeIdentity(input.identity),core=await this.#for(identity,true);await core.ready();
    if(!this.#core?.project?.lazy)return {ready:true as const};
    const authorize=()=>{core.projectToolAuthority(identity,input.command);};const deadline=core.projectToolAuthority(identity,input.command);
    if(typeof input.observeOnly!=='boolean')throw Error('project-preparation-denied');
    if(this.#core?.project)await this.#core.project.ensure(deadline,input.observeOnly,authorize);
    authorize();return {ready:true as const};
  }
  async currentObserverExecution(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return (await this.#for(identity,true)).currentObserverExecution(identity);}
  async observe(raw:Parameters<TurnRuntimePort['observe']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});await this.#assertNotIsolated(identity);return (await this.#for(identity)).observe({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
  async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]){const identity=turnRuntimeIdentity({scope:raw.scope,sessionId:raw.sessionId,turnId:raw.turnId,dispatchId:raw.dispatchId,generation:raw.generation});await this.#assertNotIsolated(identity);return (await this.#for(identity)).cancel({...identity,...(raw.capacityLease===undefined?{}:{capacityLease:raw.capacityLease})});}
  async alarm(){
    if(this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_execution_isolations'").toArray().length&&this.#ctx.storage.sql.exec('SELECT 1 FROM product_turn_execution_isolations LIMIT 1').toArray().length)return;
    if(!this.#ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='product_turn_runtime'").toArray().length)return;
    const row=this.#ctx.storage.sql.exec<{value:string}>('SELECT value FROM product_turn_runtime WHERE singleton=1').toArray()[0];if(!row)return;
    const identity=storedProductTurnRuntimeIdentity(JSON.parse(row.value));try{await (await this.#for(identity)).maintenance(identity);}catch(error){if(error instanceof Error&&['product-turn-release-pending','product-turn-release-unconfirmed'].includes(error.message))return;throw error;}
  }
}
