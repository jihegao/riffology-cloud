import type { ToolCommand, ToolCommandIntent } from './protocol.ts';
import { toolCommandReference, type ToolCommandRecord, type ToolCommandReference, type ToolEffectReceipt } from './ledger.ts';
import type { ToolResultMaterializer } from '../artifacts/materializer.ts';

export interface ToolLedgerPort{
  accept(value:unknown):Promise<{record:ToolCommandRecord;replayed:boolean}>;
  acceptIntent?(value:unknown):Promise<{record:ToolCommandRecord;replayed:boolean}>;
  dispatch(commandId:string):Promise<{authorized:boolean;observeOnly:boolean;record:ToolCommandRecord}>;
  markUnknown(reference:ToolCommandReference):Promise<ToolCommandRecord>;
  applyEffect(receipt:unknown):Promise<ToolCommandRecord>;
}
export interface ToolEffectPort{
  /** The project Sandbox adapter must compare its clock with command.deadlineAt
   * immediately before the native effect. Receiving this call is not enough:
   * only this immutable effectId may be created or observed. */
  execute(input:{command:ToolCommand;effectId:string}):Promise<ToolEffectReceipt>;
  observe(input:{reference:ToolCommandReference;command:ToolCommand}):Promise<ToolEffectReceipt>;
}

/** Bridges durable command intent to one isolated project-Sandbox effect.
 * Any transport uncertainty burns the dispatch authorization permanently. */
export class ToolDispatcher{
  #ledger:ToolLedgerPort;#effects:ToolEffectPort;#results:ToolResultMaterializer|null;
  constructor(ledger:ToolLedgerPort,effects:ToolEffectPort,results:ToolResultMaterializer|null=null){this.#ledger=ledger;this.#effects=effects;this.#results=results;}
  /** Native start is asynchronous. Keep the same immutable command while the
   * ledger changes subsequent deliveries into observe-only reconciliation.
   * Transport errors are not retried here; their durable unknown is preserved. */
  async runUntilSettled(command:unknown,options:{clock?:()=>number;wait?:()=>Promise<void>}={}):Promise<ToolCommandRecord>{
    const clock=options.clock??Date.now,wait=options.wait??(()=>new Promise(resolve=>setTimeout(resolve,100)));
    let record=await this.run(command);
    for(let attempt=0;attempt<1200&&!['completed','failed','cancelled'].includes(record.status);attempt++){
      if(clock()>=record.deadlineAt)return record;
      await wait();record=await this.run(command);
    }
    return record;
  }
  async run(command:unknown):Promise<ToolCommandRecord>{
    const accepted=await this.#ledger.accept(command),delivery=await this.#ledger.dispatch(accepted.record.commandId),record=delivery.record;
    return this.#deliver(record,delivery);
  }
  async runIntent(intent:ToolCommandIntent):Promise<ToolCommandRecord>{
    if(!this.#ledger.acceptIntent)throw Error('tool-command-intent-not-supported');const accepted=await this.#ledger.acceptIntent(intent),delivery=await this.#ledger.dispatch(accepted.record.commandId),record=delivery.record;
    return this.#deliver(record,delivery);
  }
  async runIntentUntilSettled(intent:ToolCommandIntent,options:{clock?:()=>number;wait?:()=>Promise<void>}={}):Promise<ToolCommandRecord>{
    const clock=options.clock??Date.now,wait=options.wait??(()=>new Promise<void>(resolve=>setTimeout(resolve,100)));let record=await this.runIntent(intent);
    for(let attempt=0;attempt<1200&&!['completed','failed','cancelled'].includes(record.status);attempt++){if(clock()>=record.deadlineAt)return record;await wait();record=await this.runIntent(intent);}return record;
  }
  async #deliver(record:ToolCommandRecord,delivery:{authorized:boolean;observeOnly:boolean;record:ToolCommandRecord}):Promise<ToolCommandRecord>{
    if(!delivery.authorized&&!delivery.observeOnly)return record;
    const reference=toolCommandReference(record);
    try{
      let receipt=delivery.authorized
        ?await this.#effects.execute({command:record.command??(()=>{throw Error('tool-command-payload-missing');})(),effectId:reference.effectId})
        :await this.#effects.observe({reference,command:record.command??(()=>{throw Error('tool-command-payload-missing');})()});
      if(this.#results&&record.command)receipt=await this.#results.materialize(receipt,record.command);
      return await this.#ledger.applyEffect(receipt);
    }catch(error){
      await this.#ledger.markUnknown(reference);
      throw error;
    }
  }
}
