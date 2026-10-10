// Pure receipt parsing/consistency. No network, platform census, or approval authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const hashJSON=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const hashBytes=value=>createHash('sha256').update(value instanceof ArrayBuffer?new Uint8Array(value):value).digest('hex');
export function stateMetadata(metadata){
  // These upload fields are not echoed by the reviewed public settings contract.
  // Hash only the readback projection; never claim full preservation from it.
  const {keep_assets,main_module,containers,...state}=structuredClone(metadata);return state;
}
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'unexpected receipt fields');
export function validateRedactedSecretKey(binding){
  exactKeys(binding,['name','type','algorithm','format','usages']);assert.equal(binding.type,'secret_key');
  assert.ok(typeof binding.name==='string'&&binding.name);
  const algorithm=typeof binding.algorithm==='string'?binding.algorithm:(exactKeys(binding.algorithm,['name']),binding.algorithm.name);
  assert.ok(typeof algorithm==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(algorithm));
  assert.ok(['raw','pkcs8','spki','jwk'].includes(binding.format));
  assert.ok(Array.isArray(binding.usages)&&binding.usages.length&&binding.usages.every(v=>['encrypt','decrypt','sign','verify','deriveKey','deriveBits','wrapKey','unwrapKey'].includes(v)));
}
export function wireMetadata(metadata){
  const result=structuredClone(metadata);
  result.bindings=result.bindings.map(b=>{
    assert.notEqual(b.type,'secret_text');
    if(b.type!=='secret_key')return b;
    validateRedactedSecretKey(b);
    // Script upload cannot pin inherit to a fixed version. Its only legal
    // selector is latest; preflight binds latest to the prior version, while
    // publisher quiescence remains an unresolved live prerequisite.
    return {name:b.name,type:'inherit',version_id:'latest'};
  });return result;
}
const result=(name,status,code,extra={})=>({case:name,status,code,...extra});
export function expectedBody(slot,operation){
  if(operation==='observe'||operation==='cleanup')return {slot,case:operation,passed:true,nativeIpMatches:true,
    results:[operation==='cleanup'?result('cleanup',200,'expired_control_rows_removed',{removed:2}):result('observe',200,'accepted')]};
  return {slot,passed:true,nativeIpMatches:true,sameSignedInputsReplay:slot==='A',realUnusedProofExpiry:slot==='A',
    results:[result('begin',200,'accepted'),result('primary',200,'accepted',{ipMatches:true}),
      ...(slot==='A'?[result('replay',403,'entry_replay_denied'),result('expired',403,'entry_proof_denied')]:[])]};
}
export function parseProtocolReceipt(packet,row){
  exactKeys(row,['requestId','run','slot','operation','startedAt','receivedAt','outcome','response']);
  assert.ok(typeof row.requestId==='string'&&row.requestId.length>0&&row.requestId.length<=128);
  assert.equal(row.run,packet.run);assert.ok(['A','B'].includes(row.slot));
  assert.ok(['observe','run','cleanup'].includes(row.operation));
  assert.ok(row.operation!=='cleanup'||row.slot==='A');
  assert.ok(Number.isSafeInteger(row.startedAt)&&Number.isSafeInteger(row.receivedAt)&&row.receivedAt>=row.startedAt);
  assert.equal(row.outcome,'response','timeout, disconnect and lost receipts are unknown, never terminal');
  exactKeys(row.response,['status','body']);assert.equal(row.response.status,200);
  assert.ok(typeof row.response.body==='string'&&Buffer.byteLength(row.response.body)<=1024);
  const body=JSON.parse(row.response.body);assert.deepEqual(body,expectedBody(row.slot,row.operation));
  const c=packet.config;
  if(row.operation==='cleanup')assert.ok(row.startedAt>=c.expires&&row.receivedAt<c.expires+30000);
  else{
    assert.ok(row.startedAt>=c.notBefore&&row.receivedAt<c.expires);
    if(row.operation==='run')assert.ok(row.startedAt<packet.schedule[row.slot==='A'?'latestAStart':'latestBStart']);
  }
  return {...structuredClone(row),body,bodySHA256:hashBytes(row.response.body)};
}
export function protocolTerminalEvidence(packet,rows,context){
  assert.equal(rows.length,5,'exactly two Observe, two Run, one cleanup; no extra requests');
  const parsed=rows.map(r=>parseProtocolReceipt(packet,r));
  assert.equal(new Set(parsed.map(r=>r.requestId)).size,5,'original request identities must be distinct');
  assert.deepEqual(parsed.map(r=>r.slot+':'+r.operation).sort(),['A:cleanup','A:observe','A:run','B:observe','B:run']);
  for(const slot of ['A','B']){
    const observe=parsed.find(r=>r.slot===slot&&r.operation==='observe'),run=parsed.find(r=>r.slot===slot&&r.operation==='run');
    assert.ok(observe.receivedAt<=context.markerAt);
    assert.ok(run.startedAt>=context.markerAt&&run.startedAt>=context.cueAt);
  }
  const cleanup=parsed.find(r=>r.operation==='cleanup');
  assert.ok(parsed.every(r=>r.operation==='cleanup'||r.receivedAt<=cleanup.startedAt));
  assert.ok(Number.isSafeInteger(context.stopAt)&&context.stopAt<=cleanup.startedAt);
  assert.deepEqual(Object.keys(context.versions).sort(),['entry','gateway']);
  return {kind:'fixed-protocol-application-terminal-v1',run:packet.run,packetSHA256:hashJSON(packet),
    receiptsSHA256:hashJSON(rows),versions:structuredClone(context.versions),completedAt:cleanup.receivedAt,
    scope:'the five original browser operations and their awaited fixed validation call chains only',
    unproven:['platform-wide invocation census','Cloudflare internal telemetry buffer drain','late telemetry persistence semantics'],
    provenance:'supplied receipt consistency; fixtures are not authenticated production evidence'};
}
export const pendingDecisions=Object.freeze({restorationStandard:'pending-user-decision',unknownLogClosure:'pending-user-decision'});
export function restorationEligibility(packet,evidence){
  assert.deepEqual(packet.decisions,pendingDecisions,'this offline patch cannot grant user approval');
  return {status:'BLOCKED_USER_DECISION',reasons:[...Object.keys(pendingDecisions),...(!evidence?['missing-application-terminal-evidence']:[])],
    productionAuthorized:false,platformDrain:'unproven'};
}
