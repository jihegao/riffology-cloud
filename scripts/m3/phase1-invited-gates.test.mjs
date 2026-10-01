import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {closeInvitedRunsAdmission,invitedRunsAdmissionClosed,deployedInvitedRunsAdmissionClosed} from './invited-runs-gate.mjs';
import {phase1Config} from './phase1-config.mjs';
import {createStagingConfigOverlay} from './vertical-staging-preflight.mjs';
import {prepareG4Candidate,validateG4Review} from './g4-candidate-readiness.mjs';
const root=resolve(import.meta.dirname,'../..');
const read=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
const policy={...JSON.parse(read('infra/wrangler.phase1-staging.jsonc').vars.INVITED_RUNS_POLICY_JSON),enabled:true};
test('closing the independent Run route preserves its exact policy identity and fails closed on malformed policy',()=>{
 const config={vars:{INVITED_RUNS_POLICY_JSON:JSON.stringify(policy),M4_SIMULATION_ENABLED:'false'}};
 closeInvitedRunsAdmission(config);assert.deepEqual(JSON.parse(config.vars.INVITED_RUNS_POLICY_JSON),{...policy,enabled:false});
 assert.equal(invitedRunsAdmissionClosed(config.vars),true);assert.equal(invitedRunsAdmissionClosed({INVITED_RUNS_POLICY_JSON:JSON.stringify(policy)}),false);
 assert.deepEqual(closeInvitedRunsAdmission({vars:{}}),{vars:{}});
 for(const raw of ['{}','null','not-json']){assert.throws(()=>closeInvitedRunsAdmission({vars:{INVITED_RUNS_POLICY_JSON:raw}}));assert.equal(invitedRunsAdmissionClosed({INVITED_RUNS_POLICY_JSON:raw}),false);}
 const binding={name:'INVITED_RUNS_POLICY_JSON',type:'plain_text',text:config.vars.INVITED_RUNS_POLICY_JSON};
 assert.equal(deployedInvitedRunsAdmissionClosed([binding]),true);assert.equal(deployedInvitedRunsAdmissionClosed([binding,binding]),false);assert.equal(deployedInvitedRunsAdmissionClosed([{...binding,type:'secret_text'}]),false);
});
test('phase1 and historical vertical release overlays close invited Runs while retaining release configuration',t=>{
 const base=read('infra/wrangler.m3-vertical-staging.jsonc');base.vars.INVITED_RUNS_POLICY_JSON=JSON.stringify(policy);const original=structuredClone(base);
 const candidate=phase1Config(base,{simulationImage:'registry.example/sim@sha256:'+'a'.repeat(64),trustedPiImage:'registry.example/pi@sha256:'+'b'.repeat(64)});
 assert.deepEqual(base,original);assert.deepEqual(JSON.parse(candidate.vars.INVITED_RUNS_POLICY_JSON),{...policy,enabled:false});
 const dir=mkdtempSync(join(tmpdir(),'invited-close-overlay-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'infra'));writeFileSync(join(dir,'infra/wrangler.m3-vertical-staging.jsonc'),JSON.stringify(base));
 for(const turnsEnabled of [true,false]){const overlay=createStagingConfigOverlay(dir,{turnsEnabled});try{assert.equal(overlay.config.vars.M2_TURNS_ENABLED,String(turnsEnabled));assert.deepEqual(JSON.parse(overlay.config.vars.INVITED_RUNS_POLICY_JSON),{...policy,enabled:false});assert.deepEqual(overlay.config.durable_objects,base.durable_objects);assert.deepEqual(overlay.config.containers,base.containers);}finally{overlay.remove();}}
});
test('G4 paused and user-preview candidates never inherit independent Run authorization',t=>{
 const original=prepareG4Candidate(root),dir=mkdtempSync(join(tmpdir(),'invited-close-g4-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 for(const path of [...original.manifest.sources,...original.manifest.migrations.candidate].map(value=>value.path)){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),readFileSync(join(root,path)));}
 const path=join(dir,'infra/wrangler.phase1-staging.jsonc'),base=JSON.parse(readFileSync(path,'utf8'));base.vars.INVITED_RUNS_POLICY_JSON=JSON.stringify(policy);writeFileSync(path,JSON.stringify(base));const before=readFileSync(path);
 execFileSync('git',['init','-q'],{cwd:dir});execFileSync('git',['add','.'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','review fixture'],{cwd:dir});
 const candidate=prepareG4Candidate(dir);assert.equal(validateG4Review(candidate,dir).executionReadiness,'blocked');
 for(const config of [candidate.overlays.paused,candidate.overlays.userPreview])assert.deepEqual(JSON.parse(config.vars.INVITED_RUNS_POLICY_JSON),{...policy,enabled:false});
 assert.deepEqual(readFileSync(path),before);candidate.overlays.paused.vars.INVITED_RUNS_POLICY_JSON=JSON.stringify(policy);assert.throws(()=>validateG4Review(candidate,dir),/invited-runs-admission/);
});
