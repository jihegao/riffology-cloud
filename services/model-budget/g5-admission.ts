import {g5WindowPolicy,type G5WindowPolicy,type G5Task} from './g5-window.ts';
import {turnDigest} from '../turn/protocol.ts';
export type G5TaskRegistration=G5Task&{parentTurnKey?:string};
export async function g5TaskRecovery(kind:G5Task['kind'],tenantId:string,userId:string,identityInput:unknown,digestInput:unknown):Promise<Omit<G5Task,'key'>>{
 return {kind,tenantId,userId,intentKeySha256:await turnDigest({purpose:'g5-intent-key',kind,tenantId,userId,identityInput}),digest:await turnDigest({purpose:'g5-task-input',digestInput})};
}
/** configured is platform environment only, never a request-body policy. */
export async function g5TaskKey(configured:string|G5WindowPolicy,kind:G5Task['kind'],tenantId:string,userId:string,identityInput:unknown,digestInput:unknown,parentTurnKey?:string):Promise<G5TaskRegistration>{
 const policy=g5WindowPolicy(typeof configured==='string'?JSON.parse(configured):configured);if(!policy)throw Error('g5-window-configuration-absent');const recovery=await g5TaskRecovery(kind,tenantId,userId,identityInput,digestInput);
 return {kind,tenantId,userId,key:await turnDigest({purpose:'g5-task',windowId:policy.windowId,kind,tenantId,userId,identityInput}),intentKeySha256:recovery.intentKeySha256,digest:recovery.digest,...(parentTurnKey?{parentTurnKey}:{})};
}
