import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const service=resolve('services/project-tools/file_service.py');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'m2-project-files-')),outside=mkdtempSync(join(tmpdir(),'m2-project-outside-'));mkdirSync(join(root,'model'));mkdirSync(join(root,'docs'));t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});return {root,outside};}
function run(root,operation,arguments_,deadlineAt=Date.now()+60_000){
  // A regular file keeps the one-shot stdin contract while avoiding an
  // intermittent macOS spawnSync pipe deadlock on the 1 MiB boundary case.
  const requestPath=join(tmpdir(),`m2-project-command-${randomUUID()}.json`);
  writeFileSync(requestPath,JSON.stringify({deadlineAt,operation,arguments:arguments_}),{mode:0o600});
  const input=openSync(requestPath,'r');
  try{
    const result=spawnSync('python3',[service],{stdio:[input,'pipe','pipe'],encoding:'utf8',env:{PATH:process.env.PATH,RIFFOLOGY_WORKSPACE_ROOT:root},timeout:10_000,maxBuffer:2*1024*1024});
    assert.equal(result.error,undefined,result.error?.message);
    const body=JSON.parse(result.stdout);return {...body,exitCode:result.status};
  }finally{closeSync(input);unlinkSync(requestPath);}
}
test('write and read use fd-relative paths and stable content evidence',t=>{const f=fixture(t),written=run(f.root,'write',{path:'model/main.py',content:'print("ok")\n'});assert.equal(written.exitCode,0);assert.deepEqual(written.result,{kind:'write',path:'model/main.py',bytes:12,sha256:'3a66aebdedbad3cf107d24e72a07d4b735819b1cf4020fdd922f63c064708172'});const read=run(f.root,'read',{path:'model/main.py'});assert.equal(read.result.content,'print("ok")\n');assert.equal(readFileSync(join(f.root,'model/main.py'),'utf8'),'print("ok")\n');});
test('edit requires one match unless replaceAll is explicit',t=>{const f=fixture(t);writeFileSync(join(f.root,'model/main.py'),'x = 1\nx = 1\n');assert.equal(run(f.root,'edit',{path:'model/main.py',oldText:'x = 1',newText:'x = 2',replaceAll:false}).error,'project-tool-edit-ambiguous');assert.equal(run(f.root,'edit',{path:'model/main.py',oldText:'x = 1',newText:'x = 2',replaceAll:true}).exitCode,0);assert.equal(readFileSync(join(f.root,'model/main.py'),'utf8'),'x = 2\nx = 2\n');});
test('list and search are sorted, bounded and line-addressable',t=>{const f=fixture(t);writeFileSync(join(f.root,'model/b.py'),'needle b\n');writeFileSync(join(f.root,'model/a.py'),'first\nneedle a\n');assert.deepEqual(run(f.root,'list',{path:'model'}).result.entries.map(row=>row.name),['a.py','b.py']);assert.deepEqual(run(f.root,'search',{path:'',query:'needle',maxResults:2}).result.matches,[{path:'model/a.py',line:2,text:'needle a'},{path:'model/b.py',line:1,text:'needle b'}]);});
test('invalid logical paths fail before file access',t=>{const f=fixture(t);for(const path of ['/etc/passwd','../outside','.riffology/secret','model//main.py','model/../main.py','model\\main.py'])assert.equal(run(f.root,'read',{path}).error,'invalid-tool-path');});
test('static leaf and intermediate symlinks cannot escape any file operation',t=>{const f=fixture(t);writeFileSync(join(f.outside,'secret.txt'),'secret');symlinkSync(join(f.outside,'secret.txt'),join(f.root,'model/linked.txt'));symlinkSync(f.outside,join(f.root,'linked-dir'));for(const [operation,args] of [['read',{path:'model/linked.txt'}],['write',{path:'model/linked.txt',content:'changed'}],['edit',{path:'model/linked.txt',oldText:'secret',newText:'changed',replaceAll:false}],['list',{path:'linked-dir'}],['search',{path:'linked-dir',query:'secret',maxResults:10}],['write',{path:'linked-dir/new.txt',content:'changed'}]])assert.notEqual(run(f.root,operation,args).exitCode,0);assert.equal(readFileSync(join(f.outside,'secret.txt'),'utf8'),'secret');});
test('binary, oversized, expired, far-future and unknown operations fail closed',t=>{const f=fixture(t);writeFileSync(join(f.root,'model/binary.dat'),Buffer.from([0xff,0xfe,0xfd]));assert.equal(run(f.root,'read',{path:'model/binary.dat'}).error,'project-tool-file-not-utf8');assert.equal(run(f.root,'write',{path:'model/large.txt',content:'x'.repeat(1024*1024+1)}).error,'project-tool-file-too-large');assert.equal(run(f.root,'write',{path:'model/x'},Date.now()-1).error,'tool-deadline-expired');assert.equal(run(f.root,'write',{path:'model/x'},Date.now()+500_000).error,'invalid-tool-deadline');assert.equal(run(f.root,'search',{path:'',query:'x'.repeat(1025),maxResults:1}).error,'invalid-tool-query');assert.equal(run(f.root,'unknown',{}).error,'project-tool-operation-not-file');});
test('bash runs in the workspace with bounded output and reports nonzero exits',t=>{const f=fixture(t);const result=run(f.root,'bash',{script:'pwd; printf ok; printf err >&2; exit 7',timeoutMs:2000});assert.equal(result.exitCode,0);assert.deepEqual(result.result,{kind:'bash',exitCode:7,stdout:`${realpathSync(f.root)}\nok`,stderr:'err',stdoutTruncated:false,stderrTruncated:false});const large=run(f.root,'bash',{script:"python3 -c 'print(\"x\" * 7000)'",timeoutMs:2000});assert.equal(large.result.stdout.length,6000);assert.equal(large.result.stdoutTruncated,true);});
test('bash timeout kills the process group and reports an unknown mutation outcome',async t=>{const f=fixture(t);const result=run(f.root,'bash',{script:'(sleep 0.2; printf late > model/late.txt) & sleep 5',timeoutMs:25});assert.equal(result.exitCode,2);assert.equal(result.error,'project-tool-bash-timeout');await new Promise(resolve=>setTimeout(resolve,350));assert.equal(existsSync(join(f.root,'model/late.txt')),false);});
test('large read crosses the helper boundary for platform artifact materialization',t=>{const f=fixture(t);writeFileSync(join(f.root,'model/large-readable.txt'),'x'.repeat(20_000));const result=run(f.root,'read',{path:'model/large-readable.txt'});assert.equal(result.exitCode,0);assert.equal(result.result.kind,'read');assert.equal(result.result.content.length,20_000);});
test('read_page returns stable UTF-8 byte pages and rejects mixed file versions',t=>{const f=fixture(t),path='model/paged.txt',text=`a😀中${'x'.repeat(9000)}`;writeFileSync(join(f.root,path),text);const first=run(f.root,'read_page',{path,offset:0,maxBytes:5,expectedSha256:null});assert.equal(first.exitCode,0);assert.deepEqual(first.result,{kind:'read_page',path,offset:0,nextOffset:5,bytes:5,totalBytes:9008,sha256:first.result.sha256,content:'a😀',eof:false});assert.equal(run(f.root,'read_page',{path,offset:5,maxBytes:4,expectedSha256:null}).error,'project-tool-read-page-sha-required');const second=run(f.root,'read_page',{path,offset:5,maxBytes:4,expectedSha256:first.result.sha256});assert.equal(second.exitCode,0);assert.equal(second.result.content,'中x');assert.equal(second.result.nextOffset,9);assert.equal(second.result.sha256,first.result.sha256);assert.equal(run(f.root,'read_page',{path,offset:2,maxBytes:8,expectedSha256:first.result.sha256}).error,'project-tool-read-page-offset-invalid');const end=run(f.root,'read_page',{path,offset:9008,maxBytes:4,expectedSha256:first.result.sha256});assert.equal(end.result.content,'');assert.equal(end.result.eof,true);writeFileSync(join(f.root,path),text+'changed');assert.equal(run(f.root,'read_page',{path,offset:5,maxBytes:8,expectedSha256:first.result.sha256}).error,'project-tool-read-page-version-changed');});
test('read_page shrinks JSON-escaped content below the inline receipt limit',t=>{const f=fixture(t),path='model/controls.txt';writeFileSync(join(f.root,path),'\u0001'.repeat(8192));const result=run(f.root,'read_page',{path,offset:0,maxBytes:8192,expectedSha256:null});assert.equal(result.exitCode,0);assert.ok(result.result.bytes<8192);assert.ok(Buffer.byteLength(JSON.stringify(result.result))<=15000);assert.ok(result.result.nextOffset>0);assert.equal(result.result.eof,false);});
test('a direct symlink workspace root is rejected',t=>{const f=fixture(t),link=join(tmpdir(),`m2-root-link-${Date.now()}`);symlinkSync(f.root,link);t.after(()=>rmSync(link,{force:true}));assert.equal(run(link,'list',{path:''}).error,'project-workspace-root-denied');});
test('dir-fd atomic replace cannot be redirected by a parent-directory swap',t=>{const f=fixture(t);writeFileSync(join(f.outside,'main.py'),'outside');const harness=`
import importlib.util, json, os
spec=importlib.util.spec_from_file_location('svc',${JSON.stringify(service)})
svc=importlib.util.module_from_spec(spec);spec.loader.exec_module(svc)
root=${JSON.stringify(f.root)}; outside=${JSON.stringify(f.outside)}
def hook(stage):
  if stage=='parent-opened':
    os.rename(os.path.join(root,'model'),os.path.join(root,'model-original'))
    os.symlink(outside,os.path.join(root,'model'))
svc.TEST_HOOK=hook
result=svc.execute({'deadlineAt':int(__import__('time').time()*1000)+60000,'operation':'write','arguments':{'path':'model/main.py','content':'inside'}},root)
print(json.dumps(result))
`;const result=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/project-tool-path/);assert.equal(readFileSync(join(f.outside,'main.py'),'utf8'),'outside');assert.throws(()=>readFileSync(join(f.root,'model-original/main.py'),'utf8'));
});
test('a path race after atomic replace is reported as unknown and never as a retryable failure',t=>{const f=fixture(t);writeFileSync(join(f.outside,'main.py'),'outside');const harness=`
import importlib.util, json, os, time
spec=importlib.util.spec_from_file_location('svc',${JSON.stringify(service)})
svc=importlib.util.module_from_spec(spec);spec.loader.exec_module(svc)
root=${JSON.stringify(f.root)}; outside=${JSON.stringify(f.outside)}
def hook(stage):
  if stage=='after-replace':
    os.rename(os.path.join(root,'model'),os.path.join(root,'model-original'))
    os.symlink(outside,os.path.join(root,'model'))
svc.TEST_HOOK=hook
try:
  svc.execute({'deadlineAt':int(time.time()*1000)+60000,'operation':'write','arguments':{'path':'model/main.py','content':'inside'}},root)
except svc.EffectUnknown as error:
  print(json.dumps({'unknown':True,'error':str(error)}))
`;const result=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{unknown:true,error:'project-tool-write-outcome-unknown'});assert.equal(readFileSync(join(f.outside,'main.py'),'utf8'),'outside');assert.equal(readFileSync(join(f.root,'model-original/main.py'),'utf8'),'inside');});

test('normal Bash exit stops background group members before returning a result',async t=>{
  const f=fixture(t);
  const result=run(f.root,'bash',{script:'(sleep 0.3; printf late > model/background.txt) >/dev/null 2>&1 & printf done',timeoutMs:1000});
  assert.equal(result.exitCode,0);assert.equal(result.result.stdout,'done');
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.equal(existsSync(join(f.root,'model/background.txt')),false);
});
