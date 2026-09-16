import {digest} from '../simulation/source.ts';
import {modelVersion} from '../simulation/source.ts';
import type {SimulationRecord} from '../simulation/host.ts';
import type {SimulationOutput} from '../simulation/outputs.ts';
import type {TurnScope} from '../turn/protocol.ts';

const COLUMNS=['frame','time','queue_length','completed','abandoned','rejected','active','waiting'] as const;
const exact=(value:unknown,keys:readonly string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
type AuditRow=[number,number,number,number,number,number,number,number];

async function bounded(bucket:R2Bucket,key:string,max:number,expectedSha256:string){
 const object=await bucket.get(key);if(!object||object.size<1||object.size>max)throw Error('g5-b2-artifact-unavailable');const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.byteLength!==object.size||await digest(bytes)!==expectedSha256)throw Error('g5-b2-artifact-digest-mismatch');return bytes;
}
function json(bytes:Uint8Array,code:string){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error(code);}}
function audit(value:unknown,parameters:Record<string,string|number|boolean>){
 if(!exact(value,['schemaVersion','columns','rows']))throw Error('g5-b2-trace-shape-invalid');const raw=value as {schemaVersion:unknown;columns:unknown;rows:unknown};if(raw.schemaVersion!==1||!same(raw.columns,COLUMNS)||!Array.isArray(raw.rows)||raw.rows.length<1||raw.rows.length>501)throw Error('g5-b2-trace-shape-invalid');
 let priorFrame=-1,priorTime=-1,priorTotal=-1,priorCompleted=-1,priorAbandoned=-1,priorRejected=-1;const customers=parameters.customers;if(typeof customers!=='number'||!integer(customers)||customers<1)throw Error('g5-b2-trace-parameters-invalid');
 for(const candidate of raw.rows){if(!Array.isArray(candidate)||candidate.length!==8||!integer(candidate[0])||!finite(candidate[1])||candidate.slice(2).some(value=>!integer(value)))throw Error('g5-b2-trace-value-invalid');const row=candidate as AuditRow,[frame,time,queue,completed,abandoned,rejected,active,waiting]=row,total=completed+abandoned+rejected+active;if(frame<=priorFrame||time<priorTime||completed<priorCompleted||abandoned<priorAbandoned||rejected<priorRejected||total<priorTotal||total>customers||waiting>active||queue!==waiting)throw Error('g5-b2-trace-invariant-invalid');const capacity=parameters.queue_capacity;if(capacity!==undefined&&(typeof capacity!=='number'||capacity<0||queue>capacity))throw Error('g5-b2-trace-capacity-invalid');priorFrame=frame;priorTime=time;priorTotal=total;priorCompleted=completed;priorAbandoned=abandoned;priorRejected=rejected;}
 const final=raw.rows.at(-1) as AuditRow,[,,,,abandoned,rejected,active,waiting]=final;if(priorTotal!==customers||active!==0||waiting!==0)throw Error('g5-b2-trace-conservation-invalid');if(parameters.max_wait===0&&(raw.rows.some(row=>(row as AuditRow)[7]!==0)||abandoned<1))throw Error('g5-b2-trace-zero-wait-invalid');if(parameters.queue_capacity===0&&(raw.rows.some(row=>(row as AuditRow)[2]!==0)||rejected<1))throw Error('g5-b2-trace-zero-capacity-invalid');
 return {frames:raw.rows.length,firstFrame:(raw.rows[0] as AuditRow)[0],lastFrame:final[0],customers,completed:final[3],abandoned,rejected,active,waiting};
}
function output(outputs:SimulationOutput[]|undefined,path:string){const matches=(outputs??[]).filter(value=>value.path===path);if(matches.length!==1)throw Error('g5-b2-output-missing');const value=matches[0]!;if(!exact(value,['path','sha256','size','mediaType'])||value.mediaType!=='application/json'||!Number.isSafeInteger(value.size)||value.size<1||value.size>16384||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('g5-b2-output-invalid');return value;}
export async function g5B2RunEvidence(bucket:R2Bucket,scope:TurnScope,record:SimulationRecord,turnId:string){
 if(!record.result)throw Error('g5-b2-run-result-absent');const prefix=`simulation-results-v1/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/${record.runId}`,envelopeBytes=await bounded(bucket,`${prefix}/${record.result.artifactSha256}.json`,65536,record.result.artifactSha256),envelope=json(envelopeBytes,'g5-b2-result-json-invalid');
 const envelopeKeys=['schemaVersion','runId','experimentId','version','parameters','seed','runtimeImage','pythonVersion','metrics','outputs',...(Object.prototype.hasOwnProperty.call(envelope,'nativeObservation')?['nativeObservation']:[])];if(!exact(envelope,envelopeKeys)||envelope.schemaVersion!==1||envelope.runId!==record.runId||envelope.experimentId!==record.experimentId||!same(envelope.version,modelVersion(record.input.plan))||!same(envelope.parameters,record.input.parameters)||envelope.seed!==record.input.seed||envelope.runtimeImage!==record.input.runtimeImage||!same(envelope.metrics,record.result.metrics)||!same(envelope.outputs,record.result.outputs))throw Error('g5-b2-result-envelope-mismatch');
 output(record.result.outputs,'summary.json');const trace=output(record.result.outputs,'trace-audit.json'),traceBytes=await bounded(bucket,`${prefix}/outputs/${trace.sha256}`,16384,trace.sha256);if(traceBytes.byteLength!==trace.size)throw Error('g5-b2-output-size-mismatch');const recomputed=audit(json(traceBytes,'g5-b2-trace-json-invalid'),record.input.parameters);
 return {schemaVersion:1 as const,runId:record.runId,artifactSha256:record.result.artifactSha256,traceAuditSha256:trace.sha256,verified:{status:'verified' as const,checks:['bounded-result-envelope','bounded-trace-audit','finite-nonnegative','strict-frame-order','cumulative-conservation','queue-length-equals-waiting',...(record.input.parameters.max_wait===0?['zero-wait-boundary']:[]),...(record.input.parameters.queue_capacity===0?['zero-capacity-boundary']:[])]},recomputed,interpretation:{status:'unassessed' as const,turnId}};
}
