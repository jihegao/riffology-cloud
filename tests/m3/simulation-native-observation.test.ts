import assert from 'node:assert/strict';
import test from 'node:test';
import {checkedNativeObservation} from '../../services/simulation/native-observation.ts';
const facts=()=>({schemaVersion:1,runId:'run-a',token:'a'.repeat(52),filesSha256:'b'.repeat(64),child:{pid:12,startTicks:40,uid:[10001,10001,10001,10001],gid:[10001,10001,10001,10001],noNewPrivileges:1,rlimitAS:[536870912,536870912],rlimitNPROC:[64,64],pidfd:'opened',network:{seccompMode:2,childSetupAcknowledged:true,specificFilterObserved:false,platformFallbackConfigured:false}},stop:{confirmationId:'c'.repeat(64),observedAt:10,fenced:true},sealed:true,quiescent:true});
test('native observation binds run/source/token and cannot upgrade network uncertainty',()=>{
 const f=facts();assert.equal(checkedNativeObservation(f,'run-a','b'.repeat(64),'a'.repeat(52)).child,f.child);
 for(const update of [{runId:'other'},{filesSha256:'c'.repeat(64)},{token:'d'.repeat(52)},{sealed:false},{child:null},{child:{...f.child,rlimitAS:[1024,1024]}},{child:{...f.child,rlimitNPROC:[128,128]}},{child:{...f.child,noNewPrivileges:0}},{child:{...f.child,uid:[0,0,0,0]}},{child:{...f.child,network:{...f.child.network,specificFilterObserved:true}}},{session:'private'}])assert.throws(()=>checkedNativeObservation({...f,...update},'run-a','b'.repeat(64),'a'.repeat(52)),/invalid/);
});
test('unobserved child and failed pidfd probes remain explicit rather than invented facts',()=>{
 const f=facts();assert.throws(()=>checkedNativeObservation({...f,child:null},'run-a','b'.repeat(64)),/invalid/);
 for(const pidfd of ['unsupported','unobserved'])assert.doesNotThrow(()=>checkedNativeObservation({...f,child:{...f.child,pidfd}},'run-a','b'.repeat(64)));
 assert.throws(()=>checkedNativeObservation({...f,child:{...f.child,pidfd:'assumed'}},'run-a','b'.repeat(64)),/invalid/);
});

test('stop proof must match exact token-derived confirmation when supplied',()=>{const f=facts();assert.throws(()=>checkedNativeObservation(f,'run-a','b'.repeat(64),'a'.repeat(52),'d'.repeat(64)),/invalid/);assert.doesNotThrow(()=>checkedNativeObservation(f,'run-a','b'.repeat(64),'a'.repeat(52),'c'.repeat(64)));});
