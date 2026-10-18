import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProjectViewBroker} from '../../services/web/project-views.js';
import {ProjectIrAuthority,PROJECT_IR_LEASE_MS} from '../../services/project-ir/authority.ts';
import {packaged} from './project-views-fixture.mjs';
import {projectIrFixture} from './project-ir-fixture.ts';

// Production broker and IR authority; only KV/R2 and the original port are
// synthetic. This exercises cancellation, not a browser or online ACC run.
const requestTimeoutMs=180,clientId='11111111-1111-4111-8111-111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve:value=>resolve(value),reject:error=>reject(error)};}
function brokerFixture(t,{pkg={},irRequest,authorize=async()=>{}}){
 const messages=[],states=[],calls=[],authorizationSignals=[];let closes=0;
 const port={onmessage:null,start(){},postMessage:value=>messages.push(structuredClone(value)),close(){closes++;}};
 const broker=createProjectViewBroker({port,pkg,isCurrent:()=>true,requestTimeoutMs,onState:state=>states.push(state),authorize:async options=>{authorizationSignals.push(options.signal);return authorize(options);},irRequest:(operation,input,options)=>{calls.push({operation,input:structuredClone(input),signal:options.signal});return irRequest(operation,input,options);}});
 const receive=port.onmessage;t.after(()=>broker.close());
 return {broker,messages,states,calls,authorizationSignals,send:(id,operation='heartbeat',input={clientId})=>receive({data:{id,type:'ir.request',operation,input}}),get closes(){return closes;},get handler(){return port.onmessage;}};
}
function timedOut(f){assert.deepEqual(f.messages,[{id:1,error:'request-timeout'}]);assert.deepEqual(f.states,['failed']);assert.equal(f.closes,1);assert.equal(f.broker.closed,true);assert.equal(f.handler,null);}
async function drain(){await tick();await tick();}
class Storage{
 values=new Map();writes=0;
 kv={get:key=>structuredClone(this.values.get(key)),put:(key,value)=>{this.writes++;this.values.set(key,structuredClone(value));}};
 transactionSync(callback){const before=structuredClone(this.values);try{return callback();}catch(error){this.values=before;throw error;}}
 async sync(){}
}
class Bucket{
 values=new Map();writes=0;
 async get(key){const bytes=this.values.get(key);return bytes?{arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
 async put(key,bytes){this.writes++;this.values.set(key,Uint8Array.from(bytes));}
}
let graphPromise;
async function authorityFixture(){
 graphPromise??=(async()=>{const root=new URL('../../vendor/riffoid-ir-plugin/',import.meta.url),[runtimeSource,workerSource,pkg]=await Promise.all(['browser/runtime.js','browser/worker.js','package.json'].map(name=>readFile(new URL(name,root),'utf8')));return projectIrFixture({runtimeSource,workerSource,pluginVersion:JSON.parse(pkg).version});})();
 const graph=structuredClone(await graphPromise),storage=new Storage(),bucket=new Bucket();let now=1000;
 const scope={tenantId:'deadline-tenant',projectId:'deadline-project',workspaceId:'deadline-workspace',workspaceGeneration:1};
 const authority=new ProjectIrAuthority(storage,bucket,scope,()=>now,undefined,{userId:'deadline-owner',authVersion:1});
 assert.equal((await authority.register({effectId:'register-b1',registration:graph.registration})).status,'succeeded');
 await authority.browser({operation:'heartbeat',input:{clientId}});
 const command={effectId:'original-run',operation:'project_ir_run',input:{browserArtifactRef:graph.browserArtifactRef}};
 const accepted=await authority.tool(command);assert.equal(accepted.accepted,true);
 return {authority,accepted,command,storage,bucket,advance:ms=>{now+=ms;},runCount:()=>[...storage.values.keys()].filter(key=>key.includes('/runs/')).length,run:()=>structuredClone([...storage.values.entries()].find(([key])=>key.endsWith('/runs/'+accepted.runId))[1].record)};
}
async function expireWithoutReplay(x){
 x.advance(PROJECT_IR_LEASE_MS);
 const result=await x.authority.browser({operation:'project_ir_result',input:{runId:x.accepted.runId}});
 assert.equal(result.status,'interrupted');assert.equal(result.diagnostics[0].code,'browser_disconnected');assert.equal(x.runCount(),1);
 const writes=[x.storage.writes,x.bucket.writes];assert.deepEqual(await x.authority.tool({...x.command,observeOnly:true}),x.accepted);assert.deepEqual([x.storage.writes,x.bucket.writes],writes,'observing the original effect neither renews nor allocates');
 return result;
}

test('an entered IR result read receives the broker signal and its deadline closes the original port only once',{timeout:2000},async t=>{
 const {pkg}=await packaged(),entered=deferred(),reply=deferred();let signal,aborts=0;
 const f=brokerFixture(t,{pkg,irRequest:(operation,input,options)=>{assert.equal(operation,'project_ir_result');assert.deepEqual(input,{runId:'run-00000000-0000-4000-8000-000000000001'});signal=options.signal;signal.addEventListener('abort',()=>aborts++);entered.resolve();return reply.promise;}});
 const pending=f.send(1,'project_ir_result',{runId:'run-00000000-0000-4000-8000-000000000001'});await entered.promise;await pending;
 timedOut(f);assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.authorizationSignals.length,1);assert.equal(f.authorizationSignals[0],signal);
 reply.resolve({status:'succeeded',marker:'PRIVATE_LATE_IR_RESULT'});await drain();
 await f.send(2,'project_ir_result',{runId:'run-00000000-0000-4000-8000-000000000001'});await f.broker.publish();f.broker.close();f.broker.close();
 timedOut(f);assert.equal(f.calls.length,1);assert.equal(aborts,1);assert.equal(f.authorizationSignals.length,1,'late read cannot start a final authorization or another request');
});

test('a durable heartbeat claim whose ACK outlives the RPC deadline cannot renew or replay through its original port',{timeout:2000},async t=>{
 const x=await authorityFixture(),entered=deferred(),reply=deferred();let signal,claim,aborts=0;
 const f=brokerFixture(t,{irRequest:async(operation,input,options)=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);claim=await x.authority.browser({operation,input});assert.equal(claim.run.runId,x.accepted.runId);entered.resolve();return reply.promise;}});
 const pending=f.send(1);await entered.promise;assert.equal(x.run().status,'running');const writes=[x.storage.writes,x.bucket.writes],lastSeen=x.run().lastSeen;await pending;
 timedOut(f);assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.authorizationSignals[0],signal);
 x.advance(PROJECT_IR_LEASE_MS-1);reply.resolve(claim);await drain();for(let id=2;id<=32;id++)await f.send(id);
 timedOut(f);assert.equal(f.calls.length,1);assert.equal(x.run().lastSeen,lastSeen);assert.deepEqual([x.storage.writes,x.bucket.writes],writes,'late ACK and old-port heartbeats cannot refresh durable storage');
 x.advance(1);const original=await x.authority.browser({operation:'project_ir_result',input:{runId:x.accepted.runId}});assert.equal(original.status,'interrupted');assert.equal(original.diagnostics[0].code,'browser_disconnected');assert.equal(x.runCount(),1);
 const reopened=brokerFixture(t,{irRequest:(operation,input)=>x.authority.browser({operation,input})});await reopened.send(1);assert.deepEqual(reopened.messages,[{id:1,value:{connected:true}}]);assert.equal(x.runCount(),1,'reopening does not redispatch the timed-out claim');
});

test('explicit close cancels an entered IR read without a later timeout, response or second port close',{timeout:2000},async t=>{
 const entered=deferred(),reply=deferred();let signal,aborts=0;
 const f=brokerFixture(t,{irRequest:(_operation,_input,options)=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);entered.resolve();return reply.promise;}});
 const pending=f.send(1,'show',{});await entered.promise;f.broker.close();await pending;
 assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.handler,null);reply.resolve({marker:'PRIVATE_LATE_SHOW'});await drain();await delay(requestTimeoutMs+30);
 await f.send(2,'show',{});await f.broker.publish();f.broker.close();assert.deepEqual(f.messages,[]);assert.deepEqual(f.states,[]);assert.equal(f.calls.length,1);assert.equal(f.closes,1);assert.equal(aborts,1);
});

test('explicit close after a persisted heartbeat claim discards the delayed ACK and lets the original lease expire',{timeout:2000},async t=>{
 const x=await authorityFixture(),entered=deferred(),reply=deferred();let signal,claim,aborts=0;
 const f=brokerFixture(t,{irRequest:async(operation,input,options)=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);claim=await x.authority.browser({operation,input});assert.equal(claim.run.runId,x.accepted.runId);entered.resolve();return reply.promise;}});
 const pending=f.send(1);await entered.promise;const writes=[x.storage.writes,x.bucket.writes];f.broker.close();await pending;
 assert.equal(signal.aborted,true);assert.equal(aborts,1);reply.resolve(claim);await drain();await delay(requestTimeoutMs+30);await f.send(2);f.broker.close();
 assert.deepEqual(f.messages,[]);assert.deepEqual(f.states,[]);assert.equal(f.calls.length,1);assert.equal(f.closes,1);assert.equal(f.handler,null);assert.deepEqual([x.storage.writes,x.bucket.writes],writes);
 await expireWithoutReplay(x);
});

for(const lateOutcome of ['success','revocation'])test(`a heartbeat claim withheld at final authorization times out even if late authorization reports ${lateOutcome}`,{timeout:2000},async t=>{
 const x=await authorityFixture(),entered=deferred(),authorization=deferred();let signal,aborts=0,checks=0;
 const f=brokerFixture(t,{authorize:async options=>{if(++checks===2){assert.equal(options.signal,signal);entered.resolve();await authorization.promise;}},irRequest:async(operation,input,options)=>{signal=options.signal;signal.addEventListener('abort',()=>aborts++);const claim=await x.authority.browser({operation,input});assert.equal(claim.run.runId,x.accepted.runId);return claim;}});
 const pending=f.send(1);await entered.promise;const writes=[x.storage.writes,x.bucket.writes];await pending;
 timedOut(f);assert.equal(signal.aborted,true);assert.equal(aborts,1);assert.equal(f.authorizationSignals.length,2);for(const observed of f.authorizationSignals)assert.equal(observed,signal);
 if(lateOutcome==='success')authorization.resolve();else authorization.reject(Error('synthetic-late-revocation'));
 await drain();await f.send(2);f.broker.close();timedOut(f);assert.equal(f.calls.length,1);assert.equal(checks,2);assert.deepEqual([x.storage.writes,x.bucket.writes],writes);
 await expireWithoutReplay(x);
});

test('revocation during final authorization withholds a completed claim and closes the original heartbeat port once',{timeout:2000},async t=>{
 const x=await authorityFixture(),entered=deferred(),release=deferred();let signal,checks=0,authorized=true;
 const f=brokerFixture(t,{authorize:async options=>{if(++checks===2){assert.equal(options.signal,signal);entered.resolve();await release.promise;if(!authorized)throw Error('synthetic-revoked-after-durable-claim');}},irRequest:async(operation,input,options)=>{signal=options.signal;const claim=await x.authority.browser({operation,input});assert.equal(claim.run.runId,x.accepted.runId);return claim;}});
 const pending=f.send(1);await entered.promise;const writes=[x.storage.writes,x.bucket.writes];authorized=false;release.resolve();await pending;
 assert.deepEqual(f.messages,[{id:1,error:'request-denied'}]);assert.deepEqual(f.states,['failed']);assert.equal(f.broker.closed,true);assert.equal(f.handler,null);assert.equal(f.closes,1);assert.equal(signal.aborted,true);
 await f.send(2);await delay(requestTimeoutMs+30);f.broker.close();assert.equal(f.calls.length,1);assert.equal(f.closes,1);assert.deepEqual(f.states,['failed']);assert.equal(f.messages.some(message=>message.value?.run),false);assert.deepEqual([x.storage.writes,x.bucket.writes],writes);
 await expireWithoutReplay(x);
});
