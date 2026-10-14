import {positive,sameScope,scope,sha,turnDigest,turnId,workspaceBindingToken as handoffToken,type TurnScope} from '../turn/protocol.ts';
import {sameTurnRuntimeIdentity,turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
export type WorkspaceSandboxLease={scope:TurnScope;leaseId:string;leaseEpoch:number;runtimeVersion:string};
export type WorkspaceSandboxBinding={lease:WorkspaceSandboxLease;identity:TurnRuntimeIdentity;bindingEpoch:number;filesSha256:string};
export type NativeBindingProof={schemaVersion:1;bindingEpoch:string;status:'quiescent';remaining:0};
export type StoredWorkspaceBinding={schemaVersion:1;input:WorkspaceSandboxBinding;token:string;status:'reserved'|'active'|'sealing'|'sealed'|'quarantined';proof:NativeBindingProof|null};
type Storage=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function lease(raw:WorkspaceSandboxLease):WorkspaceSandboxLease{return {scope:scope(raw.scope),leaseId:turnId(raw.leaseId),leaseEpoch:positive(raw.leaseEpoch),runtimeVersion:sha(raw.runtimeVersion)};}
function binding(raw:WorkspaceSandboxBinding){const result={lease:lease(raw.lease),identity:turnRuntimeIdentity(raw.identity),bindingEpoch:positive(raw.bindingEpoch),filesSha256:sha(raw.filesSha256)};if(!sameScope(result.lease.scope,result.identity.scope)||result.bindingEpoch>1024)throw Error('workspace-binding-denied');return result;}
export async function workspaceSandboxActor(leaseInput:WorkspaceSandboxLease,domain:'project'|'trustedPi'){const ref=lease(leaseInput);return `m2-w${domain==='project'?'p':'t'}-${(await turnDigest({schemaVersion:1,ref,domain})).slice(0,55)}`;}
export async function workspaceBindingToken(input:WorkspaceSandboxBinding){const checked=binding(input);return handoffToken(checked.lease,{sessionId:checked.identity.sessionId,turnId:checked.identity.turnId,dispatchId:checked.identity.dispatchId,bindingEpoch:checked.bindingEpoch});}
export async function historicalWorkspaceBinding(storage:Pick<DurableObjectStorage,'kv'>,input:{identity:TurnRuntimeIdentity;lease:WorkspaceSandboxLease;bindingEpoch:number},actorId:string,domain:'project'|'trustedPi'){
 const identity=turnRuntimeIdentity(input.identity),checkedLease=lease(input.lease),bindingEpoch=positive(input.bindingEpoch);
 if(bindingEpoch>1024||!sameScope(identity.scope,checkedLease.scope)||await workspaceSandboxActor(checkedLease,domain)!==actorId)throw Error('workspace-binding-actor-denied');
 const saved=storage.kv.get<StoredWorkspaceBinding>(`workspace-binding-history:${bindingEpoch}`);if(!saved)return null;
 const checked=binding(saved.input),token=await workspaceBindingToken(checked);if(Object.keys(saved).sort().join(',')!=='input,proof,schemaVersion,status,token'||saved.schemaVersion!==1||saved.token!==token||checked.bindingEpoch!==bindingEpoch||!sameTurnRuntimeIdentity(checked.identity,identity)||!same(checked.lease,checkedLease)||!['reserved','active','sealing','sealed','quarantined'].includes(saved.status))throw Error('workspace-binding-history-denied');
 return structuredClone(checked);
}
/** Native actor authority is independent of the coordinator's lease ledger.
 * Each epoch retains its original identity and receipt; no handoff clears old
 * cancellation fences or overwrites historical effect records. */
export class WorkspaceBindingLedger{
 readonly storage:Storage;readonly actorId:string;readonly domain:'project'|'trustedPi';readonly authorize:(binding:WorkspaceSandboxBinding)=>Promise<void>;
 constructor(storage:Storage,actorId:string,domain:'project'|'trustedPi',authorize:(binding:WorkspaceSandboxBinding)=>Promise<void>){this.storage=storage;this.actorId=actorId;this.domain=domain;this.authorize=authorize;}
 private current(){return this.storage.kv.get<StoredWorkspaceBinding>('workspace-binding-current')??null;}
 private checked(raw:WorkspaceSandboxBinding){const input=binding(raw),saved=this.current();if(!saved||!same(saved.input,input))throw Error('workspace-binding-stale');return saved;}
 async reserve(raw:WorkspaceSandboxBinding){const input=binding(raw);await this.authorize(input);if(await workspaceSandboxActor(input.lease,this.domain)!==this.actorId)throw Error('workspace-binding-actor-denied');const token=await workspaceBindingToken(input);let dispatch=false,result!:StoredWorkspaceBinding;
  this.storage.transactionSync(()=>{const saved=this.current();if(saved&&same(saved.input,input)){result=saved;return;}if(saved&&(!same(saved.input.lease,input.lease)||saved.status!=='sealed'||!saved.proof||input.bindingEpoch<=saved.input.bindingEpoch))throw Error('workspace-binding-not-quiescent');if(this.storage.kv.get(`workspace-binding-history:${input.bindingEpoch}`))throw Error('workspace-binding-replayed');result={schemaVersion:1,input,token,status:'reserved',proof:null};this.storage.kv.put('workspace-binding-current',result);this.storage.kv.put(`workspace-binding-history:${input.bindingEpoch}`,result);dispatch=true;});await this.storage.sync();return {dispatch,binding:structuredClone(result)};
 }
 async activate(raw:WorkspaceSandboxBinding,token:string){await this.change(raw,saved=>{if(token!==saved.token||!['reserved','active'].includes(saved.status))throw Error('workspace-binding-activation-denied');saved.status='active';});}
 authority(identity:TurnRuntimeIdentity){const saved=this.current();if(!saved||saved.status!=='active'||!sameTurnRuntimeIdentity(saved.input.identity,turnRuntimeIdentity(identity)))throw Error('workspace-binding-stale');return structuredClone(saved);}
 async beginSeal(raw:WorkspaceSandboxBinding){await this.change(raw,saved=>{if(saved.status==='sealed')return;if(!['reserved','active','sealing'].includes(saved.status))throw Error('workspace-binding-quarantined');saved.status='sealing';});}
 async sealed(raw:WorkspaceSandboxBinding,proof:NativeBindingProof){await this.change(raw,saved=>{if(proof?.schemaVersion!==1||proof.bindingEpoch!==saved.token||proof.status!=='quiescent'||proof.remaining!==0||Object.keys(proof).sort().join(',')!=='bindingEpoch,remaining,schemaVersion,status'||!['sealing','sealed'].includes(saved.status))throw Error('workspace-binding-proof-denied');if(saved.proof&&!same(saved.proof,proof))throw Error('workspace-binding-proof-conflict');saved.status='sealed';saved.proof=structuredClone(proof);});}
 async quarantine(raw:WorkspaceSandboxBinding){await this.change(raw,saved=>{saved.status='quarantined';});}
 observe(raw:WorkspaceSandboxBinding){return structuredClone(this.checked(raw));}
 private async change(raw:WorkspaceSandboxBinding,fn:(saved:StoredWorkspaceBinding)=>void){this.storage.transactionSync(()=>{const saved=this.checked(raw);fn(saved);this.storage.kv.put('workspace-binding-current',saved);this.storage.kv.put(`workspace-binding-history:${saved.input.bindingEpoch}`,saved);});await this.storage.sync();}
}
