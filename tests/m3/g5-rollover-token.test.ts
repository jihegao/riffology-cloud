import test from 'node:test';
import assert from 'node:assert/strict';
import {rolloverTokenMatches} from '../../services/model-budget/g5-rollover-token.ts';
test('failed pending token exception is explicit and preserves all failure constraints',()=>{
 const legacy={status:'unknown',reconciliation:'pending',terminal:null};
 const failed={status:'failed',reconciliation:'pending',terminal:{errorCode:'provider-failure',usage:{kind:'unknown'},providerRequestIdPresent:true}};
 assert.equal(rolloverTokenMatches(legacy),true);
 assert.equal(rolloverTokenMatches(failed),false);
 assert.equal(rolloverTokenMatches(failed,'failed-pending'),true);
 assert.equal(rolloverTokenMatches(legacy,'failed-pending'),false);
 for(const status of ['completed','cancelled','dispatched','reserved'])assert.equal(rolloverTokenMatches({...failed,status},'failed-pending'),false);
 for(const reconciliation of ['recorded','released','held'])assert.equal(rolloverTokenMatches({...failed,reconciliation},'failed-pending'),false);
 for(const terminal of [null,{...failed.terminal,errorCode:'other'},{...failed.terminal,usage:{kind:'verified'}},{...failed.terminal,providerRequestIdPresent:false}])assert.equal(rolloverTokenMatches({...failed,terminal},'failed-pending'),false);
});
