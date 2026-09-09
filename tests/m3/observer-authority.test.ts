import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeObserver,type ObserverAuthorityPorts} from '../../services/preview/observer-authority.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
import type {PreviewBinding} from '../../services/preview/bindings.ts';
import type {ServiceRunRecord} from '../../services/run/service.ts';
import {scope,actor,spec,reference} from './run-fixture.ts';
function fixture(){
 const command:ObserverCommand={schemaVersion:1,purpose:'observer',scope,sessionId:'session-current',turnId:'turn-current',dispatchId:'dispatch-current',commandId:'call-a',previewId:'preview-a',operation:'snapshot',deadlineAt:4500};
 const identity={scope,sessionId:command.sessionId,turnId:command.turnId,dispatchId:command.dispatchId,generation:1};
 const plan=spec();plan.plan.declaration.observation={pagePath:'/observe',statePath:'/state'};
 const runtime=reference('run-a');
 const binding:PreviewBinding={previewId:'preview-a',scope,runId:'run-a',source:plan.plan.source,runtime,createdAt:1000,expiresAt:5000,revokedAt:null,reason:null};
 const run:ServiceRunRecord={id:'run-a',kind:'service',scope,actor,spec:plan,status:'running',createdAt:1000,updatedAt:1000,startedAt:1000,stopRequestedAt:null,runtime,errorCode:null};
 let enabled=true,current=true,live=true,lease=4000;const events:string[]=[];
 const ports:ObserverAuthorityPorts={enabled:()=>enabled,caller(){events.push('caller');if(!live)throw Error('cancelled');return structuredClone({actor,identity});},async membership(a,s){events.push('membership');assert.deepEqual(a,actor);assert.deepEqual(s,scope);},async runtime(i){events.push('runtime');assert.deepEqual(i,identity);return {expiresAt:lease};},async target(id){events.push('target');assert.equal(id,command.previewId);return structuredClone({binding,run});},current(b){events.push('current');return current&&JSON.stringify(b)===JSON.stringify(binding);}};
 return {command,identity,binding,run,ports,events,set enabled(v:boolean){enabled=v;},set current(v:boolean){current=v;},set live(v:boolean){live=v;},set lease(v:number){lease=v;}};
}
test('Observer authority binds the current caller and immutable service while clipping runtime expiry',async()=>{
 const f=fixture(),result=await authorizeObserver(f.command,f.ports,()=>2000);
 assert.equal(result.expiresAt,4000);assert.equal(result.binding.previewId,'preview-a');assert.deepEqual(result.paths,{pagePath:'/observe',statePath:'/state'});assert.match(result.targetDigest,/^[a-f0-9]{64}$/);
 assert.equal(f.events.filter(v=>v==='membership').length,2);assert.equal(f.events.filter(v=>v==='runtime').length,2);assert.equal(f.events.at(-1),'current');
 result.actor.userId='changed';result.binding.runtime.runtimeId='changed';assert.equal(actor.userId,'user-a');assert.equal(f.binding.runtime.runtimeId,'runtime-a');
});
test('disabled plugin and mismatched current caller deny before remote access',async()=>{
 const f=fixture();f.enabled=false;await assert.rejects(authorizeObserver(f.command,f.ports,()=>2000),/observer-authority-denied/);assert.deepEqual(f.events,[]);
 const other=fixture();other.ports.caller=()=>({actor,identity:{...other.identity,dispatchId:'other'}});await assert.rejects(authorizeObserver(other.command,other.ports,()=>2000),/observer-authority-denied/);assert.deepEqual(other.events,[]);
});
test('revoked membership, expired runtime, missing declaration and mismatched target cannot grant access',async()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.ports.membership=async()=>{throw Error('revoked');};},(f:ReturnType<typeof fixture>)=>{f.lease=2000;},(f:ReturnType<typeof fixture>)=>{delete f.run.spec.plan.declaration.observation;},(f:ReturnType<typeof fixture>)=>{f.binding.previewId='other';}]){
  const f=fixture();mutate(f);await assert.rejects(authorizeObserver(f.command,f.ports,()=>2000),/observer-authority-denied/);
 }
});
test('target replacement during remote checks and cancellation at final checks reject results',async()=>{
 const f=fixture();let reads=0;const target=f.ports.target;f.ports.target=async id=>{const value=await target(id);if(++reads===2){value.binding.createdAt=1001;}return value;};
 await assert.rejects(authorizeObserver(f.command,f.ports,()=>2000),/observer-target-stale/);
 for(const invalidate of [(g:ReturnType<typeof fixture>)=>{g.current=false;},(g:ReturnType<typeof fixture>)=>{g.live=false;},(g:ReturnType<typeof fixture>)=>{g.enabled=false;}]){
  const g=fixture();let calls=0;const runtime=g.ports.runtime;g.ports.runtime=async id=>{const value=await runtime(id);if(++calls===2)invalidate(g);return value;};
  await assert.rejects(authorizeObserver(g.command,g.ports,()=>2000),/observer-target-stale|observer-authority-denied/);
 }
});
test('authority deadline interrupts noncooperative runtime reads without reaching target',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
 f.ports.runtime=()=>{started();return new Promise(()=>{});};
 const pending=authorizeObserver(f.command,f.ports,()=>2000);await ready;t.mock.timers.tick(2500);
 await assert.rejects(pending,/observer-authority-timeout/);assert.equal(f.events.includes('target'),false);
});
