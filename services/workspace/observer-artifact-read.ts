import {actor,scope,turnId,sameScope,type TurnScope,type TurnActor} from '../turn/protocol.ts';
import type {TurnRuntimeIdentity} from '../turn-runtime/identity.ts';
import type {ObserverCallRecord} from '../preview/observer-calls.ts';
import {observerArtifactReference} from '../preview/observer-artifact-reference.ts';
import {observerArtifactReceipt} from '../preview/observer-artifacts.ts';
import {observerRpcData} from '../preview/observer-rpc-data.ts';
import type {ObserverArtifactReadGrant} from '../preview/observer-executor-protocol.ts';

export type ObserverArtifactReadInput={scope:TurnScope;actor:TurnActor;turnId:string;commandId:string;part:'state'|'view'};
type Selection=ReturnType<typeof observerArtifactReference>;
export interface ObserverArtifactReadPorts{
 authorize(scope:TurnScope,actor:TurnActor,turnId:string):Promise<TurnRuntimeIdentity>;
 lookup(reference:{turnId:string;dispatchId:string;commandId:string}):Promise<ObserverCallRecord|null>;
 read(selection:Selection,authorize:()=>Promise<ObserverArtifactReadGrant>):Promise<{receipt:unknown;content:Uint8Array}>;
}
function data(raw:unknown,keys:string[]):Record<string,unknown>{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype||Reflect.ownKeys(raw).length!==keys.length)throw Error('observer-artifact-read-denied');
 const out:Record<string,unknown>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(raw,key);if(!d?.enumerable||!('value'in d))throw Error('observer-artifact-read-denied');out[key]=d.value;}return out;
}
export function observerArtifactReadInput(raw:unknown):ObserverArtifactReadInput{
 const v=data(raw,['scope','actor','turnId','commandId','part']);
 const s=scope(data(v.scope,['tenantId','projectId','workspaceId','workspaceGeneration'])),a=actor(data(v.actor,['userId','authVersion']));
 if(v.part!=='state'&&v.part!=='view')throw Error('observer-artifact-read-denied');
 return {scope:s,actor:a,turnId:turnId(v.turnId),commandId:turnId(v.commandId),part:v.part};
}
/** One absolute read deadline includes every ACL lookup and content check.
 * Closing this invocation also revokes retained RPC authorization callbacks. */
export async function readObserverArtifact(raw:ObserverArtifactReadInput,ports:ObserverArtifactReadPorts){
 const input=observerArtifactReadInput(raw),expiresAt=Date.now()+5000;
 let open=true,timer:ReturnType<typeof setTimeout>|undefined;
 const live=()=>{if(!open||Date.now()>=expiresAt)throw Error('observer-artifact-read-expired');};
 const select=async()=>{
  live();const identity=await ports.authorize(input.scope,input.actor,input.turnId);live();
  if(!sameScope(identity.scope,input.scope)||identity.turnId!==input.turnId||identity.generation!==input.scope.workspaceGeneration)throw Error('observer-artifact-read-denied');
  const record=await ports.lookup({turnId:input.turnId,dispatchId:identity.dispatchId,commandId:input.commandId});live();
  const selection=observerArtifactReference(record,input.part),c=selection.command;
  if(!sameScope(c.scope,input.scope)||c.sessionId!==identity.sessionId||c.turnId!==input.turnId||c.dispatchId!==identity.dispatchId||c.commandId!==input.commandId)throw Error('observer-artifact-read-denied');
  const current=await ports.authorize(input.scope,input.actor,input.turnId);live();
  if(JSON.stringify(current)!==JSON.stringify(identity))throw Error('observer-artifact-read-denied');
  return selection;
 };
 const work=async()=>{
  const selection=await select(),expected=JSON.stringify(selection);
  const authorize=async():Promise<ObserverArtifactReadGrant>=>{
   const fresh=await select();live();if(JSON.stringify(fresh)!==expected)throw Error('observer-artifact-read-denied');
   return {schemaVersion:1,purpose:'observer-artifact-read',...fresh,expiresAt};
  };
  const response=observerRpcData(await ports.read(selection,authorize));live();
  const value=data(response,['receipt','content']),receipt=observerArtifactReceipt(value.receipt);
  if(JSON.stringify(receipt)!==JSON.stringify(selection.receipt)||!(value.content instanceof Uint8Array)||value.content.byteLength!==receipt.bytes)throw Error('observer-artifact-read-denied');
  const content=Uint8Array.from(value.content);
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==receipt.sha256)throw Error('observer-artifact-read-denied');
  await authorize();live();return {receipt,content};
 };
 try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{open=false;reject(Error('observer-artifact-read-expired'));},Math.max(0,expiresAt-Date.now()));})]);}
 finally{open=false;clearTimeout(timer);}
}
