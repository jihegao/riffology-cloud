import {buildResearchExport,type ResearchSnapshot,type ExportPorts} from '../research/export.ts';
import {digest,modelVersion,simulationPlan} from '../simulation/source.ts';
import {validateMetrics} from '../simulation/model-spec.ts';
import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
import {verifyModelContent,MODEL_CONTENT_MAX_BYTES,MODEL_CONTENT_MAX_FILE_BYTES} from '../runtime/content.ts';

export type PublicationVersion=ReturnType<typeof modelVersion>;
export type PublicationReadiness={schemaVersion:1;ready:boolean;version:PublicationVersion|null;checks:Array<{code:string;passed:boolean}>;exampleGroupIds:string[];baselineRunIds:string[];limitations:string[]};
export type FrozenPublication={readiness:PublicationReadiness;manifest:Awaited<ReturnType<typeof buildResearchExport>>['manifest'];exportBytes:Uint8Array;exportSha256:string;contentBytes:Uint8Array;contentSha256:string};
const publicFailure=(error:unknown,kind:'source'|'export')=>{const code=error instanceof Error?error.message:'';return /^(?:invalid-model-spec|model-spec-(?:missing|too-large)|model-contract-mismatch|simulation-dependencies-invalid|export-(?:source-mismatch|result-missing|dependencies-invalid|model-spec-invalid|evidence-mismatch|sensitive-file|too-large)|publication-(?:source-path-unsupported|content-too-large))$/.test(code)?code:`publication-${kind}-unavailable`;};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameModel=(a:PublicationVersion,b:PublicationVersion)=>a.filesSha256===b.filesSha256&&a.specSha256===b.specSha256;

/** A generic adapter for the existing immutable catalog format. Source bytes
 * are preserved for every public file; platform README is regenerated on copy.
 * Unsupported roots fail rather than quietly omitting user content. */
export async function publicationContent(archive:Uint8Array):Promise<{bytes:Uint8Array;sha256:string}>{
 const index=workspaceFileIndex(archive),reader=workspaceArchiveReader(archive),files=[];
 for(const entry of index.files.filter(f=>f.type==='file').sort((a,b)=>a.path<b.path?-1:1)){
  if(entry.path==='README.md')continue;
  if(!['model','app','experiments','docs'].includes(entry.path.split('/')[0]!))throw Error('publication-source-path-unsupported');
  if(entry.size>MODEL_CONTENT_MAX_FILE_BYTES)throw Error('publication-content-too-large');
  const value=reader.read([{path:entry.path,maxBytes:Math.max(1,entry.size)}]).get(entry.path)!;
  let binary='';for(let i=0;i<value.length;i+=0x8000)binary+=String.fromCharCode(...value.subarray(i,i+0x8000));
  files.push({path:entry.path,bytes:value.length,sha256:await digest(value),contentBase64:btoa(binary)});
 }
 const bytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,files}));if(bytes.length>MODEL_CONTENT_MAX_BYTES)throw Error('publication-content-too-large');
 const sha256=await digest(bytes);await verifyModelContent({modelVersionId:'publication-check',modelId:'publication-check',version:'1',contentRef:'publication-check',contentSha256:sha256},{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
 return {bytes,sha256};
}

/** This is a machine readiness gate, not a scientific correctness certificate.
 * Only immutable result artifacts verified by the complete export can pass. */
export async function preparePublication(snapshot:ResearchSnapshot,ports:ExportPorts,activeUnsaved:boolean):Promise<{readiness:PublicationReadiness;frozen:FrozenPublication|null}>{
 const readiness:PublicationReadiness={schemaVersion:1,ready:false,version:null,checks:[],exampleGroupIds:[],baselineRunIds:[],limitations:[]};
 const check=(code:string,passed:boolean)=>{readiness.checks.push({code,passed});return passed;};
 check('saved-revision',snapshot.current.kind==='saved-turn');check('no-active-unsaved-state',!activeUnsaved);
 await ports.authorize();let archive:Uint8Array,plan;
 try{archive=await ports.source(snapshot.current,MODEL_CONTENT_MAX_BYTES);plan=await simulationPlan(snapshot.current,archive);}catch(error){check(publicFailure(error,'source'),false);return {readiness,frozen:null};}
 const version=readiness.version=modelVersion(plan),spec=plan.spec;readiness.limitations=[...spec.limitations];
 check('persistent-spec',true);check('declared-parameters',Object.keys(spec.parameters).length>0);check('declared-metrics',Object.keys(spec.metrics).length>0);check('limitations-and-scope',spec.limitations.length>0&&!!spec.scope.trim());
 const rejected=(runId:string)=>snapshot.assessments.some(a=>a.scope==='run'?a.runId===runId:a.scope==='model'&&sameModel(a.version as PublicationVersion,version));
 check('model-not-rejected',!snapshot.assessments.some(a=>a.scope==='model'&&sameModel(a.version as PublicationVersion,version)));
 const eligible=(run:ResearchSnapshot['runs'][number])=>{if(run.status!=='completed'||!run.result||!sameModel(modelVersion(run.input.plan),version)||rejected(run.runId))return false;try{validateMetrics(spec,run.result.metrics);return true;}catch{return false;}};
 for(const group of snapshot.groups){
  if(group.status!=='completed'||group.cancelledAt!==null||group.errorCode||!sameModel(modelVersion(group.plan),version))continue;
  const baseline=group.configurations.find(c=>c.role==='baseline'),interventions=group.configurations.filter(c=>c.role==='intervention');
  if(!baseline||!interventions.length||!interventions.some(c=>!same(c.parameters,baseline.parameters))||group.seeds.length<1||group.children.length!==group.configurations.length*group.seeds.length)continue;
  const identities=new Set<string>();let valid=true;const baselineIds=[];
  for(const child of group.children){
   const configuration=group.configurations.find(c=>c.configurationId===child.configurationId),run=snapshot.runs.find(r=>r.runId===child.runId),identity=JSON.stringify([child.configurationId,child.seed]);
   if(identities.has(identity)||child.cancelled||!group.seeds.includes(child.seed)||!configuration||!run||!eligible(run)||run.groupId!==group.groupId||run.experimentId!==group.groupId||run.input.seed!==child.seed||!same(run.input.parameters,configuration.parameters)){valid=false;break;}
   identities.add(identity);if(configuration.role==='baseline')baselineIds.push(run.runId);
  }
  if(valid){readiness.exampleGroupIds.push(group.groupId);readiness.baselineRunIds.push(...baselineIds);}
 }
 check('successful-baseline',readiness.baselineRunIds.length>0);check('complete-example-comparison',readiness.exampleGroupIds.length>0);
 if(readiness.checks.some(c=>!c.passed))return {readiness,frozen:null};
 let exported,content;
 try{exported=await buildResearchExport(snapshot,ports);content=await publicationContent(archive);}catch(error){check(publicFailure(error,'export'),false);return {readiness,frozen:null};}
 check('complete-reproducible-export',true);check('copyable-model-content',true);await ports.authorize();readiness.ready=true;
 return {readiness,frozen:{readiness:structuredClone(readiness),manifest:exported.manifest,exportBytes:exported.bytes,exportSha256:exported.sha256,contentBytes:content.bytes,contentSha256:content.sha256}};
}
