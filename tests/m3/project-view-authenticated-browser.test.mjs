import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteBrowserFixture,installRemoteClient} from './project-view-remote-fixture.mjs';

const sessionPath='/api/workspaces/workspace-a/project-view-sessions';
async function authenticatedFixture(t,options={}){
 const state={requests:[],sessions:new Map(),closeConfirmed:true,...options};
 const f=await remoteBrowserFixture(t,{handler:async(req,res,url)=>{
  if(!url.pathname.startsWith('/api/'))return false;
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  state.requests.push({path:url.pathname,body,cookie:req.headers.cookie,authorization:req.headers.authorization,at:Date.now()});
  const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  if(state.userRevoked){json({error:'authentication_required'},401);return true;}
  if(url.pathname===sessionPath){
   state.sessions.set(body.requestId,{polls:0});
   if(state.loseCreate){res.destroy();return true;}
   const finish=()=>json(state.wrongId?{id:'wrong-session'}:state.responseToken?{id:body.requestId,token:'must-not-use'}:{id:body.requestId});
   if(state.deferCreate)state.finishCreate=finish;else finish();return true;
  }
  const close=/^\/api\/project-view-sessions\/([A-Za-z0-9_-]+)\/close$/.exec(url.pathname);
  if(close){json({closed:true,cleanupConfirmed:state.closeConfirmed});return true;}
  const id=url.pathname.slice(sessionPath.length+1),session=state.sessions.get(id);
  if(!url.pathname.startsWith(sessionPath+'/')||!session){json({},404);return true;}
  if(body.type==='poll')json(session.polls++===0?{messages:[{type:'installed'},{id:1,type:'files.read',path:'docs/data.json'}],frame:state.frame}:{messages:[]});
  else json({messages:[]});return true;
 }});
 await installRemoteClient(f.page);
 state.frame=await f.page.evaluate(()=>remoteFixture.frame());
 await f.page.context().addCookies([{url:f.origin,name:'fixture-auth',value:'same-origin-session',httpOnly:true,sameSite:'Lax'}]);
 await f.page.evaluate(()=>{
  const nativeFetch=window.fetch.bind(window);remoteFixture.transportCalls=[];
  remoteFixture.fetch=(url,init)=>{remoteFixture.transportCalls.push({url,body:JSON.parse(init.body),credentials:init.credentials,mode:init.mode,cache:init.cache,redirect:init.redirect,keepalive:init.keepalive,authorization:new Headers(init.headers).get('authorization')});return nativeFetch(url,init);};
  remoteFixture.authDelivery={executionOrigin:location.origin,transport:'isolated-browser-authenticated/v1',sessionPath:'/api/workspaces/workspace-a/project-view-sessions'};
 });
 return {...f,state};
}

test('authenticated transport uses same-origin cookies and identity-only create while PNG and MessageChannel remain compatible',async t=>{
 const f=await authenticatedFixture(t),p=f.page;
 await p.evaluate(()=>remoteFixture.start({delivery:remoteFixture.authDelivery,pollMs:25}));
 await p.waitForFunction(()=>remoteFixture.draws.length===1&&remoteFixture.transportCalls.some(r=>r.body.type==='broker'));
 await p.locator('canvas').press('Enter');
 await p.waitForFunction(()=>remoteFixture.transportCalls.filter(r=>r.body.type==='poll').length>=2);
 await p.evaluate(()=>remoteFixture.clients.one.close());
 const client=await p.evaluate(()=>({calls:remoteFixture.transportCalls,pixel:[...document.querySelector('canvas').getContext('2d').getImageData(200,200,1,1).data],states:remoteFixture.states,executed:window.PROJECT_HTML_MUST_NOT_EXECUTE,iframes:document.querySelectorAll('iframe').length}));
 const create=f.state.requests[0],id=create.body.requestId;assert.match(id,/^[a-f0-9-]{36}$/);
 assert.deepEqual(Object.keys(create.body).sort(),['packageIdentity','requestId','viewId']);assert.equal(create.body.viewId,'home');
 assert.equal(create.body.packageIdentity,await p.evaluate(()=>remoteFixture.pkg.packageIdentity));
 for(const call of client.calls){assert.equal(call.credentials,'same-origin');assert.equal(call.mode,'same-origin');assert.equal(call.cache,'no-store');assert.equal(call.redirect,'error');assert.equal(call.authorization,null);assert.equal(Object.hasOwn(call.body,'package'),false);assert.equal(Object.hasOwn(call.body,'token'),false);}
 for(const call of f.state.requests){assert.match(call.cookie,/fixture-auth=same-origin-session/);assert.equal(call.authorization,undefined);}
 const broker=f.state.requests.find(r=>r.body.type==='broker');assert.equal(broker.body.message.value.text,'{"label":"saved project data"}');
 assert.ok(f.state.requests.some(r=>r.body.type==='input'&&r.body.event.key==='Enter'));
 const polls=f.state.requests.filter(r=>r.body.type==='poll');assert.ok(polls[1].at-polls[0].at>=450,'authenticated poll interval must be at least 500ms, allowing scheduling tolerance');
 const close=f.state.requests.at(-1);assert.equal(close.path,'/api/project-view-sessions/'+id+'/close');assert.deepEqual(close.body,{workspaceId:'workspace-a'});assert.equal(client.calls.at(-1).keepalive,true);
 assert.deepEqual(client.pixel,[3,71,207,255]);assert.deepEqual(client.states,[{key:'one',state:'ready'}]);assert.equal(client.executed,undefined);assert.equal(client.iframes,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.nativeRemoteRequests,[]);
});

test('authenticated delivery rejects foreign origins and every noncanonical or cross-workspace API path before transport',async t=>{
 const f=await authenticatedFixture(t),p=f.page;
 const result=await p.evaluate(async()=>{
  const original=remoteFixture.authDelivery,invalid=[
   {...original,executionOrigin:'https://outside.invalid'},
   {...original,executionOrigin:remoteFixture.executionOrigin},
   {...original,executionOrigin:location.origin+'/path'},
   {...original,executionOrigin:location.origin+'?token=x'},
   {...original,executionOrigin:location.origin.replace('http://','http://user:secret@')},
   ...['/api/admin','/api/workspaces/other/project-view-sessions','/api/workspaces/workspace-a/project-view-sessions?x=1','/api/workspaces/workspace-a/project-view-sessions#x','/api/workspaces/workspace-a/project-view-sessions/extra','/api/workspaces/%77orkspace-a/project-view-sessions',location.origin+'/api/workspaces/workspace-a/project-view-sessions'].map(sessionPath=>({...original,sessionPath})),
  ];
  const rejected=[];for(const delivery of invalid){try{await remoteFixture.start({delivery});rejected.push(false);}catch{rejected.push(true);}}
  return {rejected,calls:remoteFixture.transportCalls};
 });
 assert.equal(result.rejected.every(Boolean),true);assert.deepEqual(result.calls,[]);assert.deepEqual(f.state.requests,[]);
});

test('lost create ACK and malformed responses clean only the original request ID and never retry create with a fresh ID',async t=>{
 for(const mode of ['loseCreate','wrongId','responseToken'])await t.test(mode,async t=>{
  const f=await authenticatedFixture(t,{[mode]:true}),p=f.page;
  await p.evaluate(async()=>{try{await remoteFixture.start({delivery:remoteFixture.authDelivery});}catch{remoteFixture.startRejected=true;}await remoteFixture.clients.one.close();});
  assert.equal(await p.evaluate(()=>remoteFixture.startRejected),true);
  // Chromium may replay a disconnected HTTP request internally. The client
  // issues one fetch, and every transport-level replay retains its original ID.
  assert.equal(await p.evaluate(()=>remoteFixture.transportCalls.filter(r=>new URL(r.url).pathname===remoteFixture.authDelivery.sessionPath).length),1);
  assert.equal(new Set(f.state.requests.filter(r=>r.path===sessionPath).map(r=>r.body.requestId)).size,1);
  const create=f.state.requests[0],close=f.state.requests.find(r=>r.path.endsWith('/close'));
  assert.equal(close.path,'/api/project-view-sessions/'+create.body.requestId+'/close');assert.deepEqual(close.body,{workspaceId:'workspace-a'});
  assert.equal(f.state.requests.some(r=>r.body.type==='poll'),false);
  await p.evaluate(async()=>{try{await remoteFixture.clients.one.start();}catch{}});assert.equal(await p.evaluate(()=>remoteFixture.transportCalls.filter(r=>new URL(r.url).pathname===remoteFixture.authDelivery.sessionPath).length),1);
 });
});

test('dispose during authenticated create waits for the same original request then cleans it without polling',async t=>{
 const f=await authenticatedFixture(t,{deferCreate:true}),p=f.page;
 await p.evaluate(()=>{window.creating=remoteFixture.start({delivery:remoteFixture.authDelivery});});
 await p.waitForFunction(()=>remoteFixture.transportCalls.length===1);
 await p.evaluate(()=>{window.closing=remoteFixture.clients.one.close();});
 while(!f.state.finishCreate)await new Promise(resolve=>setTimeout(resolve,10));
 f.state.finishCreate();await p.evaluate(async()=>{await creating;await closing;});
 assert.equal(f.state.requests.length,2);assert.equal(f.state.requests[1].path,'/api/project-view-sessions/'+f.state.requests[0].body.requestId+'/close');
 assert.equal(f.state.requests.some(r=>r.body.type==='poll'),false);assert.equal(await p.evaluate(()=>remoteFixture.draws.length),0);
});

test('panel retains unconfirmed original cleanup and blocks replacement sessions until it is confirmed',async t=>{
 const f=await authenticatedFixture(t,{closeConfirmed:false}),p=f.page;
 await p.evaluate(async()=>{
  const {createProjectViewsPanel}=await import('/project-views.js'),root=document.createElement('section');document.body.append(root);
  window.fetch=remoteFixture.fetch;
  remoteFixture.panel=createProjectViewsPanel({root,api:async path=>path.includes('?identity=')?{current:true}:{package:remoteFixture.pkg,delivery:remoteFixture.authDelivery},pollMs:60000});
  await remoteFixture.panel.enter({tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1});
 });
 await p.waitForFunction(()=>remoteFixture.decodes===1);
 await p.evaluate(()=>remoteFixture.panel.leave());
 await p.waitForFunction(()=>remoteFixture.transportCalls.some(r=>r.url.endsWith('/close')));
 await p.evaluate(()=>remoteFixture.panel.enter({tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1}));
 assert.equal(f.state.requests.filter(r=>r.path===sessionPath).length,1);
 const original=f.state.requests[0].body.requestId;assert.ok(f.state.requests.filter(r=>r.path.endsWith('/close')).every(r=>r.path==='/api/project-view-sessions/'+original+'/close'));
 f.state.closeConfirmed=true;await p.evaluate(()=>remoteFixture.panel.reload());
 assert.equal(f.state.requests.filter(r=>r.path===sessionPath).length,2);
 f.state.closeConfirmed=true;await p.evaluate(()=>remoteFixture.panel.leave());
});

test('invalid or globally revoked login stops pixel/input delivery and does not claim old-cookie cleanup succeeded',async t=>{
 const f=await authenticatedFixture(t),p=f.page;
 await p.evaluate(()=>remoteFixture.start({delivery:remoteFixture.authDelivery}));
 await p.waitForFunction(()=>remoteFixture.draws.length===1&&remoteFixture.transportCalls.some(r=>r.body.type==='broker'));
 f.state.userRevoked=true;
 await p.waitForFunction(()=>remoteFixture.errors.length===1&&remoteFixture.transportCalls.some(r=>r.url.endsWith('/close')));
 const id=f.state.requests[0].body.requestId;
 const close=await p.evaluate(async()=>{try{await remoteFixture.clients.one.close();return {confirmed:true};}catch{return {confirmed:false};}});
 assert.equal(close.confirmed,false);
 const inputs=f.state.requests.filter(r=>r.body.type==='input').length;
 await p.locator('canvas').press('Enter');
 assert.equal(f.state.requests.filter(r=>r.body.type==='input').length,inputs);
 assert.equal(f.state.requests.filter(r=>r.path===sessionPath).length,1);
 assert.ok(f.state.requests.filter(r=>r.path.endsWith('/close')).every(r=>r.path==='/api/project-view-sessions/'+id+'/close'));
 assert.equal(await p.evaluate(()=>remoteFixture.draws.length),1);
});
