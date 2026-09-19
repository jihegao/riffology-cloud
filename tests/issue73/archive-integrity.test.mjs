import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('archived experiment evidence retains all frozen checksums without rescoring',async()=>{
  const root=new URL('../../docs/evidence/issue-73-luna-agents/',import.meta.url);
  let files=0,manifests=0;
  for(const entry of await readdir(root,{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const directory=new URL(`${entry.name}/`,root);
    const manifest=await readFile(new URL('SHA256SUMS',directory),'utf8');manifests++;
    for(const line of manifest.trim().split('\n')){
      const match=/^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
      assert.ok(match,`invalid checksum entry in ${entry.name}`);
      const bytes=await readFile(new URL(match[2],directory));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),match[1],`${entry.name}/${match[2]}`);files++;
    }
  }
  assert.equal(manifests,4);assert.equal(files,17);
});
