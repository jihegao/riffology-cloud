import type {EvidenceView} from './evidence.ts';
/** Whole records are removed, never their provenance IDs. No artifact I/O here. */
export function boundedResearchContext(input:{model:unknown;experiments:unknown[];experimentGroups:unknown[];evidence:EvidenceView[];hasMoreExperiments?:boolean;hasMoreGroups?:boolean;hasMoreEvidence?:boolean}){
 const result={model:input.model,experiments:input.experiments.slice(0,5),experimentGroups:input.experimentGroups.slice(0,2),evidence:input.evidence.slice(0,3),evidencePolicy:{numericVerification:'recorded-proof-not-current-availability',agentText:'unverified-interpretation',modelValidity:'separate-from-execution',sourceLookup:'GET /api/workspaces/:workspaceId/evidence/:claimId'},truncated:{experiments:Boolean(input.hasMoreExperiments)||input.experiments.length>5,experimentGroups:Boolean(input.hasMoreGroups)||input.experimentGroups.length>2,evidence:Boolean(input.hasMoreEvidence)||input.evidence.length>3}};
 const size=()=>new TextEncoder().encode(JSON.stringify(result)).byteLength;
 for(const key of ['experimentGroups','experiments','evidence'] as const)while(result[key].length&&size()>60000){result[key].pop();result.truncated[key]=true;}
 if(size()>60000)throw Error('research-context-too-large');return result;
}
