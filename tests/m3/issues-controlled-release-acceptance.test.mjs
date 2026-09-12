import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runControlledReleaseAcceptance} from '../../scripts/m3/issues-controlled-release-acceptance.mjs';

const workerSha='a'.repeat(40),release={schemaVersion:1,status:'passed',phase:'postdeploy',workerVersionId:'12345678-1234-1234-1234-123456789abc'};

test('formal staging acceptance script uses the unified release-to-close owner',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['m3:issues:acceptance:staging'],'node scripts/m3/issues-controlled-release-acceptance.mjs');
});

test('official staging orchestration keeps one handler owner and coalesces acceptance plus outer close',async t=>{
  const root=mkdtempSync(join(tmpdir(),'riffology-unified-acceptance-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let closes=0,releaseCalls=0,acceptanceCalls=0;
  const closeRunner=async input=>{closes++;assert.equal(input.workerSha,workerSha);assert.equal(input.execute,true);return {schemaVersion:1,status:'passed',gateCloseConfirmed:true,workerVersionId:'22345678-1234-1234-1234-123456789abc'};};
  const result=await runControlledReleaseAcceptance({root,workerSha,authInputPath:join(root,'auth.json'),execute:true,releaseRunner:async input=>{releaseCalls++;assert.equal(input.signalSource,null);assert.equal(input.shouldAbort(),false);return release;},acceptanceRunner:async input=>{acceptanceCalls++;assert.equal(input.signalSource,null);assert.equal(input.shouldAbort(),false);assert.equal(statSync(input.releaseResultPath).mode&0o777,0o600);assert.deepEqual(JSON.parse(readFileSync(input.releaseResultPath,'utf8')),release);const [first,second]=await Promise.all([input.closeRunner(),input.closeRunner()]);assert.equal(first.gateCloseConfirmed,true);assert.deepEqual(second,first);return {schemaVersion:1,status:'passed',phase:'accepted',workerVersionId:release.workerVersionId,evidenceDirectory:join(root,'evidence'),gateClose:first};},closeRunner});
  assert.equal(result.status,'passed');assert.equal(result.phase,'accepted');assert.equal(result.gateClose.gateCloseConfirmed,true);assert.equal(releaseCalls,1);assert.equal(acceptanceCalls,1);assert.equal(closes,1);
});

test('acceptance failure cannot leave the opened gate behind and outer close remains once-only',async t=>{
  const root=mkdtempSync(join(tmpdir(),'riffology-unified-failure-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let gateOpen=false,closes=0;
  const result=await runControlledReleaseAcceptance({root,workerSha,authInputPath:join(root,'auth.json'),execute:true,releaseRunner:async()=>{gateOpen=true;return release;},acceptanceRunner:async()=>{throw Error('injected-acceptance-failure');},closeRunner:async()=>{closes++;gateOpen=false;return {schemaVersion:1,status:'passed',gateCloseConfirmed:true};}});
  assert.equal(result.status,'blocked');assert.equal(result.phase,'orchestration');assert.equal(result.reasonCode,'injected-acceptance-failure');assert.equal(gateOpen,false);assert.equal(closes,1);
});

test('blocked pre-open release preserves probe diagnostics in immutable checksummed evidence',async t=>{
  const root=mkdtempSync(join(tmpdir(),'riffology-unified-preopen-failure-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const failure={stage:'start-a',action:'start',actor:'m2-t-probe-a',requestTimeoutMs:180_000,delivery:'unknown',observedAt:1_000},blocked={schemaVersion:1,status:'blocked',phase:'platform-probe',reasonCode:'platform-probe-start-timeout',platformProbe:{schemaVersion:1,status:'blocked',reasonCode:'platform-probe-start-timeout',probeWorker:{name:'riffology-issues-probe-0123456789abcdef01234567'},actorA:'m2-t-probe-a',actorB:'m2-t-probe-b',failure,progress:{startedAt:900,timeline:[failure]},cleanup:{status:'passed'}}},close={schemaVersion:1,status:'passed',gateCloseConfirmed:true,workerVersionId:'22345678-1234-1234-1234-123456789abc'};
  const result=await runControlledReleaseAcceptance({root,workerSha,authInputPath:join(root,'auth.json'),execute:true,releaseRunner:async()=>blocked,acceptanceRunner:async()=>{throw Error('acceptance-must-not-run');},closeRunner:async()=>close,now:new Date('2026-09-12T00:00:00.000Z')});
  assert.equal(result.status,'blocked');assert.equal(result.phase,'release');assert.equal(result.reasonCode,'platform-probe-start-timeout');assert.deepEqual(result.release,blocked);assert.equal(result.gateClose.gateCloseConfirmed,true);assert.equal(result.evidenceDirectory,join(root,'docs/evidence/runs',`issues-1-6-21-20260912T000000000Z-${workerSha.slice(0,8)}`));assert.equal(existsSync(result.evidenceDirectory),true);assert.deepEqual(readdirSync(result.evidenceDirectory).sort(),['SHA256SUMS','gate-close.json','orchestration-result.json','release-result.json']);for(const name of readdirSync(result.evidenceDirectory))assert.equal(statSync(join(result.evidenceDirectory,name)).mode&0o777,0o600);assert.equal(statSync(result.evidenceDirectory).mode&0o777,0o700);assert.deepEqual(JSON.parse(readFileSync(join(result.evidenceDirectory,'release-result.json'),'utf8')).platformProbe.failure,failure);assert.deepEqual(JSON.parse(readFileSync(join(result.evidenceDirectory,'orchestration-result.json'),'utf8')).release.platformProbe.progress.timeline,[failure]);assert.match(readFileSync(join(result.evidenceDirectory,'SHA256SUMS'),'utf8'),/release-result\.json/);
});

test('signal in the former release-to-acceptance gap closes before exit and cannot start acceptance',async t=>{
  const root=mkdtempSync(join(tmpdir(),'riffology-unified-signal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=new EventEmitter();let gateOpen=false,closes=0,acceptanceCalls=0,openedResolve,releaseResolve,closeResolve,exitResolve;const opened=new Promise(resolve=>{openedResolve=resolve;}),releaseDone=new Promise(resolve=>{releaseResolve=resolve;}),closeDone=new Promise(resolve=>{closeResolve=resolve;}),exited=new Promise(resolve=>{exitResolve=resolve;});
  const running=runControlledReleaseAcceptance({root,workerSha,authInputPath:join(root,'auth.json'),execute:true,signalSource:source,signalExit:code=>exitResolve(code),releaseRunner:async()=>{gateOpen=true;openedResolve();await releaseDone;return release;},acceptanceRunner:async()=>{acceptanceCalls++;return {status:'passed'};},closeRunner:async()=>{closes++;gateOpen=false;await closeDone;return {schemaVersion:1,status:'passed',gateCloseConfirmed:true};}});
  await opened;source.emit('SIGTERM');source.emit('SIGINT');assert.equal(closes,1);assert.equal(gateOpen,false);releaseResolve();closeResolve();assert.equal(await exited,143);const result=await running;assert.equal(result.status,'blocked');assert.equal(result.phase,'interrupted');assert.equal(result.reasonCode,'controlled-release-acceptance-interrupted');assert.equal(result.gateClose.gateCloseConfirmed,true);assert.equal(acceptanceCalls,0);assert.equal(closes,1);
});

test('a paused-candidate emergency close proves the gate closed without satisfying forward-close acceptance',async t=>{
  const root=mkdtempSync(join(tmpdir(),'riffology-unified-fallback-close-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const evidence=join(root,'existing-evidence');mkdirSync(evidence);
  const result=await runControlledReleaseAcceptance({root,workerSha,authInputPath:join(root,'auth.json'),execute:true,releaseRunner:async()=>release,acceptanceRunner:async()=>({schemaVersion:1,status:'passed',evidenceDirectory:evidence}),closeRunner:async()=>({schemaVersion:1,status:'passed',gateClosed:true,gateCloseConfirmed:true,forwardConformant:false,workerVersionId:'22345678-1234-1234-1234-123456789abc'})});
  assert.equal(result.status,'blocked');assert.equal(result.phase,'gate-close-conformance');assert.equal(result.reasonCode,'turn-gate-closed-by-paused-candidate-fallback');assert.equal(result.gateClose.gateCloseConfirmed,true);assert.equal(result.gateClose.forwardConformant,false);
});
