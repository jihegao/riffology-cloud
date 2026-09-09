import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableWorkspaceStore } from '../../services/workspace/store.ts';
import { nextWorkspaceAlarm, TURN_WAKE_KEY, SERVICE_WAKE_KEY, OBSERVER_WAKE_KEY, WORKSPACE_STATE_KEY } from '../../services/workspace/shared-alarm.ts';
import { DurableTurnAlarmPort, DurableServiceAlarmPort, DurableObserverAlarmPort } from '../../services/workspace/turn-alarm.ts';
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


test('service delivery alarm survives turn and provisioning completion and reopen',async()=>{
 const storage=new Storage(),typed=storage as unknown as DurableObjectStorage,workspace=new DurableWorkspaceStore(typed),turn=new DurableTurnAlarmPort(typed),service=new DurableServiceAlarmPort(typed);
 await workspace.update(()=>state(1000));await turn.schedule(2000);await service.schedule(1500);
 assert.equal(storage.alarm,1000);await workspace.update(s=>({...s!,wakeAt:null}));assert.equal(storage.alarm,1500);
 await turn.clear();assert.equal(storage.alarm,1500);assert.equal(new DurableServiceAlarmPort(typed).read(),1500);
 assert.equal(await new DurableTurnAlarmPort(typed).reconcile(),1500);
 await turn.schedule(1200);await service.clear();assert.equal(storage.alarm,1200);
 await turn.clear();assert.equal(storage.alarm,null);assert.equal(storage.values.has(SERVICE_WAKE_KEY),false);
});

test('failed service alarm mutations roll back without destroying other domains',async()=>{
 const storage=new Storage(),typed=storage as unknown as DurableObjectStorage,turn=new DurableTurnAlarmPort(typed),service=new DurableServiceAlarmPort(typed);
 await turn.schedule(2000);storage.failAlarm=true;await assert.rejects(service.schedule(1000),/alarm-storage-failed/);
 assert.equal(service.read(),null);assert.equal(turn.read(),2000);assert.equal(storage.alarm,2000);
 storage.failAlarm=false;await service.schedule(1000);storage.failAlarm=true;
 await assert.rejects(service.clear(),/alarm-storage-failed/);assert.equal(service.read(),1000);assert.equal(storage.alarm,1000);
});


test('four domains preserve Observer through provisioning, Turn and Service completion',async()=>{
 const storage=new Storage(),typed=storage as unknown as DurableObjectStorage;
 const workspace=new DurableWorkspaceStore(typed),turn=new DurableTurnAlarmPort(typed),service=new DurableServiceAlarmPort(typed),observer=new DurableObserverAlarmPort(typed);
 assert.equal(nextWorkspaceAlarm(4000,3000,2000,1000),1000);
 assert.throws(()=>nextWorkspaceAlarm(null,null,null,0),/invalid-workspace-alarm-time/);
 await observer.schedule(4000);await workspace.update(()=>state(1000));await turn.schedule(2000);await service.schedule(3000);
 assert.equal(storage.alarm,1000);
 await workspace.update(s=>({...s!,wakeAt:null}));assert.equal(storage.alarm,2000);
 await turn.clear();assert.equal(storage.alarm,3000);
 await service.clear();assert.equal(storage.alarm,4000);
 assert.equal(new DurableObserverAlarmPort(typed).read(),4000);
 assert.equal(await turn.reconcile(),4000);assert.equal(await service.reconcile(),4000);
 await observer.clear();assert.equal(storage.alarm,null);assert.equal(storage.values.has(OBSERVER_WAKE_KEY),false);
});

test('Observer clear and failed mutation preserve other durable activity wakes',async()=>{
 const storage=new Storage(),typed=storage as unknown as DurableObjectStorage;
 const turn=new DurableTurnAlarmPort(typed),service=new DurableServiceAlarmPort(typed),observer=new DurableObserverAlarmPort(typed);
 await turn.schedule(3000);await service.schedule(2000);await observer.schedule(1000);
 storage.failAlarm=true;await assert.rejects(observer.clear(),/alarm-storage-failed/);
 assert.equal(observer.read(),1000);assert.equal(storage.alarm,1000);
 storage.failAlarm=false;await observer.clear();assert.equal(storage.alarm,2000);
 assert.equal(turn.read(),3000);assert.equal(service.read(),2000);
 storage.failAlarm=true;await assert.rejects(observer.schedule(1500),/alarm-storage-failed/);
 assert.equal(observer.read(),null);assert.equal(storage.alarm,2000);
});
