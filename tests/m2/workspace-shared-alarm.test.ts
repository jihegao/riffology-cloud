import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableWorkspaceStore } from '../../services/workspace/store.ts';
import { nextWorkspaceAlarm, TURN_WAKE_KEY, WORKSPACE_STATE_KEY } from '../../services/workspace/shared-alarm.ts';
import { DurableTurnAlarmPort } from '../../services/workspace/turn-alarm.ts';
import type { WorkspaceState } from '../../services/workspace/coordinator.ts';

class Storage{
  readonly values=new Map<string,unknown>();alarm:number|null=null;syncs=0;failAlarm=false;
  readonly sql={};
  readonly kv={get:<T>(key:string)=>structuredClone(this.values.get(key)) as T|undefined};
  readonly transaction=async<T>(operation:(transaction:any)=>Promise<T>)=>{
    const before=new Map([...this.values].map(([key,value])=>[key,structuredClone(value)])),beforeAlarm=this.alarm;
    try{return await operation({
      get:async<T>(key:string)=>structuredClone(this.values.get(key)) as T|undefined,
      put:async(key:string,value:unknown)=>{this.values.set(key,structuredClone(value));},
      delete:async(key:string)=>{this.values.delete(key);},
      setAlarm:async(at:number)=>{if(this.failAlarm)throw Error('alarm-storage-failed');this.alarm=at;},
      deleteAlarm:async()=>{if(this.failAlarm)throw Error('alarm-storage-failed');this.alarm=null;},
    });}catch(error){this.values.clear();for(const [key,value] of before)this.values.set(key,value);this.alarm=beforeAlarm;throw error;}
  };
  readonly sync=async()=>{this.syncs++;};
}

function state(wakeAt:number|null):WorkspaceState{return {schemaVersion:1,task:{id:'task-a',tenantId:'tenant-a',projectId:'project-a',workspaceId:'workspace-a',generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:1,deadlineAt:1000},runtimeId:'runtime-a',markerNonce:'nonce-a',markerSha256:null,identity:null,phase:'pending',lease:null,quotaReleased:false,acquisitionDenied:false,acquireAttempts:0,releaseAttempts:0,intents:{acquire:false,dispatch:false,initialize:false,stop:false,release:false},dispatchOwner:null,runtimeReceipt:null,stopReceipt:null,target:null,reasonCode:null,effect:null,calls:0,windowEndsAt:2000,wakeAt,projection:null,projectionConfirmed:false,projectionAttempts:0,sequence:0};}

test('earliest logical deadline owns the single physical alarm',()=>{
  assert.equal(nextWorkspaceAlarm(3000,2000),2000);assert.equal(nextWorkspaceAlarm(1000,null),1000);assert.equal(nextWorkspaceAlarm(null,4000),4000);assert.equal(nextWorkspaceAlarm(null,null),null);
  assert.throws(()=>nextWorkspaceAlarm(0,null),/invalid-workspace-alarm-time/);
});

test('turn completion restores provisioning alarm instead of deleting it',async()=>{
  const storage=new Storage(),workspace=new DurableWorkspaceStore(storage as unknown as DurableObjectStorage),turn=new DurableTurnAlarmPort(storage as unknown as DurableObjectStorage);
  await workspace.update(()=>state(3000));assert.equal(storage.alarm,3000);
  await turn.schedule(2000);assert.equal(storage.alarm,2000);assert.equal(storage.values.get(TURN_WAKE_KEY),2000);
  await turn.clear();assert.equal(storage.alarm,3000);assert.equal(storage.values.has(TURN_WAKE_KEY),false);
});

test('provisioning completion preserves active turn alarm and survives reconstruction',async()=>{
  const storage=new Storage(),workspace=new DurableWorkspaceStore(storage as unknown as DurableObjectStorage),turn=new DurableTurnAlarmPort(storage as unknown as DurableObjectStorage);
  await workspace.update(()=>state(1000));await turn.schedule(4000);assert.equal(storage.alarm,1000);
  await workspace.update(current=>({...current!,wakeAt:null}));assert.equal(storage.alarm,4000);assert.equal(storage.values.has(WORKSPACE_STATE_KEY),true);
  const reopened=new DurableTurnAlarmPort(storage as unknown as DurableObjectStorage);assert.equal(reopened.read(),4000);assert.equal(await reopened.reconcile(),4000);assert.equal(storage.alarm,4000);
});

test('failed alarm write commits neither logical deadline nor workspace transition',async()=>{
  const turnStorage=new Storage();turnStorage.failAlarm=true;const turn=new DurableTurnAlarmPort(turnStorage as unknown as DurableObjectStorage);
  await assert.rejects(turn.schedule(2000),/alarm-storage-failed/);
  assert.equal(turnStorage.syncs,0);assert.equal(turnStorage.values.has(TURN_WAKE_KEY),false);
  const workspaceStorage=new Storage();workspaceStorage.failAlarm=true;const workspace=new DurableWorkspaceStore(workspaceStorage as unknown as DurableObjectStorage);
  await assert.rejects(workspace.update(()=>state(3000)),/alarm-storage-failed/);assert.equal(workspaceStorage.syncs,0);assert.equal(workspaceStorage.values.has(WORKSPACE_STATE_KEY),false);
});
