import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectViewLocalDelivery} from '../../services/web/project-view-local.js';
import {packaged} from './project-views-fixture.mjs';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

const digest='a'.repeat(64),origin='https://app.example.test',delivery={execution:'browser-local',transport:'native-dom/v1',executionOrigin:origin,frameSha256:digest,frameUrl:origin+'/project-views/'+digest+'/frame.html'};
test('local delivery accepts only exact same-app immutable frame and never accepts remote transport',()=>{
 assert.equal(validateProjectViewLocalDelivery({location:{origin}},delivery),delivery.frameUrl);
 for(const changed of [{execution:'remote'},{transport:'isolated-browser-authenticated/v1'},{executionOrigin:'https://other.test'},{frameUrl:delivery.frameUrl+'?x=1'},{frameUrl:delivery.frameUrl+'#x'},{frameUrl:origin+'/api/me'},{frameSha256:'b'.repeat(64)},{frameUrl:delivery.frameUrl.replace('https://','https://name:secret@')},{extra:true}])assert.throws(()=>validateProjectViewLocalDelivery({location:{origin}},{...delivery,...changed}),/project-view-local/);
});

const manual='<!doctype html><script>addEventListener("message",e=>{if(e.source!==parent)return;if(e.data?.type==="project-view-connect")window.connection=e.data;if(e.data?.type==="project-view-init")window.initialized={nonce:e.data.nonce,ports:e.ports.length,view:e.data.view.id};});</script>';
test('nonce handshake binds the original opaque source; wrong source and wrong nonce cannot receive project init',async t=>{
 const f=await localBrowserFixture(t,{frameDocument:manual}),p=f.page,pkg=(await packaged()).pkg;
 await p.evaluate(async({delivery,pkg})=>{
  const {createProjectViewLocal}=await import('/project-view-local.js'),c=new MessageChannel();window.localErrors=[];
  window.local=createProjectViewLocal({container:document.querySelector('#root'),delivery,pkg,view:pkg.manifest.views[0],port:c.port2,onError:e=>localErrors.push(e.message)});window.starting=local.start();
 },{delivery:f.delivery,pkg});
 await p.waitForFunction(()=>document.querySelector('iframe')?.contentWindow);let child;for(let i=0;i<30&&!child;i++){child=projectFrame(f);if(!child)await p.waitForTimeout(10);}await child.waitForFunction(()=>window.connection);
 const nonce=await child.evaluate(()=>connection.nonce);assert.match(nonce,/^[a-f0-9]{64}$/);
 await p.evaluate(nonce=>{const other=document.createElement('iframe');other.id='other';other.sandbox='allow-scripts';other.srcdoc='<script>parent.postMessage('+JSON.stringify({type:'project-view-ready',nonce})+',"*")<\/script>';document.body.append(other);},nonce);
 await p.waitForTimeout(50);assert.equal(await child.evaluate(()=>window.initialized),undefined);
 await child.evaluate(()=>parent.postMessage({type:'project-view-ready',nonce:'0'.repeat(64)},'*'));await p.waitForTimeout(30);assert.equal(await child.evaluate(()=>window.initialized),undefined);
 await child.evaluate(()=>parent.postMessage({type:'project-view-ready',nonce:connection.nonce},'*'));await child.waitForFunction(()=>window.initialized);
 assert.deepEqual(await child.evaluate(()=>initialized),{nonce,ports:1,view:'home'});
 await p.evaluate(async()=>{local.installed();await starting;await local.close();document.querySelector('#other').remove();});assert.equal(await p.locator('iframe').count(),0);assert.deepEqual(await p.evaluate(()=>localErrors),[]);
});

test('startup timeout and close during handshake remove only the original frame and close its port without retry',async t=>{
 for(const action of ['timeout','close'])await t.test(action,async t=>{
  const f=await localBrowserFixture(t,{frameDocument:manual}),p=f.page,pkg=(await packaged()).pkg;
  await p.evaluate(async({delivery,pkg})=>{const {createProjectViewLocal}=await import('/project-view-local.js'),c=new MessageChannel(),end=c.port2,close=end.close.bind(end);window.closes=0;end.close=()=>{closes++;close();};window.localErrors=[];window.local=createProjectViewLocal({container:document.querySelector('#root'),delivery,pkg,view:pkg.manifest.views[0],port:end,timeoutMs:150,onError:e=>localErrors.push(e.message)});window.starting=local.start().then(()=>({ok:true}),e=>({error:e.message}));},{delivery:f.delivery,pkg});
  if(action==='close')await p.evaluate(()=>local.close());
  const result=await p.evaluate(()=>starting);assert.equal(result.ok,undefined);assert.equal(await p.locator('iframe').count(),0);assert.equal(await p.evaluate(()=>closes),1);
  assert.deepEqual(await p.evaluate(()=>localErrors),action==='timeout'?['project-view-local-startup-timeout']:[]);
  assert.ok(f.requests.filter(r=>r.path.endsWith('/frame.html')).length<=1);
 });
});

test('actual connected bootstrap rejects legacy or wrong-nonce init and only the matching connection installs',async t=>{
 const f=await localBrowserFixture(t),p=f.page,pkg=(await packaged()).pkg;
 await p.evaluate(async({url,pkg})=>{
  const {createProjectViewBroker}=await import('/project-views.js');window.states=[];window.frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=url;
  window.readyNonce='b'.repeat(64);window.readySeen=false;window.readyListener=e=>{if(e.source===frame.contentWindow&&e.origin==='null'&&e.data?.nonce===readyNonce)readySeen=true;};addEventListener('message',readyListener);
  frame.onload=()=>frame.contentWindow.postMessage({type:'project-view-connect',nonce:readyNonce},'*');document.querySelector('#root').append(frame);window.pkg=pkg;window.channels=[];
  window.initialize=nonce=>{const c=new MessageChannel();channels.push(c);createProjectViewBroker({port:c.port1,pkg,isCurrent:()=>true,onState:s=>states.push(s)});frame.contentWindow.postMessage({type:'project-view-init',...(nonce?{nonce}:{}),package:pkg,view:pkg.manifest.views[0]},'*',[c.port2]);};
 },{url:f.frameUrl,pkg});
 await p.waitForFunction(()=>readySeen);await p.evaluate(()=>initialize('0'.repeat(64)));await p.evaluate(()=>initialize(null));await p.waitForTimeout(50);
 assert.equal(await projectFrame(f).locator('#value').count(),0);assert.deepEqual(await p.evaluate(()=>states),[]);
 await p.evaluate(()=>initialize(readyNonce));await projectFrame(f).waitForFunction(()=>window.loadedValue==='module loaded');await p.waitForFunction(()=>states.includes('ready'));
 await p.evaluate(()=>{for(const c of channels)c.port1.close();frame.remove();removeEventListener('message',readyListener);});assert.equal(await p.locator('iframe').count(),0);
});

test('legacy direct init remains available only before any nonce connection for frozen local harnesses',async t=>{
 const f=await localBrowserFixture(t),p=f.page,pkg=(await packaged()).pkg;
 await p.evaluate(async({url,pkg})=>{
  const {createProjectViewBroker}=await import('/project-views.js'),c=new MessageChannel();window.states=[];window.legacyBroker=createProjectViewBroker({port:c.port1,pkg,isCurrent:()=>true,onState:s=>states.push(s)});
  window.legacyFrame=document.createElement('iframe');legacyFrame.sandbox='allow-scripts';legacyFrame.onload=()=>legacyFrame.contentWindow.postMessage({type:'project-view-init',package:pkg,view:pkg.manifest.views[0]},'*',[c.port2]);legacyFrame.src=url;document.querySelector('#root').append(legacyFrame);
 },{url:f.frameUrl,pkg});
 await projectFrame(f)?.waitForFunction(()=>window.loadedValue==='module loaded');await p.waitForFunction(()=>states.includes('ready'));assert.equal(await projectFrame(f).locator('#value').innerText(),'module loaded');
 await p.evaluate(()=>{legacyBroker.close();legacyFrame.remove();});assert.equal(await p.locator('iframe').count(),0);
});

test('real opaque DOM cannot read app cookies storage or parent DOM while the app cookie positive control works',async t=>{
 const f=await localBrowserFixture(t,{handler:async(req,res,url)=>{if(url.pathname!=='/cookie-positive')return false;res.setHeader('content-type','application/json');res.end(JSON.stringify({seen:req.headers.cookie?.includes('native-test-auth=synthetic-host-secret')===true}));return true;}}),p=f.page,pkg=(await packaged()).pkg;
 await p.context().addCookies([{url:f.origin,name:'native-test-auth',value:'synthetic-host-secret',httpOnly:true,sameSite:'Strict'}]);
 assert.equal(await p.evaluate(async()=> (await (await fetch('/cookie-positive')).json()).seen),true);
 await p.evaluate(async({delivery,pkg})=>{const {createProjectViewLocal}=await import('/project-view-local.js'),{createProjectViewBroker}=await import('/project-views.js'),c=new MessageChannel();window.local=createProjectViewLocal({container:document.querySelector('#root'),delivery,pkg,view:pkg.manifest.views[0],port:c.port2});window.broker=createProjectViewBroker({port:c.port1,pkg,isCurrent:()=>true,onState:s=>{if(s==='ready')local.installed();}});await local.start();},{delivery:f.delivery,pkg});
 const result=await projectFrame(f).evaluate(()=>{const attempt=fn=>{try{fn();return 'unexpected-readable';}catch(e){return e.name;}};return {origin:self.origin,cookie:attempt(()=>document.cookie),storage:attempt(()=>localStorage.getItem('x')),parent:attempt(()=>parent.document.body)};});
 assert.deepEqual(result,{origin:'null',cookie:'SecurityError',storage:'SecurityError',parent:'SecurityError'});
 await p.evaluate(async()=>{broker.close();await local.close();});assert.equal(await p.locator('iframe').count(),0);
});
