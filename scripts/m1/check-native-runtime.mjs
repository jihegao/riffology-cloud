import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { initializationProgram, INSPECT_INITIAL_FILES, initialCheckpoint, initialFiles } from '../../services/runtime/starter.ts';
import { sourceSnapshot } from '../m0/source-inventory.mjs';

// Local-only evidence. CLI arguments never contain credentials. No pulls,
// image publishing, cloud calls, provider calls, host mounts or network access.
const context='colima-riffology-m0',image='riffology-m0-project:20260905T155750Z-167375ff';
const runId=`m1-native-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
const directory=resolve('docs/evidence/runs',runId);mkdirSync(directory,{recursive:false});
const created=[];let failed=null;
const result={runId,scope:'local Docker execution; not Cloudflare Containers acceptance',status:'running',image,containers:[],checks:[],cleanup:[],sourceSnapshot:sourceSnapshot(process.cwd())};
const docker=(...args)=>execFileSync('docker',['--context',context,...args],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}).trim();
function input(suffix){return {task:{id:`task-${suffix}`,tenantId:`tenant-${suffix}`,projectId:`project-${suffix}`,workspaceId:`workspace-${suffix}`,generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:Date.now(),deadlineAt:Date.now()+180000},identity:{taskId:`task-${suffix}`,tenantId:`tenant-${suffix}`,projectId:`project-${suffix}`,workspaceId:`workspace-${suffix}`,generation:1,runtimeId:`runtime-${suffix}`,leaseId:`lease-${suffix}`},markerNonce:crypto.randomUUID()};}
async function inspected(name){let last;for(let i=0;i<20;i++){try{return JSON.parse(docker('exec',name,'node','-e',INSPECT_INITIAL_FILES));}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,100));}}throw last;}
try{
 result.dockerVersion=docker('info','--format','{{.ServerVersion}}');result.imageId=docker('image','inspect',image,'--format','{{.Id}}');
 for(const suffix of ['a','b']){
  const data=input(suffix),name=`${runId}-${suffix}`;created.push(name);
  docker('run','--pull=never','-d','--name',name,'--network=none','--memory=256m','--cpus=1','--pids-limit=64','--entrypoint=node',image,'-e',initializationProgram(data));
  const info=JSON.parse(docker('inspect',name))[0];assert.equal(info.HostConfig.NetworkMode,'none');assert.deepEqual(info.Mounts,[]);
  const files=await inspected(name);assert.deepEqual(files,initialFiles(data));
  const checkpoint=await initialCheckpoint(data);writeFileSync(resolve(directory,`checkpoint-${suffix}.json`),checkpoint.text,{flag:'wx'});
  result.containers.push({name,id:info.Id,network:info.HostConfig.NetworkMode,mountCount:info.Mounts.length,checkpointRevision:checkpoint.revision});
 }
 result.checks.push('two real isolated containers created fixed directories and exact nonce-bound files');
 docker('exec',created[0],'node','-e',"require('node:fs').writeFileSync('/workspace/model/private-a.txt','tenant-a-only')");
 assert.equal(docker('exec',created[1],'node','-e',"process.stdout.write(String(require('node:fs').existsSync('/workspace/model/private-a.txt')))"),'false');
 result.checks.push('A filesystem mutation is absent from B');
 const secondBefore=await inspected(created[1]);docker('stop','--time=1',created[0]);
 assert.equal(docker('inspect',created[0],'--format','{{.State.Running}}'),'false');assert.deepEqual(await inspected(created[1]),secondBefore);
 result.checks.push('confirmed native stop of A does not affect B');result.status='passed';
}catch(error){failed=error;result.status='failed';result.error=String(error.message).slice(0,2000);}
finally{
 for(const name of created){try{docker('rm','-f',name);result.cleanup.push({name,removed:true});}catch(error){result.cleanup.push({name,removed:false,error:String(error.message).slice(0,300)});result.status='failed';failed??=error;}}
 writeFileSync(resolve(directory,'native-checks.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({directory,status:result.status,checks:result.checks,cleanup:result.cleanup},null,2));
}
if(failed)process.exitCode=1;
