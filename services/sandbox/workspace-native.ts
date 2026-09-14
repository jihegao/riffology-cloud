import type {Sandbox} from '@cloudflare/sandbox';
import {WorkspaceBindingLedger,type WorkspaceSandboxBinding,type NativeBindingProof} from './workspace-binding.ts';
import {sameTurnRuntimeIdentity,turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {sha,turnDigest,type TurnBaseCheckpoints} from '../turn/protocol.ts';
import {sandboxActorIds} from './policy.ts';
import {TurnSandboxFence} from './turn-fence.ts';
import {ProjectPreparationLedger} from '../project-tools/preparation.ts';
import {SandboxProjectWorkspacePort} from '../project-tools/workspace.ts';
import {SandboxNativeProjectEffectPort} from '../project-tools/native.ts';
import {SqlProjectEffectSupervisor} from '../project-tools/supervisor.ts';
import {ProjectFileEffectPort} from '../project-tools/effect.ts';
import {verifyProjectEffectCapability,type ProjectEffectCapability} from './capability.ts';
import type {ToolCommand} from '../tools/protocol.ts';
import type {ToolCommandReference} from '../tools/ledger.ts';
import type {TrustedPiSandboxProcessApi,TrustedPiProcessSnapshot} from '../turn-runtime/pi-native.ts';

type SDK=Pick<Sandbox,'writeFile'|'readFile'|'startProcess'|'getProcess'|'getProcessLogs'|'destroy'>;
type Status='reserved'|'active'|'sealing'|'sealed'|'quarantined';
export type PriorNativeBinding={token:string;hostToken?:string;archiveToken?:string;checkpointFilesSha256?:string};
export type WorkspaceNativeOptions={domain:'project'|'trustedPi';sandbox:SDK;storage:DurableObjectStorage;actorId:string;context:WorkspaceSandboxBinding;ledger:WorkspaceBindingLedger;claimNativeStart:()=>Promise<void>;running:()=>boolean;deadlineAt:number;priorBinding?:PriorNativeBinding;capabilityKey?:string;queryObserverExecution?:(identity:TurnRuntimeIdentity)=>Promise<{expiresAt:number}>;beforeSeal?:()=>Promise<void>;clock?:()=>number};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(code:string):never=>{throw Error(code);};
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const HEX52=/^[a-f0-9]{52}$/;
const quietProof=(value:unknown,token:string):NativeBindingProof=>{const p=value as NativeBindingProof;if(!exact(p,['schemaVersion','bindingEpoch','status','remaining'])||p.schemaVersion!==1||p.bindingEpoch!==token||p.status!=='quiescent'||p.remaining!==0)fail('workspace-native-proof-denied');return p;};

/** Existing per-Turn ledgers remain immutable in binding-local namespaces.
 * Only their two fixed internal SQL identifiers are rewritten; SQL bindings,
 * effect ids and user content are never interpolated as table names. */
export function workspaceBindingStorage(storage:DurableObjectStorage,epoch:number):DurableObjectStorage{
 if(!Number.isSafeInteger(epoch)||epoch<1||epoch>1024)fail('workspace-native-epoch-invalid');
 const prefix=`wb:${epoch}:`;
 const kv=new Proxy(storage.kv,{get(target,key){if(key==='get')return (name:string)=>target.get(prefix+name);if(key==='put')return (name:string,value:unknown)=>target.put(prefix+name,value);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const sql=new Proxy(storage.sql,{get(target,key){if(key==='exec')return (query:string,...bindings:SqlStorageValue[])=>target.exec(query.replace(/\b(project_effects|project_effect_fence)\b/g,name=>`wb_${epoch}_${name}`),...bindings);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 return new Proxy(storage,{get(target,key){if(key==='kv')return kv;if(key==='sql')return sql;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}

class NativeCore{
 readonly options:WorkspaceNativeOptions;readonly context:WorkspaceSandboxBinding;readonly storage:DurableObjectStorage;readonly token:string;readonly clock:()=>number;
 private inFlight=0;private tail:Promise<unknown>=Promise.resolve();private claimed:Promise<void>|null=null;private sealing:Promise<NativeBindingProof>|null=null;
 constructor(options:WorkspaceNativeOptions,token:string){this.options=options;this.context=structuredClone(options.context);this.storage=workspaceBindingStorage(options.storage,this.context.bindingEpoch);this.token=token;this.clock=options.clock??Date.now;if(!Number.isSafeInteger(options.deadlineAt))fail('workspace-native-deadline-invalid');}
 assert(statuses:Status[],identity?:TurnRuntimeIdentity){if(identity&&!sameTurnRuntimeIdentity(turnRuntimeIdentity(identity),this.context.identity))fail('workspace-native-identity-denied');const saved=this.options.ledger.observe(this.context);if(!statuses.includes(saved.status))fail('workspace-native-state-denied');return saved;}
 live(){if(!this.options.running())fail('workspace-native-container-absent');}
 deadline(){if(this.clock()>=this.options.deadlineAt)fail('workspace-native-expired');}
 async quarantine(){try{await this.options.ledger.quarantine(this.context);}catch{/* Never mutate a newer binding. */}}
 async claim(){if(this.claimed)return this.claimed;this.claimed=(async()=>{this.assert(['reserved','active','sealing','sealed']);const state=this.storage.kv.get<string>('native-claim');if(state==='claimed')return;if(state)fail('workspace-native-claim-unknown');this.deadline();this.storage.transactionSync(()=>{if(this.storage.kv.get('native-claim'))fail('workspace-native-claim-unknown');this.storage.kv.put('native-claim','pending');});await this.storage.sync();this.assert(['reserved','active']);try{await this.options.claimNativeStart();this.assert(['reserved','active']);this.storage.kv.put('native-claim','claimed');await this.storage.sync();}catch(error){await this.quarantine();throw error;}})();return this.claimed;}
 /** Every SDK operation has durable intent. Unknown acknowledgements can only
  * destroy/quarantine, not hand off to another binding after actor restart. */
 async sdk<T>(allowed:Status[],operation:()=>Promise<T>,start=false,missingPath?:string):Promise<T>{
  const work=this.tail.catch(()=>{}).then(async()=>{this.assert(allowed);if(start)this.deadline();if(!start||this.storage.kv.get('native-started'))this.live();await this.claim();this.assert(allowed);if(!start||this.storage.kv.get('native-started'))this.live();const nonce=crypto.randomUUID();this.storage.transactionSync(()=>{if(this.storage.kv.get('native-pending'))fail('workspace-native-operation-unknown');this.storage.kv.put('native-pending',nonce);});await this.storage.sync();this.assert(allowed);
   let value:T;let missing:unknown=null;this.inFlight++;try{value=await operation();}catch(error){const e=error as {code?:string;httpStatus?:number;path?:string};if(missingPath&&e?.code==='FILE_NOT_FOUND'&&e.httpStatus===404&&e.path===missingPath)missing=error;else{await this.quarantine();throw error;}}finally{this.inFlight--;}
   this.storage.transactionSync(()=>{if(this.storage.kv.get('native-pending')!==nonce)fail('workspace-native-operation-conflict');this.storage.kv.put('native-pending',null);this.storage.kv.put('native-started',true);});await this.storage.sync();this.assert(allowed);this.live();if(missing)throw missing;return value!;
  });this.tail=work;return work;
 }
 async run(command:string,allowed:Status[],env:Record<string,string>={},start=false){
  const processId=`wb-${this.context.bindingEpoch}-${crypto.randomUUID()}`;
  const process=await this.sdk(allowed,()=>this.options.sandbox.startProcess(command,{processId,autoCleanup:false,timeout:20_000,cwd:'/',encoding:'utf8',env:{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin',...env}}),start);
  if(process.id!==processId)fail('workspace-native-process-mismatch');
  const exit=await this.sdk(allowed,()=>process.waitForExit(20_000));
  const logs=await this.sdk(allowed,()=>process.getLogs());
  if(exit.exitCode!==0||logs.stderr!==''||typeof logs.stdout!=='string'||new TextEncoder().encode(logs.stdout).length>2048)fail('workspace-native-command-unproven');
  try{return JSON.parse(logs.stdout);}catch{return fail('workspace-native-command-unproven');}
 }
 async activate(domain:'project'|'trustedPi'){this.deadline();
  const program=domain==='project'?'/opt/riffology/process_quiescence.py':'/opt/riffology/runtime_supervisor.py';
  const result=await this.run(`python3 ${program} activate --epoch ${this.token}`,['reserved']);
  if(!exact(result,['schemaVersion','bindingEpoch','status'])||result.schemaVersion!==1||result.bindingEpoch!==this.token||result.status!=='active')fail('workspace-native-activation-unproven');
  await this.options.ledger.activate(this.context,this.token);this.assert(['active']);
 }
 async seal(){if(this.sealing)return this.sealing;this.sealing=(async()=>{
  const saved=this.assert(['reserved','active','sealing','sealed']);if(saved.status==='sealed'){this.live();return quietProof(saved.proof,this.token);}
  if(this.options.domain==='trustedPi'){if(!this.options.beforeSeal)fail('workspace-native-close-required');await this.options.beforeSeal!();this.assert(['reserved','active','sealing']);}
  await this.options.ledger.beginSeal(this.context);this.assert(['sealing']);await this.tail.catch(()=>{});this.live();if(this.storage.kv.get('native-pending')){await this.quarantine();fail('workspace-native-operation-unknown');}
  let raw:unknown;if(this.options.domain==='project'){
   const p=await this.run('python3 /opt/riffology/process_quiescence.py seal',['sealing'],{RIFFOLOGY_BINDING_EPOCH:this.token});
   if(!exact(p,['schemaVersion','bindingEpoch','sealed','quiescent','projectUid'])||p.schemaVersion!==1||p.bindingEpoch!==this.token||p.sealed!==true||p.quiescent!==true||p.projectUid!==10001)fail('workspace-native-proof-denied');
   raw={schemaVersion:1,bindingEpoch:this.token,status:'quiescent',remaining:0};
  }else raw=await this.run(`python3 /opt/riffology/runtime_supervisor.py seal --epoch ${this.token}`,['sealing']);
  const proof=quietProof(raw,this.token);await this.options.ledger.sealed(this.context,proof);this.assert(['sealed']);return proof;
 })().catch(async error=>{await this.quarantine();throw error;});return this.sealing;}
 async prune(value:string){this.assert(['sealed']);const project=this.options.domain==='project';if(project)sha(value);else if(!HEX52.test(value))fail('workspace-native-token-invalid');const result=await this.run(project?`python3 /opt/riffology/process_quiescence.py prune --epoch ${this.token} --files-sha256 ${value}`:`python3 /opt/riffology/runtime_supervisor.py prune --epoch ${this.token} --token ${value}`,['sealed']);if(!exact(result,['schemaVersion','bindingEpoch','status','removed'])||result.schemaVersion!==1||result.bindingEpoch!==this.token||result.status!=='pruned'||!Number.isSafeInteger(result.removed)||result.removed<0)fail('workspace-native-prune-unproven');}
 async destroy(){this.assert(['reserved','active','sealing','sealed','quarantined']);await this.quarantine();this.assert(['quarantined']);await this.options.sandbox.destroy();this.assert(['quarantined']);return {running:this.options.running()||this.inFlight>0};}
}

export class WorkspaceProjectNativeController{
 readonly core:NativeCore;readonly preparation:ProjectPreparationLedger;readonly fence:TurnSandboxFence;readonly supervisor:SqlProjectEffectSupervisor;readonly effects:ProjectFileEffectPort;readonly workspace:SandboxProjectWorkspacePort;
 private preparing:Promise<void>|null=null;
 constructor(core:NativeCore,logicalActor:string){this.core=core;this.preparation=new ProjectPreparationLedger(core.storage,core.options.running);this.fence=new TurnSandboxFence(core.storage);
  const sdk=core.options.sandbox;
  const process=(raw:Awaited<ReturnType<SDK['startProcess']>>,allowed:Status[])=>new Proxy(raw,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'? (...args:unknown[])=>core.sdk(allowed,()=>value.apply(target,args)):value;}});
  const proxy={
   writeFile:(...args:Parameters<SDK['writeFile']>)=>core.sdk(['reserved','active'],()=>sdk.writeFile(...args),true),
   readFile:(...args:Parameters<SDK['readFile']>)=>core.sdk(['reserved','active','sealed'],()=>sdk.readFile(...args)),
   startProcess:async(command:string,options:any)=>{const status=core.assert(['reserved','active','sealed']).status;const allowed:Status[]=[status];const native=await core.sdk(allowed,()=>sdk.startProcess(command,{...options,env:{...options.env,RIFFOLOGY_BINDING_EPOCH:core.token}}),status!=='sealed');return process(native,allowed);},
   getProcess:async(...args:Parameters<SDK['getProcess']>)=>{const raw=await core.sdk(['active','sealed'],()=>sdk.getProcess(...args));return raw?process(raw,['active','sealed']):null;},
   getProcessLogs:(...args:Parameters<SDK['getProcessLogs']>)=>core.sdk(['active','sealed'],()=>sdk.getProcessLogs(...args)),
  };
  const native=new SandboxNativeProjectEffectPort(proxy as any);
  this.supervisor=new SqlProjectEffectSupervisor(core.storage,{start:input=>native.start(input),observe:id=>native.observe(id),sealAndDrain:async()=>{await core.seal();return {schemaVersion:1,sealed:true,quiescent:true,projectUid:10001};}},core.clock);
  this.effects=new ProjectFileEffectPort(this.supervisor);this.workspace=new SandboxProjectWorkspacePort(proxy as any,logicalActor);
 }
 private async stage(){if(this.preparing)return this.preparing;this.preparing=(async()=>{this.core.assert(['reserved']);const proof=await this.core.run(`python3 /opt/riffology/process_quiescence.py stage --epoch ${this.core.token}`,['reserved'],{},true);if(!exact(proof,['schemaVersion','bindingEpoch','status'])||proof.schemaVersion!==1||proof.bindingEpoch!==this.core.token||proof.status!=='staging')fail('workspace-native-staging-unproven');})();return this.preparing;}
 private async restore(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null,deadlineAt:number){this.core.assert(['reserved'],identity);if(!Number.isSafeInteger(deadlineAt)||deadlineAt>this.core.options.deadlineAt||deadlineAt<=this.core.clock())fail('workspace-native-deadline-conflict');await this.stage();const prior=this.core.options.priorBinding;let result:{bytes:number;sha256:string};
  if(prior?.archiveToken&&prior.checkpointFilesSha256===this.core.context.filesSha256){if(!HEX52.test(prior.archiveToken))fail('workspace-native-prior-invalid');const token=(await turnDigest({schemaVersion:1,purpose:'project-workspace-archive',identity})).slice(0,52);this.core.assert(['reserved']);const report=await this.core.run(`python3 /opt/riffology/platform_workspace_archive.py adopt ${token} ${prior.archiveToken}`,['reserved'],{RIFFOLOGY_BINDING_EPOCH:this.core.token,RIFFOLOGY_EXPECTED_FILES_SHA256:sha(prior.checkpointFilesSha256)});if(!exact(report,['ok','operation','bytes','sha256'])||report.ok!==true||report.operation!=='restore'||report.sha256!==this.core.context.filesSha256||!Number.isSafeInteger(report.bytes)||report.bytes<1||report.bytes>56*1024*1024)fail('workspace-native-adopt-unproven');result={bytes:report.bytes,sha256:report.sha256};}
  else result=await this.workspace.restoreFiles(identity,base,archive,deadlineAt);
  if(result.sha256!==this.core.context.filesSha256)fail('workspace-native-source-conflict');await this.core.activate('project');return result;
 }
 async prepareWorkspaceOnce(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null,operationId:string,deadlineAt:number){this.core.assert(['reserved','active'],identity);return this.fence.run(identity,()=>this.preparation.prepare(identity,base,operationId,deadlineAt,()=>this.restore(identity,base,archive,deadlineAt)),()=>this.core.destroy());}
 async observeWorkspacePreparation(identity:TurnRuntimeIdentity,operationId:string){this.core.assert(['reserved','active','sealing','sealed'],identity);return this.preparation.observe(identity,operationId);}
 async restoreWorkspace(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints,archive:Uint8Array|null){const operationId=`warm-${this.core.context.bindingEpoch}`;const result=await this.prepareWorkspaceOnce(identity,base,archive,operationId,this.core.options.deadlineAt);if(result.status!=='ready')return fail('workspace-native-preparation-unknown');return {sha256:result.receipt.sha256,bytes:result.receipt.bytes};}
 async freezeWorkspace(identity:TurnRuntimeIdentity,base:TurnBaseCheckpoints){this.core.assert(['active','sealing','sealed'],identity);await this.supervisor.sealForCheckpoint();return this.workspace.frozenFiles(identity,base);}
 private async capability(command:ToolCommand,effectId:string,capability:ProjectEffectCapability){const key=this.core.options.capabilityKey;if(!key)return fail('workspace-native-capability-required');const claims=await verifyProjectEffectCapability(key,this.core.options.actorId,command,effectId,capability);this.core.assert(['active','sealed']);if(!same(claims.scope,this.core.context.identity.scope)||claims.turnId!==this.core.context.identity.turnId||claims.dispatchId!==this.core.context.identity.dispatchId)fail('workspace-native-identity-denied');return claims;}
 async executeFileEffect(input:{command:ToolCommand;effectId:string;capability:ProjectEffectCapability}){const claims=await this.capability(input.command,input.effectId,input.capability);this.core.assert(['active']);this.core.deadline();return this.fence.runDispatch(claims,()=>{this.preparation.assertDispatchUsable(claims);return this.effects.execute(input);},()=>this.core.destroy());}
 async observeFileEffect(input:{reference:ToolCommandReference;command:ToolCommand;capability:ProjectEffectCapability}){const claims=await this.capability(input.command,input.reference.effectId,input.capability);if(this.core.assert(['active','sealed']).status==='sealed'||this.fence.isDispatchFenced(claims))return this.effects.observePersistedTerminal(input);return this.fence.runDispatch(claims,()=>this.effects.observe(input),()=>this.core.destroy());}
 async abortWorkspace(identity:TurnRuntimeIdentity){this.core.assert(['reserved','active','sealing','sealed','quarantined'],identity);await this.preparation.close(identity);return {...await this.fence.fence(identity,()=>this.core.destroy()),fenced:true as const};}
 sealWorkspaceBinding(){return this.core.seal();}
 pruneWorkspaceBinding(filesSha256:string){return this.core.prune(filesSha256);}
 destroyWorkspaceBinding(){return this.core.destroy();}
}

export class WorkspaceTrustedPiNativeController{
 readonly core:NativeCore;readonly fence:TurnSandboxFence;readonly hostToken:string;readonly processId:string;private resetting:Promise<void>|null=null;
 constructor(core:NativeCore,hostToken:string){this.core=core;this.hostToken=hostToken;this.processId=`pi-${hostToken}`;this.fence=new TurnSandboxFence(core.storage);}
 private path(path:string,write=false){const suffix=path.slice(`/var/lib/riffology/turns/${this.hostToken}.`.length);if(!path.startsWith(`/var/lib/riffology/turns/${this.hostToken}.`)||!(write?['control.json','input-session.json']:['control.json','input-session.json','result.json','output-session.json']).includes(suffix))fail('workspace-native-file-denied');return suffix;}
 private async resetPrior(){if(this.resetting)return this.resetting;this.resetting=(async()=>{this.core.assert(['reserved']);if(this.core.storage.kv.get('pi-files-ready'))return;const prior=this.core.options.priorBinding;if(prior){if(!HEX52.test(prior.hostToken??'')||!(/^[a-f0-9]{64}$/).test(prior.token))fail('workspace-native-prior-invalid');const result=await this.core.run(`python3 /opt/riffology/runtime_supervisor.py reset --epoch ${prior.token} --token ${prior.hostToken}`,['reserved']);if(!exact(result,['schemaVersion','bindingEpoch','status','removed'])||result.schemaVersion!==1||result.bindingEpoch!==prior.token||result.status!=='reset'||!Number.isSafeInteger(result.removed)||result.removed<0)fail('workspace-native-reset-unproven');}this.core.storage.kv.put('pi-files-ready',true);await this.core.storage.sync();this.core.assert(['reserved']);})();return this.resetting;}
 async writeTurnFile(identity:TurnRuntimeIdentity,...input:Parameters<TrustedPiSandboxProcessApi['writeFile']>){this.core.assert(['reserved'],identity);this.core.deadline();const suffix=this.path(input[0],true);if(typeof input[1]!=='string'||new TextEncoder().encode(input[1]).length>(suffix==='control.json'?65536:12*1024*1024)||input[2]?.encoding!==(suffix==='control.json'?'utf8':'base64'))fail('workspace-native-file-invalid');await this.resetPrior();return this.fence.run(identity,async()=>{const result=await this.core.sdk(['reserved'],()=>this.core.options.sandbox.writeFile(...input),true);this.core.storage.kv.put(`pi-file:${suffix}`,true);await this.core.storage.sync();this.core.assert(['reserved']);return result;},()=>this.core.destroy());}
 async readTurnFile(identity:TurnRuntimeIdentity,...input:Parameters<TrustedPiSandboxProcessApi['readFile']>){this.core.assert(['reserved','active','sealing','sealed'],identity);const suffix=this.path(input[0]);if(!this.core.storage.kv.get(`pi-file:${suffix}`)&&!this.core.storage.kv.get('pi-start-intent'))throw Error('File not found');return this.core.sdk(['reserved','active','sealed'],()=>this.core.options.sandbox.readFile(...input),false,input[0]);}
 private async snapshot(identity:TurnRuntimeIdentity,id:string):Promise<TrustedPiProcessSnapshot|null>{this.core.assert(['reserved','active','sealed'],identity);if(id!==this.processId)fail('workspace-native-process-denied');if(!this.core.storage.kv.get('pi-start-intent'))return null;const process=await this.core.sdk(['active','sealed'],()=>this.core.options.sandbox.getProcess(id));if(!process){await this.core.quarantine();fail('workspace-native-process-unknown');}if(process!.id!==id)fail('workspace-native-process-denied');const status=await this.core.sdk(['active','sealed'],()=>process!.getStatus());const exitCode=process!.exitCode;if(['completed','failed'].includes(status)){if(!Number.isSafeInteger(exitCode)||exitCode!<0||exitCode!>255)fail('workspace-native-exit-unknown');await this.core.seal();}else if(!['starting','running'].includes(status)){await this.core.quarantine();fail('workspace-native-process-unknown');}return {id,status,...(Number.isSafeInteger(exitCode)?{exitCode}:{})};}
 async startTurnProcessSnapshot(identity:TurnRuntimeIdentity,...input:Parameters<TrustedPiSandboxProcessApi['startProcess']>){this.core.assert(['reserved'],identity);const [command,options]=input;const fixed=`/usr/local/bin/node /opt/riffology/trusted-pi/trusted-pi-turn-host.mjs ${this.hostToken}`;if(command!==fixed||options.processId!==this.processId||options.autoCleanup!==false||options.cwd!=='/var/lib/riffology'||options.encoding!=='utf8'||!Number.isSafeInteger(options.timeout)||options.timeout<1||options.timeout>600000||!same(options.env,{LANG:'C.UTF-8',PATH:'/usr/local/bin:/usr/bin:/bin'}))fail('workspace-native-start-denied');await this.resetPrior();if(!this.core.storage.kv.get('pi-file:control.json'))fail('workspace-native-control-unprepared');return this.fence.runStart(identity,async()=>{await this.core.activate('trustedPi');this.core.storage.kv.put('pi-start-intent',true);await this.core.storage.sync();const process=await this.core.sdk(['active'],()=>this.core.options.sandbox.startProcess(`python3 /opt/riffology/runtime_supervisor.py spawn --epoch ${this.core.token} -- ${fixed}`,{...options,timeout:Math.min(options.timeout,this.core.options.deadlineAt-this.core.clock())}),true);if(process.id!==this.processId)fail('workspace-native-process-denied');const found=await this.snapshot(identity,this.processId);if(!found)return fail('workspace-native-process-unknown');return found;},()=>this.core.destroy());}
 private view(identity:TurnRuntimeIdentity,snapshot:TrustedPiProcessSnapshot){return {...snapshot,getStatus:async()=>{const current=await this.snapshot(identity,snapshot.id);if(!current)fail('workspace-native-process-unknown');return current!.status;},kill:async(signal?:string)=>{if(signal!==undefined&&signal!=='SIGTERM')fail('workspace-native-signal-denied');await this.cancelTurnProcess(identity,snapshot.id);}};}
 async startTurnProcess(identity:TurnRuntimeIdentity,...input:Parameters<TrustedPiSandboxProcessApi['startProcess']>){return this.view(identity,await this.startTurnProcessSnapshot(identity,...input));}
 getTurnProcessSnapshot(identity:TurnRuntimeIdentity,id:string){return this.snapshot(identity,id);}
 async getTurnProcess(identity:TurnRuntimeIdentity,id:string){const snapshot=await this.snapshot(identity,id);return snapshot?this.view(identity,snapshot):null;}
 async cancelTurnProcess(identity:TurnRuntimeIdentity,id:string){this.core.assert(['reserved','active','sealed'],identity);if(id!==this.processId)fail('workspace-native-process-denied');this.core.storage.kv.put('pi-retire-only',true);await this.core.storage.sync();return this.fence.cancelOnce(identity,async()=>{if(!this.core.storage.kv.get('pi-start-intent'))return false;const process=await this.core.sdk(['active','sealed'],()=>this.core.options.sandbox.getProcess(id));if(!process||process.id!==id)return false;const status=await this.core.sdk(['active','sealed'],()=>process.getStatus());if(!['starting','running'].includes(status)){await this.core.seal();return false;}await this.core.sdk(['active'],()=>process.kill('SIGTERM'));return true;});}
 async queryObserverExecution(identity:TurnRuntimeIdentity){this.core.assert(['active'],identity);this.core.live();if(!this.core.options.queryObserverExecution)fail('workspace-native-observer-unavailable');const result=await this.core.options.queryObserverExecution!(identity);this.core.assert(['active'],identity);this.core.live();return result;}
 async sealWorkspaceBinding(){if(this.core.storage.kv.get('pi-retire-only'))fail('workspace-native-retired');return this.core.seal();}
 pruneWorkspaceBinding(token:string){if(token!==this.hostToken)fail('workspace-native-token-denied');return this.core.prune(token);}
 destroyWorkspaceBinding(){return this.core.destroy();}
 destroyAndReleaseState(identity:TurnRuntimeIdentity){this.core.assert(['reserved','active','sealing','sealed','quarantined'],identity);return this.fence.fence(identity,()=>this.core.destroy());}
}

export async function createWorkspaceNativeController(options:WorkspaceNativeOptions&{domain:'project'}):Promise<WorkspaceProjectNativeController>;
export async function createWorkspaceNativeController(options:WorkspaceNativeOptions&{domain:'trustedPi'}):Promise<WorkspaceTrustedPiNativeController>;
export async function createWorkspaceNativeController(options:WorkspaceNativeOptions):Promise<WorkspaceProjectNativeController|WorkspaceTrustedPiNativeController>;
export async function createWorkspaceNativeController(options:WorkspaceNativeOptions){
 const checked={...options,context:structuredClone(options.context),priorBinding:options.priorBinding?structuredClone(options.priorBinding):undefined};
 if(checked.ledger.actorId!==checked.actorId||checked.ledger.domain!==checked.domain)fail('workspace-native-actor-denied');
 const reserved=await checked.ledger.reserve(checked.context);const core=new NativeCore(checked,reserved.binding.token);
 if(checked.domain==='project'){const logical=(await sandboxActorIds(checked.context.identity.scope,checked.context.identity.turnId,checked.context.identity.dispatchId)).project;core.assert(['reserved','active','sealing','sealed','quarantined']);return new WorkspaceProjectNativeController(core,logical);}
 const hostToken=(await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity:checked.context.identity})).slice(0,52);core.assert(['reserved','active','sealing','sealed','quarantined']);return new WorkspaceTrustedPiNativeController(core,hostToken);
}
