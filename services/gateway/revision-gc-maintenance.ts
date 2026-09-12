import { statement as sql, type Database } from '../catalog/database.ts';
import { positive, scope as turnScope, type TurnScope } from '../turn/protocol.ts';
import { revisionStoreActorName, type RevisionStoreNamespace } from '../turn-runtime/revision-store-client.ts';

const MINUTE_MS=60_000;
const MIN_AGE_MS=24*60*60*1000;
const PAGE_SIZE=100;
const DELIVERY_OBJECTS=100;

type ScopeRow={tenantId:string;projectId:string;workspaceId:string;workspaceGeneration:number};

/** Selects a small rotating slice without adding mutable catalog state. At
 * most two page reads are required when the slice wraps at the end. */
export async function revisionGcMaintenanceScopes(database:Database,now:number,limit=2):Promise<TurnScope[]>{
  const observedAt=positive(now);if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('invalid-revision-gc-maintenance-limit');
  const count=Number((await database.query<{count:number}>(sql('SELECT count(*) AS count FROM catalog_workspaces')))[0]?.count??0);if(!Number.isSafeInteger(count)||count<0)throw Error('invalid-revision-gc-maintenance-count');if(count===0)return [];
  const offset=(Math.floor(observedAt/MINUTE_MS)*limit)%count;
  const read=(take:number,skip:number)=>database.query<ScopeRow>(sql(`SELECT tenant_id AS tenantId,project_id AS projectId,id AS workspaceId,generation AS workspaceGeneration
    FROM catalog_workspaces ORDER BY tenant_id,project_id,id LIMIT ? OFFSET ?`,take,skip));
  const first=await read(Math.min(limit,count-offset),offset),remaining=Math.min(limit,count)-first.length,rows=remaining>0?[...first,...await read(remaining,0)]:first;
  return rows.map(turnScope);
}

export async function runRevisionGcMaintenance(database:Database,revisions:RevisionStoreNamespace,now=Date.now()):Promise<void>{
  if(!revisions?.getByName)throw Error('revision-store-not-configured');const observedAt=positive(now),scopes=await revisionGcMaintenanceScopes(database,observedAt);
  const results=await Promise.allSettled(scopes.map(scope=>{const store=revisions.getByName(revisionStoreActorName(scope));if(!store.maintainGc)throw Error('revision-store-maintenance-not-configured');return store.maintainGc({scope,now:observedAt,minAgeMs:MIN_AGE_MS,pageSize:PAGE_SIZE,maxObjects:DELIVERY_OBJECTS});}));
  if(results.some(result=>result.status==='rejected'))throw Error('revision-gc-maintenance-incomplete');
}

export const revisionGcMaintenanceLimits={workspaceBatch:2,minAgeMs:MIN_AGE_MS,pageSize:PAGE_SIZE,maxObjects:DELIVERY_OBJECTS};
