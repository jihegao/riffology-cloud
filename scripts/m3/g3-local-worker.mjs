// Only fixture producer/observational counters are test extensions. All catalog,
// checkpoint, build, authorization, simulation and artifact code stays real.
export const g3WorkerEntry=`
import gateway from './services/gateway/index.ts';
export {TenantQuota,RevisionStore,ContainerProxy} from './services/gateway/index.ts';
import {ProjectRuntime as ProductionProjectRuntime} from './services/runtime/durable.ts';
import {WorkspaceAgent as ProductionWorkspace} from './services/workspace/durable.ts';
import {SimulationSandbox as ProductionSandbox} from './services/simulation/sandbox.ts';
import {TurnJournal} from './services/turn/journal.ts';import {DurableTurnStore} from './services/turn/store.ts';
import {initialWorkspaceReferenceFromReady} from './services/turn-runtime/initial-workspace.ts';
import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';import {workspaceAgentName} from './services/workspace/protocol.ts';import {simulationToken} from './services/simulation/native.ts';
export class ProjectRuntime extends ProductionProjectRuntime{
 async g3Count(name){const counts=await this.ctx.storage.get('g3:runtime-mutations')??{};counts[name]=(counts[name]??0)+1;await this.ctx.storage.put('g3:runtime-mutations',counts);}
 async initialize(input){await this.g3Count('initialize');return super.initialize(input);}
 async stop(input){await this.g3Count('stop');return super.stop(input);}
 async g3Counts(){return {calls:await this.ctx.storage.get('g3:runtime-mutations')??{},nativeRunning:this.ctx.container?.running??null};}
}
export class SimulationSandbox extends ProductionSandbox{
 constructor(ctx,env){super(ctx,env);this.testStorage=ctx.storage;}
 async count(name){const value=await this.testStorage.get('g3:sdk-counts')??{};value[name]=(value[name]??0)+1;await this.testStorage.put('g3:sdk-counts',value);await this.testStorage.sync();}
 async exec(command,...args){if(command.includes('/simulation_process.py start'))await this.count('nativeStart');if(command.includes('/simulation_process.py observe'))await this.count('nativeObserve');return super.exec(command,...args);}
 async startProcess(...args){await this.count('sdkStartProcess');return super.startProcess(...args);}
 async destroy(...args){await this.count('sdkDestroy');return super.destroy(...args);}
 async g3Counts(){return await this.testStorage.get('g3:sdk-counts')??{};}
}
export class WorkspaceAgent extends ProductionWorkspace{
 constructor(ctx,env){super(ctx,env);this.g3BootNonce=crypto.randomUUID();}
 async alarm(){const summarize=row=>({state:structuredClone(row.state)});const before=[...(await this.ctx.storage.list({prefix:'browser-preview:build:'})).values()].map(summarize);try{return await super.alarm();}finally{const after=[...(await this.ctx.storage.list({prefix:'browser-preview:build:'})).values()].map(summarize);const records=await this.ctx.storage.get('g3:alarm-observations')??[];records.push({bootNonce:this.g3BootNonce,observedAt:Date.now(),before,after});await this.ctx.storage.put('g3:alarm-observations',records.slice(-256));}}

 async g3Save(input){return this.ctx.blockConcurrencyWhile(async()=>{
  const {scope,actor,key}=input;
  // This public actor operation checks actual readiness before fixture production.
  const session=(await super.createSession({scope,actor,key:'session-'+key,body:{title:'Deterministic G3 source producer'}})).session;
  const journal=new TurnJournal(new DurableTurnStore(this.ctx.storage),Date.now,async owned=>{const ready=await this.ctx.storage.get('m1:workspace:initialization');const reference=await initialWorkspaceReferenceFromReady({scope:owned,task:ready.task,runtime:ready.identity,markerNonce:ready.markerNonce,ready:ready.runtimeReceipt});const resolved=await this.env.REVISION_STORE.getByName(revisionStoreActorName(owned)).resolveInitial(reference,owned);return {reference:resolved.reference,filesSha256:resolved.filesSha256};});
  await journal.submit(scope,actor,session.id,'turn-'+key,{message:'Save canonical finite fixture; no Agent generation'});
  const turn=(await journal.claim(scope,scope.workspaceGeneration)).turn;if(!turn)throw Error('g3-fixture-claim-failed');
  const identity={scope,sessionId:session.id,turnId:turn.id,dispatchId:turn.dispatchId,generation:scope.workspaceGeneration};
  const filesArchive=Uint8Array.from(atob(input.archiveBase64),c=>c.charCodeAt(0));
  const resolution=await this.env.REVISION_STORE.getByName(revisionStoreActorName(scope)).commit({identity,base:turn.base,outcome:'completed',executionErrorCode:null,snapshot:{identity,filesArchive,piSession:new TextEncoder().encode('G3 deterministic fixture producer; no external Agent')}});
  if(resolution.status!=='committed')throw Error('g3-revision-'+resolution.status);
  await journal.beginCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:scope.workspaceGeneration,outcome:'completed'});
  await journal.commitCheckpoint(scope,{turnId:turn.id,dispatchId:turn.dispatchId,runtimeGeneration:scope.workspaceGeneration,checkpoint:resolution.receipt});
  return {identity,receipt:resolution.receipt,diagnostics:await this.g3Diagnostics(scope)};
 });}
 async g3Diagnostics(scope){
  const quota=this.env.TENANT_QUOTA.getByName('tenant-quota:'+scope.tenantId);const stored=await this.ctx.storage.list({prefix:'simulation:run:'});const native=[];
  for(const record of stored.values()){const token=await simulationToken(record.input);native.push({runId:record.runId,status:record.status,released:record.released,quotaLease:record.lease?await quota.lookup(scope.tenantId,record.lease.operationId):null,releaseProof:record.releaseProof,quotaClaimed:record.quotaClaimed,lease:record.lease,counts:await this.env.SIMULATION_SANDBOX.getByName('simulation-'+token).g3Counts()});}
  const state=new DurableTurnStore(this.ctx.storage).read();const m1=await this.ctx.storage.get('m1:workspace:initialization');const runtimeId=m1?.identity?.runtimeId;
  return {quotaSnapshot:await quota.snapshot(scope.tenantId),bootNonce:this.g3BootNonce,alarmObservations:await this.ctx.storage.get('g3:alarm-observations')??[],initialization:{quotaLease:m1?.lease?await quota.lookup(scope.tenantId,m1.lease.operationId):null,runtimeId,phase:m1?.phase,runtimeReceipt:m1?.runtimeReceipt,stopReceipt:m1?.stopReceipt,quotaReleased:m1?.quotaReleased},providerEnabled:this.env.M2_MODEL_PROVIDER_ENABLED==='true',projectRuntimeMutationCalls:runtimeId?await this.env.PROJECT_RUNTIME.getByName(runtimeId).g3Counts():null,turnCount:Object.keys(state?.turns??{}).length,savedTurns:Object.values(state?.turns??{}).filter(t=>t.persistenceOutcome==='saved').map(t=>({id:t.id,receipt:t.checkpoint})),runCount:stored.size,native,buildDiscoveries:[...(await this.ctx.storage.list({prefix:'browser-preview:discovery:'})).values()],buildRows:[...(await this.ctx.storage.list({prefix:'browser-preview:build:'})).values()],physicalAlarm:await this.ctx.storage.getAlarm()};
 }
}
export default {async fetch(request,env,ctx){const url=new URL(request.url);
 if(url.pathname.startsWith('/__g3/')){if(request.headers.get('x-g3-producer-key')!==env.G3_PRODUCER_KEY)return new Response('not found',{status:404});const body=await request.json(),workspace=env.WORKSPACE_AGENT.getByName(workspaceAgentName(body.scope.tenantId,body.scope.workspaceId));if(url.pathname==='/__g3/save')return Response.json(await workspace.g3Save(body));if(url.pathname==='/__g3/diagnostics')return Response.json(await workspace.g3Diagnostics(body.scope));return new Response('not found',{status:404});}
 return gateway.fetch(request,env,ctx);
}};`;
