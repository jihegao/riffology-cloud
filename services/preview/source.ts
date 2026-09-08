import {checkpointReceipt,type CheckpointReceipt} from '../turn/protocol.ts';
import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {workspaceArchiveReader} from '../turn-runtime/workspace-file-index.ts';
import {PREVIEW_DECLARATION_PATH,parsePreviewDeclaration,type PreviewDeclaration} from './declaration.ts';

export interface PreviewRevisionSource{files(identity:TurnRuntimeIdentity,receipt:CheckpointReceipt):Promise<Uint8Array>}
export type ResolvedPreviewPlan={schemaVersion:1;kind:'service';identity:TurnRuntimeIdentity;revision:CheckpointReceipt;declaration:PreviewDeclaration;declarationSha256:string;entrypointSha256:string;dependencyLockSha256:string};
const MAX_DECLARATION=16*1024,MAX_ENTRYPOINT=1024*1024,MAX_LOCK=64*1024;
async function digest(bytes:Uint8Array){const hash=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

/** Resolves only a saved workspace revision. This is an execution plan, not
 * evidence of a running service, installed dependencies or a read-only app. */
export class PreviewPlanResolver{
  readonly #source:PreviewRevisionSource;
  constructor(source:PreviewRevisionSource){if(!source?.files)throw Error('preview-revision-source-required');this.#source=source;}
  async resolve(rawIdentity:TurnRuntimeIdentity,rawReceipt:CheckpointReceipt):Promise<ResolvedPreviewPlan>{
    const identity=turnRuntimeIdentity(rawIdentity),revision=checkpointReceipt(rawReceipt);
    const raw=await this.#source.files(identity,revision);
    if(!(raw instanceof Uint8Array)||raw.length>56*1024*1024)throw Error('invalid-preview-revision');
    const archive=workspaceArchiveReader(raw);
    if(await archive.sha256()!==revision.filesSha256)throw Error('preview-revision-mismatch');
    const declarationBytes=archive.read([{path:PREVIEW_DECLARATION_PATH,maxBytes:MAX_DECLARATION}]).get(PREVIEW_DECLARATION_PATH)!;
    let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(declarationBytes));}catch{throw Error('invalid-preview-declaration');}
    const declaration=parsePreviewDeclaration(parsed);
    const files=archive.read([{path:declaration.entrypoint,maxBytes:MAX_ENTRYPOINT},{path:declaration.dependencyLock,maxBytes:MAX_LOCK}]);
    return {schemaVersion:1,kind:'service',identity,revision,declaration,declarationSha256:await digest(declarationBytes),entrypointSha256:await digest(files.get(declaration.entrypoint)!),dependencyLockSha256:await digest(files.get(declaration.dependencyLock)!)};
  }
}
