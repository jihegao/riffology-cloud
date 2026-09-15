import {sameScope,type TurnRecord,type TurnScope} from '../turn/protocol.ts';
import type {readG4WindowSnapshot} from './g4-window.ts';
import type {SimulationRecord} from '../simulation/host.ts';
import type {ServiceIntentRecord} from '../workspace/service-intents.ts';
export function g4DurableComputeCounts(scope:TurnScope,window:ReturnType<typeof readG4WindowSnapshot>,turns:TurnRecord[],simulations:SimulationRecord[],services:ServiceIntentRecord[]){
 if(turns.some(t=>!sameScope(t.scope,scope))||simulations.some(r=>!sameScope(r.scope,scope))||services.some(r=>!sameScope(r.scope,scope)))throw Error('g4-compute-counts-scope-denied');
 const calls=window.calls as {state:string;accounted:number;dispatch_at:number|null}[];let occupied=0n;
 for(const r of calls){if(!Number.isSafeInteger(r.accounted)||r.accounted<0)throw Error('g4-compute-counts-invalid');occupied+=BigInt(r.accounted);}
 if(occupied>BigInt(Number.MAX_SAFE_INTEGER))throw Error('g4-compute-counts-overflow');
 return {window,provider:{semantics:'durable-dispatch-before-provider; unknown held',reserved:calls.length,dispatched:calls.filter(r=>r.dispatch_at!==null).length,unsettled:calls.filter(r=>['reserved','dispatched','unknown'].includes(r.state)).length,accountedNanodollars:Number(occupied),successfulExecutions:null},
  durableFences:{turns:{admitted:turns.length,dispatchClaimed:turns.filter(t=>t.dispatchId!==null).length,ids:turns.map(t=>({turnId:t.id,dispatchId:t.dispatchId}))},simulation:{admitted:simulations.length,dispatchClaimed:simulations.filter(r=>r.dispatchClaimed===true).length,startClaimed:simulations.filter(r=>r.startClaimed).length,ids:simulations.map(r=>r.runId)},service:{admitted:services.length,deliveryClaimed:services.filter(r=>r.deliveryClaimedAt!==null).length,ids:services.map(r=>r.runId)}}};
}

/** Private actor reads only. Never execute native health/observe as a fallback. */
export async function readG4NativeSample(port:{nativeAttemptSnapshot(identity:unknown):Promise<unknown>}|undefined,identity:unknown,toolLedger=false){
 if(!port)return {supported:false,noAddedCalls:true,reason:'native-counter-unavailable',...(toolLedger?{admitted:null,dispatched:null}:{attempts:null})};
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{const raw=await Promise.race([port.nativeAttemptSnapshot(identity),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('native-counter-timeout')),5000);})]);let value:unknown;
  try{value=JSON.parse(JSON.stringify(raw));}finally{const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;if(typeof dispose==='function')dispose.call(raw);}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('native-counter-invalid');const v=value as Record<string,unknown>;
  if(typeof v.supported!=='boolean'||v.noAddedCalls!==true)throw Error('native-counter-invalid');
  const integer=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
  if(toolLedger){if(v.supported?(!integer(v.admitted)||!integer(v.dispatched)):(v.admitted!==null||v.dispatched!==null))throw Error('native-counter-invalid');}
  else{if(v.schema!=='riffology.g4-native-attempts/v1'||v.semantics!=='attempt-before-call')throw Error('native-counter-invalid');if(v.supported){const a=v.attempts;if(!a||typeof a!=='object'||Array.isArray(a)||['init','startProcess','execControl','execFilework','taskStart'].some(k=>!integer((a as Record<string,unknown>)[k])))throw Error('native-counter-invalid');}else if(v.attempts!==null)throw Error('native-counter-invalid');}
  return v;
 }catch{return {supported:false,noAddedCalls:true,reason:'native-counter-unavailable-or-unregistered',...(toolLedger?{admitted:null,dispatched:null}:{attempts:null})};}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
