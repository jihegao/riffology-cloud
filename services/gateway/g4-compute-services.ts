import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
export function createGatewayG4ComputeServices(env:{WORKSPACE_AGENT:{getByName(name:string):{g4ComputeCounts(input:{scope:TurnScope;actor:TurnActor}):Promise<unknown>}}}){
 return async(scope:TurnScope,actor:TurnActor)=>{const raw=await env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).g4ComputeCounts({scope,actor});try{return JSON.parse(JSON.stringify(raw));}finally{const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;if(typeof dispose==='function')dispose.call(raw);}};
}

import {modelBudgetTenantName} from '../model-budget/core.ts';
export function createGatewayG4WindowServices(env:{TENANT_MODEL_BUDGET?:{getByName(name:string):{g4WindowSnapshot?(tenantId:string):Promise<unknown>}}}){
 return async(tenantId:string,actor:TurnActor)=>{const port=env.TENANT_MODEL_BUDGET?.getByName(modelBudgetTenantName(tenantId));if(!port?.g4WindowSnapshot)throw Error('g4-window-unavailable');const raw=await port.g4WindowSnapshot(tenantId);let value:any;try{value=JSON.parse(JSON.stringify(raw));}finally{const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;if(typeof dispose==='function')dispose.call(raw);}if(value.policy&&(value.policy.tenantId!==tenantId||value.policy.userId!==actor.userId))throw Error('g4-window-scope-denied');return {schema:'riffology.g4-window-read/v1',readOnly:true,noAddedCalls:true,...value};};
}
