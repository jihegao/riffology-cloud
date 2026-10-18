import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectViewBroker} from '../../services/web/project-views.js';
import {packaged} from './project-views-fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;return {promise:new Promise(done=>{resolve=done;}),resolve:value=>resolve(value)};}
function fixture(t,pkg,options={}){
 const messages=[],states=[];let closes=0,broker;
 const port={postMessage:value=>messages.push(value),close(){closes++;},start(){},onmessage:null};
 broker=createProjectViewBroker({port,pkg,isCurrent:()=>true,requestTimeoutMs:120,...options,onState:state=>{states.push(state);if(state==='failed')broker.close();}});
 const receive=port.onmessage;
 t.after(()=>broker.close());
 return {broker,messages,states,send:data=>receive({data}),get closes(){return closes;},get handler(){return port.onmessage;}};
}

test('an authority lookup that never settles reaches one terminal deadline and cannot accept another request',{timeout:2000},async t=>{
 const {pkg}=await packaged();let signal,aborts=0,assetReads=0;
 const f=fixture(t,pkg,{authorize:options=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);return new Promise(()=>{});},readAsset:async()=>{assetReads++;return new Uint8Array();}});
 await f.send({id:1,type:'files.read',path:'docs/data.json'});
 assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);
 assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.broker.closed,true);assert.equal(f.closes,1);assert.equal(f.handler,null);assert.equal(assetReads,0);
 await f.send({id:2,type:'files.list'});await f.broker.publish();f.broker.close();
 assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);assert.equal(f.closes,1);
});

test('a timed out artifact read aborts its signal and discards later private bytes',{timeout:2000},async t=>{
 const {pkg}=await packaged(),read=deferred(),entered=deferred();let signal,authorizations=0;
 const f=fixture(t,pkg,{authorize:async()=>{authorizations++;},readArtifacts:(query,options)=>{assert.deepEqual(query,{artifactId:'artifact-'+'a'.repeat(60),offset:0});signal=options.signal;entered.resolve();return read.promise;}});
 const pending=f.send({id:1,type:'artifacts.read',artifactId:'artifact-'+'a'.repeat(60),offset:0});await entered.promise;
 await pending;assert.equal(signal.aborted,true);assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);
 read.resolve({base64:Buffer.from('private late artifact').toString('base64'),nextOffset:null});await tick();
 assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);assert.equal(authorizations,1);assert.equal(f.closes,1);
});

test('explicit close immediately cancels a waiting file read and leaves no later reply or failure',{timeout:2000},async t=>{
 const {pkg}=await packaged(),read=deferred(),entered=deferred();let signal,aborts=0;
 const f=fixture(t,pkg,{readAsset:(_asset,options)=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);entered.resolve();return read.promise;}});
 const pending=f.send({id:1,type:'files.read',path:'docs/data.json'});await entered.promise;
 f.broker.close();assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.handler,null);await pending;
 read.resolve(new TextEncoder().encode('private late file'));await tick();await new Promise(resolve=>setTimeout(resolve,180));
 assert.deepEqual(f.messages,[]);assert.deepEqual(f.states,[]);assert.equal(f.closes,1);assert.equal(f.broker.closed,true);
});

test('revocation at the final delivery check closes the original host without leaking completed bytes',{timeout:2000},async t=>{
 const {pkg}=await packaged(),read=deferred(),entered=deferred();let authorized=true,authorizations=0,readSignal;
 const f=fixture(t,pkg,{authorize:async({signal})=>{authorizations++;assert.equal(signal.aborted,false);if(!authorized)throw Error('revoked');},readAsset:(_asset,{signal})=>{readSignal=signal;entered.resolve();return read.promise;}});
 const pending=f.send({id:1,type:'files.read',path:'docs/data.json'});await entered.promise;authorized=false;
 read.resolve(new TextEncoder().encode('private completed file'));await pending;
 assert.equal(authorizations,2);assert.equal(readSignal.aborted,true);assert.deepEqual(f.messages,[]);assert.deepEqual(f.states,['failed']);assert.equal(f.broker.closed,true);assert.equal(f.closes,1);
});

test('subscription timeout never activates a listener or publishes a delayed initial snapshot',{timeout:2000},async t=>{
 const {pkg}=await packaged(),read=deferred(),entered=deferred();let reads=0,signal;
 const f=fixture(t,pkg,{readArtifacts:(query,options)=>{reads++;assert.deepEqual(query,{cursor:null});signal=options.signal;entered.resolve();return read.promise;}});
 const pending=f.send({id:1,type:'updates.subscribe'});await entered.promise;await pending;
 assert.equal(signal.aborted,true);assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);
 read.resolve({items:[{marker:'private delayed snapshot'}],nextCursor:null,version:'a'.repeat(64)});await tick();await f.broker.publish();
 assert.equal(reads,1);assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.equal(f.broker.closed,true);assert.equal(f.closes,1);
});


test('an expired monotonic deadline rejects data even before its timer callback can run',{timeout:2000},async t=>{
 const {pkg}=await packaged();let assetReads=0;
 const f=fixture(t,pkg,{authorize:async()=>{const until=performance.now()+160;while(performance.now()<until){};},readAsset:async()=>{assetReads++;return new TextEncoder().encode('private late bytes');}});
 await f.send({id:1,type:'files.read',path:'docs/data.json'});
 assert.equal(assetReads,0);assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);assert.equal(f.broker.closed,true);assert.equal(f.closes,1);
});
