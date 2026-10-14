import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetadataReadRouter} from '../../scripts/m1/riffoid-native-metadata-routing.mjs';
const a='a'.repeat(32),b='b'.repeat(32),z='c'.repeat(32),y='d'.repeat(32);
const scopes={gateway:{accountId:a,zoneId:z,worker:'gateway'},entry:{accountId:b,zoneId:y,worker:'entry'}};
const route=createMetadataReadRouter(scopes);
test('exact zone ownership and pipeline metadata use the existing decoded GET reader',()=>{
 for(const path of ['/zones/'+z,'/zones/'+z+'/logpush/jobs','/zones/'+z+'/rulesets/phases/http_log_custom_fields/entrypoint','/accounts/'+a+'/logpush/jobs','/accounts/'+a+'/workers/observability/destinations?page=1&perPage=50','/accounts/'+a+'/workers/scripts/gateway/tails','/accounts/'+a+'/containers/applications?per_page=500','/accounts/'+a+'/containers/applications/existing'])assert.deepEqual(route({path}),{role:'gateway',kind:'configuration'});
 assert.deepEqual(route({path:'/zones/'+y}),{role:'entry',kind:'configuration'});
});
test('existing Worker deployment/version lists cannot use the decoded connector',()=>{
 for(const suffix of ['deployments','versions'])assert.equal(route({path:'/accounts/'+b+'/workers/scripts/entry/'+suffix}),null);
});
test('PUT and source/settings/version-detail evidence cannot use the connector',()=>{
 assert.equal(route({method:'PUT',path:'/accounts/'+a+'/workers/scripts/gateway?bindings_inherit=strict',body:Buffer.from('fixed')}),null);
 for(const suffix of ['', '/settings','/script-settings','/content/v2','/versions/frozen'])assert.equal(route({path:'/accounts/'+a+'/workers/scripts/gateway'+suffix}),null);
});
test('foreign account, zone and Worker paths are never routed to an authorized connector',()=>{
 for(const path of ['/zones/'+'e'.repeat(32),'/accounts/'+'e'.repeat(32)+'/logpush/jobs','/accounts/'+a+'/workers/scripts/foreign/tails','/accounts/'+a+'/workers/scripts/foreign/deployments'])assert.equal(route({path}),null);
});
test('normalized, fragment, extra-query and body-bearing reads fail closed',()=>{
 for(const request of [{path:'/zones/'+z+'#fragment'},{path:'/zones/'+z+'?anything=1'},{path:'/zones/'+z+'/../'+y},{path:'/zones/'+z,body:'unexpected'},{method:'POST',path:'/zones/'+z}])assert.throws(()=>route(request));
});
test('scope is frozen and inconsistent ownership or duplicate Worker scopes are rejected',()=>{
 const source=structuredClone(scopes),f=createMetadataReadRouter(source);source.gateway.zoneId=y;
 assert.deepEqual(f({path:'/zones/'+z}),{role:'gateway',kind:'configuration'});
 assert.throws(()=>createMetadataReadRouter({gateway:scopes.gateway,duplicate:scopes.gateway}));
 assert.throws(()=>createMetadataReadRouter({gateway:scopes.gateway,entry:{...scopes.entry,zoneId:z}}));
});
