import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const report=JSON.parse(readFileSync(resolve(root,'docs/evidence/issue-77/validation.json'),'utf8'));
if(report.schemaVersion!==1||!(/^[a-f0-9]{40}$/).test(report.sourceCommit)||!Array.isArray(report.sourceFiles)||report.sourceFiles.length===0)throw Error('invalid-issue77-evidence');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const entry of report.sourceFiles){
 if(typeof entry.path!=='string'||entry.path.startsWith('/')||entry.path.split('/').some(p=>p==='..'||p==='')||!(/^[a-f0-9]{64}$/).test(entry.sha256))throw Error('invalid-source-entry');
 const current=readFileSync(resolve(root,entry.path)),committed=execFileSync('git',['show',`${report.sourceCommit}:${entry.path}`],{cwd:root,maxBuffer:16*1024*1024});
 if(hash(current)!==entry.sha256||hash(committed)!==entry.sha256)throw Error(`source-hash-mismatch:${entry.path}`);
}
if(report.validation.fullCheck.exitCode!==0||report.validation.fullCheck.suites.some(s=>s.failed!==0||s.cancelled!==0))throw Error('issue77-verification-not-passing');
if(report.authorizations.paidRequests!==false||report.authorizations.productionDeployment!==false||report.authorizations.phase5!==false)throw Error('invalid-issue77-authorization-record');
console.log(JSON.stringify({status:'verified',sourceCommit:report.sourceCommit,sourceFiles:report.sourceFiles.length,liveAcceptance:false}));
