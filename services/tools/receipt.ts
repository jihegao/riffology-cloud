import {sameScope,turnDigest,turnId} from '../turn/protocol.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {ToolCommandRecord,ToolEffectReceipt} from './ledger.ts';
import type {ToolOperation} from './protocol.ts';

const TOOL_CALL=/^[A-Za-z0-9_-]{1,128}(?:\|[A-Za-z0-9_-]{1,128})?$/;
const NAMES=new Map<string,ToolOperation>([['project_read','read'],['project_read_page','read_page'],['project_write','write'],['project_edit','edit'],['project_list','list'],['project_search','search'],['project_install_preview_adapter','write'],['project_bash','bash'],['project_set_experiment_parameters','experiment_parameters']]);
const TERMINAL=new Set(['completed','failed','cancelled']);
// Leave fixed headroom for the receipt envelope so the whole public response,
// rather than only its result member, stays below the 64 KiB transport bound.
const MAX_RESULT_BYTES=48*1024;

function checked(value:unknown,pattern:RegExp,code:string){if(typeof value!=='string'||!pattern.test(value))throw Error(code);return value;}
export function toolReceiptCallId(value:unknown){return checked(value,TOOL_CALL,'invalid-tool-receipt-call');}
export function toolReceiptName(value:unknown){const name=turnId(value);if(!NAMES.has(name))throw Error('invalid-tool-receipt-name');return name;}
export function toolReceiptOperation(name:string){return NAMES.get(toolReceiptName(name))!;}
export async function productToolCommandId(identity:TurnRuntimeIdentity,toolCallId:string,name:string){
  return `cmd-${(await turnDigest({schemaVersion:1,purpose:'product-tool-command',identity,toolCallId:toolReceiptCallId(toolCallId),name:toolReceiptName(name)})).slice(0,60)}`;
}
function boundedResult(value:Record<string,unknown>|null){
  if(value===null)return {result:null,resultOmitted:false,resultBytes:0};
  const text=JSON.stringify(value),bytes=new TextEncoder().encode(text).byteLength;
  return bytes<=MAX_RESULT_BYTES?{result:structuredClone(value),resultOmitted:false,resultBytes:bytes}:{result:null,resultOmitted:true,resultBytes:bytes};
}
function ledgerMetadata(record:ToolCommandRecord){return {status:record.status,acceptedAt:record.acceptedAt,dispatchedAt:record.dispatchedAt,unknownAt:record.unknownAt,lastObservedAt:record.lastObservedAt,finishedAt:record.finishedAt,outcome:record.outcome,errorCode:record.errorCode};}
function effectMetadata(receipt:ToolEffectReceipt){return {phase:receipt.phase,outcome:receipt.outcome,errorCode:receipt.errorCode,observedAt:receipt.observedAt};}
export function publicToolReceipt(input:{identity:TurnRuntimeIdentity;revisionId:string;toolCallId:string;name:string;commandId:string;record:ToolCommandRecord|null;effect:ToolEffectReceipt|null}){
  const {identity,record,effect}=input,revisionId=turnId(input.revisionId),name=toolReceiptName(input.name),toolCallId=toolReceiptCallId(input.toolCallId),operation=toolReceiptOperation(name);
  if(record&&(!sameScope(record.scope,identity.scope)||record.turnId!==identity.turnId||record.dispatchId!==identity.dispatchId||record.commandId!==input.commandId||record.operation!==operation))throw Error('tool-receipt-scope-denied');
  const binding={turnId:identity.turnId,revisionId,toolCallId,name,operation};
  if(!record)return {schemaVersion:1 as const,state:'not-admitted' as const,source:null,binding,ledger:null,effect:null,result:null,resultOmitted:false,resultBytes:0,usage:'unknown' as const};
  if(TERMINAL.has(record.status))return {schemaVersion:1 as const,state:'terminal' as const,source:'ledger' as const,binding,ledger:ledgerMetadata(record),effect:null,...boundedResult(record.result),usage:'unknown' as const};
  if(effect){
    if(!sameScope(effect.scope,identity.scope)||effect.turnId!==identity.turnId||effect.dispatchId!==identity.dispatchId||effect.commandId!==record.commandId||effect.effectId!==record.effectId||effect.phase!=='terminal')throw Error('tool-receipt-scope-denied');
    return {schemaVersion:1 as const,state:'terminal' as const,source:'persisted-effect' as const,binding,ledger:ledgerMetadata(record),effect:effectMetadata(effect),...boundedResult(effect.result),usage:'unknown' as const};
  }
  return {schemaVersion:1 as const,state:'unknown' as const,source:'ledger' as const,binding,ledger:ledgerMetadata(record),effect:null,result:null,resultOmitted:false,resultBytes:0,usage:'unknown' as const};
}
