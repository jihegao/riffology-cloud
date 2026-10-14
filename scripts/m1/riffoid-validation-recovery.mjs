// Explicit recovery of the original Gateway observation write. Never resumes validation.
import assert from 'node:assert/strict';
import {hashJSON,hashBytes} from './riffoid-validation-evidence.mjs';
import {buildWrite,collectReadback} from './riffoid-validation-publisher.mjs';
import {assertPreservationReadback} from './riffoid-validation-resources.mjs';
import {jsonResult} from './riffoid-validation-transport.mjs';
export const gatewayRecoveryPhases=Object.freeze(['gatewayRestorePrivacy','gatewayRestoreLogs']);
export function gatewayRecoveryPlan({packet,accounts,source,originalLockSHA256,writes}){
 assert.equal(source.metadataSHA256,packet.phases.gatewayObserve.metadataSHA256);assert.equal(source.modulesSHA256,packet.phases.gatewayObserve.modulesSHA256);
 assert.equal(source.preservationMatches,true);assert.equal(source.pipelineGuardPassed,true);assert.match(originalLockSHA256,/^[a-f0-9]{64}$/);
 assertPreservationReadback(source,packet.preservation.gateway.assets,{accountId:accounts.gateway,worker:packet.baselineGuards.gateway.worker});
 assert.deepEqual(writes.map(w=>w.phase),gatewayRecoveryPhases);
 for(const w of writes){assert.equal(w.method,'PUT');assert.equal(w.path,`/accounts/${accounts.gateway}/workers/scripts/${packet.baselineGuards.gateway.worker}?bindings_inherit=strict`);assert.match(w.bodySHA256,/^[a-f0-9]{64}$/);assert.ok(w.bytes>0);}
 return {kind:'original-gateway-recovery-v1',originalPacketSHA256:hashJSON(packet),originalRequestId:packet.run+'_gatewayObserve',originalLockSHA256,accountId:accounts.gateway,worker:packet.baselineGuards.gateway.worker,source:structuredClone(source),writes:structuredClone(writes),retainsOriginalUnknown:true,resumesProtocol:false,acceptancePassed:false};
}
export function requireGatewayRecoveryApproval(plan,approval,now=Date.now()){
 assert.ok(approval?.explicitOriginalRecovery===true,'new explicit original-write recovery approval required');assert.equal(approval.planSHA256,hashJSON(plan));
 for(const k of ['singlePublisher','restoreOriginalCodeAndConfig','restoreOriginalLogs','acceptLateTelemetryRisk','retainOriginalUnknown'])assert.equal(approval[k],true);
 assert.ok(Number.isSafeInteger(approval.notBefore)&&Number.isSafeInteger(approval.expires)&&approval.notBefore<=now&&now<approval.expires&&approval.expires-approval.notBefore<=1500000);
 assert.ok(typeof approval.userWording==='string'&&approval.userWording.length>0);
}
export async function checkOriginalRecoveryJournal({packet,plan,originalJournal}){
 const lock=await originalJournal.lockState();assert.equal(lock.status,'PRESENT_OWNER_RECORDED');assert.equal(lock.sha256,plan.originalLockSHA256,'original lock changed; no recovery');
 const rows=await originalJournal.records();assert.equal(rows.length,2,'only the original observation intent and unknown may exist');
 const intent=rows.find(r=>r.name===plan.originalRequestId+'.intent.json'),unknown=rows.find(r=>r.name===plan.originalRequestId+'.unknown.json');assert.ok(intent&&unknown);
 assert.equal(intent.value.packetSHA256,hashJSON(packet));assert.equal(intent.value.phase,'gatewayObserve');assert.equal(intent.value.requestId,plan.originalRequestId);
 assert.equal(unknown.value.requestId,plan.originalRequestId);assert.equal(unknown.value.stopFurtherTest,true);assert.equal(unknown.value.automaticLogsRestore,false);
 return hashJSON(rows);
}
export class GatewayRecoveryPublisher{
 constructor({packet,accounts,plan,transport,journal,originalJournal,approval=null,readBudget={}}){this.packet=structuredClone(packet);this.accounts=accounts;this.plan=structuredClone(plan);this.transport=transport;this.journal=journal;this.originalJournal=originalJournal;this.approval=approval;this.readBudget=readBudget;this.planHash=hashJSON(this.plan);this.cursor=0;this.pending=null;this.busy=false;this.current=structuredClone(plan.source);this.artifact=packet.phases.gatewayObserve;assert.equal(plan.originalPacketSHA256,hashJSON(packet));}
 async authorizeWrite(request){
  assert.equal(hashJSON(this.packet),this.plan.originalPacketSHA256);assert.equal(hashJSON(this.plan),this.planHash);
  requireGatewayRecoveryApproval(this.plan,this.approval);assert.ok(this.busy&&this.pending);assert.equal((await this.journal.lockState()).owned,true);
  const w=this.plan.writes[this.cursor];assert.ok(w);assert.equal(w.phase,gatewayRecoveryPhases[this.cursor]);assert.equal(this.pending.requestId,w.requestId);assert.equal(this.pending.phase,w.phase);assert.equal(request.accountId,this.plan.accountId);assert.equal(request.method,'PUT');assert.equal(request.path,w.path);assert.equal(request.bodySHA256,w.bodySHA256);assert.equal(request.bytes,w.bytes);
  assert.equal(await checkOriginalRecoveryJournal(this),this.originalJournalSHA256);
  const rows=await this.journal.records();assert.equal(rows.length,this.cursor*2+1,'exact recovery journal sequence required');assert.equal(rows.some(r=>r.name.endsWith('.unknown.json')),false);
  const intent=rows.find(r=>r.name===w.requestId+'.intent.json');assert.ok(intent);assert.equal(intent.value.phase,w.phase);assert.equal(intent.value.requestId,w.requestId);assert.equal(intent.value.originalRequestId,this.plan.originalRequestId);assert.equal(intent.value.planSHA256,hashJSON(this.plan));assert.equal(intent.value.bodySHA256,w.bodySHA256);assert.equal(intent.value.priorVersion,this.current.version);assert.equal(intent.value.priorDeployment,this.current.deployment);
  assert.equal(rows.some(r=>r.name===w.requestId+'.terminal.json'),false);
  for(const r of rows.filter(r=>r.name.endsWith('.intent.json')&&r.name!==intent.name))assert.ok(rows.some(x=>x.name===r.name.replace('.intent.json','.terminal.json')));
 }
 async publish({phase,moduleBytes}){
  assert.equal(hashJSON(this.packet),this.plan.originalPacketSHA256);assert.equal(hashJSON(this.plan),this.planHash);
  requireGatewayRecoveryApproval(this.plan,this.approval);assert.equal(this.transport.mode,'live');assert.equal(this.busy,false);assert.equal(this.pending,null);assert.equal(await this.journal.hasPending(),false);
  assert.equal(phase,gatewayRecoveryPhases[this.cursor]);assert.equal(this.plan.retainsOriginalUnknown,true);assert.equal(this.plan.resumesProtocol,false);
  const w=this.plan.writes[this.cursor],write=buildWrite(this.packet,phase,moduleBytes,this.plan.accountId,w.requestId);assert.equal(hashBytes(write.body),w.bodySHA256);assert.equal(write.body.length,w.bytes);
  this.originalJournalSHA256=await checkOriginalRecoveryJournal(this);this.busy=true;let locked=false;
  try{
   await this.journal.lock();locked=true;
   const pre=await collectReadback(this.transport,this.plan.accountId,this.plan.worker,this.artifact,this.packet.preservation.gateway,this.readBudget);
   for(const k of ['version','deployment','resourcesSHA256'])assert.equal(pre[k],this.current[k]);assertPreservationReadback(pre,this.packet.preservation.gateway.assets,{accountId:this.plan.accountId,worker:this.plan.worker});assert.equal(pre.pipelineGuardPassed,true);
   requireGatewayRecoveryApproval(this.plan,this.approval);assert.equal((await this.journal.lockState()).owned,true);assert.equal(await checkOriginalRecoveryJournal(this),this.originalJournalSHA256);
   await this.journal.append(w.requestId,'intent',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,planSHA256:hashJSON(this.plan),bodySHA256:w.bodySHA256,priorVersion:pre.version,priorDeployment:pre.deployment,startedAt:Date.now()});
   this.pending={requestId:w.requestId,phase};const ack=jsonResult(await this.transport.request(write));
   const receipt=await collectReadback(this.transport,this.plan.accountId,this.plan.worker,this.packet.phases[phase],this.packet.preservation.gateway,this.readBudget);
   assert.equal(ack.result.id,this.plan.worker);assert.equal(receipt.resourcesSHA256,pre.resourcesSHA256);assertPreservationReadback(receipt,this.packet.preservation.gateway.assets,{accountId:this.plan.accountId,worker:this.plan.worker});assert.equal(receipt.pipelineGuardPassed,true);
   assert.equal((await this.journal.lockState()).owned,true);assert.equal(await checkOriginalRecoveryJournal(this),this.originalJournalSHA256);
   await this.journal.append(w.requestId,'terminal',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,receipt,readbackAt:Date.now(),originalUnknownRetained:true});
   this.current=receipt;this.artifact=this.packet.phases[phase];this.cursor++;this.pending=null;return {phase,receipt,originalUnknownRetained:true,protocolAcceptance:false};
  }catch(e){if(this.pending)await this.journal.append(w.requestId,'unknown',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,automaticRetry:false,automaticLogsRestore:false,reportDueAt:Date.now()+600000}).catch(()=>{});throw e;}
  finally{this.busy=false;if(locked&&!this.pending&&((await this.journal.lockState()).owned))await this.journal.unlock();}
 }
}

// Manual execution of the already approved second write after an interrupted
// privacy write has been independently read back. Both unknown journals stay intact.
export function assertPrivacyReconciliation({packet,plan,receipt}){
 assert.equal(receipt.metadataSHA256,packet.phases.gatewayRestorePrivacy.metadataSHA256);
 assert.equal(receipt.modulesSHA256,packet.phases.gatewayRestorePrivacy.modulesSHA256);
 assert.equal(receipt.resourcesSHA256,plan.source.resourcesSHA256);
 assert.equal(receipt.preservationMatches,true);assert.equal(receipt.pipelineGuardPassed,true);
 assert.equal(receipt.readObservation?.bracketVerified,true);
 assert.ok(receipt.version&&receipt.deployment);assert.notEqual(receipt.version,plan.source.version);assert.notEqual(receipt.deployment,plan.source.deployment);
 assertPreservationReadback(receipt,packet.preservation.gateway.assets,{accountId:plan.accountId,worker:plan.worker});
}
export async function checkInterruptedRecoveryJournal({plan,interruptedJournal,interruptedLockSHA256}){
 const lock=await interruptedJournal.lockState();assert.equal(lock.status,'PRESENT_OWNER_RECORDED');assert.equal(lock.sha256,interruptedLockSHA256);
 const w=plan.writes[0],rows=await interruptedJournal.records();assert.equal(rows.length,2,'only the first recovery intent and unknown may exist');
 const intent=rows.find(r=>r.name===w.requestId+'.intent.json'),unknown=rows.find(r=>r.name===w.requestId+'.unknown.json');assert.ok(intent&&unknown);
 for(const r of [intent,unknown]){assert.equal(r.value.phase,'gatewayRestorePrivacy');assert.equal(r.value.requestId,w.requestId);assert.equal(r.value.originalRequestId,plan.originalRequestId);}
 assert.equal(intent.value.planSHA256,hashJSON(plan));assert.equal(intent.value.bodySHA256,w.bodySHA256);assert.equal(intent.value.priorVersion,plan.source.version);assert.equal(intent.value.priorDeployment,plan.source.deployment);
 assert.equal(unknown.value.automaticRetry,false);assert.equal(unknown.value.automaticLogsRestore,false);
 return hashJSON(rows);
}
export class GatewayApprovedLogsPublisher{
 constructor({packet,accounts,plan,privacyReadback,interruptedJournal,interruptedLockSHA256,transport,journal,originalJournal,approval,readBudget={}}){
  this.packet=structuredClone(packet);this.accounts=accounts;this.plan=structuredClone(plan);this.planHash=hashJSON(plan);this.current=structuredClone(privacyReadback);
  this.interruptedJournal=interruptedJournal;this.interruptedLockSHA256=interruptedLockSHA256;this.transport=transport;this.journal=journal;this.originalJournal=originalJournal;this.approval=approval;this.readBudget=readBudget;this.busy=false;this.pending=null;this.attempted=false;
  assert.equal(plan.originalPacketSHA256,hashJSON(packet));assert.equal(plan.retainsOriginalUnknown,true);assert.equal(plan.resumesProtocol,false);assert.deepEqual(plan.writes.map(w=>w.phase),gatewayRecoveryPhases);
  assertPrivacyReconciliation({packet,plan,receipt:privacyReadback});
 }
 async retainedJournals(){return {original:await checkOriginalRecoveryJournal(this),interrupted:await checkInterruptedRecoveryJournal(this)};}
 async authorizeWrite(request){
  assert.equal(hashJSON(this.packet),this.plan.originalPacketSHA256);assert.equal(hashJSON(this.plan),this.planHash);requireGatewayRecoveryApproval(this.plan,this.approval);
  assert.ok(this.busy&&this.attempted&&this.pending);assert.equal((await this.journal.lockState()).owned,true);assert.deepEqual(await this.retainedJournals(),this.retainedHashes);
  const w=this.plan.writes[1];assert.equal(this.pending.requestId,w.requestId);assert.equal(this.pending.phase,'gatewayRestoreLogs');
  for(const [k,v] of Object.entries({accountId:this.plan.accountId,method:'PUT',path:w.path,bodySHA256:w.bodySHA256,bytes:w.bytes}))assert.equal(request[k],v);
  const rows=await this.journal.records();assert.equal(rows.length,1);const intent=rows[0];assert.equal(intent.name,w.requestId+'.intent.json');
  for(const [k,v] of Object.entries({phase:w.phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,planSHA256:this.planHash,bodySHA256:w.bodySHA256,priorVersion:this.current.version,priorDeployment:this.current.deployment,privacyReadbackSHA256:hashJSON(this.current),interruptedJournalSHA256:this.retainedHashes.interrupted}))assert.equal(intent.value[k],v);
 }
 async publish({phase,moduleBytes}){
  assert.equal(phase,'gatewayRestoreLogs');assert.equal(this.transport.mode,'live');assert.equal(this.busy,false);assert.equal(this.pending,null);assert.equal(this.attempted,false);assert.equal(await this.journal.hasPending(),false);
  assert.equal(hashJSON(this.packet),this.plan.originalPacketSHA256);assert.equal(hashJSON(this.plan),this.planHash);requireGatewayRecoveryApproval(this.plan,this.approval);assertPrivacyReconciliation({packet:this.packet,plan:this.plan,receipt:this.current});
  const w=this.plan.writes[1],write=buildWrite(this.packet,phase,moduleBytes,this.plan.accountId,w.requestId);assert.equal(hashBytes(write.body),w.bodySHA256);assert.equal(write.body.length,w.bytes);
  this.retainedHashes=await this.retainedJournals();this.busy=true;let locked=false;
  try{
   await this.journal.lock();locked=true;
   const pre=await collectReadback(this.transport,this.plan.accountId,this.plan.worker,this.packet.phases.gatewayRestorePrivacy,this.packet.preservation.gateway,this.readBudget);
   assertPrivacyReconciliation({packet:this.packet,plan:this.plan,receipt:pre});for(const k of ['version','deployment','resourcesSHA256'])assert.equal(pre[k],this.current[k]);
   requireGatewayRecoveryApproval(this.plan,this.approval);assert.deepEqual(await this.retainedJournals(),this.retainedHashes);assert.equal((await this.journal.lockState()).owned,true);
   await this.journal.append(w.requestId,'intent',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,planSHA256:this.planHash,bodySHA256:w.bodySHA256,priorVersion:this.current.version,priorDeployment:this.current.deployment,privacyReadbackSHA256:hashJSON(this.current),interruptedJournalSHA256:this.retainedHashes.interrupted,startedAt:Date.now()});
   this.attempted=true;this.pending={phase,requestId:w.requestId};const ack=jsonResult(await this.transport.request(write));
   const receipt=await collectReadback(this.transport,this.plan.accountId,this.plan.worker,this.packet.phases.gatewayRestoreLogs,this.packet.preservation.gateway,this.readBudget);
   assert.equal(ack.result.id,this.plan.worker);assert.equal(receipt.resourcesSHA256,pre.resourcesSHA256);assertPreservationReadback(receipt,this.packet.preservation.gateway.assets,{accountId:this.plan.accountId,worker:this.plan.worker});assert.equal(receipt.pipelineGuardPassed,true);
   assert.deepEqual(await this.retainedJournals(),this.retainedHashes);assert.equal((await this.journal.lockState()).owned,true);
   await this.journal.append(w.requestId,'terminal',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,receipt,readbackAt:Date.now(),originalUnknownRetained:true,interruptedRecoveryUnknownRetained:true});this.pending=null;return {phase,receipt,originalUnknownRetained:true,interruptedRecoveryUnknownRetained:true,protocolAcceptance:false};
  }catch(e){if(this.pending)await this.journal.append(w.requestId,'unknown',{phase,requestId:w.requestId,originalRequestId:this.plan.originalRequestId,automaticRetry:false,automaticLogsRestore:false,reportDueAt:Date.now()+600000}).catch(()=>{});throw e;}
  finally{this.busy=false;if(locked&&!this.pending&&((await this.journal.lockState()).owned))await this.journal.unlock();}
 }
}
