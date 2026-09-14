import type {TurnScope,TurnActor} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
export interface GatewayResearchExports{download(scope:TurnScope,actor:TurnActor):Promise<Response>}
export function createGatewayResearchExports(env:{WORKSPACE_AGENT:{getByName(name:string):{researchExport(input:{scope:TurnScope;actor:TurnActor}):Promise<Response>}}}):GatewayResearchExports{
 return {download:(scope,actor)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId)).researchExport({scope,actor})};
}
