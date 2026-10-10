import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {requireGatewayRecoveryApproval,checkOriginalRecoveryJournal,GatewayRecoveryPublisher} from '../../scripts/m1/riffoid-validation-recovery.mjs';
import {FileJournal} from '../../scripts/m1/riffoid-validation-publisher.mjs';import {hashJSON} from '../../scripts/m1/riffoid-validation-evidence.mjs';
const packet={run:'fixture_original',phases:{gatewayObserve:{}},baselineGuards:{}},plan={originalPacketSHA256:hashJSON(packet),originalRequestId:'fixture_original_gatewayObserve',source:{},retainsOriginalUnknown:true,resumesProtocol:false};
const approval=p=>({explicitOriginalRecovery:true,planSHA256:hashJSON(p),singlePublisher:true,restoreOriginalCodeAndConfig:true,restoreOriginalLogs:true,acceptLateTelemetryRisk:true,retainOriginalUnknown:true,notBefore:1000,expires:1500,userWording:'explicit fixture only'});
test('no new recovery approval or expired/altered approval grants no HTTP',async()=>{
 let calls=0;for(const edit of [a=>null,a=>({...a,explicitOriginalRecovery:false}),a=>({...a,planSHA256:'f'.repeat(64)}),a=>({...a,acceptLateTelemetryRisk:false}),a=>({...a,expires:1000}),a=>({...a,expires:2000000}),a=>({...a,singlePublisher:false})])assert.throws(()=>requireGatewayRecoveryApproval(plan,edit(approval(plan)),1200));
 const p=new GatewayRecoveryPublisher({packet,accounts:{},plan,transport:{mode:'live',request:()=>calls++},journal:{},originalJournal:{}});await assert.rejects(()=>p.publish({phase:'gatewayRestorePrivacy',moduleBytes:[]}));assert.equal(calls,0);requireGatewayRecoveryApproval(plan,approval(plan),1200);
});
test('recovery retains exact original durable unknown and lock; alteration and extra intent reject',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'riffoid-original-recovery-')),j=new FileJournal(directory);try{
  await j.lock();const p={...plan,originalLockSHA256:(await j.lockState()).sha256};
  await j.append(p.originalRequestId,'intent',{packetSHA256:hashJSON(packet),phase:'gatewayObserve',requestId:p.originalRequestId});await j.append(p.originalRequestId,'unknown',{requestId:p.originalRequestId,stopFurtherTest:true,automaticLogsRestore:false});
  const before=await j.records();assert.equal(await checkOriginalRecoveryJournal({packet,plan:p,originalJournal:j}),hashJSON(before));assert.deepEqual(await j.records(),before);assert.equal((await j.lockState()).owned,true);
  await assert.rejects(()=>checkOriginalRecoveryJournal({packet,plan:{...p,originalLockSHA256:'f'.repeat(64)},originalJournal:j}));
  await j.append('unexpected','intent',{});await assert.rejects(()=>checkOriginalRecoveryJournal({packet,plan:p,originalJournal:j}),/only the original/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('unknown original cannot be converted to completed by adding a terminal row',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'riffoid-original-terminal-')),j=new FileJournal(directory);try{
  await j.lock();const p={...plan,originalLockSHA256:(await j.lockState()).sha256};await j.append(p.originalRequestId,'intent',{packetSHA256:hashJSON(packet),phase:'gatewayObserve',requestId:p.originalRequestId});await j.append(p.originalRequestId,'unknown',{requestId:p.originalRequestId,stopFurtherTest:true,automaticLogsRestore:false});await j.append(p.originalRequestId,'terminal',{});await assert.rejects(()=>checkOriginalRecoveryJournal({packet,plan:p,originalJournal:j}));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('recovery write authorization requires exact fsynced intent and lock before credential loading',async()=>{
 const d=await mkdtemp(join(tmpdir(),'riffoid-recovery-write-')),original=new FileJournal(join(d,'original')),journal=new FileJournal(join(d,'recovery'));try{
  await original.lock();await original.append(plan.originalRequestId,'intent',{packetSHA256:hashJSON(packet),phase:'gatewayObserve',requestId:plan.originalRequestId});await original.append(plan.originalRequestId,'unknown',{requestId:plan.originalRequestId,stopFurtherTest:true,automaticLogsRestore:false});
  const w={phase:'gatewayRestorePrivacy',requestId:'fixture_recoverPrivacy',path:'/accounts/'+('a'.repeat(32))+'/workers/scripts/fixture-gateway?bindings_inherit=strict',bodySHA256:'e'.repeat(64),bytes:20};
  const p={...plan,accountId:'a'.repeat(32),originalLockSHA256:(await original.lockState()).sha256,source:{version:'source-v',deployment:'source-d'},writes:[w]};const now=Date.now(),a={...approval(p),notBefore:now,expires:now+60000};
  const pub=new GatewayRecoveryPublisher({packet,accounts:{},plan:p,transport:{mode:'live'},journal,originalJournal:original,approval:a});pub.busy=true;pub.pending={requestId:w.requestId,phase:w.phase};pub.originalJournalSHA256=await checkOriginalRecoveryJournal(pub);await journal.lock();
  const request={accountId:p.accountId,method:'PUT',path:w.path,bodySHA256:w.bodySHA256,bytes:w.bytes};await assert.rejects(()=>pub.authorizeWrite(request));
  await journal.append(w.requestId,'intent',{phase:w.phase,requestId:w.requestId,originalRequestId:p.originalRequestId,planSHA256:hashJSON(p),bodySHA256:w.bodySHA256,priorVersion:'source-v',priorDeployment:'source-d'});await pub.authorizeWrite(request);
  for(const edit of [{method:'GET'},{accountId:'b'.repeat(32)},{path:w.path.replace('fixture-gateway','other-worker')},{bodySHA256:'f'.repeat(64)},{bytes:21}])await assert.rejects(()=>pub.authorizeWrite({...request,...edit}));
  pub.pending.requestId='different';await assert.rejects(()=>pub.authorizeWrite(request));pub.pending.requestId=w.requestId;pub.packet.run='altered';await assert.rejects(()=>pub.authorizeWrite(request));pub.packet.run=packet.run;
  await journal.append(w.requestId,'unknown',{});await assert.rejects(()=>pub.authorizeWrite(request));assert.equal((await original.lockState()).owned,true);assert.equal((await original.records()).length,2);
 }finally{await rm(d,{recursive:true,force:true});}
});
