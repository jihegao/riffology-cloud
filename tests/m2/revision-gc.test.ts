import assert from 'node:assert/strict';
import test from 'node:test';
import {listed,readManifest,turnRevisionGcMaxR2Calls,type TurnRevisionGcBucket} from '../../services/turn-runtime/revision-gc.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:2},files='a'.repeat(64),session='b'.repeat(64);
const manifestKey='turns/tenant-a/project-a/workspace-a/2/session-a/turn-a/dispatch-a.json';
function manifest(filesSha=files,sessionSha=session){return JSON.stringify({schemaVersion:3,identity:{scope,sessionId:'session-a',turnId:'turn-a',dispatchId:'dispatch-a',generation:2},base:{workspace:null,session:null},outcome:'completed',executionErrorCode:null,files:{objectKey:`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${filesSha}`,sha256:filesSha,size:1},piSession:{objectKey:`turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${sessionSha}`,sha256:sessionSha,size:1},committedAt:1});}
function bucket(body:string|null):TurnRevisionGcBucket{return {async list(){throw Error('must-not-list');},async get(){if(body===null)return null;const bytes=new TextEncoder().encode(body);return {size:bytes.byteLength,async arrayBuffer(){return bytes.buffer;}} as R2ObjectBody;},async delete(){throw Error('must-not-delete');}};}

test('GC manifest reader returns only canonical scoped content-addressed references',async()=>{
  assert.deepEqual(await readManifest(bucket(manifest()),manifestKey,scope),new Set([`turn-blobs-v3/tenant-a/project-a/workspace-a/files/${files}`,`turn-blobs-v3/tenant-a/project-a/workspace-a/sessions/${session}`]));
});

test('GC manifest reader fails closed on absent, malformed, copied, and cross-scope manifests',async()=>{
  await assert.rejects(readManifest(bucket(null),manifestKey,scope),/manifest-missing/);
  await assert.rejects(readManifest(bucket('{}'),manifestKey,scope),/manifest/);
  await assert.rejects(readManifest(bucket(manifest('bad')),manifestKey,scope),/manifest/);
  await assert.rejects(readManifest(bucket(manifest()),'turns/tenant-a/project-a/workspace-a/copied.json',scope),/manifest/);
  await assert.rejects(readManifest(bucket(manifest()),manifestKey,{...scope,workspaceId:'workspace-b'}),/manifest/);
});

test('GC list item validation rejects ambiguous provider shapes',()=>{
  const uploaded=new Date('2026-09-07T00:00:00Z');assert.deepEqual(listed({key:manifestKey,uploaded}),{key:manifestKey,uploaded});
  for(const value of [null,{key:manifestKey},{key:1,uploaded},{key:manifestKey,uploaded:'today'},{key:manifestKey,uploaded:new Date('invalid')}])assert.throws(()=>listed(value),/gc-list/);
});

test('GC publishes a strict per-delivery R2 call ceiling',()=>{
  assert.equal(turnRevisionGcMaxR2Calls(1),5);assert.equal(turnRevisionGcMaxR2Calls(100),302);assert.throws(()=>turnRevisionGcMaxR2Calls(0),/gc-limit/);assert.throws(()=>turnRevisionGcMaxR2Calls(10_001),/gc-limit/);
});
