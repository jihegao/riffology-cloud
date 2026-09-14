import {createWorkspaceNativeController,type WorkspaceNativeOptions,type WorkspaceProjectNativeController,type WorkspaceTrustedPiNativeController,type PriorNativeBinding} from './workspace-native.ts';
import {WorkspaceBindingLedger,workspaceSandboxActor,type WorkspaceSandboxBinding,type StoredWorkspaceBinding} from './workspace-binding.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {turnDigest} from '../turn/protocol.ts';
import type {WorkspaceAgent} from '../workspace/durable.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
type Configuration={context:WorkspaceSandboxBinding;deadlineAt:number;priorBinding?:PriorNativeBinding};
type Domain='project'|'trustedPi';
/** Metadata-only router owned by each physical Sandbox actor. Native facade
 * instances are cached per binding; no SDK initialization happens here. */
export class WorkspaceNativeHost<D extends Domain>{
 readonly domain:D;readonly storage:DurableObjectStorage;readonly actorId:string;readonly options:Omit<WorkspaceNativeOptions,'domain'|'context'|'deadlineAt'|'ledger'|'claimNativeStart'|'beforeSeal'>;readonly owner:(name:string)=>WorkspaceAgent;
 #cached:{input:Configuration;value:Promise<WorkspaceProjectNativeController|WorkspaceTrustedPiNativeController>}|null=null;
 constructor(domain:D,options:Omit<WorkspaceNativeOptions,'domain'|'context'|'deadlineAt'|'ledger'|'claimNativeStart'|'beforeSeal'>,owner:(name:string)=>WorkspaceAgent){this.domain=domain;this.options=options;this.storage=options.storage;this.actorId=options.actorId;this.owner=owner;}
 get warm(){return this.actorId.startsWith(this.domain==='project'?'m2-wp-':'m2-wt-');}
 #owner(context:WorkspaceSandboxBinding){return this.owner(workspaceAgentName(context.identity.scope.tenantId,context.identity.scope.workspaceId));}
 async configure(input:Configuration){
  if(!this.warm||this.storage.kv.get('workspace-native-lease-closed'))throw Error('workspace-native-actor-denied');
  const current=this.storage.kv.get<Configuration>('workspace-native-configuration');
  if(current&&same(current.context,input.context)){if(current.deadlineAt!==input.deadlineAt)throw Error('workspace-native-deadline-conflict');await this.#load(current);return;}
  const prior=this.storage.kv.get<StoredWorkspaceBinding>('workspace-binding-current');let priorBinding:PriorNativeBinding|undefined;
  if(prior){if(prior.status!=='sealed'||!prior.proof)throw Error('workspace-native-prior-not-sealed');priorBinding={token:prior.token,hostToken:(await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity:prior.input.identity})).slice(0,52),...this.storage.kv.get<{archiveToken?:string;checkpointFilesSha256?:string}>('workspace-native-committed')};}
  const configured={context:structuredClone(input.context),deadlineAt:input.deadlineAt,...(priorBinding?{priorBinding}:{})};
  const authority=await this.#owner(configured.context).workspaceNativeAuthority({context:configured.context,domain:this.domain});if(authority.actorId!==this.actorId||authority.executionDeadlineAt!==configured.deadlineAt)throw Error('workspace-native-authority-denied');this.storage.transactionSync(()=>{const latest=this.storage.kv.get<Configuration>('workspace-native-configuration');if(!same(latest,current))throw Error('workspace-native-configuration-changed');this.storage.kv.put('workspace-native-configuration',configured);});await this.storage.sync();await this.#load(configured);
 }
 async #load(input:Configuration){
  if(this.#cached&&same(this.#cached.input,input))return this.#cached.value;
  const context=input.context,owner=this.#owner(context),ledger=new WorkspaceBindingLedger(this.storage,this.actorId,this.domain,async raw=>{const result=await owner.workspaceNativeAuthority({context:raw,domain:this.domain});if(result.actorId!==this.actorId||result.executionDeadlineAt!==input.deadlineAt)throw Error('workspace-native-authority-denied');});
  const value=createWorkspaceNativeController({...this.options,domain:this.domain,context,deadlineAt:input.deadlineAt,priorBinding:input.priorBinding,ledger,claimNativeStart:async()=>{const result=await owner.claimWorkspaceNative({context,domain:this.domain});if(!result.authorized)throw Error('workspace-native-start-unknown');},beforeSeal:async()=>{await owner.closeWorkspaceRuntime({identity:context.identity});}});
  this.#cached={input,value};try{return await value;}catch(error){if(this.#cached?.value===value)this.#cached=null;throw error;}
 }
 async forDispatch(raw:Pick<TurnRuntimeIdentity,'scope'|'turnId'|'dispatchId'>){const input=this.storage.kv.get<Configuration>('workspace-native-configuration');if(!input||!same(input.context.identity.scope,raw.scope)||input.context.identity.turnId!==raw.turnId||input.context.identity.dispatchId!==raw.dispatchId)throw Error('workspace-native-binding-denied');return this.forIdentity(input.context.identity);}
 async forIdentity(raw:TurnRuntimeIdentity,maintenance=false){const identity=turnRuntimeIdentity(raw),input=this.storage.kv.get<Configuration>('workspace-native-configuration');if(!input||!same(input.context.identity,identity))throw Error('workspace-native-binding-denied');const authority=await this.#owner(input.context).workspaceNativeAuthority({context:input.context,domain:this.domain});if(authority.actorId!==this.actorId||authority.executionDeadlineAt!==input.deadlineAt||!maintenance&&(authority.closing||authority.leaseStatus!=='bound'||input.deadlineAt<=Date.now()||this.storage.kv.get('workspace-native-lease-closed'))||!same(this.storage.kv.get('workspace-native-configuration'),input))throw Error('workspace-native-authority-denied');return await this.#load(input) as D extends 'project'?WorkspaceProjectNativeController:WorkspaceTrustedPiNativeController;}
 async seal(context:WorkspaceSandboxBinding){this.#context(context);return (await this.forIdentity(context.identity,true)).sealWorkspaceBinding();}
 async prune(context:WorkspaceSandboxBinding,value:string){this.#context(context);await (await this.forIdentity(context.identity,true)).pruneWorkspaceBinding(value);if(this.domain==='project'){const records=this.storage.kv.get<StoredWorkspaceBinding>('workspace-binding-current');if(!records||!same(records.input,context))throw Error('workspace-native-binding-denied');const archiveToken=(await turnDigest({schemaVersion:1,purpose:'project-workspace-archive',identity:context.identity})).slice(0,52);this.storage.kv.put('workspace-native-committed',{checkpointFilesSha256:value,archiveToken});await this.storage.sync();}}
 async destroy(context:WorkspaceSandboxBinding){this.#context(context);return (await this.forIdentity(context.identity,true)).destroyWorkspaceBinding();}
 async destroyLease(lease:WorkspaceSandboxBinding['lease']){if(!this.warm||await workspaceSandboxActor(lease,this.domain)!==this.actorId)throw Error('workspace-native-actor-denied');const owner=this.owner(workspaceAgentName(lease.scope.tenantId,lease.scope.workspaceId));await owner.authorizeWorkspaceLeaseDrain({lease});const current=this.storage.kv.get<StoredWorkspaceBinding>('workspace-binding-current');if(current&&!same(current.input.lease,lease))throw Error('workspace-native-lease-denied');this.storage.kv.put('workspace-native-lease-closed',lease);if(current){const ledger=new WorkspaceBindingLedger(this.storage,this.actorId,this.domain,async()=>{});await ledger.quarantine(current.input);}await this.storage.sync();await this.options.sandbox.destroy();return {running:this.options.running()};}
 #context(context:WorkspaceSandboxBinding){const input=this.storage.kv.get<Configuration>('workspace-native-configuration');if(!input||!same(input.context,context))throw Error('workspace-native-binding-denied');}
}
