import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProtocolReceipt,protocolTerminalEvidence,restorationEligibility} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {packetFixture,protocolRows,terminalContext} from './fixtures/riffoid-offline-fixtures.mjs';

test('normal exact fixed protocol derives scoped terminal evidence with explicit platform gaps; approval remains pending',()=>{
  const p=packetFixture(),rows=protocolRows(p),e=protocolTerminalEvidence(p,rows,terminalContext);
  assert.equal(e.kind,'fixed-protocol-application-terminal-v1');assert.equal(e.completedAt,rows[4].receivedAt);
  assert.ok(e.unproven.includes('Cloudflare internal telemetry buffer drain'));
  for(const name of ['runtimeReleased','validationInvocationsActive','unknownInvocations','allOriginalRequestsTerminal','drain'])assert.equal(name in e,false);
  assert.equal(restorationEligibility(p,e).productionAuthorized,false);
  const forged=structuredClone(p);forged.decisions.restorationStandard='approved';assert.throws(()=>restorationEligibility(forged,e));
});
for(const outcome of ['timeout','network-disconnected','receipt-lost'])test(`${outcome} or an unavailable verifier is never replaced by expiry, counters or cleanup`,()=>{
  const p=packetFixture(),rows=protocolRows(p);rows[2].outcome=outcome;rows[2].response=null;
  assert.throws(()=>parseProtocolReceipt(p,rows[2]));assert.throws(()=>protocolTerminalEvidence(p,rows,terminalContext));
  const failed=protocolRows(p);failed[3].response={status:503,body:JSON.stringify({error:'validation_unknown_or_failed',spent:true,retry:false,results:[]})};
  assert.throws(()=>protocolTerminalEvidence(p,failed,terminalContext));
  assert.equal(restorationEligibility(p,null).status,'BLOCKED_USER_DECISION');
});
test('extra/duplicate/missing receipt, aliases, malformed body and partial accepted results reject',()=>{
  const p=packetFixture();
  for(const edit of [rows=>rows.pop(),rows=>rows.push(structuredClone(rows[4])),rows=>rows[4].requestId=rows[3].requestId,
    rows=>rows[2].operation='observe',rows=>rows[3].run='another-run',rows=>rows[3].response.body='not json',
    rows=>rows[3].response.body='x'.repeat(1025),rows=>rows[4].response.body=rows[4].response.body.replace('"removed":2','"removed":0'),
    rows=>rows[3].response.body=rows[3].response.body.replace('"ipMatches":true','"ipMatches":false'),
    rows=>rows[3].platformDrain=true]){
    const rows=protocolRows(p);edit(rows);assert.throws(()=>protocolTerminalEvidence(p,rows,terminalContext));
  }
});
test('Run cannot precede marker/cue or deadline; cleanup cannot precede termination or miss its fixed interval',()=>{
  const p=packetFixture();
  for(const edit of [rows=>rows[3].startedAt=terminalContext.cueAt-1,rows=>rows[0].receivedAt=terminalContext.markerAt+1,
    rows=>rows[3].receivedAt=p.config.expires,rows=>rows[4].startedAt=p.config.expires-1,
    rows=>rows[4].receivedAt=p.config.expires+30000,rows=>rows[3].receivedAt=rows[3].startedAt-1]){
    const rows=protocolRows(p);edit(rows);assert.throws(()=>protocolTerminalEvidence(p,rows,terminalContext));
  }
});
