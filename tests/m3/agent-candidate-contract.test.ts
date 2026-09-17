import {MESA_SOURCE_PACKAGES,MESA_SERVER_PROFILE} from '../../services/simulation/server-profile.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResultEnvelope,verifyDefaultChange,type ResultEnvelope,type ExperimentProvenance} from '../../services/simulation/result-oracle.ts';
import {verifyCommandEvidence} from '../../services/simulation/command-evidence.ts';
import {packageCandidateModel,validateCandidateArtifact,managedCandidateSnapshot} from '../../services/turn-runtime/candidate-artifact.ts';
import {digest,simulationPlan} from '../../services/simulation/source.ts';
import {workspaceFileIndex,workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
const spec={schemaVersion:1 as const,researchQuestion:'How does speed change position?',scope:'deterministic counter',entities:['counter'],mechanisms:['increment'],assumptions:[],parameters:{speed:{type:'integer' as const,default:1,minimum:1,maximum:4}},metrics:{position:{}},limitations:['oracle fixture only'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
const provenance:ExperimentProvenance={schemaVersion:1,authority:'platform-experiment',revisionId:'revision',filesSha256:'a'.repeat(64),dependencyLockSha256:'b'.repeat(64),executionReceiptId:'platform-run'};
// Independently computed discrete updates, including the state before step 1.
const oracle=[1,2,3].map(seed=>{let position=seed,steps=0;while(steps<5){position+=2;steps++;}return {seed,parameters:{speed:2},steps,before:{position:seed},after:{position}};});
const envelope=():ResultEnvelope=>({schemaVersion:1,provenance,rows:structuredClone(oracle),history:{earlier:'c'.repeat(64)}});
test('numeric oracle binds explicit seed, parameters, updates and before/after state to platform provenance',()=>{
 assert.equal(validateResultEnvelope(spec,provenance,oracle,envelope(),{earlier:'c'.repeat(64)}).status,'validated-candidate');
 for(const [edit,reason] of [
  [(v:ResultEnvelope)=>{v.rows[0].seed=1.5;},/contract:seed/],
  [(v:ResultEnvelope)=>{v.rows[0].parameters.speed=99;},/contract:parameters/],
  [(v:ResultEnvelope)=>{v.rows[0].steps=4;},/model:actual-update-count/],
  [(v:ResultEnvelope)=>{v.rows[0].before.position=2;},/model:numeric-oracle-mismatch/],
  [(v:ResultEnvelope)=>{v.rows[0].after.position=12;},/model:numeric-oracle-mismatch/],
  [(v:ResultEnvelope)=>{v.rows[1]=v.rows[0];},/contract:row-coverage/],
  [(v:ResultEnvelope)=>{v.rows.pop();},/contract:row-coverage/],
  [(v:ResultEnvelope)=>{v.history={};},/contract:history-not-preserved/],
  [(v:ResultEnvelope)=>{v.provenance={...provenance,revisionId:'other'};},/contract:version/],
 ] as const){const candidate=envelope();edit(candidate);assert.throws(()=>validateResultEnvelope(spec,provenance,oracle,candidate,{earlier:'c'.repeat(64)}),reason);}
});
test('default edit validation checks actual model schema and rejects unrelated changes',()=>{
 const next=structuredClone(spec);next.parameters.speed.default=3;assert.deepEqual(verifyDefaultChange(spec,next,'speed',3),next);
 next.mechanisms=['rewritten'];assert.throws(()=>verifyDefaultChange(spec,next,'speed',3),/unexpected-default-change/);
});
test('command evidence recognizes exact argv in successful AND lists without substring fabrication claims',()=>{
 const expected={argv:['python3','model/run.py','--seed','1'],cwd:'/workspace'};
 for(const command of ['python3 model/run.py --seed 1','cd /workspace && python3 model/run.py --seed 1',`/bin/bash -lc 'cd /workspace && python3 model/run.py --seed 1'`])assert.equal(verifyCommandEvidence({command,cwd:'/workspace',exitCode:0},expected).status,'matched');
 for(const command of [`echo 'python3 model/run.py --seed 1'`,'python3 model/run.py --seed 10','cd /other && python3 model/run.py --seed 1','false || python3 model/run.py --seed 1','python3 model/run.py --seed 1 | cat','echo $(python3 model/run.py --seed 1)'])assert.notEqual(verifyCommandEvidence({command,cwd:'/workspace',exitCode:0},expected).status,'matched');
 assert.deepEqual(verifyCommandEvidence({command:'python3 model/run.py --seed 1',cwd:'/workspace',exitCode:1},expected),{status:'not-observed',category:'harness',reason:'command-success-not-proven'});
});
test('candidate packaging verifies files and model contract without changing supported execution profiles',async()=>{
 const files={'model/run.py':new TextEncoder().encode('print(1)'),'app/requirements.lock':new TextEncoder().encode(JSON.stringify({schemaVersion:1,packages:{mesa:'3.3.1'}}))};
 const bytes=packageCandidateModel(files,spec),index=workspaceFileIndex(bytes),reader=workspaceArchiveReader(bytes);
 const manifest={schemaVersion:1 as const,format:'riffology-workspace-ustar' as const,size:bytes.length,sha256:await digest(bytes),files:await Promise.all(index.files.filter(v=>v.type==='file').map(async e=>({path:e.path,size:e.size,sha256:await digest(reader.read([{path:e.path,maxBytes:Math.max(1,e.size)}]).get(e.path)!)})))};
 assert.deepEqual(await validateCandidateArtifact(manifest,bytes),bytes);
 for(const bad of [{...manifest,sha256:'0'.repeat(64)},{...manifest,files:manifest.files.slice(1)},{...manifest,format:'zip'},{...manifest,files:[...manifest.files.slice(1),{...manifest.files[0],path:'../secret'}]}])await assert.rejects(validateCandidateArtifact(bad,bytes));
 assert.throws(()=>packageCandidateModel({...files,'../escape':new Uint8Array([1])},spec));
 const identity={scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1};
 const snapshot=await managedCandidateSnapshot({schemaVersion:1,identity,backend:'managed-agents',inputSha256:'f'.repeat(64),reservedAt:1,remoteSessionId:'remote-session',remoteTurnId:'remote-turn'},manifest,bytes);assert.equal(snapshot.piSession,undefined);assert.equal(snapshot.backendState?.backend,'managed-agents');
 const source={kind:'saved-turn' as const,identity,revision:{revisionId:'revision',objectKey:'turns/revision',filesSha256:manifest.sha256,sessionSha256:'b'.repeat(64),committedAt:1}};
 await assert.rejects(simulationPlan(source,bytes),/model-dependencies-unsupported/);
 const supported=packageCandidateModel({...files,'app/requirements.lock':new TextEncoder().encode(JSON.stringify({schemaVersion:1,packages:MESA_SOURCE_PACKAGES}))},spec);
 const plan=await simulationPlan({...source,revision:{...source.revision,filesSha256:await digest(supported)}},supported);assert.deepEqual(plan.executionProfile,MESA_SERVER_PROFILE);
});
