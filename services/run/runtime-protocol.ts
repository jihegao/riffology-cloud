import {sameScope,scope,positive,turnId,type TurnScope} from '../turn/protocol.ts';
import {serviceRunSpec,serviceRuntimeReference,type ServiceRunSpec,type ServiceRuntimeReference} from './service.ts';
import type {LeaseReference} from '../quota/core.ts';
export type ServiceRuntimeInput={reference:ServiceRuntimeReference;scope:TurnScope;spec:ServiceRunSpec;lease:LeaseReference};
export type ServiceStopReceipt={reference:ServiceRuntimeReference;scope:TurnScope;confirmationId:string;observedAt:number;fenced:true};
export type ServiceRuntimeObservation={reference:ServiceRuntimeReference;scope:TurnScope;status:'absent'|'starting'|'healthy'|'unknown'|'stopped';stop:ServiceStopReceipt|null};
/** stop must durably fence delayed starts before proving the process and all
 * descendants stopped. An absent process alone is never a stopped receipt. */
export interface ServiceRuntimePort{
 start(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
 observe(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
 stop(input:ServiceRuntimeInput):Promise<ServiceRuntimeObservation>;
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function exact(raw:unknown,keys:string[]):asserts raw is Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('invalid-service-runtime-input');
 const descriptors=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key]!,'value')||!descriptors[key]!.enumerable))throw Error('invalid-service-runtime-input');
}
export function serviceRuntimeInput(raw:unknown):ServiceRuntimeInput{
 exact(raw,['reference','scope','spec','lease']);const reference=serviceRuntimeReference(raw.reference),s=scope(raw.scope),spec=serviceRunSpec(raw.spec),l=raw.lease;
 exact(l,['tenantId','projectId','workspaceId','generation','operation','operationId','deadlineAt','runId','leaseId']);
 if(l.operation!=='service-run'||l.generation!==reference.generation||l.tenantId!==s.tenantId||l.projectId!==s.projectId||l.workspaceId!==s.workspaceId||l.runId!==reference.runId||l.leaseId!==reference.leaseId||l.operationId!==reference.dispatchId||l.deadlineAt!==reference.deadlineAt||!sameScope(spec.plan.identity.scope,s))throw Error('service-runtime-scope-denied');
 const lease:LeaseReference={tenantId:s.tenantId,projectId:s.projectId,workspaceId:s.workspaceId,generation:reference.generation,operation:'service-run',operationId:reference.dispatchId,deadlineAt:reference.deadlineAt,runId:reference.runId,leaseId:reference.leaseId};
 return {reference,scope:s,spec,lease};
}
export function serviceRuntimeObservation(raw:unknown,input:ServiceRuntimeInput,now:number):ServiceRuntimeObservation{
 exact(raw,['reference','scope','status','stop']);const reference=serviceRuntimeReference(raw.reference),s=scope(raw.scope);
 if(!equal(reference,input.reference)||!sameScope(s,input.scope)||!['absent','starting','healthy','unknown','stopped'].includes(String(raw.status)))throw Error('service-observation-scope-denied');
 let stop:ServiceStopReceipt|null=null;
 if(raw.status==='stopped'){
  exact(raw.stop,['reference','scope','confirmationId','observedAt','fenced']);
  const p=raw.stop,ref=serviceRuntimeReference(p.reference),ss=scope(p.scope);
  if(!equal(ref,reference)||!sameScope(ss,s)||p.fenced!==true||positive(p.observedAt)>positive(now))throw Error('invalid-service-stop-receipt');
  stop={reference:ref,scope:ss,confirmationId:turnId(p.confirmationId),observedAt:p.observedAt as number,fenced:true};
 }else if(raw.stop!==null)throw Error('invalid-service-stop-receipt');
 return {reference,scope:s,status:raw.status as ServiceRuntimeObservation['status'],stop};
}
