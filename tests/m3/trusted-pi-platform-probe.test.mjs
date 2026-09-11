import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  probeDeleteArgs,
  probeDeploymentArgs,
  probeWorkerConfig,
  probeWorkerMissing,
  probeWorkerName,
  probeWorkerOrigin,
  runTrustedPiPlatformProbe,
  validatePlatformProbe,
} from '../../scripts/m3/trusted-pi-platform-probe.mjs';

const token='0123456789abcdef01234567',capability='a'.repeat(64),workerName=`riffology-issues-probe-${token}`,workerVersionId='12345678-1234-1234-1234-123456789abc',probeVersionId='22345678-1234-1234-1234-123456789abc';

function setup(t,{deployLoss=false,deployCreatesWorker=true,failAfterAStart=false,interloper=false,deleteAckLoss=false,deleteFailure=false}={}){
  const root=mkdtempSync(join(tmpdir(),'riffology-deployed-probe-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'infra'),{recursive:true});
  const config=JSON.parse(readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8'));writeFileSync(join(root,'infra','wrangler.m3-vertical-staging.jsonc'),`${JSON.stringify(config,null,2)}\n`);
  const trusted=config.containers.find(item=>item.class_name==='TrustedPiSandbox'),calls=[],requests=[],instances=new Map();let deployed=false,lastConfigPath=null,time=0,aStarted=false,versionViews=0;
  const missing=()=>({status:1,stdout:'',stderr:'Cloudflare API request failed [code: 10007]'});
  const runner=(_bin,args)=>{
    calls.push([...args]);const nameIndex=args.indexOf('--name'),named=nameIndex>=0?args[nameIndex+1]:null,configIndex=args.indexOf('--config');if(configIndex>=0)lastConfigPath=args[configIndex+1];
    if(args[0]==='deployments'&&named===workerName)return deployed?{status:0,stdout:JSON.stringify({versions:[{version_id:probeVersionId,percentage:100}]})}:missing();
    if(args[0]==='deployments')return {status:0,stdout:JSON.stringify({versions:[{version_id:workerVersionId,percentage:100}]})};
    if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify([{id:'trusted-app',name:trusted.name,image:trusted.image,version:1}])};
    if(args[0]==='containers'&&args[1]==='instances')return {status:0,stdout:JSON.stringify({instances:[...instances.values()],result_info:{next_page_token:null}})};
    if(args[0]==='deploy'){deployed=deployCreatesWorker;return {status:deployLoss?1:0,stdout:'',stderr:deployLoss?'upload response lost':''};}
    if(args[0]==='versions'){versionViews++;return {status:0,stdout:JSON.stringify({id:probeVersionId,annotations:{'workers/tag':`probe-${token}`},resources:{bindings:[{name:'TRUSTED_PI_SANDBOX',type:'durable_object_namespace',class_name:'TrustedPiSandbox',script_name:'riffology-m1-gateway-staging'},{name:'PROBE_CAPABILITY',type:'plain_text',text:interloper&&versionViews>=3?'b'.repeat(64):capability}]}})};}
    if(args[0]==='delete'){if(deleteFailure)return {status:1,stdout:'',stderr:'delete failed'};deployed=false;return {status:deleteAckLoss?1:0,stdout:'',stderr:deleteAckLoss?'delete response lost':''};}
    return {status:1,stdout:'',stderr:'unexpected command'};
  };
  const fetcher=async(url,init)=>{
    requests.push({url,method:init.method});if(failAfterAStart&&aStarted)throw Error('platform-probe-fetch-failed');if(init.method==='GET')return Response.json({ok:true});
    const body=JSON.parse(init.body),actor=body.actor;if(body.action==='start'){instances.set(actor,{id:`instance-${instances.size+1}`,name:actor,state:'running'});if(body.identity.turnId.endsWith('-a'))aStarted=true;return Response.json({ok:true});}if(body.action==='destroy'){const prior=instances.get(actor);if(prior)instances.set(actor,{...prior,state:'inactive'});return Response.json({ok:true,value:{running:false}});}return Response.json({ok:false},{status:400});
  };
  const run=()=>runTrustedPiPlatformProbe({root,release:{workerSourceSha:'b'.repeat(40),workerVersionId},runner,fetcher,now:()=>time+=10_000,sleepFn:async()=>{},quietMs:30_000,pollMs:0,deadlineMs:1_000_000,cleanupDeadlineMs:100_000,healthDeadlineMs:30_000,tokenFactory:()=>token,capabilityFactory:()=>capability});
  return {root,run,calls,requests,get recoveryPath(){return join(root,'.wrangler','issues-probe-recovery',`${workerName}.json`);},get lastConfigPath(){return lastConfigPath;},get deployed(){return deployed;}};
}

test('deployed probe name, workers.dev URL, config, deploy and exact delete args are closed',()=>{
  const name=probeWorkerName(token),origin=probeWorkerOrigin(name),config=probeWorkerConfig('/tmp/probe.mjs',capability,name);assert.equal(name,workerName);assert.equal(origin,`https://${workerName}.jihe-gao.workers.dev`);assert.equal(config.workers_dev,true);assert.equal(config.preview_urls,false);assert.deepEqual(config.durable_objects.bindings,[{name:'TRUSTED_PI_SANDBOX',class_name:'TrustedPiSandbox',script_name:'riffology-m1-gateway-staging'}]);assert.deepEqual(probeDeploymentArgs('/tmp/probe.jsonc',`probe-${token}`),['deploy','--config','/tmp/probe.jsonc','--tag',`probe-${token}`,'--strict']);assert.deepEqual(probeDeleteArgs(name,'/tmp/probe.jsonc'),['delete',name,'--config','/tmp/probe.jsonc']);assert.throws(()=>probeWorkerName('../wrong'),/token-invalid/);assert.throws(()=>probeWorkerOrigin('other-worker'),/name-invalid/);assert.throws(()=>probeDeleteArgs('other-worker','/tmp/probe.jsonc'),/delete-args-invalid/);
  assert.equal(probeWorkerMissing({status:1,stderr:'request failed [code: 10007]'}),true);assert.equal(probeWorkerMissing({status:1,stderr:'network timeout'}),false);assert.equal(probeWorkerMissing({status:0,stdout:'{}'}),false);
});

test('deployed provider-free probe verifies A and B then deletes only its owned Worker with absence proof',async t=>{
  const fixture=setup(t),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).probeWorker.name,workerName);assert.equal(result.probeWorker.capabilityBindingVerified,true);assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.deleteExitConfirmed,true);assert.equal(result.cleanup.absenceConfirmed,true);assert.deepEqual(result.cleanup.actorCleanup.map(item=>[item.actor,item.status]).sort(),[[result.actorA,'absent'],[result.actorB,'absent']].sort());assert.equal(fixture.deployed,false);assert.equal(existsSync(fixture.recoveryPath),false);assert.equal(fixture.requests.every(item=>item.url.startsWith(`https://${workerName}.jihe-gao.workers.dev/`)),true);
  const deploys=fixture.calls.filter(args=>args[0]==='deploy'),deletes=fixture.calls.filter(args=>args[0]==='delete');assert.equal(deploys.length,1);assert.equal(deletes.length,1);assert.equal(deletes[0][1],workerName);assert.equal(deletes[0].includes('--force'),false);assert.equal(existsSync(fixture.lastConfigPath),false);
});

test('lost deploy acknowledgement with the exact Worker blocks but still removes it',async t=>{
  const fixture=setup(t,{deployLoss:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-deploy-failed-or-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(fixture.deployed,false);assert.equal(fixture.calls.filter(args=>args[0]==='delete'&&args[1]===workerName).length,1);
});

test('lost deploy acknowledgement with no Worker passes no-delete reconciliation',async t=>{
  const fixture=setup(t,{deployLoss:true,deployCreatesWorker:false}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-deploy-failed-or-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.deleteAttempted,false);assert.equal(result.cleanup.absenceConfirmed,true);assert.equal(fixture.calls.some(args=>args[0]==='delete'),false);assert.equal(existsSync(fixture.recoveryPath),false);
});

test('persistent transport failure after A starts retains the Worker and private recovery capability',async t=>{
  const fixture=setup(t,{failAfterAStart:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-cleanup-unconfirmed');assert.equal(result.cleanup.reasonCode,'platform-probe-actor-cleanup-unconfirmed');assert.equal(result.cleanup.recoveryRequired,true);assert.equal(fixture.deployed,true);assert.equal(fixture.calls.some(args=>args[0]==='delete'),false);assert.equal(existsSync(fixture.recoveryPath),true);assert.equal(statSync(fixture.recoveryPath).mode&0o777,0o600);const privateRecovery=JSON.parse(readFileSync(fixture.recoveryPath,'utf8'));assert.equal(privateRecovery.capability,capability);assert.equal(privateRecovery.workerName,workerName);assert.equal(JSON.stringify(result).includes(capability),false);
});

test('a same-name interloper appearing before delete fails the capability TOCTOU recheck',async t=>{
  const fixture=setup(t,{interloper:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-cleanup-unconfirmed');assert.equal(result.cleanup.reasonCode,'platform-probe-worker-predelete-identity-mismatched');assert.equal(result.cleanup.recoveryRequired,true);assert.equal(fixture.deployed,true);assert.equal(fixture.calls.some(args=>args[0]==='delete'),false);
});

test('lost delete acknowledgement reconciles exact absence and removes recovery material',async t=>{
  const fixture=setup(t,{deleteAckLoss:true}),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(result.cleanup.deleteAttempted,true);assert.equal(result.cleanup.deleteExitConfirmed,false);assert.equal(result.cleanup.absenceConfirmed,true);assert.equal(fixture.deployed,false);assert.equal(existsSync(fixture.recoveryPath),false);
});

test('delete failure overrides an otherwise successful probe and cannot claim cleanup',async t=>{
  const fixture=setup(t,{deleteFailure:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-cleanup-unconfirmed');assert.equal(result.cleanup.status,'blocked');assert.equal(result.cleanup.deleteExitConfirmed,false);assert.equal(result.cleanup.absenceConfirmed,false);assert.equal(fixture.deployed,true);
});
