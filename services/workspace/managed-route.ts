import {sameScope,scope,turnId,type TurnScope} from '../turn/protocol.ts';

/** An operator-frozen, synthetic-project-only acceptance policy. This is an
 * observation stop threshold, never a claim of a provider-enforced dollar cap. */
type BoundedManagedPolicy={schemaVersion:1;policyId:string;scope:TurnScope;userId:string;enabled:boolean;syntheticOnly:true;maxTurns:6;maxSessions:2;observedStopUsd:5;maxDurationMs:7200000;maxTurnObservationMs:300000;maxSimulationRuns:12};
export type ManagedTestingConfig={schemaVersion:2;policyId:string;tenantId:string;userId:string;enabled:boolean};
type UnmeteredManagedPolicy={schemaVersion:2;policyId:string;scope:TurnScope;userId:string;enabled:boolean;syntheticOnly:false;maxTurns:null;maxSessions:null;observedStopUsd:null;maxDurationMs:null;maxTurnObservationMs:300000;maxSimulationRuns:null};
export type ManagedAcceptancePolicy=BoundedManagedPolicy|UnmeteredManagedPolicy;
export function managedTestingConfig(raw:unknown):ManagedTestingConfig|null{
 if(raw===undefined||raw===null)return null;
 let v=raw;if(typeof v==='string'){if(v.length>2048)throw Error('invalid-managed-testing-policy');v=JSON.parse(v);}
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid-managed-testing-policy');
 const r=v as Record<string,unknown>;
 if(Object.keys(r).sort().join()!=='enabled,policyId,schemaVersion,tenantId,userId'||r.schemaVersion!==2||typeof r.enabled!=='boolean')throw Error('invalid-managed-testing-policy');
 return {schemaVersion:2,policyId:turnId(r.policyId),tenantId:turnId(r.tenantId),userId:turnId(r.userId),enabled:r.enabled};
}
export function managedTestingOwner(raw:unknown,tenantId:string,userId:string):boolean{const p=managedTestingConfig(raw);return !!p?.enabled&&p.tenantId===tenantId&&p.userId===userId;}
export function managedAcceptancePolicy(raw:unknown):ManagedAcceptancePolicy|null{
  if(raw===undefined||raw===null)return null;
  let value:unknown=raw;
  if(typeof raw==='string'){if(raw.length>4096)throw Error('invalid-managed-acceptance-policy');try{value=JSON.parse(raw);}catch{throw Error('invalid-managed-acceptance-policy');}}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-managed-acceptance-policy');
  const v=value as Record<string,unknown>,keys=['schemaVersion','policyId','scope','userId','enabled','syntheticOnly','maxTurns','maxSessions','observedStopUsd','maxDurationMs','maxTurnObservationMs','maxSimulationRuns'];
 if(v.schemaVersion===2){
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||typeof v.enabled!=='boolean'||v.syntheticOnly!==false||v.maxTurns!==null||v.maxSessions!==null||v.observedStopUsd!==null||v.maxDurationMs!==null||v.maxTurnObservationMs!==300000||v.maxSimulationRuns!==null)throw Error('invalid-managed-testing-policy');
  return {schemaVersion:2,policyId:turnId(v.policyId),scope:scope(v.scope),userId:turnId(v.userId),enabled:v.enabled,syntheticOnly:false,maxTurns:null,maxSessions:null,observedStopUsd:null,maxDurationMs:null,maxTurnObservationMs:300000,maxSimulationRuns:null};
 }
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.schemaVersion!==1||typeof v.enabled!=='boolean'||v.syntheticOnly!==true||v.maxTurns!==6||v.maxSessions!==2||v.observedStopUsd!==5||v.maxDurationMs!==7200000||v.maxTurnObservationMs!==300000||v.maxSimulationRuns!==12)throw Error('invalid-managed-acceptance-policy');
  return {schemaVersion:1,policyId:turnId(v.policyId),scope:scope(v.scope),userId:turnId(v.userId),enabled:v.enabled,syntheticOnly:true,maxTurns:6,maxSessions:2,observedStopUsd:5,maxDurationMs:7200000,maxTurnObservationMs:300000,maxSimulationRuns:12};
}
export function managedProjectPolicy(raw:unknown,target:TurnScope,testing?:unknown):ManagedAcceptancePolicy|null{
 const policy=managedAcceptancePolicy(raw);if(policy&&sameScope(policy.scope,target))return policy;
 const p=managedTestingConfig(testing);if(!p||p.tenantId!==target.tenantId)return null;
 return {schemaVersion:2,policyId:p.policyId,scope:scope(target),userId:p.userId,enabled:p.enabled,syntheticOnly:false,maxTurns:null,maxSessions:null,observedStopUsd:null,maxDurationMs:null,maxTurnObservationMs:300000,maxSimulationRuns:null};
}
export function requireManagedAdmission(raw:unknown,pinned:ManagedAcceptancePolicy,target:TurnScope,userId:string,testing?:unknown):ManagedAcceptancePolicy{
  const current=managedProjectPolicy(raw,target,testing);
  if(!current?.enabled||current.userId!==userId||JSON.stringify({...current,enabled:true})!==JSON.stringify({...managedAcceptancePolicy(pinned),enabled:true}))throw Error('managed-admission-denied');
  return current;
}
export function managedProductActorName(target:TurnScope):string{const s=scope(target);return 'managed-product-v1:'+s.tenantId+':'+s.projectId;}
/** Once selected, backend identity survives gate closure/removal for observation
 * and cleanup. Fresh configuration can never reinterpret existing Pi history. */
export function resolveManagedRoute(raw:unknown,target:TurnScope,pinned:ManagedAcceptancePolicy|null,hasTurnHistory:boolean,testing?:unknown):ManagedAcceptancePolicy|null{
  if(pinned){const saved=managedAcceptancePolicy(pinned)!;if(!sameScope(saved.scope,target))throw Error('managed-route-scope-conflict');return saved;}
  const configured=managedProjectPolicy(raw,target,testing);
  if(configured&&hasTurnHistory)throw Error('managed-route-existing-turn-history');
  return configured;
}
