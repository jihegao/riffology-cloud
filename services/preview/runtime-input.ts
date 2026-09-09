import type {PreviewBinding} from './bindings.ts';
import {previewSource} from './source.ts';
import {serviceRuntimeInput,type ServiceRuntimeInput} from '../run/runtime-protocol.ts';
import {serviceRuntimeReference,type ServiceRunRecord} from '../run/service.ts';
import {positive,sameScope,scope,turnId} from '../turn/protocol.ts';
function data(value:unknown):void{if(value===null||typeof value!=='object')return;if(Object.getPrototypeOf(value)!==Object.prototype)throw Error('preview-runtime-input-denied');for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d))throw Error('preview-runtime-input-denied');data(d.value);}}
/** Converts an already authorized target, never browser-provided execution
 * parameters. Runtime forwarding still verifies its own live lease and fence. */
export function previewRuntimeInput(target:{binding:PreviewBinding;run:ServiceRunRecord},clock=Date.now):ServiceRuntimeInput{
 data(target);if(!target||Object.keys(target).length!==2||!Object.hasOwn(target,'binding')||!Object.hasOwn(target,'run'))throw Error('preview-runtime-input-denied');
 const {binding,run}=target,now=positive(clock());if(!binding||!run||run.kind!=='service'||run.status!=='running'||run.stopRequestedAt!==null||binding.revokedAt!==null||binding.reason!==null||!run.runtime)throw Error('preview-runtime-input-denied');
 turnId(binding.previewId);const s=scope(binding.scope),runtime=serviceRuntimeReference(run.runtime),bound=serviceRuntimeReference(binding.runtime);
 if(!sameScope(s,scope(run.scope))||turnId(binding.runId)!==turnId(run.id)||runtime.runId!==run.id||JSON.stringify(runtime)!==JSON.stringify(bound)||binding.expiresAt!==runtime.deadlineAt||binding.expiresAt<=now||positive(binding.createdAt)>=binding.expiresAt||
 JSON.stringify(previewSource(binding.source))!==JSON.stringify(previewSource(run.spec.plan.source)))throw Error('preview-runtime-input-denied');
 return serviceRuntimeInput({scope:s,reference:runtime,spec:run.spec,lease:{tenantId:s.tenantId,projectId:s.projectId,workspaceId:s.workspaceId,generation:runtime.generation,operation:'service-run',operationId:runtime.dispatchId,deadlineAt:runtime.deadlineAt,runId:runtime.runId,leaseId:runtime.leaseId}});
}
