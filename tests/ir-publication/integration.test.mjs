import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=resolve('scripts/ir-publication'),fixture=resolve('tests/ir-publication');
test('actual on-demand consumer: fresh, mutated, stale, nonce, active, hold, timeout and abort',()=>{
  const output=execFileSync(process.execPath,['--experimental-test-module-mocks','--require',join(fixture,'network-deny.cjs'),join(fixture,'receipt-case.mjs')],{encoding:'utf8',stdio:'pipe',timeout:5000});
  const result=JSON.parse(output);assert.equal(result.passed,true);assert.equal(result.cases,8);assert.equal(result.networkRequests,0);
});
for(const scenario of ['success','resume-gateway','resume-evidence-drift','current-multi-module','credential-delay','400','native400','unknown-put','disabled','expired-window','stale-receipt','physical-unreleased','unknown-execution','baseline-drift','manifest-drift','source-drift','active-work']){
  test('integrated owner/core: '+scenario,()=>{
    const output=execFileSync(process.execPath,['--experimental-test-module-mocks','--require',join(fixture,'network-deny.cjs'),join(fixture,'integration-case.mjs'),scenario],
      {cwd:resolve('.'),encoding:'utf8',stdio:'pipe',timeout:30000});
    const result=JSON.parse(output);assert.equal(result.passed,true);assert.equal(result.cloudRequests,0);
  });
}
test('source manifest covers code, separately bound configuration stays closed, no temporary imports',async()=>{
  const manifest=JSON.parse(await readFile(join(root,'source-manifest.json')));
  const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);if(entry.isDirectory()&&entry.name!=='.state')await walk(path);
    else if(entry.isFile()&&entry.name!=='owner-bindings.mjs'&&/\.(?:mjs|py)$/.test(path))files.push(path.slice(root.length+1));
  }}await walk(root);
  assert.deepEqual(manifest.files.map(x=>x.file).sort(),files.sort());
  assert.equal(manifest.bindingsFile,'owner-bindings.mjs');
  assert.match(await readFile(join(root,manifest.bindingsFile),'utf8'),/executionEnabled = false/);
  for(const row of manifest.files){const bytes=await readFile(join(root,row.file));assert.equal(bytes.length,row.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
    if(row.file.endsWith('.mjs'))assert.doesNotMatch(bytes.toString(),/(?:from|import\()[^\n]*\/private\/tmp\/|publication-api-representation|original-write-diagnostics|collect-source-preflight/);
  }
});
test('actual bounded launcher inspect/execute remain disabled and collect mode is removed',()=>{
  for(const [mode,expectedExit] of [['--inspect',0],['--execute',1],['--collect',1]]){
    const p=spawnSync('/usr/bin/python3',['-I','-B',join(root,'bounded-owner-caller.py'),mode],{encoding:'utf8',timeout:15000});
    assert.equal(p.status,expectedExit,p.stdout+p.stderr);
    const records=p.stdout.trim().split('\n').map(x=>JSON.parse(x)),last=records.at(-1);
    if(mode==='--inspect')assert.equal(last.executionEnabled,false);
    else assert.equal(last.code,mode==='--execute'?'owner-wiring-disabled-before-auth':'fixed-launcher-arguments');
    assert.equal(records.some(x=>x.credentialProviderInvoked===true),false);
  }
});
