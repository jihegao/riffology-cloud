import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {containerArgs,runPrototype} from '../../scripts/m3/project-view-offline-prototype.mjs';

test('offline launcher rejects tags, remote images and caller-controlled container names',()=>{
 for(const image of [undefined,'latest','node:22','registry.example/image','sha256:abc'])assert.throws(()=>containerArgs(image,'riffoid-view-a',''),/image-digest/);
 assert.throws(()=>containerArgs('sha256:'+'a'.repeat(64),'existing-production-container',''),/container-name/);
 const args=containerArgs('sha256:'+'a'.repeat(64),'riffoid-view-a','trusted program');
 for(const required of ['unix:///var/run/docker.sock','--pull=never','--network=none','--read-only','10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges'])assert(args.includes(required));
 assert(!args.some(arg=>['--privileged','--network=host','--volume','--mount','-v','-p','--publish','--env-file'].includes(arg)));
});
test('missing explicit image records blocked, never a successful isolation result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'offline-view-preflight-'));
 try{const result=await runPrototype({output:dir});assert.equal(result.status,'blocked');assert.equal(result.reason,'explicit-local-image-digest-required');assert.equal(result.productionEligible,false);assert.equal(result.cleanupConfirmed,true);assert.deepEqual(JSON.parse(await readFile(join(dir,'evidence.json'),'utf8')),result);}finally{await rm(dir,{recursive:true,force:true});}
});
