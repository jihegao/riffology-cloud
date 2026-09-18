// Read-only verification of committed synthetic artifacts; no model requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root='docs/evidence/issue-77',report=JSON.parse(readFileSync(`${root}/live-acceptance.json`));
for(const file of report.evidenceFiles){assert(file.path.startsWith(`${root}/live-artifacts/`)&&!file.path.includes('..'));assert.equal(hash(readFileSync(file.path)),file.sha256);}
assert.equal(report.budget.attempts,4);assert.equal(report.budget.sessions,2);assert.equal(report.budget.unknown,0);assert.equal(report.budget.billingSettled,false);
assert.equal(report.cleanup.sessionsDeleted,2);assert.equal(report.cleanup.eachReadback404,true);
assert.equal(report.production.authenticatedE2E,false);assert.equal(report.production.issueComplete,false);
const candidates=[2,3].map(n=>JSON.parse(readFileSync(`${root}/live-artifacts/turn-${n}-candidate.json`)));
assert.deepEqual(candidates[0].files['model/results.json'],candidates[1].files['model/results.json']);
for(const run of report.localComponents.nativeRuns){
 const receipt=JSON.parse(readFileSync(`${root}/live-artifacts/${run.runId}.json`));assert.equal(hash(JSON.stringify(receipt)),run.receiptSha256);
 assert.equal(receipt.status,'stopped');assert.equal(receipt.stop.fenced,true);assert.equal(receipt.result.exitCode,0);
 for(const out of receipt.result.result.outputs)assert.equal(hash(Buffer.from(out.data,'base64')),out.sha256);
 const trace=JSON.parse(Buffer.from(receipt.result.result.outputs.find(o=>o.path==='trace.json').data,'base64'));
 assert.equal(trace.snapshots.length,6);const t=run.parameters.service_time;
 for(let j=1;j<=5;j++){assert.equal(trace.snapshots[j].time,run.seed%3+t*j);assert.deepEqual(trace.snapshots[j].metrics,{completed:j,mean_wait:(t-2)*(j-1)/2});}
}
assert.equal(report.localComponents.nativeRuns.length,12);assert.equal(report.browser.cases.length,12);assert(report.browser.passed);
console.log(JSON.stringify({status:'verified',paidTurns:4,sessionsDeleted:2,localNativeRuns:12,localBrowserComparisons:12,productionE2E:false,billingSettled:false}));
