import {workspaceArchiveReader,workspaceFileIndex} from './workspace-file-index.ts';
import {digest} from '../simulation/source.ts';
import {sha} from '../turn/protocol.ts';
import {frozenTurnSnapshot,type FrozenTurnSnapshot} from './revision.ts';
import {type ExecutionBinding} from './backend-contract.ts';
import {initialWorkspaceArchive} from './initial-workspace-archive.ts';
import {parseModelSpec} from '../simulation/model-spec.ts';
export type CandidateArtifactManifest={schemaVersion:1;format:'riffology-workspace-ustar';size:number;sha256:string;files:Array<{path:string;size:number;sha256:string}>};
const MAX_BYTES=8*1024*1024,MAX_FILES=512;
/** Accept a bounded, uncompressed canonical workspace archive. ZIP, gzip,
 * links, devices and noncanonical paths are refused rather than extracted.
 * The archive reader owns traversal, duplicate and aggregate-size validation. */
export async function validateCandidateArtifact(raw:unknown,bytes:Uint8Array):Promise<Uint8Array>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('candidate-schema-invalid');
 const m=raw as CandidateArtifactManifest;
 if(Object.keys(m).sort().join(',')!=='files,format,schemaVersion,sha256,size'||m.schemaVersion!==1||m.format!=='riffology-workspace-ustar'||!Number.isSafeInteger(m.size)||m.size<1||m.size>MAX_BYTES||!(bytes instanceof Uint8Array)||bytes.byteLength!==m.size||!Array.isArray(m.files)||m.files.length>MAX_FILES)throw Error('candidate-schema-invalid');
 if(await digest(bytes)!==sha(m.sha256))throw Error('candidate-hash-mismatch');
 const archive=workspaceArchiveReader(bytes),entries=workspaceFileIndex(bytes).files.filter(e=>e.type==='file');
 if(entries.length!==m.files.length)throw Error('candidate-file-coverage');
 const seen=new Set<string>();
 for(const declared of m.files){
  if(!declared||Object.keys(declared).sort().join(',')!=='path,sha256,size'||typeof declared.path!=='string'||seen.has(declared.path)||!Number.isSafeInteger(declared.size)||declared.size<0||declared.size>1024*1024)throw Error('candidate-schema-invalid');seen.add(declared.path);
  const entry=entries.find(e=>e.path===declared.path);if(!entry||entry.size!==declared.size)throw Error('candidate-file-coverage');
  const content=archive.read([{path:declared.path,maxBytes:Math.max(1,declared.size)}]).get(declared.path)!;
  if(await digest(content)!==sha(declared.sha256))throw Error('candidate-hash-mismatch');
 }
 return Uint8Array.from(bytes);
}
/** Backend-neutral packaging, not model validation or Evidence promotion.
 * A caller supplies the actual model contract; no inferred dependency lock or
 * fabricated seed/result is added. Formal execution still uses simulationPlan. */
export function packageCandidateModel(files:Readonly<Record<string,Uint8Array>>,rawSpec:unknown):Uint8Array{
 const spec=parseModelSpec(rawSpec);
 if(Object.hasOwn(files,'model/model-spec.json'))throw Error('candidate-model-spec-conflict');
 if('kind' in spec.execution){
  if(!(files[spec.execution.businessIr] instanceof Uint8Array)||!(files[spec.execution.bundle] instanceof Uint8Array))throw Error('candidate-model-contract-missing');
 }else if(!(files[spec.execution.entrypoint] instanceof Uint8Array)||!(files[spec.execution.dependencyLock] instanceof Uint8Array))throw Error('candidate-model-contract-missing');
 return initialWorkspaceArchive({...files,'model/model-spec.json':new TextEncoder().encode(JSON.stringify(spec))});
}
/** Feed this snapshot to the existing RevisionStoreCheckpointPort. That port
 * prepares/reconciles immutable R2 publication; TurnJournal still owns head CAS. */
export async function managedCandidateSnapshot(binding:ExecutionBinding,manifest:unknown,bytes:Uint8Array):Promise<FrozenTurnSnapshot>{
 if(binding.backend!=='managed-agents'||!binding.remoteSessionId||!binding.remoteTurnId)throw Error('candidate-binding-unknown');
 const filesArchive=await validateCandidateArtifact(manifest,bytes);
 return frozenTurnSnapshot({identity:binding.identity,filesArchive,backendState:{schemaVersion:1,backend:'managed-agents',recovery:'remote-reference',identity:binding.identity,sessionId:binding.remoteSessionId,turnId:binding.remoteTurnId}},binding.identity);
}
