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
    if(b.type==='secret_text'){
      exactKeys(b,['name','type']);assert.ok(typeof b.name==='string'&&b.name);
      return {name:b.name,type:'inherit',version_id:'latest'};
    }
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
  if(packet.riskAuthorization){
    assert.deepEqual(packet.decisions,approvedDecisions);
    assert.deepEqual(packet.riskAuthorization,approvalRecord(packet.riskAuthorization.record));
    return {status:evidence?'ELIGIBLE_APPLICATION_SCOPE':'BLOCKED_APPLICATION_RECEIPTS',productionAuthorized:false,platformDrain:'unproven'};
  }
  assert.deepEqual(packet.decisions,pendingDecisions,'approval record required');
  return {status:'BLOCKED_USER_DECISION',reasons:[...Object.keys(pendingDecisions),...(!evidence?['missing-application-terminal-evidence']:[])],
    productionAuthorized:false,platformDrain:'unproven'};
}
export const approvedDecisions=Object.freeze({restorationStandard:'USER_APPROVED_APPLICATION_SCOPE_WITH_LATE_TELEMETRY_RISK',unknownLogClosure:'USER_APPROVED_HOLD_CONFIRMED_LOGS_OFF_UNTIL_NEW_APPROVAL'});
const proposal='还需确认两项日志处置：\n1. 所有测试请求都有完整结束回执后恢复日志，但接受平台内部迟到遥测仍可能被保存的残余风险。\n2. 若请求结果不明，立即停测、不重发，保持两端日志持久化关闭；10 分钟内向你报告，等你另行批准再恢复。日志关闭时间可能超过 300 秒，期间会缺少持久化诊断记录。\n\n这两项也允许吗？若不接受，就先不开测试窗口。';
export function approvalRecord(record){
  assert.equal(record.basisHead,'3dc896ade535cd2c51d30ffe7fe829b9b8cd03c8');
  assert.equal(record.proposal.messageId,'Sentinel_bf80f53465588191a3367e6492972f11');assert.equal(record.proposal.text,proposal);
  assert.equal(record.confirmation.messageId,'Sentinel_e4884fe864f4819180a77c591b8290aa');
  assert.equal(record.confirmation.timeUTC,'2026-10-10T03:35:40Z');assert.equal(record.confirmation.text,'确认两项日志处置');
  for(const [k,v]of Object.entries(approvedDecisions))assert.equal(record.decisions[k].status,v);
  for(const k of ['stopFurtherTest','additionalUserApprovalToRestore','durationMayExceed300Seconds','persistentDiagnosticGapAccepted'])assert.equal(record.decisions.unknownLogClosure[k],true);
  assert.equal(record.decisions.unknownLogClosure.retry,false);assert.equal(record.decisions.unknownLogClosure.automaticLogsRestore,false);
  assert.equal(record.decisions.unknownLogClosure.reportWithinMS,600000);assert.equal(record.decisions.restorationStandard.platformDrainProven,false);
  assert.equal(record.thisTask.productionAuthorized,false);assert.equal(record.thisTask.productionWritesPermitted,false);
  return {record:structuredClone(record),sha256:hashJSON(record),decisions:structuredClone(approvedDecisions),authority:'user wording supplied by parent; not a platform receipt',productionAuthorized:false};
}
