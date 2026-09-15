import profiles from '../../services/browser-preview/runtime/assets/profiles.json' with {type:'json'};
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {previewSha256} from '../../services/browser-preview/contract.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {BrowserPreviewBuildHost} from '../../services/browser-preview/build-host.ts';
import {discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BROWSER_BUILD_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';
import assert from 'node:assert/strict';
export class Storage{
 values=new Map();alarm=null;failReceipt=false;
 kv={get:key=>structuredClone(this.values.get(key))};
 get=async key=>structuredClone(this.values.get(key));
 put=async(key,value)=>{this.values.set(key,structuredClone(value));};
 list=async({prefix})=>new Map([...this.values].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));
 tail=Promise.resolve();
 transaction=op=>{const run=this.tail.then(()=>this.operate(op));this.tail=run.catch(()=>{});return run;};
 operate=async op=>{const before=structuredClone(this.values),alarm=this.alarm;try{return await op({get:async key=>structuredClone(this.values.get(key)),put:async(key,value)=>{if(this.failReceipt&&key.startsWith('browser-preview:receipt:'))throw Error('injected-receipt-failure');this.values.set(key,structuredClone(value));},delete:async key=>this.values.delete(key),list:this.list,setAlarm:async at=>{this.alarm=at;},deleteAlarm:async()=>{this.alarm=null;}});}catch(e){this.values=before;this.alarm=alarm;throw e;}};
 sync=async()=>{};
}
export async function fixture(index=0){
 const p=profiles[index],f=await makeFixture(p,index?'mesa':'queue'),bytes=initialWorkspaceArchive(Object.fromEntries(f.files.map(f=>[f.path,Buffer.from(f.base64,'base64')]))),storage=new Storage(),objects=new Map();let now=1000,reads=0,puts=0;
 const scope={tenantId:'tenant-a',projectId:f.manifest.projectId,workspaceId:'workspace-a',workspaceGeneration:1},source={schemaVersion:1,identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:1},receipt:{revisionId:'revision-a',objectKey:'turns/a.json',filesSha256:await previewSha256(bytes),sessionSha256:'b'.repeat(64),committedAt:900},status:'pending',attempts:0,nextAttemptAt:1000,reasonCode:null};
 storage.values.set(discoveryKey('revision-a'),source);storage.values.set(BROWSER_BUILD_WAKE_KEY,1000);
 const ports={registry:productionPreviewRegistry,files:async()=>{reads++;return bytes;},bucket:{get:async key=>{const b=objects.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;},put:async(key,value,options)=>{assert.equal(options.onlyIf.etagDoesNotMatch,'*');assert.ok([...storage.values.keys()].some(k=>k.startsWith('browser-preview:reference:')));puts++;if(objects.has(key))throw Error('precondition');objects.set(key,Uint8Array.from(value));throw Error('response-lost');}}};
 return {storage,objects,ports,scope,source,bytes,host:()=>new BrowserPreviewBuildHost(storage,scope,ports,()=>now),clock:value=>{now=value;},get reads(){return reads;},get puts(){return puts;}};
}
