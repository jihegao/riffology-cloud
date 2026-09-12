import test from 'node:test';
import assert from 'node:assert/strict';
import type {Database,Statement} from '../../services/catalog/database.ts';
import {revisionGcMaintenanceLimits,revisionGcMaintenanceScopes,runRevisionGcMaintenance} from '../../services/gateway/revision-gc-maintenance.ts';
import {revisionStoreActorName,type RevisionStoreNamespace} from '../../services/turn-runtime/revision-store-client.ts';

const rows=Array.from({length:5},(_,index)=>({tenantId:'tenant-a',projectId:`project-${index}`,workspaceId:`workspace-${index}`,workspaceGeneration:1}));
function database():Database{return {async query<T>(statement:Statement):Promise<T[]>{if(statement.sql.includes('count(*)'))return [{count:rows.length}] as T[];const [limit,offset]=statement.values as number[];return rows.slice(offset,offset+limit) as T[];},async batch(){throw Error('must-not-write');}};}

test('revision GC maintenance selects a bounded rotating catalog slice',async()=>{
  assert.deepEqual((await revisionGcMaintenanceScopes(database(),60_000,2)).map(scope=>scope.workspaceId),['workspace-2','workspace-3']);
  assert.deepEqual((await revisionGcMaintenanceScopes(database(),120_000,2)).map(scope=>scope.workspaceId),['workspace-4','workspace-0']);
  assert.equal((await revisionGcMaintenanceScopes({async query(){return [{count:0}] as never[];},async batch(){}},60_000)).length,0);
});

test('revision GC cron dispatches exact bounded options to each RevisionStore',async()=>{
  const calls:Array<{name:string;input:unknown}>=[];const revisions={getByName(name:string){return {async maintainGc(input:unknown){calls.push({name,input});return {status:'yielded' as const};}};}} as unknown as RevisionStoreNamespace;
  await runRevisionGcMaintenance(database(),revisions,120_000);
  assert.equal(calls.length,revisionGcMaintenanceLimits.workspaceBatch);
  for(const call of calls){const input=call.input as {scope:(typeof rows)[number];now:number;minAgeMs:number;pageSize:number;maxObjects:number};assert.equal(call.name,revisionStoreActorName(input.scope));assert.equal(input.now,120_000);assert.equal(input.minAgeMs,revisionGcMaintenanceLimits.minAgeMs);assert.equal(input.pageSize,revisionGcMaintenanceLimits.pageSize);assert.equal(input.maxObjects,revisionGcMaintenanceLimits.maxObjects);}
});

test('revision GC cron reports partial dispatch failures after visiting the bounded slice',async()=>{
  let calls=0;const revisions={getByName(){return {async maintainGc(){calls++;if(calls===1)throw Error('injected-maintenance-failure');return {status:'completed' as const,result:{scannedManifests:0,scannedBlobs:0,deletedBlobs:0,retainedBlobs:0}};}};}} as unknown as RevisionStoreNamespace;
  await assert.rejects(runRevisionGcMaintenance(database(),revisions,60_000),/revision-gc-maintenance-incomplete/);assert.equal(calls,2);
});
