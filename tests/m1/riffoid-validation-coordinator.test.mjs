import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {buildPacket,initialState,advance,digest,verifyCodeReferences} from '../../scripts/m1/riffoid-validation-coordinator.mjs';
import {stateMetadata,expectedBody,protocolTerminalEvidence} from '../../scripts/m1/riffoid-validation-evidence.mjs';

const start=2_000_000_000_000,run='offline_fixture_fixed_run_20261009';
function fixture(){
  const module=name=>({name,path:name,bytes:1,sha256:'a'.repeat(64)});
  const metadata=(worker)=>({main_module:worker+'.mjs',compatibility_date:'2026-09-06',compatibility_flags:['global_fetch_strictly_public'],
    observability:{enabled:true,logs:{enabled:true,persist:true,invocation_logs:true},traces:{enabled:false,persist:false}},
    bindings:[{name:'APP_ORIGIN',type:'plain_text',text:worker==='entry'?'https://app.riffoid.com':'https://old.example.test'},
      {name:'TWO_ACCOUNT_AUTH_MODE',type:'plain_text',text:'disabled'},
      {name:'ENTRY_SIGNING_PRIVATE_JWK',type:'secret_key',algorithm:{name:'Ed25519'},format:'jwk',usages:['sign']},
      {name:'ENTRY_REPLAY',type:'durable_object_namespace',namespace_id:'fixture-existing-replay'}],
    exports:worker==='gateway'?{EntryReplayGuard:{type:'durable_object',storage:'sqlite'},Existing:{type:'durable_object',storage:'sqlite'}}:{},
    containers:[{name:'fixture-existing-container'}],keep_assets:true,logpush:false,tail_consumers:[]});
  const baseline=worker=>({worker:'fixture-'+worker,version:worker+'-v0',deployment:worker+'-d0',snapshotSHA256:'b'.repeat(64),metadata:metadata(worker),modules:[module(worker+'.mjs')]});
  const baselines={entry:baseline('entry'),gateway:baseline('gateway')};
  return {preservation:Object.fromEntries(['entry','gateway'].map(w=>[w,{assets:{standard:'keep-assets-contract-v1',accountId:'a'.repeat(32),worker:baselines[w].worker,hasAssets:false,bindingsSHA256:digest([]),configEvidence:'NO_ASSETS',configSHA256:null}}])),config:{version:1,run,notBefore:start,expires:start+300000,ips:{A:'198.51.100.23',B:'198.51.100.24'}},baselines,
    validation:{entry:{main_module:'entry-validation.mjs',modules:[module('entry-validation.mjs')]},
      gateway:{main_module:'gateway-validation.mjs',exports:baselines.gateway.metadata.exports,modules:[module('gateway-validation.mjs')]}}};
}
function receipt(packet,state,phase,at=state.lastEventAt??start-1000){
  const p=packet.phases[phase],worker=p.worker,prior=state.versions[worker]??packet.baselineGuards[worker];
  return {phase,run,worker:packet.baselineGuards[worker].worker,priorVersion:prior.version,priorDeployment:prior.deployment,
    version:phase+'-fixture-version',activeVersion:phase+'-fixture-version',latestVersion:phase+'-fixture-version',deployment:phase+'-fixture-deployment',requestId:phase+'-fixture-request',
    metadataSHA256:p.metadataSHA256,modulesSHA256:p.modulesSHA256,startedAt:at,readbackAt:at,fullStateMatches:true,preservationMatches:true,coverage:{mainModule:true,metadata:true,modules:true,namedResources:true,assets:true,assetsRetentionContract:true,containers:true},assets:{standard:'keep-assets-contract-v1',accountId:'a'.repeat(32),worker:packet.baselineGuards[p.worker].worker,hasAssets:false,bindingsSHA256:digest([]),configEvidence:'NO_ASSETS',configSHA256:null,keepAssetsRequested:true,explicitAssetsUploadForbidden:true,associationConfigMatches:true,assetContractAccepted:true,assetConfigReadbackVerified:false,configUpdateClaim:'NO_CONFIG_UPDATE_REQUESTED',assetBytesAudited:false,assetSetIdentityVerified:false,contentInventoryAudited:false,contentSHA256:null,coverageComplete:true},quietPublisher:true,pipelineGuardPassed:true};
}
function event(type,fields={}){return {type,run,...fields};}
function published(packet,state,type,phases,now){return advance(packet,state,event(type,{receipts:phases.map(p=>receipt(packet,state,p,now))}),now);}
function observing(packet){return published(packet,initialState(packet),'observationPublished',['gatewayObserve','entryObserve'],start-1000);}
function protocolReceipt(slot,operation,startedAt,receivedAt){return {requestId:'fixture-'+slot+'-'+operation,run,slot,operation,startedAt,receivedAt,outcome:'response',response:{status:200,body:JSON.stringify(expectedBody(slot,operation))}};}
function observed(packet,state,slot,now=start+1000){return advance(packet,state,event('observed',{slot,case:'observe',passed:true,nativeIpMatches:true,configSHA256:packet.configSHA256,protocolReceipt:protocolReceipt(slot,'observe',now,now)}),now);}
function ready(packet){let s=observing(packet);s=observed(packet,s,'A');s=observed(packet,s,'B');return published(packet,s,'markerPublished',['entryReady'],start+5000);}
function runResult(slot){return event('runReceipt',{slot,startedAt:start+10000,passed:true,nativeIpMatches:true,protocolReceipt:protocolReceipt(slot,'run',start+10000,start+(slot==='A'?45000:12000)),
  sameSignedInputsReplay:slot==='A',realUnusedProofExpiry:slot==='A',
  results:(slot==='A'?[['begin',200,'accepted'],['primary',200,'accepted'],['replay',403,'entry_replay_denied'],['expired',403,'entry_proof_denied']]:[['begin',200,'accepted'],['primary',200,'accepted']]).map(([caseName,status,code])=>({case:caseName,status,code,...(caseName==='primary'?{ipMatches:true}:{})}))});}
function cleanup(packet,state){return advance(packet,state,event('cleanupReceipt',{case:'cleanup',passed:true,removed:2,logsPersist:false,protocolReceipt:protocolReceipt('A','cleanup',packet.config.expires+1,packet.config.expires+1000)}),packet.config.expires+1000);}
function terminal(packet,state){return advance(packet,state,event('applicationTerminalReceipt',{evidence:protocolTerminalEvidence(packet,state.protocolReceipts,state)}),packet.config.expires+2000);}

test('all stages carry complete metadata/module manifests, preserve Secret references/resources, and do not mutate baselines',()=>{
  const input=fixture(),before=structuredClone(input),p=buildPacket(input);
  assert.deepEqual(input,before);
  assert.deepEqual(p.budgets,{freshProofs:3,primaryAccepts:2,verifierCalls:4,observes:2,begins:2,normalOutgoingHTTPS:8,optionalCleanupHTTPS:1,windowMS:300000,cleanupMS:30000});
  const bindings=id=>p.phases[id].metadata.bindings;
  assert.ok(!bindings('entryObserve').some(b=>b.name==='ENTRY_NATIVE_IP_BOUNDARY'));
  assert.ok(bindings('entryReady').some(b=>b.name==='ENTRY_NATIVE_IP_BOUNDARY'));
  assert.ok(!bindings('entryStop').some(b=>b.name==='ENTRY_NATIVE_IP_BOUNDARY'));
  assert.ok(bindings('entryStop').some(b=>b.name==='RIFFOID_VALIDATION_CONFIG_JSON'),'stop preserves cleanup channel');
  for(const [id,phase]of Object.entries(p.phases)){
    const original=input.baselines[phase.worker].metadata;
    for(const field of ['exports','containers','tail_consumers','compatibility_flags'])assert.deepEqual(phase.metadata[field],original[field]);
    assert.deepEqual(phase.metadata.bindings.find(b=>b.type==='secret_key'),original.bindings.find(b=>b.type==='secret_key'));
    assert.deepEqual(phase.metadata.bindings.find(b=>b.name==='ENTRY_REPLAY'),original.bindings.find(b=>b.name==='ENTRY_REPLAY'));
    assert.equal(phase.metadata.observability.logs.persist,id.endsWith('RestoreLogs'));
    assert.equal(phase.metadataSHA256,digest(stateMetadata(phase.metadata)));
  }
  for(const worker of ['entry','gateway'])assert.deepEqual(p.phases[worker+'RestoreLogs'].metadata,input.baselines[worker].metadata);
});

test('fixed maximum and baseline drift/Secret plaintext/incomplete modules are rejected',()=>{
  for(const change of [x=>x.config.expires++,x=>x.config.expires--,
    x=>x.validation.gateway.exports={},x=>x.baselines.entry.metadata.bindings.push({name:'leak',type:'secret_text',text:'fixture-only'}),
    x=>x.baselines.entry.metadata.bindings[2].text='fixture-only',x=>x.validation.entry.modules=[],
    x=>delete x.baselines.gateway.metadata.keep_assets,x=>x.validation.entry.modules[0].contents='inline material']){
    const x=fixture();change(x);assert.throws(()=>buildPacket(x));
  }
});

test('changing frozen time or metadata cannot silently continue the same coordination journal',()=>{
  const p=buildPacket(fixture()),state=initialState(p);p.config.expires++;
  assert.throws(()=>advance(p,state,event('unknown',{requestId:'fixture-original'}),start));
  const other=buildPacket(fixture());other.phases.entryReady.metadata.bindings.pop();
  assert.throws(()=>advance(other,state,event('unknown',{requestId:'fixture-original'}),start));
});

test('full fixture proves scoped application terminal state but pending user decisions block all restoration',()=>{
  const p=buildPacket(fixture());let s=ready(p);
  s=advance(p,s,event('operatorCue'),start+9000);
  s=advance(p,s,runResult('B'),start+12000);s=advance(p,s,runResult('A'),start+45000);
  assert.throws(()=>advance(p,s,runResult('A'),start+46000),'no second run');
  s=advance(p,s,event('stop'),p.config.expires);
  assert.equal(s.applicationTerminalEvidence,null);assert.equal(s.cleanup,false);assert.equal(s.phase,'stopped');
  s=cleanup(p,s);s=terminal(p,s);
  assert.throws(()=>published(p,s,'restorePrivacy',['gatewayRestorePrivacy','entryRestorePrivacy'],p.config.expires+3000),/BLOCKED_USER_DECISION/);
  assert.throws(()=>published(p,s,'restoreLogs',['gatewayRestoreLogs','entryRestoreLogs'],p.config.expires+4000),/BLOCKED_USER_DECISION/);
  assert.equal(s.phase,'application-terminal-pending-decision');assert.equal(s.run,run);
  assert.equal(s.markerAt,start+5000);assert.equal(s.cueAt,start+9000);
  assert.equal(s.cleanupAt,p.config.expires+1000);assert.equal(s.applicationTerminalEvidence.completedAt,s.cleanupAt);
  assert.equal(s.restoration.productionAuthorized,false);assert.equal('drain'in s,false);assert.equal('runtimeReleased'in s,false);
  assert.equal(s.lastEventAt,p.config.expires+2000);
});

test('both observes and timely independently matched marker readback are required; waiting in chat does not extend the window',()=>{
  const p=buildPacket(fixture());let s=observing(p);s=observed(p,s,'A');
  assert.throws(()=>published(p,s,'markerPublished',['entryReady'],start+5000));
  s=observed(p,s,'B');assert.throws(()=>published(p,s,'markerPublished',['entryReady'],p.schedule.markerReadbackDeadline));
  s=published(p,s,'markerPublished',['entryReady'],start+5000);
  assert.throws(()=>advance(p,s,event('operatorCue'),p.schedule.operatorCueDeadline));
  const stopped=advance(p,s,event('stop',{receipts:[receipt(p,s,'entryStop')]}),p.schedule.operatorCueDeadline);
  assert.equal(stopped.phase,'stopped');assert.equal(p.config.expires,start+300000);
  assert.throws(()=>advance(p,stopped,event('operatorCue'),start+250000));
});

test('duplicate accepted begin codes cannot substitute for a verified primary receipt',()=>{
  const p=buildPacket(fixture()),s=advance(p,ready(p),event('operatorCue'),start+9000);
  const wrong=runResult('B');wrong.results[1].case='begin';
  assert.throws(()=>advance(p,s,wrong,start+12000));
  const unmatched=runResult('B');unmatched.results[1].ipMatches=false;
  assert.throws(()=>advance(p,s,unmatched,start+12000));
});

test('P2 time order: backdated Run, cleanup and terminal events cannot precede cue or actual completion',()=>{
  const p=buildPacket(fixture());let s=advance(p,ready(p),event('operatorCue'),start+9000);
  for(const at of [start+4000,start+8000]){
    const early=runResult('B');early.startedAt=at;assert.throws(()=>advance(p,s,early,start+12000));
  }
  s=advance(p,s,runResult('B'),start+12000);s=advance(p,s,runResult('A'),start+45000);
  s=advance(p,s,event('stop'),p.config.expires);s=cleanup(p,s);
  assert.throws(()=>advance(p,s,event('applicationTerminalReceipt',{evidence:protocolTerminalEvidence(p,s.protocolReceipts,s)}),p.config.expires-1));
  const invalid=structuredClone(s.protocolReceipts);invalid.find(r=>r.operation==='cleanup').startedAt=p.config.expires-1;
  assert.throws(()=>protocolTerminalEvidence(p,invalid,s));
  assert.throws(()=>published(p,s,'restorePrivacy',['gatewayRestorePrivacy','entryRestorePrivacy'],p.config.expires+3000));
});

test('P2 identity binding: baseline/seen versions cannot change content and deployments cannot change version',()=>{
  const p=buildPacket(fixture()),initial=initialState(p);
  const unchangedIdentity=['gatewayObserve','entryObserve'].map(id=>receipt(p,initial,id,start-1000));
  const target=unchangedIdentity[1],base=p.baselineGuards.entry;
  target.version=base.version;target.activeVersion=base.version;target.latestVersion=base.version;
  assert.throws(()=>advance(p,initial,event('observationPublished',{receipts:unchangedIdentity}),start-1000),'baseline version now claims new code/config');
  const unchangedDeployment=['gatewayObserve','entryObserve'].map(id=>receipt(p,initial,id,start-1000));
  unchangedDeployment[0].deployment=p.baselineGuards.gateway.deployment;
  assert.throws(()=>advance(p,initial,event('observationPublished',{receipts:unchangedDeployment}),start-1000),'baseline deployment now claims another version');
  let s=observing(p);s=observed(p,s,'A');s=observed(p,s,'B');
  const oldVersion=receipt(p,s,'entryReady',start+5000);
  oldVersion.version=s.versions.entry.version;oldVersion.activeVersion=oldVersion.version;oldVersion.latestVersion=oldVersion.version;
  assert.throws(()=>advance(p,s,event('markerPublished',{receipts:[oldVersion]}),start+5000),'seen observation version now claims marker metadata');
  const oldDeployment=receipt(p,s,'entryReady',start+5000);oldDeployment.deployment=s.versions.entry.deployment;
  assert.throws(()=>advance(p,s,event('markerPublished',{receipts:[oldDeployment]}),start+5000),'seen deployment cannot bind the marker version');
});

test('P2 ordered readback: a later delivery cannot hide a future or out-of-order publication/readback',()=>{
  const p=buildPacket(fixture()),s=initialState(p);
  const future=['gatewayObserve','entryObserve'].map(id=>receipt(p,s,id,start));
  future[1].readbackAt=start+1;
  assert.throws(()=>advance(p,s,event('observationPublished',{receipts:future}),start));
  const outOfOrder=['gatewayObserve','entryObserve'].map(id=>receipt(p,s,id,start));
  outOfOrder[0].startedAt=start-100;outOfOrder[0].readbackAt=start;
  outOfOrder[1].startedAt=start-1;
  assert.throws(()=>advance(p,s,event('observationPublished',{receipts:outOfOrder}),start));
  const backwards=observed(p,observing(p),'A',start+2000);
  assert.throws(()=>observed(p,backwards,'B',start+1000));
  assert.throws(()=>advance(p,backwards,event('unknown',{requestId:'fixture-original'}),start+1000));
});

test('P2 consistent identity reuse: a known version with unchanged content accepts a new deployment binding',()=>{
  const p=buildPacket(fixture()),s=ready(p);
  const stop=receipt(p,s,'entryStop',start+6000);
  stop.version='entryObserve-fixture-version';stop.activeVersion=stop.version;stop.latestVersion=stop.version;
  const stopped=advance(p,s,event('stop',{receipts:[stop]}),start+6000);
  assert.equal(stopped.phase,'stopped');assert.equal(stopped.versions.entry.version,stop.version);
  assert.equal(stopped.identities.entry.versions.filter(v=>v.version===stop.version).length,1);
  assert.equal(stopped.identities.entry.deployments.find(d=>d.deployment===stop.deployment).version,stop.version);
});

test('early failure removes marker but retains cleanup route; expiration/partial/unknown drain cannot unlock restoration',()=>{
  const p=buildPacket(fixture()),r=ready(p);
  const s=advance(p,r,event('stop',{receipts:[receipt(p,r,'entryStop')]}),start+6000);
  assert.equal(s.phase,'stopped');
  assert.throws(()=>published(p,s,'restorePrivacy',['gatewayRestorePrivacy','entryRestorePrivacy'],p.config.expires+1000));
  assert.throws(()=>advance(p,s,event('cleanupReceipt',{case:'cleanup',passed:true,removed:2,logsPersist:false}),p.config.expires-1));
  assert.throws(()=>advance(p,s,event('cleanupReceipt',{case:'cleanup',passed:true,removed:2,logsPersist:false}),p.config.expires+30000));
  const c=cleanup(p,s);
  assert.throws(()=>advance(p,c,event('drainReceipt',{authority:'deadline',allOriginalRequestsTerminal:true,validationInvocationsActive:0,unknownInvocations:0,runtimeReleased:true,versions:c.versions,observedAt:p.config.expires+2000}),p.config.expires+2000));
  assert.throws(()=>advance(p,c,event('drainReceipt',{authority:'approved-read-only-inventory',allOriginalRequestsTerminal:true,validationInvocationsActive:0,unknownInvocations:1,runtimeReleased:true,versions:c.versions,observedAt:p.config.expires+2000}),p.config.expires+2000));
  assert.throws(()=>published(p,c,'restoreLogs',['gatewayRestoreLogs','entryRestoreLogs'],p.config.expires+3000));
});

test('unknown write/cleanup receipts freeze original request identity and forbid retries or restoration',()=>{
  const p=buildPacket(fixture()),s=advance(p,ready(p),event('unknown',{requestId:'fixture-original-request'}),start+6000);
  assert.equal(s.phase,'pending-unknown');assert.equal(s.unknownRequestId,'fixture-original-request');
  assert.throws(()=>advance(p,s,event('operatorCue'),start+7000));
  assert.throws(()=>advance(p,s,event('stop'),p.config.expires));
  assert.throws(()=>published(p,s,'restoreLogs',['gatewayRestoreLogs','entryRestoreLogs'],p.config.expires+4000));
});

test('stale publisher/readback mismatch rejects atomically without changing the previous state',()=>{
  const p=buildPacket(fixture()),s=initialState(p),before=structuredClone(s);
  const receipts=['gatewayObserve','entryObserve'].map(id=>receipt(p,s,id));receipts[1].priorVersion='fixture-drift';
  assert.throws(()=>advance(p,s,event('observationPublished',{receipts}),start));assert.deepEqual(s,before);
  receipts[1].priorVersion=p.baselineGuards.entry.version;receipts[1].pipelineGuardPassed=false;
  assert.throws(()=>advance(p,s,event('observationPublished',{receipts}),start));assert.deepEqual(s,before);
});

test('offline module byte/hash verification detects source drift with no network',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'riffoid-offline-packet-fixture-'));
  try{
    const input=fixture();
    for(const m of [...Object.values(input.baselines).flatMap(b=>b.modules),...Object.values(input.validation).flatMap(b=>b.modules)]){
      const bytes=Buffer.from('export default {};\n');m.bytes=bytes.length;m.sha256=createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(dir,m.path),bytes);
    }
    buildPacket(input);await verifyCodeReferences(input,join(dir,'input.json'));
    const inputPath=join(dir,'input.json');await writeFile(inputPath,JSON.stringify(input));
    const cli='scripts/m1/riffoid-validation-coordinator.mjs';
    const built=spawnSync(process.execPath,[cli,inputPath],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
    assert.equal(JSON.parse(built.stdout).status,'OFFLINE_REVIEW_PACKET_NOT_AUTHORIZED_FOR_UPLOAD');
    const journal=join(dir,'journal.json');await writeFile(journal,'[]');
    const audited=spawnSync(process.execPath,[cli,'--audit',inputPath,journal],{encoding:'utf8'});assert.equal(audited.status,0,audited.stderr);
    const audit=JSON.parse(audited.stdout);assert.equal(audit.productionActionsExecuted,0);assert.equal(audit.state.phase,'frozen');
    await writeFile(join(dir,input.validation.entry.modules[0].path),'changed fixture');
    await assert.rejects(()=>verifyCodeReferences(input,join(dir,'input.json')));
    const rejected=spawnSync(process.execPath,[cli,inputPath],{encoding:'utf8'});assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');
  }finally{await rm(dir,{recursive:true,force:true});}
});


test('coordinator refuses claimed preservation with inconsistent contract/coverage and never confuses byte audit',()=>{
  const p=buildPacket(fixture()),state=initialState(p);
  for(const edit of [r=>delete r.coverage,r=>r.coverage.assetsRetentionContract=false,r=>r.assets.assetBytesAudited=true,r=>r.assets.hasAssets=true,r=>r.fullStateMatches=false]){
    const rows=['gatewayObserve','entryObserve'].map(x=>receipt(p,state,x));edit(rows[0]);assert.throws(()=>advance(p,state,event('observationPublished',{receipts:rows}),start));
  }
});
