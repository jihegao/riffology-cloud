import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'issue77-verifier-'));await mkdir(join(root,'scripts/evidence'),{recursive:true});await mkdir(join(root,'docs/evidence/issue-77'),{recursive:true});
 await writeFile(join(root,'scripts/evidence/verify-issue77.mjs'),await readFile(new URL('./verify-issue77.mjs',import.meta.url)));await writeFile(join(root,'source.txt'),'recorded-source');
 const git=args=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe'],encoding:'utf8'});git(['init','-q']);git(['add','source.txt']);git(['-c','user.name=Offline verifier test','-c','user.email=offline@example.test','commit','-q','-m','fixture']);
 const report={schemaVersion:2,sourceCommit:git(['rev-parse','HEAD']).trim(),sourceFiles:[{path:'source.txt',sha256:createHash('sha256').update('recorded-source').digest('hex')}],validation:{requiredStages:Array.from({length:5},()=>({exitCode:0,suites:[]}))},execution:{paidRequests:false,productionDeployment:false,phase5:false}};
 const save=()=>writeFile(join(root,'docs/evidence/issue-77/validation.json'),JSON.stringify(report));await save();
 const run=(...args)=>spawnSync(process.execPath,['scripts/evidence/verify-issue77.mjs',...args],{cwd:root,encoding:'utf8'});
 return {root,report,save,run,close:()=>rm(root,{recursive:true,force:true})};
}
test('committed-only evidence verification never represents changed working files as verified',async()=>{
 const f=await fixture();try{
  const exact=f.run();assert.equal(exact.status,0,exact.stderr);assert.equal(JSON.parse(exact.stdout).workingTreeVerified,true);
  await writeFile(join(f.root,'source.txt'),'changed-working-source');const strict=f.run();assert.notEqual(strict.status,0);assert.match(strict.stderr,/source-hash-mismatch/);
  const recorded=f.run('--committed');assert.equal(recorded.status,0,recorded.stderr);assert.equal(JSON.parse(recorded.stdout).workingTreeVerified,false);assert.equal(JSON.parse(recorded.stdout).verificationScope,'recorded-commit-only');
  await rm(join(f.root,'source.txt'));assert.equal(f.run('--committed').status,0,'only Git blobs are required in explicit recorded-commit mode');assert.notEqual(f.run().status,0);
 }finally{await f.close();}
});
test('committed-only evidence still rejects a mismatched recorded Git blob',async()=>{
 const f=await fixture();try{f.report.sourceFiles[0].sha256='0'.repeat(64);await f.save();const result=f.run('--committed');assert.notEqual(result.status,0);assert.match(result.stderr,/source-hash-mismatch/);}finally{await f.close();}
});
