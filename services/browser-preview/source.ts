import type { TurnRuntimeIdentity } from '../turn-runtime/identity.ts';
import type { CheckpointReceipt } from '../turn/protocol.ts';
import type { InitialWorkspaceReference } from '../turn-runtime/initial-workspace.ts';
import type { ManualSaveIdentity,ManualRevisionReceipt } from '../turn-runtime/manual-save.ts';
import type { PreviewSource } from '../preview/source.ts';
/** Kind-less saved rows retain their original durable identity. Initial content
 * is a separate provenance, never a synthetic Turn or checkpoint receipt. */
export type SavedBrowserSource={kind?:'saved-turn';identity:TurnRuntimeIdentity;receipt:CheckpointReceipt};
export type ManualBrowserSource={kind:'manual-save';identity:ManualSaveIdentity;receipt:ManualRevisionReceipt};
export type InitialBrowserSource={kind:'initial-workspace';reference:InitialWorkspaceReference;referenceSha256:string;revisionId:string;filesSha256:string|null};
export type BrowserBuildSource=SavedBrowserSource|ManualBrowserSource|InitialBrowserSource;
export function sourceScope(source:BrowserBuildSource){return source.kind==='initial-workspace'?source.reference.scope:source.identity.scope;}
export function sourceRevision(source:BrowserBuildSource){return source.kind==='initial-workspace'?source.revisionId:source.receipt.revisionId;}
export function sourceFilesSha(source:BrowserBuildSource){return source.kind==='initial-workspace'?source.filesSha256:source.receipt.filesSha256;}
export function frozenSource(source:BrowserBuildSource):BrowserBuildSource{return source.kind==='initial-workspace'?{kind:source.kind,reference:source.reference,referenceSha256:source.referenceSha256,revisionId:source.revisionId,filesSha256:source.filesSha256}:source.kind==='manual-save'?{kind:source.kind,identity:source.identity,receipt:source.receipt}:{identity:source.identity,receipt:source.receipt};}
export function sourcePreview(source:BrowserBuildSource):PreviewSource{if(source.kind==='initial-workspace'){if(!source.filesSha256)throw Error('browser-preview-source-unavailable');return {kind:source.kind,reference:source.reference,filesSha256:source.filesSha256};}if(source.kind==='manual-save')return {kind:source.kind,identity:source.identity,revision:source.receipt};return {kind:'saved-turn',identity:source.identity,revision:source.receipt};}
