import { DurableObject } from 'cloudflare:workers';
import type { WorkspaceState } from '../../services/workspace/coordinator.ts';
import { DurableWorkspaceStore } from '../../services/workspace/store.ts';
import { DurableTurnAlarmPort } from '../../services/workspace/turn-alarm.ts';

interface Env{SHARED_ALARM_PROBE:DurableObjectNamespace<SharedAlarmProbe>}
function state(wakeAt:number|null,now:number):WorkspaceState{return {schemaVersion:1,task:{id:'task-local',tenantId:'tenant-local',projectId:'project-local',workspaceId:'workspace-local',generation:1,starterVersion:'blank-v1',authVersion:1,createdAt:now,deadlineAt:now+180_000},runtimeId:'runtime-local',markerNonce:'nonce-local',markerSha256:null,identity:null,phase:'pending',lease:null,quotaReleased:false,acquisitionDenied:false,acquireAttempts:0,releaseAttempts:0,intents:{acquire:false,dispatch:false,initialize:false,stop:false,release:false},dispatchOwner:null,runtimeReceipt:null,stopReceipt:null,target:null,reasonCode:null,effect:null,calls:0,windowEndsAt:now+240_000,wakeAt,projection:null,projectionConfirmed:false,projectionAttempts:0,sequence:0};}

export class SharedAlarmProbe extends DurableObject{
  async alarm(){}
  async run(){const workspace=new DurableWorkspaceStore(this.ctx.storage),turn=new DurableTurnAlarmPort(this.ctx.storage),now=Date.now(),workspaceAt=now+60_000,turnFirst=now+30_000,turnLast=now+90_000,observed:Record<string,number|null>={};
    await workspace.update(()=>state(workspaceAt,now));observed.workspaceOnly=await this.ctx.storage.getAlarm();
    await turn.schedule(turnFirst);observed.turnEarlier=await this.ctx.storage.getAlarm();
    await turn.clear();observed.turnCleared=await this.ctx.storage.getAlarm();
    await turn.schedule(turnLast);observed.workspaceEarlier=await this.ctx.storage.getAlarm();
    await workspace.update(current=>({...current!,wakeAt:null}));observed.workspaceCleared=await this.ctx.storage.getAlarm();
    await turn.clear();observed.allCleared=await this.ctx.storage.getAlarm();
    const passed=observed.workspaceOnly===workspaceAt&&observed.turnEarlier===turnFirst&&observed.turnCleared===workspaceAt&&observed.workspaceEarlier===workspaceAt&&observed.workspaceCleared===turnLast&&observed.allCleared===null;
    return {passed,now,workspaceAt,turnFirst,turnLast,observed};
  }
}

export default {async fetch(request:Request,env:Env){const url=new URL(request.url);if(request.method!=='POST'||url.pathname!=='/probe'||url.search)return new Response('not found',{status:404});const result=await env.SHARED_ALARM_PROBE.getByName('m2-shared-alarm-probe').run();return Response.json(result,{status:result.passed?200:500});}} satisfies ExportedHandler<Env>;
