import test from 'node:test';
import assert from 'node:assert/strict';
import {piDeveloperPolicy,piDeveloperOwner} from '../../services/model-budget/pi-developer-policy.ts';
const p={schemaVersion:1,policyId:'developer-v1',tenantId:'tenant',userId:'owner',enabled:true,billingMode:'observe'};
const proof=(value:string)=>({callKey:value.repeat(64),proofDigest:value.repeat(64)});
const v2={schemaVersion:2,policyId:'acceptance-v2',tenantId:'tenant',userId:'owner',projectId:'project',enabled:true,billingMode:'observe',maxTurns:3,maxCalls:8,maxNanodollars:600_000_000,maxCallDurationMs:360_000,startsAt:1_000,expiresAt:1_801_000,historicalIsolation:{schemaVersion:1,manifestId:'isolation-v1',manifests:[{schemaVersion:1,ledger:'legacy',proofs:[proof('a')]},{schemaVersion:1,ledger:'g5',proofs:['b','c','d','e','f','1'].map(proof)}],manifestSha256:'2'.repeat(64)}};
test('developer policy is explicit, owner scoped, opt-in and rejects malformed expansion',()=>{
 assert.equal(piDeveloperPolicy(undefined),null);
 assert.equal(piDeveloperOwner(JSON.stringify(p),'tenant','owner'),true);
 for(const [tenant,user] of [['tenant','other'],['other','owner']])assert.equal(piDeveloperOwner(p,tenant!,user!),false);
 assert.equal(piDeveloperOwner({...p,enabled:false},'tenant','owner'),false);
 for(const value of [{...p,enabled:'true'},{...p,billingMode:'ignore'},{...p,userId:'*'},{...p,unlimited:true},null])assert.throws(()=>piDeveloperPolicy(value));
});
test('bounded policy is exact-project and expiry scoped with a frozen 1 plus 6 isolation set',()=>{
 assert.equal(piDeveloperPolicy(v2)?.schemaVersion,2);
 assert.equal(piDeveloperOwner(v2,'tenant','owner','project',1_000),true);
 for(const [tenant,user,project] of [['tenant','owner',undefined],['tenant','owner','other'],['tenant','other','project']] as const)assert.equal(piDeveloperOwner(v2,tenant,user,project,1_000),false);
 assert.equal(piDeveloperOwner(v2,'tenant','owner','project',999),false);
 assert.equal(piDeveloperOwner(v2,'tenant','owner','project',1_801_000),false);
 for(const value of [{...v2,maxTurns:2},{...v2,maxCalls:7},{...v2,maxNanodollars:600_000_001},{...v2,maxCallDurationMs:359_999},{...v2,expiresAt:v2.expiresAt+1},{...v2,historicalIsolation:{...v2.historicalIsolation,manifests:v2.historicalIsolation.manifests.slice(0,1)}},{...v2,historicalIsolation:{...v2.historicalIsolation,manifests:[v2.historicalIsolation.manifests[0],{...v2.historicalIsolation.manifests[1],proofs:v2.historicalIsolation.manifests[1].proofs.slice(0,5)}]}}])assert.throws(()=>piDeveloperPolicy(value));
});
