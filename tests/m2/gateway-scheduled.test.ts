import test from 'node:test';
import assert from 'node:assert/strict';
import {runGatewayScheduledDomains} from '../../services/gateway/scheduled.ts';

test('gateway cron still runs revision GC when the provisioning domain fails',async()=>{
  const calls:string[]=[];
  await assert.rejects(runGatewayScheduledDomains(
    async()=>{calls.push('provisioning');throw Error('injected-sweep-failure');},
    async()=>{calls.push('revision-gc');},
  ),/workspace-dispatch-incomplete/);
  assert.deepEqual(calls,['provisioning','revision-gc']);
});

test('gateway cron isolates a synchronous provisioning failure',async()=>{
  let gcRan=false;
  await assert.rejects(runGatewayScheduledDomains(
    (()=>{throw Error('injected-sync-sweep-failure');}) as ()=>Promise<void>,
    async()=>{gcRan=true;},
  ),/workspace-dispatch-incomplete/);
  assert.equal(gcRan,true);
});

test('gateway cron finishes provisioning when the revision GC domain fails',async()=>{
  const calls:string[]=[];
  await assert.rejects(runGatewayScheduledDomains(
    async()=>{calls.push('provisioning-start');await Promise.resolve();calls.push('provisioning-finish');},
    async()=>{calls.push('revision-gc');throw Error('injected-gc-failure');},
  ),/revision-gc-maintenance-incomplete/);
  assert.deepEqual(calls,['provisioning-start','revision-gc','provisioning-finish']);
});
