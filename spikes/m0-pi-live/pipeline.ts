import { EffectDeadlineError, waitForEffect } from '../m0-recovery/bounded-effect.ts';
export type PipelineState = { step: number; stepStarted: boolean; startedAt: number; deadline: number; closed: boolean;
 phase: 'queued'|'running'|'completed'|'failed'|'cleaning'; operation: string|null; error: string|null; cleanup: 'pending'|'confirmed'|'unconfirmed'; events: {step:number;phase:string;at:number}[] };
/** Fixed diagnostic operations are supplied by the trusted Worker release. The
 * persisted step fence forbids replay after eviction at any await boundary. */
export class FixedPipeline {
 actual: Promise<unknown>|null=null; busy=false; operationMs=45000;
 readonly ctx: DurableObjectState; readonly steps: (()=>Promise<void>)[]; readonly cleanupOperations: (()=>Promise<boolean>)[];
 constructor(ctx: DurableObjectState, steps: (()=>Promise<void>)[], cleanupOperations: (()=>Promise<boolean>)[]) {this.ctx=ctx;this.steps=steps;this.cleanupOperations=cleanupOperations;}
 state(){return this.ctx.storage.kv.get<PipelineState>('pipeline')??null;}
 set(patch:Partial<PipelineState>){const old=this.state();if(!old)throw Error('uninitialized');const next={...old,...patch};
  if(next.step!==old.step||next.phase!==old.phase)next.events=[...old.events,{step:next.step,phase:next.phase,at:Date.now()}];
  if(next.events.length>64)throw Error('event-limit');this.ctx.storage.kv.put('pipeline',next);return next;}
 async accept(){if(this.state())throw Error('already-used');const now=Date.now();this.ctx.storage.kv.put('pipeline',{step:0,stepStarted:false,startedAt:now,deadline:now+420000,closed:false,phase:'queued',operation:null,error:null,cleanup:'pending',events:[]} satisfies PipelineState);await this.ctx.storage.sync();await this.ctx.storage.setAlarm(Date.now()+100);}
 async close(){if(!this.state()){const now=Date.now();this.ctx.storage.kv.put('pipeline',{step:0,stepStarted:false,startedAt:now,deadline:now,closed:true,phase:'failed',operation:null,error:'closed-before-accept',cleanup:'confirmed',events:[]} satisfies PipelineState);}else this.set({closed:true});await this.ctx.storage.sync();if(!this.actual&&!this.state()!.operation&&this.state()!.cleanup!=='confirmed')await this.ctx.storage.setAlarm(Date.now()+100);}
 async effect<T>(operation:string,invoke:()=>Promise<T>,cleanup=false):Promise<T>{
  const s=this.state()!;if(this.actual||s.operation||!cleanup&&(s.closed||Date.now()>=s.deadline))throw Error('effect-denied');
  this.set({operation});await this.ctx.storage.sync();
  if(!cleanup&&(this.state()!.closed||Date.now()>=s.deadline)){this.set({operation:null});await this.ctx.storage.sync();throw Error('effect-fenced');}
  let timedOut=false;
  // Dispatch in the same synchronous segment as the post-sync fence. A queued
  // microtask here would allow close() to win between the fence and invoke().
  let pending:Promise<T>;try{pending=Promise.resolve(invoke());}catch(error){pending=Promise.reject(error);}
  const actual=pending.finally(async()=>{
   this.set({operation:null});if(timedOut)this.set({phase:'failed',closed:true,error:'effect-outcome-unknown',cleanup:'pending'});
   await this.ctx.storage.sync();if(this.actual===actual)this.actual=null;
   if(timedOut)await this.ctx.storage.setAlarm(Date.now()+100);
  });this.actual=actual;this.ctx.waitUntil(actual.catch(()=>{}));
  try{return await waitForEffect(actual,cleanup?20000:Math.min(this.operationMs,s.deadline-Date.now()));}
  catch(error){if(error instanceof EffectDeadlineError){timedOut=true;this.set({phase:'failed',closed:true,error:'effect-outcome-unknown',cleanup:'unconfirmed'});await this.ctx.storage.sync();}throw error;}
 }
 async clean(){if(this.actual||this.state()!.operation)return;this.set({closed:true,phase:'cleaning'});let confirmed=true;
  for(let i=0;i<this.cleanupOperations.length;i++){
   if(this.ctx.storage.kv.get(`cleaned/${i}`))continue;
   try{if(await this.cleanupOperations[i]()){this.ctx.storage.kv.put(`cleaned/${i}`,true);await this.ctx.storage.sync();}else confirmed=false;}
   catch{confirmed=false;if(this.actual||this.state()!.operation)break;}
  }
  confirmed=confirmed&&this.cleanupOperations.every((_,i)=>this.ctx.storage.kv.get(`cleaned/${i}`)===true);
  this.set({cleanup:confirmed?'confirmed':'unconfirmed',phase:confirmed&&!this.state()!.error&&this.state()!.step===this.steps.length?'completed':'failed'});await this.ctx.storage.sync();
 }
 async alarm(){if(this.busy)return;this.busy=true;
  try{const s=this.state();if(!s||s.cleanup==='confirmed')return;
   if(s.operation){if(!this.actual){this.set({closed:true,phase:'failed',cleanup:'unconfirmed',error:'interrupted-rpc-needs-independent-reconciliation'});await this.ctx.storage.sync();}return;}
   if(s.closed||Date.now()>=s.deadline){if(!s.closed)this.set({closed:true,error:'run-deadline'});await this.clean();return;}
   if(s.stepStarted)throw Error('interrupted-step-never-replayed');
   if(s.step===this.steps.length){await this.clean();return;}
   this.set({stepStarted:true,phase:'running'});await this.ctx.storage.sync();
   // Persisting intent yields to close/deadline. Recheck before even entering
   // a release-supplied step, including its synchronous pre-effect work.
   if(this.state()!.closed||Date.now()>=s.deadline)throw Error('step-fenced');
   await this.steps[s.step]!();
   if(this.state()!.closed)throw Error('step-closed');
   this.set({step:s.step+1,stepStarted:false});await this.ctx.storage.sync();await this.ctx.storage.setAlarm(Date.now()+100);
  }catch{this.set({closed:true,phase:'failed',error:this.state()!.error??'fixed-step-failed'});await this.ctx.storage.sync();if(!this.actual&&!this.state()!.operation)await this.clean();}
  finally{this.busy=false;}
 }
}
