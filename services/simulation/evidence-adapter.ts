import {EvidenceLedger,type EvidenceGroup,type EvidenceAssessment} from './evidence.ts';
import type {ExperimentGroupRecord} from './groups.ts';
import {modelVersion} from './source.ts';
import type {TurnScope} from '../turn/protocol.ts';
import {sameScope} from '../turn/protocol.ts';
/** Identity/configuration mapping comes only from the durable group authority. */
export function evidenceGroup(record:ExperimentGroupRecord,scope:TurnScope):EvidenceGroup{
 if(!sameScope(record.scope,scope))throw Error('evidence-group-mismatch');
 const inputs:EvidenceGroup['inputs']={},pendingStatuses:NonNullable<EvidenceGroup['pendingStatuses']>={};
 for(const child of record.children){const configuration=record.configurations.find(c=>c.configurationId===child.configurationId);if(!configuration||Object.hasOwn(inputs,child.runId))throw Error('evidence-group-mismatch');inputs[child.runId]={parameters:configuration.parameters,seed:child.seed};pendingStatuses[child.runId]=child.cancelled?'cancelled':'pending';}
 return {experimentId:record.groupId,version:modelVersion(record.plan),status:record.status,inputs,pendingStatuses,arms:record.configurations.map(c=>({armId:c.configurationId,role:c.role,runIds:record.children.filter(r=>r.configurationId===c.configurationId).map(r=>r.runId)}))};
}
export function assessmentForRun(assessments:EvidenceAssessment[],runId:string,version:ReturnType<typeof modelVersion>){return assessments.find(a=>a.scope==='run'?a.runId===runId:a.version.filesSha256===version.filesSha256&&a.version.specSha256===version.specSha256);}
export async function evidenceAssessments(storage:DurableObjectStorage){return [...(await storage.list<EvidenceAssessment>({prefix:'research:rejection:'})).values()];}
export {EvidenceLedger};
