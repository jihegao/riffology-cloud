import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableOrdinaryRunner,ordinaryTransport,validateLiveConfig} from './g5-benchmark-live-runner.mjs';
const config={windowId:'test-window',proposal:{productionManifest:{deadline:'2099-01-01T00:00:00Z'}}};
test('unknown POST acknowledgement persists fence across restart and never redispatches',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-intent-test-'));let posts=0;
 const transport=async()=>{posts++;throw Error('lost ACK');};
 const a=new DurableOrdinaryRunner({directory,config,transport});a.ready=true; // Test private journal without live initialization.
 await assert.rejects(a.postOnce('r1-project','/api/tenants/test/projects',{title:'synthetic'}),/lost ACK/);
 const b=new DurableOrdinaryRunner({directory,config,transport});b.ready=true;
 assert.equal((await b.postOnce('r1-project','/api/tenants/test/projects',{title:'synthetic'})).blocked,'delivery-unknown-no-repost');
 assert.equal((await b.postOnce('r2-project','/api/tenants/test/projects',{title:'other'})).blocked,'prior-delivery-unknown-no-new-admission');
 assert.equal(posts,1);assert.equal((await readFile(directory+'/r1-project.intent.json','utf8')).includes('cookie'),false);
 await assert.rejects(b.postOnce('r1-project','/api/tenants/test/projects',{title:'changed'}),/configuration-conflict/);
});
test('durable ACK restart reuses receipt; rejects arbitrary endpoints and follows no redirects',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-ack-test-'));let posts=0;
 const runner=new DurableOrdinaryRunner({directory,config,transport:async()=>{posts++;return {project:{id:'actual-mock-id'}};}});
 runner.ready=true;
 await runner.postOnce('create','/api/tenants/test/projects',{});
 await runner.postOnce('create','/api/tenants/test/projects',{});assert.equal(posts,1);
 const transport=ordinaryTransport('synthetic-cookie',async(url,options)=>{assert.equal(options.redirect,'error');return new Response('{}',{status:201});});
 await transport('POST','/api/workspaces/test/sessions',{});
 await assert.rejects(transport('POST','/__validation/fake',{}),/product-path/);
 await assert.rejects(validateLiveConfig({proposal:{productionManifest:{profile:null}}},{cookie:null,approvedSha256:null}));
});
test('actual schema3 scope create/session/Turn loop remains blocked before evidence acceptance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-loop-test-'));
 const requests=[];const transport=async(method,path)=>{requests.push([method,path]);
  if(path.endsWith('/projects'))return {project:{id:'p1',workspace_id:'w1'}};
  if(path.endsWith('/sessions'))return {session:{id:'s1'}};
  if(path.endsWith('/turns'))return {turn:{id:'t1'}};
  if(path.endsWith('/files'))return {revision:'observed-not-accepted'};
  return {schemaVersion:3,scope:{workspaceId:'w1',tenantId:'tenant1'},turns:{t1:{status:'completed',persistenceOutcome:'saved'}}};
 };
 const runner=new DurableOrdinaryRunner({directory,config:{...config,tenantId:'tenant1'},transport});runner.ready=true;
 runner.schedule={schedule:[{fixtureId:'repeat-1/create-model',primarySeed:104729}]};
 const result=await runner.createReconcile();assert.equal(result.acceptedTask,false);assert.equal(result.blocked,'manual-evidence-checkpoint-required');
 await runner.createReconcile();assert.equal(requests.filter(([m])=>m==='POST').length,3);
});
test('concurrent admission and expired deadline never dispatch a second mutation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'g5-lock-test-'));let release,posted=0;
 const wait=new Promise(resolve=>release=resolve);
 const runner=new DurableOrdinaryRunner({directory,config,transport:async()=>{posted++;await wait;return {};}});runner.ready=true;
 const first=runner.postOnce('one','/api/tenants/test/projects',{});
 while(!posted)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal((await runner.postOnce('two','/api/tenants/test/projects',{})).blocked,'concurrent-or-crashed-admission-lock');
 release();await first;assert.equal(posted,1);
 runner.clock=()=>Date.parse('2100-01-01T00:00:00Z');
 await assert.rejects(runner.postOnce('expired','/api/tenants/test/projects',{}),/deadline/);
 await assert.rejects(runner.postOnce('../escape','/api/tenants/test/projects',{}),/intent-name/);
 assert.equal(posted,1);
});
