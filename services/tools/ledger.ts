import {turnRuntimeIdentity,type TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type { TurnScope } from '../turn/protocol.ts';
import { jsonPayload, positive, sameScope, scope as validateScope, sha, turnDigest, turnId } from '../turn/protocol.ts';
import { normalizeToolCommand, normalizeToolCommandIntent, toolCommandDigest, toolCommandIntentDigest, type ToolCommand, type ToolCommandIntent, type ToolOperation } from './protocol.ts';
import { TOOL_LEDGER_SCHEMA } from './ledger-schema.ts';

export type ToolCommandStatus='accepted'|'dispatched'|'unknown'|'completed'|'failed'|'cancelled';
export type ToolCommandReference={scope:TurnScope;turnId:string;dispatchId:string;commandId:string;digest:string;effectId:string};
export type ToolCommandRecord={
  schemaVersion:1;scope:TurnScope;turnId:string;dispatchId:string;commandId:string;digest:string;
  deadlineAt:number;operation:ToolOperation;status:ToolCommandStatus;effectId:string|null;
  acceptedAt:number;updatedAt:number;dispatchedAt:number|null;unknownAt:number|null;finishedAt:number|null;
  lastObservedAt:number|null;
  outcome:'completed'|'failed'|'cancelled'|null;errorCode:string|null;result:Record<string,unknown>|null;
  command:ToolCommand|null;
};
export type ToolEffectReceipt={
  schemaVersion:1;scope:TurnScope;turnId:string;dispatchId:string;commandId:string;effectId:string;
  phase:'absent'|'unknown'|'running'|'terminal';outcome:'completed'|'failed'|'cancelled'|null;
  errorCode:string|null;result:Record<string,unknown>|null;observedAt:number;
};
export type ToolLedgerStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>;
type Row=Record<string,SqlStorageValue>;
const ACTIVE=new Set<ToolCommandStatus>(['accepted','dispatched','unknown']);
const TERMINAL=new Set<ToolCommandStatus>(['completed','failed','cancelled']);
const RECEIPT_PHASES=new Set<ToolEffectReceipt['phase']>(['absent','unknown','running','terminal']);
const OUTCOMES=new Set<NonNullable<ToolEffectReceipt['outcome']>>(['completed','failed','cancelled']);
function reject(code:string):never{throw Error(code);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);
}
function reference(value:unknown):ToolCommandReference{
  exact(value,['scope','turnId','dispatchId','commandId','digest','effectId'],'invalid-tool-reference');
  return {scope:validateScope(value.scope),turnId:turnId(value.turnId),dispatchId:turnId(value.dispatchId),commandId:turnId(value.commandId),digest:sha(value.digest),effectId:turnId(value.effectId)};
}
function receipt(value:unknown):ToolEffectReceipt{
  exact(value,['schemaVersion','scope','turnId','dispatchId','commandId','effectId','phase','outcome','errorCode','result','observedAt'],'invalid-tool-effect-receipt');
  if(value.schemaVersion!==1||typeof value.phase!=='string'||!RECEIPT_PHASES.has(value.phase as ToolEffectReceipt['phase']))reject('invalid-tool-effect-receipt');
  const phase=value.phase as ToolEffectReceipt['phase'],outcome=value.outcome===null?null:OUTCOMES.has(value.outcome as NonNullable<ToolEffectReceipt['outcome']>)?value.outcome as NonNullable<ToolEffectReceipt['outcome']>:reject('invalid-tool-effect-receipt');
  const errorCode=value.errorCode===null?null:turnId(value.errorCode),result=value.result===null?null:jsonPayload(value.result);
  if(phase==='terminal'){
    if(!outcome||result===null||(outcome==='completed')!==(errorCode===null))reject('invalid-tool-effect-receipt');
  }else if(outcome!==null||errorCode!==null||result!==null)reject('invalid-tool-effect-receipt');
  return {schemaVersion:1,scope:validateScope(value.scope),turnId:turnId(value.turnId),dispatchId:turnId(value.dispatchId),commandId:turnId(value.commandId),effectId:turnId(value.effectId),phase,outcome,errorCode,result,observedAt:positive(value.observedAt)};
}
function canonical(value:unknown):string{return JSON.stringify(value);}

/** A per-command SQLite ledger. Input payloads remain available while an
 * effect may need recovery and are stripped after a terminal receipt. */
export class SqlToolLedger{
  #storage:ToolLedgerStorage;#clock:()=>number;#id:()=>string;#ready:Promise<void>;
  constructor(storage:ToolLedgerStorage,clock:()=>number=Date.now,id:()=>string=()=>crypto.randomUUID()){
    if(!storage?.sql?.exec||!storage.transactionSync||!storage.sync)reject('sqlite-tool-ledger-required');
    this.#storage=storage;this.#clock=clock;this.#id=id;
    storage.transactionSync(()=>{storage.sql.exec(TOOL_LEDGER_SCHEMA.sql);storage.sql.exec('CREATE TABLE IF NOT EXISTS tool_turn_admission_closures(binding_key TEXT PRIMARY KEY,identity_json TEXT NOT NULL,closed_at INTEGER NOT NULL) STRICT;');});
    this.#ready=storage.sync();
  }
  ready(){return this.#ready;}
  #rows(sql:string,...bindings:(string|number|null)[]):Row[]{return this.#storage.sql.exec<Row>(sql,...bindings).toArray();}
  #now(){return positive(this.#clock());}
  #row(row:Row):ToolCommandRecord{
    try{
      const scope=validateScope(JSON.parse(row.scope_json as string)),status=row.status as ToolCommandStatus;
      if(!ACTIVE.has(status)&&!TERMINAL.has(status))throw Error();
      const command=row.command_json===null?null:normalizeToolCommand(JSON.parse(row.command_json as string));
      const result=row.result_json===null?null:jsonPayload(JSON.parse(row.result_json as string));
      const record:ToolCommandRecord={schemaVersion:1,scope,turnId:turnId(row.turn_id),dispatchId:turnId(row.dispatch_id),commandId:turnId(row.command_id),digest:sha(row.digest),deadlineAt:positive(row.deadline_at),operation:row.operation as ToolOperation,status,effectId:row.effect_id===null?null:turnId(row.effect_id),acceptedAt:positive(row.accepted_at),updatedAt:positive(row.updated_at),dispatchedAt:row.dispatched_at===null?null:positive(row.dispatched_at),unknownAt:row.unknown_at===null?null:positive(row.unknown_at),lastObservedAt:row.last_observed_at===null?null:positive(row.last_observed_at),finishedAt:row.finished_at===null?null:positive(row.finished_at),outcome:row.outcome as ToolCommandRecord['outcome'],errorCode:row.error_code===null?null:turnId(row.error_code),result,command};
      if(!['read','read_page','write','edit','list','search','bash'].includes(record.operation)||record.updatedAt<record.acceptedAt)throw Error();
      if(command&&(command.commandId!==record.commandId||command.turnId!==record.turnId||command.dispatchId!==record.dispatchId||command.deadlineAt!==record.deadlineAt||command.operation!==record.operation||!sameScope(command.scope,scope)))throw Error();
      if(ACTIVE.has(status)!==(command!==null)||TERMINAL.has(status)!==(record.finishedAt!==null&&record.outcome===status&&result!==null))throw Error();
      if((status==='dispatched'||status==='unknown')&&!record.effectId)throw Error();
      if(TERMINAL.has(status)&&!record.effectId&&(status!=='failed'||record.errorCode!=='tool-deadline-expired'))throw Error();
      return record;
    }catch{reject('invalid-persisted-tool-ledger');}
  }
  #get(commandId:string):Row|undefined{return this.#rows('SELECT * FROM tool_commands WHERE command_id=?',commandId)[0];}
  #referenced(ref:ToolCommandReference):Row{
    const row=this.#get(ref.commandId);if(!row)reject('tool-command-not-found');
    const record=this.#row(row);if(record.digest!==ref.digest||record.turnId!==ref.turnId||record.dispatchId!==ref.dispatchId||record.effectId!==ref.effectId||!sameScope(record.scope,ref.scope))reject('tool-command-scope-denied');return row;
  }
  #binding(value:{scope:TurnScope;turnId:string;dispatchId:string}){return canonical({scope:validateScope(value.scope),turnId:turnId(value.turnId),dispatchId:turnId(value.dispatchId)});}
  #closed(value:{scope:TurnScope;turnId:string;dispatchId:string}){return this.#rows('SELECT 1 FROM tool_turn_admission_closures WHERE binding_key=?',this.#binding(value)).length>0;}
  #settlement(identity:TurnRuntimeIdentity){
    const closure=this.#rows('SELECT identity_json,closed_at FROM tool_turn_admission_closures WHERE binding_key=?',this.#binding(identity))[0];if(closure&&closure.identity_json!==canonical(identity))reject('tool-turn-settlement-identity-conflict');
    const row=this.#rows(`SELECT count(*) AS total,coalesce(sum(status IN ('accepted','dispatched','unknown')),0) AS active,coalesce(sum(status='unknown'),0) AS unknown,coalesce(sum(status NOT IN ('completed','failed','cancelled')),0) AS pending FROM tool_commands WHERE scope_json=? AND turn_id=? AND dispatch_id=?`,canonical(identity.scope),identity.turnId,identity.dispatchId)[0]!;
    for(const key of ['total','active','unknown','pending'])if(!Number.isSafeInteger(row[key])||(row[key] as number)<0)reject('tool-turn-settlement-invalid');
    return {schemaVersion:1 as const,domain:'tool' as const,identity:structuredClone(identity),closed:!!closure,closedAt:closure?positive(closure.closed_at):null,total:row.total as number,active:row.active as number,unknown:row.unknown as number,pending:row.pending as number};
  }
  async closeTurnAdmission(value:unknown){const identity=turnRuntimeIdentity(value);await this.#ready;const result=this.#storage.transactionSync(()=>{this.#settlement(identity);this.#storage.sql.exec('INSERT OR IGNORE INTO tool_turn_admission_closures VALUES(?,?,?)',this.#binding(identity),canonical(identity),this.#now());return this.#settlement(identity);});await this.#storage.sync();return result;}
  async turnSettlement(value:unknown){const identity=turnRuntimeIdentity(value);await this.#ready;return this.#storage.transactionSync(()=>this.#settlement(identity));}
  async lookup(commandId:string):Promise<ToolCommandRecord|null>{turnId(commandId);await this.#ready;const row=this.#get(commandId);return row?structuredClone(this.#row(row)):null;}
  async accept(value:unknown):Promise<{record:ToolCommandRecord;replayed:boolean}>{
    const command=normalizeToolCommand(value),digest=await toolCommandDigest(command);await this.#ready;
    const result=this.#storage.transactionSync(()=>{
      const prior=this.#get(command.commandId);if(prior){const found=this.#row(prior);if(found.digest!==digest)reject('tool-idempotency-conflict');return {record:found,replayed:true};}
      if(this.#closed(command))reject('tool-turn-admission-closed');
      const now=this.#now();if(command.deadlineAt<=now||command.deadlineAt-now>120_000)reject('invalid-tool-deadline');
      const active=this.#rows("SELECT command_id FROM tool_commands WHERE turn_id=? AND status IN ('accepted','dispatched','unknown')",command.turnId)[0];if(active)reject('tool-turn-active-command');
      this.#storage.sql.exec("INSERT INTO tool_commands VALUES (?,?,?,?,?,?,?,?,'accepted',NULL,?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",command.commandId,command.turnId,command.dispatchId,canonical(command.scope),digest,command.deadlineAt,command.operation,canonical(command),now,now);
      this.#storage.sql.exec('INSERT INTO tool_command_intents VALUES(?,?)',command.commandId,digest);
      return {record:this.#row(this.#get(command.commandId)!),replayed:false};
    });
    await this.#storage.sync();return structuredClone(result);
  }
  async acceptIntent(value:unknown,deadlineMs=115_000):Promise<{record:ToolCommandRecord;replayed:boolean}>{
    const intent=normalizeToolCommandIntent(value),intentDigest=await toolCommandIntentDigest(intent);if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>120_000)reject('invalid-tool-deadline');await this.#ready;
    const existing=this.#get(intent.commandId);if(existing){const saved=this.#rows('SELECT intent_digest FROM tool_command_intents WHERE command_id=?',intent.commandId)[0];if(!saved||saved.intent_digest!==intentDigest)reject('tool-idempotency-conflict');return {record:structuredClone(this.#row(existing)),replayed:true};}
    const acceptedAt=this.#now();if(intent.executionDeadlineAt<=acceptedAt||intent.executionDeadlineAt-acceptedAt>600_000)reject('invalid-tool-deadline');
    const command:ToolCommand={schemaVersion:1,scope:intent.scope,turnId:intent.turnId,dispatchId:intent.dispatchId,commandId:intent.commandId,deadlineAt:Math.min(acceptedAt+deadlineMs,intent.executionDeadlineAt),operation:intent.operation,arguments:intent.arguments},digest=await toolCommandDigest(command);
    const result=this.#storage.transactionSync(()=>{
      const prior=this.#get(intent.commandId);if(prior){const saved=this.#rows('SELECT intent_digest FROM tool_command_intents WHERE command_id=?',intent.commandId)[0];if(!saved||saved.intent_digest!==intentDigest)reject('tool-idempotency-conflict');return {record:this.#row(prior),replayed:true};}
      if(this.#closed(command))reject('tool-turn-admission-closed');
      const now=this.#now();if(command.deadlineAt<=now)reject('invalid-tool-deadline');
      const active=this.#rows("SELECT command_id FROM tool_commands WHERE turn_id=? AND status IN ('accepted','dispatched','unknown')",intent.turnId)[0];if(active)reject('tool-turn-active-command');
      this.#storage.sql.exec("INSERT INTO tool_commands VALUES (?,?,?,?,?,?,?,?,'accepted',NULL,?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",command.commandId,command.turnId,command.dispatchId,canonical(command.scope),digest,command.deadlineAt,command.operation,canonical(command),now,now);
      this.#storage.sql.exec('INSERT INTO tool_command_intents VALUES(?,?)',command.commandId,intentDigest);return {record:this.#row(this.#get(command.commandId)!),replayed:false};
    });
    await this.#storage.sync();return structuredClone(result);
  }
  async dispatch(commandId:string):Promise<{authorized:boolean;observeOnly:boolean;record:ToolCommandRecord}>{
    const id=turnId(commandId),expiredDigest=await turnDigest({schemaVersion:1,kind:'pre-effect-deadline-expired',commandId:id});await this.#ready;let granted=false;
    const first=this.#storage.transactionSync(()=>{
      const row=this.#get(id);if(!row)reject('tool-command-not-found');const current=this.#row(row),now=this.#now();
      if(current.status!=='accepted')return current;
      if(this.#closed(current))return current;
      if(current.deadlineAt<=now){this.#storage.sql.exec("UPDATE tool_commands SET status='failed',updated_at=?,finished_at=?,outcome='failed',error_code='tool-deadline-expired',result_json='{}',receipt_digest=?,command_json=NULL WHERE command_id=?",now,now,expiredDigest,id);return this.#row(this.#get(id)!);}
      const effectId=turnId(this.#id());this.#storage.sql.exec("UPDATE tool_commands SET status='dispatched',effect_id=?,updated_at=?,dispatched_at=? WHERE command_id=?",effectId,now,now,id);granted=true;return this.#row(this.#get(id)!);
    });
    await this.#storage.sync();
    const final=this.#storage.transactionSync(()=>{
      const row=this.#get(id);if(!row)reject('tool-command-not-found');const current=this.#row(row),now=this.#now();
      if(granted&&current.status==='dispatched'&&current.deadlineAt<=now){this.#storage.sql.exec("UPDATE tool_commands SET status='failed',updated_at=?,finished_at=?,outcome='failed',error_code='tool-deadline-expired',result_json='{}',receipt_digest=?,command_json=NULL WHERE command_id=?",now,now,expiredDigest,id);granted=false;return this.#row(this.#get(id)!);}return current;
    });
    await this.#storage.sync();return {authorized:granted&&final.status==='dispatched',observeOnly:!granted&&(final.status==='dispatched'||final.status==='unknown'),record:structuredClone(final)};
  }
  async markUnknown(value:unknown):Promise<ToolCommandRecord>{const ref=reference(value);await this.#ready;
    const result=this.#storage.transactionSync(()=>{const row=this.#referenced(ref),current=this.#row(row);if(current.status==='dispatched'){const now=this.#now();this.#storage.sql.exec("UPDATE tool_commands SET status='unknown',updated_at=?,unknown_at=? WHERE command_id=?",now,now,ref.commandId);return this.#row(this.#get(ref.commandId)!);}if(current.status==='accepted')reject('tool-effect-not-dispatched');return current;});
    await this.#storage.sync();return structuredClone(result);
  }
  async applyEffect(value:unknown):Promise<ToolCommandRecord>{const proof=receipt(value),proofDigest=await turnDigest(proof);await this.#ready;
    const result=this.#storage.transactionSync(()=>{
      const ref:ToolCommandReference={scope:proof.scope,turnId:proof.turnId,dispatchId:proof.dispatchId,commandId:proof.commandId,digest:this.#row(this.#get(proof.commandId)??reject('tool-command-not-found')).digest,effectId:proof.effectId};
      const row=this.#referenced(ref),current=this.#row(row);
      if(TERMINAL.has(current.status)){if(row.receipt_digest!==proofDigest)reject('tool-receipt-conflict');return current;}
      if(current.status==='accepted')reject('tool-effect-not-dispatched');const now=this.#now();if(proof.observedAt>now||proof.observedAt<(current.dispatchedAt??current.acceptedAt))reject('invalid-tool-effect-time');
      if(proof.phase==='absent'||proof.phase==='unknown'){
        if(current.status==='dispatched')this.#storage.sql.exec("UPDATE tool_commands SET status='unknown',updated_at=?,unknown_at=?,last_observed_at=? WHERE command_id=?",now,now,proof.observedAt,proof.commandId);
        else this.#storage.sql.exec('UPDATE tool_commands SET updated_at=?,last_observed_at=? WHERE command_id=?',now,proof.observedAt,proof.commandId);
        return this.#row(this.#get(proof.commandId)!);
      }
      if(proof.phase==='running'){this.#storage.sql.exec('UPDATE tool_commands SET updated_at=?,last_observed_at=? WHERE command_id=?',now,proof.observedAt,proof.commandId);return this.#row(this.#get(proof.commandId)!);}
      this.#storage.sql.exec('UPDATE tool_commands SET status=?,updated_at=?,last_observed_at=?,finished_at=?,outcome=?,error_code=?,result_json=?,receipt_digest=?,command_json=NULL WHERE command_id=?',proof.outcome!,now,proof.observedAt,now,proof.outcome!,proof.errorCode,canonical(proof.result),proofDigest,proof.commandId);
      return this.#row(this.#get(proof.commandId)!);
    });
    await this.#storage.sync();return structuredClone(result);
  }
}

export function toolCommandReference(record:ToolCommandRecord):ToolCommandReference{
  if(!record.effectId)reject('tool-effect-not-dispatched');return {scope:record.scope,turnId:record.turnId,dispatchId:record.dispatchId,commandId:record.commandId,digest:record.digest,effectId:record.effectId};
}
