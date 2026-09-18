import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyRecordedAcceptance} from './verify-recorded-acceptance.mjs';
const root='docs/evidence/issue-77';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const report=JSON.parse(readFileSync(root+'/live-acceptance.json'));
 const artifacts=new Map(report.evidenceFiles.map(f=>[f.path,readFileSync(f.path)]));
 return {report,run:()=>verifyRecordedAcceptance(report,p=>artifacts.get(p)),edit(name,fn){const path=root+'/live-artifacts/'+name,value=JSON.parse(artifacts.get(path));fn(value);const bytes=Buffer.from(JSON.stringify(value));artifacts.set(path,bytes);report.evidenceFiles.find(f=>f.path===path).sha256=hash(bytes);return value;}};
}
test('recorded acceptance validates actual candidates, six-row native coverage, default-only spec and unchanged history',()=>{
 const result=fixture().run();assert.equal(result.status,'validated-candidate');assert.equal(result.versions.length,2);assert(result.versions.every(v=>v.rows===6&&v.nativeReceipts===6));assert.equal(result.defaultChange.status,'verified');assert.equal(result.history.status,'verified');assert.equal(result.commands.status,'unknown');assert.equal(result.commands.reason,'command-trace-unavailable');assert.equal(result.usage.status,'observed');assert.equal(result.billing.status,'unsettled');assert.equal(result.resources.liveReadbackPerformed,false);assert.equal(result.productionE2E,false);assert.equal(result.formalEvidencePublished,false);
});
test('same actual acceptance entrypoint handles combined shell and keeps unsupported grammar distinct from numeric failure',()=>{
 const f=fixture(),expected={argv:['python3','model/run.py','--seed','1'],cwd:'/workspace'};
 f.report.commandObservations=[{proof:{command:"/bin/bash -lc 'cd /workspace && python3 model/run.py --seed 1'",cwd:'/tmp',exitCode:0},expected},{proof:{command:'python3 model/run.py --seed 1 | cat',cwd:'/workspace',exitCode:0},expected},{proof:{command:'python3 model/run.py --seed 10',cwd:'/workspace',exitCode:0},expected}];
 const result=f.run();assert.equal(result.status,'validated-candidate');assert.deepEqual(result.commands.observations.map(r=>r.status),['matched','unverifiable','not-observed']);assert(result.commands.observations.every(r=>r.category==='harness'));assert.equal(result.commands.providerCommandExecutionProven,false);
});
test('rejects unrelated parsed spec changes even with the requested default set',()=>{const f=fixture();f.edit('turn-3-candidate.json',v=>{v.spec.mechanisms=['unrequested change'];});assert.deepEqual(f.run().failure,{category:'contract',reason:'unexpected-default-change'});});
test('rejects changed historical result bytes before numerical acceptance',()=>{const f=fixture();f.edit('turn-3-candidate.json',v=>{v.files['model/results.json']+=' ';});assert.deepEqual(f.run().failure,{category:'contract',reason:'history-not-preserved'});});
test('rejects repeated native rows despite unchanged total row count',()=>{const f=fixture();f.report.localComponents.nativeRuns[1]=structuredClone(f.report.localComponents.nativeRuns[0]);assert.deepEqual(f.run().failure,{category:'contract',reason:'row-coverage'});});
test('categorizes mismatched immutable version as save, never model fabrication',()=>{const f=fixture();f.report.localComponents.nativeRuns[0].filesSha256='0'.repeat(64);assert.deepEqual(f.run().failure,{category:'save',reason:'execution-version-mismatch'});});
test('actual native metric mismatch is a model category after receipt hash validation',()=>{
 const f=fixture(),run=f.report.localComponents.nativeRuns[0];const value=f.edit(run.runId+'.json',v=>{v.result.result.metrics.mean_wait=99;});run.receiptSha256=hash(JSON.stringify(value));assert.deepEqual(f.run().failure,{category:'model',reason:'numeric-oracle-mismatch'});
});
test('unknown usage or cleanup stays unknown without becoming settled zero or invalid numeric results',()=>{const f=fixture();f.report.turns[0].usage=null;f.report.cleanup.eachReadback404=false;const result=f.run();assert.equal(result.status,'validated-candidate');assert.equal(result.usage.status,'unknown');assert.equal(result.billing.status,'unsettled');assert.equal(result.resources.status,'unknown');});
test('missing immutable artifact and invalid inventory are harness failures',()=>{const f=fixture();f.report.evidenceFiles=f.report.evidenceFiles.filter(r=>!r.path.endsWith('turn-2-candidate.json'));assert.deepEqual(f.run().failure,{category:'harness',reason:'artifact-missing'});});
