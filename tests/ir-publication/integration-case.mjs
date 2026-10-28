// Process-isolated module mocks replace only auth, local-ref and HTTP/UI boundaries.
// The owner, publisher, baseline/native collectors, locks and response writer are real.
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {readFile,writeFile,mkdir,mkdtemp,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import childProcess from 'node:child_process';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {buildFixture} from './build-fixture.mjs';
import {fixture} from './synthetic-api.mjs';
import {originalWrite} from '../../scripts/ir-publication/core/io-boundary.mjs';
import {buildGatewayMetadata} from '../../scripts/ir-publication/core/gateway-metadata.mjs';
import {attachAssetCompletion} from '../../scripts/ir-publication/core/assets-config.mjs';
import {freezeMultipart} from '../../scripts/ir-publication/core/a2/reviewed-wire-primitives.mjs';
import {privateStore,sha} from '../../scripts/ir-publication/core/io-boundary.mjs';
import {collectBaseline,preservationProjection} from '../../scripts/ir-publication/core/collect-baseline.mjs';
import {hashJSON,REQUEST,ACCOUNT,Stop} from '../../scripts/ir-publication/local-guards.mjs';
import {BASE,PUT} from '../../scripts/ir-publication/core/fixed-target.mjs';

const scenario=process.argv[2],root=resolve('scripts/ir-publication');
const output=resolve('.local/jhg46-ir-call-chain-integration-20261028/test-output');
await mkdir(output,{recursive:true});const directory=await mkdtemp(join(output,scenario+'-'));
const inputs=await buildFixture(directory),facts=inputs.facts;
const syntheticBody=Buffer.from('{"success":false,"errors":[{"code":10021,"message":"SYNTHETIC_FULL_ERROR_中文","error_chain":[{"message":"nested fixture"}]}]}');
let responsePhase=false;
// A clean fixture has its normal success state transitions; wrap only external HTTP.
const normal=await fixture({a2:inputs.a2,multiModule:scenario==='current-multi-module'});
const baseline=await collectBaseline({connection:normal.connection,store:await privateStore(join(directory,'expected-baseline')),scope:'expected',deadline:Date.now()+10000});
facts.baselineProjectionSha256=hashJSON(preservationProjection(baseline.snapshot));
if(scenario.startsWith('resume-')){
 const prior=await privateStore(join(directory,'prior-put')),module=await readFile(facts.gatewayClosure.bundle.file),metadata=buildGatewayMetadata(baseline.snapshot,{tag:'ir-m3-m4-'+REQUEST,message:facts.releaseMessage,baselineProjectionSha256:facts.baselineProjectionSha256}),frozen=await freezeMultipart(attachAssetCompletion(metadata,baseline.snapshot,'SYNTHETIC'),module);
 const ack=await originalWrite({connection:normal.connection,store:prior,key:'worker-put',method:'PUT',path:PUT,body:frozen.body,contentType:frozen.contentType,requestId:REQUEST,deadline:Date.now()+10000});
 const file=join(prior.directory,'worker-put-response.private.bin'),raw=await readFile(file),binding=await prior.write('multipart.safe.json',{requestId:REQUEST,bodySha256:sha(frozen.body),bodyBytes:frozen.body.length,moduleSha256:sha(module),metadataWithoutCompletionCanonicalSha256:hashJSON(metadata)});
 facts.gatewayResume={schema:'riffoid-ir-known-gateway-resume/v1',before:baseline.safe.privateArtifact,intent:ack.intent,ack:ack.ack,response:{file,bytes:raw.length,sha256:sha(raw)},multipartBinding:binding};
 const after=await collectBaseline({connection:normal.connection,store:await privateStore(join(directory,'after-prior-put')),scope:'after',deadline:Date.now()+10000});facts.baselineProjectionSha256=hashJSON(preservationProjection(after.snapshot));
 if(scenario==='resume-evidence-drift')facts.gatewayResume.response.sha256='0'.repeat(64);
}
normal.calls.length=0;
if(scenario==='baseline-drift')facts.baselineProjectionSha256='0'.repeat(64);
if(scenario==='expired-window')facts.endsAt=new Date(Date.now()-1).toISOString();
if(scenario==='source-drift')await writeFile(facts.gatewayClosure.bundle.file,'changed fixture bytes');
const resources=[],demands=[],assessments=[];let credentials=0,vaultClosed=0,mainChecks=0,initialReceipt;
const envelope=result=>new Response(JSON.stringify({success:true,result}),{headers:{'content-type':'application/json'}});
function connection(){
  const resource={closed:0};resources.push(resource);
  return {fullWireResponses:true,close(){resource.closed++;},publicGet:normal.connection.publicGet,
    async request(o){
      if(['400','native400'].includes(scenario)&&o.method==='PUT'){
        normal.calls.push({method:o.method,path:o.path});responsePhase=true;
        return new Response(syntheticBody,{status:400,headers:{'content-type':'application/json','cf-ray':'SYNTHETIC_RAY'}});
      }
      if(scenario==='unknown-put'&&o.method==='PUT'){normal.calls.push({method:o.method,path:o.path});throw new Error('synthetic unknown wire result');}
      if(o.path.includes('/containers/dash/'))return envelope({instances:[],durable_objects:[]});
      if(o.path.includes('/containers/applications/')&&o.path.endsWith('/deployments'))return envelope([]);
      return normal.connection.request(o);
    }};
}
const mockAt=(name,namedExports)=>mock.module(new URL('../../scripts/ir-publication/'+name,import.meta.url).href,{namedExports});
const sourceManifest=await readFile(join(root,'source-manifest.json'));
const bindings={executionEnabled:scenario!=='disabled',facts,windowEndsAt:new Date(Date.now()+180000).toISOString(),outputDirectory:join(directory,'execution'),
    sourceManifestReference:{file:join(root,'source-manifest.json'),bytes:sourceManifest.length,sha256:scenario==='manifest-drift'?'0'.repeat(64):sha(sourceManifest)},
  sourceAuditReference:inputs.sourceAuditReference,authorityEvidenceReference:inputs.authorityEvidenceReference,handoffEvidenceReference:inputs.handoffEvidenceReference,
  receiptStream:{synthetic:true},credentialMode:'existing-wrangler-private-fd',proxyUrl:null,
  async evaluatePhysicalRelease(i){
    assessments.push(i.phase);assert.equal(i.native.complete,true);assert.equal(i.native.onlyGet,true);
    assert.ok(i.native.captures.length>=12);assert.equal(i.maintenance.body.quiescent,true);
    if(i.phase==='before-baseline')assert.equal(i.priorBootstrap,null);
    if(i.phase.startsWith('after-rollout-'))assert.ok(i.priorBootstrap?.byApp);
    if(scenario==='physical-unreleased')throw new Stop('synthetic-physical-not-released');
    return {schema:'riffoid-ir.owner-native-release-assessment/v1',requestId:REQUEST,phase:i.phase,observedAt:new Date().toISOString(),
      nativeCaptureSha256:i.nativeReference.sha256,maintenanceResponseSha256:i.maintenanceReference.sha256,unknownRequests:scenario==='unknown-execution',
      processes:{verified:true,activeCount:scenario==='active-work'?1:0,evidenceSha256:'1'.repeat(64)},leases:{verified:true,activeCount:0,evidenceSha256:'2'.repeat(64)},
      physical:{verified:true,vmAndContainerStatesKeptSeparate:true,evidenceSha256:'3'.repeat(64)},
      ...(i.knownOriginalRollout?{rolloutTerminalVerified:true,rolloutId:i.knownOriginalRollout.rolloutId,explainedLifecycleChanges:{version:2}}:{})};
  }};
mockAt('owner-bindings.mjs',bindings);
mockAt('actual-main.mjs',{assertActualLocalMain:async()=>{mainChecks++;return {actualMainSha:facts.finalMain.sha,actualMainTree:facts.finalMain.tree};},recheckActualMainRef:async()=>{mainChecks++;}});
mockAt('receipt-on-demand.mjs',{
  async demandFreshQuiescence({phase}){
    demands.push(phase);if(scenario==='stale-receipt')throw new Stop('fresh-receipt-required');
    const receipt={body:{...structuredClone(facts.newIrMaintenance),quiescent:true,checkedAt:Date.now()}};
    if(phase==='precredential')initialReceipt=receipt;
    const raw=Buffer.from(JSON.stringify(receipt));return {receipt,raw,reference:{file:'synthetic-receipt',bytes:raw.length,sha256:sha(raw)}};
  },async recheckExactQuiescence(q){assert.equal(q.receipt.body.quiescent,true);assert.ok(Date.now()-q.receipt.body.checkedAt<=30000,'stale fixture receipt');}
});
mockAt('credential-channel.mjs',{async loadExistingCredentialVault(options){credentials++;assert.equal(options.mode,'collect');assert.equal(options.preflight.physicalBoundaryEvidenceSha256,null);
  if(scenario==='credential-delay')initialReceipt.body.checkedAt-=31000;
  return {safeMetadata:{synthetic:true,noCredentialRead:true},close(){vaultClosed++;},credentialProvider(){if(['native400','native-success'].includes(scenario))return Buffer.from('SYNTHETIC_TOKEN_DO_NOT_LOG');throw Error('credential must never be requested in fake transport');}};
}});
let httpServer;
if(['native400','native-success'].includes(scenario)){
  httpServer=connection();
  mock.module('node:https',{defaultExport:{...https,request(options,callback){
    const request=new EventEmitter();request.destroy=()=>{};
    request.end=body=>{queueMicrotask(async()=>{
      try{
        const isPublic=options.hostname==='offline-fixture.invalid';if(isPublic){assert.equal(options.headers['user-agent'],'node');assert.equal(options.headers['sec-fetch-mode'],'cors');assert.equal(options.headers.accept,'*/*');assert.equal(options.headers.authorization,undefined);}const response=isPublic?await httpServer.publicGet({origin:facts.publicOrigin,path:options.path,credentials:'omit'}):await httpServer.request({method:options.method,path:options.path.replace(/^\/client\/v4/,''),
          ...(body?{body,contentType:options.headers['content-type']}:{})});
        const bytes=Buffer.from(await response.arrayBuffer()),stream=Readable.from([bytes]);
        stream.statusCode=response.status;stream.complete=true;stream.headers={...Object.fromEntries(response.headers),'content-length':String(bytes.length)};
        callback(stream);stream.once('end',()=>request.emit('close'));
      }catch(e){request.emit('error',e);}
    });};return request;
  }}});
}else mockAt('core/native-http-transport.mjs',{createNativeOwnerConnection:connection,classifiedProxy:x=>x});
mockAt('native-physical-wire.mjs',{createNativePhysicalConnection:connection});
// Any accidental invocation of the real credential helper or local Git fails.
for(const name of ['spawn','execFile','exec','spawnSync','execFileSync','execSync'])childProcess[name]=()=>{throw Error('OFFLINE_PROCESS_EXECUTION_FORBIDDEN');};syncBuiltinESMExports();
const {runBoundOwner}=await import('../../scripts/ir-publication/owner-runtime.mjs');
let result,error;try{result=await runBoundOwner('execute');}catch(e){error=e;}
httpServer?.close();
const writes=normal.calls.filter(x=>x.method!=='GET'),put=writes.filter(x=>x.method==='PUT');
const readExecution=async name=>JSON.parse(await readFile(join(bindings.outputDirectory,name)));
if(['success','credential-delay','current-multi-module','resume-gateway','native-success'].includes(scenario)){
  assert.ifError(error);assert.equal(result.status,'gateway-and-two-original-apps-full-readback-passed');
  assert.equal(put.length,scenario==='resume-gateway'?0:1);assert.equal(writes.filter(x=>x.path.endsWith('/rollouts')).length,2);
  assert.equal(normal.calls.filter(x=>x.path===BASE+'/settings').length,scenario==='resume-gateway'?8:10); // 7 core + 3 independent, no outer bootstrap.
  assert.equal((await readdir(bindings.outputDirectory)).some(x=>x.startsWith('bootstrap-')),false);
  assert.equal(demands.filter(x=>x==='precredential').length,1);assert.equal(demands.filter(x=>x==='before-baseline').length,1);
  assert.equal(result.maintenanceEndPerformed,false);
}else{
  assert.ok(error,'failure must propagate');
  if(['400','native400'].includes(scenario)){
    assert.equal(error.code,'api-http-rejected');assert.equal(put.length,1);assert.equal(writes.length,2);
    assert.deepEqual(await readFile(join(bindings.outputDirectory,'worker-put-response.private.bin')),syntheticBody);
    assert.equal((await readExecution('worker-put-capture.safe.json')).complete,true);
    assert.equal((await readExecution('worker-put-response-context.private.json')).headers['cf-ray'],'SYNTHETIC_RAY');
    assert.equal(normal.calls.filter(x=>x.path===BASE+'/settings').length,2);assert.equal(responsePhase,true);
  }else if(scenario==='unknown-put'){assert.equal(put.length,1);assert.equal(writes.length,2);}
  else assert.equal(writes.length,0);
  if(['disabled','expired-window','stale-receipt','manifest-drift','source-drift'].includes(scenario))assert.equal(credentials,0);
  if(!['disabled','expired-window','stale-receipt','manifest-drift','source-drift'].includes(scenario)){
    const stopped=await readExecution('owner-wiring-stopped.safe.json');assert.equal(stopped.maintenanceEndPerformed,false);
    assert.equal((await readdir(bindings.outputDirectory)).includes('complete.safe.json'),false);
  }
}
assert.ok(resources.every(r=>r.closed===1),'all owned connections close exactly once');
assert.equal(vaultClosed,credentials);assert.ok(credentials<=1,'no second credential pass');
assert.ok(!writes.some(x=>x.path.includes('maintenance')||x.method==='DELETE'));
console.log(JSON.stringify({scenario,passed:true,error:error?.code??null,credentialsSimulated:credentials,cloudRequests:0,
  simulatedWrites:writes.length,fullBaselineCollections:normal.calls.filter(x=>x.path===BASE+'/settings').length,
  demands,resourcesClosedOnce:resources.length,mainChecks,outputDirectory:directory}));
