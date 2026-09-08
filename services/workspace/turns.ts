import { TurnAlarmLoop, type TurnAlarmPort, type TurnAlarmTiming } from '../turn/alarm.ts';
import { TurnDispatcher, type TurnArtifactReferencePort, type TurnRuntimePort } from '../turn/dispatcher.ts';
import { TurnJournal } from '../turn/journal.ts';
import { turnId, type TurnActor, type TurnRecord, type TurnScope } from '../turn/protocol.ts';

/** Connects user mutations and Durable Object alarms to the Turn state
 * machine. Workspace readiness and actor selection remain the caller's job. */
export class WorkspaceTurnEngine{
  readonly #journal:TurnJournal;
  readonly #loop:TurnAlarmLoop;
  constructor(journal:TurnJournal,runtime:TurnRuntimePort,alarm:TurnAlarmPort,clock=Date.now,timing:Partial<TurnAlarmTiming>={},artifactReferences:TurnArtifactReferencePort|null=null){
    this.#journal=journal;this.#loop=new TurnAlarmLoop(new TurnDispatcher(journal,runtime,artifactReferences),alarm,clock,timing);
  }
  submit(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,body:{message:unknown}){
    return this.#loop.enqueue(()=>this.#journal.submit(scope,actor,sessionId,key,body));
  }
  async cancel(scope:TurnScope,actor:TurnActor,rawTurnId:string):Promise<TurnRecord>{
    const id=turnId(rawTurnId),state=await this.#journal.snapshot(scope),turn=state.turns[id];
    if(!turn)return this.#journal.cancel(scope,actor,id);
    return this.#loop.cancel(scope,actor,turn);
  }
  alarm(scope:TurnScope,generation:number){return this.#loop.alarm(scope,generation);}
}
