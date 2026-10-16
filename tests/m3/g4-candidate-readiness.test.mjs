import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareG4Candidate,validateG4Review} from '../../scripts/m3/g4-candidate-readiness.mjs';
const root=resolve(import.meta.dirname,'../..');
const bytes=path=>readFileSync(resolve(root,path));
test('pure review freezes existing config identities and leaves missing choices blocked',()=>{
 const paths=['infra/wrangler.phase1-staging.jsonc','infra/wrangler.browser-execution.jsonc'],before=paths.map(bytes);
 const a=prepareG4Candidate(root),b=prepareG4Candidate(root);assert.deepEqual(a,b);assert.equal(validateG4Review(a).executionReadiness,'blocked');
 assert.equal(a.manifest.migrations.candidate.length,13);assert.ok(a.manifest.migrations.candidate.some(m=>m.path==='services/catalog/migrations/0011_user_locale_preferences.sql'));assert.ok(a.manifest.migrations.candidate.some(m=>m.path==='services/catalog/migrations/0012_project_archives.sql'));assert.ok(a.manifest.migrations.candidate.some(m=>m.path==='services/catalog/migrations/0013_manual_save_fence.sql'));assert.equal(a.manifest.migrations.remoteApplied,null);
 assert.equal(a.manifest.containerImages.length,5);assert.equal(a.manifest.containerImages.filter(c=>c.candidateManagedReference===null).length,2);
 assert.equal(a.overlays.execution.env,undefined);assert.equal(a.overlays.execution.vars.ALLOW_LOCALHOST_HTTP,'false');
 paths.forEach((p,i)=>assert.deepEqual(bytes(p),before[i]));
});
test('reject credentials/binding expansion, local execution and accidental admission/budget',()=>{
 const original=prepareG4Candidate(root);
 const mutations=[a=>a.overlays.execution.services=[],a=>a.overlays.execution.vars.EXECUTION_ORIGIN='http://localhost:8792',a=>a.overlays.paused.vars.M2_TURNS_ENABLED='true',a=>a.manifest.authorization.maxPaidCalls=16,a=>a.manifest.authorization.privacy.retention='30 days',a=>a.manifest.containerImages.find(c=>c.className==='TrustedPiSandbox').candidateManagedReference='registry/real@sha256:'+'a'.repeat(64),a=>a.overlays.userPreview.assets.directory='../services/web'];
 for(const mutate of mutations){const a=structuredClone(original);mutate(a);assert.throws(()=>validateG4Review(a));}
});
test('CLI rejects output outside review directory and never creates a deployment file',()=>{
 const temp=mkdtempSync(resolve(tmpdir(),'g4-output-'));try{assert.throws(()=>execFileSync(process.execPath,['scripts/m3/g4-candidate-readiness.mjs','--output-dir='+temp],{cwd:root,stdio:'pipe'}));}finally{rmSync(temp,{recursive:true,force:true});}
});
