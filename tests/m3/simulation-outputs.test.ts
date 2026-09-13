import test from 'node:test';
import assert from 'node:assert/strict';
import {publishOutputs} from '../../services/simulation/outputs.ts';
import {digest} from '../../services/simulation/source.ts';
test('candidate outputs are checked before publication and read back before success',async()=>{
 const objects=new Map<string,Uint8Array>();let corrupt=false;
 const bucket={put:async(k:string,v:Uint8Array)=>{objects.set(k,Uint8Array.from(v));},get:async(k:string)=>{const bytes=objects.get(k);return bytes?{size:bytes.length,arrayBuffer:async()=>corrupt?new Uint8Array([0]).buffer:bytes.buffer}:null;}} as unknown as R2Bucket;
 const bytes=new TextEncoder().encode('x,y\n1,2\n'),value={path:'series.csv',size:bytes.length,sha256:await digest(bytes),mediaType:'text/csv',data:btoa('x,y\n1,2\n')};
 for(const bad of [{...value,path:'../secret.txt'},{...value,sha256:'0'.repeat(64)},{...value,mediaType:'text/html'},{...value,size:99}])await assert.rejects(publishOutputs(bucket,'run',[bad]),/simulation-result-invalid/);
 assert.equal(objects.size,0);const result=await publishOutputs(bucket,'run',[value]);assert.equal(result[0]!.sha256,value.sha256);assert.equal(objects.size,1);
 corrupt=true;await assert.rejects(publishOutputs(bucket,'run',[value]),/simulation-result-unconfirmed/);
});
