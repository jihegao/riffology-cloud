import type {EvidenceView} from './evidence.ts';
/** Whole records are removed, never their provenance IDs. No artifact I/O here. */
export function boundedResearchContext(input:{model:unknown;experiments:unknown[];experimentGroups:unknown[];evidence:EvidenceView[];hasMoreExperiments?:boolean;hasMoreGroups?:boolean;hasMoreEvidence?:boolean}){
 // Display contents may be 512 KiB. Keep their frozen manifest/identity in
 // this 60 KiB research summary, without evicting actual Run/Evidence records.
 let model=input.model;
 if(model&&typeof model==='object'&&'artifacts' in model&&model.artifacts&&typeof model.artifacts==='object'&&!Array.isArray(model.artifacts)){
  const {contents:_,...artifacts}=model.artifacts as Record<string,unknown>;
  model={...model,artifacts:{...artifacts,contentsOmitted:true}};
 }
 const result={model,experiments:input.experiments.slice(0,5),experimentGroups:input.experimentGroups.slice(0,2),evidence:input.evidence.slice(0,3),evidencePolicy:{numericVerification:'recorded-proof-not-current-availability',agentText:'unverified-interpretation',modelValidity:'separate-from-execution',sourceLookup:'GET /api/workspaces/:workspaceId/evidence/:claimId'},truncated:{experiments:Boolean(input.hasMoreExperiments)||input.experiments.length>5,experimentGroups:Boolean(input.hasMoreGroups)||input.experimentGroups.length>2,evidence:Boolean(input.hasMoreEvidence)||input.evidence.length>3}};
 const size=()=>new TextEncoder().encode(JSON.stringify(result)).byteLength;
 for(const key of ['experimentGroups','experiments','evidence'] as const)while(result[key].length&&size()>60000){result[key].pop();result.truncated[key]=true;}
 if(size()>60000)throw Error('research-context-too-large');return result;
}
