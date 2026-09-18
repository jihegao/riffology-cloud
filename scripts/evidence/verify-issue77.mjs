import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const historical=process.argv.includes('--historical');
// Explicitly validate a recorded Git tree without representing it as the
// current working tree. The default continues to require both to match.
const committedOnly=historical||process.argv.includes('--committed');
const report=JSON.parse(readFileSync(resolve(root,`docs/evidence/issue-77/${historical?'offline-20260917':'validation'}.json`),'utf8'));
if(![1,2].includes(report.schemaVersion)||!(/^[a-f0-9]{40}$/).test(report.sourceCommit)||!Array.isArray(report.sourceFiles)||report.sourceFiles.length===0)throw Error('invalid-issue77-evidence');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const entry of report.sourceFiles){
 if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(p=>p==='..'||p==='')||!(/^[a-f0-9]{64}$/).test(entry.sha256))throw Error('invalid-source-entry');
 const committed=execFileSync('git',['show',`${report.sourceCommit}:${entry.path}`],{cwd:root,maxBuffer:16*1024*1024});
 if(!committedOnly&&hash(readFileSync(resolve(root,entry.path)))!==entry.sha256||hash(committed)!==entry.sha256)throw Error(`source-hash-mismatch:${entry.path}`);
}
if(!Array.isArray(report.validation.requiredStages)||report.validation.requiredStages.length!==5||report.validation.requiredStages.some(s=>s.exitCode!==0||s.suites.some(result=>result.failed!==0||result.cancelled!==0)))throw Error('issue77-verification-not-passing');
const execution=report.schemaVersion===1?report.authorizations:report.execution;
if(execution.paidRequests!==false||execution.productionDeployment!==false||execution.phase5!==false)throw Error('invalid-issue77-offline-execution-record');
console.log(JSON.stringify({status:'verified',sourceCommit:report.sourceCommit,sourceFiles:report.sourceFiles.length,historical,verificationScope:committedOnly?'recorded-commit-only':'recorded-commit-and-working-tree',workingTreeVerified:!committedOnly,liveAcceptance:false}));
