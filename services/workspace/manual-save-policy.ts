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
/** Server configuration is the sole authority. A stopped/expired scoped policy
 * retains receipt recovery, but cannot authorize a new operation. */
export function manualSaveCapability(env:ManualSavePolicyEnv,scope:TurnScope,actor:TurnActor,now=Date.now()){
 if(env.MANUAL_SAVE_POLICY_JSON===undefined){
  if(local(env.APP_ORIGIN)&&local(env.BROWSER_PREVIEW_EXECUTION_ORIGIN)&&new URL(env.APP_ORIGIN!).origin!==new URL(env.BROWSER_PREVIEW_EXECUTION_ORIGIN!).origin)return {canRead:true,canWrite:true,canRecover:true,...localLimits};
  return {...denied};
 }
 try{
  const p=JSON.parse(env.MANUAL_SAVE_POLICY_JSON);
  if(!p||Object.keys(p).sort().join(',')!=='actor,enabled,endsAt,schema,scope,startsAt'||p.schema!=='manual-save-policy/v1'||typeof p.enabled!=='boolean')return {...denied};
  const expected=parseScope(p.scope),owner=parseActor(p.actor);
  if(!Number.isSafeInteger(p.startsAt)||!Number.isSafeInteger(p.endsAt)||p.startsAt<=0||p.endsAt<=p.startsAt||p.endsAt-p.startsAt>24*60*60*1000||!Number.isSafeInteger(now))return {...denied};
  if(!sameScope(expected,scope)||owner.userId!==actor.userId||owner.authVersion!==actor.authVersion)return {...denied};
  return {canRead:true,canRecover:true,canWrite:p.enabled&&now>=p.startsAt&&now<p.endsAt,...smallText};
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
