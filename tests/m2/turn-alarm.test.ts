import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnAlarmLoop, type TurnAlarmDispatcher } from '../../services/turn/alarm.ts';
import type { TurnActor, TurnRecord, TurnScope } from '../../services/turn/protocol.ts';

const scope:TurnScope={tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',workspaceGeneration:1};
const actor:TurnActor={userId:'user-a',authVersion:1};
function turn(status:TurnRecord['status']='running'):TurnRecord{return {id:'turn-one',sessionId:'session-one',scope,actor,requestKey:'request-one',payloadSha256:'a'.repeat(64),message:'Build',status,createdAt:1,updatedAt:1,startedAt:1,finishedAt:null,startedSequence:1,terminalSequence:null,dispatchId:'dispatch-one',runtimeGeneration:1,cancelRequestedAt:null,base:{workspace:null,session:null},executionOutcome:null,errorCode:null,persistenceOutcome:null,persistenceErrorCode:null,checkpoint:null};}
function fixture(){
  let now=1000,tick:()=>Promise<TurnRecord|null>=async()=>turn(),cancel:()=>Promise<TurnRecord>=async()=>turn('cancelling'),scheduleFails=false,cleared=0;const scheduled:number[]=[];
  const dispatcher:TurnAlarmDispatcher={tick:()=>tick(),cancel:()=>cancel()};
  const loop=new TurnAlarmLoop(dispatcher,{schedule:async at=>{if(scheduleFails)throw Error('alarm-storage-failed');scheduled.push(at);},clear:async()=>{cleared++;}},()=>now,{pollMs:10,retryMs:20});
  return {loop,scheduled,get cleared(){return cleared;},failSchedule(value:boolean){scheduleFails=value;},setNow(value:number){now=value;},setTick(value:typeof tick){tick=value;},setCancel(value:typeof cancel){cancel=value;}};
}

test('submission arms durable alarm before committing the queued mutation',async()=>{
  const f=fixture();let mutated=false;await f.loop.enqueue(async()=>{mutated=true;return 'accepted';});assert.equal(mutated,true);assert.deepEqual(f.scheduled,[1001]);
  const failed=fixture();failed.failSchedule(true);let unsafe=false;await assert.rejects(failed.loop.enqueue(async()=>{unsafe=true;}),/alarm-storage-failed/);assert.equal(unsafe,false);
});
test('running observation pre-arms reconciliation before dispatch and then selects its poll',async()=>{
  const f=fixture();const result=await f.loop.alarm(scope,1);
  assert.equal(result?.status,'running');assert.deepEqual(f.scheduled,[1020,1010]);
});
test('lost dispatcher response schedules reconciliation before surfacing the error',async()=>{
  const f=fixture();f.setTick(async()=>{throw Error('runtime-transport-unknown');});
  await assert.rejects(f.loop.alarm(scope,1),/transport-unknown/);assert.deepEqual(f.scheduled,[1020]);
  f.setTick(async()=>turn('running'));await f.loop.alarm(scope,1);assert.deepEqual(f.scheduled,[1020,1020,1010]);
});
test('terminal result wakes immediately to claim the next queued turn and an empty queue stops',async()=>{
  const f=fixture();f.setTick(async()=>turn('completed'));await f.loop.alarm(scope,1);assert.deepEqual(f.scheduled,[1020,1001]);
  f.setTick(async()=>null);assert.equal(await f.loop.alarm(scope,1),null);assert.deepEqual(f.scheduled,[1020,1001,1020]);assert.equal(f.cleared,1);
});
test('unknown cancellation polls while terminal cancellation wakes the next queue item',async()=>{
  const f=fixture();const original=turn('running');await f.loop.cancel(scope,actor,original);assert.deepEqual(f.scheduled,[1020,1010]);
  f.setCancel(async()=>turn('cancelled'));await f.loop.cancel(scope,actor,turn('cancelling'));assert.deepEqual(f.scheduled,[1020,1010,1020,1001]);
});
test('cancel transport uncertainty persists a reconciliation alarm',async()=>{
  const f=fixture();f.setCancel(async()=>{throw Error('cancel-unknown');});
  await assert.rejects(f.loop.cancel(scope,actor,turn()),/cancel-unknown/);assert.deepEqual(f.scheduled,[1020]);
});
test('concurrent alarm delivery shares one dispatcher tick',async()=>{
  const f=fixture();let release!:()=>void,calls=0;const blocked=new Promise<void>(resolve=>{release=resolve;});
  f.setTick(async()=>{calls++;await blocked;return turn();});const one=f.loop.alarm(scope,1),two=f.loop.alarm(scope,1);release();
  assert.equal(await one,await two);assert.equal(calls,1);assert.deepEqual(f.scheduled,[1020,1010]);
});
