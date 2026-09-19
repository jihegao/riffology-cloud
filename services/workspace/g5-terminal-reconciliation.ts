import {turnId as checkedTurnId} from '../turn/protocol.ts';

const PREFIX='g5-terminal-reconciliation:';
const BLOCKED_REASON='g5-authority-turn-unsettled';

export type G5TerminalReconciliationBlock={
  schemaVersion:1;
  status:'blocked';
  reasonCode:typeof BLOCKED_REASON;
  blockedAt:number;
};

export type G5TerminalReconciliationResult='completed'|'blocked'|'skipped-blocked';

function block(value:unknown):G5TerminalReconciliationBlock|null{
  if(value===undefined)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid-g5-terminal-reconciliation-state');
  const record=value as Record<string,unknown>;
  if(Object.keys(record).sort().join(',')!=='blockedAt,reasonCode,schemaVersion,status'||record.schemaVersion!==1||record.status!=='blocked'||record.reasonCode!==BLOCKED_REASON||!Number.isSafeInteger(record.blockedAt)||Number(record.blockedAt)<1)throw Error('invalid-g5-terminal-reconciliation-state');
  return record as G5TerminalReconciliationBlock;
}

export class G5TerminalReconciliation{
  readonly #storage:Pick<DurableObjectStorage,'kv'|'sync'>;
  readonly #clock:()=>number;
  constructor(storage:Pick<DurableObjectStorage,'kv'|'sync'>,clock=Date.now){
    if(!storage?.kv||typeof storage.sync!=='function'||typeof clock!=='function')throw Error('g5-terminal-reconciliation-storage-required');
    this.#storage=storage;this.#clock=clock;
  }
  #key(id:string){return PREFIX+checkedTurnId(id);}
  read(id:string):G5TerminalReconciliationBlock|null{return block(this.#storage.kv.get(this.#key(id)));}
  async run(id:string,operation:()=>Promise<void>):Promise<G5TerminalReconciliationResult>{
    const key=this.#key(id);if(block(this.#storage.kv.get(key)))return 'skipped-blocked';
    try{await operation();return 'completed';}
    catch(error){
      if(!(error instanceof Error)||error.message!==BLOCKED_REASON)throw error;
      const blockedAt=this.#clock();if(!Number.isSafeInteger(blockedAt)||blockedAt<1)throw Error('invalid-g5-terminal-reconciliation-time');
      this.#storage.kv.put(key,{schemaVersion:1,status:'blocked',reasonCode:BLOCKED_REASON,blockedAt} satisfies G5TerminalReconciliationBlock);
      await this.#storage.sync();return 'blocked';
    }
  }
}
