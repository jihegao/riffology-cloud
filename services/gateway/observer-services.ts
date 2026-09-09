import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';

type ObserverArtifactPart='state'|'view';
interface WorkspaceObserverReader{readObserverArtifact(input:{scope:TurnScope;actor:TurnActor;turnId:string;commandId:string;part:ObserverArtifactPart}):Promise<unknown>}
export interface GatewayObservations{artifact(scope:TurnScope,caller:TurnActor,turnId:string,commandId:string,part:ObserverArtifactPart):Promise<unknown>}
export function createGatewayObserverServices(env:{WORKSPACE_AGENT:{getByName(name:string):WorkspaceObserverReader}}):GatewayObservations{
 const actor=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
 return {artifact:(scope,caller,turnId,commandId,part)=>actor(scope).readObserverArtifact({scope,actor:caller,turnId,commandId,part})};
}
