import test from 'node:test';
import assert from 'node:assert/strict';
import {privateBetaPolicy} from '../../services/model-budget/private-beta-policy.ts';
import {betaPolicy} from './private-beta-fixture.ts';
test('standing Beta requires explicit bounded values and cannot masquerade as an acceptance packet',async()=>{
 const p=await betaPolicy();assert.deepEqual(privateBetaPolicy(JSON.stringify(p)),p);
 assert.equal(privateBetaPolicy(undefined),null);
 for(const patch of [{maxActiveTurns:0},{maxActiveTurns:100},{dayBoundary:'local'},{maxNanodollarsTotal:Infinity},{reviewAt:p.startsAt},{maxCallDurationMs:900000},{monitorIntervalMs:0},{profileSha256:'x'},{admission:'everyone'},{unexpected:true},{maxPendingCalls:-1}])assert.throws(()=>privateBetaPolicy({...p,...patch}));
 for(const k of Object.keys(p)){const bad:Record<string,unknown>={...p};delete bad[k];assert.throws(()=>privateBetaPolicy(bad),k);}
 assert.equal(privateBetaPolicy({...p,enabled:false})?.enabled,false);
});
