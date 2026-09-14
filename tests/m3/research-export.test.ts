import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {buildResearchExport,researchSnapshot,type ResearchSnapshot} from '../../services/research/export.ts';
import {ExportFiles,crc32} from '../../services/research/zip.ts';
import {digest,simulationPlan,modelVersion} from '../../services/simulation/source.ts';
import {R2TurnRevisionPort,R2TurnRevisionReader} from '../../services/turn-runtime/revision.ts';
import {publishSimulationResult,type SimulationRecord} from '../../services/simulation/host.ts';
const encode=(s:string)=>new TextEncoder().encode(s);
const scope={tenantId:'tenant',projectId:'project',workspaceId:'workspace',workspaceGeneration:1};
const identity={scope,sessionId:'private-session-id',turnId:'turn',dispatchId:'private-dispatch',generation:1};
const code=`import argparse,json,random,pathlib\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');a=p.parse_args()\ni=json.loads(pathlib.Path(a.input).read_text());rng=random.Random(i['seed']);value=sum(rng.random() for _ in range(4))*i['parameters']['capacity']\npathlib.Path(a.output).write_text(json.dumps({'schemaVersion':1,'metrics':{'score':value},'outputs':['series.csv']}))\npathlib.Path(a.output).with_name('series.csv').write_text('score\\n'+str(value)+'\\n')\n`;
async function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'research-export-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const modelDir=join(dir,'execution');mkdirSync(modelDir);writeFileSync(join(modelDir,'run.py'),code);
 const spec={schemaVersion:1,researchQuestion:'Does capacity affect score?',scope:'Four seeded samples',entities:['sample'],mechanisms:['independent sampling'],assumptions:['uniform random samples'],parameters:{capacity:{type:'integer',default:2}},metrics:{score:{unit:'points'}},limitations:['reference computation'],execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
 const archive=initialWorkspaceArchive({'model/run.py':encode(code),'model/model-spec.json':encode(JSON.stringify(spec,null,2)),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}')});
 const source={kind:'saved-turn' as const,identity,revision:{revisionId:'revision-1',objectKey:'private-revision-manifest',filesSha256:await digest(archive),sessionSha256:'c'.repeat(64),committedAt:1}};
 const plan=await simulationPlan(source,archive),objects=new Map<string,Uint8Array>();
 const bucket={put:async(key:string,value:Uint8Array|string)=>{objects.set(key,typeof value==='string'?encode(value):Uint8Array.from(value));},get:async(key:string)=>{const bytes=objects.get(key);return bytes?{size:bytes.length,text:async()=>new TextDecoder().decode(bytes),arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}} as unknown as R2Bucket;
 const runs:SimulationRecord[]=[];
 for(const [index,capacity]of [2,3].entries()){
  const runId='run-'+index,input={schemaVersion:1,runId,parameters:{capacity},seed:42};writeFileSync(join(modelDir,'input.json'),JSON.stringify(input));execFileSync('python3',[join(modelDir,'run.py'),'--input',join(modelDir,'input.json'),'--output',join(modelDir,'result.json')]);const raw=JSON.parse(readFileSync(join(modelDir,'result.json'),'utf8')),output=readFileSync(join(modelDir,'series.csv'));
  const record={experimentId:runId,runId,scope,actor:{userId:'user',authVersion:1},key:'PRIVATE_IDEMPOTENCY_SECRET',requestJson:'PRIVATE_REQUEST_CONTROL',input:{runId,plan,parameters:input.parameters,seed:42,deadlineAt:999999999,runtimeImage:'python-reference:local'},status:'completed',createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null,attempt:0,quotaClaimed:false,releaseProof:null,lease:null,startClaimed:true,stop:null,result:null,releaseBegunAt:null,quietSince:null,released:true} as SimulationRecord;
  record.result=await publishSimulationResult(bucket,record,{exitCode:0,pythonVersion:execFileSync('python3',['-c','import sys;print(sys.version.split()[0])'],{encoding:'utf8'}).trim(),result:{...raw,outputs:[{path:'series.csv',size:output.length,sha256:await digest(output),mediaType:'text/csv',data:Buffer.from(output).toString('base64')}]}});runs.push(record);
 }
 const snapshot:ResearchSnapshot={schemaVersion:1,exportId:'export-1',createdAt:1,scope,current:source,runs,groups:[],claims:[],assessments:[]};let authorizations=0;
 const ports={source:async(_source:unknown,max:number)=>{assert.ok(max<=16*1024*1024);return archive;},artifact:async(key:string,max:number)=>{const bytes=objects.get(key);assert.ok(!bytes||bytes.length<=max);return bytes??null;},authorize:async()=>{authorizations++;}};
 return {dir,archive,plan,snapshot,objects,bucket,ports,get authorizations(){return authorizations;}};
}
test('full project ZIP preserves source/result bytes and independently replays a real seeded Python model in a clean venv',async t=>{
 const f=await fixture(t),result=await buildResearchExport(f.snapshot,f.ports);assert.equal(result.manifest.runs.length,2);assert.equal(result.manifest.sources.length,1);assert.equal(f.authorizations,2);assert.equal(result.sha256,await digest(result.bytes));
 const zip=join(f.dir,'project.zip');writeFileSync(zip,result.bytes);const out=join(f.dir,'unpacked');execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])',zip,out]);
 assert.deepEqual(readFileSync(join(out,result.manifest.sources[0]!.archivePath)),Buffer.from(f.archive));assert.equal(await digest(readFileSync(join(out,result.manifest.sources[0]!.specPath))),f.plan.specSha256);
 const text=Buffer.from(result.bytes).toString('utf8');for(const secret of ['PRIVATE_IDEMPOTENCY_SECRET','PRIVATE_REQUEST_CONTROL','private-session-id','private-dispatch','private-revision-manifest','authVersion'])assert.equal(text.includes(secret),false,secret);
 const venv=join(f.dir,'venv');execFileSync('python3',['-m','venv',venv]);const python=join(venv,'bin','python');const verified=JSON.parse(execFileSync(python,[join(out,'replay.py'),'--verify-only'],{encoding:'utf8'}));assert.equal(verified.verified,true);
 const report=JSON.parse(execFileSync(python,[join(out,'replay.py'),'--run','run-1'],{encoding:'utf8'}));assert.equal(report.matches,true);assert.equal(report.metrics.score.actual,f.snapshot.runs[1]!.result!.metrics.score);assert.equal(report.outputs['series.csv'],true);
 writeFileSync(join(out,'results/run-1/result.json'),'{}');assert.throws(()=>execFileSync(python,[join(out,'replay.py'),'--verify-only'],{stdio:'pipe'}),/Command failed/);
});
test('result/source corruption, scope mismatch, missing artifacts, and revoked export access fail closed',async t=>{
 const f=await fixture(t);await assert.rejects(buildResearchExport({...f.snapshot,scope:{...scope,workspaceId:'other'}},f.ports),/export-source-mismatch/);
 await assert.rejects(buildResearchExport(f.snapshot,{...f.ports,source:async()=>encode('corrupt')}),/export-source-mismatch/);
 await assert.rejects(buildResearchExport(f.snapshot,{...f.ports,artifact:async()=>null}),/export-result-missing/);
 await assert.rejects(buildResearchExport(f.snapshot,{...f.ports,artifact:async()=>encode('{}')}),/export-source-mismatch/);
 let calls=0;await assert.rejects(buildResearchExport(f.snapshot,{...f.ports,authorize:async()=>{if(++calls===2)throw Error('access-revoked');}}),/access-revoked/);
});
test('ZIP refuses duplicate/traversal/oversize entries and uses standard CRC32',()=>{
 assert.equal(crc32(encode('123456789')),0xcbf43926);const files=new ExportFiles(200);files.add('one.txt',encode('one'));assert.throws(()=>files.add('one.txt',encode('two')),/entry-invalid/);assert.throws(()=>files.add('../escape',encode('x')),/path-invalid/);assert.throws(()=>files.add('big',new Uint8Array(200)),/too-large/);
});
test('snapshot reads paginated bounded inventory once, excludes unselected future rows, and never silently truncates',async t=>{
 const f=await fixture(t),rows=new Map<string,unknown>();for(let i=0;i<51;i++)rows.set('simulation:run:'+String(i).padStart(3,'0'),{...f.snapshot.runs[0],runId:'run-'+i});let pages=0,checks=0;
 const storage={transaction:async(fn:Function)=>fn({list:async({prefix,limit,startAfter}:{prefix:string;limit:number;startAfter?:string})=>{pages++;return new Map([...rows].filter(([key])=>key.startsWith(prefix)&&(!startAfter||key>startAfter)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)]));}})} as unknown as DurableObjectStorage;
 const snapshot=await researchSnapshot(storage,scope,f.snapshot.current,()=>{checks++;});assert.equal(snapshot.runs.length,51);assert.equal(checks,2);assert.ok(pages>=5);rows.clear();assert.equal(snapshot.runs.length,51);
 for(let i=0;i<1001;i++)rows.set('simulation:run:'+String(i).padStart(4,'0'),{id:i});await assert.rejects(researchSnapshot(storage,scope,f.snapshot.current,()=>{}),/export-too-large/);
});

test('malformed current dependency lock never becomes install instructions',async t=>{
 const f=await fixture(t);for(const lock of [{schemaVersion:999,packages:{}},{schemaVersion:1,packages:{'--index-url\nhttps://bad.test':42}},{schemaVersion:1,packages:{simpy:9}}]){
  const archive=initialWorkspaceArchive({'model/run.py':encode(code),'model/model-spec.json':encode(JSON.stringify(f.plan.spec)),'app/requirements.lock':encode(JSON.stringify(lock))});const current={...f.snapshot.current};if(current.kind!=='saved-turn')throw Error('fixture');current.revision={...current.revision,filesSha256:await digest(archive)};
  await assert.rejects(buildResearchExport({...f.snapshot,current,runs:[]},{...f.ports,source:async()=>archive}),/export-dependencies-invalid/);
 }
});

test('project export retains historical model, partial group, failed and cancelled children, and sanitized claim assessments',async t=>{
 const f=await fixture(t),snapshot=structuredClone(f.snapshot),groupId='group-history';
 for(const run of snapshot.runs){run.experimentId=groupId;run.groupId=groupId;const prefix=`simulation-results-v1/tenant/project/workspace/${run.runId}`,old=f.objects.get(`${prefix}/${run.result!.artifactSha256}.json`)!;const envelope=JSON.parse(new TextDecoder().decode(old));envelope.experimentId=groupId;const bytes=encode(JSON.stringify(envelope));run.result!.artifactSha256=await digest(bytes);f.objects.set(`${prefix}/${run.result!.artifactSha256}.json`,bytes);}
 const failed={...structuredClone(snapshot.runs[0]!),runId:'run-failed',input:{...snapshot.runs[0]!.input,runId:'run-failed',seed:43},status:'failed' as const,errorCode:'simulation-result-invalid',result:null};snapshot.runs.push(failed);
 snapshot.groups=[{schemaVersion:1,groupId,scope,actor:{userId:'user',authVersion:9},key:'PRIVATE_GROUP_KEY',requestJson:'PRIVATE_GROUP_REQUEST',plan:f.plan,runtimeImage:'python-reference:local',hypothesis:'Historical comparison',configurations:[{configurationId:'baseline',role:'baseline',label:'Baseline',parameters:{capacity:2}},{configurationId:'intervention-1',role:'intervention',label:'Intervention',parameters:{capacity:3}}],seeds:[42,43],children:[{runId:'run-0',configurationId:'baseline',seed:42,cancelled:false},{runId:'run-1',configurationId:'intervention-1',seed:42,cancelled:false},{runId:'run-failed',configurationId:'baseline',seed:43,cancelled:false},{runId:'cancelled-before-admission',configurationId:'intervention-1',seed:43,cancelled:true}],status:'partial',createdAt:1,updatedAt:2,cancelledAt:null,errorCode:null}];
 snapshot.claims=[{schemaVersion:1,claimId:'claim-a',kind:'run',metric:'score',value:snapshot.runs[0]!.result!.metrics.score,version:modelVersion(f.plan),experimentId:groupId,references:[{runId:'run-0',experimentId:groupId,version:modelVersion(f.plan),artifactSha256:snapshot.runs[0]!.result!.artifactSha256,metric:'score',value:snapshot.runs[0]!.result!.metrics.score,parameters:{capacity:2},seed:42}],createdBy:{userId:'user',authVersion:9}}];snapshot.assessments=[{assessmentId:'assessment-a',scope:'run',runId:'run-0',version:modelVersion(f.plan),reason:'Known invalid assumption',createdBy:{userId:'user',authVersion:9},createdAt:3}];
 const archive=initialWorkspaceArchive({'model/run.py':encode(code+'\n# newer saved revision\n'),'model/model-spec.json':encode(JSON.stringify({...f.plan.spec,researchQuestion:'Updated question'})),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}')});if(snapshot.current.kind!=='saved-turn')throw Error('fixture');snapshot.current={...snapshot.current,revision:{...snapshot.current.revision,revisionId:'revision-2',filesSha256:await digest(archive)}};
 const result=await buildResearchExport(snapshot,{...f.ports,source:async source=>source.kind==='saved-turn'&&source.revision.revisionId==='revision-2'?archive:f.archive});assert.equal(result.manifest.sources.length,2);assert.equal(result.manifest.runs.length,3);assert.equal(result.manifest.groups.length,1);assert.equal(result.manifest.runs.find(r=>r.runId==='run-failed')!.resultPath,null);
 const zip=join(f.dir,'history.zip');writeFileSync(zip,result.bytes);const dump=JSON.parse(execFileSync('python3',['-c',"import json,zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({p:json.loads(z.read(p)) for p in ['experiments/group-history.json','evidence/claims.json','evidence/assessments.json']}))",zip],{encoding:'utf8'}));assert.equal(dump['experiments/group-history.json'].runs[3].cancelled,true);assert.equal(dump['experiments/group-history.json'].status,'partial');assert.deepEqual(dump['evidence/claims.json'][0].createdBy,{userId:'user'});assert.equal(dump['evidence/assessments.json'][0].reason,'Known invalid assumption');const text=Buffer.from(result.bytes).toString('utf8');assert.equal(text.includes('PRIVATE_GROUP_KEY'),false);assert.equal(text.includes('authVersion'),false);
});

test('sensitive filenames reject the complete original source instead of silently changing its archive hash',async t=>{
 const f=await fixture(t),archive=initialWorkspaceArchive({'model/run.py':encode(code),'model/model-spec.json':encode(JSON.stringify(f.plan.spec)),'app/requirements.lock':encode('{"schemaVersion":1,"packages":{}}'),'app/.env':encode('PROVIDER_API_KEY=secret')});const current=structuredClone(f.snapshot.current);if(current.kind!=='saved-turn')throw Error('fixture');current.revision.filesSha256=await digest(archive);await assert.rejects(buildResearchExport({...f.snapshot,current,runs:[]},{...f.ports,source:async()=>archive}),/export-sensitive-file/);
});


test('bounded saved-source read rejects declared size before buffering archive bytes',async t=>{
 const f=await fixture(t);const receipt=await new R2TurnRevisionPort(f.bucket,{freeze:async()=>({identity,filesArchive:f.archive,piSession:encode('private session')})}).commit({identity,base:{workspace:null,session:null},outcome:'completed',executionErrorCode:null});
 let fileReads=0;const bucket={...f.bucket,get:async(key:string)=>{if(key.includes('/files/'))fileReads++;return f.bucket.get(key);}} as R2Bucket;
 await assert.rejects(new R2TurnRevisionReader(bucket).files(identity,receipt,1024),/turn-revision-object-too-large/);assert.equal(fileReads,0);
 assert.deepEqual(await new R2TurnRevisionReader(bucket).files(identity,receipt,f.archive.length),f.archive);assert.equal(fileReads,1);
});

test('authorization runs after the final ZIP digest and can prevent disclosure after revocation',async t=>{
 const f=await fixture(t),original=crypto.subtle.digest;let zipHashed=false,checks=0;
 crypto.subtle.digest=async function(algorithm,data){const view=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);const result=await original.call(crypto.subtle,algorithm,data);if(view[0]===80&&view[1]===75)zipHashed=true;return result;};
 try{await assert.rejects(buildResearchExport(f.snapshot,{...f.ports,authorize:async()=>{checks++;if(checks===2){assert.equal(zipHashed,true);throw Error('revoked-after-zip-hash');}}}),/revoked-after-zip-hash/);assert.equal(checks,2);}finally{crypto.subtle.digest=original;}
});
