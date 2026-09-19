import type {ModelExecutionIsolationManifest} from './core.ts';

export type PiDeveloperHistoricalIsolation={schemaVersion:1;manifestId:string;manifests:[ModelExecutionIsolationManifest,ModelExecutionIsolationManifest];manifestSha256:string};
export type PiDeveloperPolicyV1={schemaVersion:1;policyId:string;tenantId:string;userId:string;enabled:boolean;billingMode:'observe'};
export type PiDeveloperPolicyV2={schemaVersion:2;policyId:string;tenantId:string;userId:string;projectId:string;enabled:boolean;billingMode:'observe';maxTurns:3;maxCalls:8;maxNanodollars:600000000;maxCallDurationMs:360000;startsAt:number;expiresAt:number;historicalIsolation:PiDeveloperHistoricalIsolation};
export type PiDeveloperPolicy=PiDeveloperPolicyV1|PiDeveloperPolicyV2;
const id=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value:unknown,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function isolationManifest(value:unknown):ModelExecutionIsolationManifest{
 if(!exact(value,['schemaVersion','ledger','proofs']))throw Error('pi-developer-policy-invalid');
 const raw=value as Record<string,unknown>;
 if(raw.schemaVersion!==1||!['legacy','g5'].includes(String(raw.ledger))||!Array.isArray(raw.proofs))throw Error('pi-developer-policy-invalid');
 const proofs=raw.proofs.map(item=>{
  if(!exact(item,['callKey','proofDigest']))throw Error('pi-developer-policy-invalid');
  const proof=item as Record<string,unknown>;
  if(!sha(proof.callKey)||!sha(proof.proofDigest))throw Error('pi-developer-policy-invalid');
  return {callKey:proof.callKey as string,proofDigest:proof.proofDigest as string};
 });
 if(new Set(proofs.map(item=>item.callKey)).size!==proofs.length)throw Error('pi-developer-policy-invalid');
 return {schemaVersion:1,ledger:raw.ledger as ModelExecutionIsolationManifest['ledger'],proofs};
}
function historicalIsolation(value:unknown):PiDeveloperHistoricalIsolation{
 if(!exact(value,['schemaVersion','manifestId','manifests','manifestSha256']))throw Error('pi-developer-policy-invalid');
 const raw=value as Record<string,unknown>;
 if(raw.schemaVersion!==1||!id(raw.manifestId)||!sha(raw.manifestSha256)||!Array.isArray(raw.manifests)||raw.manifests.length!==2)throw Error('pi-developer-policy-invalid');
 const manifests=raw.manifests.map(isolationManifest) as [ModelExecutionIsolationManifest,ModelExecutionIsolationManifest];
 if(manifests[0].ledger!=='legacy'||manifests[0].proofs.length!==1||manifests[1].ledger!=='g5'||manifests[1].proofs.length!==6)throw Error('pi-developer-policy-invalid');
 if(new Set(manifests.flatMap(manifest=>manifest.proofs.map(proof=>proof.callKey))).size!==7)throw Error('pi-developer-policy-invalid');
 return {schemaVersion:1,manifestId:raw.manifestId as string,manifests,manifestSha256:raw.manifestSha256 as string};
}
export function piDeveloperPolicy(raw:unknown):PiDeveloperPolicy|null{
 if(raw===undefined)return null;
 const value=typeof raw==='string'?JSON.parse(raw):raw;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('pi-developer-policy-invalid');
 const p=value as Record<string,unknown>;
 if(![p.policyId,p.tenantId,p.userId].every(id)||p.billingMode!=='observe'||typeof p.enabled!=='boolean')throw Error('pi-developer-policy-invalid');
 if(p.schemaVersion===1){if(!exact(value,['schemaVersion','policyId','tenantId','userId','enabled','billingMode']))throw Error('pi-developer-policy-invalid');return {...value as PiDeveloperPolicyV1};}
 if(p.schemaVersion!==2||!exact(value,['schemaVersion','policyId','tenantId','userId','projectId','enabled','billingMode','maxTurns','maxCalls','maxNanodollars','maxCallDurationMs','startsAt','expiresAt','historicalIsolation'])||!id(p.projectId)||p.maxTurns!==3||p.maxCalls!==8||p.maxNanodollars!==600_000_000||p.maxCallDurationMs!==360_000||!Number.isSafeInteger(p.startsAt)||Number(p.startsAt)<1||!Number.isSafeInteger(p.expiresAt)||Number(p.expiresAt)-Number(p.startsAt)!==1_800_000)throw Error('pi-developer-policy-invalid');
 return {...value as PiDeveloperPolicyV2,historicalIsolation:historicalIsolation(p.historicalIsolation)};
}
export function piDeveloperOwner(raw:unknown,tenantId:string,userId:string,projectId?:string,now=Date.now()){
 const p=piDeveloperPolicy(raw);
 return !!p?.enabled&&p.tenantId===tenantId&&p.userId===userId&&(p.schemaVersion===1||p.startsAt<=now&&p.expiresAt>now&&projectId!==undefined&&p.projectId===projectId);
}
