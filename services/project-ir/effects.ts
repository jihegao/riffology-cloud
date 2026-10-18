import {ProjectIrAuthority} from './authority.ts';
import {normalizeToolCommand,toolCommandDigest,type ToolCommand} from '../tools/protocol.ts';
import {sameScope,turnDigest,turnId,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import type {ToolEffectReceipt} from '../tools/ledger.ts';

type Storage=Pick<DurableObjectStorage,'kv'|'sync'|'transactionSync'>;
type Context={storage:Storage;bucket:R2Bucket;scope:TurnScope;actor:TurnActor;authorize:()=>Promise<void>;clock?:()=>number};
type Saved={digest:string;sourceDigest:string|null;receipt:ToolEffectReceipt};
const DIRECT=new Set(['project_ir_run','project_ir_result']);
const encoder=new TextEncoder();
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('project-ir-input-invalid');
 return value as Record<string,unknown>;
}
async function binding(context:Context,raw:ToolCommand,effect:string){
 const command=normalizeToolCommand(raw),effectId=turnId(effect);
 if(command.operation!=='ir'||!sameScope(context.scope,command.scope))throw Error('project-ir-tool-scope-denied');
 const digest=await toolCommandDigest(command),scopeDigest=await turnDigest(context.scope);
 return {command,effectId,digest,key:'project-ir:host-effect:'+scopeDigest+':'+effectId};
}
function originalReceipt(value:ToolEffectReceipt,command:ToolCommand,effectId:string){
 const r=object(value);
 if(Object.keys(r).sort().join(',')!=='commandId,dispatchId,effectId,errorCode,observedAt,outcome,phase,result,schemaVersion,scope,turnId'||value.schemaVersion!==1||!sameScope(value.scope,command.scope)||value.turnId!==command.turnId||value.dispatchId!==command.dispatchId||value.commandId!==command.commandId||value.effectId!==effectId||!Number.isSafeInteger(value.observedAt)||value.observedAt<=0||!['absent','unknown','running','terminal'].includes(value.phase))throw Error('project-ir-effect-scope-denied');
 if(value.phase==='terminal'&&(!['completed','failed','cancelled'].includes(value.outcome!)||value.result===null||(value.outcome==='completed')!==(value.errorCode===null)))throw Error('project-ir-effect-invalid');
 if(value.phase!=='terminal'&&(value.outcome!==null||value.errorCode!==null||value.result!==null))throw Error('project-ir-effect-invalid');
 return value;
}
function bounded(value:unknown){
 const result=object(value),text=JSON.stringify(result);
 if(encoder.encode(text).length>384*1024||text.includes('"__proto__"'))throw Error('project-ir-response-too-large');
 return JSON.parse(text) as Record<string,unknown>;
}
function receipt(command:ToolCommand,effectId:string,now:number,result:Record<string,unknown>|null):ToolEffectReceipt{
 return {schemaVersion:1,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,effectId,phase:result===null?'absent':'terminal',outcome:result===null?null:'completed',errorCode:null,result,observedAt:now};
}
async function publish(context:Context,key:string,value:Saved){
 await context.authorize();
 context.storage.transactionSync(()=>{
  const prior=context.storage.kv.get<Saved>(key);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(value))throw Error('tool-idempotency-conflict');
  if(!prior)context.storage.kv.put(key,value);
 });
 await context.storage.sync();
}
function previous(context:Context,key:string,digest:string,sourceDigest:string|null){
 const saved=context.storage.kv.get<Saved>(key);
 if(saved&&(saved.digest!==digest||sourceDigest!==null&&saved.sourceDigest!==sourceDigest))throw Error('tool-idempotency-conflict');
 return saved?.receipt;
}
function declaredRegistration(operation:string,result:Record<string,unknown>,registration:unknown){
 const successful=operation==='project_ir_compile'&&result.status==='succeeded'||operation==='project_ir_check'&&result.status==='passed'||operation==='mode'&&typeof result.defaultMode==='string'||operation==='show'&&Object.hasOwn(result,'defaultMode')||operation==='install'&&result.installed===true;
 if(!successful)return;
 if(registration===undefined)throw Error('project-ir-registration-required');
 const value=object(registration),state=object(value.state);
 if(operation==='mode'&&result.defaultMode!==state.modelMode||operation==='show'&&result.defaultMode!==state.modelMode)throw Error('project-ir-registration-conflict');
 if(operation!=='project_ir_compile'&&operation!=='project_ir_check')return;
 if(!Array.isArray(value.files))throw Error('project-ir-registration-conflict');
 const ref=operation==='project_ir_compile'?result.browserArtifactRef:result.sealedRef;
 const file=value.files.find((raw:unknown)=>object(raw).path===ref);
 if(!file)throw Error('project-ir-registration-conflict');
 if(operation==='project_ir_compile'){
  let artifact:Record<string,unknown>;
  try{const binary=atob(object(file).base64 as string);artifact=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));}
  catch{throw Error('project-ir-registration-conflict');}
  if(result.bundleRef!==artifact.bundleRef||result.businessFingerprint!==artifact.businessFingerprint||result.planFingerprint!==artifact.planFingerprint||JSON.stringify(result.toolchain)!==JSON.stringify(artifact.toolchain))throw Error('project-ir-registration-conflict');
 }
}
/** A run/result effect is owned by the original Tool Ledger and the workspace's
 * durable IR projection. It does not allocate a Project Tools process. */
export async function projectIrToolEffect(context:Context,input:{command:ToolCommand;effectId:string;observeOnly:boolean}):Promise<ToolEffectReceipt>{
 const {command,effectId,digest,key}=await binding(context,input.command,input.effectId),operation=command.arguments.operation as string;
 if(!DIRECT.has(operation))throw Error('project-ir-operation-denied');
 await context.authorize();
 const prior=previous(context,key,digest,null);if(prior)return structuredClone(prior);
 const now=context.clock??Date.now;
 await context.authorize();
 const authority=new ProjectIrAuthority(context.storage,context.bucket,context.scope,now,context.authorize,context.actor);
 const observed=await authority.tool({effectId,operation,input:object(command.arguments.input),observeOnly:input.observeOnly});
 if(input.observeOnly&&observed.status==='absent')return receipt(command,effectId,now(),null);
 if(input.observeOnly&&observed.status==='failed')throw Error('project-ir-effect-reconciliation-failed');
 const result=bounded(observed);
 const terminal=receipt(command,effectId,now(),result);
 await publish(context,key,{digest,sourceDigest:null,receipt:terminal});
 await context.authorize();return terminal;
}
/** Register content-addressed compiler output before returning tool success.
 * The complete native receipt is bound to this effect and never accepted from
 * a browser. Registration data is stripped before the Agent sees the result. */
export async function projectIrRegisterEffect(context:Context,input:{command:ToolCommand;effectId:string;receipt:ToolEffectReceipt}):Promise<ToolEffectReceipt>{
 const {command,effectId,digest,key}=await binding(context,input.command,input.effectId);
 if(DIRECT.has(command.arguments.operation as string))throw Error('project-ir-operation-denied');
 await context.authorize();
 const source=originalReceipt(input.receipt,command,effectId);
 if(source.phase!=='terminal'||source.outcome!=='completed')return source;
 const sourceDigest=await turnDigest({...source,observedAt:0}),prior=previous(context,key,digest,sourceDigest);if(prior){await context.authorize();return structuredClone(prior);}
 await context.authorize();
 const raw=object(source.result),{registration,...rest}=raw;
 declaredRegistration(command.arguments.operation as string,rest,registration);
 if(registration!==undefined){
  const authority=new ProjectIrAuthority(context.storage,context.bucket,context.scope,context.clock??Date.now,context.authorize,context.actor);
  const registered=await authority.register({effectId,registration});
  if(registered.status!=='succeeded')throw Error('project-ir-registration-failed');
  if(command.arguments.operation==='project_ir_compile'&&rest.status==='succeeded'&&(!Array.isArray(registered.browserArtifactRefs)||!registered.browserArtifactRefs.includes(rest.browserArtifactRef)))throw Error('project-ir-registration-conflict');
 }
 if(command.arguments.operation==='show'&&Object.hasOwn(rest,'browserConnected')){
  const live=await new ProjectIrAuthority(context.storage,context.bucket,context.scope,context.clock??Date.now,context.authorize,context.actor).browser({operation:'show',input:{}});
  if(live.status==='failed')throw Error('project-ir-state-unavailable');
  rest.browserConnected=live.browserConnected;
 }
 const terminal={...source,result:bounded(rest)};
 await publish(context,key,{digest,sourceDigest,receipt:terminal});
 await context.authorize();return terminal;
}
