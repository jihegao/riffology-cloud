import type {ObserverCallRecord} from './observer-calls.ts';
import {normalizeObserverCommand} from './observer-protocol.ts';
import {observerArtifactReceipt} from './observer-artifacts.ts';

/** Select only a receipt committed with this completed call. Public callers
 * choose a part, never an object key or an arbitrary content receipt. */
export function observerArtifactReference(record:ObserverCallRecord|null,part:'state'|'view'){
 if((part!=='state'&&part!=='view')||!record||record.status!=='completed'||!record.result)throw Error('observer-artifact-reference-denied');
 const command=normalizeObserverCommand(record.command),result=record.result;
 if(result.schemaVersion!==1||result.operation!==command.operation||result.previewId!==command.previewId||result.runtimeGeneration!==command.scope.workspaceGeneration)throw Error('observer-artifact-reference-denied');
 const sample=result[part];
 if(!sample||typeof sample!=='object'||Array.isArray(sample))throw Error('observer-artifact-reference-denied');
 const receipt=observerArtifactReceipt(sample.artifact);
 if(receipt.kind!==(part==='state'?'state':command.operation==='screenshot'?'screenshot':'view'))throw Error('observer-artifact-reference-denied');
 return {command,receipt};
}
