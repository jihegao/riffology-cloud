import test from 'node:test';
import assert from 'node:assert/strict';
import { toolCommandDigest, validateToolCommand, workspacePath } from '../../services/tools/protocol.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const base={schemaVersion:1,scope,turnId:'turn-one',dispatchId:'dispatch-one',commandId:'command-one',deadlineAt:1100};
const validate=(operation:string,args:Record<string,unknown>)=>validateToolCommand({...base,operation,arguments:args},()=>1000);

test('all MVP tools normalize one exact bounded argument shape',()=>{
 assert.deepEqual(validate('read',{path:'model/main.py'}).arguments,{path:'model/main.py'});
 assert.deepEqual(validate('read_page',{path:'model/main.py',offset:0,maxBytes:8192,expectedSha256:null}).arguments,{path:'model/main.py',offset:0,maxBytes:8192,expectedSha256:null});
 assert.deepEqual(validate('write',{path:'docs/note.md',content:''}).arguments,{path:'docs/note.md',content:''});
 assert.deepEqual(validate('edit',{path:'app/main.py',oldText:'one',newText:'two',replaceAll:false}).arguments,{path:'app/main.py',oldText:'one',newText:'two',replaceAll:false});
 assert.deepEqual(validate('list',{path:''}).arguments,{path:''});
 assert.deepEqual(validate('search',{path:'model',query:'Resource',maxResults:20}).arguments,{path:'model',query:'Resource',maxResults:20});
 assert.deepEqual(validate('bash',{script:'python model/main.py\n',timeoutMs:30000}).arguments,{script:'python model/main.py\n',timeoutMs:30000});
});
test('workspace paths reject absolute, traversal, platform metadata, backslashes and noncanonical Unicode',()=>{
 for(const path of ['/etc/passwd','../secret','model/../../secret','.riffology/session.json','model\\main.py','model//main.py','model/','e\u0301.py'])assert.throws(()=>workspacePath(path),/tool-path/,path);
 assert.equal(workspacePath('é.py'),'é.py');assert.equal(workspacePath('',true),'');assert.throws(()=>workspacePath(''));
});
test('commands reject extra fields, caller-shaped scope, expired/far deadlines and invalid tool bounds',()=>{
 assert.throws(()=>validateToolCommand({...base,operation:'read',arguments:{path:'README.md'},extra:true},()=>1000),/arguments/);
 assert.throws(()=>validateToolCommand({...base,scope:{...scope,owner:'caller'},operation:'read',arguments:{path:'README.md'}},()=>1000),/scope/);
 assert.throws(()=>validateToolCommand({...base,deadlineAt:1000,operation:'read',arguments:{path:'README.md'}},()=>1000),/deadline/);
 assert.throws(()=>validateToolCommand({...base,deadlineAt:122001,operation:'read',arguments:{path:'README.md'}},()=>1000),/deadline/);
 assert.throws(()=>validate('search',{path:'',query:'x',maxResults:201}),/arguments/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:-1,maxBytes:8192,expectedSha256:null}),/arguments/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:0,maxBytes:3,expectedSha256:null}),/arguments/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:0,maxBytes:8193,expectedSha256:null}),/arguments/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:0,maxBytes:8192,expectedSha256:'A'.repeat(64)}),/sha/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:0,maxBytes:8192}),/arguments/);
 assert.throws(()=>validate('bash',{script:'x',timeoutMs:30001}),/arguments/);
 assert.throws(()=>validate('edit',{path:'x',oldText:'',newText:'x',replaceAll:false}),/content/);
});
test('bash permits project shell syntax but rejects binary controls and unknown routing fields',()=>{
 assert.equal(validate('bash',{script:'python model.py && echo done',timeoutMs:1000}).operation,'bash');
 assert.throws(()=>validate('bash',{script:'echo\u0001bad',timeoutMs:1000}),/script/);
 assert.throws(()=>validate('read',{path:'README.md',sandboxId:'caller-choice'}),/arguments/);
 assert.throws(()=>validate('read_page',{path:'README.md',offset:0,maxBytes:8192,expectedSha256:null,sandboxId:'caller-choice'}),/arguments/);
 assert.throws(()=>validate('write',{path:'x',content:'x',tenantId:'other'}),/arguments/);
});
test('command digest is stable for normalized input and changes with capability or payload',async()=>{
 const one=validate('write',{path:'model/a.py',content:'one'}),same=validate('write',{path:'model/a.py',content:'one'}),changed=validate('write',{path:'model/a.py',content:'two'});
 assert.equal(await toolCommandDigest(one),await toolCommandDigest(same));assert.notEqual(await toolCommandDigest(one),await toolCommandDigest(changed));
 assert.notEqual(await toolCommandDigest(one),await toolCommandDigest({...one,dispatchId:'dispatch-two'}));
 const pageOne=validate('read_page',{path:'model/a.py',offset:0,maxBytes:8192,expectedSha256:null}),pageTwo=validate('read_page',{path:'model/a.py',offset:8192,maxBytes:8192,expectedSha256:'a'.repeat(64)});
 assert.notEqual(await toolCommandDigest(pageOne),await toolCommandDigest(pageTwo));
});
