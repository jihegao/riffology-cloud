import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {workspaceFileDiff,workspaceFileIndex} from '../../services/turn-runtime/workspace-file-index.ts';

const helper=new URL('../../services/project-tools/workspace_archive.py',import.meta.url).pathname,token='a'.repeat(52);
function archive(t,changed=false){const root=mkdtempSync(join(tmpdir(),'riffology-file-index-')),workspace=join(root,'workspace'),archives=join(root,'archives');mkdirSync(join(workspace,'model'),{recursive:true,mode:changed?0o700:0o755});mkdirSync(archives,{mode:0o700});writeFileSync(join(workspace,'README.md'),changed?'changed contents\n':'private contents\n',{mode:0o644});if(changed){mkdirSync(join(workspace,'results'),{mode:0o755});writeFileSync(join(workspace,'results','out.csv'),'value\n1\n',{mode:0o644});}else writeFileSync(join(workspace,'model','main.py'),'print(1)\n',{mode:0o644});chmodSync(join(workspace,'README.md'),0o644);t.after(()=>import('node:fs/promises').then(fs=>fs.rm(root,{recursive:true,force:true})));const result=spawnSync('python3',[helper,'freeze',token],{encoding:'utf8',env:{...process.env,RIFFOLOGY_WORKSPACE_ROOT:workspace,RIFFOLOGY_ARCHIVE_ROOT:archives}});assert.equal(result.status,0,result.stderr);return new Uint8Array(readFileSync(join(archives,`${token}.output.tar`)));}

test('indexes canonical workspace archives without exposing file contents',t=>{
  const result=workspaceFileIndex(archive(t));assert.deepEqual(result,{schemaVersion:1,files:[
    {path:'README.md',type:'file',size:17,mode:0o644},
    {path:'model',type:'directory',size:0,mode:0o755},
    {path:'model/main.py',type:'file',size:9,mode:0o644},
  ]});assert.equal(JSON.stringify(result).includes('private contents'),false);
});

test('rejects corrupted, noncanonical and truncated archives',t=>{
  const original=archive(t),corrupted=Uint8Array.from(original);corrupted[0]^=1;assert.throws(()=>workspaceFileIndex(corrupted),/invalid-workspace-file-archive/);
  const padded=new Uint8Array(original.byteLength+10240);padded.set(original);assert.throws(()=>workspaceFileIndex(padded),/invalid-workspace-file-archive/);
  assert.throws(()=>workspaceFileIndex(original.slice(0,-512)),/invalid-workspace-file-archive/);
});

test('diffs content, mode, addition and deletion against the parent archive without returning bytes',t=>{
  const current=archive(t,true),result=workspaceFileDiff(current,archive(t));assert.deepEqual(result,{schemaVersion:1,summary:{added:2,modified:2,deleted:1},changes:[
    {path:'README.md',change:'modified',type:'file',size:17,mode:0o644},
    {path:'model',change:'modified',type:'directory',size:0,mode:0o700},
    {path:'model/main.py',change:'deleted',type:'file',size:9,mode:0o644},
    {path:'results',change:'added',type:'directory',size:0,mode:0o755},
    {path:'results/out.csv',change:'added',type:'file',size:8,mode:0o644},
  ]});assert.equal(JSON.stringify(result).includes('changed contents'),false);const genesis=workspaceFileDiff(current,null);assert.deepEqual(genesis.summary,{added:4,modified:0,deleted:0});assert.equal(genesis.changes.every(item=>item.change==='added'),true);
});
