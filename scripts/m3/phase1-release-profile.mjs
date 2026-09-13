#!/usr/bin/env node
const SHA40=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,SHA64=/^[a-f0-9]{64}$/;
const REVISION=/^[A-Za-z0-9_-]{1,128}$/;
const GATES=['M2_TURNS_ENABLED','M3_SERVICE_ENABLED','M3_PREVIEW_ENABLED','M4_SIMULATION_ENABLED'];
const STAGES=['source','preflight','deployment','user-smoke','cleanup','final-inventory'];
const ok=(name,valid,detail)=>({name,status:valid?'passed':'blocked',...(valid||!detail?{}:{detail})});
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>obj(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** Validate caller-supplied release evidence. This is a structural, fail-closed
 * check: it cannot turn an unobserved or fixture-only claim into live proof. */
export function validatePhase1Evidence(value){
  const checks=[];
  checks.push(ok('schema',exact(value,['schemaVersion','profile','source','final','stages','workspace','experiments','preview','liveChecks'])&&value.schemaVersion===1&&['isolated-acceptance','user-preview'].includes(value.profile)));
  checks.push(ok('source',obj(value?.source)&&SHA40.test(value.source.workerSha??'')&&UUID.test(value.source.workerVersionId??'')));
  const expected= value?.profile==='user-preview' ? Object.fromEntries(GATES.map(name=>[name,true])) : Object.fromEntries(GATES.map(name=>[name,false]));
  checks.push(ok('final-gates',exact(value?.final,['workerVersionId','gates'])&&UUID.test(value.final.workerVersionId??'')&&value.final.workerVersionId===value.source?.workerVersionId&&exact(value.final.gates,GATES)&&GATES.every(name=>value.final.gates[name]===expected[name])));
  checks.push(ok('stages',obj(value?.stages)&&STAGES.every(name=>value.stages[name]?.status==='passed'&&Number.isSafeInteger(value.stages[name]?.observedAt)&&value.stages[name].observedAt>0)&&STAGES.every((name,i)=>i===0||value.stages[name]?.observedAt>=value.stages[STAGES[i-1]]?.observedAt)));
  const workspace=value?.workspace;
  checks.push(ok('workspace-lineage',exact(workspace,['workspaceId','sessionId','beforeRevision','afterRevision'])&&typeof workspace.workspaceId==='string'&&workspace.workspaceId.length>0&&typeof workspace.sessionId==='string'&&workspace.sessionId.length>0&&REVISION.test(workspace.beforeRevision??'')&&REVISION.test(workspace.afterRevision??'')&&workspace.beforeRevision!==workspace.afterRevision));
  const experiments=value?.experiments;
  const rows=Array.isArray(experiments)?experiments:[];
  checks.push(ok('experiment-lineage',rows.length>=3&&new Set(rows.map(r=>r.runId)).size===rows.length&&rows.every(row=>exact(row,['experimentId','runId','revisionId','parameters','seed','resultSha256','status'])&&typeof row.experimentId==='string'&&typeof row.runId==='string'&&REVISION.test(row.revisionId??'')&&obj(row.parameters)&&Number.isSafeInteger(row.seed)&&row.seed>=0&&row.seed<=4294967295&&SHA64.test(row.resultSha256??'')&&row.status==='completed'&&[workspace?.beforeRevision,workspace?.afterRevision].includes(row.revisionId))&&rows.some(row=>row.revisionId===workspace?.afterRevision)&&rows.some((row,i)=>i>0&&row.revisionId===rows[0].revisionId&&JSON.stringify(row.parameters)!==JSON.stringify(rows[0].parameters))));
  checks.push(ok('refresh-no-rerun',obj(value?.liveChecks)&&value.liveChecks.refreshNoRerun===true&&value.liveChecks.sameRunId===true&&value.liveChecks.sameExperimentId===true));
  checks.push(ok('preview-lineage',exact(value?.preview,['beforeRevisionId','afterRevisionId','changed'])&&REVISION.test(value.preview.beforeRevisionId??'')&&REVISION.test(value.preview.afterRevisionId??'')&&value.preview.changed===true&&value.preview.beforeRevisionId!==value.preview.afterRevisionId&&value.preview.beforeRevisionId===workspace?.beforeRevision&&value.preview.afterRevisionId===workspace?.afterRevision));
  checks.push(ok('refresh-identities',obj(value?.liveChecks?.beforeRefresh)&&obj(value?.liveChecks?.afterRefresh)&&['workspaceId','sessionId','runId','experimentId'].every(k=>typeof value.liveChecks.beforeRefresh[k]==='string'&&value.liveChecks.beforeRefresh[k]===value.liveChecks.afterRefresh[k])&&value.liveChecks.beforeRefresh.workspaceId===workspace?.workspaceId&&value.liveChecks.beforeRefresh.sessionId===workspace?.sessionId&&rows.some(r=>r.runId===value.liveChecks.beforeRefresh.runId&&r.experimentId===value.liveChecks.beforeRefresh.experimentId)));
  checks.push(ok('post-cleanup-smoke',value?.profile!=='user-preview'||Number.isSafeInteger(value?.liveChecks?.finalSmokeAt)&&value.liveChecks.finalSmokeAt>=value?.stages?.['final-inventory']?.observedAt));
  checks.push(ok('no-fixtures',obj(value?.liveChecks)&&value.liveChecks.fixture===false&&value.liveChecks.testToken===false&&value.liveChecks.observedByOrdinaryUser===true));
  return {schemaVersion:1,status:checks.every(item=>item.status==='passed')?'passed':'blocked',profile:value?.profile??null,checks};
}

export { GATES, STAGES };
