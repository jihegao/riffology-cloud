import test from 'node:test';
import assert from 'node:assert/strict';
import {readObserverArtifact,observerArtifactReadInput,type ObserverArtifactReadPorts} from '../../services/workspace/observer-artifact-read.ts';
import {observerArtifactDescriptor} from '../../services/preview/observer-artifacts.ts';
import type {ObserverCallRecord} from '../../services/preview/observer-calls.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
const command:ObserverCommand={schemaVersion:1,purpose:'observer',scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',commandId:'command',previewId:'preview',operation:'snapshot',deadlineAt:10000};
const input={scope,actor:{userId:'user',authVersion:2},turnId:'turn',commandId:'command',part:'state' as const};
async function fixture(){
 const content=new TextEncoder().encode(JSON.stringify({simulation_state_id:'sample',sequence:1,state:{}}));
 const {receipt}=await observerArtifactDescriptor(command,'state',content);
 const record:ObserverCallRecord={command,targetDigest:'a'.repeat(64),status:'completed',acceptedAt:1,startedAt:2,finishedAt:3,errorCode:null,result:{schemaVersion:1,operation:'snapshot',previewId:'preview',runtimeGeneration:1,state:{artifact:receipt}}};
 let grants=0,reads=0,retained:(()=>Promise<unknown>)|undefined;
 const ports:ObserverArtifactReadPorts={
  authorize:async()=>{grants++;return {scope,sessionId:'session',turnId:'turn',dispatchId:'dispatch',generation:1};},
  lookup:async()=>structuredClone(record),
  read:async(_selection,authorize)=>{reads++;retained=authorize;await authorize();return {receipt,content};},
 };
 return {ports,record,receipt,content,get reads(){return reads;},get grants(){return grants;},late:()=>retained!()};
}
test('historical content is copied and retained read authority closes on success',async()=>{
 const f=await fixture(),result=await readObserverArtifact(input,f.ports);
 assert.deepEqual(result.content,f.content);assert.notEqual(result.content,f.content);assert.equal(f.reads,1);assert.ok(f.grants>=6);
 await assert.rejects(f.late(),/expired/);
});
test('current ACL failure and unmatched session reject before executor read',async()=>{
 for(const mode of ['denied','session']){
  const f=await fixture();f.ports.authorize=async()=>{if(mode==='denied')throw Error('revoked');return {scope,sessionId:'other',turnId:'turn',dispatchId:'dispatch',generation:1};};
  await assert.rejects(readObserverArtifact(input,f.ports));assert.equal(f.reads,0);
 }
});
test('missing, incomplete and mismatched durable references never reach storage',async()=>{
 for(const change of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.ports.lookup=async()=>null;},(f:Awaited<ReturnType<typeof fixture>>)=>{f.record.status='unknown';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.record.command={...command,dispatchId:'other'};},(f:Awaited<ReturnType<typeof fixture>>)=>{f.record.result!.previewId='other';},(f:Awaited<ReturnType<typeof fixture>>)=>{f.record.result!.state={artifact:{...f.receipt,kind:'view'}};}]){
  const f=await fixture();change(f);await assert.rejects(readObserverArtifact(input,f.ports));assert.equal(f.reads,0);
 }
});
test('revocation during read and bytes or receipt substitution fail without disclosure',async()=>{
 for(const mode of ['revoked','content','receipt','extra']){
  const f=await fixture(),original=f.ports.read;f.ports.read=async(selection,authorize)=>{
   const r=await original(selection,authorize);
   if(mode==='revoked')f.ports.authorize=async()=>{throw Error('revoked');};
   if(mode==='content')r.content=Uint8Array.from(r.content,n=>n^1);
   if(mode==='receipt')r.receipt={...f.receipt,artifactId:'b'.repeat(64)};
   if(mode==='extra')return {...r,objectKey:'private'};
   return r;
  };
  await assert.rejects(readObserverArtifact(input,f.ports));await assert.rejects(f.late(),/expired/);
 }
});
test('read input rejects getters, extra keys and receipt selection without evaluating accessors',()=>{
 let evaluated=false;
 for(const raw of [{...input,receipt:{}},{...input,part:'screenshot'},{...input,actor:{get userId(){evaluated=true;return 'user';},authVersion:2}},{...input,scope:{...scope,[Symbol('extra')]:true}}])assert.throws(()=>observerArtifactReadInput(raw));
 assert.equal(evaluated,false);
});
test('absolute read deadline closes hanging work and subsequent capability use',async()=>{
 const f=await fixture();let retained:(()=>Promise<unknown>)|undefined;f.ports.read=async(_selection,authorize)=>{retained=authorize;await authorize();return new Promise(()=>{});};
 const before=Date.now();await assert.rejects(readObserverArtifact(input,f.ports),/expired/);assert.ok(Date.now()-before<6500);
 await assert.rejects(retained!(),/expired/);
});
