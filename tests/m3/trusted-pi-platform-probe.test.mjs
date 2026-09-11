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
  probeWorkerPath,
  probeProcessId,
  runTrustedPiPlatformProbe,
  validatePlatformProbe,
} from '../../scripts/m3/trusted-pi-platform-probe.mjs';

const token='0123456789abcdef01234567',capability='a'.repeat(64),workerName=`riffology-issues-probe-${token}`,workerVersionId='12345678-1234-1234-1234-123456789abc',probeVersionId='22345678-1234-1234-1234-123456789abc';

function setup(t,{controlReadFailures=0,instanceReadFailureAt=0,deployLoss=false,deployCreatesWorker=true,eventualWorkerAppearance=false,healthInstability=false,startVisibilityDelay=0,startState='running',processStatus='running',startTimeout=false,failAfterAStart=false,interloper=false,deleteAckLoss=false,deleteFailure=false,predeployFallbackFailure=false,routePropagationFailure=false,routeAbsenceFailure=false}={}){
  const root=mkdtempSync(join(tmpdir(),'riffology-deployed-probe-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'infra'),{recursive:true});
  const config=JSON.parse(readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8'));writeFileSync(join(root,'infra','wrangler.m3-vertical-staging.jsonc'),`${JSON.stringify(config,null,2)}\n`);
  const trusted=config.containers.find(item=>item.class_name==='TrustedPiSandbox'),calls=[],requests=[],instances=new Map(),pendingInstances=new Map(),origin=probeWorkerOrigin(workerName),pathPrefix=probeWorkerPath(workerName);let deployed=false,created=false,routeActive=predeployFallbackFailure,lastConfigPath=null,time=0,aStarted=false,versionViews=0,namedChecksAfterDeploy=0,authorizedHealthCalls=0,instanceReads=0;
  const missing=()=>({status:1,stdout:'',stderr:'Cloudflare API request failed [code: 10007]'});
  const runner=(_bin,args)=>{
    calls.push([...args]);const nameIndex=args.indexOf('--name'),named=nameIndex>=0?args[nameIndex+1]:null,configIndex=args.indexOf('--config');if(configIndex>=0)lastConfigPath=args[configIndex+1];
    if(args[0]==='deployments'&&named===workerName){if(created&&eventualWorkerAppearance&&!deployed&&++namedChecksAfterDeploy>=2){deployed=true;routeActive=true;}return deployed?{status:0,stdout:JSON.stringify({versions:[{version_id:probeVersionId,percentage:100}]})}:missing();}
    if(args[0]==='deployments'){if(controlReadFailures>0){controlReadFailures-=1;return {status:1,stdout:'',stderr:'temporary control-plane read failure'};}return {status:0,stdout:JSON.stringify({versions:[{version_id:workerVersionId,percentage:100}]})};}
    if(args[0]==='containers'&&args[1]==='list')return {status:0,stdout:JSON.stringify([{id:'trusted-app',name:trusted.name,image:trusted.image,version:1}])};
    if(args[0]==='containers'&&args[1]==='instances'){instanceReads+=1;if(instanceReadFailureAt===instanceReads)return {status:1,stdout:'',stderr:'temporary instance read failure'};for(const [actor,pending] of pendingInstances){if(pending.remaining<=0){instances.set(actor,pending.row);pendingInstances.delete(actor);}else pending.remaining-=1;}return {status:0,stdout:JSON.stringify({instances:[...instances.values()],result_info:{next_page_token:null}})};}
    if(args[0]==='deploy'){created=deployCreatesWorker;deployed=deployCreatesWorker&&!eventualWorkerAppearance;routeActive=deployed&&!routePropagationFailure;return {status:deployLoss?1:0,stdout:'',stderr:deployLoss?'upload response lost':''};}
    if(args[0]==='versions'){versionViews++;return {status:0,stdout:JSON.stringify({id:probeVersionId,annotations:{'workers/tag':`probe-${token}`},resources:{bindings:[{name:'TRUSTED_PI_SANDBOX',type:'durable_object_namespace',class_name:'TrustedPiSandbox',script_name:'riffology-m1-gateway-staging'},{name:'PROBE_CAPABILITY',type:'plain_text',text:interloper&&versionViews>=3?'b'.repeat(64):capability},{name:'PROBE_PATH_PREFIX',type:'plain_text',text:pathPrefix}]}})};}
    if(args[0]==='delete'){if(deleteFailure)return {status:1,stdout:'',stderr:'delete failed'};deployed=false;created=false;routeActive=routeAbsenceFailure;return {status:deleteAckLoss?1:0,stdout:'',stderr:deleteAckLoss?'delete response lost':''};}
    return {status:1,stdout:'',stderr:'unexpected command'};
  };
  const fetcher=async(url,init)=>{
    const body=init.method==='POST'?JSON.parse(init.body):null;requests.push({url,method:init.method,action:body?.action??'health',capability:init.headers?.['x-probe-capability']??null});if(failAfterAStart&&aStarted)throw Error('platform-probe-fetch-failed');
    const requestUrl=new URL(url),hasCapability=init.headers?.['x-probe-capability']===capability;
    if(!routeActive)return Response.json({error:'not_found'},{status:404});
    if(!hasCapability)return new Response(null,{status:404});
    if(requestUrl.origin!==new URL(origin).origin||!requestUrl.pathname.startsWith(`${pathPrefix}/`))return new Response(null,{status:404});
    if(init.method==='GET'){authorizedHealthCalls+=1;if(healthInstability&&authorizedHealthCalls===2)return Response.json({error:'not_found'},{status:404});return Response.json({ok:true});}
    const actor=body.actor;if(body.action==='start'){const row={id:`instance-${instances.size+pendingInstances.size+1}`,name:actor,state:startState};if(startVisibilityDelay>0)pendingInstances.set(actor,{row,remaining:startVisibilityDelay});else instances.set(actor,row);if(body.identity.turnId.endsWith('-a'))aStarted=true;if(startTimeout)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));return Response.json({ok:true,processId:probeProcessId(workerName),processStatus,containerRunning:true});}if(body.action==='destroy'){const prior=instances.get(actor);if(prior)instances.set(actor,{...prior,state:'inactive'});pendingInstances.delete(actor);return Response.json({ok:true,value:{running:false}});}return Response.json({ok:false},{status:400});
  };
  const run=()=>runTrustedPiPlatformProbe({root,release:{workerSourceSha:'b'.repeat(40),workerVersionId},runner,fetcher,now:()=>time+=10_000,sleepFn:async()=>{},quietMs:30_000,pollMs:0,deadlineMs:1_000_000,cleanupDeadlineMs:100_000,deploymentSettlementMs:300_000,deploymentVisibilityDeadlineMs:100_000,healthDeadlineMs:100_000,healthStableMs:30_000,requestTimeoutMs:{health:20,start:5,destroy:20},tokenFactory:()=>token,capabilityFactory:()=>capability});
  return {root,run,calls,requests,get recoveryPath(){return join(root,'.wrangler','issues-probe-recovery',`${workerName}.json`);},get lastConfigPath(){return lastConfigPath;},get deployed(){return deployed;}};
}

test('deployed probe name, random custom-host route, config, deploy and exact delete args are closed',()=>{
  const name=probeWorkerName(token),path=probeWorkerPath(name),origin=probeWorkerOrigin(name),config=probeWorkerConfig('/tmp/probe.mjs',capability,name);assert.equal(name,workerName);assert.equal(path,`/__riffology-internal/issues-probe/${token}`);assert.equal(origin,`https://m1.riff-demo.gaojihe.cn${path}`);assert.equal(probeProcessId(name),`probe-${token}`);assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);assert.deepEqual(config.routes,[{pattern:`m1.riff-demo.gaojihe.cn${path}/*`,zone_name:'gaojihe.cn'}]);assert.deepEqual(config.vars,{PROBE_CAPABILITY:capability,PROBE_PATH_PREFIX:path});assert.deepEqual(config.durable_objects.bindings,[{name:'TRUSTED_PI_SANDBOX',class_name:'TrustedPiSandbox',script_name:'riffology-m1-gateway-staging'}]);assert.deepEqual(probeDeploymentArgs('/tmp/probe.jsonc',`probe-${token}`),['deploy','--config','/tmp/probe.jsonc','--tag',`probe-${token}`,'--strict']);assert.deepEqual(probeDeleteArgs(name,'/tmp/probe.jsonc'),['delete',name,'--config','/tmp/probe.jsonc']);assert.throws(()=>probeWorkerName('../wrong'),/token-invalid/);assert.throws(()=>probeWorkerOrigin('other-worker'),/name-invalid/);assert.throws(()=>probeDeleteArgs('other-worker','/tmp/probe.jsonc'),/delete-args-invalid/);
  assert.equal(probeWorkerMissing({status:1,stderr:'request failed [code: 10007]'}),true);assert.equal(probeWorkerMissing({status:1,stderr:'network timeout'}),false);assert.equal(probeWorkerMissing({status:0,stdout:'{}'}),false);
});

test('deployed provider-free probe verifies A and B then deletes only its owned Worker with absence proof',async t=>{
  const fixture=setup(t),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).probeWorker.name,workerName);assert.equal(result.probeWorker.capabilityBindingVerified,true);assert.equal(result.probeWorker.pathBindingVerified,true);assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.deleteExitConfirmed,true);assert.equal(result.cleanup.absenceConfirmed,true);assert.equal(result.cleanup.routeFallbackConfirmed,true);assert.ok(result.cleanup.absenceDurationMs>=30_000);assert.deepEqual(result.cleanup.actorCleanup.map(item=>[item.actor,item.status]).sort(),[[result.actorA,'absent'],[result.actorB,'absent']].sort());assert.equal(fixture.deployed,false);assert.equal(existsSync(fixture.recoveryPath),false);assert.equal(fixture.requests.every(item=>item.url.startsWith(`https://m1.riff-demo.gaojihe.cn${probeWorkerPath(workerName)}/`)),true);
  const deploys=fixture.calls.filter(args=>args[0]==='deploy'),deletes=fixture.calls.filter(args=>args[0]==='delete');assert.equal(deploys.length,1);assert.equal(deletes.length,1);assert.equal(deletes[0][1],workerName);assert.equal(deletes[0].includes('--force'),false);assert.equal(existsSync(fixture.lastConfigPath),false);
});

test('internal process proof does not depend on delayed control-plane start visibility',async t=>{
  const fixture=setup(t,{startVisibilityDelay:2}),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).status,'passed');assert.equal(result.actorAStarted.processStatus,'running');assert.equal(result.actorAStarted.containerRunning,true);assert.equal(result.actorAStartExternal.state,'absent');assert.ok(fixture.calls.filter(args=>args[0]==='containers'&&args[1]==='instances').length>=8);
});

test('lost start acknowledgement is action-specific and is never retried',async t=>{
  const fixture=setup(t,{startTimeout:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-start-timeout');assert.equal(result.failure.stage,'start-a');assert.equal(result.failure.action,'start');assert.equal(result.failure.requestTimeoutMs,5);assert.equal(result.failure.delivery,'unknown');assert.match(result.probeWorker.name,/^riffology-issues-probe-/);assert.equal(result.containerApp.id,'trusted-app');assert.equal(result.actorA.startsWith('m2-t-'),true);assert.equal(result.actorB.startsWith('m2-t-'),true);assert.equal(result.progress.timeline.length>3,true);assert.equal(result.cleanup.status,'passed');assert.equal(fixture.requests.filter(item=>item.method==='POST').length>=1,true);
  const starts=fixture.requests.filter(item=>item.action==='start');assert.equal(starts.length,1);
});

test('start proof accepts only an explicit running internal process and container',async t=>{
  const fixture=setup(t,{processStatus:'exited'}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-process-start-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(fixture.deployed,false);
});

test('a failed full application snapshot blocks after internal start proof',async t=>{
  const fixture=setup(t,{instanceReadFailureAt:2}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-start-observation-unavailable');assert.equal(result.cleanup.status,'passed');assert.equal(fixture.deployed,false);
});

test('successful upload waits through transient 10007 for exact deployment visibility',async t=>{
  const fixture=setup(t,{eventualWorkerAppearance:true}),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).status,'passed');assert.equal(fixture.deployed,false);
});

test('route health must remain continuously stable before the first start request',async t=>{
  const fixture=setup(t,{healthInstability:true}),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).status,'passed');assert.ok(fixture.requests.filter(item=>item.method==='GET'&&item.capability===capability).length>=4);
});

test('bounded control-plane retries preserve the same probe identity after transient reads',async t=>{
  const fixture=setup(t,{controlReadFailures:2}),result=await fixture.run();assert.equal(result.status,'passed');assert.equal(validatePlatformProbe(result).status,'passed');assert.equal(fixture.calls.filter(args=>args[0]==='deployments'&&!args.includes('--name')).length,3);
});

test('predeploy requires the exact main JSON fallback before claiming the random route',async t=>{
  const fixture=setup(t,{predeployFallbackFailure:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-route-preexistence-unconfirmed');assert.equal(result.cleanup.status,'not-required');assert.equal(fixture.calls.some(args=>args[0]==='deploy'),false);assert.equal(existsSync(fixture.recoveryPath),false);
});

test('lost deploy acknowledgement with the exact Worker blocks but still removes it',async t=>{
  const fixture=setup(t,{deployLoss:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-deploy-failed-or-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(fixture.deployed,false);assert.equal(fixture.calls.filter(args=>args[0]==='delete'&&args[1]===workerName).length,1);
});

test('lost deploy acknowledgement tolerates initial 10007 then deletes the exact eventually visible Worker',async t=>{
  const fixture=setup(t,{deployLoss:true,eventualWorkerAppearance:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-deploy-failed-or-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.deleteAttempted,true);assert.equal(result.cleanup.routeFallbackConfirmed,true);assert.ok(result.cleanup.absenceDurationMs>=30_000);assert.equal(fixture.deployed,false);assert.equal(fixture.calls.filter(args=>args[0]==='delete'&&args[1]===workerName).length,1);
});

test('lost deploy acknowledgement with no Worker passes only after the full settlement horizon',async t=>{
  const fixture=setup(t,{deployLoss:true,deployCreatesWorker:false}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-deploy-failed-or-unconfirmed');assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.deleteAttempted,false);assert.equal(result.cleanup.absenceConfirmed,true);assert.equal(result.cleanup.routeFallbackConfirmed,true);assert.ok(result.cleanup.absenceDurationMs>=300_000);assert.equal(fixture.calls.some(args=>args[0]==='delete'),false);assert.equal(existsSync(fixture.recoveryPath),false);
});

test('route propagation failure blocks the probe and safely removes its never-started Worker',async t=>{
  const fixture=setup(t,{routePropagationFailure:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.match(result.reasonCode,/platform-probe-http-404|platform-probe-worker-health-unavailable/);assert.equal(result.cleanup.status,'passed');assert.equal(result.cleanup.routeFallbackConfirmed,true);assert.equal(result.cleanup.actorCleanup.every(item=>item.status==='never-started'),true);assert.equal(fixture.deployed,false);
});

test('route absence failure after delete retains private recovery material and cannot claim cleanup',async t=>{
  const fixture=setup(t,{routeAbsenceFailure:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-cleanup-unconfirmed');assert.equal(result.cleanup.reasonCode,'platform-probe-worker-delete-unconfirmed');assert.equal(result.cleanup.absenceConfirmed,false);assert.equal(result.cleanup.routeFallbackConfirmed,false);assert.equal(result.cleanup.recoveryRequired,true);assert.equal(existsSync(fixture.recoveryPath),true);assert.equal(statSync(fixture.recoveryPath).mode&0o777,0o600);
});

test('persistent transport failure after A starts retains the Worker and private recovery capability',async t=>{
  const fixture=setup(t,{failAfterAStart:true}),result=await fixture.run();assert.equal(result.status,'blocked');assert.equal(result.reasonCode,'platform-probe-worker-cleanup-unconfirmed');assert.equal(result.cleanup.reasonCode,'platform-probe-actor-cleanup-unconfirmed');assert.equal(result.cleanup.recoveryRequired,true);assert.equal(fixture.deployed,true);assert.equal(fixture.calls.some(args=>args[0]==='delete'),false);assert.equal(existsSync(fixture.recoveryPath),true);assert.equal(statSync(fixture.recoveryPath).mode&0o777,0o600);const privateRecovery=JSON.parse(readFileSync(fixture.recoveryPath,'utf8'));assert.equal(privateRecovery.capability,capability);assert.equal(privateRecovery.workerName,workerName);assert.match(privateRecovery.workerSource,/started=await stub\.startLifecycleProbe/);assert.match(privateRecovery.workerSource,/started\.processId!==processId/);assert.match(privateRecovery.workerSource,/processId:started\.processId/);assert.doesNotMatch(privateRecovery.workerSource,/\/bin\/sleep/);assert.doesNotMatch(privateRecovery.workerSource,/timeout:/);assert.doesNotMatch(privateRecovery.workerSource,/input\.command/);assert.equal(JSON.stringify(result).includes(capability),false);
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
