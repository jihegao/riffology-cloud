import {parseModelSpec,resolveParameters,validateMetrics,type ModelSpec,type ParameterValues} from './model-spec.ts';
import {sha,turnId} from '../turn/protocol.ts';
import {jsonEquivalent} from '../turn/json-equivalent.ts';
export type ExperimentProvenance={schemaVersion:1;authority:'platform-experiment';revisionId:string;filesSha256:string;dependencyLockSha256:string;executionReceiptId:string};
export type OracleRow={seed:number;parameters:ParameterValues;steps:number;before:Record<string,number>;after:Record<string,number>};
export type ResultEnvelope={schemaVersion:1;provenance:ExperimentProvenance;rows:OracleRow[];history:Record<string,string>};
export type ResultFailure='contract'|'model'|'harness'|'provider'|'save'|'billing'|'resource';
function fail(kind:ResultFailure,reason:string):never{throw Error(`${kind}:${reason}`);}
function provenance(raw:ExperimentProvenance){
 if(!raw||Object.keys(raw).sort().join(',')!=='authority,dependencyLockSha256,executionReceiptId,filesSha256,revisionId,schemaVersion'||raw.schemaVersion!==1||raw.authority!=='platform-experiment')fail('contract','execution-provenance');
 return {schemaVersion:1,authority:raw.authority,revisionId:turnId(raw.revisionId),filesSha256:sha(raw.filesSha256),dependencyLockSha256:sha(raw.dependencyLockSha256),executionReceiptId:turnId(raw.executionReceiptId)};
}
function row(spec:ModelSpec,value:OracleRow):OracleRow{
 if(!value||Object.keys(value).sort().join(',')!=='after,before,parameters,seed,steps'||!Number.isSafeInteger(value.seed)||value.seed<0||value.seed>0xffffffff||!Number.isSafeInteger(value.steps)||value.steps<0||value.steps>10000000)fail('contract','seed-or-step-schema');
 let parameters:ParameterValues,before:Record<string,number>,after:Record<string,number>;
 try{parameters=resolveParameters(spec,value.parameters);before=validateMetrics(spec,value.before);after=validateMetrics(spec,value.after);}catch{fail('contract','parameters-or-metrics');}
 if(!jsonEquivalent(parameters,value.parameters))fail('contract','explicit-parameters-required');
 return {seed:value.seed,steps:value.steps,parameters,before,after};
}
/** expectedRows must come from an independent deterministic oracle/platform
 * replay, never from Agent narration. This validates candidates; the platform
 * Experiment/Evidence authority remains responsible for publication. */
export function validateResultEnvelope(specInput:unknown,expected:ExperimentProvenance,expectedRows:OracleRow[],actual:ResultEnvelope,previousHistory:Record<string,string>={}):{status:'validated-candidate';rows:number}{
 const spec=parseModelSpec(specInput),binding=provenance(expected);
 if(!actual||Object.keys(actual).sort().join(',')!=='history,provenance,rows,schemaVersion'||actual.schemaVersion!==1||!jsonEquivalent(provenance(actual.provenance),binding))fail('contract','version-or-execution-mismatch');
 if(!Array.isArray(actual.rows)||!Array.isArray(expectedRows)||expectedRows.length<1||expectedRows.length>4096||actual.rows.length!==expectedRows.length)fail('contract','row-coverage');
 const key=(r:OracleRow)=>JSON.stringify({seed:r.seed,parameters:Object.fromEntries(Object.entries(r.parameters).sort(([a],[b])=>a.localeCompare(b)))});
 const expectedMap=new Map<string,OracleRow>();
 for(const value of expectedRows){const checked=row(spec,value),id=key(checked);if(expectedMap.has(id))fail('harness','duplicate-oracle-row');expectedMap.set(id,checked);}
 const seen=new Set<string>();
 for(const value of actual.rows){const checked=row(spec,value),id=key(checked),oracle=expectedMap.get(id);if(seen.has(id)||!oracle)fail('contract','row-coverage');seen.add(id);if(checked.steps!==oracle.steps)fail('model','actual-update-count');if(!jsonEquivalent(checked.before,oracle.before)||!jsonEquivalent(checked.after,oracle.after))fail('model','numeric-oracle-mismatch');}
 if(!actual.history||typeof actual.history!=='object'||Array.isArray(actual.history)||Object.keys(actual.history).length>4096)fail('contract','history-schema');
 for(const [id,hash] of Object.entries(actual.history)){turnId(id);sha(hash);}
 for(const [id,hash] of Object.entries(previousHistory))if(sha(hash)!==actual.history[id])fail('contract','history-not-preserved');
 return {status:'validated-candidate',rows:actual.rows.length};
}
export function verifyDefaultChange(before:unknown,after:unknown,parameter:string,value:number|string|boolean){
 const oldSpec=parseModelSpec(before),next=parseModelSpec(after);if(!oldSpec.parameters[parameter]||!next.parameters[parameter])fail('contract','default-parameter-missing');
 const expected=structuredClone(oldSpec);expected.parameters[parameter].default=value;parseModelSpec(expected);
 if(!jsonEquivalent(next,expected))fail('contract','unexpected-default-change');return next;
}
