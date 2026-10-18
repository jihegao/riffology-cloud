import {actor,turnId,type TurnActor} from '../turn/protocol.ts';

export type BetaMaintenanceInput={requestId:string;expectedRevision:number;expectedPolicySha256:string};
export type BetaMaintenanceControl={policySha256:string;pinnedPolicySha256:string|null;enabled:boolean;paused:boolean;revision:number};
type Hold={requestId:string;actor:TurnActor;policySha256:string;controlRevision:number;beganAt:number};
type State={revision:number;hold:Hold|null};
type Receipt={action:'begin'|'end';requestId:string;actor:TurnActor;revision:number;at:number};
type Saved={input:BetaMaintenanceInput;actor:TurnActor;receipt:Receipt};
type Storage=Pick<DurableObjectStorage,'kv'|'transactionSync'>;
const STATE='beta-maintenance-state',PREFIX='beta-maintenance-receipt:';
const fail=(code='conflict'):never=>{throw Error('private-beta-maintenance-'+code);};
export function betaMaintenanceInput(raw:unknown):BetaMaintenanceInput{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid-private-beta-maintenance-input');
 const v=raw as Record<string,unknown>;
 if(Object.keys(v).sort().join()!=='expectedPolicySha256,expectedRevision,requestId'||!Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<0||typeof v.expectedPolicySha256!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedPolicySha256))throw Error('invalid-private-beta-maintenance-input');
 return {requestId:turnId(v.requestId),expectedRevision:Number(v.expectedRevision),expectedPolicySha256:v.expectedPolicySha256};
}
function state(storage:Storage):State{
 const raw=storage.kv.get<State>(STATE);if(raw===undefined)return {revision:0,hold:null};
 if(!raw||Object.keys(raw).sort().join()!=='hold,revision'||!Number.isSafeInteger(raw.revision)||raw.revision<0)fail('state-invalid');
 const hold=raw.hold;
 if(hold!==null){
  if(!hold||Object.keys(hold).sort().join()!=='actor,beganAt,controlRevision,policySha256,requestId'||!Number.isSafeInteger(hold.controlRevision)||hold.controlRevision<0||!Number.isSafeInteger(hold.beganAt)||hold.beganAt<1||!/^[a-f0-9]{64}$/.test(hold.policySha256))fail('state-invalid');
  actor(hold.actor);turnId(hold.requestId);
 }
 return raw;
}
function saved(storage:Storage,action:'begin'|'end',input:BetaMaintenanceInput,by:TurnActor){
 const prior=storage.kv.get<Saved>(PREFIX+action+':'+input.requestId);
 if(prior&&(JSON.stringify(prior.input)!==JSON.stringify(input)||JSON.stringify(prior.actor)!==JSON.stringify(by)))fail();
 return prior;
}
function open(control:BetaMaintenanceControl){
 if(!control.enabled||control.paused||control.policySha256!==control.pinnedPolicySha256)fail('controls-changed');
}
/** Only the original actor's persisted maintenance record. No monitor or timer. */
export function betaMaintenanceState(storage:Storage,control:BetaMaintenanceControl,requestId?:string,by?:TurnActor){
 const current=state(storage);
 const receipts:Partial<Record<'begin'|'end',Receipt>>={};
 if(requestId!==undefined){turnId(requestId);if(!by)fail();const checked=actor(by);
  for(const action of ['begin','end'] as const){const prior=storage.kv.get<Saved>(PREFIX+action+':'+requestId);if(prior){if(JSON.stringify(prior.actor)!==JSON.stringify(checked))fail();receipts[action]=prior.receipt;}}
 }
 return {schemaVersion:1 as const,...current,control,...(requestId===undefined?{}:{requestId,receipts})};
}
export function betaMaintenanceHeld(storage:Storage){return state(storage).hold!==null;}
/** Verify a live barrier without changing state or recovering a historical ACK. */
export function betaMaintenanceBarrier(storage:Storage,requestId:string,by:TurnActor,control:BetaMaintenanceControl){
 requestId=turnId(requestId);by=actor(by);open(control);const current=state(storage),hold=current.hold;
 if(!hold||hold.requestId!==requestId||JSON.stringify(hold.actor)!==JSON.stringify(by)||hold.policySha256!==control.policySha256||hold.controlRevision!==control.revision)fail();
 return current;
}
/** These synchronous transactions are called inside the capacity actor's queue. */
export function beginBetaMaintenance(storage:Storage,input:BetaMaintenanceInput,by:TurnActor,control:BetaMaintenanceControl){
 by=actor(by);const prior=saved(storage,'begin',input,by);if(prior)return {receipt:prior.receipt,replayed:true,current:state(storage)};
 open(control);const current=state(storage);
 if(current.hold||current.revision===Number.MAX_SAFE_INTEGER||current.revision!==input.expectedRevision||control.policySha256!==input.expectedPolicySha256)fail();
 const revision=current.revision+1,at=Date.now(),receipt:Receipt={action:'begin',requestId:input.requestId,actor:by,revision,at};
 storage.transactionSync(()=>{storage.kv.put(STATE,{revision,hold:{requestId:input.requestId,actor:by,policySha256:control.policySha256,controlRevision:control.revision,beganAt:at}} satisfies State);storage.kv.put(PREFIX+'begin:'+input.requestId,{input,actor:by,receipt} satisfies Saved);});
 return {receipt,replayed:false,current:state(storage)};
}
export function betaMaintenanceEndReplay(storage:Storage,input:BetaMaintenanceInput,by:TurnActor){const prior=saved(storage,'end',input,actor(by));return prior?{receipt:prior.receipt,current:state(storage)}:null;}
export function endBetaMaintenance(storage:Storage,input:BetaMaintenanceInput,by:TurnActor,control:BetaMaintenanceControl){
 by=actor(by);const prior=saved(storage,'end',input,by);if(prior)return {receipt:prior.receipt,replayed:true,current:state(storage)};
 open(control);const current=state(storage),hold=current.hold;
 if(!hold||current.revision===Number.MAX_SAFE_INTEGER||current.revision!==input.expectedRevision||hold.requestId!==input.requestId||JSON.stringify(hold.actor)!==JSON.stringify(by)||hold.policySha256!==input.expectedPolicySha256||hold.policySha256!==control.policySha256||hold.controlRevision!==control.revision)fail();
 const revision=current.revision+1,receipt:Receipt={action:'end',requestId:input.requestId,actor:by,revision,at:Date.now()};
 storage.transactionSync(()=>{storage.kv.put(STATE,{revision,hold:null} satisfies State);storage.kv.put(PREFIX+'end:'+input.requestId,{input,actor:by,receipt} satisfies Saved);});
 return {receipt,replayed:false,current:state(storage)};
}
