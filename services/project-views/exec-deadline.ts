export type ProjectViewExecDeadlineOptions={clock?:()=>number;schedule?:(action:()=>void,delayMs:number)=>()=>void};
/** An exec signal must never fire after its process exits: the platform treats
 * that as an uncaught internal error. Arm only after an ExecProcess exists,
 * retain the original absolute deadline, and detach on every terminal path. */
export async function startProjectViewExec<T extends {readonly exitCode:Promise<number>}>(execute:(signal:AbortSignal)=>Promise<T>,expiresAt:number,options:ProjectViewExecDeadlineOptions={}){
 if(!Number.isSafeInteger(expiresAt)||expiresAt<1)throw Error('project-view-runtime-deadline-invalid');
 const clock=options.clock??Date.now,schedule=options.schedule??((action,delay)=>{const timer=setTimeout(action,delay);return ()=>clearTimeout(timer);});
 const controller=new AbortController();let disposed=false,cancel=()=>{};
 const dispose=()=>{disposed=true;cancel();cancel=()=>{};};
 try{
  const before=clock();if(!Number.isSafeInteger(before)||before<1)throw Error('project-view-runtime-clock-invalid');
  if(before>=expiresAt)throw Error('project-view-runtime-exec-expired');
  // While exec is pending there is no process handle whose exit we can
  // observe. The Runtime's persisted startup alarm still fences/destroys its
  // original container; no unobservable timeout signal is left behind here.
  const process=await execute(controller.signal);
  void process.exitCode.then(dispose,dispose);
  const now=clock();if(!Number.isSafeInteger(now)||now<1)throw Error('project-view-runtime-clock-invalid');
  // A late handle is fenced, never given an extra millisecond or signalled
  // after a possibly already completed exit. Core destroys its original actor.
  if(now>=expiresAt)throw Error('project-view-runtime-exec-expired');
  const unschedule=schedule(()=>{if(disposed)return;dispose();controller.abort(Error('project-view-runtime-exec-deadline'));},Math.max(1,expiresAt-now));
  if(disposed)unschedule();else cancel=unschedule;
  return {process,dispose};
 }catch(error){dispose();throw error;}
}
