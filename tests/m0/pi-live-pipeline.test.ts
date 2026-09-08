import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedPipeline } from '../../spikes/m0-pi-live/pipeline.ts';
import { MODEL_PROXY_ORIGIN, trustedOutbound } from '../../spikes/m0-pi-live/egress.ts';

function deferred<T>() {
 let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};
}
function fixture() {
 const values=new Map<string,unknown>(),alarms:number[]=[],owned:Promise<unknown>[]=[],calls:string[]=[];
 const storage={kv:{get:<T>(key:string)=>structuredClone(values.get(key)) as T|undefined,put:(key:string,value:unknown)=>{values.set(key,structuredClone(value));}},
  sync:async()=>{},setAlarm:async(at:number)=>{alarms.push(at);}};
 const ctx={storage,waitUntil:(p:Promise<unknown>)=>owned.push(p)} as unknown as DurableObjectState;
 const steps:(()=>Promise<void>)[]=[],cleanup:(()=>Promise<boolean>)[]=[];
 const pipeline=new FixedPipeline(ctx,steps,cleanup);pipeline.operationMs=10;
 return {pipeline,steps,cleanup,storage,alarms,owned,calls,ctx,settled:async()=>{await Promise.all(owned);}};
}

test('pipeline accept is one-shot and close-before-accept persists a tombstone',async()=>{
 const f=fixture();await f.pipeline.close();await assert.rejects(f.pipeline.accept(),/already-used/);
 assert.equal(f.pipeline.state()!.cleanup,'confirmed');assert.equal(f.pipeline.state()!.closed,true);assert.equal(f.alarms.length,0);
 const g=fixture();await g.pipeline.accept();await assert.rejects(g.pipeline.accept(),/already-used/);
 assert.equal(g.pipeline.state()!.step,0);assert.equal(g.alarms.length,1);assert.deepEqual(g.calls,[]);
});

test('ordered successful steps clean once and preserve the completed receipt',async()=>{
 const f=fixture();
 for(const name of ['first','second'])f.steps.push(async()=>{await f.pipeline.effect(name,async()=>{f.calls.push(name);});});
 for(const name of ['trusted-destroy','project-destroy'])f.cleanup.push(async()=>{await f.pipeline.effect(name,async()=>{f.calls.push(name);},true);return true;});
 await f.pipeline.accept();await f.pipeline.alarm();assert.deepEqual(f.calls,['first']);
 await f.pipeline.alarm();assert.deepEqual(f.calls,['first','second']);await f.pipeline.alarm();
 assert.deepEqual(f.calls,['first','second','trusted-destroy','project-destroy']);
 assert.equal(f.pipeline.state()!.phase,'completed');assert.equal(f.pipeline.state()!.cleanup,'confirmed');
 assert.equal(f.pipeline.state()!.operation,null);assert.equal(f.pipeline.state()!.stepStarted,false);
 await f.pipeline.close();await f.pipeline.alarm();assert.equal(f.calls.length,4);await assert.rejects(f.pipeline.accept());
});

for(const outcome of ['resolve','reject'] as const)test(`timed-out effect retains ownership until late ${outcome}, then cleans without replay`,async()=>{
 const f=fixture(),pending=deferred<void>();
 f.steps.push(async()=>{await f.pipeline.effect('create',async()=>{f.calls.push('create');return pending.promise;});f.calls.push('forbidden-continuation');});
 f.steps.push(async()=>{f.calls.push('forbidden-next-step');});
 f.cleanup.push(async()=>{await f.pipeline.effect('destroy',async()=>{f.calls.push('destroy');},true);return true;});
 await f.pipeline.accept();await f.pipeline.alarm();
 assert.equal(f.pipeline.state()!.operation,'create');assert.equal(f.pipeline.state()!.cleanup,'unconfirmed');
 await f.pipeline.close();await f.pipeline.alarm();assert.deepEqual(f.calls,['create']);
 if(outcome==='resolve')pending.resolve();else pending.reject(Error('late-rejection'));
 await f.settled();assert.equal(f.pipeline.state()!.operation,null);assert.ok(f.alarms.length>=2);
 await f.pipeline.alarm();assert.deepEqual(f.calls,['create','destroy']);
 assert.equal(f.pipeline.state()!.phase,'failed');assert.equal(f.pipeline.state()!.cleanup,'confirmed');
 assert.equal(f.pipeline.state()!.error,'effect-outcome-unknown');
});

test('restored in-flight operation refuses replay and cannot assert cleanup',async()=>{
 const f=fixture();await f.pipeline.accept();f.pipeline.set({stepStarted:true,phase:'running',operation:'model-request'});
 const restored=new FixedPipeline(f.ctx,[async()=>{f.calls.push('replayed');}],[async()=>{f.calls.push('unsafe-destroy');return true;}]);
 await restored.alarm();await restored.close();await restored.alarm();
 assert.deepEqual(f.calls,[]);assert.equal(restored.state()!.operation,'model-request');
 assert.equal(restored.state()!.cleanup,'unconfirmed');assert.equal(restored.state()!.error,'interrupted-rpc-needs-independent-reconciliation');
});

test('restored stepStarted fence blocks the settled-effect/step-commit replay gap',async()=>{
 const f=fixture();await f.pipeline.accept();f.pipeline.set({stepStarted:true,phase:'running',operation:null});
 const restored=new FixedPipeline(f.ctx,[async()=>{f.calls.push('replayed');}],[async()=>{f.calls.push('destroy');return true;}]);
 await restored.alarm();assert.deepEqual(f.calls,['destroy']);
 assert.equal(restored.state()!.phase,'failed');assert.equal(restored.state()!.cleanup,'confirmed');
});

test('ordinary step failure enters cleanup and never advances the next step',async()=>{
 const f=fixture();f.steps.push(async()=>{await f.pipeline.effect('failure',async()=>{f.calls.push('failure');throw Error('synthetic-error');});});
 f.steps.push(async()=>{f.calls.push('forbidden');});f.cleanup.push(async()=>{f.calls.push('destroy');return true;});
 await f.pipeline.accept();await f.pipeline.alarm();assert.deepEqual(f.calls,['failure','destroy']);
 assert.equal(f.pipeline.state()!.phase,'failed');assert.equal(f.pipeline.state()!.error,'fixed-step-failed');assert.equal(f.pipeline.state()!.step,0);
});

test('close while step intent persists prevents even synchronous step entry',async()=>{
 const f=fixture();f.steps.push(async()=>{f.calls.push('forbidden-dispatch');});f.cleanup.push(async()=>{f.calls.push('destroy');return true;});
 await f.pipeline.accept();let first=true;
 f.storage.sync=async()=>{if(first){first=false;await f.pipeline.close();}};
 await f.pipeline.alarm();assert.deepEqual(f.calls,['destroy']);assert.equal(f.pipeline.state()!.phase,'failed');
});

test('expired runs clean without starting an operation',async()=>{
 const f=fixture();f.steps.push(async()=>{f.calls.push('forbidden');});f.cleanup.push(async()=>{f.calls.push('destroy');return true;});
 await f.pipeline.accept();f.pipeline.set({deadline:Date.now()-1});await f.pipeline.alarm();
 assert.deepEqual(f.calls,['destroy']);assert.equal(f.pipeline.state()!.error,'run-deadline');
});

test('partial cleanup retries only unconfirmed cleanup entries on explicit close',async()=>{
 const f=fixture();let available=false;
 f.cleanup.push(async()=>{f.calls.push('one');return true;},async()=>{f.calls.push('two');return available;});
 await f.pipeline.accept();await f.pipeline.alarm();assert.equal(f.pipeline.state()!.cleanup,'unconfirmed');
 available=true;await f.pipeline.close();await f.pipeline.alarm();
 assert.deepEqual(f.calls,['one','two','two']);assert.equal(f.pipeline.state()!.cleanup,'confirmed');
});

test('overlapping alarm observation cannot execute a step twice',async()=>{
 const f=fixture(),started=deferred<void>(),pending=deferred<void>();f.pipeline.operationMs=1000;
 f.steps.push(async()=>{await f.pipeline.effect('one',async()=>{f.calls.push('one');started.resolve();await pending.promise;});});
 await f.pipeline.accept();const first=f.pipeline.alarm();await started.promise;await f.pipeline.alarm();
 assert.deepEqual(f.calls,['one']);pending.resolve();await first;await f.settled();
 assert.equal(f.pipeline.state()!.step,1);
});

test('trusted model response preserves the upstream request ID but not secret headers',async()=>{
 const capability=`m0p.synthetic-run.${'a'.repeat(64)}.${'b'.repeat(64)}`;
 const request=new Request(MODEL_PROXY_ORIGIN+'/v1/chat/completions',{method:'POST',body:'{}',headers:{authorization:`Bearer ${capability}`,'content-type':'application/json'}});
 const result=await trustedOutbound(request,async()=>new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream','x-riffology-upstream-request-id':'synthetic-provider-request-id',authorization:'secret','set-cookie':'secret'}}));
 assert.equal(result.status,200);assert.equal(result.headers.get('x-riffology-upstream-request-id'),'synthetic-provider-request-id');
 assert.equal(result.headers.get('authorization'),null);assert.equal(result.headers.get('set-cookie'),null);
});
