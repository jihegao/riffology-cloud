import {turnDigest} from '../turn/protocol.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {ToolCommandRecord} from './ledger.ts';

export const G5_REPAIR_FAILURE_SHA256='2d6a08027a49cd61500ee3ff8cb975d3323ea41a79642e86c60830bfb0b9d50d';
export const G5_REPAIR_SOURCE_SHA256='43a1605858655b049d28bf5bc34c6da67780d2e4a81bec32bccea8701055bc0e';
type LedgerRow={record:ToolCommandRecord;receiptSha256:string};
type EventRow={eventId:string;type:string;payload:Record<string,unknown>};
type Source={revisionId:string|null;filesSha256:string;specSha256:string};
const SHA=/^[a-f0-9]{64}$/;
const OPERATIONS=['bash','read','bash','bash','read','bash'] as const;
const NAMES=['project_bash','project_read','project_bash','project_bash','project_read','project_bash'] as const;
function fail():never{throw Error('g5-repair-fixture-authority-unconfirmed');}
function terminal(row:LedgerRow){const value=row.record.result;if(!value||row.record.status!=='completed'||row.record.outcome!=='completed'||row.record.errorCode!==null||row.record.command!==null||!row.record.effectId||!SHA.test(row.receiptSha256))fail();return value;}
function bash(value:Record<string,unknown>,exit:(value:number)=>boolean,sha256?:string,syntax=false){if(value.kind!=='bash'||!Number.isSafeInteger(value.exitCode)||!exit(Number(value.exitCode))||typeof value.stdout!=='string'||typeof value.stderr!=='string'||value.stdoutTruncated!==false||value.stderrTruncated!==false||sha256&&!value.stdout.includes(sha256)||syntax&&!value.stderr.includes('SyntaxError'))fail();}
function read(value:Record<string,unknown>,sha256:string){if(value.kind!=='read'||value.path!=='model/model.py'||value.sha256!==sha256||typeof value.content!=='string'||!Number.isSafeInteger(value.bytes))fail();}
export async function g5RepairFixtureProof(input:{identity:TurnRuntimeIdentity;records:LedgerRow[];events:EventRow[];source:Source;checkpointFilesSha256:string;requestKey:string}){
 if(input.records.length!==6||input.events.length!==6||input.source.revisionId===null||input.source.filesSha256!==input.checkpointFilesSha256||!SHA.test(input.source.filesSha256)||!SHA.test(input.source.specSha256))fail();
 const commands=[] as Array<Record<string,unknown>>,identities=new Set<string>(),byCommand=new Map(input.records.map(row=>[row.record.commandId,row]));if(byCommand.size!==6)fail();let priorFinished=0;
 for(let index=0;index<6;index++){
  const event=input.events[index]!,name=NAMES[index]!,operation=OPERATIONS[index]!;if(event.type!=='tool.completed'||event.payload.name!==name||event.payload.isError!==false||typeof event.payload.toolCallId!=='string')fail();const commandId=`cmd-${(await turnDigest({schemaVersion:1,purpose:'product-tool-command',identity:input.identity,toolCallId:event.payload.toolCallId,name})).slice(0,60)}`,row=byCommand.get(commandId);if(!row)fail();const record=row.record;
  if(record.turnId!==input.identity.turnId||record.dispatchId!==input.identity.dispatchId||JSON.stringify(record.scope)!==JSON.stringify(input.identity.scope)||record.operation!==operation||!Number.isSafeInteger(record.finishedAt)||Number(record.finishedAt)<priorFinished||record.acceptedAt<priorFinished)fail();priorFinished=Number(record.finishedAt);
  const value=terminal(row),fileSha256=index<3?G5_REPAIR_FAILURE_SHA256:G5_REPAIR_SOURCE_SHA256;if(index===0||index===3)bash(value,code=>code===0);else if(index===1||index===4)read(value,fileSha256);else if(index===2)bash(value,code=>code>0&&code<=255,fileSha256,true);else bash(value,code=>code===0,G5_REPAIR_SOURCE_SHA256);
  for(const id of [record.commandId,record.effectId,event.eventId]){if(!id||identities.has(id))fail();identities.add(id);}
  commands.push({sequence:index+1,operation,commandId:record.commandId,effectId:record.effectId,eventId:event.eventId,eventType:'tool.completed',eventIsError:false,outcome:'completed',errorCode:null,resultReceiptSha256:row.receiptSha256,fileSha256,childExitCode:index===2?value.exitCode:index===1||index===4?null:0,exception:index===2?'SyntaxError':null});
 }
 const proof={schemaVersion:1 as const,mode:'same-ordinary-user-turn-tool-sandbox-v1' as const,turnId:input.identity.turnId,toolCalls:6,commands};return {...proof,receiptSha256:await turnDigest({proof,source:input.source,requestKey:input.requestKey})};
}
