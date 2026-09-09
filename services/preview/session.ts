import type {VerifiedIdentity} from '../catalog/admission.ts';
import type {Principal} from '../catalog/contracts.ts';
import {statement,type Database} from '../catalog/database.ts';
import {actor,positive,scope,turnId,type TurnScope} from '../turn/protocol.ts';

export type PreviewBrowserPrincipal={userId:string;authVersion:number;subject:string;sessionId:string;expiresAt:number};
export function previewBrowserPrincipal(raw:PreviewBrowserPrincipal,now:number):PreviewBrowserPrincipal{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('preview-session-denied');
 const keys=['userId','authVersion','subject','sessionId','expiresAt'],descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!descriptors[key]?.enumerable||!Object.hasOwn(descriptors[key]!,'value')))throw Error('preview-session-denied');
 const who=actor({userId:raw.userId,authVersion:raw.authVersion}),expiresAt=positive(raw.expiresAt);
 if(expiresAt<=positive(now))throw Error('preview-session-denied');
 return {...who,subject:turnId(raw.subject),sessionId:turnId(raw.sessionId),expiresAt};
}
/** Private identity anchor; ordinary user identity alone cannot mint Preview access. */
export function browserPrincipal(identity:VerifiedIdentity,who:Principal,now=Date.now()):PreviewBrowserPrincipal{
 if(!identity.browserSession||identity.emailVerified!==true||identity.platformVersion!==who.authVersion)throw Error('preview-session-denied');
 return previewBrowserPrincipal({...who,subject:identity.subject,sessionId:identity.browserSession.sessionId,expiresAt:identity.browserSession.expiresAt},now);
}
/** One primary database statement rechecks the specific login and project ACL.
 * No token is selected; a stored login id is not itself authorization. */
export async function requirePreviewSession(database:Database,raw:PreviewBrowserPrincipal,rawScope:TurnScope,clock:()=>number=Date.now):Promise<void>{
 const now=clock(),p=previewBrowserPrincipal(raw,now),s=scope(rawScope);
 const rows=await database.query(statement(`SELECT 1 AS allowed FROM auth_session a
  JOIN auth_user au ON au.id=a.userId
  JOIN catalog_users u ON u.identity_issuer='better-auth' AND u.identity_subject=au.id
  JOIN catalog_memberships m ON m.user_id=u.id
  JOIN catalog_tenants t ON t.id=m.tenant_id AND t.owner_user_id=u.id
  JOIN catalog_projects p ON p.tenant_id=t.id AND p.owner_user_id=u.id
  JOIN catalog_workspaces w ON w.id=p.workspace_id AND w.project_id=p.id AND w.tenant_id=p.tenant_id
  WHERE a.id=? AND au.id=? AND u.id=? AND a.platformVersion=? AND u.auth_version=?
  AND a.expiresAt>? AND a.expiresAt>=? AND au.emailVerified=1
  AND u.status='active' AND t.status='active' AND m.status='active' AND m.role='owner'
  AND p.status='ready' AND w.status='ready' AND t.id=? AND p.id=? AND w.id=?
  AND p.generation=? AND w.generation=? LIMIT 1`,
  p.sessionId,p.subject,p.userId,p.authVersion,p.authVersion,now,p.expiresAt,s.tenantId,s.projectId,s.workspaceId,s.workspaceGeneration,s.workspaceGeneration));
 if(rows.length!==1)throw Error('preview-session-denied');
 // A slow permission read must not extend the lifetime of the login.
 previewBrowserPrincipal(p,clock());
}
