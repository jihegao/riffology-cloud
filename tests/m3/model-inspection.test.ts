import assert from 'node:assert/strict';
import test from 'node:test';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest,inspectModel,simulationPlan} from '../../services/simulation/source.ts';
const encode=(text:string)=>new TextEncoder().encode(text);
const spec={schemaVersion:1,researchQuestion:'How does capacity affect waiting?',scope:'check-in',entities:['passengers'],mechanisms:['queue'],assumptions:['FCFS'],parameters:{capacity:{type:'integer',default:2}},metrics:{wait:{unit:'min'}},limitations:['no abandonment'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
async function fixture(overrides:Record<string,Uint8Array>={}){
 const archive=initialWorkspaceArchive({'model/model-spec.json':encode(JSON.stringify(spec)),'model/run.py':encode('print("model")'),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}'),...overrides});
 const source={kind:'saved-turn' as const,identity:{scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},revision:{revisionId:'a'.repeat(64),objectKey:'revision-a',filesSha256:await digest(archive),sessionSha256:'b'.repeat(64),committedAt:1}};
 return {source,archive};
}
test('inspection restores saved semantic model independently of runtime availability',async()=>{
 const {source,archive}=await fixture();const result=await inspectModel(source,archive,false);
 assert.deepEqual(result.spec,spec);assert.equal(result.canRun,false);assert.equal(result.reasonCode,null);
 assert.equal(result.version?.revisionId,source.revision.revisionId);assert.equal(result.version?.filesSha256,await digest(archive));assert.equal(result.version?.specSha256,await digest(JSON.stringify(spec)));
 assert.deepEqual(await inspectModel(source,archive,true),{...result,canRun:true});
 const changed={...source,revision:{...source.revision,revisionId:'c'.repeat(64)}};
 assert.deepEqual((await inspectModel(changed,archive,true)).version,{...result.version,revisionId:'c'.repeat(64)});
});
test('valid spec remains visible for missing execution file and malformed dependencies, execution stays blocked',async()=>{
 for(const [overrides,code] of [[{'model/model-spec.json':encode(JSON.stringify({...spec,execution:{...spec.execution,entrypoint:'model/missing.py'}}))},'model-contract-mismatch'],[{'app/requirements.lock':encode('bad json')},'model-dependencies-invalid'],[{'app/requirements.lock':encode('{"schemaVersion":1,"packages":{"unsupported":"1"}}')},'model-dependencies-unsupported']] as const){
  const {source,archive}=await fixture(overrides);const result=await inspectModel(source,archive,true);
  assert.ok(result.spec);assert.ok(result.version);assert.equal(result.canRun,false);assert.equal(result.reasonCode,code);await assert.rejects(simulationPlan(source,archive),new RegExp(code));
 }
});
test('invalid model schema hides untrusted spec; archive corruption is never softened to a model warning',async()=>{
 const {source,archive}=await fixture({'model/model-spec.json':encode('{}')});assert.deepEqual(await inspectModel(source,archive,true),{version:null,spec:null,reasonCode:'model-spec-invalid',canRun:false});
 await assert.rejects(inspectModel({...source,revision:{...source.revision,filesSha256:'f'.repeat(64)}},archive,true),/simulation-source-mismatch/);
});
