/** Browser-only cleanup. It starts unarmed. An operator may arm it once in the
 * original A page only after the coordinator confirms both original Run receipts.
 * No cross-device RPC/polling; manual Stop must be applied to both original pages. */
export const cleanupOnceSource=String.raw`function cleanupOnce(options){
  let attempted=false,halted=false,armed=false,timer;
  const epoch=options.monotonicNow();
  const now=()=>options.serverNow+options.monotonicNow()-epoch;
  const trigger=async()=>{
    if(attempted||halted)return;
    if(!armed){options.report('cleanup not armed; no request');return;}
    if(now()<options.expires){options.report('cleanup not due');return;}
    attempted=true;options.disable();
    if(now()>=options.expires+30000){options.report('cleanup missed; pending, do not retry');return;}
    try{await options.send();}catch{options.report('cleanup unknown; do not retry');}
  };
  trigger.arm=()=>{
    if(armed||attempted||halted)return false;
    if(!options.canArm()){options.report('both original Run receipts must be confirmed before local authorization');return false;}
    armed=true;
    timer=options.setTimer(()=>{void trigger();},Math.max(0,options.expires-now()+1));
    options.enable();options.report('cleanup armed once by local operator authorization');return true;
  };
  trigger.halt=()=>{halted=true;if(timer!==undefined)options.clearTimer?.(timer);options.disable();};
  return trigger;
}`;
