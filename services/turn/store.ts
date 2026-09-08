import { TURN_EVENT_BYTES_LIMIT, TURN_EVENT_LIMIT, TURN_EVENT_RECEIPT_LIMIT, actor, checkpointReceipt, jsonPayload, message, positive, sameScope, scope, sha, title, turnBaseCheckpoints, turnId, type CheckpointReceipt, type TurnEvent, type TurnJournalState } from './protocol.ts';

export interface AtomicTurnStore { read():TurnJournalState|null; transact<T>(operation:(current:TurnJournalState|null)=>{state:TurnJournalState;value:T}):Promise<T> }
const KEY='m2:turn-journal';
const STATUS=new Set(['queued','running','cancelling','checkpointing','completed','failed','cancelled','interrupted']);
const OUTCOME=new Set(['completed','failed','cancelled','interrupted']);
const EVENT=new Set(['turn.queued','turn.started','turn.cancel_requested','turn.checkpointing','turn.completed','turn.failed','turn.cancelled','turn.interrupted','assistant.delta','assistant.message','tool.started','tool.updated','tool.completed','provider.status']);
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!record(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('shape');}
function maybePositive(value:unknown){if(value!==null)positive(value);}
function intentKey(value:unknown){if(typeof value!=='string'||value.length<3||value.length>512||/[\u0000-\u001f\u007f]/u.test(value))throw Error('intent');}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function maybeCheckpoint(value:unknown):CheckpointReceipt|null{return value===null?null:checkpointReceipt(value);}
function legacyEventSequences(value:unknown,turns:Record<string,unknown>[]){
  if(!Array.isArray(value))throw Error('legacy-events');
  const turnIds=new Set(turns.map(turn=>turnId(turn.id))),started=new Map<string,number>(),terminal=new Map<string,number>();
  for(const item of value){
    if(!record(item))throw Error('legacy-event');
    const id=turnId(item.turnId),sequence=positive(item.sequence);
    if(!turnIds.has(id)||typeof item.type!=='string')throw Error('legacy-event');
    if(item.type==='turn.started'){
      if(started.has(id))throw Error('legacy-started-event');
      started.set(id,sequence);
    }
    if(['turn.completed','turn.failed','turn.cancelled','turn.interrupted'].includes(item.type)){
      if(terminal.has(id))throw Error('legacy-terminal-event');
      terminal.set(id,sequence);
    }
  }
  return {started,terminal};
}
function migrate(value:unknown):unknown{
  if(!record(value)||value.schemaVersion!==1)return value;
  try{
    const state=structuredClone(value) as Record<string,unknown>;
    if(!record(state.sessions)||!record(state.turns))throw Error('legacy-shape');
    state.schemaVersion=2;state.workspaceHead=null;
    const sessionValues=Object.values(state.sessions);for(const session of sessionValues)if(!record(session))throw Error('legacy-session');
    const sessions=sessionValues as Record<string,unknown>[];for(const session of sessions)session.head=null;
    const turnValues=Object.values(state.turns);for(const turn of turnValues)if(!record(turn))throw Error('legacy-turn');
    const turns=turnValues as Record<string,unknown>[];for(const turn of turns)turn.base=null;
    // Legacy checkpoint timestamps come from a different Durable Object and
    // are not a journal ordering authority. Rebuild lineage from the local,
    // monotonic event sequence that originally committed each terminal Turn.
    const sequences=legacyEventSequences(state.events,turns);
    const saved=turns.filter(turn=>turn.persistenceOutcome==='saved'&&record(turn.checkpoint)).sort((a,b)=>{
      const left=sequences.terminal.get(turnId(a.id)),right=sequences.terminal.get(turnId(b.id));
      if(left===undefined||right===undefined)throw Error('legacy-saved-terminal');
      return left-right;
    });
    for(const turn of turns){
      if(turn.dispatchId===null)continue;
      const start=sequences.started.get(turnId(turn.id));if(start===undefined)throw Error('legacy-started-event');
      const prior=saved.filter(item=>item.id!==turn.id&&sequences.terminal.get(turnId(item.id))!<start);
      const workspace=prior.at(-1)?.checkpoint??null,session=prior.filter(item=>item.sessionId===turn.sessionId).at(-1)?.checkpoint??null;
      turn.base={workspace:structuredClone(workspace),session:structuredClone(session)};
    }
    const workspace=saved.at(-1)?.checkpoint??null;state.workspaceHead=structuredClone(workspace);
    for(const session of sessions){
      const head=saved.filter(turn=>turn.sessionId===session.id).at(-1)?.checkpoint??null;
      session.head=structuredClone(head);
    }
    return state;
  }catch{throw Error('invalid-persisted-turn-journal');}
}
function migrateV2(value:unknown):unknown{
  if(!record(value)||value.schemaVersion!==2)return value;
  try{const state=structuredClone(value) as Record<string,unknown>,events=Array.isArray(state.events)?state.events:[];if(!record(state.turns)||!record(state.eventReceipts))throw Error('legacy-shape');state.schemaVersion=3;state.oldestSequence=(events[0] as Record<string,unknown>|undefined)?.sequence ?? state.nextSequence;state.retentionBytes=events.reduce((sum,row)=>sum+new TextEncoder().encode(JSON.stringify(row)).byteLength,0);
    for(const turn of Object.values(state.turns)){if(!record(turn))throw Error('legacy-turn');const rows=events.filter(row=>record(row)&&row.turnId===turn.id) as Record<string,unknown>[];turn.startedSequence=rows.find(row=>row.type==='turn.started')?.sequence??null;turn.terminalSequence=rows.find(row=>['turn.completed','turn.failed','turn.cancelled','turn.interrupted'].includes(String(row.type)))?.sequence??null;}
    for(const [id,receipt] of Object.entries(state.eventReceipts)){if(!record(receipt))throw Error('legacy-receipt');const event=events.find(row=>record(row)&&row.eventId===id);if(!event)throw Error('legacy-receipt-event');receipt.event=structuredClone(event);}
    return state;}catch{throw Error('invalid-persisted-turn-journal');}
}
function valid(value:unknown):asserts value is TurnJournalState{
  try{
    exact(value,['schemaVersion','scope','nextSequence','oldestSequence','retentionBytes','activeTurnId','workspaceHead','sessions','turns','sessionIntents','turnIntents','eventReceipts','events']);
    if(value.schemaVersion!==3)throw Error('version');const stateScope=scope(value.scope),nextSequence=positive(value.nextSequence),oldestSequence=positive(value.oldestSequence),retentionRaw=value.retentionBytes;if(oldestSequence>nextSequence||!Number.isSafeInteger(retentionRaw)||(retentionRaw as number)<0||(retentionRaw as number)>TURN_EVENT_BYTES_LIMIT)throw Error('retention-window');const retentionBytes=retentionRaw as number;if(value.activeTurnId!==null)turnId(value.activeTurnId);const workspaceHead=maybeCheckpoint(value.workspaceHead);
    for(const name of ['sessions','turns','sessionIntents','turnIntents','eventReceipts'] as const)if(!record(value[name]))throw Error('map');if(!Array.isArray(value.events)||value.events.length>TURN_EVENT_LIMIT)throw Error('events');
    const sessions=value.sessions as TurnJournalState['sessions'],turns=value.turns as TurnJournalState['turns'],events=value.events as TurnJournalState['events'];
    for(const [id,row] of Object.entries(sessions)){
      turnId(id);exact(row,['id','scope','actorUserId','actorAuthVersion','title','createdAt','updatedAt','head']);if(row.id!==id||!sameScope(scope(row.scope),stateScope))throw Error('session-scope');turnId(row.actorUserId);positive(row.actorAuthVersion);title(row.title);positive(row.createdAt);positive(row.updatedAt);if(row.updatedAt<row.createdAt)throw Error('session-time');maybeCheckpoint(row.head);
    }
    for(const [id,row] of Object.entries(turns)){
      turnId(id);exact(row,['id','sessionId','scope','actor','requestKey','payloadSha256','message','status','createdAt','updatedAt','startedAt','finishedAt','startedSequence','terminalSequence','dispatchId','runtimeGeneration','cancelRequestedAt','base','executionOutcome','errorCode','persistenceOutcome','persistenceErrorCode','checkpoint']);
      if(row.id!==id||!sameScope(scope(row.scope),stateScope))throw Error('turn-scope');turnId(row.sessionId);const session=sessions[row.sessionId];if(!session)throw Error('turn-session');const turnActor=actor(row.actor);if(turnActor.userId!==session.actorUserId||turnActor.authVersion!==session.actorAuthVersion)throw Error('turn-actor');
      turnId(row.requestKey);sha(row.payloadSha256);message(row.message);if(typeof row.status!=='string'||!STATUS.has(row.status))throw Error('status');positive(row.createdAt);positive(row.updatedAt);maybePositive(row.startedAt);maybePositive(row.finishedAt);maybePositive(row.startedSequence);maybePositive(row.terminalSequence);if(row.updatedAt<row.createdAt||(row.startedSequence!==null&&row.terminalSequence!==null&&row.terminalSequence<=row.startedSequence))throw Error('turn-time');
      if((row.dispatchId===null)!==(row.runtimeGeneration===null)||(row.dispatchId===null)!==(row.base===null))throw Error('dispatch-pair');if(row.dispatchId!==null){turnId(row.dispatchId);if(positive(row.runtimeGeneration)!==stateScope.workspaceGeneration||row.startedAt===null||row.startedSequence===null)throw Error('dispatch');const base=turnBaseCheckpoints(row.base);if(base.initial&&!sameScope(base.initial.reference.scope,stateScope))throw Error('initial-base-scope');for(const receipt of [base.workspace,base.session])if(receipt&&receipt.committedAt>row.startedAt)throw Error('future-base');}else if(row.startedAt!==null||row.startedSequence!==null)throw Error('started');
      if(row.executionOutcome!==null&&(typeof row.executionOutcome!=='string'||!OUTCOME.has(row.executionOutcome)))throw Error('outcome');if(row.errorCode!==null)turnId(row.errorCode);if(row.persistenceOutcome!==null&&!['saved','failed'].includes(row.persistenceOutcome))throw Error('persistence');if(row.persistenceErrorCode!==null)turnId(row.persistenceErrorCode);
      if(row.checkpoint!==null)checkpointReceipt(row.checkpoint);
      const isTerminal=['completed','failed','cancelled','interrupted'].includes(row.status);
      if(isTerminal!==(row.finishedAt!==null)||isTerminal!==(row.terminalSequence!==null))throw Error('finished');if(row.status==='queued'&&(row.dispatchId!==null||row.executionOutcome!==null))throw Error('queued');if(['running','cancelling'].includes(row.status)&&row.executionOutcome!==null)throw Error('running');if(row.status==='checkpointing'&&(row.executionOutcome===null||row.persistenceOutcome!==null))throw Error('checkpointing');
      if(row.dispatchId===null&&isTerminal&&row.status!=='cancelled'){
        if(row.status!=='failed'||row.executionOutcome!=='failed'||row.errorCode!=='turn-initial-base-unavailable'||row.persistenceOutcome!==null||row.persistenceErrorCode!==null||row.checkpoint!==null||row.cancelRequestedAt!==null)throw Error('predispatch-failure');
      }
      if(row.persistenceOutcome==='saved'&&(row.checkpoint===null||row.status!==row.executionOutcome||row.persistenceErrorCode!==null))throw Error('saved');if(row.persistenceOutcome==='failed'&&(row.status!=='failed'||row.checkpoint!==null||row.persistenceErrorCode===null))throw Error('save-failed');if(row.checkpoint!==null&&row.persistenceOutcome!=='saved')throw Error('checkpoint');if(row.dispatchId!==null&&isTerminal&&row.persistenceOutcome===null)throw Error('runtime-terminal');
    }
    const saved=Object.values(turns).filter(row=>row.persistenceOutcome==='saved'&&row.checkpoint!==null);
    for(const [key,row] of Object.entries(value.sessionIntents as TurnJournalState['sessionIntents'])){intentKey(key);exact(row,['payloadSha256','sessionId']);sha(row.payloadSha256);turnId(row.sessionId);if(!sessions[row.sessionId])throw Error('session-intent');}
    for(const [key,row] of Object.entries(value.turnIntents as TurnJournalState['turnIntents'])){intentKey(key);exact(row,['payloadSha256','turnId']);sha(row.payloadSha256);turnId(row.turnId);if(!turns[row.turnId])throw Error('turn-intent');}
    const eventIds=new Set<string>(),terminalSequence=new Map<string,number>();let previous=oldestSequence-1,eventBytes=0;for(let index=0;index<events.length;index++){
      const row=events[index];exact(row,['sequence','eventId','turnId','workspaceId','runtimeGeneration','type','at','payload']);if(row.sequence!==previous+1)throw Error('sequence');previous=row.sequence;eventBytes+=new TextEncoder().encode(JSON.stringify(row)).byteLength;const eventId=turnId(row.eventId),eventTurnId=turnId(row.turnId);if(eventIds.has(eventId))throw Error('event-id');eventIds.add(eventId);if(typeof row.type!=='string'||!turns[eventTurnId]||row.workspaceId!==stateScope.workspaceId||positive(row.runtimeGeneration)!==stateScope.workspaceGeneration||!EVENT.has(row.type))throw Error('event-scope');positive(row.at);jsonPayload(row.payload);
      if(row.type==='turn.started'&&turns[eventTurnId]!.startedSequence!==row.sequence)throw Error('started-event');if(['turn.completed','turn.failed','turn.cancelled','turn.interrupted'].includes(row.type)){if(terminalSequence.has(eventTurnId)||turns[eventTurnId]!.terminalSequence!==row.sequence)throw Error('terminal-event');terminalSequence.set(eventTurnId,row.sequence);}
    }
    if(nextSequence!==previous+1||retentionBytes!==eventBytes)throw Error('next-sequence');const receiptEntries=Object.entries(value.eventReceipts as TurnJournalState['eventReceipts']);if(receiptEntries.length>TURN_EVENT_RECEIPT_LIMIT)throw Error('event-receipt-limit');for(const [id,row] of receiptEntries){turnId(id);exact(row,['payloadSha256','sequence','event']);sha(row.payloadSha256);positive(row.sequence);const savedEvent=row.event as TurnEvent;exact(savedEvent,['sequence','eventId','turnId','workspaceId','runtimeGeneration','type','at','payload']);if(savedEvent.eventId!==id||savedEvent.sequence!==row.sequence||!turns[turnId(savedEvent.turnId)]||savedEvent.workspaceId!==stateScope.workspaceId||positive(savedEvent.runtimeGeneration)!==stateScope.workspaceGeneration||typeof savedEvent.type!=='string'||!EVENT.has(savedEvent.type)||positive(savedEvent.at)<1)throw Error('event-receipt');jsonPayload(savedEvent.payload);if(row.sequence>=oldestSequence){const event=events[row.sequence-oldestSequence];if(!event||!same(event,savedEvent))throw Error('event-receipt');}}
    for(const row of Object.values(turns)){const terminal=['completed','failed','cancelled','interrupted'].includes(row.status);if(!terminal&&terminalSequence.has(row.id))throw Error('terminal-event');}
    for(const row of Object.values(turns)){for(const [sequence,type] of [[row.startedSequence,'turn.started'],[row.terminalSequence,`turn.${row.status}`]] as const)if(sequence!==null&&sequence>=oldestSequence){const savedEvent=events[sequence-oldestSequence];if(!savedEvent||savedEvent.turnId!==row.id||savedEvent.type!==type)throw Error('lineage-event');}}
    saved.sort((a,b)=>a.terminalSequence!-b.terminalSequence!);
    const matches=(receipt:CheckpointReceipt|null,sessionId?:string)=>receipt===null||saved.some(row=>(sessionId===undefined||row.sessionId===sessionId)&&same(row.checkpoint,receipt));
    if(!matches(workspaceHead)||!same(workspaceHead,saved.at(-1)?.checkpoint??null))throw Error('workspace-head');
    for(const session of Object.values(sessions)){const sessionSaved=saved.filter(row=>row.sessionId===session.id);if(!matches(session.head,session.id)||!same(session.head,sessionSaved.at(-1)?.checkpoint??null))throw Error('session-head');}
    const initialTurns=Object.values(turns).filter(row=>row.base?.initial).sort((a,b)=>a.startedSequence!-b.startedSequence!);
    const frozenInitial=initialTurns[0]?.base?.initial;
    for(const row of initialTurns)if(!same(row.base!.initial,frozenInitial))throw Error('initial-base-conflict');
    for(const row of Object.values(turns))if(row.base){
      const base=turnBaseCheckpoints(row.base),started=row.startedSequence;if(started===null)throw Error('turn-base');const prior=saved.filter(item=>item.id!==row.id&&item.terminalSequence!<started);
      if(base.initial&&prior.length)throw Error('initial-after-saved-head');
      if(frozenInitial&&initialTurns[0]!.startedSequence!<started&&!prior.length&&!base.initial)throw Error('initial-base-lost');
      if(!matches(base.workspace)||!matches(base.session,row.sessionId))throw Error('turn-base');
      if(base.workspace&&!prior.some(item=>same(item.checkpoint,base.workspace)))throw Error('turn-base');
      if(base.session&&!prior.some(item=>item.sessionId===row.sessionId&&same(item.checkpoint,base.session)))throw Error('turn-base');
    }
    const active=Object.values(turns).filter(row=>['running','cancelling','checkpointing'].includes(row.status));if(active.length>1||(active[0]?.id??null)!==value.activeTurnId)throw Error('active');
  }catch{throw Error('invalid-persisted-turn-journal');}
}
function preserveInitialBases(previous:TurnJournalState|null,next:TurnJournalState){
  if(!previous)return;
  for(const row of Object.values(previous.turns))if(row.dispatchId!==null){
    const after=next.turns[row.id];
    if(!after||!same(row.base?.initial,after.base?.initial))throw Error('invalid-persisted-turn-journal');
  }
}
/** Atomic SQLite Durable Object state. The callback is deliberately sync so no
 * external effect can run inside the transaction. sync() is the durability ack. */
export class DurableTurnStore implements AtomicTurnStore{
  #storage:DurableObjectStorage;
  constructor(storage:DurableObjectStorage){
    if(!storage||typeof storage.transactionSync!=='function'||typeof storage.sync!=='function'||!storage.kv)throw Error('sqlite-turn-storage-required');
    this.#storage=storage;
  }
  read():TurnJournalState|null{const saved=this.#storage.kv.get<unknown>(KEY);if(saved===undefined)return null;const current=migrateV2(migrate(saved));valid(current);return structuredClone(current);}
  async transact<T>(operation:(current:TurnJournalState|null)=>{state:TurnJournalState;value:T}):Promise<T>{
    const result=this.#storage.transactionSync(()=>{
      const saved=this.#storage.kv.get<unknown>(KEY),current=saved===undefined?null:migrateV2(migrate(saved));if(current!==null)valid(current);
      const output=operation(current===null?null:structuredClone(current));
      if(!output||typeof output!=='object'||output instanceof Promise)throw Error('turn-journal-operation-must-be-synchronous');
      valid(output.state);preserveInitialBases(current,output.state);const state=structuredClone(output.state),value=structuredClone(output.value);
      this.#storage.kv.put(KEY,state);return value;
    });
    await this.#storage.sync();return structuredClone(result);
  }
}
export class MemoryTurnStore implements AtomicTurnStore{
  #state:TurnJournalState|null=null;
  read(){return structuredClone(this.#state);}
  async transact<T>(operation:(current:TurnJournalState|null)=>{state:TurnJournalState;value:T}):Promise<T>{
    const output=operation(structuredClone(this.#state));valid(output.state);preserveInitialBases(this.#state,output.state);this.#state=structuredClone(output.state);return structuredClone(output.value);
  }
  snapshot(){return structuredClone(this.#state);}
}
