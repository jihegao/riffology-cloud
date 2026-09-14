import type {ExperimentGroupRequest} from '../simulation/groups.ts';
import type {TurnScope,TurnActor} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {ExperimentRequest} from '../simulation/host.ts';
interface SimulationWorkspace{
 submitExperimentGroup(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentGroupRequest}):Promise<unknown>;
 listExperimentGroups(input:{scope:TurnScope;before?:string}):Promise<unknown>;
 experimentGroup(input:{scope:TurnScope;groupId:string}):Promise<unknown>;
 cancelExperimentGroup(input:{scope:TurnScope;groupId:string}):Promise<unknown>;
 modelSpec(input:{scope:TurnScope}):Promise<unknown>;
 submitExperiment(input:{scope:TurnScope;actor:TurnActor;key:string;body:ExperimentRequest}):Promise<unknown>;
 listExperiments(input:{scope:TurnScope;before?:string}):Promise<unknown>;
 experiment(input:{scope:TurnScope;runId:string}):Promise<unknown>;
 cancelSimulation(input:{scope:TurnScope;runId:string}):Promise<unknown>;
}
async function detached(operation:()=>Promise<unknown>){
 const raw=await operation();try{return JSON.parse(JSON.stringify(raw));}finally{const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;if(typeof dispose==='function')dispose.call(raw);}
}
export function createGatewaySimulationServices(env:{WORKSPACE_AGENT:{getByName(name:string):SimulationWorkspace}}){
 const actor=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
 return {submitGroup:(scope:TurnScope,caller:TurnActor,key:string,body:ExperimentGroupRequest)=>detached(()=>actor(scope).submitExperimentGroup({scope,actor:caller,key,body})),listGroups:(scope:TurnScope,before?:string)=>detached(()=>actor(scope).listExperimentGroups({scope,before})),viewGroup:(scope:TurnScope,groupId:string)=>detached(()=>actor(scope).experimentGroup({scope,groupId})),cancelGroup:(scope:TurnScope,groupId:string)=>detached(()=>actor(scope).cancelExperimentGroup({scope,groupId})),model:(scope:TurnScope)=>detached(()=>actor(scope).modelSpec({scope})),submit:(scope:TurnScope,caller:TurnActor,key:string,body:ExperimentRequest)=>detached(()=>actor(scope).submitExperiment({scope,actor:caller,key,body})),list:(scope:TurnScope,before?:string)=>detached(()=>actor(scope).listExperiments({scope,before})),view:(scope:TurnScope,runId:string)=>detached(()=>actor(scope).experiment({scope,runId})),cancel:(scope:TurnScope,runId:string)=>detached(()=>actor(scope).cancelSimulation({scope,runId}))};
}
export type GatewaySimulations=ReturnType<typeof createGatewaySimulationServices>;
