import {sameScope,scope,turnId,type TurnScope} from '../turn/protocol.ts';

/** An operator-frozen, synthetic-project-only acceptance policy. This is an
 * observation stop threshold, never a claim of a provider-enforced dollar cap. */
export type ManagedAcceptancePolicy={schemaVersion:1;policyId:string;scope:TurnScope;userId:string;enabled:boolean;syntheticOnly:true;maxTurns:6;maxSessions:2;observedStopUsd:5;maxDurationMs:7200000;maxTurnObservationMs:300000;maxSimulationRuns:12};
export function managedAcceptancePolicy(raw:unknown):ManagedAcceptancePolicy|null{
  if(raw===undefined||raw===null)return null;
  let value:unknown=raw;
  if(typeof raw==='string'){if(raw.length>4096)throw Error('invalid-managed-acceptance-policy');try{value=JSON.parse(raw);}catch{throw Error('invalid-managed-acceptance-policy');}}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-managed-acceptance-policy');
  const v=value as Record<string,unknown>,keys=['schemaVersion','policyId','scope','userId','enabled','syntheticOnly','maxTurns','maxSessions','observedStopUsd','maxDurationMs','maxTurnObservationMs','maxSimulationRuns'];
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.schemaVersion!==1||typeof v.enabled!=='boolean'||v.syntheticOnly!==true||v.maxTurns!==6||v.maxSessions!==2||v.observedStopUsd!==5||v.maxDurationMs!==7200000||v.maxTurnObservationMs!==300000||v.maxSimulationRuns!==12)throw Error('invalid-managed-acceptance-policy');
  return {schemaVersion:1,policyId:turnId(v.policyId),scope:scope(v.scope),userId:turnId(v.userId),enabled:v.enabled,syntheticOnly:true,maxTurns:6,maxSessions:2,observedStopUsd:5,maxDurationMs:7200000,maxTurnObservationMs:300000,maxSimulationRuns:12};
}
export function managedProjectPolicy(raw:unknown,target:TurnScope):ManagedAcceptancePolicy|null{const policy=managedAcceptancePolicy(raw);return policy&&sameScope(policy.scope,target)?policy:null;}
export function requireManagedAdmission(raw:unknown,pinned:ManagedAcceptancePolicy,target:TurnScope,userId:string):ManagedAcceptancePolicy{
  const current=managedProjectPolicy(raw,target);
  if(!current?.enabled||current.userId!==userId||JSON.stringify({...current,enabled:true})!==JSON.stringify({...managedAcceptancePolicy(pinned),enabled:true}))throw Error('managed-admission-denied');
  return current;
}
export function managedProductActorName(target:TurnScope):string{const s=scope(target);return 'managed-product-v1:'+s.tenantId+':'+s.projectId;}
/** Once selected, backend identity survives gate closure/removal for observation
 * and cleanup. Fresh configuration can never reinterpret existing Pi history. */
export function resolveManagedRoute(raw:unknown,target:TurnScope,pinned:ManagedAcceptancePolicy|null,hasTurnHistory:boolean):ManagedAcceptancePolicy|null{
  if(pinned){const saved=managedAcceptancePolicy(pinned)!;if(!sameScope(saved.scope,target))throw Error('managed-route-scope-conflict');return saved;}
  const configured=managedProjectPolicy(raw,target);
  if(configured&&hasTurnHistory)throw Error('managed-route-existing-turn-history');
  return configured;
}
