import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EvidenceLedger,evidenceRequest,type EvidenceGroup,type EvidencePorts} from '../../services/simulation/evidence.ts';
import {digest,modelVersion,simulationPlan} from '../../services/simulation/source.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import type {SimulationRecord} from '../../services/simulation/host.ts';
import {scope,actor,spec as serviceSpec} from './run-fixture.ts';
const spec={schemaVersion:1 as const,researchQuestion:'Queue?',scope:'One queue',entities:['customer'],mechanisms:['FCFS'],assumptions:['Poisson arrivals'],parameters:{servers:{type:'integer' as const,default:1}},metrics:{wait:{unit:'min'}},limitations:['No abandonment'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
const encode=(text:string)=>new TextEncoder().encode(text);
const archive=initialWorkspaceArchive({'model/model-spec.json':encode(JSON.stringify(spec)),'model/run.py':encode('print(1)'),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}')});
const originalSource=serviceSpec().plan.source;
const plan=await simulationPlan({...originalSource,revision:{...originalSource.revision,filesSha256:await digest(archive)}},archive);
async function setup(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'evidence-')),file=join(dir,'state.db');let db=new DatabaseSync(file);db.exec('CREATE TABLE kv(k TEXT PRIMARY KEY,v TEXT)');let lose=false;
 const get=async<T,>(key:string):Promise<T|undefined>=>{const row=db.prepare('SELECT v FROM kv WHERE k=?').get(key);return row?JSON.parse(String(row.v)):undefined;};
 const put=async(key:string,value:unknown)=>{db.prepare('INSERT OR REPLACE INTO kv VALUES(?,?)').run(key,JSON.stringify(value));};
 const list=async<T,>(options:{prefix:string})=>new Map(db.prepare('SELECT k,v FROM kv WHERE k LIKE ? ORDER BY k').all(options.prefix+'%').map(r=>[String(r.k),JSON.parse(String(r.v)) as T]));
 const tx={get,put,list};const storage={...tx,transaction:async<T,>(fn:(transaction:typeof tx)=>Promise<T>)=>{db.exec('BEGIN');try{const value=await fn(tx);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}},sync:async()=>{if(lose){lose=false;throw Error('lost-ack');}}} as unknown as DurableObjectStorage;
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const runs=new Map<string,SimulationRecord>(),artifacts=new Map<string,Uint8Array>();
 const group:EvidenceGroup={experimentId:'group',status:'partial',version:modelVersion(plan),inputs:{},arms:[{armId:'base',role:'baseline',runIds:['b1','b2']},{armId:'change',role:'intervention',runIds:['c1','c2','c3']}]};
 async function add(id:string,value:number,status:SimulationRecord['status']='completed'){
  const parameters={servers:id.startsWith('b')?1:2},seed=1;const envelope={schemaVersion:1,runId:id,experimentId:'group',version:modelVersion(plan),parameters,seed,runtimeImage:'image',pythonVersion:'3.11.1',metrics:{wait:value}};
  const bytes=new TextEncoder().encode(JSON.stringify(envelope)),hash=await digest(bytes);const run={runId:id,experimentId:'group',scope,actor,key:id,requestJson:'{}',input:{runId:id,plan:structuredClone(plan),parameters,seed,deadlineAt:200,runtimeImage:'image'},status,createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null,attempt:0,quotaClaimed:true,releaseProof:null,lease:null,startClaimed:true,stop:null,result:status==='completed'?{metrics:{wait:value},artifactSha256:hash}:null,releaseBegunAt:2,quietSince:2,released:true} satisfies SimulationRecord;
  group.inputs[id]={parameters,seed};runs.set(id,run);artifacts.set(`simulation-results-v1/${scope.tenantId}/${scope.projectId}/${scope.workspaceId}/${id}/${hash}.json`,bytes);return run;
 }
 await add('b1',10);await add('b2',14);await add('c1',6);await add('c2',9,'failed');group.inputs.c3={parameters:{servers:2},seed:2};
 const ports:EvidencePorts={source:async()=>archive,run:async id=>{const r=runs.get(id);if(!r)throw Error('simulation-not-found');return structuredClone(r);},group:async id=>{if(id!=='group')throw Error('simulation-not-found');return structuredClone(group);},artifact:async key=>artifacts.get(key)??null};
 return {storage,runs,artifacts,group,ports,add,ledger:()=>new EvidenceLedger(storage,scope,ports,()=>100),reopen:()=>{db.close();db=new DatabaseSync(file);},lose:()=>{lose=true;}};
}
const request={schemaVersion:1 as const,kind:'percent-change' as const,experimentId:'group',armId:'change',metric:'wait'};
test('measured delta binds exact frozen references and excludes failed/unadmitted samples',async t=>{
 const f=await setup(t),claim=await f.ledger().create(request,actor);assert.equal(claim.value,-50);assert.equal(claim.count,1);assert.equal(claim.baselineCount,2);assert.equal(claim.plannedCount,5);assert.equal(claim.baselineMean,12);assert.equal(claim.interventionMean,6);assert.deepEqual(claim.excluded.map(r=>r.reason),['failed','pending']);assert.equal(claim.experimentStatus,'partial');assert.equal(claim.scientificValidity,'unassessed');assert.deepEqual(claim.assumptions,['Poisson arrivals']);assert.equal(claim.references[0]!.experimentId,'group');assert.equal(claim.experimentId,'group');
 const view=await f.ledger().get(claim.claimId,modelVersion(plan));assert.equal(view.evidenceValidity,'verified');assert.equal(view.stale,false);assert.equal(view.olderRevision,false);
});
test('fabricated values, source/version/metric and group membership mismatches cannot become measurements',async t=>{
 const f=await setup(t);for(const invalid of [{...request,expectedValue:31},{...request,expectedVersion:{...modelVersion(plan),specSha256:'9'.repeat(64)}},{...request,metric:'historical_wait'},{...request,armId:'unrelated'}])await assert.rejects(f.ledger().create(invalid,actor),/evidence-/);
 assert.throws(()=>evidenceRequest({...request,source:'LLM estimate'}),/evidence-input-invalid/);assert.throws(()=>evidenceRequest({...request,runId:'b1'}),/evidence-input-invalid/);
 f.group.inputs.b1={parameters:{servers:999},seed:1};await assert.rejects(f.ledger().create(request,actor),/evidence-group-mismatch/);
});
test('result envelope checksum alone cannot authorize cross-run, metric or metadata substitution',async t=>{
 for(const mutation of ['checksum','metric','run','revision','parameters','seed','runtime']){
  const f=await setup(t),run=f.runs.get('b1')!,key=[...f.artifacts.keys()].find(k=>k.includes('/b1/'))!,raw=JSON.parse(new TextDecoder().decode(f.artifacts.get(key)!));
  if(mutation==='checksum'){f.artifacts.set(key,new TextEncoder().encode('{}'));}else{if(mutation==='metric')raw.metrics.wait=99;if(mutation==='run')raw.runId='b2';if(mutation==='revision')raw.version.revisionId='other';if(mutation==='parameters')raw.parameters.servers=99;if(mutation==='seed')raw.seed=99;if(mutation==='runtime')raw.runtimeImage='other';const bytes=new TextEncoder().encode(JSON.stringify(raw)),hash=await digest(bytes);run.result!.artifactSha256=hash;f.artifacts.set(key.replace(/[^/]+\.json$/,hash+'.json'),bytes);}
  await assert.rejects(f.ledger().create({schemaVersion:1,kind:'run',runId:'b1',metric:'wait'},actor),/evidence-source-mismatch/);
 }
});
test('claims survive lost acknowledgement/restart and retain old-version status',async t=>{
 const f=await setup(t);f.lose();await assert.rejects(f.ledger().create(request,actor),/lost-ack/);f.reopen();const claim=await f.ledger().create(request,actor);assert.equal((await f.ledger().list(modelVersion(plan))).items.length,1);
 const old=await f.ledger().get(claim.claimId,{...modelVersion(plan),revisionId:'new',filesSha256:'f'.repeat(64)});assert.equal(old.stale,true);assert.equal(old.olderRevision,true);assert.equal(old.value,-50);assert.equal(old.evidenceValidity,'verified');
});
test('attributed model rejection invalidates existing claims and excludes all same-model runs',async t=>{
 const f=await setup(t),claim=await f.ledger().create(request,actor);const rejection=await f.ledger().reject({scope:'model',runId:'b1',reason:'Mechanism omitted abandonment'},actor);f.reopen();const view=await f.ledger().get(claim.claimId,modelVersion(plan));assert.equal(view.evidenceValidity,'rejected');assert.equal(view.value,-50);assert.equal(view.assessments[0]!.assessmentId,rejection.assessmentId);assert.deepEqual(view.assessments[0]!.createdBy,actor);await assert.rejects(f.ledger().create(request,actor),/evidence-no-valid-runs/);
});
test('single-run rejection retains remaining eligible denominator; rejected version cannot race claim commit',async t=>{
 const f=await setup(t);await f.ledger().reject({scope:'run',runId:'b1',reason:'Unrepresentative run'},actor);const claim=await f.ledger().create(request,actor);assert.equal(claim.baselineCount,1);assert.equal(claim.references.some(r=>r.runId==='b1'),false);
 const original=f.ports.artifact;let once=true;f.ports.artifact=async key=>{const bytes=await original(key);if(once){once=false;await f.ledger().reject({scope:'model',runId:'b2',reason:'Rejected during verification'},actor);}return bytes;};await assert.rejects(f.ledger().create(request,actor),/evidence-source-rejected/);
});
test('missing artifacts and changed completed records invalidate persisted evidence on read',async t=>{
 const f=await setup(t),claim=await f.ledger().create(request,actor);f.artifacts.clear();assert.equal((await f.ledger().get(claim.claimId,modelVersion(plan))).evidenceValidity,'unavailable');
 const g=await setup(t),other=await g.ledger().create(request,actor);g.runs.get('b1')!.status='unknown';assert.equal((await g.ledger().get(other.claimId,modelVersion(plan))).evidenceValidity,'unavailable');
});
test('zero baseline, failed-only data and authorization changes fail closed',async t=>{
 const f=await setup(t);await f.add('b1',0);await f.add('b2',0);await assert.rejects(f.ledger().create(request,actor),/evidence-zero-baseline/);await assert.rejects(f.ledger().create({schemaVersion:1,kind:'run',runId:'c2',metric:'wait'},actor),/evidence-no-valid-runs/);await assert.rejects(f.ledger().create({schemaVersion:1,kind:'mean',experimentId:'group',armId:'change',metric:'wait'},actor,()=>{throw Error('access-revoked');}),/access-revoked/);assert.equal((await f.ledger().list(modelVersion(plan))).items.length,0);
});

test('rejection during an awaited artifact read wins before returning a measured card',async t=>{
 const f=await setup(t),claim=await f.ledger().create(request,actor),original=f.ports.artifact;let once=true;f.ports.artifact=async key=>{if(once){once=false;await f.ledger().reject({scope:'model',runId:'b1',reason:'Rejected while reading'},actor);}return original(key);};const view=await f.ledger().get(claim.claimId,modelVersion(plan));assert.equal(view.evidenceValidity,'rejected');assert.equal(view.assessments.length,1);
});
test('context/list returns recorded proof without any artifact I/O and preserves source IDs',async t=>{
 const f=await setup(t),claim=await f.ledger().create(request,actor);f.ports.artifact=async()=>{throw Error('must not fetch');};const page=await f.ledger().list(modelVersion(plan),undefined,3);assert.equal(page.items[0]!.claimId,claim.claimId);assert.equal(page.items[0]!.evidenceValidity,'recorded');assert.equal(page.items[0]!.references.length,3);
});

test('saved source bytes and persisted Spec cannot drift behind an unchanged declared digest',async t=>{
 const f=await setup(t);f.runs.get('b1')!.input.plan.spec.assumptions=['fabricated'];await assert.rejects(f.ledger().create(request,actor),/evidence-source-mismatch/);
});
