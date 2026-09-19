export type PiDeveloperPolicy={schemaVersion:1;policyId:string;tenantId:string;userId:string;enabled:boolean;billingMode:'observe'};
export function piDeveloperPolicy(raw:unknown):PiDeveloperPolicy|null{
 if(raw===undefined)return null;
 const value=typeof raw==='string'?JSON.parse(raw):raw;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='billingMode,enabled,policyId,schemaVersion,tenantId,userId')throw Error('pi-developer-policy-invalid');
 const p=value as PiDeveloperPolicy;
 if(p.schemaVersion!==1||p.billingMode!=='observe'||typeof p.enabled!=='boolean'||[p.policyId,p.tenantId,p.userId].some(v=>typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)))throw Error('pi-developer-policy-invalid');
 return {...p};
}
export function piDeveloperOwner(raw:unknown,tenantId:string,userId:string){const p=piDeveloperPolicy(raw);return !!p?.enabled&&p.tenantId===tenantId&&p.userId===userId;}
