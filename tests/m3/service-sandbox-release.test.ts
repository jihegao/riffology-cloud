import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqlServiceSandboxRelease,type ServiceSandboxReleaseStorage} from '../../services/run/sandbox-release.ts';
import type {ServiceRuntimeInput} from '../../services/run/runtime-protocol.ts';
import {scope,spec} from './run-fixture.ts';

function input(id:string):ServiceRuntimeInput{const reference={runId:'run-'+id,runtimeId:'runtime-'+id,dispatchId:'dispatch-'+id,leaseId:'lease-'+id,generation:1 as const,deadlineAt:999999};return {reference,scope,spec:spec(),lease:{tenantId:scope.tenantId,projectId:scope.projectId,workspaceId:scope.workspaceId,generation:1,operation:'service-run',operationId:reference.dispatchId,runId:reference.runId,leaseId:reference.leaseId,deadlineAt:reference.deadlineAt}};}
function fixture(t:{after(fn:()=>void):void}){
 const dir=mkdtempSync(join(tmpdir(),'m3-service-release-')),db=new DatabaseSync(join(dir,'state.sqlite'));let alarm:number|null=null;
 const storage={sql:{exec(query:string,...args:(string|number|null)[]){if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...args):(statement.run(...args),[]);return {toArray:()=>structuredClone(rows)};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}},async sync(){},async setAlarm(value:number){alarm=value;},async deleteAlarm(){alarm=null;}} as unknown as ServiceSandboxReleaseStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {storage,get alarm(){return alarm;}};
}

test('destroy no-op followed by a late assignment is destroyed again before capacity one is reusable',async t=>{
 const f=fixture(t),first=input('a'),second=input('b');let now=1000,active:string|null=null,destroys=0,firstNoop=true;
 const release=new SqlServiceSandboxRelease(f.storage,async current=>({
  async running(){return active===current.reference.runId;},
  async destroy(){destroys++;if(firstNoop){firstNoop=false;return;}if(active===current.reference.runId)active=null;},
 }),()=>now,{retryMs:5,assignmentGuardMs:100,quietMs:10,rpcMs:50});
 assert.equal(await release.begin(first),false);assert.equal(destroys,1);assert.ok(f.alarm!==null);
 active=first.reference.runId;now=1050;assert.equal(await release.reconcile(),false);assert.equal(destroys,2);assert.equal(active,null,'late first actor must be destroyed');
 active=second.reference.runId;now=1110;assert.equal(await release.reconcile(),true);assert.equal(active,second.reference.runId,'release is scoped to the first actor');assert.equal((await release.snapshot())?.completed_at,1110);assert.equal(f.alarm,null);
});

test('uncertain probes retain the persistent alarm and never claim stable absence',async t=>{
 const f=fixture(t);let now=1000,destroys=0;
 const release=new SqlServiceSandboxRelease(f.storage,async()=>({async running(){throw Error('control-unavailable');},async destroy(){destroys++;}}),()=>now,{retryMs:5,assignmentGuardMs:10,quietMs:5,rpcMs:50});
 assert.equal(await release.begin(input('a')),false);now=1100;assert.equal(await release.reconcile(),false);assert.equal(destroys,2,'legacy missing releaseState does not block exact-actor destroy');assert.equal((await release.snapshot())?.quiet_since,null);assert.ok(f.alarm!==null);
});
