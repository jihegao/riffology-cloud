import test from 'node:test';
import assert from 'node:assert/strict';
import {entry} from '../../services/entry/index.ts';
import {validationConfig,VALIDATION_MAX_WINDOW_MS,validationCanonical as canonical,validationTransport as transport} from '../../services/entry/validation-policy.ts';
const run='offline_validation_20261009';
function env(){return {APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',
  RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify({version:1,run,notBefore:Date.now()-1000,expires:Date.now()+119000,ips:{A:'198.51.100.23',B:'198.51.100.24'}})};}
function req(operation='run',init:RequestInit={}){return new Request(`${canonical}/__riffoid-validation/${run}/A/${operation}`,{
  method:'POST',...init,headers:{host:'app.riffoid.com',origin:canonical,'cf-connecting-ip':'198.51.100.23',...Object.fromEntries(new Headers(init.headers))}});}

test('temporary config is strict, distinct two native IPs, fixed duration and no capabilities',()=>{
  const good=env(),c=validationConfig(good);assert.equal(c.version,1);
  for(const change of [{ips:{A:c.ips.A,B:c.ips.A}},{expires:c.notBefore+VALIDATION_MAX_WINDOW_MS+1},{notBefore:-1},{run:'short'},
    {token:'not-accepted'},{ips:{A:'198.51.100.023',B:c.ips.B}},{ips:{A:c.ips.A,B:c.ips.B,C:'unexpected'}}]){
    assert.throws(()=>validationConfig({...good,RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify({...c,...change})}));
  }
});
test('presence maintains closure across valid, malformed, expired and wrong-topology configurations',async()=>{
  let sends=0;const send=async()=>{sends++;throw Error('unexpected-outbound');};
  for(const c of [env(),{...env(),RIFFOID_VALIDATION_CONFIG_JSON:''},
    {...env(),RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify({...validationConfig(env()),notBefore:0,expires:120000})},
    {...env(),TWO_ACCOUNT_AUTH_MODE:'disabled'}]){
    for(const path of ['/','/api/me','/api/auth/get-session']){
      const response=await entry(new Request(canonical+path),c,send);assert.equal(response.status,503);assert.equal((await response.json() as {error:string}).error,'validation_maintenance');
    }
  }assert.equal(sends,0);
});
test('no oracle: unknown source, credentials, caller proof/case, nonempty body, altered path/query and origin fail before fetch',async()=>{
  let sends=0;const send=async()=>{sends++;throw Error('unexpected-outbound');},c=env();
  const requests=[req('run',{headers:{'cf-connecting-ip':'198.51.100.99'}}),req('run',{headers:{'cf-worker':'riffoid.com'}}),
    ...['cookie','authorization','upgrade','x-riffoid-client-ip','x-riffoid-entry-proof','x-riffoid-entry-signature','x-riffoid-validation-case'].map(h=>req('run',{headers:{[h]:'reject'}})),
    req('run',{body:'arbitrary-signing-input'}),req('run',{headers:{origin:'https://old.example.test'}}),
    new Request(req().url+'?case=primary',{method:'POST',headers:req().headers}),
    new Request(req().url.replace(run,'different_run_20261009'),{method:'POST',headers:req().headers})];
  for(const request of requests)assert.equal((await entry(request,c,send)).status,403);
  assert.equal(sends,0);
  const unconfigured={APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1'};
  assert.equal((await entry(req(),unconfigured,send)).status,403);assert.equal(sends,0);
});
test('UI stores no credential and uses exact same-origin empty POST; run cannot sign without actual global begin acceptance',async()=>{
  let calls=0;const c=env();
  const ui=await entry(req('ui',{method:'GET'}),c,async()=>{throw Error('unexpected-outbound');});
  assert.equal(ui.status,200);assert.equal(ui.headers.get('set-cookie'),null);const text=await ui.text();
  assert.ok(text.includes("credentials:'omit'"));assert.ok(text.includes("body:''"));assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(text));
  // No private key exists in this fixture. Only an accepted begin may reach
  // signEntry; a lost/denied begin must fail closed without another outbound.
  const premature=await entry(req(),c,async()=>{calls++;throw Error('unexpected-before-marker');});
  assert.equal(premature.status,503);assert.equal((await premature.json() as {error:string}).error,'validation_not_ready');assert.equal(calls,0);
  const ready={...c,ENTRY_NATIVE_IP_BOUNDARY:'cloudflare-direct-visitor-waf-v1'};
  const response=await entry(req(),ready,async()=>{calls++;throw Error('offline-lost-control-receipt');});
  assert.equal(response.status,503);assert.equal(calls,1);const result=await response.json() as {retry:boolean;spent:boolean;results:unknown[]};assert.equal(result.retry,false);assert.equal(result.spent,true);
  assert.deepEqual(result.results,[]);
});
