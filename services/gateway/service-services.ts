import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
import type {ServiceIntentRecord} from '../workspace/service-intents.ts';
import type {ServiceRunRecord} from '../run/service.ts';
import {HttpError} from './http.ts';

export type ServiceCursor={createdAt:number;runId:string};
export interface GatewayServiceRuns{
 submit(scope:TurnScope,actor:TurnActor,key:string,body:{maxDurationMs:number}):Promise<unknown>;
 stop(scope:TurnScope,runId:string):Promise<unknown>;
 view(scope:TurnScope,runId:string):Promise<unknown>;
 list(scope:TurnScope,options:{before?:ServiceCursor;limit?:number}):Promise<unknown>;
}
interface WorkspaceServices{
 submitServiceRequest(input:{scope:TurnScope;actor:TurnActor;key:string;body:{maxDurationMs:number}}):Promise<ServiceIntentRecord>;
 stopService(input:{scope:TurnScope;runId:string}):Promise<ServiceIntentRecord>;
 serviceView(input:{scope:TurnScope;runId:string}):Promise<{intent:ServiceIntentRecord;run:ServiceRunRecord|null}>;
 listServices(input:{scope:TurnScope;before?:ServiceCursor;limit?:number}):Promise<{items:ServiceIntentRecord[];nextCursor:ServiceCursor|null}>;
}
const publicErrors=new Set(['service-delivery-unconfirmed','service-delivery-deadline','service-deadline','service-start-failed','service-runtime-failed','service-quota-denied','service-preview-declaration-missing','service-preview-declaration-invalid','service-preview-files-missing','service-preview-files-invalid','service-preview-source-invalid']);
function publicService(intent:ServiceIntentRecord,run:ServiceRunRecord|null=null){
 const error=run?.errorCode??intent.errorCode;
 return {runId:intent.runId,kind:'service',deliveryStatus:intent.status,runStatus:run?.status??null,
  createdAt:intent.createdAt,updatedAt:Math.max(intent.updatedAt,run?.updatedAt??0),stopRequestedAt:intent.stopRequestedAt??run?.stopRequestedAt??null,
  errorCode:error===null?null:publicErrors.has(error)?error:'service-unavailable'};
}
async function projected<T,R>(operation:()=>Promise<T>,project:(value:T)=>R):Promise<R>{
 const raw=await operation();try{return project(raw);}finally{
  const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;
  if(typeof dispose==='function')dispose.call(raw);
 }
}
/** Scope and caller come from the authenticated Catalog, never browser JSON. */
export function createGatewayServiceServices(env:{M3_SERVICE_ENABLED?:unknown;WORKSPACE_AGENT:{getByName(name:string):WorkspaceServices}}):GatewayServiceRuns{
 const actor=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
 return {
  submit:async(scope,caller,key,body)=>{
   if(env.M3_SERVICE_ENABLED!=='true')throw new HttpError('service_runtime_not_ready',503);
   return projected(()=>actor(scope).submitServiceRequest({scope,actor:caller,key,body}),value=>publicService(value));
  },
  stop:(scope,runId)=>projected(()=>actor(scope).stopService({scope,runId}),value=>publicService(value)),
  view:(scope,runId)=>projected(()=>actor(scope).serviceView({scope,runId}),value=>publicService(value.intent,value.run)),
  list:(scope,options)=>projected(()=>actor(scope).listServices({scope,...options}),value=>({items:value.items.map(item=>publicService(item)),nextCursor:value.nextCursor===null?null:{createdAt:value.nextCursor.createdAt,runId:value.nextCursor.runId}})),
 };
}
