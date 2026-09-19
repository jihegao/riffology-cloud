import test from 'node:test';
import assert from 'node:assert/strict';
import {piDeveloperPolicy,piDeveloperOwner} from '../../services/model-budget/pi-developer-policy.ts';
const p={schemaVersion:1,policyId:'developer-v1',tenantId:'tenant',userId:'owner',enabled:true,billingMode:'observe'};
test('developer policy is explicit, owner scoped, opt-in and rejects malformed expansion',()=>{
 assert.equal(piDeveloperPolicy(undefined),null);
 assert.equal(piDeveloperOwner(JSON.stringify(p),'tenant','owner'),true);
 for(const [tenant,user] of [['tenant','other'],['other','owner']])assert.equal(piDeveloperOwner(p,tenant!,user!),false);
 assert.equal(piDeveloperOwner({...p,enabled:false},'tenant','owner'),false);
 for(const value of [{...p,enabled:'true'},{...p,billingMode:'ignore'},{...p,userId:'*'},{...p,unlimited:true},null])assert.throws(()=>piDeveloperPolicy(value));
});
