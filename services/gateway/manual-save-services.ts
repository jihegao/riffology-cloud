import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {manualSaveCapability,assertManualSaveRead,assertManualSaveBody,type ManualSavePolicyEnv} from '../workspace/manual-save-policy.ts';
type Input={scope:TurnScope;actor:TurnActor};
interface ManualSaveWorkspace {
 manualSaveState(input:Input&{path?:string}):Promise<unknown>;
 manualSave(input:Input&{key:string;body:unknown}):Promise<unknown>;
 manualSaveStatus(input:Input&{operationId:string}):Promise<unknown>;
}
/** Independent manual-save authority; it never enables a page execution host. */
export function createGatewayManualSaveServices(env:ManualSavePolicyEnv&{WORKSPACE_AGENT:{getByName(name:string):ManualSaveWorkspace}}){
 const stub=(scope:TurnScope,actor:TurnActor)=>{assertManualSaveRead(env,scope,actor);return env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));};
 const read=async(operation:Promise<unknown>)=>{const raw=await operation;try{return JSON.parse(JSON.stringify(raw));}finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}};
 return {
  capability:(scope:TurnScope,actor:TurnActor)=>manualSaveCapability(env,scope,actor),
  state:(scope:TurnScope,actor:TurnActor,path?:string)=>read(stub(scope,actor).manualSaveState({scope,actor,...(path===undefined?{}:{path})})),
  save:(scope:TurnScope,actor:TurnActor,key:string,body:unknown)=>{assertManualSaveBody(env,scope,actor,body);return read(stub(scope,actor).manualSave({scope,actor,key,body}));},
  status:(scope:TurnScope,actor:TurnActor,operationId:string)=>read(stub(scope,actor).manualSaveStatus({scope,actor,operationId})),
 };
}
