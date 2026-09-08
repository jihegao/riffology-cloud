import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helper=new URL('../../services/project-tools/workspace_archive.py',import.meta.url).pathname;
const token='a'.repeat(52);
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'riffology-workspace-archive-')),workspace=join(root,'workspace'),archives=join(root,'archives');
  mkdirSync(workspace,{mode:0o755});mkdirSync(archives,{mode:0o700});t.after(()=>rmSync(root,{recursive:true,force:true}));
  const run=operation=>spawnSync('python3',[helper,operation,token],{encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C.UTF-8',RIFFOLOGY_WORKSPACE_ROOT:workspace,RIFFOLOGY_ARCHIVE_ROOT:archives}});
  return {root,workspace,archives,run,output:join(archives,`${token}.output.tar`),input:join(archives,`${token}.input.tar`)};
}
function assertSuccess(result,operation){assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.ok,true);assert.equal(value.operation,operation);assert.match(value.sha256,/^[a-f0-9]{64}$/);return value;}

test('canonical archive is deterministic and restores the exact tree before execution',t=>{
  const f=fixture(t);mkdirSync(join(f.workspace,'model'),{mode:0o755});writeFileSync(join(f.workspace,'model','main.py'),'print(1)\n',{mode:0o644});writeFileSync(join(f.workspace,'run.sh'),'#!/bin/sh\n',{mode:0o700});
  const first=assertSuccess(f.run('freeze'),'freeze'),bytes=readFileSync(f.output);assert.equal(first.bytes,bytes.byteLength);
  assertSuccess(f.run('freeze'),'freeze');assert.deepEqual(readFileSync(f.output),bytes);
  copyFileSync(f.output,f.input);writeFileSync(join(f.workspace,'model','main.py'),'changed\n');writeFileSync(join(f.workspace,'extra.txt'),'remove me');
  const restored=assertSuccess(f.run('restore'),'restore');assert.equal(restored.sha256,first.sha256);assert.equal(readFileSync(join(f.workspace,'model','main.py'),'utf8'),'print(1)\n');assert.throws(()=>readFileSync(join(f.workspace,'extra.txt')),/ENOENT/);assert.equal(readFileSync(join(f.workspace,'run.sh'),'utf8'),'#!/bin/sh\n');
});

test('freezer rejects symlinks, hardlinks and unsupported modes',t=>{
  const f=fixture(t),file=join(f.workspace,'file.txt');writeFileSync(file,'x',{mode:0o644});symlinkSync(file,join(f.workspace,'link.txt'));let result=f.run('freeze');assert.equal(result.status,4);assert.match(result.stderr,/special-entry-denied/);
  rmSync(join(f.workspace,'link.txt'));linkSync(file,join(f.workspace,'hard.txt'));result=f.run('freeze');assert.equal(result.status,4);assert.match(result.stderr,/hardlink-denied/);
  rmSync(join(f.workspace,'hard.txt'));chmodSync(file,0o666);result=f.run('freeze');assert.equal(result.status,4);assert.match(result.stderr,/unsupported-workspace-archive-file/);
});

test('restore rejects a noncanonical archive before replacing the workspace',t=>{
  const f=fixture(t);writeFileSync(join(f.workspace,'stable.txt'),'stable',{mode:0o644});assertSuccess(f.run('freeze'),'freeze');copyFileSync(f.output,f.input);appendFileSync(f.input,Buffer.alloc(512));writeFileSync(join(f.workspace,'stable.txt'),'current');
  const result=f.run('restore');assert.equal(result.status,4);assert.match(result.stderr,/noncanonical-workspace-archive/);assert.equal(readFileSync(join(f.workspace,'stable.txt'),'utf8'),'current');
});

test('restore is locked and replay-safe, and overlong USTAR names fail cleanly',async t=>{
  const f=fixture(t);writeFileSync(join(f.workspace,'original.txt'),'original',{mode:0o644});const frozen=assertSuccess(f.run('freeze'),'freeze');copyFileSync(f.output,f.input);
  const first=assertSuccess(f.run('restore'),'restore');assert.equal(first.bytes,frozen.bytes);assert.equal(first.sha256,frozen.sha256);writeFileSync(join(f.workspace,'after.txt'),'preserve replay mutation',{mode:0o644});
  const replay=assertSuccess(f.run('restore'),'restore');assert.deepEqual(replay,first);assert.equal(readFileSync(join(f.workspace,'after.txt'),'utf8'),'preserve replay mutation');
  writeFileSync(join(f.workspace,'x'.repeat(101)),'x',{mode:0o644});const tooLong=f.run('freeze');assert.equal(tooLong.status,4);assert.match(tooLong.stderr,/path-too-long/);assert.doesNotMatch(tooLong.stderr,/Traceback/);
});
