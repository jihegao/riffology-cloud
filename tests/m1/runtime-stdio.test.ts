import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSPECT_INITIAL_FILES, INSTALL_MODEL_CONTENT, WORKSPACE_DIRECTORIES } from '../../services/runtime/starter.ts';

async function run(program:string,input:Uint8Array) {
  const child=spawn(process.execPath,['-e',program],{stdio:['pipe','pipe','pipe']});
  const output:Buffer[]=[];child.stdout.on('data',chunk=>output.push(chunk));
  child.stdin.end(input);
  const exitCode=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  return {exitCode,stdout:Buffer.concat(output).toString('utf8')};
}

test('fixed runtime programs transport a package and manifest over stdin, outside argv',async t=>{
  const workspace=mkdtempSync(join(tmpdir(),'m1-runtime-stdio-'));t.after(()=>rmSync(workspace,{recursive:true,force:true}));
  for(const directory of WORKSPACE_DIRECTORIES)mkdirSync(join(workspace,directory),{recursive:true});
  writeFileSync(join(workspace,'.riffology','initialization.json'),'marker');writeFileSync(join(workspace,'README.md'),'readme');
  const content=new Uint8Array(512*1024);content.fill(97);
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const manifest={schemaVersion:1,files:[{path:'model/large.bin',bytes:content.byteLength,sha256}]};
  const header=new TextEncoder().encode(`${JSON.stringify(manifest)}\n`),input=new Uint8Array(header.byteLength+content.byteLength);input.set(header);input.set(content,header.byteLength);
  const installer=INSTALL_MODEL_CONTENT.replaceAll('/workspace',workspace);
  assert.doesNotMatch(installer,/YWFhYWFh/);assert.equal((await run(installer,input)).exitCode,0);
  assert.deepEqual(readFileSync(join(workspace,'model','large.bin')),Buffer.from(content));
  assert.equal((await run(installer,input)).exitCode,0,'an exact retry is idempotent');
  linkSync(join(workspace,'model','large.bin'),join(workspace,'model','large-hardlink.bin'));
  assert.equal((await run(installer,input)).exitCode,28,'an existing hardlinked target is rejected');
  const observer=INSPECT_INITIAL_FILES.replaceAll('/workspace',workspace),observed=await run(observer,new TextEncoder().encode(JSON.stringify(manifest)));
  assert.equal(observed.exitCode,0);assert.deepEqual(JSON.parse(observed.stdout),{'.riffology/initialization.json':'marker','README.md':'readme'});
});
