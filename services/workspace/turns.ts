import { TurnAlarmLoop, type TurnAdmissionAlarmTrace, type TurnAlarmPort, type TurnAlarmTiming } from '../turn/alarm.ts';
import { TurnDispatcher, type TurnArtifactReferencePort, type TurnRuntimePort } from '../turn/dispatcher.ts';
import { TurnJournal } from '../turn/journal.ts';
import { turnId, type TurnActor, type TurnRecord, type TurnScope } from '../turn/protocol.ts';

/** Connects user mutations and Durable Object alarms to the Turn state
 * machine. Workspace readiness and actor selection remain the caller's job. */
export class WorkspaceTurnEngine{
  readonly #journal:TurnJournal;
  readonly #runtime:TurnRuntimePort;
  readonly #loop:TurnAlarmLoop;
  constructor(journal:TurnJournal,runtime:TurnRuntimePort,alarm:TurnAlarmPort,clock=Date.now,timing:Partial<TurnAlarmTiming>={},artifactReferences:TurnArtifactReferencePort|null=null){
    this.#journal=journal;this.#runtime=runtime;this.#loop=new TurnAlarmLoop(new TurnDispatcher(journal,runtime,artifactReferences),alarm,clock,timing);
  }
  submit(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,body:{message:unknown},trace?:TurnAdmissionAlarmTrace){
    return this.#loop.enqueue(()=>this.#journal.submit(scope,actor,sessionId,key,body),trace);
  }
  async cancel(scope:TurnScope,actor:TurnActor,rawTurnId:string):Promise<TurnRecord>{
    const id=turnId(rawTurnId),state=await this.#journal.snapshot(scope),turn=state.turns[id];
    if(!turn)return this.#journal.cancel(scope,actor,id);
    if(['completed','failed','cancelled','interrupted'].includes(turn.status)){
      const owned=await this.#journal.cancel(scope,actor,id);if(owned.persistenceOutcome!=='saved'||!owned.dispatchId||!owned.runtimeGeneration)return owned;
      const identity={scope:owned.scope,sessionId:owned.sessionId,turnId:owned.id,dispatchId:owned.dispatchId,generation:owned.runtimeGeneration};
      try{await this.#runtime.observe(identity);}catch(error){if(!(error instanceof Error)||!['product-turn-release-pending','product-turn-release-unconfirmed'].includes(error.message))throw error;}return owned;
    }
    return this.#loop.cancel(scope,actor,turn);
  }
  alarm(scope:TurnScope,generation:number){return this.#loop.alarm(scope,generation);}
}
