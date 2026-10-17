import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
import {manualPageFixture,scopes} from './manual-page-broker-fixture.mjs';
import {createProjectViewBroker,verifyProjectViewPackage} from '../../services/web/project-views.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function files(version){
 const manifest={schema:'project.views/v1',files:['app/home.html','app/report.html','app/main.mjs','app/style.css','docs/data.json'],views:[{id:'home',title:'Canary home',entrypoint:'app/home.html'},{id:'report',title:'Canary report',entrypoint:'app/report.html'}]};
 return {'app/views.json':JSON.stringify(manifest),'app/home.html':'<h1>SYNTHETIC '+version+'</h1><script type="module" src="./main.mjs"></script>','app/report.html':'<h1>SYNTHETIC report '+version+'</h1>','app/main.mjs':'void riffoid.readFile("docs/data.json");','app/style.css':'h1 { color: blue; }','docs/data.json':JSON.stringify({canary:'SYNTHETIC-'+version,data:'x'.repeat(20000)})};
}
function barrier(){let enter,release;return {entered:new Promise(r=>{enter=r;}),wait:new Promise(r=>{release=r;}),enter:()=>enter(),release:()=>release()};}
function brokerFor(t,f,pkg,{user='alpha',hold=null}={}){
 const messages=[],states=[],routes=[],pending=new Map(),processing=new Set(),processingErrors=[];let nextId=0,current=true,portClosed=false,broker;
 const {port1:port,port2:page}=new MessageChannel(),closePort=port.close.bind(port);
 port.close=()=>{portClosed=true;closePort();page.close();for(const resolve of pending.values())resolve(undefined);pending.clear();};
 page.onmessage=({data})=>{if(data.fixtureAck!==undefined){const resolve=pending.get(data.fixtureAck);pending.delete(data.fixtureAck);resolve?.(messages.find(m=>m.id===data.fixtureAck));}else messages.push(data);};
 const authority=async()=>{const value=await f.read(f.base(user)+'/project-views?identity='+pkg.packageIdentity,{user});if(!value.current)throw Error('package is no longer current');};
 broker=createProjectViewBroker({port,pkg,isCurrent:()=>current,authorize:authority,onNavigate:id=>routes.push(id),onState:state=>{states.push(state);if(state==='failed')broker.close();},
  readAsset:async asset=>{const bytes=Buffer.from(asset.base64,'base64');if(hold?.kind==='file'){hold.enter();await hold.wait;}return bytes;},
  readArtifacts:async query=>{const params=new URLSearchParams({identity:pkg.packageIdentity});if(query.cursor)params.set('cursor',query.cursor);if(query.offset!==undefined)params.set('offset',String(query.offset));const result=await f.read(f.base(user)+'/project-view-artifacts'+(query.artifactId?'/'+query.artifactId:'')+'?'+params,{user});if(hold?.kind==='artifact'){hold.enter();await hold.wait;}return result;},
 });
 const handler=port.onmessage;
 // FIFO acknowledgement is test orchestration only. Both requests and real
 // production-broker replies cross the native MessageChannel before assertions.
 port.onmessage=event=>{const task=(async()=>{try{await handler(event);}finally{if(!portClosed)port.postMessage({fixtureAck:event.data.id});}})();processing.add(task);void task.then(()=>processing.delete(task),error=>{processingErrors.push(error);processing.delete(task);});};
 t.after(async()=>{hold?.release();broker.close();await Promise.allSettled(processing);assert.deepEqual(processingErrors,[]);});
 return {broker,messages,states,routes,get portClosed(){return portClosed;},leave(){current=false;broker.close();},async send(value){if(portClosed)return undefined;const id=++nextId;return new Promise(resolve=>{pending.set(id,resolve);page.postMessage({id,...value});});}};
}

test('synthetic manual Revisions traverse real local Gateway/D1/R2/Workspace into the read-only page broker',{timeout:60000},async t=>{
 const f=await manualPageFixture(t),v1=files('V1'),v2=files('V2');let first,second,artifact;
 await t.test('two pages and user-upload receipts derive from actual manual saves, not seeded revisions',async()=>{
  for(const [user,key,content]of [['alpha','alpha-v1',v1],['beta','beta-v1',files('BETA')]]){const saved=await f.save(user,key,content);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.body.status,'committed');}
  first=(await f.read(f.base('alpha')+'/project-views')).package;
  await verifyProjectViewPackage(first,scopes.alpha);assert.equal(first.manifest.views.length,2);
  const canonical=await f.read(f.base('alpha')+'/files');assert.equal(first.revisionId,canonical.revision.revisionId);assert.equal(first.filesSha256,canonical.revision.filesSha256);
  const [receipt]=(await f.read(f.base('alpha')+'/project-view-artifacts?identity='+first.packageIdentity)).items;artifact=receipt;
  assert.equal(artifact.source,'user-upload');assert.equal(artifact.revisionId,first.revisionId);assert.equal(artifact.sha256,sha(v1['docs/data.json']));assert.equal(artifact.bytes,Buffer.byteLength(v1['docs/data.json']));assert.equal('turnId' in artifact,false);
 });
 await t.test('broker lists and reads real canonical files, chunks upload bytes and selects both routes',async()=>{
  const client=brokerFor(t,f,first);
  assert.deepEqual((await client.send({type:'files.list'})).value.map(x=>x.path),first.manifest.files);
  const file=(await client.send({type:'files.read',path:'docs/data.json'})).value;assert.equal(file.text,v1['docs/data.json']);assert.equal(file.sha256,sha(file.text));
  const listed=(await client.send({type:'artifacts.list',cursor:null})).value;assert.equal(listed.items[0].artifactId,artifact.artifactId);
  const chunks=[];let offset=0;
  do{const item=(await client.send({type:'artifacts.read',artifactId:artifact.artifactId,offset})).value;assert.equal(item.receipt.sha256,artifact.sha256);const bytes=Buffer.from(item.base64,'base64');assert.ok(bytes.length<=16384);chunks.push(bytes);offset=item.nextOffset;}while(offset!==null);
  assert.equal(chunks.length,2);assert.equal(Buffer.concat(chunks).toString(),v1['docs/data.json']);assert.equal(sha(Buffer.concat(chunks)),artifact.sha256);
  for(const entrypoint of ['app/report.html','app/home.html'])assert.equal((await client.send({type:'navigate',entrypoint})).value.accepted,true);
  assert.deepEqual(client.routes,['report','home']);assert.deepEqual((await f.read(f.base('alpha')+'/project-views')).package,first,'reopening reads identical canonical package');
 });
 await t.test('V2 invalidates old packages, including a file read already waiting for delivery',async()=>{
  const hold={kind:'file',...barrier()},old=brokerFor(t,f,first,{hold});const pending=old.send({type:'files.read',path:'docs/data.json'});await hold.entered;
  const saved=await f.save('alpha','alpha-v2',v2);assert.equal(saved.body.status,'committed');second=(await f.read(f.base('alpha')+'/project-views')).package;
  assert.notEqual(second.packageIdentity,first.packageIdentity);assert.notEqual(second.revisionId,first.revisionId);
  assert.equal((await f.read(f.base('alpha')+'/project-views?identity='+first.packageIdentity)).current,false);
  const rejected=await f.request(f.base('alpha')+'/project-view-artifacts/'+artifact.artifactId+'?identity='+first.packageIdentity);assert.notEqual(rejected.status,200);assert.equal('base64' in rejected.body,false);
  hold.release();await pending;assert.equal(old.messages.some(m=>m.value?.text),false,'old bytes must not reach the page after V2 commits');assert.equal(old.broker.closed,true,'observed authority loss closes the old host broker');
  const current=brokerFor(t,f,second);assert.equal((await current.send({type:'files.read',path:'docs/data.json'})).value.text,v2['docs/data.json']);
 });
 await t.test('actual owner lookup and package verification deny foreign projects and stale generations',async()=>{
  for(const [user,target]of [['alpha','beta'],['beta','alpha']])for(const suffix of ['/project-views','/files','/manual-saves?capability=1','/project-view-artifacts?identity='+first.packageIdentity]){
   const r=await f.request(f.base(target)+suffix,{user});assert.equal(r.status,404,JSON.stringify({user,target,suffix,r}));assert.deepEqual(r.body,{error:'not_found'});
  }
  const before=await f.footprint();const attempt=await f.request(f.base('alpha')+'/manual-saves',{user:'beta',method:'POST',key:'foreign-write',body:{}});assert.equal(attempt.status,404);assert.deepEqual((await f.footprint()).fences,before.fences);
  const foreign=(await f.read(f.base('beta')+'/project-views',{user:'beta'})).package;
  await assert.rejects(verifyProjectViewPackage(foreign,scopes.alpha),/scope/);
  await assert.rejects(verifyProjectViewPackage(second,{...scopes.alpha,workspaceGeneration:2}),/scope/);
  assert.equal((await f.read('/__fixture/stale-generation')).denied,true);
 });
 await t.test('broker rejects writes, scope forgery and object keys without changing canonical storage',async()=>{
  const client=brokerFor(t,f,second),before=await f.footprint();
  for(const message of [{type:'write'},{type:'save'},{type:'artifacts.delete'},{type:'files.read',path:'../beta/private'},{type:'files.list',scope:scopes.beta},{type:'artifacts.read',artifactId:'manual-blobs-v1/private',offset:0}])assert.equal((await client.send(message)).error,'request-denied');
  assert.deepEqual(await f.footprint(),before);
 });
 await t.test('subscription cancel and leave discard actual artifact replies already waiting for delivery',async()=>{
  for(const mode of ['cancel','leave']){
   const hold={kind:'artifact',...barrier()},client=brokerFor(t,f,second,{hold});const pending=client.send({type:'updates.subscribe'});await hold.entered;
   if(mode==='cancel')await client.send({type:'updates.cancel'});else client.leave();const mark=client.messages.length;hold.release();await pending;
   assert.equal(client.messages.slice(mark).some(m=>m.type==='snapshot'||m.value?.subscribed===true),false,mode);if(mode==='leave')assert.equal(client.portClosed,true);
  }
 });
 await t.test('Catalog revocation fences delayed artifact reads, subscription activation and published snapshots',async()=>{
  const item=(await f.read(f.base('alpha')+'/project-view-artifacts?identity='+second.packageIdentity)).items[0];
  const readHold={kind:'artifact',...barrier()},readClient=brokerFor(t,f,second,{hold:readHold}),readPending=readClient.send({type:'artifacts.read',artifactId:item.artifactId,offset:0});
  const subscribeHold={kind:'artifact',...barrier()},subscribeClient=brokerFor(t,f,second,{hold:subscribeHold}),subscribePending=subscribeClient.send({type:'updates.subscribe'});
  const publishHold={kind:'disabled',...barrier()},publishClient=brokerFor(t,f,second,{hold:publishHold});await publishClient.send({type:'updates.subscribe'});publishHold.kind='artifact';
  const publishPending=publishClient.broker.publish().then(()=>({rejected:false}),()=>({rejected:true}));
  await Promise.all([readHold.entered,subscribeHold.entered,publishHold.entered]);
  await f.db.prepare("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(scopes.alpha.tenantId,'alpha').run();
  assert.equal((await f.request(f.base('alpha')+'/project-views')).status,404);assert.equal((await f.request(f.base('alpha')+'/project-view-artifacts?identity='+second.packageIdentity)).status,404);
  const clients=[readClient,subscribeClient,publishClient],marks=clients.map(c=>c.messages.length);
  readHold.release();subscribeHold.release();publishHold.release();await Promise.all([readPending,subscribePending,publishPending]);
  for(const [i,client]of clients.entries()){
   assert.equal(client.messages.slice(marks[i]).some(m=>m.value?.base64||m.value?.subscribed===true||m.type==='snapshot'),false,'revoked data must not reach the page');
   assert.equal(client.broker.closed,true);assert.equal(client.portClosed,true);assert.ok(client.states.includes('failed'));
  }
  assert.equal((await f.request(f.base('beta')+'/project-views',{user:'beta'})).status,200,'unrelated owner remains usable');
 });
 await t.test('authoritative fixture journals, fences and immutable objects stay bounded with zero Turns/outbound',async()=>{
  const final=await f.footprint();assert.equal(final.journal.alpha.turns,0);assert.equal(final.journal.beta.turns,0);assert.equal(final.journal.alpha.sessions,0);assert.equal(final.journal.beta.sessions,0);
  assert.equal(final.journal.alpha.active,null);assert.equal(final.journal.beta.active,null);assert.equal(final.fences.length,3);assert.ok(final.fences.every(x=>x.state==='released'&&x.terminal_status==='committed'));
  assert.equal(final.keys.filter(x=>x.startsWith('manual-revisions-v1/')).length,3);assert.equal(final.manualPosts,4,'three explicit owned saves plus one rejected foreign POST');assert.equal(final.outbound,0);
 });
});
