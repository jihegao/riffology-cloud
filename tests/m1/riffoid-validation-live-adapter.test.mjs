import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cloudflareTransport,jsonResult} from '../../scripts/m1/riffoid-validation-transport.mjs';
import {buildWrite,collectReadback,Publisher,FileJournal} from '../../scripts/m1/riffoid-validation-publisher.mjs';
import {preparePackage} from '../../scripts/m1/riffoid-validation-prepare.mjs';
import {writeFile} from 'node:fs/promises';
import {buildPacket,digest,initialState,advance} from '../../scripts/m1/riffoid-validation-coordinator.mjs';
import {hashJSON,hashBytes,wireMetadata,approvalRecord,restorationEligibility} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {inputFixture,moduleBytes,readbackFixture,start} from './fixtures/riffoid-offline-fixtures.mjs';
const risk=JSON.parse(await readFile(new URL('../../docs/evidence/riffoid-risk-authorization-20261010.json',import.meta.url),'utf8'));
const account='a'.repeat(32),accounts={entry:account,gateway:account};
function input(){const x=inputFixture();x.riskAuthorization=structuredClone(risk);x.preservation={};for(const w of ['entry','gateway']){x.preservation[w]={namespaces:[{id:'fixture-existing-replay'}],reads:[]};x.baselines[w].metadata.containers=[];x.baselines[w].metadata.bindings=x.baselines[w].metadata.bindings.map(b=>b.name==='ENTRY_SIGNING_PRIVATE_JWK'?{name:b.name,type:'secret_text'}:b);}return x;}
function rawJSON(d){return {status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify(d))};}
function apiFixture(p,phase,prior){
  const f=readbackFixture(p,phase,prior),calls=[];
  const transport={mode:'read-only',async request({path}){calls.push(path);let d;
    if(path.endsWith('/workers/scripts'))d={success:true,result:[{id:'fixture-gateway',has_assets:false}]};
    else if(path.endsWith('/durable_objects/namespaces'))d={success:true,result:[{id:'fixture-existing-replay'}]};
    else if(path.endsWith('/deployments'))d=f.afterDeployment;
    else if(path.endsWith('/versions'))d=f.latestVersions;
    else if(path.includes('/versions/'))d=f.version;
    else if(path.endsWith('/script-settings'))d=f.scriptSettings;
    else if(path.endsWith('/settings'))d=f.scriptAndVersionSettings;
    else{
      const boundary='fixture-readback',name=p.phases[phase].modules[0].name,b=moduleBytes(p.phases[phase])[0];
      return {status:200,mainModule:p.phases[phase].metadata.main_module,contentType:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: application/javascript+module\r\n\r\n`),b,Buffer.from(`\r\n--${boundary}--\r\n`)])};
    }return rawJSON(d);
  }};f.version.result.resources.script_runtime.containers=[];return {transport,f,calls};
}
test('approved wording is consumed without granting production authorization; altered evidence rejects',()=>{
  const p=buildPacket(input());assert.equal(p.productionAuthorized,false);assert.equal(p.decisions.restorationStandard,risk.decisions.restorationStandard.status);
  assert.equal(restorationEligibility(p,null).status,'BLOCKED_APPLICATION_RECEIPTS');
  for(const edit of [r=>r.confirmation.text='yes',r=>r.proposal.text+=' ',r=>r.decisions.unknownLogClosure.retry=true,r=>r.thisTask.productionWritesPermitted=true]){const r=structuredClone(risk);edit(r);assert.throws(()=>approvalRecord(r));}
  const s=advance(p,initialState(p),{run:p.run,type:'unknown',requestId:'original'},start);assert.equal(s.reportDueAt,start+600000);assert.equal(s.automaticLogsRestore,false);assert.throws(()=>advance(p,s,{run:p.run,type:'restoreLogs'},start+1));
});
test('default dry-run dispatches zero HTTP; read-only and prepare cannot upload',async()=>{
  let calls=0;const x=input(),p=buildPacket(x),write=buildWrite(p,'gatewayObserve',moduleBytes(p.phases.gatewayObserve),account,'original');
  const t=cloudflareTransport({authorizedFetch:async()=>{calls++;throw Error('must not send');}});const r=await t.request(write);assert.equal(r.dryRun,true);assert.equal(calls,0);
  const readonly=cloudflareTransport({mode:'read-only',authorizedFetch:async()=>{calls++;}});await assert.rejects(()=>readonly.request(write),/writes forbidden/);assert.equal(calls,0);
  const pub=new Publisher({packet:p,accounts,transport:readonly,journal:{}});await assert.rejects(()=>pub.prepare('gatewayObserve','original',moduleBytes(p.phases.gatewayObserve)));assert.equal(calls,0);
});
test('wire multipart keeps public/resources and inherits redacted Secret text without material',async()=>{
  const p=buildPacket(input()),w=buildWrite(p,'entryObserve',moduleBytes(p.phases.entryObserve),account,'original');
  const f=await new Response(w.body,{headers:{'content-type':w.contentType}}).formData();const m=JSON.parse(f.get('metadata'));
  assert.deepEqual(m.bindings.find(x=>x.name==='ENTRY_SIGNING_PRIVATE_JWK'),{name:'ENTRY_SIGNING_PRIVATE_JWK',type:'inherit',version_id:'latest'});
  for(const extra of ['text','value','key_jwk','key_base64']){const x=input();x.baselines.entry.metadata.bindings.find(b=>b.type==='secret_text')[extra]='synthetic';assert.throws(()=>buildPacket(x));}
  assert.throws(()=>wireMetadata({bindings:[{name:'secret',type:'secret_text',text:'synthetic'}]}));
});
test('raw HTTP preserves cf-entrypoint, body bytes and origin; bounds hangs and rejects redirects',async()=>{
  let observed;const t=cloudflareTransport({mode:'read-only',authorizedFetch:async(url,options)=>{observed={url,options};return new Response(new Uint8Array([0,255,10]),{headers:{'content-type':'application/octet-stream','cf-entrypoint':'index.js'}});}});
  const path=`/accounts/${account}/workers/scripts/fixture-gateway`;const r=await t.request({path});assert.deepEqual([...r.bytes],[0,255,10]);assert.equal(r.mainModule,'index.js');assert.equal(observed.url,'https://api.cloudflare.com/client/v4'+path);assert.equal(observed.options.redirect,'error');
  const hanging=cloudflareTransport({mode:'read-only',timeoutMS:10,authorizedFetch:()=>new Promise(()=>{})});await assert.rejects(()=>hanging.request({path}),/no retry/);
  const redirect=cloudflareTransport({mode:'read-only',authorizedFetch:async()=>new Response('',{status:302,headers:{location:'https://elsewhere.test'}})});await assert.rejects(()=>redirect.request({path}));
  await assert.rejects(()=>t.request({path:path+'/secrets'}));assert.throws(()=>jsonResult({status:200,contentType:'application/json',bytes:Buffer.from('{"success":false}') }));
});
test('GET-derived modules and runtime export readback work; drift/omitted cf-entrypoint reject',async()=>{
  const p=buildPacket(input()),prior={version:'gateway-v0',deployment:'gateway-d0'},f=apiFixture(p,'gatewayObserve',prior);
  const r=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway);assert.equal(r.fullStateMatches,true);assert.equal(r.quietPublisher,false);assert.equal(r.pipelineGuardPassed,false);assert.equal(r.workerLoggingGuardPassed,true);
  delete f.f.scriptAndVersionSettings.result.exports;const r2=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway);assert.equal(r2.fullStateMatches,true);assert.equal(r2.metadataSHA256,p.phases.gatewayObserve.metadataSHA256);
  f.f.version.result.resources.bindings[0].text='drift';await assert.rejects(()=>collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve));
  const g=apiFixture(p,'gatewayObserve',prior),wrapped={request:async args=>{const x=await g.transport.request(args);if(x.mainModule)delete x.mainModule;return x;}};
  await assert.rejects(()=>collectReadback(wrapped,account,'fixture-gateway',p.phases.gatewayObserve),/cf-entrypoint/);
});
test('actual asset/container readback gaps stay blocked rather than trusting upload intent',async()=>{
  const x=input();x.baselines.gateway.metadata.bindings.push({name:'ASSETS',type:'assets'});x.baselines.gateway.metadata.containers=[{class_name:'Existing',name:'existing'}];const p=buildPacket(x),f=apiFixture(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'});
  f.f.version.result.resources.script_runtime.containers=structuredClone(p.phases.gatewayObserve.metadata.containers);
  const r=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve);assert.equal(r.fullStateMatches,false);assert.equal(r.coverage.assets,false);assert.equal(r.coverage.containers,false);
});
test('durable exclusive journal is retained for unknown writes and rejects a second owner',async()=>{
  const d=await mkdtemp(join(tmpdir(),'riffoid-journal-'));try{
    const a=new FileJournal(d),b=new FileJournal(d);await a.lock();await assert.rejects(()=>b.lock());await a.append('original','intent',{bodySHA256:'a'.repeat(64)});assert.equal(await b.hasPending(),true);
    await assert.rejects(()=>a.append('original','intent',{}));assert.ok((await readdir(d)).includes('publisher.lock'));await a.append('original','terminal',{});assert.equal(await a.hasPending(),false);await a.unlock();await b.lock();await b.unlock();
  }finally{await rm(d,{recursive:true});}
});
test('version/deployment identity also binds resource snapshot hashes',()=>{
  const p=buildPacket(input()),pub=new Publisher({packet:p,accounts,transport:cloudflareTransport(),journal:{}});
  const b=p.baselineGuards.gateway,resources=[{path:`/accounts/${account}/workers/durable_objects/namespaces`,sha256:hashJSON([{id:'fixture-existing-replay'}])}];pub.checkIdentity('gateway',{...b,resourcesSHA256:hashJSON(resources)});
  assert.throws(()=>pub.checkIdentity('gateway',{...b,resourcesSHA256:hashJSON([{changed:true}])}));
  assert.throws(()=>pub.checkIdentity('gateway',{...b,version:'another-version',resourcesSHA256:hashJSON([])}));
});
test('unapproved live publication performs no HTTP; missing full preflight creates no intent or PUT',async()=>{
  const p=buildPacket(input());let calls=0;
  const pub=new Publisher({packet:p,accounts,transport:{mode:'live',request:async()=>{calls++;}},journal:{hasPending:async()=>false}});
  await assert.rejects(()=>pub.publish({phase:'gatewayObserve',requestId:'original',moduleBytes:moduleBytes(p.phases.gatewayObserve),coordinationState:initialState(p),now:start}));assert.equal(calls,0);
});
test('mutable/custom transport cannot turn prepare into a network upload',async()=>{
  const p=buildPacket(input());let calls=0;const transport={mode:'dry-run',request:async()=>{calls++;throw Error('network');}};
  const pub=new Publisher({packet:p,accounts,transport,journal:{}});const r=await pub.prepare('gatewayObserve','original',moduleBytes(p.phases.gatewayObserve));assert.equal(r.dryRun,true);assert.equal(calls,0);
  const t=cloudflareTransport({mode:'live',authorizedFetch:transport.request});assert.throws(()=>{t.mode='dry-run';});
});
test('missing Observe originals or forged terminal evidence block before any network write',async()=>{
  const p=buildPacket(input());let calls=0;const liveCapability={productionWritesPermitted:true,packetSHA256:hashJSON(p),notBefore:start-1,expires:start+400000,singlePublisher:true,resourcesCoverageEstablished:true};
  const make=()=>new Publisher({packet:p,accounts,transport:{mode:'live',request:async()=>{calls++;}},journal:{hasPending:async()=>false},liveCapability});
  const marker=make();marker.cursor=2;const state={...initialState(p),phase:'observing'};
  await assert.rejects(()=>marker.publish({phase:'entryReady',requestId:'marker',moduleBytes:moduleBytes(p.phases.entryReady),coordinationState:state,now:start+1000}));
  const restore=make();restore.cursor=4;const forged={...state,phase:'application-terminal-pending-decision',cleanup:true,requests:{A:'terminal',B:'terminal'},applicationTerminalEvidence:{}};
  await assert.rejects(()=>restore.publish({phase:'gatewayRestorePrivacy',requestId:'restore',moduleBytes:moduleBytes(p.phases.gatewayRestorePrivacy),coordinationState:forged,now:start+301000}));assert.equal(calls,0);
});
test('restart loads original unknown journal and GET reconciliation never clears it',async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-restart-'));
  try{
    const journal=new FileJournal(d);await journal.lock();const b=p.baselineGuards.gateway;await journal.append('original','intent',{packetSHA256:hashJSON(p),phase:'gatewayObserve',requestId:'original',worker:'gateway',priorVersion:b.version,priorDeployment:b.deployment,bodySHA256:'a'.repeat(64),startedAt:start-1000});
    const f=apiFixture(p,'gatewayObserve',{version:b.version,deployment:b.deployment});const pub=new Publisher({packet:p,accounts,transport:f.transport,journal});
    await pub.restoreOriginalPending('original');const r=await pub.reconcile('original');assert.equal(r.status,'READ_ONLY_ORIGINAL_WRITE_PENDING');assert.equal(pub.pending.requestId,'original');assert.equal(pub.cursor,0);assert.equal(await journal.hasPending(),true);assert.ok((await readdir(d)).includes('publisher.lock'));
    await assert.rejects(()=>pub.restoreOriginalPending('other'));await assert.rejects(()=>pub.reconcile('other'));
  }finally{await rm(d,{recursive:true});}
});
test('package CLI prepares all eight exact multipart files offline without overwriting prior packet',async()=>{
  const d=await mkdtemp(join(tmpdir(),'riffoid-prepare-'));
  try{
    const x=input();x.accounts=accounts;x.productionAuthorized=false;
    const all=[...Object.values(x.baselines),...Object.values(x.validation)];for(const p of all)for(const m of p.modules)await writeFile(join(d,m.path),moduleBytes({modules:[m]})[0]);
    const f=join(d,'input.json');await writeFile(f,JSON.stringify(x));const out=join(d,'out');const m=await preparePackage(f,out);assert.equal(m.files.length,8);assert.equal(m.networkRequestsExecuted,0);assert.equal(m.productionAuthorized,false);
    for(const row of m.files){const b=await readFile(join(out,row.phase+'.multipart'));assert.equal(hashBytes(b),row.bodySHA256);assert.equal(b.length,row.bytes);}
    await assert.rejects(()=>preparePackage(f,out));
  }finally{await rm(d,{recursive:true});}
});

test('natural expiry checkpoint survives restart and rejects missing or altered identity/time',async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-expiry-'));
  try{
    const journal=new FileJournal(d),pub=new Publisher({packet:p,accounts,transport:{mode:'read-only'},journal});
    for(const [i,phase]of ['gatewayObserve','entryObserve','entryReady'].entries()){
      const w=p.phases[phase].worker,b=pub.current[w],requestId='step_'+i,r={version:'version_'+i,deployment:'deployment_'+i,metadataSHA256:p.phases[phase].metadataSHA256,modulesSHA256:p.phases[phase].modulesSHA256,resourcesSHA256:'c'.repeat(64)};
      await journal.append(requestId,'intent',{packetSHA256:hashJSON(p),phase,requestId,worker:w,priorVersion:b.version,priorDeployment:b.deployment,startedAt:start+i});
      await journal.append(requestId,'terminal',{phase,requestId,receipt:r});pub.current[w]={...b,version:r.version,deployment:r.deployment};pub.cursor++;
    }
    await pub.skipExpiredStop({packetSHA256:hashJSON(p),phase:'stopped'},p.config.expires);
    const b=pub.current.gateway;await journal.append('restore','intent',{packetSHA256:hashJSON(p),phase:'gatewayRestorePrivacy',requestId:'restore',worker:'gateway',priorVersion:b.version,priorDeployment:b.deployment,startedAt:p.config.expires+1});
    const make=j=>new Publisher({packet:p,accounts,transport:{mode:'read-only'},journal:j});
    const loaded=make(journal);await loaded.restoreOriginalPending('restore');assert.equal(loaded.cursor,4);assert.equal(loaded.pending.requestId,'restore');assert.equal(await journal.hasPending(),true);
    const rows=await journal.records();for(const edit of [r=>r.filter(x=>!x.name.endsWith('.skip.json')),r=>{r.find(x=>x.name.endsWith('.skip.json')).value.current.gateway.version='changed';return r;},r=>{r.find(x=>x.name.endsWith('.skip.json')).value.recordedAt=p.config.expires-1;return r;}]){await assert.rejects(()=>make({records:async()=>edit(structuredClone(rows))}).restoreOriginalPending('restore'));}
  }finally{await rm(d,{recursive:true});}
});

test('resource read drift is bracketed by final deployment and latest-version checks',async()=>{
  for(const change of ['deployment','latest']){
    const p=buildPacket(input()),prior={version:'gateway-v0',deployment:'gateway-d0'},f=apiFixture(p,'gatewayObserve',prior);let resourceRead=false;
    const transport={request:async args=>{const r=await f.transport.request(args);if(args.path.endsWith('/workers/scripts'))resourceRead=true;if(resourceRead&&args.path.endsWith('/deployments')&&change==='deployment')return rawJSON({...f.f.afterDeployment,result:{deployments:[{...f.f.afterDeployment.result.deployments[0],id:'changed-after-resource'}]}});if(resourceRead&&args.path.endsWith('/versions')&&change==='latest')return rawJSON({...f.f.latestVersions,result:{items:[{id:'changed-latest'}]}});return r;}};
    await assert.rejects(()=>collectReadback(transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/changed during resource|source changed/);
  }
});
