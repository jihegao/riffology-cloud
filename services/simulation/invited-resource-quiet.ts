import {privateBetaPolicy} from '../model-budget/private-beta-policy.ts';
import {G5_GLOBAL_ACTOR} from '../model-budget/g5-window.ts';
import {tenantQuotaName} from '../quota/durable.ts';
import {quotaIdentifier} from '../quota/core.ts';
import type {TurnScope} from '../turn/protocol.ts';
export type HistoricalNativeQuiet={schemaVersion:1;quiescent:true;tenantIds:string[];tasks:number};
export interface InvitedResourceQuietEnv {
 CATALOG?:D1Database;PRIVATE_BETA_POLICY_JSON?:string;
 TENANT_QUOTA?:{getByName(name:string):{assertNativeExecutionQuiet(tenantId:string):Promise<{tenantId:string;quiescent:true}>}};
 G5_WINDOW_GUARD?:{getByName(name:string):{assertNativeExecutionQuiet():Promise<HistoricalNativeQuiet>}};
 M4_SIMULATION_ENABLED?:unknown;M3_SERVICE_ENABLED?:unknown;G5_ADMISSION_ENABLED?:unknown;
}
/** Read the original resource authorities. Model-call isolation manifests do
 * not prove a historical Simulation/Service process or container has stopped. */
export async function assertInvitedRunResourceQuiet(env:InvitedResourceQuietEnv,scope:TurnScope){
 if(env.M4_SIMULATION_ENABLED==='true'||env.M3_SERVICE_ENABLED==='true'||env.G5_ADMISSION_ENABLED==='true')throw Error('invited-runs-historical-admission-open');
 const policy=privateBetaPolicy(env.PRIVATE_BETA_POLICY_JSON);
 if(!policy||!env.CATALOG||!env.TENANT_QUOTA||!env.G5_WINDOW_GUARD)throw Error('invited-runs-historical-authority-unavailable');
 let original:HistoricalNativeQuiet;
 try{original=await env.G5_WINDOW_GUARD.getByName(G5_GLOBAL_ACTOR).assertNativeExecutionQuiet();}catch{throw Error('invited-runs-historical-resource-unconfirmed');}
 if(original?.schemaVersion!==1||original.quiescent!==true||!Array.isArray(original.tenantIds)||!Number.isSafeInteger(original.tasks)||original.tasks<0)throw Error('invited-runs-historical-resource-unconfirmed');
 // No pagination or project filter: an unrelated current invitee's old lease
 // occupies the same global native capacity. Frozen revoked histories remain.
 const owners=await env.CATALOG.prepare(`SELECT DISTINCT t.id AS tenant_id FROM catalog_tenants t
  JOIN catalog_users u ON u.id=t.owner_user_id JOIN catalog_memberships m ON m.tenant_id=t.id AND m.user_id=u.id
  WHERE t.status='active' AND u.status='active' AND u.auth_version>=1 AND m.status='active' AND m.role='owner'
  AND EXISTS (SELECT 1 FROM catalog_invitations i WHERE i.accepted_by=u.id AND i.state='accepted' AND i.purpose='user' AND i.issued_by IS NOT NULL)
  ORDER BY t.id`).all<{tenant_id:string}>();
 if(!owners.success||!Array.isArray(owners.results))throw Error('invited-runs-historical-authority-unavailable');
 const tenants=new Set([scope.tenantId,...policy.historicalIsolation.map(entry=>entry.tenantId),...original.tenantIds,...owners.results.map(row=>row.tenant_id)]);
 for(const tenantId of tenants){
  quotaIdentifier(tenantId);
  let proof:{tenantId:string;quiescent:true};
  try{proof=await env.TENANT_QUOTA.getByName(tenantQuotaName(tenantId)).assertNativeExecutionQuiet(tenantId);}catch{throw Error('invited-runs-historical-resource-unconfirmed');}
  if(proof?.tenantId!==tenantId||proof.quiescent!==true)throw Error('invited-runs-historical-resource-unconfirmed');
 }
}
