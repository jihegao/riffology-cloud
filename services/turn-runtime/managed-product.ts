import {DurableObject} from 'cloudflare:workers';
import type {TurnRuntimePort,TurnRuntimeReceipt} from '../turn/dispatcher.ts';
import {sameScope,turnDigest,turnId,turnBaseCheckpoints,actor as validateActor,message as validateMessage,type TurnScope,type TurnActor,type CheckpointReceipt} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from './identity.ts';
import {SqlExecutionBindingStore,type ExecutionBinding} from './backend-contract.ts';
import {ManagedExecutionAdapter,type ManagedInput,type ManagedObservation} from './managed-adapter.ts';
import {ManagedSdkTransport,type ManagedPaidAdmission} from './managed-sdk-transport.ts';
import {revisionStoreActorName,type RevisionStoreNamespace} from './revision-store-client.ts';
import {packageCandidateModel} from './candidate-artifact.ts';
import {managedRunner} from './managed-runner.ts';
import {managedAcceptancePolicy,type ManagedAcceptancePolicy} from '../workspace/managed-route.ts';

type AbsentReceipt=Extract<TurnRuntimeReceipt,{phase:'absent'}>;
type Accepted=Parameters<TurnRuntimePort['accept']>[0];
type RecordState={input:Accepted;managedInput:ManagedInput;reserved:boolean;operation:'create'|'continue'|null;observation:ManagedObservation|null;checkpoint:CheckpointReceipt|null;persistenceError:string|null;closed:boolean;cleanupRequested:boolean;cost:number|null;cancelRequested:boolean;receipt:TurnRuntimeReceipt|null};
type Budget={policy:ManagedAcceptancePolicy;startedAt:number|null;stopped:string|null;simulations:string[]};
export interface ManagedProductEnv {MANAGED_TURN_RUNTIME:DurableObjectNamespace<ManagedProductRuntime>;MANAGED_ACCEPTANCE_JSON?:string;MANAGED_OPENAI_API_KEY?:string;REVISION_STORE:RevisionStoreNamespace;}
export const managedProductActorName=(scope:TurnScope)=>`managed-product-v1:${scope.tenantId}:${scope.projectId}`;
const identityOf=(input:Parameters<TurnRuntimePort['observe']>[0])=>turnRuntimeIdentity({scope:input.scope,sessionId:input.sessionId,turnId:input.turnId,dispatchId:input.dispatchId,generation:input.generation});
const rowKey=(identity:TurnRuntimeIdentity)=>`turn:${identity.turnId}`;

/** Private project-scoped adapter authority. TurnJournal remains the business
 * Turn/head authority; these records bind provider effects, not a second UI FSM.
 * Remote terminal releases the adapter's input slot, never a Pi native fence.
 * Hosted Session retention/deletion is tracked separately until explicit cleanup.
 */
export class ManagedProductRuntime extends DurableObject<ManagedProductEnv> implements ManagedPaidAdmission {
 #serial:Promise<unknown>=Promise.resolve();
 #run<T>(fn:()=>Promise<T>):Promise<T>{const next=this.#serial.then(fn,fn);this.#serial=next.catch(()=>{});return next;}
 #store(){return new SqlExecutionBindingStore(this.ctx.storage);}
 #transport(){return new ManagedSdkTransport({apiKey:this.env.MANAGED_OPENAI_API_KEY??'',store:this.#store(),admission:this});}
 #adapter(transport=this.#transport()){return new ManagedExecutionAdapter({store:this.#store(),transport});}
 #budget(){return this.ctx.storage.kv.get<Budget>('budget');}
 #rows(){return Array.from(this.ctx.storage.kv.list<RecordState>({prefix:'turn:'}),([,row])=>row);}
 async #put(row:RecordState){this.ctx.storage.kv.put(rowKey(identityOf(row.input)),row);await this.ctx.storage.sync();}
 #policy(scope:TurnScope,actor?:TurnActor){
  const policy=managedAcceptancePolicy(this.env.MANAGED_ACCEPTANCE_JSON);
  if(!policy||!policy.enabled||!sameScope(policy.scope,scope)||actor&&policy.userId!==actor.userId)throw Error('managed-project-route-denied');
  return policy;
 }
 #owned(scope:TurnScope){if(!this.env.MANAGED_TURN_RUNTIME.idFromName(managedProductActorName(scope)).equals(this.ctx.id))throw Error('managed-project-actor-scope-denied');const budget=this.#budget();if(budget&&!sameScope(budget.policy.scope,scope))throw Error('managed-project-scope-denied');return budget;}
 #currentBudget(scope:TurnScope,actor:TurnActor){
  const policy=this.#policy(scope,actor),saved=this.#owned(scope);
  if(saved&&JSON.stringify({...saved.policy,enabled:true})!==JSON.stringify({...policy,enabled:true}))throw Error('managed-policy-immutable');
  return saved??{policy,startedAt:null,stopped:null,simulations:[]};
 }
 async preflight(scope:TurnScope,actor:TurnActor){return this.#run(async()=>{
  const budget=this.#currentBudget(scope,validateActor(actor));this.#checkAdmission(budget);
  if(!this.env.MANAGED_OPENAI_API_KEY)throw Error('managed-key-not-configured');return {allowed:true,policyId:budget.policy.policyId};
 });}
 #checkAdmission(budget:Budget){
  if(budget.stopped)throw Error(budget.stopped);
  if(budget.startedAt!==null&&Date.now()>=budget.startedAt+budget.policy.maxDurationMs)throw Error('managed-window-expired');
  const rows=this.#rows().filter(r=>r.reserved);
  if(rows.some(r=>r.cleanupRequested&&!r.closed))throw Error('managed-cleanup-unconfirmed');
  if(rows.some(r=>!r.observation||r.observation.execution==='unknown'||r.observation.execution==='running'||r.cost===null))throw Error('managed-original-unresolved');
  if(rows.length>=budget.policy.maxTurns)throw Error('managed-turn-limit');
  if(rows.reduce((n,r)=>n+(r.cost??0),0)>=budget.policy.observedStopUsd)throw Error('managed-observed-cost-limit');
 }
 async reserve(binding:ExecutionBinding,operation:'create'|'continue',input:ManagedInput){
  // Called inside a serialized accept; durable policy and input precede POST.
  const budget=this.#currentBudget(input.identity.scope,input.actor);this.#checkAdmission(budget);
  const row=this.ctx.storage.kv.get<RecordState>(rowKey(input.identity));
  if(!row||row.reserved||binding.inputSha256!==await turnDigest(input))throw Error('managed-paid-reservation-conflict');
  const rows=this.#rows().filter(r=>r.reserved),sessions=rows.filter(r=>r.operation==='create');
  if(operation==='create'&&(sessions.length>=budget.policy.maxSessions||rows.some(r=>!r.closed)))throw Error('managed-session-limit-or-cleanup-pending');
  const hold=(rows.length+1)*0.75+(sessions.length+(operation==='create'?1:0))*0.25;
  if(hold>budget.policy.observedStopUsd)throw Error('managed-reservation-limit');
  if(budget.startedAt===null)budget.startedAt=Date.now();row.reserved=true;row.operation=operation;
  this.ctx.storage.transactionSync(()=>{this.ctx.storage.kv.put('budget',budget);this.ctx.storage.kv.put(rowKey(input.identity),row);});
  await this.ctx.storage.sync();await this.ctx.storage.setAlarm(Math.min(Date.now()+5000,budget.startedAt+budget.policy.maxDurationMs));
 }
 async readInput(binding:ExecutionBinding){const row=this.ctx.storage.kv.get<RecordState>(rowKey(binding.identity));return row?.managedInput??null;}
 async #absent(raw:Parameters<TurnRuntimePort['observe']>[0],cancelIntent:boolean):Promise<AbsentReceipt>{
  const identity=identityOf(raw);this.#owned(identity.scope);
  const policy=managedAcceptancePolicy(this.env.MANAGED_ACCEPTANCE_JSON);
  if(!policy||!sameScope(policy.scope,identity.scope))throw Error('managed-project-scope-denied');
  const capacityLease={operationId:turnId(raw.capacityLease?.operationId),leaseId:turnId(raw.capacityLease?.leaseId)};
  const key=`cancel-before-accept:${identity.turnId}`,prior=this.ctx.storage.kv.get<AbsentReceipt>(key);
  if(prior){
   if(await turnDigest(identityOf(prior))!==await turnDigest(identity)||prior.resourceDisposition.operationId!==capacityLease.operationId||prior.resourceDisposition.leaseId!==capacityLease.leaseId)throw Error('managed-original-scope-denied');
   return prior;
  }
  // A missing journal row is not an absence proof when a durable side-effect
  // binding exists. Never query or infer provider absence to override it.
  const binding=await this.#store().read(identity),row=this.ctx.storage.kv.get<RecordState>(rowKey(identity));
  if(binding&&(!row||row.reserved||binding.remoteTurnId!==null))throw Error('managed-original-unresolved');
  const receipt:AbsentReceipt={schemaVersion:1,backend:'managed-agents',...identity,phase:'absent',outcome:null,executionErrorCode:null,events:[],checkpoint:null,persistenceErrorCode:null,stopped:null,resourceDisposition:{status:'released',...capacityLease,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation,proofId:await turnDigest({identity,capacityLease,kind:'managed-never-started'}),releasedAt:Date.now()}};
  if(cancelIntent){this.ctx.storage.kv.put(key,receipt);await this.ctx.storage.sync();}
  return receipt;
 }
 async #resumeUnreserved(row:RecordState):Promise<TurnRuntimeReceipt>{
  const identity=identityOf(row.input);this.#checkAdmission(this.#currentBudget(identity.scope,row.input.actor));
  const previous=row.input.base.session?this.#rows().find(r=>r!==row&&r.checkpoint&&JSON.stringify(r.checkpoint)===JSON.stringify(row.input.base.session)):undefined;
  if(row.input.base.session&&(!previous||previous.closed||!previous.receipt))throw Error('managed-session-base-unavailable');
  const prior=previous?await this.#store().read(identityOf(previous.input)):null,binding=await this.#store().read(identity),transport=this.#transport();
  if(binding){
   if(binding.remoteTurnId!==null||binding.remoteSessionId!==(prior?.remoteSessionId??null)||binding.inputSha256!==await turnDigest(row.managedInput))throw Error('managed-unreserved-binding-conflict');
   // Paid reservation is durably false, proving no provider request happened.
   // Resume the persisted original only; reserved inputs are never replayed.
   try{if(prior?.remoteSessionId)await transport.continue(row.managedInput,prior.remoteSessionId);else await transport.create(row.managedInput);}catch{/* Reconcile the original; never retry a now-reserved input. */}
  }else await this.#adapter(transport).accept(row.managedInput,prior??undefined);
  return this.#observe(this.ctx.storage.kv.get<RecordState>(rowKey(identity))!);
 }
 async accept(raw:Accepted){return this.#run(async()=>{
  const identity=identityOf(raw),input={...raw,...identity,actor:validateActor(raw.actor),message:validateMessage(raw.message),base:turnBaseCheckpoints(raw.base)};
  this.#owned(identity.scope);
  if(this.ctx.storage.kv.get(`cancel-before-accept:${identity.turnId}`))throw Error('managed-cancelled-before-accept');
  const existing=this.ctx.storage.kv.get<RecordState>(rowKey(identity));
  if(existing){if(await turnDigest(existing.input)!==await turnDigest(input))throw Error('managed-accept-conflict');return existing.reserved?this.#observe(existing):this.#resumeUnreserved(existing);}
  this.#checkAdmission(this.#currentBudget(identity.scope,input.actor));if(this.#rows().some(r=>!sameScope(r.input.scope,identity.scope)))throw Error('managed-project-scope-denied');
  const sessionRows=this.#rows().filter(r=>r.input.sessionId===identity.sessionId&&r.reserved);
  let previous:RecordState|undefined;
  if(sessionRows.length){
   if(!input.base.session||sessionRows.some(r=>r.closed||!r.receipt))throw Error('managed-session-base-unavailable');
   const matches=sessionRows.filter(r=>r.checkpoint&&JSON.stringify(r.checkpoint)===JSON.stringify(input.base.session));
   if(matches.length!==1||sessionRows.some(r=>r.input.base.session?.revisionId===input.base.session!.revisionId))throw Error('managed-session-base-unavailable');
   previous=matches[0];
  }else if(input.base.session)throw Error('managed-session-base-unavailable');
  if(!previous){const paid=this.#rows().filter(r=>r.reserved),policy=this.#currentBudget(identity.scope,input.actor).policy;if(paid.filter(r=>r.operation==='create').length>=policy.maxSessions||paid.some(r=>!r.closed))throw Error('managed-session-limit-or-cleanup-pending');}
  const managedInput:ManagedInput={identity,actor:input.actor,message:input.message,base:input.base};
  const row:RecordState={input,managedInput,reserved:false,operation:null,observation:null,checkpoint:null,persistenceError:null,closed:false,cleanupRequested:false,cost:null,cancelRequested:false,receipt:null};
  await this.#put(row);const prior=previous?await this.#store().read(identityOf(previous.input)):null;
  await this.#adapter().accept(managedInput,prior??undefined);
  return this.#observe(this.ctx.storage.kv.get<RecordState>(rowKey(identity))!);
 });}
 async observe(raw:Parameters<TurnRuntimePort['observe']>[0]){return this.#run(async()=>{const identity=identityOf(raw);this.#owned(identity.scope);const row=this.ctx.storage.kv.get<RecordState>(rowKey(identity));if(!row)return this.#absent(raw,false);if(await turnDigest(identityOf(row.input))!==await turnDigest(identity))throw Error('managed-original-scope-denied');if(!row.reserved)return this.#absent(raw,false);return this.#observe(row);});}
 async cancel(raw:Parameters<TurnRuntimePort['cancel']>[0]){return this.#run(async()=>{const identity=identityOf(raw);this.#owned(identity.scope);const row=this.ctx.storage.kv.get<RecordState>(rowKey(identity));if(!row)return this.#absent(raw,true);if(await turnDigest(identityOf(row.input))!==await turnDigest(identity))throw Error('managed-original-scope-denied');if(!row.reserved)return this.#absent(raw,true);row.cancelRequested=true;await this.#put(row);await this.#adapter().cancel(identity);return this.#observe(row);});}
 async #observe(row:RecordState):Promise<TurnRuntimeReceipt>{
  if(row.receipt)return row.receipt;
  const identity=identityOf(row.input),transport=this.#transport(),adapter=this.#adapter(transport),binding=await this.#store().read(identity);
  const common={schemaVersion:1 as const,backend:'managed-agents' as const,...identity,executionErrorCode:null,events:[] as ManagedObservation['events'],checkpoint:null,persistenceErrorCode:null,stopped:null};
  const resource={...row.input.capacityLease,turnId:identity.turnId,dispatchId:identity.dispatchId,generation:identity.generation};
  if(!binding)return {...common,phase:'unknown',outcome:null,resourceDisposition:{...resource,status:'active'}};
  if(Date.now()>=binding.reservedAt+300000&&!row.cancelRequested){row.cancelRequested=true;await this.#put(row);await adapter.cancel(identity);}
  const observed=row.observation&&!['running','unknown'].includes(row.observation.execution)?row.observation:await adapter.observe(identity);row.observation=observed;await this.#put(row);
  if(observed.execution==='running'||observed.execution==='unknown'){
   if(observed.execution==='unknown')await this.#stop('managed-execution-unknown');
   await this.ctx.storage.setAlarm(Date.now()+5000);
   return {...common,events:observed.events,phase:observed.execution,outcome:null,resourceDisposition:{...resource,status:'active'}};
  }
  const bound=(await this.#store().read(identity))!;
  if(observed.usage.status==='observed')row.cost=observed.usage.inputTokens*0.5/1e6+observed.usage.outputTokens*1.8/1e6;
  else await this.#stop('managed-usage-unknown');
  if(row.cost!==null&&row.cost>0.75)await this.#stop('managed-observed-cost-exceeds-hold');
  const store=this.env.REVISION_STORE.getByName(revisionStoreActorName(identity.scope));
  const pendingCheckpoint=async()=>{await this.#put(row);await this.ctx.storage.setAlarm(Date.now()+5000);return {...common,events:observed.events,phase:'running' as const,outcome:null,resourceDisposition:{...resource,status:'active' as const}};};
  if(!row.checkpoint&&!row.persistenceError){
   // The immutable original manifest may already exist after a lost commit ACK.
   // Reconcile it before any provider artifact read or repeated publication.
   try{row.checkpoint=await store.observe(identity);}catch{return pendingCheckpoint();}
   if(!row.checkpoint){
    let filesArchive:Uint8Array|undefined;
    if(observed.execution==='completed'){
     let bytes=this.ctx.storage.kv.get<Uint8Array>(`candidate:${identity.turnId}`);
     if(!bytes){
      try{
       const matches=[];let count=0;
       for await(const artifact of transport.client.beta.agents.sessions.artifacts.list(bound.remoteSessionId!,{limit:100})){
        if(++count>256)throw Error('managed-artifact-list-limit');
        if(artifact.turn_id===bound.remoteTurnId&&artifact.path==='/workspace/outputs/candidate.json')matches.push(artifact);
       }
       if(matches.length!==1)throw Error('managed-candidate-artifact-ambiguous');
       bytes=await adapter.download(identity,matches[0].id);
       if(bytes.byteLength>512*1024)throw Error('managed-candidate-too-large');
       // Freeze actual bytes before validation; retries never replace this candidate.
       this.ctx.storage.kv.put(`candidate:${identity.turnId}`,bytes);await this.ctx.storage.sync();
      }catch(error){
       const code=error instanceof Error?error.message:'';
       const definitive=/^managed-(?:artifact-list-limit|candidate-artifact-ambiguous|candidate-too-large|artifact-scope-or-size-denied|artifact-size-mismatch)$/.test(code);
       if(!definitive&&Date.now()<binding.reservedAt+300000)return pendingCheckpoint();
       row.persistenceError=definitive?code:'managed-artifact-read-deadline';await this.#stop(row.persistenceError);
      }
     }
     if(bytes&&!row.persistenceError){
      try{
       const candidate=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
       if(!candidate||candidate.schemaVersion!==1||Object.keys(candidate).sort().join()!=='files,schemaVersion,spec'||!candidate.files||Object.keys(candidate.files).sort().join()!=='app/requirements.lock,model/model.py,model/results.json'||Object.values(candidate.files).some(v=>typeof v!=='string'||new TextEncoder().encode(v).length>128*1024))throw Error('managed-candidate-schema');
       const files=Object.fromEntries(Object.entries(candidate.files).map(([path,text])=>[path,new TextEncoder().encode(text as string)]));
       files['model/run.py']=new TextEncoder().encode(managedRunner);
       files['model/visualization.json']=new TextEncoder().encode(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'lane',metricKeys:['completed','mean_wait']}));
       filesArchive=packageCandidateModel(files,candidate.spec);
      }catch(error){row.persistenceError=error instanceof Error&&/^[a-z0-9-]+$/.test(error.message)?error.message:'managed-candidate-invalid';await this.#stop(row.persistenceError);}
     }
    }else{
     const prior=this.#rows().find(r=>r.checkpoint?.revisionId===row.input.base.workspace?.revisionId);
     try{
      if(prior?.checkpoint)filesArchive=(await store.restore(identityOf(prior.input),prior.checkpoint)).filesArchive;
      else if(row.input.base.initial)filesArchive=(await store.resolveInitial(row.input.base.initial.reference,identity.scope)).filesArchive;
      else{row.persistenceError='managed-base-files-unavailable';await this.#stop(row.persistenceError);}
     }catch{return pendingCheckpoint();}
    }
    if(filesArchive&&!row.persistenceError){
     // Transport uncertainty is not candidate invalidity. Original identity,
     // frozen bytes and base remain unchanged until authoritative reconciliation.
     let result;
     try{result=await store.commit({identity,outcome:observed.execution,executionErrorCode:observed.execution==='completed'?null:`managed-${observed.execution}`,base:row.input.base,snapshot:{identity,filesArchive,backendState:{schemaVersion:1,backend:'managed-agents',recovery:'files-only'}}});}
     catch{return pendingCheckpoint();}
     if(result.status==='committed')row.checkpoint=result.receipt;
     else if(result.status==='conflict'||result.status==='aborted'){row.persistenceError=`turn-checkpoint-${result.status}`;await this.#stop(row.persistenceError);}
     else return pendingCheckpoint();
    }
   }
  }
  const confirmationId=await turnDigest({identity,remoteSessionId:bound.remoteSessionId,remoteTurnId:bound.remoteTurnId,terminal:observed.execution});
  row.receipt={...common,phase:'terminal',outcome:observed.execution,events:[...observed.events,{eventId:await turnDigest({identity,kind:'usage'}),type:'provider.status',at:Date.now(),payload:{backend:'managed-agents',usage:observed.usage,billing:'pending',resources:'session-retained'}}],executionErrorCode:observed.execution==='completed'?null:`managed-${observed.execution}`,checkpoint:row.checkpoint,persistenceErrorCode:row.checkpoint?null:row.persistenceError??'turn-checkpoint-unavailable',stopped:{kind:'remote-terminal',confirmationId,observedAt:Date.now(),remoteSessionId:bound.remoteSessionId!,remoteTurnId:bound.remoteTurnId!,terminalStatus:observed.execution},resourceDisposition:{...resource,status:'released',proofId:confirmationId,releasedAt:Date.now()}};
  await this.#put(row);return row.receipt;
 }
 async #stop(reason:string){const budget=this.#budget();if(budget&&!budget.stopped){budget.stopped=reason;this.ctx.storage.kv.put('budget',budget);await this.ctx.storage.sync();}}
 async budgetStatus(scope:TurnScope){return this.#run(async()=>this.#status(scope));}
 async #status(scope:TurnScope){const budget=this.#owned(scope),rows=this.#rows(),paid=rows.filter(r=>r.reserved);return {policy:budget?.policy??this.#policy(scope),startedAt:budget?.startedAt??null,deadline:budget?.startedAt?budget.startedAt+budget.policy.maxDurationMs:null,turnCount:paid.length,sessionCount:paid.filter(r=>r.operation==='create').length,liveSessions:new Set(paid.filter(r=>!r.closed).map(r=>r.input.sessionId)).size,unresolved:paid.filter(r=>!r.observation||['running','unknown'].includes(r.observation.execution)||r.cost===null).length,cleanupPending:paid.some(r=>r.cleanupRequested&&!r.closed),observedUsd:paid.reduce((s,r)=>s+(r.cost??0),0),reservedUsd:paid.length*.75+paid.filter(r=>r.operation==='create').length*.25,stopped:budget?.stopped??null,billingSettled:false,simulationCount:budget?.simulations.length??0,records:await Promise.all(rows.map(async r=>({remoteSessionHash:await this.#store().read(identityOf(r.input)).then(b=>b?.remoteSessionId?turnDigest(b.remoteSessionId):null),identity:identityOf(r.input),execution:r.observation?.execution??'unknown',checkpoint:r.checkpoint,closed:r.closed,usage:r.observation?.usage??{status:'unknown'},cost:r.cost}))) };}
 async reserveSimulation(scope:TurnScope,runId:string){return this.#run(async()=>{
  const budget=this.#owned(scope);if(!budget)throw Error('managed-budget-not-started');this.#policy(scope);
  if(budget.stopped||!budget.startedAt||Date.now()>=budget.startedAt+budget.policy.maxDurationMs)throw Error('managed-window-closed');
  if(budget.simulations.includes(runId))return {reserved:true};
  if(budget.simulations.length>=budget.policy.maxSimulationRuns)throw Error('managed-simulation-limit');
  budget.simulations.push(runId);this.ctx.storage.kv.put('budget',budget);await this.ctx.storage.sync();return {reserved:true};
 });}
 async cleanup(scope:TurnScope){return this.#run(async()=>{this.#owned(scope);await this.#cleanup();return this.#status(scope);});}
 async #cleanup(){
  try {
  const rows=this.#rows();for(const row of rows.filter(r=>r.reserved&&!r.closed)){
   row.cleanupRequested=true;await this.#put(row);const identity=identityOf(row.input),transport=this.#transport(),adapter=this.#adapter(transport);
   if(rows.some(r=>r.closed&&r.input.sessionId===row.input.sessionId)){row.closed=true;await this.#put(row);continue;}
   let observed=await adapter.observe(identity);
   if(observed.execution==='running'||observed.execution==='unknown')observed=await adapter.cancel(identity);
   if(observed.execution==='unknown')await this.#stop('managed-execution-unknown');
   // Preserve authoritative outcome/usage before deleting evidence. An idle
   // Session with no correlated Turn can still be cleaned up, but this never
   // resolves its unknown input accounting or permits another model input.
   if(observed.execution!=='running'&&observed.execution!=='unknown'&&!row.receipt)await this.#observe(row);
   const binding=await this.#store().read(identity);
   if(!binding?.remoteSessionId){await this.#stop('managed-cleanup-unconfirmed');continue;}
   const deleted=await adapter.deleteSession(identity);if(deleted.status!=='remote-deleted'){await this.#stop('managed-cleanup-unconfirmed');continue;}
   let absent=false;try{await transport.client.beta.agents.sessions.retrieve(binding.remoteSessionId);}catch(error){absent=(error as {status?:number}).status===404;}
   if(!absent){await this.#stop('managed-cleanup-unconfirmed');continue;}
   for(const sibling of rows.filter(r=>r.input.sessionId===row.input.sessionId)){sibling.closed=true;await this.#put(sibling);}
  }
  }catch{await this.#stop('managed-cleanup-unconfirmed');}
 }
 async alarm(){return this.#run(async()=>{
  const budget=this.#budget();if(!budget?.startedAt)return;
  for(const row of this.#rows().filter(r=>r.reserved&&!r.receipt&&!r.closed)){try{await this.#observe(row);}catch{await this.#stop('managed-observation-failed');}}
  if(budget.stopped||Date.now()>=budget.startedAt+budget.policy.maxDurationMs)await this.#cleanup();
  if(this.#rows().some(r=>r.reserved&&!r.closed))await this.ctx.storage.setAlarm(Date.now()+10000);
 });}
}
