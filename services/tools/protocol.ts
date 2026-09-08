import type { TurnScope } from '../turn/protocol.ts';
import { positive, scope as validateScope, sha, turnDigest, turnId } from '../turn/protocol.ts';

export type ToolOperation='read'|'read_page'|'write'|'edit'|'list'|'search'|'bash';
export type ToolCommand={
  schemaVersion:1;
  scope:TurnScope;
  turnId:string;
  dispatchId:string;
  commandId:string;
  deadlineAt:number;
  operation:ToolOperation;
  arguments:Record<string,unknown>;
};
const OPERATIONS=new Set<ToolOperation>(['read','read_page','write','edit','list','search','bash']);
const encoder=new TextEncoder();
function plain(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-tool-arguments');
  return value as Record<string,unknown>;
}
function exact(value:Record<string,unknown>,keys:string[]):void{
  if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw Error('invalid-tool-arguments');
}
function boundedText(value:unknown,maxBytes:number,code:string,allowEmpty=false):string{
  if(typeof value!=='string'||(!allowEmpty&&!value.length)||encoder.encode(value).byteLength>maxBytes||/\u0000/u.test(value))throw Error(code);
  return value;
}
export function workspacePath(value:unknown,allowRoot=false):string{
  if(value===''&&allowRoot)return '';
  const path=boundedText(value,1024,'invalid-tool-path');
  if(path.length>512||path.normalize('NFC')!==path||path.startsWith('/')||path.endsWith('/')||path.includes('\\')||/[\u0000-\u001f\u007f]/u.test(path))throw Error('invalid-tool-path');
  const parts=path.split('/');
  if(parts.some(part=>!part||part==='.'||part==='..')||parts[0]==='.riffology')throw Error('invalid-tool-path');
  return parts.join('/');
}
function args(operation:ToolOperation,value:unknown):Record<string,unknown>{
  const input=plain(value);
  switch(operation){
    case 'read': exact(input,['path']);return {path:workspacePath(input.path)};
    case 'read_page': {
      exact(input,['path','offset','maxBytes','expectedSha256']);
      if(!Number.isSafeInteger(input.offset)||(input.offset as number)<0||(input.offset as number)>1024*1024)throw Error('invalid-tool-arguments');
      const maxBytes=positive(input.maxBytes);if(maxBytes<4||maxBytes>8192)throw Error('invalid-tool-arguments');
      const expectedSha256=input.expectedSha256===null?null:sha(input.expectedSha256);
      return {path:workspacePath(input.path),offset:input.offset as number,maxBytes,expectedSha256};
    }
    case 'write': exact(input,['path','content']);return {path:workspacePath(input.path),content:boundedText(input.content,1024*1024,'invalid-tool-content',true)};
    case 'edit': {
      exact(input,['path','oldText','newText','replaceAll']);
      if(typeof input.replaceAll!=='boolean')throw Error('invalid-tool-arguments');
      const oldText=boundedText(input.oldText,256*1024,'invalid-tool-content'),newText=boundedText(input.newText,256*1024,'invalid-tool-content',true);
      return {path:workspacePath(input.path),oldText,newText,replaceAll:input.replaceAll};
    }
    case 'list': exact(input,['path']);return {path:workspacePath(input.path,true)};
    case 'search': {
      exact(input,['path','query','maxResults']);
      const maxResults=positive(input.maxResults);if(maxResults>200)throw Error('invalid-tool-arguments');
      return {path:workspacePath(input.path,true),query:boundedText(input.query,1024,'invalid-tool-query'),maxResults};
    }
    case 'bash': {
      exact(input,['script','timeoutMs']);
      const timeoutMs=positive(input.timeoutMs);if(timeoutMs>30_000)throw Error('invalid-tool-arguments');
      const script=boundedText(input.script,16*1024,'invalid-tool-script');
      if(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(script))throw Error('invalid-tool-script');
      return {script,timeoutMs};
    }
  }
}
export function validateToolCommand(value:unknown,now=Date.now):ToolCommand{
  const command=normalizeToolCommand(value),observed=positive(now());
  if(command.deadlineAt<=observed||command.deadlineAt-observed>120_000)throw Error('invalid-tool-deadline');
  return command;
}
/** Shape-only normalization is used by the durable ledger to reconcile a
 * command whose first acknowledgement was lost after its deadline. A new
 * command still passes validateToolCommand before it can be accepted. */
export function normalizeToolCommand(value:unknown):ToolCommand{
  const input=plain(value),keys=['schemaVersion','scope','turnId','dispatchId','commandId','deadlineAt','operation','arguments'];
  exact(input,keys);if(input.schemaVersion!==1||typeof input.operation!=='string'||!OPERATIONS.has(input.operation as ToolOperation))throw Error('invalid-tool-command');
  const deadlineAt=positive(input.deadlineAt);
  const operation=input.operation as ToolOperation;
  return {schemaVersion:1,scope:validateScope(input.scope),turnId:turnId(input.turnId),dispatchId:turnId(input.dispatchId),commandId:turnId(input.commandId),deadlineAt,operation,arguments:args(operation,input.arguments)};
}
export async function toolCommandDigest(command:ToolCommand):Promise<string>{
  return turnDigest({schemaVersion:command.schemaVersion,scope:command.scope,turnId:command.turnId,dispatchId:command.dispatchId,commandId:command.commandId,deadlineAt:command.deadlineAt,operation:command.operation,arguments:command.arguments});
}
