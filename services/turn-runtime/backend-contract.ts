import { turnRuntimeIdentity, sameTurnRuntimeIdentity, type TurnRuntimeIdentity } from './identity.ts';
import { jsonEquivalent } from '../turn/json-equivalent.ts';
import { positive, turnId, sha } from '../turn/protocol.ts';

export type Backend='pi'|'managed-agents';
export type BackendCapabilities={schemaVersion:1;backend:Backend;fullSessionRestore:boolean;filesExport:boolean;nativeFence:boolean;remoteCancellation:boolean;usageComplete:boolean;deletionProof:boolean};
export const backendCapabilities:Readonly<Record<Backend,BackendCapabilities>>={
 pi:{schemaVersion:1,backend:'pi',fullSessionRestore:true,filesExport:true,nativeFence:true,remoteCancellation:false,usageComplete:false,deletionProof:false},
 'managed-agents':{schemaVersion:1,backend:'managed-agents',fullSessionRestore:false,filesExport:true,nativeFence:false,remoteCancellation:true,usageComplete:false,deletionProof:true},
};
export type BackendState=
 | {schemaVersion:1;backend:'pi';recovery:'full-session';sessionSha256:string}
 | {schemaVersion:1;backend:'managed-agents';recovery:'remote-reference';identity:TurnRuntimeIdentity;sessionId:string;turnId:string|null}
 | {schemaVersion:1;backend:Backend;recovery:'files-only'|'unrecoverable'};
export function backendState(value:unknown):BackendState{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-backend-state');
 const v=value as Record<string,unknown>;
 if(v.schemaVersion!==1||!['pi','managed-agents'].includes(String(v.backend)))throw Error('invalid-backend-state');
 if(v.recovery==='full-session'&&v.backend==='pi'&&Object.keys(v).length===4)return {schemaVersion:1,backend:'pi',recovery:'full-session',sessionSha256:sha(v.sessionSha256)};
 if(v.recovery==='remote-reference'&&v.backend==='managed-agents'&&Object.keys(v).length===6)return {schemaVersion:1,backend:'managed-agents',recovery:'remote-reference',identity:turnRuntimeIdentity(v.identity),sessionId:turnId(v.sessionId),turnId:v.turnId===null?null:turnId(v.turnId)};
 if(['files-only','unrecoverable'].includes(String(v.recovery))&&Object.keys(v).length===3)return {schemaVersion:1,backend:v.backend as Backend,recovery:v.recovery as 'files-only'|'unrecoverable'};
 throw Error('invalid-backend-state');
}
export function recoveryPlan(raw:BackendState,identity:TurnRuntimeIdentity,filesAvailable:boolean){
 const state=backendState(raw);
 if(state.recovery==='remote-reference'){
  if(!sameTurnRuntimeIdentity(state.identity,turnRuntimeIdentity(identity)))throw Error('backend-state-scope-denied');
  return {action:'observe-original' as const,newExecution:false,portable:false};
 }
 if(state.recovery==='full-session')return {action:'restore-pi' as const,newExecution:false,portable:true};
 return {action:state.recovery==='files-only'&&filesAvailable?'propose-rebuild' as const:'unrecoverable' as const,newExecution:state.recovery==='files-only'&&filesAvailable,portable:false};
}
export type UsageObservation={status:'unknown';reason:'missing'|'invalid'}|{status:'observed';inputTokens:number;outputTokens:number;totalTokens:number;settlement:'pending'};
export function usageObservation(value:unknown):UsageObservation{
 if(value==null)return {status:'unknown',reason:'missing'};
 if(typeof value!=='object'||Array.isArray(value))return {status:'unknown',reason:'invalid'};
 const v=value as Record<string,unknown>,numbers=[v.input_tokens,v.output_tokens,v.total_tokens];
 if(numbers.some(n=>!Number.isSafeInteger(n)||(n as number)<0))return {status:'unknown',reason:'invalid'};
 const [inputTokens,outputTokens,totalTokens]=numbers as number[];
 if(inputTokens+outputTokens!==totalTokens)return {status:'unknown',reason:'invalid'};
 return {status:'observed',inputTokens,outputTokens,totalTokens,settlement:'pending'};
}
/** Adapter metadata, collocated with the existing runtime journal. This is
 * not a second Turn status: the TurnJournal still owns execution/publication. */
export type ExecutionBinding={schemaVersion:1;identity:TurnRuntimeIdentity;backend:Backend;inputSha256:string;reservedAt:number;remoteSessionId:string|null;remoteTurnId:string|null};
export interface ExecutionBindingStore{
 read(identity:TurnRuntimeIdentity):Promise<ExecutionBinding|null>;
 reserve(binding:ExecutionBinding):Promise<{binding:ExecutionBinding;created:boolean}>;
 attach(identity:TurnRuntimeIdentity,remote:{sessionId:string;turnId:string|null}):Promise<ExecutionBinding>;
}
export function executionBinding(raw:ExecutionBinding):ExecutionBinding{
 if(!raw||typeof raw!=='object'||Object.keys(raw).sort().join(',')!=='backend,identity,inputSha256,remoteSessionId,remoteTurnId,reservedAt,schemaVersion')throw Error('invalid-execution-binding');
 const identity=turnRuntimeIdentity(raw.identity);if(raw.schemaVersion!==1||!['pi','managed-agents'].includes(raw.backend))throw Error('invalid-execution-binding');
 const binding={schemaVersion:1 as const,identity,backend:raw.backend,inputSha256:sha(raw.inputSha256),reservedAt:positive(raw.reservedAt),remoteSessionId:raw.remoteSessionId===null?null:turnId(raw.remoteSessionId),remoteTurnId:raw.remoteTurnId===null?null:turnId(raw.remoteTurnId)};
 if(binding.remoteTurnId&&!binding.remoteSessionId||binding.backend==='pi'&&(binding.remoteSessionId||binding.remoteTurnId))throw Error('invalid-execution-binding');
 return binding;
}
export function checkBinding(prior:ExecutionBinding,next:ExecutionBinding){
 if(!sameTurnRuntimeIdentity(prior.identity,next.identity)||prior.backend!==next.backend||prior.inputSha256!==next.inputSha256)throw Error('execution-binding-conflict');
}
export function attachBinding(prior:ExecutionBinding,remote:{sessionId:string;turnId:string|null}):ExecutionBinding{
 const sessionId=turnId(remote.sessionId),remoteTurnId=remote.turnId===null?null:turnId(remote.turnId);
 if(prior.backend!=='managed-agents'||prior.remoteSessionId!==null&&prior.remoteSessionId!==sessionId||prior.remoteTurnId!==null&&prior.remoteTurnId!==remoteTurnId)throw Error('execution-binding-conflict');
 return executionBinding({...prior,remoteSessionId:sessionId,remoteTurnId});
}
/** Storage must be the runtime actor's durable SQLite storage, not a cache. */
export class SqlExecutionBindingStore implements ExecutionBindingStore{
 readonly storage:Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>;
 constructor(storage:Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>){this.storage=storage;}
 private key(identity:TurnRuntimeIdentity){return JSON.stringify(turnRuntimeIdentity(identity));}
 private sessionKey(raw:TurnRuntimeIdentity){const identity=turnRuntimeIdentity(raw);return JSON.stringify({scope:identity.scope,sessionId:identity.sessionId,generation:identity.generation});}
 private get(identity:TurnRuntimeIdentity){const rows=this.storage.sql.exec<{value:string}>('SELECT value FROM execution_bindings WHERE identity=?',this.key(identity)).toArray();const binding=rows[0]?executionBinding(JSON.parse(rows[0].value)):null;if(binding&&!sameTurnRuntimeIdentity(binding.identity,turnRuntimeIdentity(identity)))throw Error('execution-binding-conflict');return binding;}
 private init(){this.storage.sql.exec('CREATE TABLE IF NOT EXISTS execution_bindings (identity TEXT PRIMARY KEY, session_key TEXT NOT NULL, value TEXT NOT NULL) STRICT');}
 readExisting(identity:TurnRuntimeIdentity){if(!this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_bindings'").toArray().length)return null;return this.get(identity);}
 async read(identity:TurnRuntimeIdentity){return this.readExisting(identity);}
 async reserve(raw:ExecutionBinding){return this.reserveAfterSessionClosure(raw,[]);}
 // Only the owning runtime may supply Sessions whose deletion has been proved.
 // Old immutable bindings remain queryable; unresolved or live siblings still fence.
 async reserveAfterSessionClosure(raw:ExecutionBinding,closedSessionIds:readonly string[]){const binding=executionBinding(raw);const result=this.storage.transactionSync(()=>{this.init();const prior=this.get(binding.identity);if(prior){checkBinding(prior,binding);return {binding:prior,created:false};}const siblings=this.storage.sql.exec<{value:string}>('SELECT value FROM execution_bindings WHERE session_key=?',this.sessionKey(binding.identity)).toArray().map(row=>executionBinding(JSON.parse(row.value)));
   if(siblings.some(other=>other.backend!==binding.backend))throw Error('execution-session-backend-conflict');
   if(binding.backend==='managed-agents'&&siblings.some(other=>other.remoteTurnId===null||other.remoteSessionId!==binding.remoteSessionId&&!closedSessionIds.includes(other.remoteSessionId!)))throw Error('execution-session-unresolved');
   this.storage.sql.exec('INSERT INTO execution_bindings VALUES (?,?,?)',this.key(binding.identity),this.sessionKey(binding.identity),JSON.stringify(binding));return {binding,created:true};});await this.storage.sync();return result;}
 async attach(identity:TurnRuntimeIdentity,remote:{sessionId:string;turnId:string|null}){const result=this.storage.transactionSync(()=>{this.init();const prior=this.get(identity);if(!prior)throw Error('execution-binding-missing');const binding=attachBinding(prior,remote);if(!jsonEquivalent(binding,prior))this.storage.sql.exec('UPDATE execution_bindings SET value=? WHERE identity=?',JSON.stringify(binding),this.key(identity));return binding;});await this.storage.sync();return result;}
}
