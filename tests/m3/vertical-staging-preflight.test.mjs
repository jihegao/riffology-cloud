import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RELEASE_METADATA_VARS,WORKER_VERSION_METADATA_BINDING,buildReleaseManifest,createStagingConfigOverlay,inspectManagedImage,inspectTrustedPiImageContent,retryJsonCommand,runPreflight,validateDeployedWorkerVersion,validatePredeployGateClosed,validateReleaseManifest,validateStagingTopology,validateWorkerSource} from '../../scripts/m3/vertical-staging-preflight.mjs';
import {activeWorkerVersionId,deploymentArgs,forwardCloseTurnGate,pausedCandidateDeploymentArgs,runControlledRelease,verifyPausedContainerQuiet} from '../../scripts/m3/vertical-staging-release.mjs';
import {PRODUCT_TOOL_BRIDGE_SHA256,PRODUCT_TOOL_LEDGER_SCHEMA_SHA256,PRODUCT_TOOL_LEDGER_SCHEMA_VERSION,PRODUCT_TOOL_PROTOCOL_VERSION} from '../../scripts/m3/vertical-runtime-preflight.mjs';

const config=()=>JSON.parse(readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8'));
const migrations=()=>readdirSync(new URL('../../services/catalog/migrations',import.meta.url)).filter(name=>name.endsWith('.sql'));
const root=fileURLToPath(new URL('../..',import.meta.url));
const releaseConfig=(value,sha,turnsEnabled=true)=>{const result=structuredClone(value);result.vars={...result.vars,M2_TURNS_ENABLED:turnsEnabled?'true':'false',[RELEASE_METADATA_VARS.workerSourceSha]:sha,[RELEASE_METADATA_VARS.toolBridgeSha256]:PRODUCT_TOOL_BRIDGE_SHA256,[RELEASE_METADATA_VARS.toolProtocolVersion]:PRODUCT_TOOL_PROTOCOL_VERSION,[RELEASE_METADATA_VARS.toolLedgerSchemaVersion]:PRODUCT_TOOL_LEDGER_SCHEMA_VERSION,[RELEASE_METADATA_VARS.toolLedgerSchemaSha256]:PRODUCT_TOOL_LEDGER_SCHEMA_SHA256};return result;};
const deployedFixture=(value,sha,id,turnsEnabled=true)=>{
  const profile=releaseConfig(value,sha,turnsEnabled),manifest=buildReleaseManifest(profile,sha),descriptor=structuredClone(manifest.deployedResources),gate=descriptor.bindings.find(item=>item.name==='M2_TURNS_ENABLED');gate.text=turnsEnabled?'true':'false';
  const bindings=descriptor.bindings.map(item=>item.type==='d1'?{name:item.name,type:item.type,database_id:item.databaseId}:item.type==='r2_bucket'?{name:item.name,type:item.type,bucket_name:item.bucketName}:item.type==='service'?{name:item.name,type:item.type,service:item.service,entrypoint:item.entrypoint,environment:item.environment}:item.type==='durable_object_namespace'?{name:item.name,type:item.type,class_name:item.className}:{...item});
  const exports=Object.fromEntries(descriptor.exports.map(item=>[item.name,{type:item.type,...(item.storage===null?{}:{storage:item.storage}),...(item.container===null?{}:{container:item.container})}]));
  const version={id,annotations:{'workers/tag':`source-${sha}`},resources:{bindings,script_runtime:{exports,containers:descriptor.containers.map(item=>({name:item.name,class_name:item.className}))},script:{named_handlers:descriptor.handlers.map(item=>({name:item.name,handlers:[item.handler]}))}}};
  const containerApps=manifest.containerImages.map(item=>({id:`app-${item.name}`,name:descriptor.containers.find(value=>value.className===item.name).name,image:item.reference}));
  return {profile,manifest,version,containerApps,deployment:{versions:[{version_id:id,percentage:100}]}};
};
const deployedResourceResponse=(args,sha,id,enabled)=>{const fixture=deployedFixture(config(),sha,id,enabled);if(args[0]==='versions')return {status:0,stdout:JSON.stringify(fixture.version)};if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify(fixture.containerApps)};return null;};
const stagingRoot=t=>{const directory=mkdtempSync(join(tmpdir(),'riffology-gate-close-fallback-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'),{recursive:true});mkdirSync(join(directory,'services/catalog/migrations'),{recursive:true});mkdirSync(join(directory,'node_modules/.bin'),{recursive:true});writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));for(const name of migrations())writeFileSync(join(directory,'services/catalog/migrations',name),'-- fixture\n');const git=(...args)=>spawnSync('git',args,{cwd:directory,encoding:'utf8'});assert.equal(git('init','-q').status,0);assert.equal(git('add','.').status,0);assert.equal(git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','candidate').status,0);return {directory,git,sha:git('rev-parse','HEAD').stdout.trim()};};
const probeEvidence=(workerSourceSha,workerVersionId='12345678-1234-1234-1234-123456789abc')=>{const name='riffology-issues-probe-0123456789abcdef01234567';return {schemaVersion:1,status:'passed',workerSourceSha,workerVersionId,probeWorker:{name,origin:'https://m1.riff-demo.gaojihe.cn/__riffology-internal/issues-probe/0123456789abcdef01234567',pathPrefix:'/__riffology-internal/issues-probe/0123456789abcdef01234567',versionId:'42345678-1234-1234-1234-123456789abc',versionTag:'probe-0123456789abcdef01234567',capabilityBindingVerified:true,pathBindingVerified:true,binding:{name:'TRUSTED_PI_SANDBOX',type:'durable_object_namespace',className:'TrustedPiSandbox',scriptName:'riffology-m1-gateway-staging'}},cleanup:{status:'passed',workerName:name,identityVerifiedBeforeDelete:true,deleteAttempted:true,deleteExitConfirmed:true,absenceConfirmed:true,routeFallbackConfirmed:true,absenceDurationMs:30_000,recoveryRequired:false,observedAt:130_000,actorCleanup:[{actor:'actor-a',status:'absent',quietMs:30_000,confirmedAt:125_000,internalLifecycle:[{actor:'actor-a',state:'absent',observedAt:83_000},{actor:'actor-a',state:'absent',observedAt:125_000}],externalLifecycle:[{actor:'actor-a',state:'absent',observedAt:84_000},{actor:'actor-a',state:'absent',observedAt:125_000}]},{actor:'actor-b',status:'absent',quietMs:30_000,confirmedAt:127_000,internalLifecycle:[{actor:'actor-b',state:'absent',observedAt:85_000},{actor:'actor-b',state:'absent',observedAt:127_000}],externalLifecycle:[{actor:'actor-b',state:'absent',observedAt:86_000},{actor:'actor-b',state:'absent',observedAt:127_000}]}]},actorA:'actor-a',actorB:'actor-b',actorAStarted:{processId:'probe-0123456789abcdef01234567',processStatus:'running',containerRunning:true,observedAt:500},actorAStartExternal:{actor:'actor-a',state:'inactive',instanceId:'instance-a',applicationInstances:[{id:'instance-a',name:'actor-a',state:'inactive'}],observedAt:501},actorBStarted:{processId:'probe-0123456789abcdef01234567',processStatus:'running',containerRunning:true,observedAt:42_000},actorBStartExternal:{actor:'actor-b',state:'inactive',instanceId:'instance-b',applicationInstances:[{id:'instance-b',name:'actor-b',state:'inactive'}],observedAt:42_001},actorBStartedAt:42_000,actorBReleasedAt:82_000,stopProof:{actor:'actor-a',proofId:'proof-a',observedAt:41_000},internalLifecycle:[{actor:'actor-a',state:'absent',observedAt:1_000},{actor:'actor-a',state:'absent',observedAt:41_000}],externalLifecycle:[{actor:'actor-a',state:'absent',observedAt:2_000},{actor:'actor-a',state:'absent',observedAt:41_000}],actorBInternalLifecycle:[{actor:'actor-b',state:'absent',observedAt:42_000},{actor:'actor-b',state:'absent',observedAt:82_000}],actorBExternalLifecycle:[{actor:'actor-b',state:'absent',observedAt:43_000},{actor:'actor-b',state:'absent',observedAt:82_000}]};};
const quietEvidence=(value=config())=>({schemaVersion:1,status:'passed',quietMs:30_000,apps:value.containers.map((item,index)=>({className:item.class_name,id:`app-${index}`,name:`app-${index}`,image:item.image})),observations:[{observedAt:1_000,nonInactive:0,total:0,instances:[]},{observedAt:31_001,nonInactive:0,total:0,instances:[]}]});

test('staging vertical topology is complete with turn admission paused',()=>{
  const foundationChecks=validateStagingTopology(config(),migrations());
  assert.equal(foundationChecks.length,17);
  assert.deepEqual(foundationChecks.filter(value=>value.status!=='passed'),[]);
  assert.deepEqual(validateStagingTopology(config(),migrations(),{release:true}).filter(value=>value.status!=='passed').map(value=>value.name),['execution-gates-controlled-release']);
});

test('paused mode closes turn admission while retaining read and preview gates',()=>{
  const value=config();
  assert.deepEqual(validateStagingTopology(value,migrations()).filter(item=>item.status!=='passed'),[]);
  value.vars.M3_PREVIEW_ENABLED='false';
  assert.deepEqual(validateStagingTopology(value,migrations()).filter(item=>item.status!=='passed').map(item=>item.name),['turn-admission-paused']);
  value.vars.M3_PREVIEW_ENABLED='true';
  value.vars.M3_OBSERVER_ENABLED='true';
  assert.deepEqual(validateStagingTopology(value,migrations()).filter(item=>item.status!=='passed').map(item=>item.name),['turn-admission-paused']);
});

test('staging topology requires the application TrustedPi capacity singleton and fixed policy',()=>{
  const value=config();
  value.durable_objects.bindings=value.durable_objects.bindings.filter(item=>item.name!=='TRUSTED_PI_CAPACITY');
  delete value.exports.TrustedPiCapacity;value.vars.TRUSTED_PI_CAPACITY_LIMIT='2';
  const failed=new Set(validateStagingTopology(value,migrations()).filter(item=>item.status!=='passed').map(item=>item.name));
  assert.deepEqual(failed,new Set(['tenant-capacity','durable-bindings','durable-exports']));
});

test('staging topology requires bounded turn operation telemetry',()=>{
  const value=config();value.vars.M2_TURN_OPERATION_TELEMETRY='false';
  assert.deepEqual(validateStagingTopology(value,migrations()).filter(item=>item.status==='blocked').map(item=>item.name),['turn-operation-telemetry']);
});

test('staging topology binds queryable Worker version metadata',()=>{
  const value=config();delete value.version_metadata;
  assert.deepEqual(validateStagingTopology(value,migrations()).filter(item=>item.status==='blocked').map(item=>item.name),['worker-version-metadata']);
});

test('release mode rejects mixed gates, observer enablement, local images and storage sharing',()=>{
  const value=config();
  value.vars.M2_TURNS_ENABLED='true';
  value.vars.M3_OBSERVER_ENABLED='true';
  value.containers[1].image='127.0.0.1:5000/project:latest';
  value.r2_buckets[1].bucket_name=value.r2_buckets[0].bucket_name;
  const failed=new Set(validateStagingTopology(value,migrations(),{release:true}).filter(item=>item.status!=='passed').map(item=>item.name));
  assert.deepEqual(failed,new Set(['execution-gates-controlled-release','container-images','dedicated-storage','no-local-runtime-inputs']));
});

test('release-only worker source gate requires a clean index and tracked worktree at the exact HEAD',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-worker-source-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const git=(...args)=>spawnSync('git',args,{cwd:directory,encoding:'utf8'});
  assert.equal(git('init','-q').status,0);writeFileSync(join(directory,'worker.ts'),'export default {};\n');assert.equal(git('add','worker.ts').status,0);assert.equal(git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','candidate').status,0);
  const head=git('rev-parse','HEAD').stdout.trim();assert.equal(validateWorkerSource(directory,null),null);assert.deepEqual(validateWorkerSource(directory,head,{release:true}),{name:'worker-source-sha',status:'passed'});
  writeFileSync(join(directory,'worker.ts'),'export default {fetch(){}};\n');assert.equal(validateWorkerSource(directory,head,{release:true}).status,'blocked');assert.equal(git('add','worker.ts').status,0);assert.equal(validateWorkerSource(directory,head,{release:true}).status,'blocked');
  assert.equal(validateWorkerSource(directory,'0'.repeat(40),{release:true}).status,'blocked');assert.equal(validateWorkerSource(directory,'not-a-sha',{release:true}).status,'blocked');
  await assert.rejects(()=>runPreflight({root,workerSha:head}),/worker-sha-release-only/);
});

test('release evidence manifest records worker, bridge, protocol, schema, and immutable images',()=>{
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),value=releaseConfig(config(),head);
  const manifest=buildReleaseManifest(value,head);
  assert.equal(manifest.workerSourceSha,head);
  assert.equal(manifest.workerVersionTag,`source-${head}`);assert.equal(manifest.workerVersionMetadataBinding,WORKER_VERSION_METADATA_BINDING);
  assert.equal(manifest.toolBridgeSha256,PRODUCT_TOOL_BRIDGE_SHA256);
  assert.equal(manifest.toolProtocolVersion,PRODUCT_TOOL_PROTOCOL_VERSION);
  assert.equal(manifest.toolLedgerSchemaVersion,PRODUCT_TOOL_LEDGER_SCHEMA_VERSION);
  assert.equal(manifest.toolLedgerSchemaSha256,PRODUCT_TOOL_LEDGER_SCHEMA_SHA256);
  assert.equal(manifest.containerImages.length,4);
  assert.ok(manifest.containerImages.every(item=>/@sha256:[a-f0-9]{64}$/.test(item.reference)));
  assert.deepEqual(validateReleaseManifest(value,manifest),{name:'candidate-release-manifest',status:'passed'});
  assert.equal(validateReleaseManifest(value,{...manifest,toolProtocolVersion:'1'}).status,'blocked');
});

test('deployed Worker gate binds the source tag, runtime metadata binding, and sole 100 percent version',()=>{
  const head='a'.repeat(40),id='12345678-1234-1234-1234-123456789abc',fixture=deployedFixture(config(),head,id),{manifest,version,deployment,containerApps}=fixture;
  assert.deepEqual(validateDeployedWorkerVersion(manifest,version,deployment,{containerApps}),{name:'deployed-worker-version',status:'passed'});
  assert.equal(validateDeployedWorkerVersion(manifest,{...version,annotations:{'workers/tag':'source-'+'b'.repeat(40)}},deployment,{containerApps}).status,'blocked');
  assert.equal(validateDeployedWorkerVersion(manifest,version,{versions:[{version_id:id,percentage:99}]},{containerApps}).status,'blocked');
  const bindingDrift=structuredClone(version);bindingDrift.resources.bindings.find(item=>item.name==='TOOL_BRIDGE').entrypoint='WrongBridge';
  assert.equal(validateDeployedWorkerVersion(manifest,bindingDrift,deployment,{containerApps}).status,'blocked');
  const exportDrift=structuredClone(version);exportDrift.resources.script_runtime.exports.ToolBridgeAgent.storage='none';
  assert.equal(validateDeployedWorkerVersion(manifest,exportDrift,deployment,{containerApps}).status,'blocked');
  const containerDrift=structuredClone(containerApps);containerDrift[0].image=`${containerDrift[0].image.slice(0,-64)}${'0'.repeat(64)}`;
  assert.equal(validateDeployedWorkerVersion(manifest,version,deployment,{containerApps:containerDrift}).status,'blocked');
  const paused=deployedFixture(config(),head,id,false);
  assert.equal(validateDeployedWorkerVersion(manifest,paused.version,deployment,{turnsEnabled:false,containerApps:paused.containerApps}).status,'passed');
});

test('release predeploy independently proves the currently deployed turn gate is closed',()=>{
  const id='12345678-1234-1234-1234-123456789abc',deployment={versions:[{version_id:id,percentage:100}]},version={id,resources:{bindings:[{name:'M2_TURNS_ENABLED',type:'plain_text',text:'false'}]}};
  assert.deepEqual(validatePredeployGateClosed(version,deployment),{name:'predeploy-turn-gate-closed',status:'passed'});
  assert.equal(validatePredeployGateClosed({...version,resources:{bindings:[{name:'M2_TURNS_ENABLED',type:'plain_text',text:'true'}]}},deployment).status,'blocked');
  assert.equal(validatePredeployGateClosed(version,{versions:[{version_id:id,percentage:99}]}).status,'blocked');
});

test('release control-plane JSON reads retry boundedly without accepting failed or malformed output',async()=>{
  let calls=0,sleeps=0;const value=await retryJsonCommand(()=>{calls+=1;return calls<3?{status:1,stdout:''}:{status:0,stdout:'{"ok":true}'};},'wrangler',['deployments','status'],{sleepFn:async()=>{sleeps+=1;},retryMs:0});assert.deepEqual(value,{ok:true});assert.equal(calls,3);assert.equal(sleeps,2);
  calls=0;await assert.rejects(()=>retryJsonCommand(()=>{calls+=1;return {status:0,stdout:'not-json'};},'wrangler',['versions','view'],{attempts:2,sleepFn:async()=>{},retryMs:0}),/cloud-command-retries-exhausted/);assert.equal(calls,2);
});

test('release predeploy creates a temporary enabled overlay while the checked config remains paused',async()=>{
  const before=readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8');
  const result=await runPreflight({root,release:true});
  assert.equal(result.phase,'release-predeploy');
  assert.equal(result.releaseManifest.workerSourceSha,null);
  assert.equal(result.checks.find(item=>item.name==='checked-config-default-closed').status,'passed');
  assert.equal(result.checks.find(item=>item.name==='execution-gates-controlled-release').status,'passed');
  assert.equal(result.checks.find(item=>item.name==='worker-source-sha').status,'blocked');
  assert.equal(result.checks.find(item=>item.name==='candidate-release-manifest').status,'blocked');
  assert.equal(readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8'),before);
  assert.deepEqual(readdirSync(new URL('../../infra',import.meta.url)).filter(name=>name.startsWith('.vertical-runtime-release-')),[]);
});

test('release phases separate predeploy checks from exact deployed-version verification',async()=>{
  await assert.rejects(()=>runPreflight({root,releasePhase:'predeploy',workerVersionId:'12345678-1234-1234-1234-123456789abc'}),/worker-version-id-postdeploy-only/);
  await assert.rejects(()=>runPreflight({root,releasePhase:'postdeploy',workerSha:'a'.repeat(40),workerVersionId:'12345678-1234-1234-1234-123456789abc'}),/postdeploy-release-requires-cloud/);
  await assert.rejects(()=>runPreflight({root,releasePhase:'postdeploy',cloud:true,workerSha:'a'.repeat(40)}),/postdeploy-release-requires-worker-version-id/);
});

test('release overlay and deployment command keep the checked config closed and use one exact temporary profile',()=>{
  const sha='a'.repeat(40),before=config(),overlay=createStagingConfigOverlay(root,{turnsEnabled:true,workerSha:sha});
  try{
    assert.equal(config().vars.M2_TURNS_ENABLED,'false');assert.equal(overlay.config.vars.M2_TURNS_ENABLED,'true');
    assert.equal(overlay.config.vars.M2_WORKER_SOURCE_SHA,sha);assert.equal(overlay.config.vars.M2_TOOL_BRIDGE_SHA256,PRODUCT_TOOL_BRIDGE_SHA256);
    assert.equal(JSON.parse(readFileSync(overlay.path,'utf8')).vars.M2_TURNS_ENABLED,'true');assert.equal(statSync(overlay.path).mode&0o777,0o600);
    const args=deploymentArgs(overlay.path,sha);
    assert.deepEqual(args.slice(0,3),['deploy','--config',overlay.path]);assert.ok(args.includes('--containers-rollout=none'));assert.ok(args.includes(`source-${'a'.repeat(40)}`));
  }finally{overlay.remove();}
  assert.deepEqual(config(),before);assert.equal(readdirSync(new URL('../../infra',import.meta.url)).some(name=>name.includes('vertical-runtime-release-')),false);
});

test('paused candidate deployment command selects one exact immutable version at 100 percent',()=>{
  const id='12345678-1234-1234-1234-123456789abc',path='/tmp/control.json';
  assert.deepEqual(pausedCandidateDeploymentArgs(id,path),['versions','deploy',`${id}@100`,'--yes','--config',path]);
  assert.throws(()=>pausedCandidateDeploymentArgs('not-a-version',path),/paused-candidate-deploy-input-invalid/);
});

test('close-time source drift falls back only to the prevalidated paused candidate and reconciles a lost deploy acknowledgement',async t=>{
  const {directory,sha}=stagingRoot(t),openId='12345678-1234-1234-1234-123456789abc',pausedId='22345678-1234-1234-1234-123456789abc',paused=deployedFixture(config(),sha,pausedId,false),open=deployedFixture(config(),sha,openId,true),manifest=buildReleaseManifest(releaseConfig(config(),sha,true),sha),calls=[];
  writeFileSync(join(directory,'services/catalog/migrations','0001_catalog.sql'),'-- tracked close-time drift\n');
  let activeId=openId,activeGate=true;
  const runner=(_bin,args)=>{calls.push(args);if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:activeId,percentage:100}]})};if(args[0]==='versions'&&args[1]==='view'){const id=args[2],fixture=id===pausedId?paused:open;return {status:0,stdout:JSON.stringify(fixture.version)};}if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify(paused.containerApps)};if(args[0]==='versions'&&args[1]==='deploy'){activeId=pausedId;activeGate=false;return {status:1,stdout:'',stderr:'lost acknowledgement'};}return {status:1,stdout:'',stderr:'unexpected command'};};
  const result=await forwardCloseTurnGate({root:directory,workerSha:sha,execute:true,runner,pausedCandidateVersionId:pausedId,pausedCandidateManifest:manifest,retryDelayMs:0});
  assert.equal(activeGate,false);assert.equal(result.status,'passed');assert.equal(result.gateClosed,true);assert.equal(result.gateCloseConfirmed,true);assert.equal(result.forwardConformant,false);assert.equal(result.deployExitConfirmed,false);assert.equal(calls.filter(args=>args[0]==='versions'&&args[1]==='deploy').length,1);assert.equal(calls.some(args=>args[0]==='deploy'),false);
});

test('close fallback refuses a mismatched paused candidate and never overwrites a conflicting current deployment',async t=>{
  const {directory,sha}=stagingRoot(t),openId='12345678-1234-1234-1234-123456789abc',pausedId='22345678-1234-1234-1234-123456789abc',paused=deployedFixture(config(),sha,pausedId,false),open=deployedFixture(config(),sha,openId,true),manifest=buildReleaseManifest(releaseConfig(config(),sha,true),sha),calls=[];
  const value=config();value.vars.M3_PREVIEW_ENABLED='false';writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(value));paused.version.annotations['workers/tag']=`source-${'b'.repeat(40)}`;
  const runner=(_bin,args)=>{calls.push(args);if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:openId,percentage:100}]})};if(args[0]==='versions'&&args[1]==='view')return {status:0,stdout:JSON.stringify(args[2]===pausedId?paused.version:open.version)};if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify(paused.containerApps)};return {status:1,stdout:'',stderr:'unexpected command'};};
  const result=await forwardCloseTurnGate({root:directory,workerSha:sha,execute:true,runner,pausedCandidateVersionId:pausedId,pausedCandidateManifest:manifest,retryDelayMs:0});
  assert.equal(result.status,'blocked');assert.equal(result.gateClosed,false);assert.equal(result.reasonCode,'paused-candidate-resource-mismatch');assert.equal(calls.some(args=>args[0]==='versions'&&args[1]==='deploy'),false);assert.equal(calls.some(args=>args[0]==='deploy'),false);
});

test('controlled release identifies only one exact 100 percent active version',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  assert.equal(activeWorkerVersionId({versions:[{version_id:id,percentage:100}]}),id);
  assert.equal(activeWorkerVersionId({versions:[{version_id:id,percentage:99}]}),null);
  assert.equal(activeWorkerVersionId({versions:[{version_id:id,percentage:100},{version_id:'22345678-1234-1234-1234-123456789abc',percentage:0}]}),null);
});

test('paused global quiet resets its proof window after a transient instance query failure',async()=>{
  const value=config(),listed=value.containers.map((item,index)=>({id:`app-${index}`,name:item.name,image:item.image}));let time=0,instanceReads=0;
  const runner=(_bin,args)=>{if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify(listed)};if(args[0]==='containers'&&args[1]==='instances'){instanceReads+=1;if(instanceReads===5)return {status:1,stdout:'',stderr:'temporary control-plane failure'};return {status:0,stdout:JSON.stringify({instances:[],result_info:{next_page_token:null}})};}return {status:1,stdout:'',stderr:'unexpected command'};};
  const result=await verifyPausedContainerQuiet({root,config:value,runner,quietMs:30_000,pollMs:5_000,deadlineMs:100_000,sleepFn:async ms=>{time+=ms;},nowFn:()=>time});assert.equal(result.status,'passed');assert.equal(result.observations.some(item=>item.reason==='instance-query-unavailable'&&item.nonInactive===null),true);const suffix=result.observations.slice(result.observations.findLastIndex(item=>item.reason==='instance-query-unavailable')+1);assert.ok(suffix.at(-1).observedAt-suffix[0].observedAt>=30_000);
});

test('controlled release uses one enabled overlay and forward-deploys the same SHA closed when postdeploy fails',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));
  writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));
  const sha='a'.repeat(40),openId='12345678-1234-1234-1234-123456789abc',closedId='22345678-1234-1234-1234-123456789abc',calls=[],preflights=[];
  const runner=(_bin,args)=>{
    calls.push(args);const configPath=args[args.indexOf('--config')+1],enabled=JSON.parse(readFileSync(configPath,'utf8')).vars.M2_TURNS_ENABLED==='true',id=enabled?openId:closedId;
    if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:id,percentage:100}]})};
    const resource=deployedResourceResponse(args,sha,id,enabled);if(resource)return resource;
    return {status:0,stdout:'',stderr:''};
  };
  const preflightRunner=async input=>{preflights.push(input);const profile=JSON.parse(readFileSync(input.stagingConfigPath,'utf8'));return input.releasePhase==='predeploy'?{status:'passed',releaseManifest:buildReleaseManifest(profile,sha)}:{status:'blocked'};};
  const result=await runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner,probeRunner:async()=>({...probeEvidence(sha),workerVersionId:closedId}),quietRunner:async()=>quietEvidence(config())});
  assert.equal(result.status,'blocked');assert.equal(result.gateCloseConfirmed,true);assert.equal(result.closedVersionId,closedId);assert.equal(result.workerVersionId,openId);assert.equal(result.pausedCandidateVersionId,closedId);assert.equal(result.platformProbe.status,'passed');assert.equal(result.preOpenQuiet.status,'passed');assert.equal(result.pausedCandidateRecheck.workerVersionId,closedId);assert.equal(preflights.length,2);assert.equal(preflights[0].stagingConfigPath,preflights[1].stagingConfigPath);
  const deploys=calls.filter(args=>args[0]==='deploy'&&!args.includes('--dry-run'));assert.equal(deploys.length,3);assert.ok(deploys.every(args=>args.includes(`source-${sha}`)&&args.includes('--containers-rollout=none')));
  assert.equal(existsSync(preflights[0].stagingConfigPath),false);assert.equal(JSON.parse(readFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),'utf8')).vars.M2_TURNS_ENABLED,'false');
});

test('controlled release SIGINT waits for one confirmed paused same-SHA forward deployment',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-signal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));const sha='a'.repeat(40),closedId='22345678-1234-1234-1234-123456789abc',source=new EventEmitter(),calls=[];let enteredResolve,finishResolve,exitResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;}),finish=new Promise(resolve=>{finishResolve=resolve;}),exited=new Promise(resolve=>{exitResolve=resolve;});
 const runner=(_bin,args)=>{calls.push(args);if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:closedId,percentage:100}]})};const resource=deployedResourceResponse(args,sha,closedId,false);return resource??{status:0,stdout:'',stderr:''};};
 const running=runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner:async()=>{enteredResolve();await finish;return {status:'blocked'};},signalSource:source,signalExit:code=>{exitResolve(code);finishResolve();}});await entered;source.emit('SIGINT');assert.equal(await exited,130);const result=await running;assert.equal(result.status,'blocked');assert.equal(calls.filter(args=>args[0]==='deploy'&&!args.includes('--dry-run')).length,1);assert.equal(readdirSync(join(directory,'infra')).some(name=>name.startsWith('.vertical-runtime-')),false);
});

test('controlled release proves paused candidate probe and global quiet before opening Turns',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-order-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));const sha='a'.repeat(40),pausedId='12345678-1234-1234-1234-123456789abc',openId='22345678-1234-1234-1234-123456789abc',timeline=[];let activeId='32345678-1234-1234-1234-123456789abc',activeGate=false;
 const runner=(_bin,args)=>{const configPath=args[args.indexOf('--config')+1],gate=configPath?JSON.parse(readFileSync(configPath,'utf8')).vars.M2_TURNS_ENABLED==='true':activeGate;if(args[0]==='deploy'&&!args.includes('--dry-run')){activeGate=gate;activeId=gate?openId:pausedId;timeline.push(gate?'deploy-open':'deploy-paused');}if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:activeId,percentage:100}]})};return deployedResourceResponse(args,sha,activeId,activeGate)??{status:0,stdout:'',stderr:''};};
 const preflightRunner=async input=>{const profile=JSON.parse(readFileSync(input.stagingConfigPath,'utf8')),releaseManifest=buildReleaseManifest(profile,sha);return {schemaVersion:1,status:'passed',phase:`release-${input.releasePhase}`,releaseManifest,...(input.releasePhase==='postdeploy'?{workerVersionId:openId}:{}),checks:[{name:input.releasePhase==='predeploy'?'predeploy-turn-gate-closed':'deployed-worker-version',status:'passed'}]};};
 const result=await runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner,probeRunner:async({release})=>{timeline.push('probe');assert.equal(activeGate,false);assert.equal(release.workerVersionId,pausedId);return probeEvidence(sha,pausedId);},quietRunner:async()=>{timeline.push('quiet');assert.equal(activeGate,false);return quietEvidence(config());}});assert.equal(result.status,'passed');assert.deepEqual(timeline,['deploy-paused','probe','quiet','deploy-open']);assert.equal(result.pausedCandidateVersionId,pausedId);assert.equal(result.pausedCandidateRecheck.workerVersionId,pausedId);assert.equal(result.pausedCandidateRecheck.check.status,'passed');assert.equal(result.workerVersionId,openId);assert.equal(result.platformProbe.workerVersionId,pausedId);
});

test('controlled release rechecks the exact paused candidate after quiet and refuses drift before opening',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-recheck-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));const sha='a'.repeat(40),pausedId='12345678-1234-1234-1234-123456789abc',driftedId='32345678-1234-1234-1234-123456789abc';let activeId=pausedId,opens=0;
 const runner=(_bin,args)=>{const configPath=args[args.indexOf('--config')+1],enabled=configPath&&JSON.parse(readFileSync(configPath,'utf8')).vars.M2_TURNS_ENABLED==='true';if(args[0]==='deploy'&&!args.includes('--dry-run')){if(enabled)opens++;else activeId=pausedId;}if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:activeId,percentage:100}]})};return deployedResourceResponse(args,sha,activeId,false)??{status:0,stdout:'',stderr:''};};
 const preflightRunner=async input=>({schemaVersion:1,status:'passed',phase:'release-predeploy',releaseManifest:buildReleaseManifest(JSON.parse(readFileSync(input.stagingConfigPath,'utf8')),sha),checks:[{name:'predeploy-turn-gate-closed',status:'passed'}]});
 await assert.rejects(()=>runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner,probeRunner:async()=>probeEvidence(sha,pausedId),quietRunner:async()=>{activeId=driftedId;return quietEvidence(config());}}),/paused-candidate-post-quiet-recheck-failed/);assert.equal(opens,0);
});

test('controlled release preserves the exact blocked platform probe reason before opening',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-probe-blocked-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));const sha='a'.repeat(40),pausedId='12345678-1234-1234-1234-123456789abc';let opens=0;
 const runner=(_bin,args)=>{const configPath=args[args.indexOf('--config')+1],enabled=configPath&&JSON.parse(readFileSync(configPath,'utf8')).vars.M2_TURNS_ENABLED==='true';if(args[0]==='deploy'&&!args.includes('--dry-run')){if(enabled)opens++;}if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:pausedId,percentage:100}]})};return deployedResourceResponse(args,sha,pausedId,false)??{status:0,stdout:'',stderr:''};};
 const preflightRunner=async input=>({status:'passed',releaseManifest:buildReleaseManifest(JSON.parse(readFileSync(input.stagingConfigPath,'utf8')),sha)});
 const probe={status:'blocked',reasonCode:'platform-probe-start-timeout',cleanup:{status:'passed'}};const result=await runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner,probeRunner:async()=>probe});assert.equal(result.status,'blocked');assert.equal(result.phase,'platform-probe');assert.equal(result.reasonCode,'platform-probe-start-timeout');assert.deepEqual(result.platformProbe,probe);assert.equal(result.pausedCandidateVersionId,pausedId);assert.equal(opens,0);
});

test('signal during paused quiet closes once and cannot resume into the opening deployment',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'riffology-controlled-release-quiet-signal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'infra'));writeFileSync(join(directory,'infra','wrangler.m3-vertical-staging.jsonc'),JSON.stringify(config()));const sha='a'.repeat(40),pausedId='12345678-1234-1234-1234-123456789abc',source=new EventEmitter(),calls=[],deployGates=[];let enteredResolve,finishResolve,exitResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;}),finish=new Promise(resolve=>{finishResolve=resolve;}),exited=new Promise(resolve=>{exitResolve=resolve;});
 const runner=(_bin,args)=>{calls.push(args);if(args[0]==='deploy'&&!args.includes('--dry-run'))deployGates.push(JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8')).vars.M2_TURNS_ENABLED);if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:pausedId,percentage:100}]})};return deployedResourceResponse(args,sha,pausedId,false)??{status:0,stdout:'',stderr:''};};
 const preflightRunner=async input=>({schemaVersion:1,status:'passed',phase:'release-predeploy',releaseManifest:buildReleaseManifest(JSON.parse(readFileSync(input.stagingConfigPath,'utf8')),sha),checks:[{name:'predeploy-turn-gate-closed',status:'passed'}]});
 const running=runControlledRelease({root:directory,workerSha:sha,execute:true,runner,preflightRunner,probeRunner:async()=>probeEvidence(sha,pausedId),quietRunner:async()=>{enteredResolve();await finish;return quietEvidence(config());},signalSource:source,signalExit:code=>{exitResolve(code);finishResolve();}});await entered;source.emit('SIGTERM');assert.equal(await exited,143);const result=await running;assert.equal(result.status,'blocked');assert.equal(result.phase,'interrupted');assert.equal(result.gateCloseConfirmed,true);assert.equal(calls.filter(args=>args[0]==='deploy'&&!args.includes('--dry-run')).length,2);assert.deepEqual(deployGates,['false','false']);
});

test('managed image inspection binds exact manifest and linux amd64 config',async()=>{
  const digest=`sha256:${'a'.repeat(64)}`,configDigest=`sha256:${'b'.repeat(64)}`;
  const reference=`registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/project@${digest}`;
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.endsWith(`/manifests/${digest}`))return new Response(JSON.stringify({config:{digest:configDigest}}),{status:200,headers:{'docker-content-digest':digest}});
    if(url.endsWith(`/blobs/${configDigest}`))return new Response(JSON.stringify({os:'linux',architecture:'amd64'}),{status:200});
    return new Response('',{status:404});
  };
  assert.deepEqual(await inspectManagedImage(reference,'x'.repeat(32),fetcher),{digest,os:'linux',architecture:'amd64'});
  assert.equal(calls.length,2);
});

test('managed image inspection fails closed on digest or platform drift',async()=>{
  const digest=`sha256:${'c'.repeat(64)}`,configDigest=`sha256:${'d'.repeat(64)}`;
  const reference=`registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/project@${digest}`;
  await assert.rejects(()=>inspectManagedImage(reference,'x'.repeat(32),async()=>new Response('{}',{status:200,headers:{'docker-content-digest':`sha256:${'e'.repeat(64)}`}})),/managed-image-digest-mismatch/);
  const fetcher=async url=>url.includes('/manifests/')?new Response(JSON.stringify({config:{digest:configDigest}}),{status:200,headers:{'docker-content-digest':digest}}):new Response(JSON.stringify({os:'linux',architecture:'arm64'}),{status:200});
  await assert.rejects(()=>inspectManagedImage(reference,'x'.repeat(32),fetcher),/managed-image-platform-mismatch/);
});

test('TrustedPi content probe hashes the Bridge inside the exact digest image without exposing registry credentials',()=>{
  const reference=`registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/trusted-pi@sha256:${'f'.repeat(64)}`,password='registry-password-never-in-args',calls=[];
  const runner=(bin,args,options)=>{calls.push({bin,args,options});if(args[0]==='context')return {status:0,stdout:'unix:///private/docker.sock\n',stderr:''};return args[0]==='login'?{status:0,stdout:'',stderr:''}:{status:0,stdout:JSON.stringify({toolBridgeSha256:PRODUCT_TOOL_BRIDGE_SHA256}),stderr:''};};
  assert.deepEqual(inspectTrustedPiImageContent(reference,password,runner),{toolBridgeSha256:PRODUCT_TOOL_BRIDGE_SHA256});assert.equal(calls.length,3);assert.equal(calls.some(call=>call.args.join(' ').includes(password)),false);assert.equal(calls[1].options.input,password);assert.ok(calls[2].args.includes(reference));assert.ok(calls[2].args.includes('--network'));assert.equal(calls[2].options.env.DOCKER_HOST,'unix:///private/docker.sock');
  const mismatch=(bin,args)=>args[0]==='context'?{status:0,stdout:'unix:///private/docker.sock\n',stderr:''}:args[0]==='login'?{status:0,stdout:'',stderr:''}:{status:0,stdout:JSON.stringify({toolBridgeSha256:'0'.repeat(64)}),stderr:''};
  assert.throws(()=>inspectTrustedPiImageContent(reference,password,mismatch),/managed-image-tool-bridge-mismatch/);
});

test('generated local Wrangler profiles are ignored without hiding staging config',()=>{
  const ignore=readFileSync(new URL('../../.gitignore',import.meta.url),'utf8');
  assert.match(ignore,/^infra\/\.vertical-runtime-\*\.jsonc$/m);
  assert.doesNotMatch(ignore,/wrangler\.m3-vertical-staging/);
});
