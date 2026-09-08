import { checkpointKey } from '../runtime/core.ts';
import { initialCheckpoint, initialFiles } from '../runtime/starter.ts';
import { ModelContentError, modelContentKey, verifyModelContent, type VerifiedModelContent } from '../runtime/content.ts';
import { canonicalWorkspaceMarker, validateWorkspaceTask, workspaceDigest, WORKSPACE_LAYOUT, type RuntimeIdentity, type RuntimeReadyReceipt, type WorkspaceTask } from '../workspace/protocol.ts';
import { scope, sameScope, sha, turnDigest, type TurnScope } from '../turn/protocol.ts';
import { initialWorkspaceArchive } from './initial-workspace-archive.ts';

/** Initial content provenance is distinct from a completed Agent Turn. It
 * carries no session checkpoint and cannot impersonate a saved Turn receipt. */
export type InitialWorkspaceReference={schemaVersion:1;scope:TurnScope;task:WorkspaceTask;runtime:RuntimeIdentity;markerNonce:string;markerSha256:string;checkpointRevision:string};
export type ResolvedInitialWorkspace={reference:InitialWorkspaceReference;referenceSha256:string;filesArchive:Uint8Array;filesSha256:string};
const MAX_INITIAL_BYTES=64*1024,encoder=new TextEncoder();
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject('invalid-initial-workspace-reference');}
export function initialWorkspaceReference(raw:unknown):InitialWorkspaceReference{
  exact(raw,['schemaVersion','scope','task','runtime','markerNonce','markerSha256','checkpointRevision']);
  if(raw.schemaVersion!==1)reject('invalid-initial-workspace-reference');
  const expected=scope(raw.scope),task=validateWorkspaceTask(raw.task as WorkspaceTask);
  exact(raw.runtime,['taskId','tenantId','projectId','workspaceId','generation','runtimeId','leaseId']);
  const runtime=raw.runtime as RuntimeIdentity;
  canonicalWorkspaceMarker(runtime,raw.markerNonce as string);checkpointKey(runtime);
  if(!sameScope(expected,{tenantId:task.tenantId,projectId:task.projectId,workspaceId:task.workspaceId,workspaceGeneration:task.generation})||runtime.taskId!==task.id||runtime.tenantId!==task.tenantId||runtime.projectId!==task.projectId||runtime.workspaceId!==task.workspaceId||runtime.generation!==task.generation)reject('initial-workspace-scope-denied');
  return {schemaVersion:1,scope:expected,task,runtime:{taskId:runtime.taskId,tenantId:runtime.tenantId,projectId:runtime.projectId,workspaceId:runtime.workspaceId,generation:runtime.generation,runtimeId:runtime.runtimeId,leaseId:runtime.leaseId},markerNonce:raw.markerNonce as string,markerSha256:sha(raw.markerSha256),checkpointRevision:sha(raw.checkpointRevision)};
}
/** Caller must obtain ready from its server-owned, confirmed Workspace state.
 * No HTTP request or project file may select this reference. */
export async function initialWorkspaceReferenceFromReady(input:{scope:TurnScope;task:WorkspaceTask;runtime:RuntimeIdentity;markerNonce:string;ready:RuntimeReadyReceipt}):Promise<InitialWorkspaceReference>{
  if(input.ready.layoutVersion!==WORKSPACE_LAYOUT)reject('initial-workspace-layout-mismatch');
  const ref=initialWorkspaceReference({schemaVersion:1,scope:input.scope,task:input.task,runtime:input.runtime,markerNonce:input.markerNonce,markerSha256:input.ready.markerSha256,checkpointRevision:input.ready.checkpointRevision});
  if(await workspaceDigest(canonicalWorkspaceMarker(ref.runtime,ref.markerNonce))!==ref.markerSha256)reject('initial-workspace-marker-mismatch');
  return ref;
}

/** Read-only source resolver. Verifies the immutable M1 checkpoint and the
 * original model package before constructing any native workspace. Missing or
 * corrupt content is a hard failure, never permission to fall back to empty. */
export class InitialWorkspaceResolver{
  readonly #bucket:R2Bucket;readonly #modelBucket:R2Bucket|undefined;
  constructor(bucket:R2Bucket,modelBucket?:R2Bucket){this.#bucket=bucket;this.#modelBucket=modelBucket;}
  async resolve(raw:InitialWorkspaceReference,expectedScope:TurnScope):Promise<ResolvedInitialWorkspace>{
    const reference=initialWorkspaceReference(raw);
    if(!sameScope(reference.scope,scope(expectedScope)))reject('initial-workspace-scope-denied');
    const marker=canonicalWorkspaceMarker(reference.runtime,reference.markerNonce);
    if(await workspaceDigest(marker)!==reference.markerSha256)reject('initial-workspace-marker-mismatch');
    const object=await this.#bucket.get(checkpointKey(reference.runtime));
    if(!object)reject('initial-workspace-checkpoint-missing');
    let stored:string;
    try{
      if(!Number.isSafeInteger(object.size)||object.size<1||object.size>MAX_INITIAL_BYTES)reject('initial-workspace-checkpoint-invalid');
      const bytes=new Uint8Array(await object.arrayBuffer());
      if(bytes.byteLength!==object.size)reject('initial-workspace-checkpoint-invalid');
      try{stored=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject('initial-workspace-checkpoint-invalid');}
    }finally{await object.body?.cancel().catch(()=>{});}
    if(await workspaceDigest(stored)!==reference.checkpointRevision)reject('initial-workspace-checkpoint-mismatch');
    if(reference.task.modelContent&&!this.#modelBucket?.get)reject('initial-workspace-model-source-required');
    let model:VerifiedModelContent|null=null;
    if(reference.task.modelContent){
      // Transport/read failures remain retryable; only verified absence or
      // invalid bytes become a permanent initial-source failure.
      const source=await this.#modelBucket!.get(modelContentKey(reference.task.modelContent));
      if(!source)throw new ModelContentError('model-content-missing');
      try{model=await verifyModelContent(reference.task.modelContent,source);}
      finally{await source.body?.cancel().catch(()=>{});}
    }
    const input={task:reference.task,identity:reference.runtime,markerNonce:reference.markerNonce};
    const expected=await initialCheckpoint(input,model?.receipt);
    if(stored!==expected.text||expected.revision!==reference.checkpointRevision)reject('initial-workspace-checkpoint-mismatch');
    // The old platform marker is integrity evidence only, never project data.
    const files:Record<string,Uint8Array>={'README.md':encoder.encode(initialFiles(input)['README.md']!)};
    for(const [path,bytes] of Object.entries(model?.files??{}))files[path]=Uint8Array.from(bytes);
    const filesArchive=initialWorkspaceArchive(files),digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(filesArchive));
    return {reference,referenceSha256:await turnDigest(reference),filesArchive,filesSha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
  }
}

const INITIAL_SOURCE_FAILURES=new Set([
  'workspace-initial-source-missing','initial-workspace-model-source-required',
  'invalid-initial-workspace-reference','invalid-initial-workspace-archive',
  'initial-workspace-scope-denied','initial-workspace-layout-mismatch','initial-workspace-marker-mismatch',
  'initial-workspace-checkpoint-missing','initial-workspace-checkpoint-invalid','initial-workspace-checkpoint-mismatch',
  'model-content-missing','model-content-mismatch','model-content-unknown','model-content-oversize',
]);
export function isInitialWorkspaceSourceFailure(error:unknown):boolean{
  return error instanceof Error&&INITIAL_SOURCE_FAILURES.has(error.message);
}
