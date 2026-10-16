import {workspaceAgentName} from '../workspace/protocol.ts';
import type {TurnActor,TurnScope} from '../turn/protocol.ts';
type Input={scope:TurnScope;actor:TurnActor};
interface ManualSaveWorkspace {
 manualSaveState(input:Input&{path?:string}):Promise<unknown>;
 manualSave(input:Input&{key:string;body:unknown}):Promise<unknown>;
 manualSaveStatus(input:Input&{operationId:string}):Promise<unknown>;
}
/** Local candidate only; no provider, execution or deployment permission. */
export function createGatewayManualSaveServices(env:{APP_ORIGIN?:string;BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;WORKSPACE_AGENT:{getByName(name:string):ManualSaveWorkspace}}){
 const gate=()=>{
  const local=(value:string|undefined)=>{try{const u=new URL(value!);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&u.href===u.origin+'/';}catch{return false;}};
  if(!local(env.APP_ORIGIN)||!local(env.BROWSER_PREVIEW_EXECUTION_ORIGIN)||new URL(env.APP_ORIGIN!).origin===new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN!).origin)throw Error('manual-save-local-only');
 };
 const stub=(scope:TurnScope)=>{gate();return env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));};
 const read=async(operation:Promise<unknown>)=>{const raw=await operation;try{return JSON.parse(JSON.stringify(raw));}finally{(raw as {[Symbol.dispose]?:()=>void}|null)?.[Symbol.dispose]?.();}};
 return {
  state:(scope:TurnScope,actor:TurnActor,path?:string)=>read(stub(scope).manualSaveState({scope,actor,...(path===undefined?{}:{path})})),
  save:(scope:TurnScope,actor:TurnActor,key:string,body:unknown)=>read(stub(scope).manualSave({scope,actor,key,body})),
  status:(scope:TurnScope,actor:TurnActor,operationId:string)=>read(stub(scope).manualSaveStatus({scope,actor,operationId})),
 };
}
