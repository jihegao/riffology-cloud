import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXED_PROGRAM,FIXED_COMMAND,MODULES,workerSource,validateContent} from './g4-release-content-probe.mjs';
test('content probe freezes six paths and provider-free policy inspection; HTTP cannot select actor or command',()=>{
 assert.equal(MODULES.length,6);assert.match(FIXED_PROGRAM,/BROWSER_PREVIEW_GENERATION_CONTRACT/);assert.match(FIXED_COMMAND,/^node --input-type=module -e /);
 for(const token of ['resolveOptions(', 'providerFetch(', 'fetch(', 'createProductTrustedPiRelease('])assert.equal(FIXED_PROGRAM.includes(token),false,token);
 const source=workerSource('m2-t-'+ 'a'.repeat(52));assert.match(source,/Object.keys\(input\).length!==1/);assert.equal(source.includes('input.actor'),false);assert.equal(source.includes('input.command'),false);assert.equal(source.includes('startLifecycleProbe'),false);assert.equal(source.includes('/bin/sleep'),false);
 assert.throws(()=>workerSource('client-selected'),/actor-invalid/);
});
test('signed-off content requires exact modules, root protection, adapter and generation contract',()=>{
 const adapter='fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898';
 const modules=MODULES.map(name=>({name,sha256:'a'.repeat(64),byteLength:20,uid:0,gid:0,mode:0o444})),generationContract={schema:'frozen'},value={schemaVersion:1,modules,generationContract,adapterSha256:adapter,adapterActualSha256:adapter},expected={modules,generationContract};
 assert.equal(validateContent(value,expected),value);
 for(const change of [{...value,adapterActualSha256:'b'.repeat(64)},{...value,generationContract:{schema:'other'}},{...value,modules:modules.map((x,i)=>i===1?{...x,sha256:'b'.repeat(64)}:x)},{...value,modules:modules.map((x,i)=>i===4?{...x,mode:0o666}:x)}])assert.throws(()=>validateContent(change,expected));
});
