import assert from 'node:assert/strict';
import test from 'node:test';
import { TrustedPiExecutionAdapter, trustedPiExecutionLimits, type TrustedPiHostObservation, type TrustedPiHostPort } from '../../services/turn-runtime/pi-execution.ts';
import type { TurnRuntimeIdentity } from '../../services/turn-runtime/identity.ts';

const identity:TurnRuntimeIdentity={scope:{tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2};
const actor={userId:'user-a',authVersion:1};
const base={workspace:null,session:null};
const stop={confirmationId:'stop-a',observedAt:1010,nativeRunning:false as const,fenced:true as const};
const artifact={schemaVersion:1 as const,artifactId:`artifact-${'a'.repeat(60)}`,operation:'list' as const,mediaType:'application/json' as const,bytes:20000,sha256:'b'.repeat(64),createdAt:1000};
function running(overrides:Partial<TrustedPiHostObservation>={}):TrustedPiHostObservation{return {identity,phase:'running',outcome:null,executionErrorCode:null,events:[],stopped:null,...overrides};}
function fixture(){const calls:string[]=[];let start=running(),observe=running(),cancel=running();const host:TrustedPiHostPort={async start(){calls.push('start');return start;},async observe(){calls.push('observe');return observe;},async cancel(){calls.push('cancel');return cancel;}};return {calls,adapter:new TrustedPiExecutionAdapter(host),setStart(v:TrustedPiHostObservation){start=v;},setObserve(v:TrustedPiHostObservation){observe=v;},setCancel(v:TrustedPiHostObservation){cancel=v;}};}

test('maps bounded Trusted Pi events to deterministic product runtime events',async()=>{
  const f=fixture();f.setStart(running({events:[
    {sequence:1,at:1001,kind:'provider.status',state:'requesting',status:null,requestId:null},
    {sequence:2,at:1002,kind:'assistant.delta',text:'hello'},
    {sequence:3,at:1003,kind:'tool.started',toolCallId:'call-a',name:'project_list'},
    {sequence:4,at:1004,kind:'tool.updated',toolCallId:'call-a',name:'project_list',summary:'reading'},
    {sequence:5,at:1005,kind:'tool.completed',toolCallId:'call-a',name:'project_list',isError:false,artifact},
    {sequence:6,at:1006,kind:'assistant.message',text:'done',stopReason:'stop'},
    {sequence:7,at:1007,kind:'provider.status',state:'responding',status:200,requestId:'request-a'},
  ]}));
  const one=await f.adapter.start({...identity,actor,message:'build',base}),two=await f.adapter.start({...identity,actor,message:'build',base});
  assert.deepEqual(one.events!.map(item=>item.type),['provider.status','assistant.delta','tool.started','tool.updated','tool.completed','assistant.message','provider.status']);assert.deepEqual(two.events,one.events);assert.match(one.events![0]!.eventId,/^pi-[a-f0-9]{64}$/);assert.deepEqual(f.calls,['start','start']);
  assert.deepEqual(one.events![4]!.payload,{toolCallId:'call-a',name:'project_list',isError:false,artifact});
  f.setObserve(running({events:[{sequence:2,at:1002,kind:'assistant.delta',text:'changed'}]}));const changed=await f.adapter.observe(identity);assert.equal(changed.events![0]!.eventId,one.events![1]!.eventId);assert.notDeepEqual(changed.events![0]!.payload,one.events![1]!.payload);
});

test('maps starting to running and accepts terminal only with fenced native stop',async()=>{
  const f=fixture();f.setStart(running({phase:'starting'}));assert.equal((await f.adapter.start({...identity,actor,message:'go',base})).phase,'running');
  f.setObserve(running({phase:'terminal',outcome:'completed',stopped:stop}));const settled=await f.adapter.observe(identity);assert.equal(settled.phase,'terminal');assert.equal(settled.outcome,'completed');assert.deepEqual(settled.stopped,stop);
  f.setCancel(running({phase:'terminal',outcome:'cancelled',stopped:stop}));assert.equal((await f.adapter.cancel(identity)).outcome,'cancelled');
});

test('rejects host identity mismatch, malformed terminal and nonmonotonic events',async()=>{
  const f=fixture();f.setObserve(running({identity:{...identity,dispatchId:'dispatch-b'}}));await assert.rejects(f.adapter.observe(identity),/scope-denied/);
  f.setObserve(running({phase:'terminal',outcome:'completed',stopped:null}));await assert.rejects(f.adapter.observe(identity),/host-observation/);
  f.setObserve(running({events:[{sequence:2,at:1002,kind:'assistant.delta',text:'a'},{sequence:1,at:1003,kind:'assistant.delta',text:'b'}]}));await assert.rejects(f.adapter.observe(identity),/host-observation/);
});

test('rejects forged tool names, oversized text, excessive events and events on unknown',async()=>{
  const f=fixture();f.setObserve(running({events:[{sequence:1,at:1001,kind:'tool.started',toolCallId:'call-a',name:'bash'} as any]}));await assert.rejects(f.adapter.observe(identity),/host-event/);
  f.setObserve(running({events:[{sequence:1,at:1001,kind:'assistant.delta',text:'x'.repeat(trustedPiExecutionLimits.maxTextBytes+1)}]}));await assert.rejects(f.adapter.observe(identity),/host-event/);
  f.setObserve(running({events:Array.from({length:trustedPiExecutionLimits.maxEvents+1},(_,i)=>({sequence:i+1,at:1001+i,kind:'assistant.delta' as const,text:'x'}))}));await assert.rejects(f.adapter.observe(identity),/host-observation/);
  f.setObserve(running({phase:'unknown',events:[{sequence:1,at:1001,kind:'assistant.delta',text:'x'}]}));await assert.rejects(f.adapter.observe(identity),/host-observation/);
  f.setObserve(running({events:[{sequence:1,at:1001,kind:'tool.completed',toolCallId:'call-a',name:'project_list',isError:false,artifact:{...artifact,artifactId:'../object-key'}} as any]}));await assert.rejects(f.adapter.observe(identity),/host-event/);
  f.setObserve(running({events:[{sequence:1,at:1001,kind:'tool.completed',toolCallId:'call-a',name:'project_list',isError:true,artifact} as any]}));await assert.rejects(f.adapter.observe(identity),/host-event/);
});

test('module is isolated from M0 probes, provider configuration and project filesystem',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../../services/turn-runtime/pi-execution.ts',import.meta.url),'utf8'));
  assert.doesNotMatch(source,/proxy-pi|go-pi-probe|m0-|providerDefinitions|resolveCredential|\/workspace|globalThis\.fetch/);
});
