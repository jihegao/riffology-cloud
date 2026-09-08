import type { TurnActor, TurnRecord, TurnScope } from './protocol.ts';

export interface TurnAlarmDispatcher {
  tick(scope:TurnScope,generation:number):Promise<TurnRecord|null>;
  cancel(scope:TurnScope,actor:TurnActor,turn:TurnRecord):Promise<TurnRecord>;
}
export interface TurnAlarmPort {
  schedule(at:number):Promise<void>;
  clear():Promise<void>;
}
export type TurnAlarmTiming={pollMs:number;retryMs:number};
const DEFAULT_TIMING:TurnAlarmTiming={pollMs:1000,retryMs:2000};
const TERMINAL=new Set<TurnRecord['status']>(['completed','failed','cancelled','interrupted']);
function positive(value:unknown):number{if(!Number.isSafeInteger(value)||(value as number)<1)throw Error('invalid-turn-alarm-timing');return value as number;}

/** Durable scheduling policy for TurnDispatcher. The alarm is only a wakeup;
 * Journal + Runtime receipts remain authoritative. A transport error schedules
 * observation before it is rethrown, so HTTP/SSE lifetimes never own execution. */
export class TurnAlarmLoop {
  readonly #dispatcher:TurnAlarmDispatcher;
  readonly #alarm:TurnAlarmPort;
  readonly #clock:()=>number;
  readonly #timing:TurnAlarmTiming;
  #active:Promise<TurnRecord|null>|null=null;
  constructor(dispatcher:TurnAlarmDispatcher,alarm:TurnAlarmPort,clock=Date.now,timing:Partial<TurnAlarmTiming>={}){
    this.#dispatcher=dispatcher;this.#alarm=alarm;this.#clock=clock;
    this.#timing={pollMs:positive(timing.pollMs??DEFAULT_TIMING.pollMs),retryMs:positive(timing.retryMs??DEFAULT_TIMING.retryMs)};
  }
  /** Arm durable work before committing a queued Turn. If arming is uncertain,
   * mutation is not invoked; an extra empty alarm is safe. */
  async enqueue<T>(mutation:()=>Promise<T>):Promise<T>{
    await this.#alarm.schedule(positive(this.#clock())+1);
    return mutation();
  }
  async alarm(scope:TurnScope,generation:number):Promise<TurnRecord|null>{
    if(this.#active)return this.#active;
    this.#active=this.#advance(scope,generation).finally(()=>{this.#active=null;});
    return this.#active;
  }
  async cancel(scope:TurnScope,actor:TurnActor,turn:TurnRecord):Promise<TurnRecord>{
    // Pre-arm before the journal writes cancelling or the runtime sees cancel.
    await this.#alarm.schedule(positive(this.#clock())+this.#timing.retryMs);
    let result:TurnRecord;
    try{result=await this.#dispatcher.cancel(scope,actor,turn);}catch(error){throw error;}
    if(!TERMINAL.has(result.status))await this.#alarm.schedule(positive(this.#clock())+this.#timing.pollMs);
    else await this.#alarm.schedule(positive(this.#clock())+1);
    return result;
  }
  async #advance(scope:TurnScope,generation:number):Promise<TurnRecord|null>{
    // The current alarm is considered consumed while its handler runs. Set the
    // reconciliation alarm before any journal or external runtime transition.
    await this.#alarm.schedule(positive(this.#clock())+this.#timing.retryMs);
    let result:TurnRecord|null;
    try{result=await this.#dispatcher.tick(scope,generation);}catch(error){throw error;}
    if(!result){await this.#alarm.clear();return null;}
    await this.#alarm.schedule(positive(this.#clock())+(TERMINAL.has(result.status)?1:this.#timing.pollMs));
    return result;
  }
}
