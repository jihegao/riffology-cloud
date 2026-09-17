import { TurnAlarmLoop, type TurnAdmissionAlarmTrace, type TurnAlarmPort, type TurnAlarmTiming } from '../turn/alarm.ts';
import { TurnDispatcher, type TurnArtifactReferencePort, type TurnCapacityPort, type TurnRuntimePort, type TurnStartGuard } from '../turn/dispatcher.ts';
import { TurnJournal } from '../turn/journal.ts';
import { turnId, type TurnActor, type TurnRecord, type TurnScope } from '../turn/protocol.ts';
import type { TurnOperationTrace } from '../turn/operation-telemetry.ts';

/** Connects user mutations and Durable Object alarms to the Turn state
 * machine. Workspace readiness and actor selection remain the caller's job. */
export class WorkspaceTurnEngine{
  readonly #journal:TurnJournal;
  readonly #runtime:TurnRuntimePort;
  readonly #loop:TurnAlarmLoop;
  readonly #terminalGuard:((turn:TurnRecord)=>Promise<void>)|undefined;
  constructor(journal:TurnJournal,runtime:TurnRuntimePort,alarm:TurnAlarmPort,clock=Date.now,timing:Partial<TurnAlarmTiming>={},artifactReferences:TurnArtifactReferencePort|null=null,capacity:TurnCapacityPort|null=null,operationTrace?:TurnOperationTrace,startGuard?:TurnStartGuard,terminalGuard?:(turn:TurnRecord)=>Promise<void>){
    this.#terminalGuard=terminalGuard;this.#journal=journal;this.#runtime=runtime;this.#loop=new TurnAlarmLoop(new TurnDispatcher(journal,runtime,artifactReferences,capacity,clock,operationTrace,startGuard),alarm,clock,timing,operationTrace);
  }
  submit(scope:TurnScope,actor:TurnActor,sessionId:string,key:string,body:{message:unknown},trace?:TurnAdmissionAlarmTrace,onAccepted?:(turn:TurnRecord)=>Promise<void>){
    return this.#loop.enqueue(async()=>{const result=await this.#journal.submit(scope,actor,sessionId,key,body);await onAccepted?.(result.turn);return result;},trace);
  }
  async cancel(scope:TurnScope,actor:TurnActor,rawTurnId:string):Promise<TurnRecord>{
    const id=turnId(rawTurnId),state=await this.#journal.snapshot(scope),turn=state.turns[id];
    if(!turn)return this.#journal.cancel(scope,actor,id);
    if(['completed','failed','cancelled','interrupted'].includes(turn.status)){
      const owned=await this.#journal.cancel(scope,actor,id);if(owned.persistenceOutcome!=='saved'||!owned.dispatchId||!owned.runtimeGeneration)return owned;
      const identity={scope:owned.scope,sessionId:owned.sessionId,turnId:owned.id,dispatchId:owned.dispatchId,generation:owned.runtimeGeneration};
      try{await this.#runtime.observe({...identity,capacityLease:owned.resourceLease!});}catch(error){if(!(error instanceof Error)||!['product-turn-release-pending','product-turn-release-unconfirmed'].includes(error.message))throw error;}return owned;
    }
    return this.#loop.cancel(scope,actor,turn);
  }
  async alarm(scope:TurnScope,generation:number){const turn=await this.#loop.alarm(scope,generation);if(turn&&['completed','failed','cancelled','interrupted'].includes(turn.status))await this.#terminalGuard?.(turn);return turn;}
}
