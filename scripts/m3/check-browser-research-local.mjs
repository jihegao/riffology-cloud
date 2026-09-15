// Actual local product actors, Gateway auth, checkpoint journal and private R2.
// --package-only is an explicit partial diagnostic, never full G3 acceptance.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {execFileSync} from 'node:child_process';
import {localResearchEnvironment} from './g3-local-environment.mjs';
import {migrateLocalCatalog,authenticatedTenants} from './g3-local-auth.mjs';
import {makeFixture} from '../../services/browser-preview/runtime/fixtures.mjs';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {digest} from '../../services/simulation/source.ts';
import {unpackPreviewPackage} from '../../services/browser-preview/packager.ts';
const partial=process.argv.includes('--package-only');if(process.argv.slice(2).some(x=>x!=='--package-only'))throw Error('invalid-argument');
const directory=resolve(process.env.G3_EVIDENCE_DIR||`.local/g3-research-${Date.now()}`);await mkdir(directory,{recursive:false});
const freePort=async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
const appPort=await freePort(),executionPort=await freePort(),appOrigin=`http://127.0.0.1:${appPort}`,executionOrigin=`http://localhost:${executionPort}`,worker=`g3-research-${crypto.randomUUID().slice(0,8)}`,secret=crypto.randomUUID()+crypto.randomUUID(),producerKey=crypto.randomUUID()+crypto.randomUUID();
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const imageFacts=JSON.parse(await readFile('.local/g3-native-helper/image.json','utf8')),nativeImage=`riffology-g3-acceptance-native:${imageFacts.testImageIdentity.slice(7,19)}`;docker('tag',imageFacts.testImageIdentity,nativeImage);
const projectImage=process.env.G3_PROJECT_IMAGE||'riffology-m2-runtime:d7de4aaf2da2',projectImageIdentity=JSON.parse(docker('image','inspect',projectImage))[0].Id;
const environment=await localResearchEnvironment({directory,appOrigin,executionOrigin,appPort,executionPort,nativeImage,projectImage,secret,producerKey,assetsDirectory:resolve('.local/g3-app-assets'),executionAssetsDirectory:resolve('.local/browser-preview/execution-assets'),worker});
let mf,execution;const evidence={schemaVersion:1,status:'running',fullGate:false,scope:partial?'actual Gateway/checkpoint/R2/alarm/package partial diagnostic':'actual local research-loop gate',appOrigin,executionOrigin,worker,imageFacts,projectImage,projectImageIdentity,models:[],failure:null};
const flush=()=>writeFile(resolve(directory,'result.json'),JSON.stringify(evidence,null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const request=async(path,identity,options={})=>mf.dispatchFetch(appOrigin+path,{...options,headers:{...identity?.headers,...options.headers}});
const json=async(response,status=200)=>{const text=await response.text();assert.equal(response.status,status,text);return JSON.parse(text);};
const until=async(read,predicate,timeout=60000)=>{let value;const end=Date.now()+timeout;do{value=await read();if(predicate(value))return value;await wait(200);}while(Date.now()<end);throw Error('g3-condition-deadline:'+JSON.stringify(value));};
try{
 mf=environment.startApp();await mf.ready;await migrateLocalCatalog(await mf.getD1Database('CATALOG',worker));const identities=await authenticatedTenants(mf,worker,{origin:appOrigin,secret}),owner=identities.owner,outsider=identities.outsider;
 const registry=await productionPreviewRegistry();
 for(const name of ['queue','mesa']){
  const project=(await json(await request(`/api/tenants/${owner.tenantId}/projects`,owner,{method:'POST',headers:{'idempotency-key':'g3-project-'+name},body:JSON.stringify({title:`G3 ${name} · deterministic finite fixture · 长标题用于验证窄屏布局与版本身份`,starterVersion:'blank-v1'})}),202)).project;
  const ready=await until(()=>request(`/api/tenants/${owner.tenantId}/projects/${project.id}`,owner).then(r=>json(r)),r=>r.status==='ready');
  const scope={tenantId:owner.tenantId,projectId:project.id,workspaceId:project.workspace_id,workspaceGeneration:ready.generation},actor={userId:owner.me.userId,authVersion:1},profileId=name==='mesa'?'mesa-3.5.1/v1':'python-stdlib/v1';
  const fixture=await makeFixture(registry.resolve(profileId),name),files=Object.fromEntries(fixture.files.map(f=>[f.path,Buffer.from(f.base64,'base64')])),archive=initialWorkspaceArchive(files);
  const saved=await json(await request('/__g3/save',null,{method:'POST',headers:{'x-g3-producer-key':producerKey},body:JSON.stringify({scope,actor,key:'g3-source-'+name,archiveBase64:Buffer.from(archive).toString('base64')})}));
  assert.equal(saved.receipt.filesSha256,await digest(archive));assert.equal(saved.diagnostics.runCount,0);assert.equal(saved.diagnostics.savedTurns.length,1);assert.ok(saved.diagnostics.physicalAlarm);
  const model={name,scope,saved,sourceSha256:await digest(files['model/model.py']),initialFilesSha256:await digest(archive)};evidence.models.push(model);await flush();
  // Restart actual Workerd while no browser exists; no explicit wake RPC.
  await mf.dispose();mf=environment.startApp();await mf.ready;
  const base=`/api/workspaces/${scope.workspaceId}/browser-preview`,view=await until(()=>request(base+`?revisionId=${saved.receipt.revisionId}&profileId=${encodeURIComponent(profileId)}`,owner).then(r=>json(r)),r=>r.build?.status==='ready');
  const bytes=await request(base+'/packages/'+view.build.packageIdentity,owner);assert.equal(bytes.status,200);assert.equal(bytes.headers.get('cache-control'),'no-store');const packageBytes=new Uint8Array(await bytes.arrayBuffer()),unpacked=await unpackPreviewPackage(packageBytes);
  assert.equal(unpacked.manifest.filesSha256,saved.receipt.filesSha256);assert.equal(unpacked.manifest.revisionId,saved.receipt.revisionId);assert.deepEqual(unpacked.files.get('model/model.py'),new Uint8Array(files['model/model.py']));assert.equal(unpacked.files.size,5);
  assert.equal((await request(base+'/packages/'+view.build.packageIdentity,outsider)).status,404);assert.equal((await request(base+'/packages/'+view.build.packageIdentity,null)).status,401);
  Object.assign(model,{view,packageSha256:await digest(packageBytes),manifest:unpacked.manifest});await writeFile(resolve(directory,name+'-private-package.json'),packageBytes);await flush();
  if(!partial)throw Error('g3-browser-and-native-tail-not-yet-implemented');
 }
 evidence.status='partial-passed';await flush();console.log(JSON.stringify({directory,status:evidence.status,fullGate:false}));
}catch(error){evidence.status='failed';evidence.failure=error instanceof Error?error.stack:String(error);await flush();throw error;}
finally{await execution?.dispose();await mf?.dispose();const ids=docker('ps','-aq','--filter',`name=workerd-${worker}-`).split('\n').filter(Boolean);if(ids.length)docker('rm','-f',...ids);}
