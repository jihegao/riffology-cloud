// A transport guard only; this file creates no capability and performs no HTTP.
// Formal activation still requires the complete, separately reviewed live plan.
import assert from 'node:assert/strict';
import {hashJSON} from './riffoid-validation-evidence.mjs';
export const formalFixedPhases=Object.freeze(['gatewayCanonical','executionCanonical','entryEnabled','entryClose','gatewayRollback','executionRollback','entryRollback']);
export function formalNativeIntentAuthorizer({publisher,journal,now=Date.now}){
  const dispatched=new Set();let authorizing=false;
  return async request=>{
    assert.equal(authorizing,false,'concurrent authorization denied');authorizing=true;
    try{
      assert.equal(request.method,'PUT');
      const p=publisher.pending,c=publisher.liveCapability;
      assert.ok(p&&publisher.busy,'durable original intent required');
      assert.ok(formalFixedPhases.includes(p.phase),'fixed formal payload only');
      assert.equal(p.phase,publisher.allowedPhase,'reviewed state transition required');
      assert.equal(hashJSON(publisher.frozenPlan),publisher.frozenPlanSHA256,'frozen plan changed');
      assert.equal(c?.frozenPlanSHA256,publisher.frozenPlanSHA256);
      assert.equal(c?.productionWritesPermitted,true);
      assert.equal(c?.singlePublisher,true);assert.equal(c?.resourcesCoverageEstablished,true);
      assert.equal(c?.nativeProtocolComplete,true);assert.equal(c?.formalAcceptanceCapabilitiesReady,true);
      assert.equal(c?.failureDisposition,'exact-close-forward-rollback');
      const at=now();assert.ok(c.notBefore<=at&&at<c.expires,'live window expired');
      assert.ok(c.expires-c.notBefore<=1800000,'bounded live window required');
      assert.ok(c.publisherConfirmedAt<=at&&at-c.publisherConfirmedAt<7200000,'publisher exclusion expired');
      const expected=publisher.frozenPlan.requests[p.phase];assert.ok(expected);
      assert.equal(request.accountId,expected.accountId);assert.equal(request.path,expected.path);
      assert.equal(request.bodySHA256,expected.bodySHA256);assert.equal(request.bytes,expected.bytes);
      assert.equal(p.requestId,expected.requestId);
      assert.equal(dispatched.has(p.requestId),false,'original PUT cannot be dispatched twice');
      assert.equal((await journal.lockState()).owned,true,'owned lock required');
      const rows=await journal.records();
      assert.equal(rows.some(r=>r.name.endsWith('.unknown.json')),false,'unknown original write blocks publication');
      const row=rows.find(r=>r.name===p.requestId+'.intent.json');assert.ok(row,'fsynced original intent required');
      assert.deepEqual(row.value,{frozenPlanSHA256:publisher.frozenPlanSHA256,phase:p.phase,requestId:p.requestId,
        accountId:expected.accountId,worker:expected.worker,priorVersion:p.prior.version,priorDeployment:p.prior.deployment,
        priorMetadataSHA256:p.prior.metadataSHA256,priorModulesSHA256:p.prior.modulesSHA256,
        priorResourcesSHA256:p.prior.resourcesSHA256,bodySHA256:request.bodySHA256,bytes:request.bytes,startedAt:p.startedAt});
      assert.ok(p.startedAt>=c.notBefore&&p.startedAt<=at&&at-p.startedAt<180000,'stale preflight intent');
      assert.equal(rows.some(r=>r.name===p.requestId+'.terminal.json'),false,'original write already terminal');
      for(const other of rows.filter(r=>r.name.endsWith('.intent.json'))){
        if(other.name===row.name)continue;
        assert.ok(rows.some(r=>r.name===other.name.replace('.intent.json','.terminal.json')),'other unresolved write');
      }
      // Consume before credential loading. Credential/network failure cannot retry.
      dispatched.add(p.requestId);
    }finally{authorizing=false;}
  };
}
