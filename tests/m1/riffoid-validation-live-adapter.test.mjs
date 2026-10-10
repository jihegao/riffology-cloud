import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cloudflareTransport,jsonResult} from '../../scripts/m1/riffoid-validation-transport.mjs';
import {assetSnapshot} from '../../scripts/m1/riffoid-validation-resources.mjs';
import {buildWrite,collectReadback,Publisher,FileJournal,publicationPhases} from '../../scripts/m1/riffoid-validation-publisher.mjs';
import {preparePackage} from '../../scripts/m1/riffoid-validation-prepare.mjs';
import {writeFile} from 'node:fs/promises';
import {buildPacket,digest,initialState,advance} from '../../scripts/m1/riffoid-validation-coordinator.mjs';
import {hashJSON,hashBytes,stateMetadata,wireMetadata,approvalRecord,restorationEligibility} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {inputFixture,moduleBytes,readbackFixture,start} from './fixtures/riffoid-offline-fixtures.mjs';
const risk=JSON.parse(await readFile(new URL('../../docs/evidence/riffoid-risk-authorization-20261010.json',import.meta.url),'utf8'));
const account='a'.repeat(32),accounts={entry:account,gateway:account};
function input(){const x=inputFixture();x.riskAuthorization=structuredClone(risk);const assetDefaults=x.preservation;x.preservation={};for(const w of ['entry','gateway']){x.preservation[w]={assets:assetDefaults[w].assets,namespaces:[{id:'fixture-existing-replay'}],reads:[]};x.baselines[w].metadata.containers=[];x.baselines[w].metadata.bindings=x.baselines[w].metadata.bindings.map(b=>b.name==='ENTRY_SIGNING_PRIVATE_JWK'?{name:b.name,type:'secret_text'}:b);}return x;}
function rawJSON(d){return {status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify(d))};}
function apiFixture(p,phase,prior){
  const f=readbackFixture(p,phase,prior),calls=[];
  const transport={mode:'read-only',async request({path}){calls.push(path);let d;
    if(path.endsWith('/workers/scripts'))d={success:true,result:[{id:p.baselineGuards[p.phases[phase].worker].worker,has_assets:false}]};
    else if(path.includes('/durable_objects/namespaces?'))d={success:true,result:[{id:'fixture-existing-replay'}]};
    else if(path.endsWith('/deployments'))d=f.afterDeployment;
    else if(path.endsWith('/versions'))d=f.latestVersions;
    else if(path.includes('/versions/'))d=f.version;
    else if(path.endsWith('/script-settings'))d=f.scriptSettings;
    else if(path.endsWith('/settings'))d=f.scriptAndVersionSettings;
    else{
      const boundary='fixture-readback',name=p.phases[phase].modules[0].name,b=moduleBytes(p.phases[phase])[0];
      return {status:200,mainModule:p.phases[phase].metadata.main_module,contentType:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: application/javascript+module\r\n\r\n`),b,Buffer.from(`\r\n--${boundary}--\r\n`)])};
    }return rawJSON(d);
  }};f.version.result.resources.script_runtime.containers=[];return {transport,f,calls};
}
test('approved wording is consumed without granting production authorization; altered evidence rejects',()=>{
  const p=buildPacket(input());assert.equal(p.productionAuthorized,false);assert.equal(p.decisions.restorationStandard,risk.decisions.restorationStandard.status);
  assert.equal(restorationEligibility(p,null).status,'BLOCKED_APPLICATION_RECEIPTS');
  for(const edit of [r=>r.confirmation.text='yes',r=>r.proposal.text+=' ',r=>r.decisions.unknownLogClosure.retry=true,r=>r.thisTask.productionWritesPermitted=true]){const r=structuredClone(risk);edit(r);assert.throws(()=>approvalRecord(r));}
  const s=advance(p,initialState(p),{run:p.run,type:'unknown',requestId:'original'},start);assert.equal(s.reportDueAt,start+600000);assert.equal(s.automaticLogsRestore,false);assert.throws(()=>advance(p,s,{run:p.run,type:'restoreLogs'},start+1));
});
test('publisher read-budget opt-in remains bounded and does not arm publication',()=>{
  const p=buildPacket(input());let dispatches=0;const args={packet:p,accounts,transport:{mode:'read-only',request:()=>dispatches++},journal:{}};
  const pub=new Publisher({...args,readBudget:{timeoutMS:180000,maxGETDispatches:128}});assert.equal(pub.liveCapability,null);assert.equal(dispatches,0);
  for(const readBudget of [{timeoutMS:180001},{timeoutMS:0},{timeoutMS:NaN},{maxGETDispatches:257},{perGETTimeoutMS:30001},{automaticRetries:1}])assert.throws(()=>new Publisher({...args,readBudget}));assert.equal(dispatches,0);
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
  const path=`/accounts/${account}/workers/scripts/fixture-gateway`;const r=await t.request({path});assert.deepEqual([...r.bytes],[0,255,10]);assert.equal(r.mainModule,'index.js');assert.equal(observed.url,'https://api.cloudflare.com/client/v4'+path);assert.equal(observed.options.redirect,'manual');
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
test('runtime omission proves no container association only with no DO bindings or container exports',async()=>{
  const x=input();x.baselines.entry.metadata.bindings=x.baselines.entry.metadata.bindings.filter(b=>b.type!=='durable_object_namespace');delete x.baselines.entry.metadata.containers;x.preservation.entry.containerSnapshots=[];delete x.preservation.entry.namespaces;
  const p=buildPacket(x),f=apiFixture(p,'entryObserve',p.baselineGuards.entry);delete f.f.version.result.resources.script_runtime.containers;
  const r=await collectReadback(f.transport,account,'fixture-entry',p.phases.entryObserve,p.preservation.entry);assert.equal(r.preservationMatches,true);assert.equal(r.containers.absenceEvidence,'NO_DO_BINDINGS_AND_NO_RUNTIME_OR_EXPORT_ASSOCIATIONS');const pub=new Publisher({packet:p,accounts,transport:f.transport,journal:{}});assert.equal(pub.registry.entry.versions.get(p.baselineGuards.entry.version)[2],r.resourcesSHA256);
  const g=apiFixture(p,'entryObserve',p.baselineGuards.entry);delete g.f.version.result.resources.script_runtime.containers;g.f.version.result.resources.script_runtime.exports={Unexpected:{container:'unknown'}};await assert.rejects(()=>collectReadback(g.transport,account,'fixture-entry',p.phases.entryObserve,p.preservation.entry));
  const q=buildPacket(input()),h=apiFixture(q,'gatewayObserve',q.baselineGuards.gateway);delete h.f.version.result.resources.script_runtime.containers;
  const unknown=await collectReadback(h.transport,account,'fixture-gateway',q.phases.gatewayObserve,q.preservation.gateway);assert.equal(unknown.coverage.containers,false);assert.equal(unknown.preservationMatches,false);
});
test('actual null script tails match explicit empty version tails while raw representation stays bracketed',async()=>{
  const p=buildPacket(input()),prior=p.baselineGuards.gateway;
  const f=apiFixture(p,'gatewayObserve',prior);f.f.scriptSettings.result.tail_consumers=null;
  const r=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway);
  assert.equal(r.scriptTailConsumersRepresentation,'null');assert.equal(r.scriptSettingsSHA256,hashJSON(f.f.scriptSettings.result));
  for(const value of [undefined,'empty',[{service:'unexpected'}]]){const g=apiFixture(p,'gatewayObserve',prior);g.f.scriptSettings.result.tail_consumers=value;await assert.rejects(()=>collectReadback(g.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway));}
  const g=apiFixture(p,'gatewayObserve',prior);let reads=0;const t={request:async args=>{const raw=await g.transport.request(args);if(args.path.endsWith('/script-settings')){const d=JSON.parse(raw.bytes);d.result.tail_consumers=reads++===0?null:[];return rawJSON(d);}return raw;}};
  await assert.rejects(()=>collectReadback(t,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/global settings changed/);
});
test('readback GET dispatch budget stops before another request and reports only caller observations',async()=>{
  const p=buildPacket(input()),f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);
  await assert.rejects(()=>collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway,{maxGETDispatches:1}),/dispatch budget/);assert.equal(f.calls.length,1);
  f.calls.length=0;const r=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway);
  assert.equal(r.readObservation.callerGETDispatches,f.calls.length);assert.equal(r.readObservation.proxyHTTPAttempts,'NOT_EXPOSED');assert.equal(r.readObservation.snapshotAtomic,false);assert.equal(r.readObservation.bracketVerified,true);assert.ok(r.readObservation.elapsedMS<r.readObservation.timeoutMS);
});
test('late host GET result is rejected without further dispatch or proxy-termination claim',async()=>{
  const p=buildPacket(input()),f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);let calls=0;
  const transport={request:async args=>{calls++;await new Promise(resolve=>setTimeout(resolve,40));return f.transport.request(args);}};
  await assert.rejects(()=>collectReadback(transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway,{timeoutMS:10}),/late evidence rejected; proxy termination unconfirmed/);assert.equal(calls,1);
});
test('a delayed timer cannot admit a host GET arriving beyond the single-invocation deadline',async()=>{
  const original=Object.getOwnPropertyDescriptor(performance,'now');let clock=0,calls=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
  try{
    const p=buildPacket(input()),f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);
    const transport={request:async args=>{calls++;clock+=16001;return f.transport.request(args);}};
    await assert.rejects(()=>collectReadback(transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/per-GET budget expired/);assert.equal(calls,1);
  }finally{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;}
});
test('explicit longer GET stays under the whole budget; default 15s and the hard 30s cap remain',{timeout:1000},async()=>{
 const original=Object.getOwnPropertyDescriptor(performance,'now');let clock=0;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
 try{const p=buildPacket(input());
  const make=()=>{const f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);let calls=0;return {request:async args=>{if(calls++===0)clock+=20000;return f.transport.request(args);}};};
  await assert.rejects(()=>collectReadback(make(),account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/per-GET budget/);
  clock=0;const r=await collectReadback(make(),account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway,{timeoutMS:120000,perGETTimeoutMS:30000});assert.equal(r.readObservation.perGETTimeoutMS,30000);assert.equal(r.readObservation.elapsedMS,20000);
  await assert.rejects(()=>collectReadback(make(),account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway,{perGETTimeoutMS:30001}));
 }finally{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;}
});
test('contradictory asset presence rejects rather than trusting upload intent',async()=>{
  const {x}=assetInput();const p=buildPacket(x),f=apiFixture(p,'gatewayObserve',{version:'gateway-v0',deployment:'gateway-d0'});
  await assert.rejects(()=>collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve),/asset binding without assets/);
});

test('durable exclusive journal is retained for unknown writes and rejects a second owner',async()=>{
  const d=await mkdtemp(join(tmpdir(),'riffoid-journal-'));try{
    const a=new FileJournal(d),b=new FileJournal(d);await a.lock();await assert.rejects(()=>b.lock());await a.append('original','intent',{bodySHA256:'a'.repeat(64)});assert.equal(await b.hasPending(),true);
    await assert.rejects(()=>a.append('original','intent',{}));assert.ok((await readdir(d)).includes('publisher.lock'));await a.append('original','terminal',{});assert.equal(await a.hasPending(),false);await a.unlock();await b.lock();await b.unlock();
  }finally{await rm(d,{recursive:true});}
});
test('version/deployment identity also binds resource snapshot hashes',()=>{
  const p=buildPacket(input()),pub=new Publisher({packet:p,accounts,transport:cloudflareTransport(),journal:{}});
  const b=p.baselineGuards.gateway;pub.checkIdentity('gateway',{...b,resourcesSHA256:pub.registry.gateway.versions.get(b.version)[2]});
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
      const w=p.phases[phase].worker,b=pub.current[w],requestId='step_'+i,derived=await collectReadback(apiFixture(p,phase,b).transport,account,b.worker,p.phases[phase],p.preservation[w]),r={...derived,version:'version_'+i,deployment:'deployment_'+i,metadataSHA256:p.phases[phase].metadataSHA256,modulesSHA256:p.phases[phase].modulesSHA256,resourcesSHA256:pub.registry[w].versions.get(b.version)[2],fullStateMatches:true,preservationMatches:true,pipelineGuardPassed:true};
      await journal.append(requestId,'intent',{packetSHA256:hashJSON(p),phase,requestId,worker:w,priorVersion:b.version,priorDeployment:b.deployment,bodySHA256:'a'.repeat(64),startedAt:start+i});
      await journal.append(requestId,'terminal',{phase,requestId,receipt:r,ackScript:b.worker,observedVersion:r.version,readbackAt:start+i+1});pub.current[w]={...b,version:r.version,deployment:r.deployment};pub.registry[w].versions.set(r.version,[r.metadataSHA256,r.modulesSHA256,r.resourcesSHA256]);pub.registry[w].deployments.set(r.deployment,r.version);pub.cursor++;
    }
    await pub.skipExpiredStop({packetSHA256:hashJSON(p),phase:'stopped'},p.config.expires);
    const b=pub.current.gateway;await journal.append('restore','intent',{packetSHA256:hashJSON(p),phase:'gatewayRestorePrivacy',requestId:'restore',worker:'gateway',priorVersion:b.version,priorDeployment:b.deployment,bodySHA256:'a'.repeat(64),startedAt:p.config.expires+1});
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

async function completedJournal(p,journal,count){
  const pub=new Publisher({packet:p,accounts,transport:{mode:'read-only'},journal});
  for(const [i,phase]of publicationPhases.slice(0,count).entries()){
    const w=p.phases[phase].worker,prior=pub.current[w],requestId='completed_'+i,f=apiFixture(p,phase,prior),r=await collectReadback(f.transport,account,prior.worker,p.phases[phase],p.preservation[w]);r.pipelineGuardPassed=true;
    await journal.append(requestId,'intent',{packetSHA256:hashJSON(p),phase,requestId,worker:w,priorVersion:prior.version,priorDeployment:prior.deployment,bodySHA256:'a'.repeat(64),startedAt:start+i});
    await journal.append(requestId,'terminal',{phase,requestId,receipt:r,ackScript:prior.worker,observedVersion:r.version,readbackAt:start+i+1});
    pub.current[w]={...prior,version:r.version,deployment:r.deployment};pub.artifacts[w]=p.phases[phase];pub.registry[w].versions.set(r.version,[r.metadataSHA256,r.modulesSHA256,r.resourcesSHA256]);pub.registry[w].deployments.set(r.deployment,r.version);pub.cursor++;
  }
  const fixtures={};for(const w of ['gateway','entry']){
    const phase=publicationPhases.find(phase=>p.phases[phase]===pub.artifacts[w]),f=apiFixture(p,phase,pub.current[w]);f.f.afterDeployment.result.deployments[0].id=pub.current[w].deployment;f.f.afterDeployment.result.deployments[0].versions[0].version_id=pub.current[w].version;f.f.version.result.id=pub.current[w].version;f.f.latestVersions.result.items[0].id=pub.current[w].version;fixtures[w]=f;
  }
  const calls=[];const transport={mode:'read-only',request:async args=>{assert.ok(!args.method||args.method==='GET');calls.push(args.path);if(args.path.endsWith('/workers/scripts'))return rawJSON({success:true,result:['entry','gateway'].map(w=>({id:p.baselineGuards[w].worker,has_assets:false}))});return fixtures[args.path.includes('/fixture-entry/')||args.path.endsWith('/fixture-entry')?'entry':'gateway'].transport.request(args);}};
  return {pub,transport,calls};
}
for(const count of [1,3,4,8])test(`readonly restart rebuilds ${count} completed phases and reads both current Worker identities with zero PUT`,async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-completed-'));try{
    const j=new FileJournal(d),fixture=await completedJournal(p,j,count),before=await j.records();const restart=new Publisher({packet:p,accounts,transport:fixture.transport,journal:new FileJournal(d)});const r=await restart.restoreCompletedChain();assert.equal(r.cursor,count);assert.equal(r.nextPhase,publicationPhases[count]??null);assert.equal(r.productionActionsExecuted,0);assert.equal(r.lockAcquisitionBlocked,false);assert.deepEqual(restart.current,fixture.pub.current);assert.deepEqual(await j.records(),before);assert.ok(fixture.calls.some(p=>p.includes('/fixture-entry/'))&&fixture.calls.some(p=>p.includes('/fixture-gateway/')));
  }finally{await rm(d,{recursive:true});}
});
test('completed chain with unowned or invalid lock remains locked; non-owner cannot release it',async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-lock-owner-'));try{
    const owner=new FileJournal(d);await owner.lock();const f=await completedJournal(p,owner,1),j=new FileJournal(d);await assert.rejects(()=>j.unlock(),/only the instance/);const pub=new Publisher({packet:p,accounts,transport:f.transport,journal:j}),r=await pub.restoreCompletedChain();assert.equal(r.lockAcquisitionBlocked,true);assert.equal(r.lock.owned,false);await assert.rejects(()=>j.lock());
    await writeFile(join(d,'publisher.lock'),'legacy owner unknown');assert.equal((await j.lockState()).status,'UNVERIFIED_LEGACY_OR_INVALID');await assert.rejects(()=>owner.unlock());assert.ok((await readdir(d)).includes('publisher.lock'));
  }finally{await rm(d,{recursive:true});}
});
test('orphan receipts, unknown intent and changed current identity reject completed restart without mutation or PUT',async()=>{
  for(const variant of ['unknown','orphan','drift']){const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-bad-chain-'));try{
    const j=new FileJournal(d),f=await completedJournal(p,j,1);
    if(variant==='unknown'){const b=f.pub.current.entry;await j.append('unresolved','intent',{packetSHA256:hashJSON(p),phase:'entryObserve',requestId:'unresolved',worker:'entry',priorVersion:b.version,priorDeployment:b.deployment,bodySHA256:'a'.repeat(64),startedAt:start+2});}
    if(variant==='orphan')await j.append('orphan','terminal',{requestId:'orphan'});
    const transport=variant==='drift'?{...f.transport,request:async args=>args.path.endsWith('/fixture-gateway/deployments')?rawJSON({success:true,result:{deployments:[{id:'drift',strategy:'percentage',versions:[{version_id:'drift',percentage:100}]}]}}):f.transport.request(args)}:f.transport;
    const restart=new Publisher({packet:p,accounts,transport,journal:j});await assert.rejects(()=>restart.restoreCompletedChain());assert.equal(restart.cursor,0);assert.equal(restart.pending,null);assert.equal(restart.current.gateway.version,p.baselineGuards.gateway.version);
  }finally{await rm(d,{recursive:true});}}
});
test('write preparation rejects explicit assets upload/configuration and reserved multipart assets parts',()=>{
  const p=buildPacket(input()),phase=p.phases.gatewayObserve;phase.metadata.assets={jwt:'synthetic-not-a-token'};phase.preparedMetadataSHA256=hashJSON(phase.metadata);phase.metadataSHA256=hashJSON(stateMetadata(phase.metadata));
  assert.throws(()=>buildWrite(p,'gatewayObserve',moduleBytes(phase),account,'forbidden'),/explicit assets/);
  const q=buildPacket(input()),m=q.phases.gatewayObserve,originalBytes=moduleBytes(m);m.modules[0].name='assets';m.metadata.main_module='assets';m.modulesSHA256=hashJSON(m.modules);m.preparedMetadataSHA256=hashJSON(m.metadata);m.metadataSHA256=hashJSON(stateMetadata(m.metadata));assert.throws(()=>buildWrite(q,'gatewayObserve',originalBytes,account,'reserved'),/reserved multipart/);
});

test('terminal JSON plus durable unknown remains original-pending across restart and cannot become completed',async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-terminal-unknown-'));try{
    const j=new FileJournal(d),f=await completedJournal(p,j,1);await j.lock();await j.append('completed_0','unknown',{requestId:'completed_0',phase:'gatewayObserve',stopFurtherTest:true,automaticLogsRestore:false});assert.equal(await j.hasPending(),true);
    const make=()=>new Publisher({packet:p,accounts,transport:f.transport,journal:new FileJournal(d)});const rejected=make();await assert.rejects(()=>rejected.restoreCompletedChain(),/unknown intent/);assert.equal(rejected.cursor,0);
    const pending=make();await pending.restoreOriginalPending('completed_0');assert.equal(pending.cursor,0);assert.equal(pending.pending.terminalCandidatePresent,true);await pending.reconcile('completed_0');assert.equal(await j.hasPending(),true);assert.ok((await readdir(d)).includes('publisher.lock'));assert.equal(pending.pending.requestId,'completed_0');
  }finally{await rm(d,{recursive:true});}
});

test('completed restart brackets the first account when it drifts during the second account GET',async()=>{
  const p=buildPacket(input()),d=await mkdtemp(join(tmpdir(),'riffoid-cross-account-drift-'));try{
    const j=new FileJournal(d),f=await completedJournal(p,j,1);let entryRead=false,gatewayReadsAfterDrift=0;
    const transport={...f.transport,request:async args=>{
      if(args.path.includes('/fixture-entry/'))entryRead=true;
      if(entryRead&&args.path.includes('/fixture-gateway/')){gatewayReadsAfterDrift++;if(args.path.endsWith('/versions'))return rawJSON({success:true,result:{items:[{id:'changed-gateway-version'}]}});}
      return f.transport.request(args);
    }};
    const pub=new Publisher({packet:p,accounts,transport,journal:j});await assert.rejects(()=>pub.restoreCompletedChain(),/cross-account reconstruction/);assert.ok(gatewayReadsAfterDrift>0);assert.equal(pub.cursor,0);assert.equal(pub.pending,null);assert.equal(pub.current.gateway.version,p.baselineGuards.gateway.version);
  }finally{await rm(d,{recursive:true});}
});

function livePreflightFixture(variant,stage,onFinalLock){
  const now=Date.now(),x=input();x.config={...x.config,notBefore:now-1000,expires:now+299000};x.preservation.gateway.pipelineScope={accountId:account,zoneId:'b'.repeat(32),worker:'fixture-gateway'};
  const p=buildPacket(x),b=p.baselineGuards.gateway,f=apiFixture(p,'gatewayRestoreLogs',b);f.f.afterDeployment.result.deployments[0].id=b.deployment;f.f.afterDeployment.result.deployments[0].versions[0].version_id=b.version;f.f.version.result.id=b.version;f.f.latestVersions.result.items[0].id=b.version;
  let owned=true,lockReads=0,puts=0,unlocks=0;const records=[];
  const journal={hasPending:async()=>false,records:async()=>[],lock:async()=>{},lockState:async()=>{lockReads++;if(lockReads===2)onFinalLock?.();return {status:owned||variant==='replaced'?'PRESENT_OWNER_RECORDED':'ABSENT',owned};},append:async(id,kind,value)=>{records.push({id,kind,value});if(stage==='intent'&&kind==='intent')owned=false;},unlock:async()=>{unlocks++;}};
  const transport={mode:'live',request:async args=>{
    if(args.method==='PUT'){puts++;throw Error('unexpected mock PUT');}
    if(args.path.endsWith('/workers/scripts')&&stage==='preflight')owned=false;
    if(args.path===`/zones/${'b'.repeat(32)}`)return rawJSON({success:true,result:{id:'b'.repeat(32),account:{id:account}}});
    if(args.path.includes('/logpush/jobs')||args.path.includes('/observability/destinations?')||args.path.endsWith('/tails'))return rawJSON({success:true,result:[]});
    return f.transport.request(args);
  }};
  const cap={productionWritesPermitted:true,packetSHA256:hashJSON(p),notBefore:now-1000,expires:now+200000,singlePublisher:true,resourcesCoverageEstablished:true},pub=new Publisher({packet:p,accounts,transport,journal,liveCapability:cap});
  return {p,pub,cap,records,counts:()=>({puts,unlocks,lockReads})};
}
for(const variant of ['lost','replaced'])for(const stage of ['preflight','intent'])test(`${variant} lock during ${stage} blocks PUT and never unlocks someone else's lock`,async()=>{
  const f=livePreflightFixture(variant,stage);await assert.rejects(()=>f.pub.publish({phase:'gatewayObserve',requestId:'original',moduleBytes:moduleBytes(f.p.phases.gatewayObserve),coordinationState:initialState(f.p)}),/publisher lock/);
  assert.equal(f.counts().puts,0);assert.equal(f.counts().unlocks,0);assert.ok(f.counts().lockReads>0);assert.equal(f.records.filter(r=>r.kind==='intent').length,stage==='intent'?1:0);if(stage==='intent'){assert.equal(f.pub.pending.requestId,'original');assert.equal(f.records.at(-1).kind,'unknown');}
});
test('deadline crossing during final lock await is rechecked before any PUT',async()=>{
  const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;try{
    let f;f=livePreflightFixture('unchanged','none',()=>{clock=f.cap.expires+1;});await assert.rejects(()=>f.pub.publish({phase:'gatewayObserve',requestId:'expiry_original',moduleBytes:moduleBytes(f.p.phases.gatewayObserve),coordinationState:initialState(f.p)}),/approval expired before PUT/);assert.equal(f.counts().puts,0);assert.equal(f.pub.pending.requestId,'expiry_original');assert.equal(f.records.at(-1).kind,'unknown');
  }finally{Date.now=originalNow;}
});
for(const kind of ['namespace','pipeline'])test(`${kind} mutation during later resource GETs is re-read and rejected even with unchanged Worker version`,async()=>{
  const x=input();if(kind==='pipeline')x.preservation.gateway.pipelineScope={accountId:account,zoneId:'b'.repeat(32),worker:'fixture-gateway'};const p=buildPacket(x),f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);let changed=false,readsAfter=0;
  const t={request:async args=>{
    if(args.path.endsWith('/workers/scripts'))changed=true;
    if(kind==='namespace'&&changed&&args.path.includes('/durable_objects/namespaces?')){readsAfter++;return rawJSON({success:true,result:[]});}
    if(args.path===`/zones/${'b'.repeat(32)}`)return rawJSON({success:true,result:{id:'b'.repeat(32),account:{id:account}}});
    if(args.path.includes('/logpush/jobs')||args.path.includes('/observability/destinations?')||args.path.endsWith('/tails')){const mutate=kind==='pipeline'&&changed&&args.path===`/accounts/${account}/logpush/jobs`;if(mutate)readsAfter++;return rawJSON({success:true,result:mutate?[{id:1,enabled:true}]:[]});}
    return f.transport.request(args);
  }};
  await assert.rejects(()=>collectReadback(t,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/complete target|pipeline changed/);assert.ok(readsAfter>0);
});

test('existing container configuration changes independently during Worker inventory GET and is rejected on second pass',async()=>{
  const {containerSnapshot}=await import('../../scripts/m1/riffoid-validation-resources.mjs');const ns='d'.repeat(32),app={id:'existing-app',name:'fixture-container',account_id:account,version:3,durable_objects:{namespace_id:ns},max_instances:1,scheduling_policy:'default',configuration:{image:`registry.cloudflare.com/${account}/fixture@sha256:${'c'.repeat(64)}`,vcpu:0.25,memory:'1GiB',memory_mib:1024,disk:{size_mb:4000,size:'4GB'},network:{assign_ipv4:'none',assign_ipv6:'none',mode:'public'},command:[],entrypoint:[],runtime:'runc',observability:{logs:{enabled:true}}}};
  const x=input(),m=x.baselines.gateway.metadata;m.containers=[{class_name:'Existing',name:app.name}];m.exports.Existing.container=app.name;m.bindings.find(b=>b.type==='durable_object_namespace').namespace_id=ns;m.bindings.find(b=>b.type==='durable_object_namespace').class_name='Existing';x.preservation.gateway.namespaces=[{id:ns}];x.preservation.gateway.containerSnapshots=[containerSnapshot(app)];const p=buildPacket(x),f=apiFixture(p,'gatewayObserve',p.baselineGuards.gateway);f.f.version.result.resources.script_runtime.containers=structuredClone(m.containers);let changed=false,readsAfter=0;
  const t={request:async args=>{
    if(args.path.endsWith('/workers/scripts'))changed=true;
    if(args.path.includes('/durable_objects/namespaces?'))return rawJSON({success:true,result:[{id:ns}]});
    if(args.path.endsWith('/containers/applications?per_page=500'))return rawJSON({success:true,result:[{id:app.id,name:app.name}]});
    if(args.path.endsWith('/containers/applications/'+app.id)){if(changed)readsAfter++;return rawJSON({success:true,result:{...app,version:changed?4:3}});}
    return f.transport.request(args);
  }};
  await assert.rejects(()=>collectReadback(t,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway),/configuration or identity drift/);assert.ok(readsAfter>0);
});

function assetInput(){
  const x=input();x.baselines.gateway.metadata.bindings.push({name:'ASSETS',type:'assets'});
  const runtime={assets:{html_handling:'none',not_found_handling:'none'}};
  x.preservation.gateway.assets=assetSnapshot({accountId:account,worker:x.baselines.gateway.worker},{metadata:x.baselines.gateway.metadata},runtime,{id:x.baselines.gateway.worker,has_assets:true});
  return {x,runtime};
}
function assetAPI(p,phase,current,runtime){
  const f=apiFixture(p,phase,current);
  f.f.afterDeployment.result.deployments[0].id=current.deployment;f.f.afterDeployment.result.deployments[0].versions[0].version_id=current.version;f.f.latestVersions.result.items[0].id=current.version;f.f.version.result.id=current.version;
  if(Object.hasOwn(runtime,'assets'))f.f.version.result.resources.script_runtime.assets=structuredClone(runtime.assets);else delete f.f.version.result.resources.script_runtime.assets;
  const transport={mode:'read-only',request:async args=>args.path.endsWith('/workers/scripts')?rawJSON({success:true,result:[{id:'fixture-gateway',has_assets:true}]}):f.transport.request(args)};
  return {...f,transport};
}
test('asset retention readback passes preservation with full byte coverage false, still rejects resource and module drift',async()=>{
  const {x,runtime}=assetInput(),p=buildPacket(x),f=assetAPI(p,'gatewayObserve',p.baselineGuards.gateway,runtime);
  const r=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway);
  assert.equal(r.preservationMatches,true);assert.equal(r.fullStateMatches,false);assert.equal(r.coverage.assets,false);assert.equal(r.coverage.assetsRetentionContract,true);assert.equal(r.assets.assetBytesAudited,false);
  const pub=new Publisher({packet:p,accounts,transport:{mode:'read-only'},journal:{}});assert.equal(pub.registry.gateway.versions.get(p.baselineGuards.gateway.version)[2],r.resourcesSHA256);
  for(const edit of [g=>g.f.version.result.resources.script_runtime.assets.html_handling='force-trailing-slash',g=>g.f.version.result.resources.bindings.find(b=>b.type==='assets').name='OTHER']){const g=assetAPI(p,'gatewayObserve',p.baselineGuards.gateway,runtime);edit(g);await assert.rejects(()=>collectReadback(g.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway));}
  const g=assetAPI(p,'gatewayObserve',p.baselineGuards.gateway,runtime);await assert.rejects(()=>collectReadback({request:async args=>{const r=await g.transport.request(args);if(r.mainModule)r.bytes=Buffer.from('not the frozen module');return r;}},account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway));
  const containers=assetAPI(p,'gatewayObserve',p.baselineGuards.gateway,runtime);containers.f.version.result.resources.script_runtime.containers=[{name:'foreign'}];assert.equal((await collectReadback(containers.transport,account,'fixture-gateway',p.phases.gatewayObserve,p.preservation.gateway)).preservationMatches,false);
  const missing=structuredClone(p.preservation.gateway);delete missing.namespaces;const incomplete=await collectReadback(f.transport,account,'fixture-gateway',p.phases.gatewayObserve,missing);assert.equal(incomplete.preservationMatches,false);
});
test('asset-enabled publisher computes retention gate without byte-audit override; post-write drift stays original unknown',async()=>{
  for(const postDrift of [false,true]){
    const {x,runtime}=assetInput(),now=Date.now();x.config.notBefore=now-1000;x.config.expires=x.config.notBefore+300000;
    x.preservation.gateway.pipelineScope={accountId:account,zoneId:'b'.repeat(32),worker:'fixture-gateway'};const p=buildPacket(x),dir=await mkdtemp(join(tmpdir(),'riffoid-assets-write-'));
    try{
      let phase='gatewayRestoreLogs',current=p.baselineGuards.gateway,puts=0;
      const transport={mode:'live',request:async args=>{
        if(args.method==='PUT'){puts++;phase='gatewayObserve';current={version:'new-v',deployment:'new-d'};return rawJSON({success:true,result:{id:'fixture-gateway'}});}
        if(args.path===`/zones/${'b'.repeat(32)}`)return rawJSON({success:true,result:{id:'b'.repeat(32),account:{id:account}}});
        if(args.path.includes('/logpush/jobs')||args.path.includes('/destinations')||args.path.endsWith('/tails'))return rawJSON({success:true,result:[]});
        const seen=structuredClone(runtime);if(postDrift&&puts)seen.assets.html_handling='force-trailing-slash';
        return assetAPI(p,phase,current,seen).transport.request(args);
      }};
      const journal=new FileJournal(dir),pub=new Publisher({packet:p,accounts,transport,journal,liveCapability:{productionWritesPermitted:true,packetSHA256:hashJSON(p),notBefore:now-2000,expires:now+350000,singlePublisher:true,resourcesCoverageEstablished:true}});
      const args={phase:'gatewayObserve',requestId:'original',moduleBytes:moduleBytes(p.phases.gatewayObserve),coordinationState:initialState(p),now};
      if(postDrift){await assert.rejects(()=>pub.publish(args),/asset association\/configuration drift/);assert.equal(pub.pending.requestId,'original');assert.equal(pub.cursor,0);assert.equal(await journal.hasPending(),true);assert.ok((await readdir(dir)).includes('publisher.lock'));}
      else {const r=await pub.publish(args);assert.equal(r.preservationMatches,true);assert.equal(r.fullStateMatches,false);assert.equal(r.assets.assetContractAccepted,true);assert.equal(r.assets.assetBytesAudited,false);assert.equal(pub.cursor,1);assert.equal(await journal.hasPending(),false);}
      assert.equal(puts,1); // In-memory fixture only; no HTTP or deployment.
    }finally{await rm(dir,{recursive:true});}
  }
});


test('asset contract rejects reserved configuration modules and claimed receipts cannot bypass coordinator gates',async()=>{
  for(const name of ['assets','metadata','_headers','_redirects']){
    const p=buildPacket(input()),phase=p.phases.gatewayObserve;phase.modules[0].name=name;phase.metadata.main_module=name;phase.preparedMetadataSHA256=hashJSON(phase.metadata);phase.metadataSHA256=hashJSON(stateMetadata(phase.metadata));phase.modulesSHA256=hashJSON(phase.modules);
    const bytes=Buffer.from('fixture');phase.modules[0].bytes=bytes.length;phase.modules[0].sha256=hashBytes(bytes);phase.modulesSHA256=hashJSON(phase.modules);
    assert.throws(()=>buildWrite(p,'gatewayObserve',[bytes],account,'original'),/reserved multipart/);
  }
  const {x,runtime}=assetInput();delete runtime.assets;x.preservation.gateway.assets=assetSnapshot({accountId:account,worker:'fixture-gateway'},{metadata:x.baselines.gateway.metadata},runtime,{id:'fixture-gateway',has_assets:true});
  const p=buildPacket(x),s=initialState(p),receipts=[];
  for(const [phase,w]of [['gatewayObserve','gateway'],['entryObserve','entry']]){
    const t=w==='gateway'?assetAPI(p,phase,{version:phase+'-new',deployment:phase+'-new-deployment'},runtime).transport:apiFixture(p,phase,p.baselineGuards[w]).transport;
    const r=await collectReadback(t,account,p.baselineGuards[w].worker,p.phases[phase],p.preservation[w]);
    receipts.push({...r,phase,worker:p.baselineGuards[w].worker,run:p.run,priorVersion:p.baselineGuards[w].version,priorDeployment:p.baselineGuards[w].deployment,startedAt:start-1,readbackAt:start-1,requestId:phase,quietPublisher:true,pipelineGuardPassed:true});
  }
  assert.equal(receipts[0].assets.assetConfigReadbackVerified,false);assert.equal(receipts[0].fullStateMatches,false);assert.equal(receipts[0].preservationMatches,true);
  assert.equal(advance(p,s,{type:'observationPublished',run:p.run,receipts},start).phase,'observing');
  for(const edit of [r=>r.assets.configEvidence='OBSERVED_ROUTING_CONFIG',r=>r.assets.assetConfigReadbackVerified=true,r=>r.assets.accountId='c'.repeat(32),r=>r.coverage.assets=true]){const rs=structuredClone(receipts);edit(rs[0]);assert.throws(()=>advance(p,s,{type:'observationPublished',run:p.run,receipts:rs},start));}
});


test('asset completed restart rechecks both scopes and refuses cross-account config, binding or presence drift',async()=>{
  for(const drift of [null,'gateway-config','gateway-binding','entry-presence']){
    const {x,runtime}=assetInput(),p=buildPacket(x),dir=await mkdtemp(join(tmpdir(),'riffoid-assets-restore-'));
    try{
      const j=new FileJournal(dir),b=p.baselineGuards.gateway,current={version:'asset-completed-v',deployment:'asset-completed-d'},f=assetAPI(p,'gatewayObserve',current,runtime);
      const r=await collectReadback(f.transport,account,b.worker,p.phases.gatewayObserve,p.preservation.gateway);r.pipelineGuardPassed=true;
      await j.append('completed','intent',{packetSHA256:hashJSON(p),phase:'gatewayObserve',requestId:'completed',worker:'gateway',priorVersion:b.version,priorDeployment:b.deployment,bodySHA256:'a'.repeat(64),startedAt:start});
      await j.append('completed','terminal',{requestId:'completed',phase:'gatewayObserve',receipt:r,ackScript:b.worker,observedVersion:r.version,readbackAt:start+1});
      const entry=apiFixture(p,'entryRestoreLogs',p.baselineGuards.entry);entry.f.afterDeployment.result.deployments[0].id=p.baselineGuards.entry.deployment;entry.f.afterDeployment.result.deployments[0].versions[0].version_id=p.baselineGuards.entry.version;entry.f.latestVersions.result.items[0].id=p.baselineGuards.entry.version;entry.f.version.result.id=p.baselineGuards.entry.version;
      let readEntry=false;
      const transport={mode:'read-only',request:async args=>{
        if(args.path.endsWith('/workers/scripts'))return rawJSON({success:true,result:[{id:'fixture-gateway',has_assets:true},{id:'fixture-entry',has_assets:readEntry&&drift==='entry-presence'}]});
        if(args.path.includes('/fixture-entry')){readEntry=true;return entry.transport.request(args);}
        const response=await f.transport.request(args);
        if(readEntry&&args.path.includes('/versions/')&&drift){const d=JSON.parse(response.bytes);if(drift==='gateway-config')d.result.resources.script_runtime.assets.html_handling='force-trailing-slash';if(drift==='gateway-binding')d.result.resources.bindings.find(b=>b.type==='assets').name='OTHER';return rawJSON(d);}
        return response;
      }};
      const before=await j.records(),pub=new Publisher({packet:p,accounts,transport,journal:j});
      if(drift){await assert.rejects(()=>pub.restoreCompletedChain());assert.equal(pub.cursor,0);}
      else{const restored=await pub.restoreCompletedChain();assert.equal(restored.cursor,1);assert.equal(restored.observed.gateway.preservationMatches,true);assert.equal(restored.observed.gateway.fullStateMatches,false);assert.equal(restored.productionActionsExecuted,0);}
      assert.deepEqual(await j.records(),before);
    }finally{await rm(dir,{recursive:true});}
  }
});
