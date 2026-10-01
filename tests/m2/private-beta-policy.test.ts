import test from 'node:test';
import assert from 'node:assert/strict';
import {privateBetaPolicy} from '../../services/model-budget/private-beta-policy.ts';
import {betaPolicy,meterOnlyPolicy} from './private-beta-fixture.ts';
test('standing Beta requires explicit bounded values and cannot masquerade as an acceptance packet',async()=>{
 const p=await betaPolicy();assert.deepEqual(privateBetaPolicy(JSON.stringify(p)),p);
 assert.equal(privateBetaPolicy(undefined),null);
 for(const patch of [{maxActiveTurns:0},{maxActiveTurns:100},{dayBoundary:'local'},{maxNanodollarsTotal:Infinity},{reviewAt:p.startsAt},{maxCallDurationMs:900000},{monitorIntervalMs:0},{profileSha256:'x'},{admission:'everyone'},{unexpected:true},{maxPendingCalls:-1}])assert.throws(()=>privateBetaPolicy({...p,...patch}));
 for(const k of Object.keys(p)){const bad:Record<string,unknown>={...p};delete bad[k];assert.throws(()=>privateBetaPolicy(bad),k);}
 assert.equal(privateBetaPolicy({...p,enabled:false})?.enabled,false);
});

test('meter-only v2 forbids legacy quota fields and requires explicit monitoring and unchanged execution gates',async()=>{
 const v1=await betaPolicy(),v2=meterOnlyPolicy(v1);assert.deepEqual(privateBetaPolicy(v2),v2);
 for(const patch of [{schemaVersion:3},{quotaMode:'unlimited'},{maxCallsPerDay:1000},{maxNanodollarsTotal:null},{warningCallsPerMinute:0},{warningNanodollarsPerMinute:Infinity},{billingPendingWarningMs:1},{maxActiveTurns:0},{maxCallDurationMs:360001}])assert.throws(()=>privateBetaPolicy({...v2,...patch}));
 for(const k of Object.keys(v2)){const bad:Record<string,unknown>={...v2};delete bad[k];assert.throws(()=>privateBetaPolicy(bad),k);}
});
