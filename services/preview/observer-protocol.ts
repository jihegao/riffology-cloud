import {positive,scope,turnId,type TurnScope} from '../turn/protocol.ts';

/** Platform ceilings; declarations in project files cannot increase them. */
export const OBSERVER_LIMITS=Object.freeze({
 timeoutMs:15000,workspaceConcurrency:1,resourceRequests:32,resourceResponseBytes:8*1024*1024,resourceChunks:4096,
 stateBytes:64*1024,stateIdBytes:128,jsonDepth:32,snapshotBytes:32*1024,
 consoleEntries:100,consoleEntryBytes:2*1024,consoleBytes:64*1024,
 screenshotWidth:1280,screenshotHeight:720,screenshotBytes:2*1024*1024,
});
export type ObserverOperation='snapshot'|'screenshot'|'console'|'reload';
export type ObserverCommand={schemaVersion:1;purpose:'observer';scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;commandId:string;previewId:string;operation:ObserverOperation;deadlineAt:number};
export type ObserverJson=null|boolean|number|string|ObserverJson[]|{[key:string]:ObserverJson};
export type ObserverState={simulation_state_id:string;sequence:number;state:{[key:string]:ObserverJson}};
const commandKeys=['schemaVersion','purpose','scope','sessionId','turnId','dispatchId','commandId','previewId','operation','deadlineAt'];
const stateKeys=['simulation_state_id','sequence','state'];
function closed(value:Record<string,unknown>,keys:string[]):void{
 if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('observer-command-denied');
}
/** Inspect descriptors before reading values; never invoke a caller's getter. */
function commandData(value:unknown,depth=0,budget={remaining:64}):void{
 if(--budget.remaining<0||depth>OBSERVER_LIMITS.jsonDepth)throw Error('observer-command-denied');
 if(value===null||typeof value!=='object')return;
 if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('observer-command-denied');
 const keys=Reflect.ownKeys(value);if(keys.length>64)throw Error('observer-command-denied');
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key)!;
  if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('observer-command-denied');
  commandData(d.value,depth+1,budget);
 }
}
/** Structural normalization only, including historical commands. No authority is
 * granted here: Workspace must independently verify the trusted call and target. */
export function normalizeObserverCommand(value:unknown):ObserverCommand{
 try{
  commandData(value);
  if(!value||typeof value!=='object')throw Error();
  const v=value as Record<string,unknown>;closed(v,commandKeys);
  if(v.schemaVersion!==1||v.purpose!=='observer'||!['snapshot','screenshot','console','reload'].includes(v.operation as string))throw Error();
  return {schemaVersion:1,purpose:'observer',scope:scope(v.scope),sessionId:turnId(v.sessionId),turnId:turnId(v.turnId),dispatchId:turnId(v.dispatchId),commandId:turnId(v.commandId),previewId:turnId(v.previewId),operation:v.operation as ObserverOperation,deadlineAt:positive(v.deadlineAt)};
 }catch{throw Error('observer-command-denied');}
}
/** Enforces the local time ceiling, not Turn/Preview/Run authorization deadlines. */
export function validateObserverCommand(value:unknown,now=Date.now()):ObserverCommand{
 const command=normalizeObserverCommand(value);
 if(!Number.isSafeInteger(now)||now<1||command.deadlineAt<=now||command.deadlineAt-now>OBSERVER_LIMITS.timeoutMs)throw Error('observer-command-denied');
 return command;
}
function jsonData(value:unknown,depth:number):void{
 if(depth>OBSERVER_LIMITS.jsonDepth)throw Error();
 if(value===null||typeof value==='string'||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error();return;}
 if(typeof value!=='object')throw Error();
 // Only JSON.parse output reaches this walk; its node count is bounded by input bytes.
 for(const item of Object.values(value))jsonData(item,depth+1);
}
/** Untrusted project-reported domain state, never platform identity or authority.
 * Callers must enforce stateBytes incrementally while reading the response. */
export function parseObserverState(bytes:Uint8Array):ObserverState{
 try{
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>OBSERVER_LIMITS.stateBytes)throw Error();
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  const v=value as Record<string,unknown>;closed(v,stateKeys);
  if(typeof v.simulation_state_id!=='string'||!v.simulation_state_id.trim()||new TextEncoder().encode(v.simulation_state_id).byteLength>OBSERVER_LIMITS.stateIdBytes||!Number.isSafeInteger(v.sequence)||(v.sequence as number)<0||!v.state||typeof v.state!=='object'||Array.isArray(v.state)||Object.getPrototypeOf(v.state)!==Object.prototype)throw Error();
  jsonData(value,0);
  return value as ObserverState;
 }catch{throw Error('observer-state-invalid');}
}
