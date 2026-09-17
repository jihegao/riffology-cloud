import {modelBudgetTenantName} from './core.ts';
import {turnDigest} from '../turn/protocol.ts';
import type {G4Task} from './g4-window.ts';
export type G4TaskBudgetNamespace={getByName(name:string):{g4AdmitTask?(tenantId:string,task:G4Task):Promise<unknown>}};
/** No public forwarding route. Only authoritative platform admissions call this.
 * Real budget actors also detect removed config from persisted window metadata. */
export async function admitG4Task(namespace:G4TaskBudgetNamespace|undefined,configured:string|undefined,tenantId:string,userId:string,kind:G4Task['kind'],identity:unknown,body:unknown){
 const stub=namespace?.getByName(modelBudgetTenantName(tenantId));
 if(!stub?.g4AdmitTask){if(configured!==undefined)throw Error('g4-window-budget-unavailable');return;}
 return stub.g4AdmitTask(tenantId,{tenantId,userId,kind,key:await turnDigest({purpose:'g4-task',kind,tenantId,userId,identity}),digest:await turnDigest({purpose:'g4-task-input',body})});
}
