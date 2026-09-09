import {normalizeObserverCommand,type ObserverCommand,type ObserverJson} from './observer-protocol.ts';
import type {ObserverExecutionTarget} from './observer-execution.ts';
import {observerArtifactReceipt,type ObserverArtifactReceipt} from './observer-artifacts.ts';
import {turnDigest} from '../turn/protocol.ts';

export type ObserverArtifactReadGrant={schemaVersion:1;purpose:'observer-artifact-read';command:ObserverCommand;receipt:ObserverArtifactReceipt;expiresAt:number};
export interface ObserverArtifactReadCapabilityPort{authorize():Promise<ObserverArtifactReadGrant>}
/** Short lived authorization for historical bytes, independent of execution permission. */
export function observerArtifactReadGrant(raw:unknown,command:ObserverCommand,receipt:ObserverArtifactReceipt,now=Date.now()):ObserverArtifactReadGrant{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('observer-artifact-authority-denied');
 const keys=['schemaVersion','purpose','command','receipt','expiresAt'],data:Record<string,unknown>={};
 if(Reflect.ownKeys(raw).length!==keys.length)throw Error('observer-artifact-authority-denied');
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(raw,key);if(!d?.enumerable||!('value'in d))throw Error('observer-artifact-authority-denied');data[key]=d.value;}
 const grantedCommand=normalizeObserverCommand(data.command),grantedReceipt=observerArtifactReceipt(data.receipt);
 if(data.schemaVersion!==1||data.purpose!=='observer-artifact-read'||JSON.stringify(grantedCommand)!==JSON.stringify(command)||JSON.stringify(grantedReceipt)!==JSON.stringify(receipt)||!Number.isSafeInteger(data.expiresAt)||(data.expiresAt as number)<=now||(data.expiresAt as number)>now+5000)throw Error('observer-artifact-authority-denied');
 return {schemaVersion:1,purpose:'observer-artifact-read',command:grantedCommand,receipt:grantedReceipt,expiresAt:data.expiresAt as number};
}
export interface ObserverExecutorCapabilityPort{
 authorize():Promise<ObserverExecutionTarget>;
 forward(request:Request):Promise<Response>;
 cancelled():Promise<boolean>;
}
export interface ObserverExecutorNamespace{
 getByName(name:string):{
  execute(command:ObserverCommand,capability:ObserverExecutorCapabilityPort):Promise<{stopped:true;result:{[key:string]:ObserverJson}}>;
  readArtifact(command:ObserverCommand,receipt:ObserverArtifactReceipt,capability:ObserverArtifactReadCapabilityPort):Promise<{receipt:ObserverArtifactReceipt;content:Uint8Array}>;
  /** A durable fence plus confirmed resource exit, including delayed starts. */
  stop(command:ObserverCommand):Promise<boolean>;
 };
}
/** Same logical call always reaches the same executor even if a conflicting
 * operation/target/deadline is supplied. That executor must reject conflicts.
 * Historical normalization allows stop after expiry; it grants no authority. */
export async function observerExecutorActorName(raw:ObserverCommand):Promise<string>{
 const c=normalizeObserverCommand(raw);
 return 'observer-executor-'+await turnDigest({purpose:'observer-executor',scope:c.scope,turnId:c.turnId,dispatchId:c.dispatchId,commandId:c.commandId});
}
