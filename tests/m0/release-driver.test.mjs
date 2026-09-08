import assert from 'node:assert/strict';
import test from 'node:test';
import {readWithBudget} from '../../scripts/m0/release-cloud.mjs';
test('two transient read failures do not abandon a successfully running cloud phase',async()=>{
 let calls=0;const budget={remaining:3};const read=async()=>{if(++calls<=2)throw Error('network');return {status:'completed'};};
 assert.deepEqual(await readWithBudget(read,budget),{status:'completed'});assert.equal(calls,3);assert.equal(budget.remaining,1);
});
test('read retry allowance is shared, finite, and never wraps a mutation',async()=>{
 const budget={remaining:2};let calls=0;
 await assert.rejects(readWithBudget(async()=>{calls++;throw Error('network');},budget));assert.equal(calls,3);assert.equal(budget.remaining,0);
 await assert.rejects(readWithBudget(async()=>{calls++;throw Error('network');},budget));assert.equal(calls,4);
});
