import {mkdir,open,readFile,readdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compileSchedule} from './g5-benchmark-schedule.mjs';
export const APP_ORIGIN='https://m1.riff-demo.gaojihe.cn';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
export async function validateLiveConfig(config,{cookie,approvedSha256},clock=Date.now){
 const schedule=await compileSchedule(config.proposal);
 if(!cookie||typeof cookie!=='string'||/[\r\n]/.test(cookie))throw Error('ordinary-session-required');
 if(config.origin!==APP_ORIGIN||!id(config.tenantId)||!id(config.windowId))throw Error('fixed-origin-or-identity-invalid');
 if(!config.authorization||config.authorization.scope!=='g5-a-create-reconcile' || config.authorization.syntheticOnly!==true || !config.authorization.operatorReference)throw Error('explicit-scoped-authorization-required');
 if(!approvedSha256||approvedSha256!==sha(config))throw Error('out-of-band-approved-config-hash-required');
 if(clock()>=Date.parse(config.proposal.productionManifest.deadline))throw Error('admission-deadline');
 return schedule;
}
export function ordinaryTransport(cookie,fetchImpl=fetch){
 if(!cookie||/[\r\n]/.test(cookie))throw Error('ordinary-session-required');
 return async(method,path,body,key)=>{
  if(!/^\/api\/(tenants|workspaces)\//.test(path)||path.includes('..')||/[\\?#]/.test(path))throw Error('product-path-only');
  const response=await fetchImpl(APP_ORIGIN+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{cookie,origin:APP_ORIGIN,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status!==200&&response.status!==201&&response.status!==202)throw Error(`product-http-${response.status}`);
  const reader=response.body?.getReader();if(!reader)throw Error('product-response-empty');
  let size=0;const chunks=[];while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();throw Error('product-response-too-large');}chunks.push(Buffer.from(part.value));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 };
}
export class DurableOrdinaryRunner{
 constructor({directory,config,credentials,transport,preflight,clock=Date.now}){Object.assign(this,{directory,config,credentials,transport,preflight,clock});}
 async init(){this.schedule=await validateLiveConfig(this.config,this.credentials,this.clock);if(typeof this.preflight!=='function')throw Error('trusted-release-preflight-required');
 const proof=await this.preflight();
 if(proof?.profileSha256!==this.schedule.profileSha256||proof?.sourceSha256!==this.config.sourceSha256||!proof?.evidenceSha256||proof?.windowId!==this.config.windowId)throw Error('trusted-release-preflight-mismatch');
 await mkdir(this.directory,{recursive:true,mode:0o700});this.ready=true;}
 async postOnce(name,path,body){
  if(!this.ready)throw Error('approved-init-required');
  let lock;try{lock=await open(this.directory+'/.admission-lock','wx',0o600);}catch(error){if(error.code==='EEXIST')return {blocked:'concurrent-or-crashed-admission-lock'};throw error;}
  try{return await this.postLocked(name,path,body);}finally{await lock.close();await unlink(this.directory+'/.admission-lock');}
 }
 async postLocked(name,path,body){
  if(!this.ready)throw Error('approved-init-required');
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(name))throw Error('invalid-intent-name');
  const entries=await readdir(this.directory);
  for(const entry of entries.filter(v=>v.endsWith('.intent.json'))) {
   if(!entries.includes(entry.replace('.intent.json','.ack.json'))&&entry!==name+'.intent.json')return {blocked:'prior-delivery-unknown-no-new-admission',intent:entry};
  }
  if(this.clock()>=Date.parse(this.config.proposal.productionManifest.deadline))throw Error('admission-deadline');
  const filename=this.directory+'/'+name, fingerprint=sha({path,body,config:sha(this.config)});
  let handle;
  try{handle=await open(filename+'.intent.json','wx',0o600);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const saved=JSON.parse(await readFile(filename+'.intent.json','utf8'));
   if(saved.fingerprint!==fingerprint)throw Error('intent-configuration-conflict');
   try{return JSON.parse(await readFile(filename+'.ack.json','utf8'));}catch(error){if(error.code==='ENOENT')return {blocked:'delivery-unknown-no-repost',intent:name};throw error;}
  }
  try{await handle.writeFile(JSON.stringify({fingerprint,path,key:this.config.windowId+'-'+name}));await handle.sync();}finally{await handle.close();}
  // Once intent is durable, any exception leaves it fenced. Never replay POST.
  const directoryHandle=await open(this.directory,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}
  if(this.clock()>=Date.parse(this.config.proposal.productionManifest.deadline))return {blocked:'deadline-after-intent-no-dispatch'};
  const result=await this.transport('POST',path,body,this.config.windowId+'-'+name);
  const ack=await open(filename+'.ack.json','wx',0o600);try{await ack.writeFile(JSON.stringify(result));await ack.sync();}finally{await ack.close();}
  return result;
 }
 async createReconcile(repeat=1){
  if(!this.schedule)throw Error('init-required');if(![1,2,3].includes(repeat))throw Error('invalid-repetition');
  const projectReply=await this.postOnce(`r${repeat}-project`,`/api/tenants/${this.config.tenantId}/projects`,{title:`G5 ${this.config.windowId} repetition ${repeat}`,starterVersion:'blank-v1'});
  if(projectReply.blocked)return projectReply;
  const project=projectReply.project;if(!project||!id(project.id)||!id(project.workspace_id))throw Error('product-project-identity-missing');
  const workspace=await this.transport('GET',`/api/workspaces/${project.workspace_id}`);
  // Product workspace GET is actual reconciliation; no private prepare/seed RPC.
  if(workspace.schemaVersion!==3||workspace.scope?.workspaceId!==project.workspace_id||workspace.scope?.tenantId!==this.config.tenantId)return {blocked:'workspace-identity-unconfirmed',projectId:project.id,workspaceId:project.workspace_id};
  const sessionReply=await this.postOnce(`r${repeat}-session`,`/api/workspaces/${project.workspace_id}/sessions`,{title:'G5 frozen dependent tasks'});
  if(sessionReply.blocked)return sessionReply;
  const session=sessionReply.session;if(!session||!id(session.id))throw Error('product-session-identity-missing');
  const task=this.schedule.schedule[(repeat-1)*6];
  const turnReply=await this.postOnce(`r${repeat}-create-model`,`/api/workspaces/${project.workspace_id}/sessions/${session.id}/turns`,{message:'Create FCFS queue model: customers=40, servers=1, arrival_rate=0.8, service_rate=1, seed='+task.primarySeed+'. Declare assumptions and limitations; save Model Spec and five source files, validate Python. Do not fabricate measured results. Explicit server Run will be separately reviewed.'});
  if(turnReply.blocked)return turnReply;
  const turn=turnReply.turn;if(!turn||!id(turn.id))throw Error('product-turn-identity-missing');
  const snapshot=await this.transport('GET',`/api/workspaces/${project.workspace_id}`);
  const files=await this.transport('GET',`/api/workspaces/${project.workspace_id}/files`);
  const actual=snapshot.turns?.[turn.id];
  return {blocked:'manual-evidence-checkpoint-required',fixtureId:task.fixtureId,projectId:project.id,workspaceId:project.workspace_id,sessionId:session.id,turnId:turn.id,observedTurnStatus:actual?.status??null,observedPersistence:actual?.persistenceOutcome??null,observedRevision:files.revision??null,
   required:['ordinary UI author/non-author source+Spec/domain review','actual successful Python tool/event/artifact IDs','saved source/archive SHA and Revision association','one explicit independent Native Run+input/seed/artifact verification','actual measured claim references when required','private upstream dispatch/usage/money ledger and unknown-charge review'],remainingPlan:{tasks:17,explicitRuns:39},acceptedTask:false};
 }
}
export {sha as configSha256};
