/** Browser-only coordinator for the existing single cleanup request. No retry,
 * polling, credentials, new server resource or extra verification invocation.
 * Timer and manual action share a consumed flag in this original A page. */
export const cleanupOnceSource=String.raw`function cleanupOnce(options){
  let attempted=false;
  const epoch=options.monotonicNow();
  const now=()=>options.serverNow+options.monotonicNow()-epoch;
  const trigger=async()=>{
    if(attempted)return;
    if(now()<options.expires){options.report('cleanup not due');return;}
    attempted=true;
    options.disable();
    if(now()>=options.expires+30000){options.report('cleanup missed; pending, do not retry');return;}
    try{await options.send();}catch{options.report('cleanup unknown; do not retry');}
  };
  options.setTimer(()=>{void trigger();},Math.max(0,options.expires-options.serverNow+1));
  return trigger;
}`;
