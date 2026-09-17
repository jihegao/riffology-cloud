// Actual downloaded candidates, local RevisionStore/R2 and isolated native
// execution. This is component acceptance, never production E2E evidence.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader,workspaceFileIndex} from '../../services/turn-runtime/workspace-file-index.ts';
import {simulationPlan} from '../../services/simulation/source.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {validateSavedPreview} from '../../services/browser-preview/validator.ts';
import {packageCompatiblePreview} from '../../services/browser-preview/packager.ts';
import {DOCKER_FENCE_PROBE} from '../../tests/m3/simulation-docker-fence.ts';
const directory=resolve('.local/issue77-internal-v1'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=(name,value)=>writeFileSync(resolve(directory,name),typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();
const image='riffology-g4-20260915-simulation:1f9b5bbf70f7',imageIdentity=JSON.parse(docker(['image','inspect',image]))[0].Id;
const db=new DatabaseSync(resolve(directory,'ledger.sqlite'),{readOnly:true}),bindings=db.prepare('SELECT value FROM execution_bindings').all().map(row=>JSON.parse(row.value));db.close();
const records=[2,3].map(n=>({ordinal:n,binding:bindings.find(b=>b.identity.turnId===`issue77-turn-${n}`),archive:new Uint8Array(readFileSync(resolve(directory,`turn-${n}-workspace.tar`)))}));
const entry=`import {RevisionStore} from './services/turn-runtime/revision-store.ts';import {revisionStoreActorName} from './services/turn-runtime/revision-store-client.ts';export {RevisionStore};export default {async fetch(request,env){const body=await request.json(),store=env.REVISION_STORE.getByName(revisionStoreActorName(body.identity.scope));if(body.action==='observe')return Response.json(await store.observe(body.identity));if(body.action==='restore'){const value=await store.restore(body.identity,body.receipt);return Response.json({backendState:value.backendState,piSession:value.piSession,filesSha256:await crypto.subtle.digest('SHA-256',value.filesArchive).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join(''))});}const filesArchive=Uint8Array.from(atob(body.archive),c=>c.charCodeAt(0));return Response.json(await store.commit({identity:body.identity,outcome:'completed',executionErrorCode:null,base:body.base,snapshot:{identity:body.identity,filesArchive,backendState:body.backendState}}));}};`;
const bundled=await build({stdin:{contents:entry,sourcefile:'issue77-actual-candidates.ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2024',external:['cloudflare:workers'],logLevel:'silent'});
const worker='issue77-local-revisions',mf=new Miniflare({host:'127.0.0.1',port:0,inspectorPort:0,cf:{},telemetry:{enabled:false},logRequests:false,workers:[{config:{type:'worker',name:worker,compatibilityDate:'2026-09-06',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundled.outputFiles[0].text}}},env:{REVISION_STORE:{type:'durable-object',worker,exportName:'RevisionStore'},WORKSPACE_CHECKPOINTS:{type:'r2',name:'issue77-candidates'},MODEL_CONTENT:{type:'r2',name:'issue77-models'}},exports:{RevisionStore:{type:'durable-object',storage:'sqlite'}}},dev:{unsafeRegisterWorker:false,outboundService:{type:'fetcher',handler:()=>new Response('outbound-disabled',{status:403})}}}]});
const call=async body=>{const response=await mf.dispatchFetch('http://local.invalid/',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
const report={schemaVersion:1,environment:'local-workerd-r2-and-network-denied-docker',productionE2E:false,image,imageIdentity,revisions:[],nativeRuns:[],containersRemoved:[]};
let previous=null;
try{
 for(const record of records){
  assert.ok(record.binding);const {identity}=record.binding;
  const reader=workspaceArchiveReader(record.archive),files=Object.fromEntries(workspaceFileIndex(record.archive).files.filter(e=>e.type==='file').map(e=>[e.path,reader.read([{path:e.path,maxBytes:Math.max(1,e.size)}]).get(e.path)]));
  // Explicit platform presentation metadata; retain the original archive and
  // publish different bytes under a distinct converted-artifact hash.
  files['model/visualization.json']=new TextEncoder().encode(JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'lane',metricKeys:['completed','mean_wait']}));
  const archive=initialWorkspaceArchive(files),filesSha256=hash(archive),backendState={schemaVersion:1,backend:'managed-agents',recovery:'files-only'};
  save(`turn-${record.ordinal}-converted-workspace.tar`,archive);
  const request={identity,archive:Buffer.from(archive).toString('base64'),backendState,base:{workspace:previous,session:previous}};
  const committed=await call(request);assert.equal(committed.status,'committed');assert.deepEqual(await call(request),committed);
  const receipt=committed.receipt,restored=await call({action:'restore',identity,receipt});assert.equal(restored.filesSha256,filesSha256);assert.equal(restored.piSession,null);assert.deepEqual(restored.backendState,backendState);
  const source={kind:'saved-turn',identity,revision:receipt},plan=await simulationPlan(source,archive);
  const compatible=await validateSavedPreview({projectId:identity.scope.projectId,revisionId:receipt.revisionId,filesSha256},archive,'python-stdlib/v1',await productionPreviewRegistry());assert.equal(compatible.status,'compatible');
  const preview=await packageCompatiblePreview(compatible.value);save(`turn-${record.ordinal}-preview-package.json`,preview.bytes);
  report.revisions.push({ordinal:record.ordinal,revisionId:receipt.revisionId,originalArchiveSha256:hash(record.archive),filesSha256,backendState,restoredExact:true,commitReplayExact:true,previewPackageSha256:preview.sha256});
  for(const seed of [1,2,3])for(const service_time of [2,3]){
  const container=docker(['run','-d','--platform','linux/amd64','--network','none','--memory','512m','--cpus','1','--pids-limit','128','--security-opt','no-new-privileges','--security-opt',`seccomp=${resolve('tests/m3/fixtures/docker-deny-network.json')}`,'-e','RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1','--entrypoint','/bin/sh',imageIdentity,'-c','sleep 300']);
  try{
   const fence=JSON.parse(docker(['exec',container,'python3','-c',DOCKER_FENCE_PROBE]));assert.equal(fence.noNewPrivileges,true);save(`turn-${record.ordinal}-network-fence.json`,fence);
    const token=hash(`${filesSha256}:${seed}:${service_time}`).slice(0,52),runId=`issue77-native-${record.ordinal}-${seed}-${service_time}`,parameters={customers:5,service_time};
    const control={schemaVersion:1,token,runId,filesSha256,specSha256:plan.specSha256,entrypoint:plan.spec.execution.entrypoint,entrypointSha256:plan.entrypointSha256,dependencyLock:plan.spec.execution.dependencyLock,dependencyLockSha256:plan.dependencyLockSha256,parameters,seed,deadlineAt:Date.now()+30000};
    save('native-control.json',control);docker(['cp',resolve(directory,`turn-${record.ordinal}-converted-workspace.tar`),`${container}:/var/lib/riffology/archives/${token}.input.tar`]);docker(['cp',resolve(directory,'native-control.json'),`${container}:/var/lib/riffology/services/${token}.input.json`]);
    let observed=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','start',token]));
    for(let i=0;i<60&&observed.status!=='stopped';i++){await new Promise(r=>setTimeout(r,200));observed=JSON.parse(docker(['exec',container,'python3','/opt/riffology/simulation_process.py','observe',token]));}
    save(`${runId}.json`,observed);assert.equal(observed.status,'stopped');assert.equal(observed.stop.fenced,true);assert.equal(observed.result.exitCode,0);
    const result=observed.result.result;assert.deepEqual(result.metrics,{completed:5,mean_wait:(service_time-2)*2});
    const trace=JSON.parse(Buffer.from(result.outputs.find(o=>o.path==='trace.json').data,'base64'));
    assert.equal(trace.snapshots.length,6);assert.deepEqual(trace.snapshots[0].metrics,{completed:0,mean_wait:0});
    for(let j=1;j<=5;j++){assert.equal(trace.snapshots[j].frame,j);assert.equal(trace.snapshots[j].time,seed%3+service_time*j);assert.deepEqual(trace.snapshots[j].metrics,{completed:j,mean_wait:(service_time-2)*(j-1)/2});}
    for(const output of result.outputs)assert.equal(hash(Buffer.from(output.data,'base64')),output.sha256);
    report.nativeRuns.push({runId,revisionId:receipt.revisionId,filesSha256,dependencyLockSha256:plan.dependencyLockSha256,seed,parameters,metrics:result.metrics,nativeFenced:true,oraclePassed:true,receiptSha256:hash(JSON.stringify(observed))});
  }finally{docker(['rm','-f',container]);report.containersRemoved.push(container);}
  }
  previous=receipt;
 }
 assert.equal(report.nativeRuns.length,12);assert.notEqual(report.revisions[0].revisionId,report.revisions[1].revisionId);
 for(const record of records)assert.equal((await call({action:'observe',identity:record.binding.identity})).revisionId,report.revisions.find(r=>r.ordinal===record.ordinal).revisionId);
 report.historyStillReadable=true;
}catch(error){report.failure=error.message;throw error;}
finally{save('local-component-acceptance.json',report);await mf.dispose();}
console.log(JSON.stringify({revisions:report.revisions.length,nativeRuns:report.nativeRuns.length,historyStillReadable:report.historyStillReadable,containersRemoved:report.containersRemoved.length,productionE2E:false}));
