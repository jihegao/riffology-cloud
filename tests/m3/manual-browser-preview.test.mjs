import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './browser-preview-test-fixture.mjs';
import {manualPreviewDiscovery,discoveryKey} from '../../services/browser-preview/discovery.ts';
import {BrowserPreviewOrchestrator} from '../../services/browser-preview/orchestrator.ts';
import {platformPreviewDelivery} from '../../services/browser-preview/platform-delivery.ts';
import {BROWSER_BUILD_WAKE_KEY} from '../../services/workspace/shared-alarm.ts';

function manual(f){return {kind:'manual-save',identity:{scope:f.scope,actor:{userId:'alpha',authVersion:1},operationId:'manual-one'},receipt:{source:'manual-save',revisionId:'a'.repeat(64),objectKey:'manual/object',filesSha256:f.source.receipt.filesSha256,sessionSha256:null,committedAt:900}};}

test('manual discovery admits only committed operations and backfill remains canonical and idempotent',async()=>{
 const f=await fixture(),source=manual(f),operation={identity:source.identity,receipt:source.receipt,status:'pending'};
 assert.equal(manualPreviewDiscovery(operation),null);operation.status='unchanged';assert.equal(manualPreviewDiscovery(operation),null);
 assert.throws(()=>manualPreviewDiscovery({...operation,status:'committed',receipt:null}),/invalid-persisted-turn-journal/);
 operation.status='committed';const discovery=manualPreviewDiscovery(operation);assert.equal(discovery.kind,'manual-save');assert.deepEqual(discovery.receipt,source.receipt);
 f.storage.values.clear();let authorized=true;
 f.ports.checkSource=actual=>{if(!authorized||JSON.stringify(actual.identity)!==JSON.stringify(source.identity)||JSON.stringify(actual.receipt)!==JSON.stringify(source.receipt))throw Error('source-denied');};
 const host=f.host();await host.admitManual(source);const state=f.storage.values.get(discoveryKey(source.receipt.revisionId));assert.equal(state.status,'pending');assert.equal(f.storage.values.get(BROWSER_BUILD_WAKE_KEY),900);
 await host.admitManual(source);assert.deepEqual(f.storage.values.get(discoveryKey(source.receipt.revisionId)),state);
 await assert.rejects(host.admitManual({...source,identity:{...source.identity,actor:{userId:'other',authVersion:1}}}),/source-denied/);
 authorized=false;await assert.rejects(host.admitManual(source),/source-denied/);
});

test('manual preview cannot submit server Verify even if server capability is enabled',async()=>{
 const f=await fixture(),source=manual(f);f.storage.values.clear();let replay=0;
 f.ports.checkSource=value=>{if(JSON.stringify(value.identity)!==JSON.stringify(source.identity)||JSON.stringify(value.receipt)!==JSON.stringify(source.receipt))throw Error('source-denied');};
 const host=f.host();await host.admitManual(source);await host.alarm();const row=host.read(source.receipt.revisionId);assert.equal(row.state.status,'ready');
 const service=new BrowserPreviewOrchestrator(f.storage,f.scope,{authorize:async()=>{},checkScope:()=>{},head:()=>source,saved:id=>id===source.receipt.revisionId?source:null,checkSource:f.ports.checkSource,builds:host,bucket:f.ports.bucket,registry:f.ports.registry,files:async()=>f.bytes,simulations:{replay:async()=>{replay++;throw Error('unexpected server execution');}},canVerify:()=>true,image:'unused',delivery:hash=>platformPreviewDelivery('http://127.0.0.1:8795','http://localhost:8821',hash)});
 const view=await service.view({userId:'alpha',authVersion:1});assert.equal(view.canVerify,false);assert.equal(view.sourceKind,'manual-save');
 await assert.rejects(service.verify({userId:'alpha',authVersion:1},{revisionId:source.receipt.revisionId,packageIdentity:row.state.packageIdentity,parameters:{},seed:7,intent:'experiment',idempotencyKey:'verify-one'}),/simulation-unavailable/);
 assert.equal(replay,0);assert.equal([...f.storage.values.keys()].some(key=>key.startsWith('browser-preview:verify:')),false);
});

test('revoked manual source rolls back a backfill and cannot publish a package after private bytes return',async()=>{
 const f=await fixture(),source=manual(f);f.storage.values.clear();let allowed=true;
 f.ports.checkSource=()=>{if(!allowed)throw Error('source-denied');};
 const transaction=f.storage.transaction;f.storage.transaction=op=>transaction(tx=>op({...tx,get:async key=>{const value=await tx.get(key);if(key===discoveryKey(source.receipt.revisionId))allowed=false;return value;}}));
 await assert.rejects(f.host().admitManual(source),/source-denied/);assert.equal(f.storage.values.has(discoveryKey(source.receipt.revisionId)),false);assert.equal(f.storage.alarm,null);
 f.storage.transaction=transaction;allowed=true;await f.host().admitManual(source);
 let release,entered;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.ports.files=async()=>{entered();await pending;return f.bytes;};const build=f.host().alarm();await started;allowed=false;release();await build;
 assert.equal(f.objects.size,0);assert.equal(f.host().read(source.receipt.revisionId),null);assert.equal(f.storage.values.get(discoveryKey(source.receipt.revisionId)).status,'pending');
});
