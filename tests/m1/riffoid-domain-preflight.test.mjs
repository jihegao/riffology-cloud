import test from 'node:test';
import assert from 'node:assert/strict';
import {domainPacket,appRequestMode,LEGACY_APP_ORIGIN,RIFFOID_APP_ORIGIN} from '../../scripts/m1/riffoid-domain-preflight.mjs';
const executionOrigin='https://riffology-browser-execution.example.workers.dev';
test('cutover and rollback packets keep fixed auth origin, same-origin API and explicit frame ancestors',()=>{
  for(const canonicalOrigin of [LEGACY_APP_ORIGIN,RIFFOID_APP_ORIGIN]){
    const packet=domainPacket({canonicalOrigin,executionOrigin});
    assert.equal(packet.authBaseURL,canonicalOrigin);
    assert.deepEqual(packet.trustedOrigins,[canonicalOrigin]);
    assert.equal(packet.googleCallback,canonicalOrigin+'/api/auth/callback/google');
    assert.equal(packet.apiBase,'/api');
    assert.deepEqual(packet.frameAncestors,[LEGACY_APP_ORIGIN,RIFFOID_APP_ORIGIN]);
    assert.equal(packet.copyBrowserStorage,false);assert.equal(packet.replayPendingRequests,false);
  }
});
test('origins are exact; execution must remain isolated from both app hosts',()=>{
  for(const canonicalOrigin of ['https://attacker.test',RIFFOID_APP_ORIGIN+'/',RIFFOID_APP_ORIGIN+'.attacker.test','http://app.riffoid.com'])assert.throws(()=>domainPacket({canonicalOrigin,executionOrigin}));
  for(const executionOrigin of ['https://preview.riffoid.com','https://preview.gaojihe.cn','http://execution.example.net','https://user:pass@execution.example.net','https://execution.example.net/path','https://execution.example.net/?q=1'])assert.throws(()=>domainPacket({canonicalOrigin:RIFFOID_APP_ORIGIN,executionOrigin}));
});
test('unknown Host cannot select auth; aliases cannot write or upgrade; canonical mutations retain CSRF checks',()=>{
  const packet=domainPacket({canonicalOrigin:RIFFOID_APP_ORIGIN,executionOrigin});
  const mode=(origin,method='GET',headers={})=>appRequestMode(new Request(origin+'/api/me',{method,headers}),packet);
  assert.equal(mode('https://attacker.test','GET',{Host:'app.riffoid.com','x-forwarded-host':'app.riffoid.com'}),'deny');
  assert.equal(mode(RIFFOID_APP_ORIGIN,'GET',{Host:'attacker.test'}),'canonical');
  assert.equal(mode(LEGACY_APP_ORIGIN),'recovery-read-only');
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS'])assert.equal(mode(LEGACY_APP_ORIGIN,method,{origin:LEGACY_APP_ORIGIN}),'deny');
  assert.equal(mode(LEGACY_APP_ORIGIN,'GET',{upgrade:'websocket'}),'deny');
  assert.equal(mode(RIFFOID_APP_ORIGIN,'GET',{upgrade:'websocket'}),'deny');
  for(const origin of [LEGACY_APP_ORIGIN,'https://attacker.test','null',''])assert.equal(mode(RIFFOID_APP_ORIGIN,'POST',{origin}),'deny');
  assert.equal(mode(RIFFOID_APP_ORIGIN,'POST',{origin:RIFFOID_APP_ORIGIN,'sec-fetch-site':'cross-site'}),'deny');
  assert.equal(mode(RIFFOID_APP_ORIGIN,'POST',{origin:RIFFOID_APP_ORIGIN,'sec-fetch-site':'same-origin'}),'canonical');
});
