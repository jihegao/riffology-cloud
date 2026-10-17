import { positive, scope as validateScope, sha, turnDigest, turnId, type TurnScope } from '../turn/protocol.ts';

export const TOOL_ARTIFACT_STORE_ACTOR='tool-artifacts-v1';
export const TOOL_ARTIFACT_MAX_BYTES=1024*1024+64*1024;
export type ToolArtifactOperation='read'|'list'|'search';
export type ToolArtifactReferenceKind='tool_effect'|'turn_event';
export type ToolArtifactIdentity={scope:TurnScope;turnId:string;dispatchId:string;commandId:string;effectId:string;operation:ToolArtifactOperation};
export type ToolArtifactReceipt={schemaVersion:1;artifactId:string;operation:ToolArtifactOperation;mediaType:'application/json';bytes:number;sha256:string;createdAt:number};
export type ToolArtifactReferenceInput={schemaVersion:1;scope:TurnScope;artifactId:string;turnId:string;dispatchId:string;kind:ToolArtifactReferenceKind;referenceId:string};
export type ToolArtifactReferenceReceipt={schemaVersion:1;artifactId:string;kind:ToolArtifactReferenceKind;referenceId:string;retainedAt:number;releasedAt:number|null};
export type ToolArtifactInput={identity:ToolArtifactIdentity;mediaType:'application/json';content:Uint8Array};
export type ToolArtifactIntent={operationId:string;inputSha256:string};
const OPERATIONS=new Set<ToolArtifactOperation>(['read','list','search']);
const REFERENCE_KINDS=new Set<ToolArtifactReferenceKind>(['tool_effect','turn_event']);
const decoder=new TextDecoder('utf-8',{fatal:true});
function reject(code:string):never{throw Error(code);}
export function toolArtifactIdentity(value:unknown):ToolArtifactIdentity{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-tool-artifact-identity');
  const input=value as Record<string,unknown>,keys=['scope','turnId','dispatchId','commandId','effectId','operation'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||typeof input.operation!=='string'||!OPERATIONS.has(input.operation as ToolArtifactOperation))reject('invalid-tool-artifact-identity');
  return {scope:validateScope(input.scope),turnId:turnId(input.turnId),dispatchId:turnId(input.dispatchId),commandId:turnId(input.commandId),effectId:turnId(input.effectId),operation:input.operation as ToolArtifactOperation};
}
export async function toolArtifactDescriptor(raw:ToolArtifactInput){
  const identity=toolArtifactIdentity(raw.identity);if(raw.mediaType!=='application/json'||!(raw.content instanceof Uint8Array)||raw.content.byteLength<=16384||raw.content.byteLength>TOOL_ARTIFACT_MAX_BYTES)reject('invalid-tool-artifact-content');
  let decoded:string,parsed:unknown;
  try{decoded=decoder.decode(raw.content);parsed=JSON.parse(decoded);}catch{reject('invalid-tool-artifact-content');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.getPrototypeOf(parsed)!==Object.prototype||JSON.stringify(parsed)!==decoded||decoded.includes('"__proto__"'))reject('invalid-tool-artifact-content');
  const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(raw.content)),contentSha256=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const descriptor={schemaVersion:1,identity,mediaType:'application/json' as const,bytes:raw.content.byteLength,sha256:contentSha256};
  const inputSha256=await turnDigest(descriptor),artifactId=`artifact-${(await turnDigest({purpose:'tool-result-artifact',descriptor})).slice(0,60)}`;
  return {identity,descriptor,inputSha256,artifactId,operationId:`artifact:${artifactId}`,objectKey:toolArtifactObjectKey(identity,contentSha256)};
}
export function toolArtifactObjectKey(identity:ToolArtifactIdentity,digest:string):string{
  const valid=toolArtifactIdentity(identity),contentSha256=sha(digest);
  return `tool-artifacts/${valid.scope.tenantId}/${valid.scope.projectId}/${valid.scope.workspaceId}/${valid.scope.workspaceGeneration}/${valid.turnId}/${valid.dispatchId}/${valid.commandId}/${valid.effectId}/${contentSha256}.json`;
}
export function toolArtifactIntent(value:unknown):ToolArtifactIntent{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-tool-artifact-intent');const input=value as Record<string,unknown>;
  if(Object.keys(input).length!==2||!Object.hasOwn(input,'operationId')||!Object.hasOwn(input,'inputSha256')||typeof input.operationId!=='string'||!/^artifact:artifact-[a-f0-9]{60}$/.test(input.operationId))reject('invalid-tool-artifact-intent');
  return {operationId:input.operationId,inputSha256:sha(input.inputSha256)};
}
export function toolArtifactId(value:unknown):string{if(typeof value!=='string'||!/^artifact-[a-f0-9]{60}$/.test(value))reject('invalid-tool-artifact-id');return value;}
export function toolArtifactReceipt(value:unknown):ToolArtifactReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-tool-artifact-receipt');const input=value as Record<string,unknown>,keys=['schemaVersion','artifactId','operation','mediaType','bytes','sha256','createdAt'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.schemaVersion!==1||typeof input.operation!=='string'||!OPERATIONS.has(input.operation as ToolArtifactOperation)||input.mediaType!=='application/json')reject('invalid-tool-artifact-receipt');
  const bytes=positive(input.bytes);if(bytes<=16384||bytes>TOOL_ARTIFACT_MAX_BYTES)reject('invalid-tool-artifact-receipt');return {schemaVersion:1,artifactId:toolArtifactId(input.artifactId),operation:input.operation as ToolArtifactOperation,mediaType:'application/json',bytes,sha256:sha(input.sha256),createdAt:positive(input.createdAt)};
}
export function toolArtifactReference(value:unknown):ToolArtifactReferenceInput{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-tool-artifact-reference');
  const input=value as Record<string,unknown>,keys=['schemaVersion','scope','artifactId','turnId','dispatchId','kind','referenceId'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.schemaVersion!==1||typeof input.kind!=='string'||!REFERENCE_KINDS.has(input.kind as ToolArtifactReferenceKind))reject('invalid-tool-artifact-reference');
  return {schemaVersion:1,scope:validateScope(input.scope),artifactId:toolArtifactId(input.artifactId),turnId:turnId(input.turnId),dispatchId:turnId(input.dispatchId),kind:input.kind as ToolArtifactReferenceKind,referenceId:turnId(input.referenceId)};
}
export function toolArtifactReferenceReceipt(value:unknown):ToolArtifactReferenceReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-tool-artifact-reference-receipt');
  const input=value as Record<string,unknown>,keys=['schemaVersion','artifactId','kind','referenceId','retainedAt','releasedAt'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key))||input.schemaVersion!==1||typeof input.kind!=='string'||!REFERENCE_KINDS.has(input.kind as ToolArtifactReferenceKind))reject('invalid-tool-artifact-reference-receipt');
  return {schemaVersion:1,artifactId:toolArtifactId(input.artifactId),kind:input.kind as ToolArtifactReferenceKind,referenceId:turnId(input.referenceId),retainedAt:positive(input.retainedAt),releasedAt:input.releasedAt===null?null:positive(input.releasedAt)};
}
export interface ToolArtifactStoreRpc{
  // Separate optional read projection: older test/runtime adapters fail closed.
  projectList?(scope:TurnScope,cursor:string|null):Promise<{items:ToolArtifactReceipt[];nextCursor:string|null;version:string}>;
  projectRead?(scope:TurnScope,artifactId:string):Promise<{receipt:ToolArtifactReceipt;content:Uint8Array}>;
  materialize(input:ToolArtifactInput):Promise<{intent:ToolArtifactIntent;receipt:ToolArtifactReceipt}>;
  reconcile(identity:ToolArtifactIdentity,intent:ToolArtifactIntent):Promise<ToolArtifactReceipt|null>;
  read(scope:TurnScope,artifactId:string):Promise<{receipt:ToolArtifactReceipt;content:Uint8Array}>;
  retain(input:ToolArtifactReferenceInput):Promise<ToolArtifactReferenceReceipt>;
  release(input:ToolArtifactReferenceInput):Promise<ToolArtifactReferenceReceipt>;
  references(scope:TurnScope,artifactId:string):Promise<ToolArtifactReferenceReceipt[]>;
}
export interface ToolArtifactStoreNamespace{getByName(name:string):ToolArtifactStoreRpc}
