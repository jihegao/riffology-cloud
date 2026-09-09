import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {R2ObserverArtifacts,observerArtifactDescriptor,observerArtifactReceipt,type ObserverArtifactBucket} from '../../services/preview/observer-artifacts.ts';
import type {ObserverCommand} from '../../services/preview/observer-protocol.ts';
const command=():ObserverCommand=>({schemaVersion:1,purpose:'observer',scope:{tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1},sessionId:'session',turnId:'turn',dispatchId:'dispatch',commandId:'command',previewId:'preview',operation:'snapshot',deadlineAt:1});
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const state=()=>encode({simulation_state_id:'state',sequence:0,state:{queue:2}});
function png(){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);const d=new DataView(b.buffer);d.setUint32(8,13);d.setUint32(12,0x49484452);d.setUint32(16,1280);d.setUint32(20,720);b[24]=8;b[25]=6;return b;}
function fixture(){const objects=new Map<string,Uint8Array>();let puts=0,gets=0,lost=false,fail=false;const bucket={async put(key:string,value:Uint8Array,options:any){puts++;assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});if(fail)throw Error('offline');if(!objects.has(key))objects.set(key,Uint8Array.from(value));if(lost)throw Error('lost-ack');return null;},async get(key:string){gets++;const bytes=objects.get(key);return bytes?{size:bytes.length,body:new ReadableStream({start(c){c.enqueue(Uint8Array.from(bytes));c.close();}})}:null;}} as unknown as ObserverArtifactBucket;return{objects,bucket,store:new R2ObserverArtifacts(bucket),stats:()=>({puts,gets}),lose:()=>{lost=true;},fail:()=>{fail=true;}};}
test('Observer artifact identity binds complete historical command, kind and content; receipt does not expose keys',async()=>{
 const c=command(),bytes=state(),a=await observerArtifactDescriptor(c,'state',bytes);assert.equal(a.receipt.sha256,createHash('sha256').update(bytes).digest('hex'));assert.match(a.objectKey,/^observer-artifacts\/tenant\/project\/workspace\/1\/turn\/dispatch\/command\/[a-f0-9]{64}$/);assert.deepEqual(observerArtifactReceipt(a.receipt),a.receipt);assert.equal('objectKey'in a.receipt,false);
 for(const changed of [{...c,sessionId:'other'},{...c,previewId:'other'},{...c,operation:'reload' as const},{...c,deadlineAt:2},{...c,scope:{...c.scope,workspaceGeneration:2}},{...c,turnId:'other'},{...c,dispatchId:'other'},{...c,commandId:'other'}])assert.notEqual((await observerArtifactDescriptor(changed,'state',bytes)).receipt.artifactId,a.receipt.artifactId);
 assert.notEqual((await observerArtifactDescriptor(c,'view',bytes)).receipt.artifactId,a.receipt.artifactId);
 await assert.rejects(observerArtifactDescriptor({...c,turnId:'../escape'},'state',bytes));
});
test('Observer immutable store verifies readback, replays and lost put acknowledgements',async()=>{
 const f=fixture(),c=command(),bytes=state(),receipt=await f.store.save(c,'state',bytes);assert.deepEqual(await f.store.read(c,receipt),bytes);assert.deepEqual(await f.store.save(c,'state',bytes),receipt);assert.equal(f.objects.size,1);f.lose();assert.deepEqual(await f.store.save(c,'view',encode({snapshot:'view'})),(await observerArtifactDescriptor(c,'view',encode({snapshot:'view'}))).receipt);
 const failed=fixture();failed.fail();await assert.rejects(failed.store.save(c,'state',bytes));
});
test('Observer store copies command and content before its first asynchronous boundary',async()=>{
 const f=fixture(),c=command(),bytes=state(),expected=await observerArtifactDescriptor(c,'state',bytes),pending=f.store.save(c,'state',bytes);bytes.fill(0);c.scope.tenantId='other';c.deadlineAt=42;assert.deepEqual(await pending,expected.receipt);assert.deepEqual(await f.store.read(command(),expected.receipt),state());
});
test('Observer receipt scope, tampering, missing object and corruption are rejected',async()=>{
 const f=fixture(),c=command(),receipt=await f.store.save(c,'state',state()),key=(await observerArtifactDescriptor(c,'state',state())).objectKey;
 const before=f.stats().gets;await assert.rejects(f.store.read({...c,scope:{...c.scope,tenantId:'other'}},receipt));assert.equal(f.stats().gets,before);
 await assert.rejects(f.store.read(c,{...receipt,bytes:receipt.bytes+1}));await assert.rejects(f.store.read(c,{...receipt,sha256:'0'.repeat(64)}));f.objects.set(key,encode({simulation_state_id:'state',sequence:0,state:{queue:3}}));await assert.rejects(f.store.read(c,receipt));await assert.rejects(f.store.save(c,'state',state()));assert.deepEqual(f.objects.get(key),encode({simulation_state_id:'state',sequence:0,state:{queue:3}}));f.objects.delete(key);await assert.rejects(f.store.read(c,receipt));
});
test('Observer receipt validation is closed, bounded and never invokes accessors',async()=>{
 const r=(await observerArtifactDescriptor(command(),'state',state())).receipt;let calls=0;const getter={...r};Object.defineProperty(getter,'kind',{enumerable:true,get(){calls++;return 'state';}});
 for(const raw of [getter,{...r,objectKey:'x'},{...r,bytes:65537},{...r,bytes:0},{...r,mediaType:'image/png'},{...r,artifactId:'../x'},Object.assign(Object.create(null),r)])assert.throws(()=>observerArtifactReceipt(raw));assert.equal(calls,0);
});
test('Observer JSON validation rejects malformed UTF8, nonobjects, state shape, infinity, depth and byte overflow',async()=>{
 const f=fixture();for(const bytes of [new Uint8Array([0xc3,0x28]),encode([]),encode(null),new TextEncoder().encode('{"n":1e999}'),new Uint8Array(512*1024+1)])await assert.rejects(f.store.save(command(),'view',bytes));
 let deep:unknown={};for(let i=0;i<34;i++)deep={child:deep};await assert.rejects(f.store.save(command(),'view',encode(deep)));await assert.rejects(f.store.save(command(),'state',encode({state:{}})));await assert.rejects(f.store.save(command(),'state',new Uint8Array(65537)));assert.equal(f.stats().puts,0);
 const max=encode({text:'x'.repeat(512*1024-11)});assert.equal(max.length,512*1024);assert.equal((await f.store.save(command(),'view',max)).bytes,max.length);
});
test('Observer PNG checks signature, IHDR dimensions and basic encoding, without claiming pixel decoding',async()=>{
 const f=fixture(),bytes=png(),r=await f.store.save(command(),'screenshot',bytes);assert.equal(r.mediaType,'image/png');assert.deepEqual(await f.store.read(command(),r),bytes);
 for(const modify of [(b:Uint8Array)=>{b[0]=0;},(b:Uint8Array)=>{b[18]=0;},(b:Uint8Array)=>{b[23]=0;},(b:Uint8Array)=>{b[11]=12;},(b:Uint8Array)=>{b[24]=1;},(b:Uint8Array)=>{b[26]=1;}]){const bad=png();modify(bad);await assert.rejects(f.store.save(command(),'screenshot',bad));}await assert.rejects(f.store.save(command(),'screenshot',png().slice(0,32)));await assert.rejects(f.store.save(command(),'screenshot',new Uint8Array(2*1024*1024+1)));
});
test('Observer reads enforce actual streaming bytes and chunk ceilings, cancelling invalid bodies',async()=>{
 const c=command(),bytes=state(),receipt=(await observerArtifactDescriptor(c,'state',bytes)).receipt;let cancelled=0;
 const readerStore=(declared:number,chunks:Uint8Array[])=>new R2ObserverArtifacts({get:async()=>({size:declared,body:new ReadableStream({pull(controller){const chunk=chunks.shift();if(chunk)controller.enqueue(chunk);else controller.close();},cancel(){cancelled++;}},{highWaterMark:0})}),put:async()=>null} as unknown as ObserverArtifactBucket);
 await assert.rejects(readerStore(bytes.length,[new Uint8Array(bytes.length+1)]).read(c,receipt));await assert.rejects(readerStore(bytes.length,[new Uint8Array(bytes.length-1)]).read(c,receipt));await assert.rejects(readerStore(bytes.length+1,[bytes]).read(c,receipt));await assert.rejects(readerStore(bytes.length,Array.from({length:4097},()=>new Uint8Array())).read(c,receipt));assert.ok(cancelled>=2);
});
