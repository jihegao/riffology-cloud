import test from 'node:test';
import assert from 'node:assert/strict';
import {betaPolicy} from '../../tests/m2/private-beta-fixture.ts';
import {turnDigest} from '../../services/turn/protocol.ts';
import {prepareQuotaMigration} from './private-beta-quota-migration.mjs';
test('offline operator plan binds exact paused original authority, preserves gates and rejects stale/non-finite evidence',async()=>{
 const policy=await betaPolicy(),digest=await turnDigest({...policy,enabled:false});
 const state={actor:'private-beta-capacity-v1',pinnedPolicySha256:digest,ledgerSha256:'a'.repeat(64),slotSha256:'b'.repeat(64),callSha256:'c'.repeat(64),alertSha256:'d'.repeat(64),operationSha256:'e'.repeat(64),slotCount:1,callCount:2,operationCount:1,alertCount:0,paused:true};
 const snapshot={schemaVersion:1,policySha256:digest,pinnedPolicySha256:digest,paused:true,usage:[{calls:2,reservedNanodollars:500,status:'billing-pending'}]};
 const plan=await prepareQuotaMigration(policy,state,snapshot);
 assert.equal(plan.nextPolicy.schemaVersion,2);assert.equal(plan.nextPolicy.quotaMode,'meter-only');assert.equal(plan.nextPolicy.reviewAt,policy.reviewAt);assert.equal(plan.nextPolicy.startsAt,policy.startsAt);assert.equal(plan.nextPolicy.policyId,policy.policyId);assert.equal(plan.nextPolicy.enabled,policy.enabled);assert.equal('maxCallsPerTurn' in plan.nextPolicy,false);
 assert.deepEqual(plan.rpc.arguments,{previousPolicy:policy,expectedPolicySha256:digest,expectedLedgerSha256:state.ledgerSha256});
 for(const patch of [{actor:'replacement'},{paused:false},{pinnedPolicySha256:'f'.repeat(64)},{ledgerSha256:null},{callCount:Infinity}])await assert.rejects(prepareQuotaMigration(policy,{...state,...patch},snapshot));
 await assert.rejects(prepareQuotaMigration(policy,state,{...snapshot,paused:false}));
 await assert.rejects(prepareQuotaMigration(policy,state,{...snapshot,usage:[{calls:2,reservedNanodollars:Infinity}]}));
 await assert.rejects(prepareQuotaMigration(policy,state,{...snapshot,usage:[{calls:3,reservedNanodollars:500}]}));
 await assert.rejects(prepareQuotaMigration(policy,state,snapshot,{warningCallsPerMinute:0}));
});
