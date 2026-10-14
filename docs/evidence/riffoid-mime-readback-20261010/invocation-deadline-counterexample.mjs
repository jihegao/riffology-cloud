// Offline scheduler-stall model; no network and no implementation changes.
import {collectReadback} from '../worktree/scripts/m1/riffoid-validation-publisher.mjs';
const original=Object.getOwnPropertyDescriptor(performance,'now');let elapsed=0,calls=0;
Object.defineProperty(performance,'now',{configurable:true,value:()=>elapsed});
try{
  await collectReadback({request:async()=>{calls++;if(calls===1){elapsed=16001;return {status:200,contentType:'application/json',bytes:Buffer.from(JSON.stringify({success:true,result:{deployments:[{id:'d',strategy:'percentage',versions:[{version_id:'v',percentage:100}]}]}}))};}throw Error('second GET dispatched after first exceeded15000ms');}},'a'.repeat(32),'fixture-worker',{},{});
}catch(e){console.log(JSON.stringify({callerGETDispatches:calls,error:e.message,simulatedFirstGETElapsedMS:elapsed}));}
finally{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;}
