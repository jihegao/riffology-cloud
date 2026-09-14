import {digest} from '../simulation/source.ts';
import type {FrozenPublication,PublicationReadiness,PublicationVersion} from './readiness.ts';
export type StoredPublication={schemaVersion:1;version:PublicationVersion;readiness:PublicationReadiness;exportKey:string;exportSha256:string;exportBytes:number;contentKey:string;contentSha256:string;contentBytes:number};
export interface PublicationArtifacts{put(frozen:FrozenPublication,authorize:()=>Promise<void>):Promise<StoredPublication>;read(snapshot:StoredPublication,kind:'content'|'export'):Promise<Uint8Array>}
const key=(kind:string,sha:string)=>{if(!/^[a-f0-9]{64}$/.test(sha))throw Error('publication-artifact-invalid');return `publication-v1/${kind}/${sha}`;};
/** Content-addressed create-only storage. Lost R2 acknowledgements reconcile
 * by exact bytes; approval never resolves a mutable source workspace. */
export class R2PublicationArtifacts implements PublicationArtifacts{
 readonly bucket:R2Bucket;constructor(bucket:R2Bucket){this.bucket=bucket;}
 async put(frozen:FrozenPublication,authorize:()=>Promise<void>):Promise<StoredPublication>{
  if(!frozen.readiness.ready||!frozen.readiness.version)throw Error('publication-not-ready');
  const snapshot:StoredPublication={schemaVersion:1,version:frozen.readiness.version,readiness:frozen.readiness,exportKey:key('export',frozen.exportSha256),exportSha256:frozen.exportSha256,exportBytes:frozen.exportBytes.length,contentKey:key('content',frozen.contentSha256),contentSha256:frozen.contentSha256,contentBytes:frozen.contentBytes.length};
  for(const kind of ['content','export']as const){const bytes=kind==='content'?frozen.contentBytes:frozen.exportBytes;if(bytes.length>(kind==='content'?8:16)*1024*1024||await digest(bytes)!==snapshot[`${kind}Sha256`])throw Error('publication-artifact-invalid');await authorize();try{await this.bucket.put(snapshot[`${kind}Key`],bytes,{onlyIf:{etagDoesNotMatch:'*'}});}catch{/* read below resolves delivery-unknown */}const read=await this.read(snapshot,kind);if(read.length!==bytes.length||read.some((b,i)=>b!==bytes[i]))throw Error('publication-artifact-invalid');}
  await authorize();return structuredClone(snapshot);
 }
 async read(snapshot:StoredPublication,kind:'content'|'export'){
  const expected=key(kind,snapshot[`${kind}Sha256`]);if(snapshot[`${kind}Key`]!==expected)throw Error('publication-artifact-invalid');
  const object=await this.bucket.get(expected);if(!object)throw Error('publication-artifact-missing');
  try{if(object.size!==snapshot[`${kind}Bytes`]||object.size>(kind==='content'?8:16)*1024*1024)throw Error('publication-artifact-invalid');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==object.size||await digest(bytes)!==snapshot[`${kind}Sha256`])throw Error('publication-artifact-invalid');return bytes;}finally{await object.body?.cancel().catch(()=>{});}
 }
}
