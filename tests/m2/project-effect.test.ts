import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectFileEffectPort, type ProjectEffectProcessObservation, type ProjectEffectStart, type ProjectEffectSupervisorPort } from '../../services/project-tools/effect.ts';
import type { ToolCommandReference } from '../../services/tools/ledger.ts';
import { toolCommandDigest } from '../../services/tools/protocol.ts';

const scope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const command=(operation:'read'|'read_page'|'write'|'edit'|'list'|'search'|'bash'='write')=>({schemaVersion:1 as const,scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',deadlineAt:2_000,operation,arguments:operation==='write'?{path:'model/main.py',content:'ok'}:operation==='read'?{path:'model/main.py'}:operation==='read_page'?{path:'model/main.py',offset:0,maxBytes:8192,expectedSha256:null}:operation==='list'?{path:''}:operation==='search'?{path:'',query:'x',maxResults:1}:operation==='edit'?{path:'model/main.py',oldText:'a',newText:'b',replaceAll:false}:{script:'id',timeoutMs:10}});
async function reference(operation:'read'|'read_page'|'write'|'edit'|'list'|'search'|'bash'='write'):Promise<{reference:ToolCommandReference;command:ReturnType<typeof command>}>{const value=command(operation);return {command:value,reference:{scope,turnId:'turn-a',dispatchId:'dispatch-a',commandId:'command-a',digest:await toolCommandDigest(value),effectId:'effect-a'}};}
const exited=(exitCode:number,body:unknown):ProjectEffectProcessObservation=>({schemaVersion:1,effectId:'effect-a',phase:'exited',exitCode,stdout:JSON.stringify(body),stderr:''});
function fixture(result:ProjectEffectProcessObservation){let started:ProjectEffectStart|null=null,observed=0;const supervisor:ProjectEffectSupervisorPort={async start(input){started=structuredClone(input);return result;},async observe(){observed++;return result;}};return {port:new ProjectFileEffectPort(supervisor,()=>1_000),get started(){return started;},get observed(){return observed;}};}

test('execute sends a fixed no-shell request without platform identity and authors the receipt envelope',async()=>{
  const f=fixture(exited(0,{ok:true,result:{kind:'write',path:'model/main.py',bytes:2,sha256:'a'.repeat(64)}}));
  const receipt=await f.port.execute({command:command(),effectId:'effect-a'}),start=f.started!;
  assert.equal(start.program,'/opt/riffology/file_service.py');assert.deepEqual(start.argv,[]);assert.equal(start.cwd,'/workspace');assert.deepEqual(start.env,{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:'/workspace'});assert.equal(start.timeoutMs,1_000);
  assert.deepEqual(JSON.parse(start.stdin),{deadlineAt:2_000,operation:'write',arguments:{path:'model/main.py',content:'ok'}});assert.doesNotMatch(start.stdin,/tenant-a|turn-a|dispatch-a|command-a|effect-a/);
  assert.equal(receipt.phase,'terminal');assert.equal(receipt.outcome,'completed');assert.equal(receipt.effectId,'effect-a');assert.deepEqual(receipt.scope,scope);
});

test('exit 4 and absence after start remain unknown',async()=>{
  for(const result of [exited(4,{ok:false,unknown:true,error:'project-tool-write-outcome-unknown'}),{schemaVersion:1 as const,effectId:'effect-a',phase:'absent' as const,exitCode:null,stdout:null,stderr:null}]){
    const receipt=await fixture(result).port.execute({command:command('write'),effectId:'effect-a'});assert.equal(receipt.phase,'unknown');assert.equal(receipt.outcome,null);
  }
});

test('ordinary helper rejection is terminal failed and expired commands never start',async()=>{
  const rejected=fixture(exited(2,{ok:false,error:'project-tool-file-unreadable'}));const failure=await rejected.port.execute({command:command(),effectId:'effect-a'});assert.equal(failure.phase,'terminal');assert.equal(failure.outcome,'failed');assert.equal(failure.errorCode,'project-tool-file-unreadable');
  let calls=0;const port=new ProjectFileEffectPort({async start(){calls++;throw Error('unexpected');},async observe(){throw Error('unexpected');}},()=>2_000);const expired=await port.execute({command:command(),effectId:'effect-a'});assert.equal(expired.outcome,'failed');assert.equal(expired.errorCode,'tool-deadline-expired');assert.equal(calls,0);
});

test('bash crosses the fixed helper boundary and a timed-out mutation remains unknown',async()=>{
  const completed=fixture(exited(0,{ok:true,result:{kind:'bash',exitCode:0,stdout:'ok',stderr:'',stdoutTruncated:false,stderrTruncated:false}}));
  const receipt=await completed.port.execute({command:command('bash'),effectId:'effect-a'});assert.equal(receipt.outcome,'completed');assert.equal(JSON.parse(completed.started!.stdin).operation,'bash');
  const timeout=await fixture(exited(2,{ok:false,error:'project-tool-bash-timeout'})).port.execute({command:command('bash'),effectId:'effect-a'});assert.equal(timeout.phase,'unknown');assert.equal(timeout.outcome,null);
});

test('large read-only output reaches the platform materializer while malformed output fails safely',async()=>{
  const large=await fixture(exited(0,{ok:true,result:{kind:'read',content:'x'.repeat(20_000)}})).port.execute({command:command('read'),effectId:'effect-a'});assert.equal(large.phase,'terminal');assert.equal(large.outcome,'completed');assert.equal((large.result as any).content.length,20_000);
  const malformed=await fixture(exited(0,{ok:true,scope,result:{}})).port.execute({command:command('read'),effectId:'effect-a'});assert.equal(malformed.outcome,'failed');assert.equal(malformed.errorCode,'project-tool-invalid-output');
});
test('read_page is a bounded read-only terminal effect',async()=>{const result={kind:'read_page',path:'model/main.py',offset:0,nextOffset:4,bytes:4,totalBytes:10,sha256:'a'.repeat(64),content:'test',eof:false};const receipt=await fixture(exited(0,{ok:true,result})).port.execute({command:command('read_page'),effectId:'effect-a'});assert.equal(receipt.phase,'terminal');assert.equal(receipt.outcome,'completed');assert.deepEqual(receipt.result,result);});

test('observe never starts again and recovers a terminal result using the bound command digest',async()=>{
  const input=await reference(),f=fixture(exited(0,{ok:true,result:{kind:'write'}}));const receipt=await f.port.observe(input);assert.equal(f.observed,1);assert.equal(f.started,null);assert.equal(receipt.phase,'terminal');assert.equal(receipt.outcome,'completed');
  const absent=fixture({schemaVersion:1,effectId:'effect-a',phase:'absent',exitCode:null,stdout:null,stderr:null});assert.equal((await absent.port.observe(input)).phase,'absent');
});

test('observe rejects a command that does not match the durable reference digest',async()=>{const input=await reference('read'),f=fixture(exited(0,{ok:true,result:{}}));await assert.rejects(f.port.observe({...input,command:command('list')}),/project-effect-command-mismatch/);assert.equal(f.observed,0);});

test('supervisor identity mismatch and unbounded transport output fail closed',async()=>{
  const mismatch=fixture({...exited(0,{ok:true,result:{}}),effectId:'effect-other'});await assert.rejects(mismatch.port.execute({command:command(),effectId:'effect-a'}),/invalid-project-effect-observation/);
  const huge=fixture({...exited(0,{ok:true,result:{}}),stdout:'x'.repeat(1_100_001)});await assert.rejects(huge.port.execute({command:command(),effectId:'effect-a'}),/project-effect-output-too-large/);
});
