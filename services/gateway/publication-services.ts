import type {TurnScope,TurnActor} from '../turn/protocol.ts';
import type {PublicationReadiness,PublicationVersion} from '../publication/readiness.ts';
import type {StoredPublication} from '../publication/artifacts.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
export interface GatewayPublications{prepare(scope:TurnScope,actor:TurnActor):Promise<{readiness:PublicationReadiness}>;freeze(scope:TurnScope,actor:TurnActor,expected:PublicationVersion):Promise<StoredPublication>}
export function createGatewayPublications(env:{WORKSPACE_AGENT:{getByName(name:string):{publicationPrepare(input:{scope:TurnScope;actor:TurnActor;expected?:PublicationVersion;freeze?:boolean}):Promise<{readiness:PublicationReadiness;stored?:StoredPublication}>}}}):GatewayPublications{
 const workspace=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));return {prepare:(scope,actor)=>workspace(scope).publicationPrepare({scope,actor}),freeze:async(scope,actor,expected)=>{const result=await workspace(scope).publicationPrepare({scope,actor,expected,freeze:true});if(!result.stored)throw Error('publication-not-ready');return result.stored;}};
}
