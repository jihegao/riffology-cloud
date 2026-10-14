import {sameScope,scope as checkedScope,turnId,type TurnActor,type TurnJournalState,type TurnScope} from '../turn/protocol.ts';
import {turnRuntimeIdentity} from '../turn-runtime/identity.ts';
import {toolReceiptCallId,toolReceiptName} from '../tools/receipt.ts';

export function workspaceToolReceiptAuthority(state:TurnJournalState,rawScope:TurnScope,actor:TurnActor,rawTurnId:string,rawRevisionId:string,rawToolCallId:string,rawName:string){
 const scope=checkedScope(rawScope),turnIdValue=turnId(rawTurnId),revisionId=turnId(rawRevisionId),toolCallId=toolReceiptCallId(rawToolCallId),name=toolReceiptName(rawName);
 if(!sameScope(state.scope,scope))throw Error('tool-receipt-not-found');const turn=state.turns[turnIdValue];
 if(!turn||turn.actor.userId!==actor.userId||turn.actor.authVersion!==actor.authVersion||!['completed','failed','cancelled','interrupted'].includes(turn.status)||turn.persistenceOutcome!=='saved'||turn.checkpoint?.revisionId!==revisionId||!turn.dispatchId||!turn.runtimeGeneration)throw Error('tool-receipt-not-found');
 const related=state.events.filter(event=>event.turnId===turnIdValue&&['tool.started','tool.updated','tool.completed'].includes(event.type)&&event.payload.toolCallId===toolCallId),completed=related.filter(event=>event.type==='tool.completed');
 if(!related.length||related.some(event=>event.payload.name!==name)||completed.length!==1)throw Error('tool-receipt-not-found');
 return {identity:turnRuntimeIdentity({scope,sessionId:turn.sessionId,turnId:turnIdValue,dispatchId:turn.dispatchId,generation:turn.runtimeGeneration}),revisionId,toolCallId,name};
}
