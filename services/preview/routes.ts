import {statement,type Database} from '../catalog/database.ts';
import {ProjectCatalog} from '../catalog/projects.ts';
import {digest,type Principal} from '../catalog/contracts.ts';
import {actor,positive,scope,sameScope,turnId,type TurnScope} from '../turn/protocol.ts';
export type PreviewRoute={previewId:string;scope:TurnScope;hostLabel:string;expiresAt:number};
type Row={preview_id:string;tenant_id:string;project_id:string;workspace_id:string;generation:number;host_label:string;expires_at:number};
function plain(value:unknown):void{if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-preview-route');for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('invalid-preview-route');}}
function label(value:string){if(typeof value!=='string'||!/^p-[a-f0-9]{40}$/.test(value))throw Error('invalid-preview-host-label');return value;}
/** Maps an opaque host label to an immutable target. Lookup never grants access:
 * callers must still check login, ACL, binding, and current Run state. */
export class PreviewRoutes{
 readonly #db:Database;readonly #clock:()=>number;
 constructor(database:Database,clock=Date.now){this.#db=database;this.#clock=clock;}
 #now(){return positive(this.#clock());}
 #route(row:Row):PreviewRoute{return {previewId:turnId(row.preview_id),scope:scope({tenantId:row.tenant_id,projectId:row.project_id,workspaceId:row.workspace_id,workspaceGeneration:row.generation}),hostLabel:label(row.host_label),expiresAt:positive(row.expires_at)};}
 async #authorized(who:Principal,s:TurnScope){const actual=await new ProjectCatalog(this.#db,new Set()).workspace(who,s.workspaceId);if(!sameScope(actual,s))throw Error('preview-route-scope-denied');}
 async register(rawPrincipal:Principal,rawScope:TurnScope,rawPreviewId:string,rawExpiresAt:number):Promise<PreviewRoute>{
  plain(rawPrincipal);plain(rawScope);const who=actor(rawPrincipal),s=scope(rawScope),previewId=turnId(rawPreviewId),expiresAt=positive(rawExpiresAt),hostLabel='p-'+(await digest(previewId)).slice(0,40);
  if(expiresAt<=this.#now())throw Error('preview-route-expired');await this.#authorized(who,s);
  await this.#db.batch([statement(`INSERT INTO catalog_preview_routes(preview_id,tenant_id,project_id,workspace_id,generation,host_label,expires_at)
   SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM catalog_preview_routes WHERE preview_id=?)`,previewId,s.tenantId,s.projectId,s.workspaceId,s.workspaceGeneration,hostLabel,expiresAt,previewId)]);
  await this.#authorized(who,s);const rows=await this.#db.query<Row>(statement('SELECT * FROM catalog_preview_routes WHERE preview_id=?',previewId));if(!rows[0])throw Error('preview-route-unavailable');const result=this.#route(rows[0]);
  if(!sameScope(result.scope,s)||result.expiresAt!==expiresAt||result.hostLabel!==hostLabel)throw Error('preview-route-conflict');if(expiresAt<=this.#now())throw Error('preview-route-expired');return result;
 }
 async #find(column:'preview_id'|'host_label',value:string){const rows=await this.#db.query<Row>(statement(`SELECT r.* FROM catalog_preview_routes r
  JOIN catalog_projects p ON p.id=r.project_id AND p.tenant_id=r.tenant_id AND p.workspace_id=r.workspace_id
  JOIN catalog_workspaces w ON w.id=r.workspace_id AND w.project_id=p.id AND w.tenant_id=p.tenant_id
  JOIN catalog_tenants t ON t.id=r.tenant_id
  WHERE r.${column}=? AND r.expires_at>? AND r.generation=p.generation AND r.generation=w.generation
  AND p.status='ready' AND w.status='ready' AND t.status='active' LIMIT 1`,value,this.#now()));if(!rows[0])return null;const result=this.#route(rows[0]);return result.expiresAt>this.#now()?result:null;}
 lookup(hostLabel:string){return this.#find('host_label',label(hostLabel));}
 get(previewId:string){return this.#find('preview_id',turnId(previewId));}
}
