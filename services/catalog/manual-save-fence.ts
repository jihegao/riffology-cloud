import {statement as sql,type Database} from './database.ts';
import {CatalogError} from './contracts.ts';
import {scope as validateScope,actor as validateActor,turnId,sha,type TurnScope,type TurnActor} from '../turn/protocol.ts';
export type ManualSaveFenceInput={scope:TurnScope;actor:TurnActor;operationId:string;inputSha256:string};
export type ManualSaveFenceTerminal={status:'committed'|'unchanged'|'aborted';revisionId:string|null};
export type ManualSaveFenceLease=ManualSaveFenceInput&{state:'pending'|'released';terminal:ManualSaveFenceTerminal|null};
const TABLE='catalog_manual_save_fences';
/** Only a positively observed missing table is legacy mode. SQL errors propagate. */
export async function manualSaveFenceInstalled(db:Database):Promise<boolean>{const rows=await db.query<{name:string;type:string}>(sql("SELECT name,type FROM sqlite_schema WHERE name=?",TABLE));if(!rows.length)return false;if(rows.length!==1||rows[0]!.type!=='table')throw Error('manual-save-fence-schema-invalid');return true;}
const key='user_id=? AND auth_version=? AND tenant_id=? AND project_id=? AND workspace_id=? AND workspace_generation=? AND operation_id=?';
const owned=`SELECT 1 FROM catalog_projects p JOIN catalog_workspaces w ON w.id=p.workspace_id AND w.project_id=p.id AND w.tenant_id=p.tenant_id
 JOIN catalog_tenants t ON t.id=p.tenant_id JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=t.owner_user_id JOIN catalog_users u ON u.id=m.user_id
 WHERE p.tenant_id=? AND p.id=? AND w.id=? AND p.generation=? AND w.generation=p.generation
 AND p.status='ready' AND w.status='ready' AND p.archived_at IS NULL
 AND t.status='active' AND m.status='active' AND m.role='owner' AND u.status='active' AND u.id=? AND u.auth_version=?`;
function input(raw:ManualSaveFenceInput):ManualSaveFenceInput{return {scope:validateScope(raw.scope),actor:validateActor(raw.actor),operationId:turnId(raw.operationId),inputSha256:sha(raw.inputSha256)};}
function values(i:ManualSaveFenceInput){return [i.actor.userId,i.actor.authVersion,i.scope.tenantId,i.scope.projectId,i.scope.workspaceId,i.scope.workspaceGeneration,i.operationId];}
function authorization(i:ManualSaveFenceInput){return [i.scope.tenantId,i.scope.projectId,i.scope.workspaceId,i.scope.workspaceGeneration,i.actor.userId,i.actor.authVersion];}
function terminal(raw:ManualSaveFenceTerminal):ManualSaveFenceTerminal{if(!raw||!['committed','unchanged','aborted'].includes(raw.status)||Object.keys(raw).sort().join(',')!=='revisionId,status')throw Error('invalid-manual-save-fence-terminal');return {status:raw.status,revisionId:raw.status==='committed'?sha(raw.revisionId):raw.revisionId===null?null:(()=>{throw Error('invalid-manual-save-fence-terminal');})()};}
type Row={input_sha256:string;state:string;terminal_status:string|null;revision_id:string|null};
export class CatalogManualSaveFence{
 readonly db:Database;readonly clock:()=>number;
 constructor(db:Database,clock:()=>number=Date.now){this.db=db;this.clock=clock;}
 async #installed(){if(!await manualSaveFenceInstalled(this.db))throw Error('manual-save-fence-unavailable');}
 async #read(i:ManualSaveFenceInput):Promise<ManualSaveFenceLease|null>{const rows=await this.db.query<Row>(sql(`SELECT input_sha256,state,terminal_status,revision_id FROM ${TABLE} WHERE ${key}`,...values(i))),r=rows[0];if(!r)return null;if(r.input_sha256!==i.inputSha256)throw new CatalogError('idempotency_conflict');if(r.state!=='pending'&&r.state!=='released')throw Error('manual-save-fence-corrupt');const result=r.state==='released'?terminal({status:r.terminal_status as ManualSaveFenceTerminal['status'],revisionId:r.revision_id}):null;if(r.state==='pending'&&(r.terminal_status!==null||r.revision_id!==null))throw Error('manual-save-fence-corrupt');return {...i,state:r.state,terminal:result};}
 async acquire(raw:ManualSaveFenceInput):Promise<ManualSaveFenceLease>{const i=input(raw);await this.#installed();const at=this.clock();if(!Number.isSafeInteger(at)||at<0)throw Error('invalid-manual-save-fence-time');
  // The INSERT authorization predicate and revocation UPDATE serialize on D1.
  // A second project writer is never queued or allowed to replace an existing lease.
  await this.db.batch([sql(`INSERT INTO ${TABLE}(user_id,auth_version,tenant_id,project_id,workspace_id,workspace_generation,operation_id,input_sha256,state,terminal_status,revision_id,created_at,released_at)
   SELECT ?,?,?,?,?,?,?,?,'pending',NULL,NULL,?,NULL WHERE EXISTS (${owned})
   AND NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE tenant_id=? AND project_id=? AND workspace_id=? AND workspace_generation=? AND state='pending')
   ON CONFLICT DO NOTHING`,...values(i),i.inputSha256,at,...authorization(i),i.scope.tenantId,i.scope.projectId,i.scope.workspaceId,i.scope.workspaceGeneration)]);
  // Recheck current access for observations as well; released leases cannot be reacquired.
  if(!(await this.db.query(sql(owned,...authorization(i)))).length)throw new CatalogError('not_found');
  const lease=await this.#read(i);if(lease)return lease;throw new CatalogError('project_busy');
 }
 /** Private original-identity recovery. Does not authorize publication or expose data to an HTTP caller. */
 async observe(raw:ManualSaveFenceInput):Promise<ManualSaveFenceLease|null>{const i=input(raw);await this.#installed();return this.#read(i);}
 /** Fence a never-acquired attempt before aborting its journal reservation. A pending lease is never released here. */
 async abandonUnacquired(raw:ManualSaveFenceInput):Promise<ManualSaveFenceLease>{const i=input(raw);await this.#installed();const at=this.clock();if(!Number.isSafeInteger(at)||at<0)throw Error('invalid-manual-save-fence-time');await this.db.batch([sql(`INSERT INTO ${TABLE}(user_id,auth_version,tenant_id,project_id,workspace_id,workspace_generation,operation_id,input_sha256,state,terminal_status,revision_id,created_at,released_at)
  SELECT ?,?,?,?,?,?,?,?,'released','aborted',NULL,?,? WHERE EXISTS (SELECT 1 FROM catalog_workspaces w JOIN catalog_projects p ON p.id=w.project_id AND p.tenant_id=w.tenant_id AND p.workspace_id=w.id WHERE w.id=? AND p.id=? AND p.tenant_id=? AND p.owner_user_id=?) ON CONFLICT DO NOTHING`,...values(i),i.inputSha256,at,at,i.scope.workspaceId,i.scope.projectId,i.scope.tenantId,i.actor.userId)]);const lease=await this.#read(i);if(!lease)throw Error('manual-save-fence-not-found');return lease;}
 /** Caller must have confirmed this exact operation's durable journal terminal state. */
 async release(raw:ManualSaveFenceInput,rawTerminal:ManualSaveFenceTerminal):Promise<ManualSaveFenceLease>{const i=input(raw),done=terminal(rawTerminal);await this.#installed();const current=await this.#read(i);if(!current)throw Error('manual-save-fence-not-found');if(current.state==='released'){if(JSON.stringify(current.terminal)!==JSON.stringify(done))throw Error('manual-save-fence-terminal-conflict');return current;}const at=this.clock();if(!Number.isSafeInteger(at)||at<0)throw Error('invalid-manual-save-fence-time');await this.db.batch([sql(`UPDATE ${TABLE} SET state='released',terminal_status=?,revision_id=?,released_at=? WHERE ${key} AND input_sha256=? AND state='pending'`,done.status,done.revisionId,at,...values(i),i.inputSha256)]);const saved=await this.#read(i);if(saved?.state!=='released'||JSON.stringify(saved.terminal)!==JSON.stringify(done))throw Error('manual-save-fence-terminal-conflict');return saved;}
}
