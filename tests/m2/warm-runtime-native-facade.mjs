/** Instrumented native boundary, not a container/process-isolation substitute.
 * Writes deterministic fixture process output; orchestration remains production.
 * Admission uses the actual Workspace claim RPC and persistent capacity ledger.
 * It does not replace native controller, UID, process-tree or seccomp tests. */
export const warmRuntimeNativeFacadeSource=`
 import {workspaceBindingToken} from './services/sandbox/workspace-binding.ts';
 import {turnDigest} from './services/turn/protocol.ts';
 const encode=value=>new TextEncoder().encode(value),digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 class NativeFacade extends DurableObject{
  async options(){return await this.ctx.storage.get('fixture:options')??JSON.parse(this.env.FIXTURE_NATIVE_OPTIONS??'{}');}
  async fixtureConfigure(input){await this.ctx.storage.put('fixture:options',input);}
  async fixtureStats(){return {calls:await this.ctx.storage.get('fixture:calls')??[],context:await this.ctx.storage.get('fixture:context')??null};}
  async loseAckOnce(method){const options=await this.options(),key='fixture:lost:'+method;if(options[method+'AckLost']&&!await this.ctx.storage.get(key)){await this.ctx.storage.put(key,true);await this.ctx.storage.sync();throw Error('fixture-'+method+'-ack-lost');}}
  async claim(domain){if((await this.options())?.standalone)return;const context=await this.ctx.storage.get('fixture:context');if(!context)throw Error('fixture-context-missing');const key='fixture:claimed:'+context.bindingEpoch;if(await this.ctx.storage.get(key))return;await this.ctx.storage.put(key,true);const result=await this.env.WORKSPACE_AGENT.getByName(workspaceAgentName(context.lease.scope.tenantId,context.lease.scope.workspaceId)).claimWorkspaceNative({context,domain});if(!result.authorized)throw Error('fixture-start-not-authorized');}
  async record(method,value){const calls=await this.ctx.storage.get('fixture:calls')??[];calls.push({method,value});await this.ctx.storage.put('fixture:calls',calls);}
  async configureWorkspaceBinding(input){await this.record('configure',input.context);await this.ctx.storage.put('fixture:context',input.context);await this.loseAckOnce('configure');}
  async sealWorkspaceBinding(context){await this.record('seal',context);return {schemaVersion:1,bindingEpoch:await workspaceBindingToken(context),status:'quiescent',remaining:0};}
  async pruneWorkspaceBinding(context,value){await this.record('prune',{context,value});}
  async destroyWorkspaceLease(lease){await this.record('destroy-lease',lease);return {running:(await this.options())?.destroyRunning===true};}
  async destroyWorkspaceBinding(context){await this.record('destroy',context);return {running:(await this.options())?.destroyRunning===true};}
 }
 export class TrustedPiFacade extends NativeFacade{
  async writeTurnFile(identity,path,content,options){await this.claim('trustedPi');await this.record('write',{identity,path,encoding:options?.encoding});await this.ctx.storage.put('file:'+path,content);await this.loseAckOnce('write');return {success:true,path,bytesWritten:content.length};}
  async readTurnFile(identity,path){await this.claim('trustedPi');await this.record('read',{identity,path});const content=await this.ctx.storage.get('file:'+path);if(content===undefined)throw Error('file not found');return {success:true,path,content};}
  async startTurnProcess(identity,command,options){return this.startTurnProcessSnapshot(identity,command,options);}
  async getTurnProcess(identity,id){return this.getTurnProcessSnapshot(identity,id);}
  async startTurnProcessSnapshot(identity,command,options){const prior=await this.ctx.storage.get('process:'+options.processId);if(prior)return prior;await this.record('start',{identity,processId:options.processId});const token=(await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity})).slice(0,52),root='/var/lib/riffology/turns/'+token,session=JSON.stringify({format:'riffology-pi-session-v1',scope:{tenantId:identity.scope.tenantId,projectId:identity.scope.projectId,sessionId:identity.sessionId},createdAt:new Date().toISOString(),entries:[],leafId:null}),configured=await this.options(),process={id:options.processId,status:configured.running?'running':'completed',...(configured.running?{}:{exitCode:0})};
   await this.ctx.storage.put('file:'+root+'.output-session.json',btoa(session));await this.ctx.storage.put('file:'+root+'.result.json',JSON.stringify({schemaVersion:1,identity,phase:configured.running?'running':'terminal',outcome:configured.running?null:'completed',executionErrorCode:null,events:[],outputSessionSha256:configured.running?null:await digest(encode(session))}));await this.ctx.storage.put('process:'+options.processId,process);return process;}
  async fixtureComplete(identity){const token=(await turnDigest({schemaVersion:1,purpose:'trusted-pi-native',identity})).slice(0,52),root='/var/lib/riffology/turns/'+token,session=atob(await this.ctx.storage.get('file:'+root+'.output-session.json'));const result=JSON.parse(await this.ctx.storage.get('file:'+root+'.result.json'));await this.ctx.storage.put('file:'+root+'.result.json',JSON.stringify({...result,phase:'terminal',outcome:'completed',outputSessionSha256:await digest(encode(session))}));for(const call of await this.ctx.storage.get('fixture:calls')??[]){if(call.method==='start'&&call.value.identity.turnId===identity.turnId)await this.ctx.storage.put('process:'+call.value.processId,{id:call.value.processId,status:'completed',exitCode:0});}}
  async getTurnProcessSnapshot(identity,id){return await this.ctx.storage.get('process:'+id)??null;}
  async cancelTurnProcess(identity,id){await this.record('cancel',{identity,id});return {dispatched:false};}
  async destroyAndReleaseState(identity){await this.record('cold-destroy',identity);return {running:false};}
 }
 export class ProjectFacade extends NativeFacade{
  async restoreWorkspace(identity,base,archive){await this.claim('project');await this.record('restore',identity);const bytes=archive??new Uint8Array(10240);await this.ctx.storage.put('files',bytes);return {sha256:await digest(bytes),bytes:bytes.byteLength};}
  async prepareWorkspaceOnce(identity,base,archive,operationId,deadlineAt){const prior=await this.ctx.storage.get('preparation');if(prior)return prior;const receipt={operationId,...await this.restoreWorkspace(identity,base,archive)};const value={status:'ready',receipt};await this.ctx.storage.put('preparation',value);return value;}
  async observeWorkspacePreparation(){return await this.ctx.storage.get('preparation')??{status:'unknown'};}
  async freezeWorkspace(identity){await this.record('freeze',identity);return await this.ctx.storage.get('files')??new Uint8Array(10240);}
  async abortWorkspace(identity){await this.record('cold-abort',identity);return {running:false,fenced:true};}
 }
`;
