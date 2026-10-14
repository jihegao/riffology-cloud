// Configuration-only decoded GET routing. Identity GETs, PUTs and module/source evidence stay
// on the caller's original native transport; this helper performs no HTTP.
import assert from 'node:assert/strict';
import {validateControlRequest} from './riffoid-validation-transport.mjs';

export function createMetadataReadRouter(scopes){
  const rows=Object.entries(scopes);
  assert.ok(rows.length>0&&rows.length<=3);
  const identities=new Set(),zones=new Map();
  for(const [role,s] of rows){
    assert.match(role,/^[a-z]+$/);
    assert.match(s.accountId,/^[a-f0-9]{32}$/);
    assert.match(s.zoneId,/^[a-f0-9]{32}$/);
    assert.match(s.worker,/^[a-z0-9_-]+$/);
    const identity=s.accountId+'/'+s.worker;
    assert.ok(!identities.has(identity),'duplicate Worker scope');identities.add(identity);
    assert.ok(!zones.has(s.zoneId)||zones.get(s.zoneId)===s.accountId,'ambiguous zone ownership');zones.set(s.zoneId,s.accountId);
  }
  const frozen=structuredClone(rows);
  return ({method='GET',path,body})=>{
    assert.ok(['GET','PUT'].includes(method));validateControlRequest(method,path);
    if(method==='PUT')return null;
    assert.equal(body,undefined,'metadata GET body forbidden');
    const pathname=path.split('?')[0];
    for(const [role,s] of frozen){
      const script='/accounts/'+s.accountId+'/workers/scripts/'+s.worker;
      // Deployment/version identities must use the caller's native GET reader.
      const allowed=['/zones/'+s.zoneId,'/zones/'+s.zoneId+'/logpush/jobs',
        '/zones/'+s.zoneId+'/rulesets/phases/http_log_custom_fields/entrypoint',
        '/accounts/'+s.accountId+'/logpush/jobs','/accounts/'+s.accountId+'/workers/observability/destinations',
        script+'/tails','/accounts/'+s.accountId+'/containers/applications'];
      if(allowed.includes(pathname)||pathname.startsWith('/accounts/'+s.accountId+'/containers/applications/'))return {role,kind:'configuration'};
    }
    return null;
  };
}
