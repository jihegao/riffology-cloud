import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {initialWorkspaceArchive} from '../../services/turn-runtime/initial-workspace-archive.ts';
import {workspaceFileDiff,workspaceFileIndex} from '../../services/turn-runtime/workspace-file-index.ts';

const encode=(value:string)=>new TextEncoder().encode(value);
test('initial archive matches Python canonical freeze including binary, Unicode and USTAR prefix paths',t=>{
  const long=`docs/${'前'.repeat(24)}/${'x'.repeat(80)}.md`;
  const files:Record<string,Uint8Array>={'model/main.py':encode('print(1)\n'),'README.md':encode('Workspace\n'),'app/模型.bin':new Uint8Array([0,255,128,10]),[long]:encode('long'),'docs/😀.txt':encode('emoji'),'docs/\ue000.txt':encode('bmp')};
  const archive=initialWorkspaceArchive(files),root=mkdtempSync(join(tmpdir(),'initial-workspace-')),workspace=join(root,'workspace'),archives=join(root,'archives');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const index=workspaceFileIndex(archive);
  for(const entry of index.files){const target=join(workspace,entry.path);if(entry.type==='directory'){mkdirSync(target,{recursive:true});chmodSync(target,0o755);}else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,files[entry.path]!);chmodSync(target,0o644);}}
  const token='a'.repeat(52),result=spawnSync('python3',[new URL('../../services/project-tools/workspace_archive.py',import.meta.url).pathname,'freeze',token],{encoding:'utf8',env:{...process.env,RIFFOLOGY_WORKSPACE_ROOT:workspace,RIFFOLOGY_ARCHIVE_ROOT:archives}});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(archive,new Uint8Array(readFileSync(join(archives,`${token}.output.tar`))));
  assert.deepEqual(initialWorkspaceArchive(Object.fromEntries(Object.entries(files).reverse())),archive);
  assert.deepEqual(workspaceFileDiff(archive,archive).summary,{added:0,modified:0,deleted:0});
  const modified=initialWorkspaceArchive({...files,'model/main.py':encode('print(2)\n')});assert.deepEqual(workspaceFileDiff(modified,archive).changes,[{path:'model/main.py',change:'modified',type:'file',size:9,mode:0o644}]);
});

test('empty initial archive includes all five public directories and no private controls',()=>{
  assert.deepEqual(workspaceFileIndex(initialWorkspaceArchive({})).files,['app','docs','experiments','model','results'].map(path=>({path,type:'directory',size:0,mode:0o755})));
});

test('rejects unsafe paths, colliding parents and paths beyond canonical USTAR limits',()=>{
  for(const path of ['/absolute','a//b','a/../b','a/./b','a/','a\\b','.riffology/state','docs/.riffology/state','docs/\0bad','docs/e\u0301.txt','docs/\ud800','docs/'+'a'.repeat(101)])assert.throws(()=>initialWorkspaceArchive({[path]:encode('x')}),/invalid-initial-workspace-archive/,path);
  const collisions:Record<string,Uint8Array>[]=[{'model':encode('x')},{'docs/foo':encode('x'),'docs/foo/bar':encode('y')},{'docs/foo/bar':encode('y'),'docs/foo':encode('x')}];for(const files of collisions)assert.throws(()=>initialWorkspaceArchive(files),/invalid-initial-workspace-archive/);
});

test('rejects oversized initial content, excessive entries and non-byte/getter inputs',()=>{
  assert.throws(()=>initialWorkspaceArchive({'model/huge':new Uint8Array(8*1024*1024+64*1024+1)}),/invalid-initial-workspace-archive/);
  assert.throws(()=>initialWorkspaceArchive(Object.fromEntries(Array.from({length:4092},(_,i)=>[`model/${i}`,new Uint8Array()]))),/invalid-initial-workspace-archive/);
  let accessed=false;const getter=Object.defineProperty({},'model/x',{enumerable:true,get(){accessed=true;return encode('x');}});assert.throws(()=>initialWorkspaceArchive(getter),/invalid-initial-workspace-archive/);assert.equal(accessed,false);
  assert.throws(()=>initialWorkspaceArchive({'model/x':'text'} as unknown as Record<string,Uint8Array>),/invalid-initial-workspace-archive/);
});
