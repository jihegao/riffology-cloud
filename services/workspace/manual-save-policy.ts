import {actor as parseActor,scope as parseScope,sameScope,type TurnActor,type TurnScope} from '../turn/protocol.ts';

export interface ManualSavePolicyEnv {
 APP_ORIGIN?:string;
 BROWSER_PREVIEW_EXECUTION_ORIGIN?:string;
 MANUAL_SAVE_POLICY_JSON?:string;
}
const smallText={maxRequestBytes:24*1024,maxFileBytes:8*1024,maxChanges:8,textOnly:true};
const localLimits={maxRequestBytes:4*1024*1024,maxFileBytes:256*1024,maxChanges:64,textOnly:false};
const denied={canRead:false,canWrite:false,canRecover:false,...smallText};
function local(value:string|undefined){try{const u=new URL(value!);return ['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&['http:','https:'].includes(u.protocol)&&u.href===u.origin+'/';}catch{return false;}}
function manualSavePolicyGrant(raw:unknown){
 const p=raw as Record<string,unknown>;
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='actor,enabled,endsAt,schema,scope,startsAt'||p.schema!=='manual-save-policy/v1'||typeof p.enabled!=='boolean')throw Error('invalid-manual-save-policy');
 const expected=parseScope(p.scope),owner=parseActor(p.actor);
 if(!Number.isSafeInteger(p.startsAt)||!Number.isSafeInteger(p.endsAt)||(p.startsAt as number)<=0||(p.endsAt as number)<=(p.startsAt as number)||(p.endsAt as number)-(p.startsAt as number)>24*60*60*1000)throw Error('invalid-manual-save-policy');
 return {scope:expected,actor:owner,enabled:p.enabled,startsAt:p.startsAt as number,endsAt:p.endsAt as number};
}
/** Server configuration is the sole authority. A stopped/expired scoped policy
 * retains receipt recovery, but cannot authorize a new operation. */
export function manualSaveCapability(env:ManualSavePolicyEnv,scope:TurnScope,actor:TurnActor,now=Date.now()){
 if(env.MANUAL_SAVE_POLICY_JSON===undefined){
  if(local(env.APP_ORIGIN)&&local(env.BROWSER_PREVIEW_EXECUTION_ORIGIN)&&new URL(env.APP_ORIGIN!).origin!==new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN!).origin)return {canRead:true,canWrite:true,canRecover:true,...localLimits};
  return {...denied};
 }
 try{
  const p=JSON.parse(env.MANUAL_SAVE_POLICY_JSON),v2=p?.schema==='manual-save-policy/v2';
  if(v2&&(Object.keys(p).sort().join(',')!=='current,recovery,schema'||p.recovery?.enabled!==false))return {...denied};
  const grants=(v2?[p.recovery,p.current]:[p]).map(manualSavePolicyGrant);
  if(!Number.isSafeInteger(now)||grants.some((a:ReturnType<typeof manualSavePolicyGrant>,i:number)=>grants.slice(i+1).some((b:ReturnType<typeof manualSavePolicyGrant>)=>sameScope(a.scope,b.scope)&&a.actor.userId===b.actor.userId&&a.actor.authVersion===b.actor.authVersion)))return {...denied};
  const match=grants.find((g:ReturnType<typeof manualSavePolicyGrant>)=>sameScope(g.scope,scope)&&g.actor.userId===actor.userId&&g.actor.authVersion===actor.authVersion);
  if(!match)return {...denied};
  return {canRead:true,canRecover:true,canWrite:match.enabled&&now>=match.startsAt&&now<match.endsAt,...smallText};
 }catch{return {...denied};}
}
export function assertManualSaveRead(env:ManualSavePolicyEnv,scope:TurnScope,actor:TurnActor){
 const capability=manualSaveCapability(env,scope,actor);
 if(!capability.canRead)throw Error('manual-save-local-only-or-policy-denied');
 return capability;
}
export function assertManualSaveBody(env:ManualSavePolicyEnv,scope:TurnScope,actor:TurnActor,body:unknown){
 const capability=assertManualSaveRead(env,scope,actor),raw=JSON.stringify(body);
 if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>capability.maxRequestBytes)throw Error('manual-save-limit');
 if(capability.textOnly){
  const value=body as {changes?:Array<{encoding?:string;content?:string}>;deletes?:unknown[]};
  if(!Array.isArray(value?.changes)||!Array.isArray(value?.deletes))throw Error('invalid-manual-save');
  if(value.changes.length+value.deletes.length>capability.maxChanges)throw Error('manual-save-limit');
  for(const change of value.changes){
   if(!change||change.encoding!=='utf8'||typeof change.content!=='string'||change.content.includes('\0'))throw Error('invalid-manual-save-content');
   if(new TextEncoder().encode(change.content).byteLength>capability.maxFileBytes)throw Error('manual-save-limit');
  }
 }
 return capability;
}
