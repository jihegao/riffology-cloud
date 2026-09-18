import {turnDigest,turnId,sha} from '../turn/protocol.ts';
import type {Principal} from '../catalog/contracts.ts';

export const MANAGED_BOOTSTRAP_TITLE='Issue 77 Managed production acceptance';
export type ManagedProjectBootstrap={schemaVersion:1;policyId:'issue77-production-v1';userId:string;tenantId:string;idempotencyKey:string;bodySha256:string;enabled:boolean};
/** One pinned ordinary project.create intent. This does not authorize model
 * execution, alter historical G5 ledgers, or admit any second creation key. */
export function managedProjectBootstrap(raw:unknown):ManagedProjectBootstrap|null{
 if(raw===undefined||raw===null)return null;
 let value:unknown=raw;
 if(typeof raw==='string'){if(raw.length>2048)throw Error('invalid-managed-bootstrap-policy');try{value=JSON.parse(raw);}catch{throw Error('invalid-managed-bootstrap-policy');}}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-managed-bootstrap-policy');
 const v=value as Record<string,unknown>,keys=['schemaVersion','policyId','userId','tenantId','idempotencyKey','bodySha256','enabled'];
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.schemaVersion!==1||v.policyId!=='issue77-production-v1'||typeof v.enabled!=='boolean')throw Error('invalid-managed-bootstrap-policy');
 return {schemaVersion:1,policyId:'issue77-production-v1',userId:turnId(v.userId),tenantId:turnId(v.tenantId),idempotencyKey:turnId(v.idempotencyKey),bodySha256:sha(v.bodySha256),enabled:v.enabled};
}
export async function matchesManagedProjectBootstrap(raw:unknown,principal:Principal,tenantId:string,key:string,body:unknown):Promise<boolean>{
 const policy=managedProjectBootstrap(raw);
 if(!policy?.enabled||principal.userId!==policy.userId||tenantId!==policy.tenantId||key!==policy.idempotencyKey)return false;
 if(!body||typeof body!=='object'||Array.isArray(body))return false;
 const b=body as Record<string,unknown>;
 if(Object.keys(b).length!==2||b.title!==MANAGED_BOOTSTRAP_TITLE||b.starterVersion!=='blank-v1')return false;
 return await turnDigest(body)===policy.bodySha256;
}
