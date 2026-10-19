import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ProjectIrAuthority,PROJECT_IR_LEASE_MS} from '../../services/project-ir/authority.ts';
import {createProjectViewBroker} from '../../services/web/project-views.js';
import {projectIrFixture} from './project-ir-fixture.ts';

// Actual production core + broker and compiler B1 graph, synthetic KV/R2 and
// original-port transport. Node executes the shared runtime only where stated;
// these tests do not claim a browser execution or an online ACC conversation.
const scope={tenantId:'tenant-heartbeat',projectId:'project-heartbeat',workspaceId:'workspace-heartbeat',workspaceGeneration:1};
const actor={userId:'owner-heartbeat',authVersion:1};
const clientId='11111111-1111-4111-8111-111111111111';
const nextClient='22222222-2222-4222-8222-222222222222';
class Storage{
 values=new Map();writes=0;failNextTransaction=false;afterSync;
 kv={get:key=>structuredClone(this.values.get(key)),put:(key,value)=>{this.writes++;this.values.set(key,structuredClone(value));}};
 transactionSync(callback){if(this.failNextTransaction){this.failNextTransaction=false;throw Error('synthetic-KV-transaction-failed');}const old=structuredClone(this.values);try{return callback();}catch(error){this.values=old;throw error;}}
 async sync(){this.afterSync?.();}
}
class Bucket{
 values=new Map();writes=0;
 async get(key){const bytes=this.values.get(key);return bytes?{arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
 async put(key,bytes){this.writes++;this.values.set(key,Uint8Array.from(bytes));}
}
let shared;
async function setup(){
 if(!shared){const root=new URL('../../vendor/riffoid-ir-plugin/',import.meta.url),[runtimeSource,workerSource,pkg]=await Promise.all(['browser/runtime.js','browser/worker.js','package.json'].map(name=>readFile(new URL(name,root),'utf8')));shared=await projectIrFixture({runtimeSource,workerSource,pluginVersion:JSON.parse(pkg).version});}
 const f=structuredClone(shared),storage=new Storage(),bucket=new Bucket();let now=1000;
 const p=new ProjectIrAuthority(storage,bucket,scope,()=>now,undefined,actor);
 assert.equal((await p.register({effectId:'register-b1',registration:f.registration})).status,'succeeded');
 await p.browser({operation:'heartbeat',input:{clientId}});
 const command={effectId:'original-run',operation:'project_ir_run',input:{browserArtifactRef:f.browserArtifactRef}};
 const accepted=await p.tool(command);assert.equal(accepted.accepted,true);
 return {p,f,storage,bucket,command,accepted,advance:ms=>{now+=ms;},runCount:()=>[...storage.values.keys()].filter(key=>key.includes('/runs/')).length};
}
function client(p,{request=(operation,input)=>p.browser({operation,input}),authorize=async()=>{},post}={}){
 const messages=[],states=[],calls=[];let closes=0;
 const port={onmessage:null,start(){},close(){closes++;},postMessage(value){post?.(value);messages.push(structuredClone(value));}};
 const broker=createProjectViewBroker({port,pkg:{},isCurrent:()=>true,authorize,onState:state=>states.push(state),irRequest:async(operation,input)=>{calls.push({operation,input:structuredClone(input)});return request(operation,input);}});
 const receive=port.onmessage;
 return {broker,messages,states,calls,port,get closes(){return closes;},send:(id,operation='heartbeat',input={clientId})=>receive({data:{id,type:'ir.request',operation,input}})};
}
async function expires(x){x.advance(PROJECT_IR_LEASE_MS);return x.p.browser({operation:'project_ir_result',input:{runId:x.accepted.runId}});}

test('lost claim ACK closes the original broker, blocks old-client renewal and preserves only one original run',async()=>{
 const x=await setup(),c=client(x.p,{request:async(operation,input)=>{const value=await x.p.browser({operation,input});assert.equal(value.run?.runId,x.accepted.runId);throw Error('synthetic-HTTP-503-after-durable-claim');}});
 await c.send(1);assert.equal(c.broker.closed,true);assert.equal(c.port.onmessage,null);assert.equal(c.closes,1);assert.deepEqual(c.states,['failed']);
 assert.deepEqual(c.messages,[{id:1,error:'request-denied'}]);
 for(let id=2;id<=32;id++){x.advance(1000);await c.send(id);}
 assert.equal(c.calls.length,1,'retained original port/client token cannot issue another RPC after uncertain delivery');
 assert.equal(c.messages.some(reply=>reply.value?.run),false,'the browser never received an executable claim');
 const original=await x.p.browser({operation:'project_ir_result',input:{runId:x.accepted.runId}});assert.equal(original.status,'interrupted');assert.equal(original.diagnostics[0].code,'browser_disconnected');assert.equal(x.runCount(),1);
 const before=[x.storage.writes,x.bucket.writes];assert.deepEqual(await x.p.tool({...x.command,observeOnly:true}),x.accepted);assert.deepEqual([x.storage.writes,x.bucket.writes],before,'original-effect observation only reads the frozen pending acknowledgement');
 const reopened=client(x.p);await reopened.send(1,'project_ir_result',{runId:original.runId});assert.deepEqual(reopened.messages[0].value,original);
 await reopened.send(2);assert.deepEqual(reopened.messages[1].value,{connected:true});assert.equal(x.runCount(),1,'reopening with the same client never redispatches its old run');
 assert.equal(reopened.messages.some(reply=>reply.value?.run),false);reopened.broker.close();
});

test('successful original-client heartbeats do not repeat physical execution; explicit replay gets a new frozen run',async()=>{
 const x=await setup(),c=client(x.p);await c.send(1);const first=c.messages[0].value;
 assert.equal(first.run.runId,x.accepted.runId);await c.send(2);assert.deepEqual(c.messages[1].value,{connected:true});
 let executions=0;const compute=async claim=>{executions++;const runtime=await import('data:text/javascript;base64,'+Buffer.from(claim.runtimeSource).toString('base64'));const result=runtime.executePlan(claim.artifact.plan,claim.run.inputs);return {...result,planFingerprint:claim.run.planFingerprint};};
 const saved=await x.p.browser({operation:'submit',input:{clientId,runId:first.run.runId,result:await compute(first)}});assert.equal(saved.status,'succeeded');
 await c.send(3);assert.deepEqual(c.messages[2].value,{connected:true});assert.deepEqual(await x.p.tool({...x.command,observeOnly:true}),x.accepted);assert.equal(executions,1);assert.equal(x.runCount(),1);
 assert.equal(c.messages.filter(reply=>reply.value?.run).length,1,'same client and original effect are idempotent without another execution payload');
 await x.p.browser({operation:'heartbeat',input:{clientId:nextClient}});
 const replay=await x.p.tool({effectId:'explicit-source-replay',operation:'project_ir_run',input:{sourceRunId:saved.runId}});assert.notEqual(replay.runId,saved.runId);
 const next=client(x.p);await next.send(1,'heartbeat',{clientId:nextClient});const claim=next.messages[0].value;
 assert.equal(claim.run.sourceRunId,saved.runId);assert.equal(claim.run.browserArtifactRef,saved.browserArtifactRef);assert.equal(claim.runtimeSource,first.runtimeSource);assert.equal(claim.workerSource,first.workerSource);assert.deepEqual(claim.run.inputs,saved.inputs);
 const repeated=await x.p.browser({operation:'submit',input:{clientId:nextClient,runId:replay.runId,result:await compute(claim)}});assert.equal(repeated.status,'succeeded');assert.deepEqual(repeated.metrics,saved.metrics);assert.deepEqual(repeated.events,saved.events);
 await next.send(2,'heartbeat',{clientId:nextClient});assert.deepEqual(next.messages[1].value,{connected:true});assert.equal(executions,2);assert.equal(x.runCount(),2);c.broker.close();next.broker.close();
});

test('a structured failed heartbeat after actual expired-run cleanup also closes instead of continuing its lease loop',async()=>{
 const x=await setup();assert.equal((await x.p.browser({operation:'heartbeat',input:{clientId}})).run.runId,x.accepted.runId);
 x.advance(PROJECT_IR_LEASE_MS);
 // The expired run is committed first; the later client publication fails. The
 // real core returns a business diagnostic after that partial cleanup.
 x.storage.afterSync=()=>{x.storage.afterSync=undefined;x.storage.failNextTransaction=true;};
 let coreReply;const c=client(x.p,{request:async(operation,input)=>{coreReply=await x.p.browser({operation,input});return coreReply;}});
 await c.send(1);assert.equal(coreReply.status,'failed');assert.equal(coreReply.diagnostics[0].code,'storage_failed');assert.equal(c.broker.closed,true);assert.deepEqual(c.states,['failed']);
 await c.send(2);assert.equal(c.calls.length,1);assert.equal(x.runCount(),1);
 const original=await x.p.browser({operation:'project_ir_result',input:{runId:x.accepted.runId}});assert.equal(original.status,'interrupted');assert.equal(original.diagnostics[0].code,'browser_disconnected');
});

test('oversized, malformed, undeliverable and finally unauthorized heartbeat replies close without resending the claim',async()=>{
 for(const mode of ['oversized','malformed','port-lost','final-authorization']){
  const x=await setup();let checks=0;
  const c=client(x.p,{authorize:async()=>{if(mode==='final-authorization'&&++checks===2)throw Error('synthetic-revoked-after-claim');},post:value=>{if(mode==='port-lost'&&Object.hasOwn(value,'value'))throw Error('synthetic-original-port-unavailable');},request:async(operation,input)=>{const value=await x.p.browser({operation,input});if(mode==='oversized')value.padding='x'.repeat(513*1024);if(mode==='malformed')value.connected=false;return value;}});
  await assert.doesNotReject(c.send(1),mode);assert.equal(c.broker.closed,true,mode);assert.equal(c.closes,1,mode);assert.deepEqual(c.states,['failed'],mode);
  assert.equal(c.messages.some(reply=>reply.value?.run),false,mode);await c.send(2);assert.equal(c.calls.length,1,mode);
  assert.equal((await expires(x)).status,'interrupted',mode);assert.equal(x.runCount(),1,mode);
 }
});
