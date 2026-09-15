import test from 'node:test';
import assert from 'node:assert/strict';
import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {BrowserPreviewBuildHost} from '../../services/browser-preview/build-host.ts';
import {discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BROWSER_BUILD_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';
class Storage{
 values=new Map();alarm=null;failReceipt=false;
 kv={get:key=>structuredClone(this.values.get(key))};
 list=async({prefix})=>new Map([...this.values].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));
 transaction=async op=>{const before=structuredClone(this.values),alarm=this.alarm;try{return await op({get:async key=>structuredClone(this.values.get(key)),put:async(key,value)=>{if(this.failReceipt&&key.startsWith('browser-preview:receipt:'))throw Error('injected-receipt-failure');this.values.set(key,structuredClone(value));},delete:async key=>this.values.delete(key),list:this.list,setAlarm:async at=>{this.alarm=at;},deleteAlarm:async()=>{this.alarm=null;}});}catch(e){this.values=before;this.alarm=alarm;throw e;}};
 sync=async()=>{};
}
async function fixture(index=0){
 const p=profiles[index],f=await makeFixture(p,index?'mesa':'queue'),bytes=initialWorkspaceArchive(Object.fromEntries(f.files.map(f=>[f.path,Buffer.from(f.base64,'base64')]))),storage=new Storage(),objects=new Map();let now=1000,reads=0,puts=0;
 const scope={tenantId:'tenant-a',projectId:f.manifest.projectId,workspaceId:'workspace-a',workspaceGeneration:1},source={schemaVersion:1,identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},receipt:{revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:await previewSha256(bytes),sessionSha256:'b'.repeat(64),committedAt:900},status:'pending',attempts:0,nextAttemptAt:1000,reasonCode:null};
 storage.values.set(discoveryKey('revision-a'),source);storage.values.set(BROWSER_BUILD_WAKE_KEY,1000);
 const ports={registry:productionPreviewRegistry,files:async()=>{reads++;return bytes;},bucket:{get:async key=>{const b=objects.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;},put:async(key,value,options)=>{assert.equal(options.onlyIf.etagDoesNotMatch,'*');assert.ok([...storage.values.keys()].some(k=>k.startsWith('browser-preview:reference:')));puts++;if(objects.has(key))throw Error('precondition');objects.set(key,Uint8Array.from(value));throw Error('response-lost');}}};
 return {storage,objects,ports,scope,source,bytes,host:()=>new BrowserPreviewBuildHost(storage,scope,ports,()=>now),clock:value=>{now=value;},get reads(){return reads;},get puts(){return puts;}};
}
for(const index of [0,1])test(`durable profile ${index} packages real saved archive with reference before create-only write`,async()=>{
 const f=await fixture(index);await f.host().alarm();const row=f.host().read('revision-a');assert.equal(row.state.status,'ready');assert.equal(row.profile.trust,'verified-platform');assert.deepEqual(row.profile.runtime,profiles[index].runtime);assert.equal(row.receipt.revisionId,'revision-a');assert.equal(f.puts,1);assert.equal(f.storage.alarm,null);assert.equal(f.storage.values.get(discoveryKey('revision-a')).status,'settled');assert.deepEqual(f.host().receipt(row.receipt.packageIdentity),row.receipt);
});
test('lost receipt commit reconciles same object after host restart, preserving durable reference',async()=>{
 const f=await fixture();f.storage.failReceipt=true;await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'building');assert.equal(f.objects.size,1);const id=f.host().read('revision-a').state.buildIdentity;
 f.storage.failReceipt=false;f.clock(3000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'ready');assert.equal(f.host().read('revision-a').state.packageIdentity,id);assert.equal(f.puts,1);assert.equal(f.storage.alarm,null);
});
test('three transport attempts terminate durably and concurrent alarm shares one advance',async()=>{
 const f=await fixture();f.ports.files=async()=>{throw Error('unavailable');};const h=f.host();await Promise.all([h.alarm(),h.alarm()]);assert.equal(f.storage.values.get(discoveryKey('revision-a')).attempts,1);f.clock(3000);await f.host().alarm();f.clock(7000);await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'failed');assert.equal(f.storage.alarm,null);assert.equal(f.storage.values.get(discoveryKey('revision-a')).attempts,3);
});
test('unknown source dependencies settle unsupported without R2 ready',async()=>{
 const f=await fixture(),p=profiles[0],raw=await makeFixture(p,'queue');const files=Object.fromEntries(raw.files.map(f=>[f.path,Buffer.from(f.base64,'base64')]));files['app/requirements.lock']=Buffer.from(JSON.stringify({schemaVersion:1,packages:{evil:'1'}}));const bytes=initialWorkspaceArchive(files);f.source.receipt.filesSha256=await previewSha256(bytes);f.storage.values.set(discoveryKey('revision-a'),f.source);f.ports.files=async()=>bytes;await f.host().alarm();assert.equal(f.host().read('revision-a').state.status,'unsupported');assert.equal(f.objects.size,0);assert.equal(f.storage.alarm,null);
});

test('new saved discovery preserves earlier build retry and uses local journal time',async()=>{
 const {projectPreviewDiscoveries}=await import('../../services/browser-preview/discovery.ts');
 const f=await fixture(),storage=f.storage;storage.values.set(BROWSER_BUILD_WAKE_KEY,500);
 const state={scope:f.scope,turns:{'turn-b':{id:'turn-b',sessionId:'session-a',dispatchId:'dispatch-b',runtimeGeneration:1,persistenceOutcome:'saved',finishedAt:2000,checkpoint:{...f.source.receipt,revisionId:'revision-b',committedAt:9000}}}};
 await storage.transaction(tx=>projectPreviewDiscoveries(tx,state,null));
 assert.equal(storage.values.get(discoveryKey('revision-b')).nextAttemptAt,2000);assert.equal(storage.alarm,500);assert.equal(storage.values.get(BROWSER_BUILD_WAKE_KEY),500);
});
