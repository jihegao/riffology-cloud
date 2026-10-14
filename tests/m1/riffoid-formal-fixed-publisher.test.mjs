import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FileJournal} from '../../scripts/m1/riffoid-validation-publisher.mjs';
import {hashJSON,hashBytes,stateMetadata} from '../../scripts/m1/riffoid-validation-evidence.mjs';
import {FormalFixedPublisher} from '../../scripts/m1/riffoid-formal-fixed-publisher.mjs';
const roles=['gateway','execution','entry'],a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32),d='d'.repeat(32);
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const raw=x=>({status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify({success:true,result:x}))});
async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'riffoid-formal-publisher-fixture-')),journal=new FileJournal(dir);
 const code=Buffer.from('export default {fetch(){return new Response("fixture");}};'),baselines={},preservation={},accounts={gateway:a,execution:a,entry:b},postProtocolBaselines={},backend={};
 for(let i=0;i<roles.length;i++){
  const w=roles[i],worker='fixture-'+w,metadata={main_module:'index.js',keep_assets:true,compatibility_date:'2026-09-05',compatibility_flags:[],containers:[],exports:{},bindings:[{type:'plain_text',name:'APP_ORIGIN',text:'https://old.example'},{type:'plain_text',name:'TWO_ACCOUNT_AUTH_MODE',text:'disabled'}],observability:{enabled:true,logs:{enabled:true,persist:true}},logpush:false,tail_consumers:[]};
  const modules=[{name:'index.js',path:'/fixture/'+w+'.js',bytes:code.length,sha256:hashBytes(code)}];
  const assets={standard:'keep-assets-contract-v1',accountId:accounts[w],worker,hasAssets:false,bindingsSHA256:hashJSON([]),configEvidence:'NO_ASSETS',configSHA256:null};
  preservation[w]={assets,pipelineScope:{accountId:accounts[w],zoneId:w==='entry'?d:c,worker}};
  baselines[w]={worker,metadata,modules};
  postProtocolBaselines[w]={worker,version:uid(i+1),deployment:uid(i+11),metadataSHA256:hashJSON(stateMetadata(metadata)),modulesSHA256:hashJSON(modules),resourcesSHA256:hashJSON([{kind:'asset-retention-contract',accountId:accounts[w],worker,sha256:hashJSON(assets)}])};
  backend[w]={...postProtocolBaselines[w],artifact:structuredClone(baselines[w]),code};
 }
 const names={gatewayCanonical:'gateway',executionCanonical:'execution',entryEnabled:'entry',entryClose:'entry',gatewayRollback:'gateway',executionRollback:'execution',entryRollback:'entry'},phases={},requests={},bodies={};
 for(const [name,w] of Object.entries(names)){
  const artifact=structuredClone(baselines[w]);artifact.worker=w;
  if(name.endsWith('Canonical'))artifact.metadata.bindings[0].text='https://new.example';
  if(['entryEnabled','entryClose'].includes(name)){artifact.metadata.bindings[0].text='https://new.example';artifact.metadata.bindings[1].text=name==='entryEnabled'?'signed-entry-v1':'disabled';}
  artifact.metadataSHA256=hashJSON(stateMetadata(artifact.metadata));artifact.modulesSHA256=hashJSON(artifact.modules);phases[name]=artifact;
  bodies[name]=Buffer.from('FIXTURE_NO_HTTP_'+name);requests[name]={requestId:'fixture_'+name,accountId:accounts[w],worker:baselines[w].worker,path:'/accounts/'+accounts[w]+'/workers/scripts/'+baselines[w].worker+'?bindings_inherit=strict',bodySHA256:hashBytes(bodies[name]),bytes:bodies[name].length,contentType:'multipart/form-data; boundary=fixture'};
 }
 const frozenPlan={scope:'OFFLINE_FIXTURE_ONLY',formalT:null,recoveryUntil:null,guardStatus:'FRESH_POST_PROTOCOL_BASELINE_AND_ACCEPTANCE_SCOPE_REVIEWED',accounts,baselines,phases,requests,preservation,postProtocolBaselines},now=Date.now(),cap={frozenPlanSHA256:hashJSON(frozenPlan),productionWritesPermitted:true,singlePublisher:true,resourcesCoverageEstablished:true,nativeProtocolComplete:true,formalAcceptanceCapabilitiesReady:true,failureDisposition:'exact-close-forward-rollback',notBefore:now-100,expires:now+60000,publisherConfirmedAt:now-100};
 let publisher,nextVersion=101,puts=0,unknownAfterDelivery=false;const reads=[];
 const transport={mode:'live',async request(q){
  if(q.method==='PUT'){
   await publisher.authorizeWrite({accountId:q.path.split('/')[2],method:'PUT',path:q.path,bodySHA256:hashBytes(q.body),bytes:q.body.length});
   const phase=Object.keys(requests).find(x=>requests[x].path===q.path&&requests[x].bodySHA256===hashBytes(q.body));assert.ok(phase);
   const w=phases[phase].worker;puts++;backend[w]={...backend[w],version:uid(nextVersion++),deployment:uid(nextVersion++),artifact:structuredClone(phases[phase])};
   if(unknownAfterDelivery)throw Error('fixture lost original acknowledgement after delivery');
   return raw({id:baselines[w].worker});
  }
  assert.equal(q.method??'GET','GET');reads.push(q.path);
  const role=roles.find(w=>q.path.includes('/workers/scripts/'+baselines[w].worker));
  if(role){
   const x=backend[role],m=x.artifact.metadata,runtime={compatibility_date:m.compatibility_date,compatibility_flags:m.compatibility_flags,containers:m.containers,exports:m.exports};
   if(q.path.endsWith('/deployments'))return raw({deployments:[{id:x.deployment,strategy:'percentage',versions:[{version_id:x.version,percentage:100}]}]});
   if(q.path.endsWith('/versions'))return raw({items:[{id:x.version}]});
   if(q.path.includes('/versions/'))return raw({id:x.version,resources:{bindings:m.bindings,script_runtime:runtime}});
   if(q.path.endsWith('/script-settings'))return raw({observability:m.observability,logpush:m.logpush,tail_consumers:m.tail_consumers});
   if(q.path.endsWith('/settings'))return raw(stateMetadata(m));
   if(q.path.endsWith('/tails'))return raw([]);
   const boundary='fixture';return {status:200,mainModule:'index.js',contentType:'multipart/form-data; boundary='+boundary,bytes:Buffer.concat([Buffer.from('--fixture\r\nContent-Disposition: form-data; name="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n'),x.code,Buffer.from('\r\n--fixture--\r\n')])};
  }
  if(q.path.endsWith('/workers/scripts'))return raw(roles.filter(w=>accounts[w]===q.path.split('/')[2]).map(w=>({id:baselines[w].worker,has_assets:false})));
  if(/^\/zones\/[a-f0-9]{32}$/.test(q.path))return raw({id:q.path.split('/')[2],account:{id:q.path.split('/')[2]===d?b:a}});
  if(/\/logpush\/jobs$|\/observability\/destinations\?/.test(q.path))return raw([]);
  throw Error('unexpected fixture GET '+q.path);
 }};
 publisher=new FormalFixedPublisher({frozenPlan,liveCapability:cap,transport,journal});
 return {publisher,backend,journal,bodies,reads,get puts(){return puts;},loseAck(){unknownAfterDelivery=true;},close:()=>rm(dir,{recursive:true})};
}
test('entry cannot open out of order; current backend drift blocks before entry PUT',async()=>{
 const x=await setup();try{
  await assert.rejects(()=>x.publisher.publish('entryEnabled',x.bodies.entryEnabled));assert.equal(x.puts,0);
  await x.publisher.publish('gatewayCanonical',x.bodies.gatewayCanonical);await x.publisher.publish('executionCanonical',x.bodies.executionCanonical);
  x.backend.gateway.version=uid(999);await assert.rejects(()=>x.publisher.publish('entryEnabled',x.bodies.entryEnabled));
  assert.equal(x.puts,2);assert.equal(x.publisher.pending,null);assert.equal(await x.journal.hasPending(),false);
 }finally{await x.close();}
});
test('lost original PUT acknowledgement retains intent and lock; no automatic rollback or restart retry',async()=>{
 const x=await setup();try{
  x.loseAck();await assert.rejects(()=>x.publisher.publish('gatewayCanonical',x.bodies.gatewayCanonical));
  assert.equal(x.puts,1);assert.equal(await x.journal.hasPending(),true);assert.equal((await x.journal.lockState()).owned,true);
  await assert.rejects(()=>x.publisher.publish('gatewayCanonical',x.bodies.gatewayCanonical));
  await assert.rejects(()=>x.publisher.beginKnownFailureRollback({outcome:'known-failure'}));assert.equal(x.puts,1);
  assert.deepEqual((await x.journal.records()).map(r=>r.name.split('.')[1]).sort(),['intent','unknown']);
 }finally{await x.close();}
});
test('known failure closes entry then restores exact original settings; activation never establishes T',async()=>{
 const x=await setup();try{
  for(const phase of ['gatewayCanonical','executionCanonical','entryEnabled']){const receipt=await x.publisher.publish(phase,x.bodies[phase]);assert.equal(receipt.formalT,null);}
  await x.publisher.beginKnownFailureRollback({frozenPlanSHA256:x.publisher.frozenPlanSHA256,outcome:'known-failure',reason:'fixture authenticated acceptance failed',current:structuredClone(x.publisher.current)});
  for(const phase of ['entryClose','gatewayRollback','executionRollback','entryRollback']){assert.equal(x.publisher.allowedPhase,phase);await x.publisher.publish(phase,x.bodies[phase]);}
  assert.equal(x.puts,7);assert.equal(x.publisher.allowedPhase,null);assert.equal(await x.journal.hasPending(),false);
  for(const w of roles)assert.deepEqual(x.backend[w].artifact.metadata,x.publisher.frozenPlan.baselines[w].metadata);
 }finally{await x.close();}
});
