import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {requireGatewayRecoveryApproval,checkOriginalRecoveryJournal,GatewayRecoveryPublisher} from '../../scripts/m1/riffoid-validation-recovery.mjs';
import {FileJournal} from '../../scripts/m1/riffoid-validation-publisher.mjs';import {hashJSON} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {assertPrivacyReconciliation,checkInterruptedRecoveryJournal,GatewayApprovedLogsPublisher} from '../../scripts/m1/riffoid-validation-recovery.mjs';
import {assetPreservationEvidence} from '../../scripts/m1/riffoid-validation-resources.mjs';
const packet={run:'fixture_original',phases:{gatewayObserve:{}},baselineGuards:{}},plan={originalPacketSHA256:hashJSON(packet),originalRequestId:'fixture_original_gatewayObserve',source:{},retainsOriginalUnknown:true,resumesProtocol:false};
const approval=p=>({explicitOriginalRecovery:true,planSHA256:hashJSON(p),singlePublisher:true,restoreOriginalCodeAndConfig:true,restoreOriginalLogs:true,acceptLateTelemetryRisk:true,retainOriginalUnknown:true,notBefore:1000,expires:1500,userWording:'explicit fixture only'});
test('no new recovery approval or expired/altered approval grants no HTTP',async()=>{
 let calls=0;for(const edit of [a=>null,a=>({...a,explicitOriginalRecovery:false}),a=>({...a,planSHA256:'f'.repeat(64)}),a=>({...a,acceptLateTelemetryRisk:false}),a=>({...a,expires:1000}),a=>({...a,expires:2000000}),a=>({...a,singlePublisher:false})])assert.throws(()=>requireGatewayRecoveryApproval(plan,edit(approval(plan)),1200));
 const p=new GatewayRecoveryPublisher({packet,accounts:{},plan,transport:{mode:'live',request:()=>calls++},journal:{},originalJournal:{}});await assert.rejects(()=>p.publish({phase:'gatewayRestorePrivacy',moduleBytes:[]}));assert.equal(calls,0);requireGatewayRecoveryApproval(plan,approval(plan),1200);
});

function logsFixture(){
 const accountId='a'.repeat(32),worker='fixture-gateway',assets={standard:'keep-assets-contract-v1',accountId,worker,hasAssets:false,bindingsSHA256:hashJSON([]),configEvidence:'NO_ASSETS',configSHA256:null};
 const p={...packet,phases:{gatewayObserve:{},gatewayRestorePrivacy:{metadataSHA256:'d'.repeat(64),modulesSHA256:'e'.repeat(64)}},preservation:{gateway:{assets}}};
 const scope={accountId,worker},a=assetPreservationEvidence({metadata:{bindings:[],keep_assets:true}}, {},{id:worker,has_assets:false},assets,scope);
 const receipt={version:'restored-v',deployment:'restored-d',resourcesSHA256:'c'.repeat(64),metadataSHA256:'d'.repeat(64),modulesSHA256:'e'.repeat(64),preservationMatches:true,pipelineGuardPassed:true,fullStateMatches:true,assets:a,coverage:Object.fromEntries(['mainModule','metadata','modules','namedResources','assets','assetsRetentionContract','containers'].map(k=>[k,true])),readObservation:{bracketVerified:true}};
 const writes=['gatewayRestorePrivacy','gatewayRestoreLogs'].map((phase,i)=>({phase,requestId:'fixture_recovery_'+i,path:'/accounts/'+accountId+'/workers/scripts/'+worker+'?bindings_inherit=strict',bodySHA256:String(i+1).repeat(64),bytes:20}));
 return {packet:p,plan:{...plan,originalPacketSHA256:hashJSON(p),accountId,worker,source:{version:'source-v',deployment:'source-d',resourcesSHA256:'c'.repeat(64)},writes},receipt};
}
test('second approved write needs complete bracketed privacy recovery, never an identity-only read',()=>{
 const f=logsFixture();assertPrivacyReconciliation({...f,receipt:f.receipt});
 for(const edit of [r=>delete r.coverage,r=>r.pipelineGuardPassed=false,r=>r.readObservation.bracketVerified=false,r=>r.metadataSHA256='f'.repeat(64),r=>r.modulesSHA256='f'.repeat(64),r=>r.resourcesSHA256='f'.repeat(64),r=>r.version=f.plan.source.version,r=>r.deployment=f.plan.source.deployment,r=>r.assets.accountId='b'.repeat(32)]){const r=structuredClone(f.receipt);edit(r);assert.throws(()=>assertPrivacyReconciliation({...f,receipt:r}));}
});
test('interrupted privacy write remains unknown; replacing its lock, adding terminal or retry intent rejects',async()=>{
 const f=logsFixture(),d=await mkdtemp(join(tmpdir(),'riffoid-interrupted-recovery-')),j=new FileJournal(d);try{
  await j.lock();const interruptedLockSHA256=(await j.lockState()).sha256,w=f.plan.writes[0];
  await j.append(w.requestId,'intent',{phase:w.phase,requestId:w.requestId,originalRequestId:f.plan.originalRequestId,planSHA256:hashJSON(f.plan),bodySHA256:w.bodySHA256,priorVersion:f.plan.source.version,priorDeployment:f.plan.source.deployment});await j.append(w.requestId,'unknown',{phase:w.phase,requestId:w.requestId,originalRequestId:f.plan.originalRequestId,automaticRetry:false,automaticLogsRestore:false});
  const args={plan:f.plan,interruptedJournal:j,interruptedLockSHA256},before=await j.records();assert.equal(await checkInterruptedRecoveryJournal(args),hashJSON(before));assert.deepEqual(await j.records(),before);
  await assert.rejects(()=>checkInterruptedRecoveryJournal({...args,interruptedLockSHA256:'f'.repeat(64)}));await j.append(w.requestId,'terminal',{});await assert.rejects(()=>checkInterruptedRecoveryJournal(args));
 }finally{await rm(d,{recursive:true,force:true});}
});
test('logs-only authorization consumes the same two-write approval and exact durable second intent; both unknowns survive',async()=>{
 const f=logsFixture(),d=await mkdtemp(join(tmpdir(),'riffoid-approved-logs-')),original=new FileJournal(join(d,'original')),interrupted=new FileJournal(join(d,'interrupted')),j=new FileJournal(join(d,'logs'));try{
  await original.lock();f.plan.originalLockSHA256=(await original.lockState()).sha256;await original.append(f.plan.originalRequestId,'intent',{phase:'gatewayObserve',requestId:f.plan.originalRequestId,packetSHA256:hashJSON(f.packet)});await original.append(f.plan.originalRequestId,'unknown',{requestId:f.plan.originalRequestId,stopFurtherTest:true,automaticLogsRestore:false});
  await interrupted.lock();const first=f.plan.writes[0];await interrupted.append(first.requestId,'intent',{phase:first.phase,requestId:first.requestId,originalRequestId:f.plan.originalRequestId,planSHA256:hashJSON(f.plan),bodySHA256:first.bodySHA256,priorVersion:f.plan.source.version,priorDeployment:f.plan.source.deployment});await interrupted.append(first.requestId,'unknown',{phase:first.phase,requestId:first.requestId,originalRequestId:f.plan.originalRequestId,automaticRetry:false,automaticLogsRestore:false});
  const now=Date.now(),a={...approval(f.plan),notBefore:now,expires:now+60000},pub=new GatewayApprovedLogsPublisher({packet:f.packet,accounts:{},plan:f.plan,privacyReadback:f.receipt,interruptedJournal:interrupted,interruptedLockSHA256:(await interrupted.lockState()).sha256,originalJournal:original,journal:j,transport:{mode:'live'},approval:a});
  pub.retainedHashes=await pub.retainedJournals();await j.lock();pub.busy=true;pub.attempted=true;const w=f.plan.writes[1];pub.pending={phase:w.phase,requestId:w.requestId};const request={accountId:f.plan.accountId,method:'PUT',path:w.path,bodySHA256:w.bodySHA256,bytes:w.bytes};await assert.rejects(()=>pub.authorizeWrite(request));
  await j.append(w.requestId,'intent',{phase:w.phase,requestId:w.requestId,originalRequestId:f.plan.originalRequestId,planSHA256:hashJSON(f.plan),bodySHA256:w.bodySHA256,priorVersion:f.receipt.version,priorDeployment:f.receipt.deployment,privacyReadbackSHA256:hashJSON(f.receipt),interruptedJournalSHA256:pub.retainedHashes.interrupted});await pub.authorizeWrite(request);
  for(const edit of [{method:'GET'},{accountId:'b'.repeat(32)},{path:first.path+'x'},{bodySHA256:first.bodySHA256},{bytes:21}])await assert.rejects(()=>pub.authorizeWrite({...request,...edit}));
  pub.approval={...a,restoreOriginalLogs:false};await assert.rejects(()=>pub.authorizeWrite(request));pub.approval=a;pub.approval.expires=now-1;await assert.rejects(()=>pub.authorizeWrite(request));pub.approval={...a,expires:now+60000};
  await j.append(w.requestId,'unknown',{});await assert.rejects(()=>pub.authorizeWrite(request));assert.equal((await original.records()).length,2);assert.equal((await interrupted.records()).length,2);assert.equal((await original.lockState()).owned,true);assert.equal((await interrupted.lockState()).owned,true);
 }finally{await rm(d,{recursive:true,force:true});}
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
