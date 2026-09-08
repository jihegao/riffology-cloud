import { scope as validateScope, turnDigest, turnId, type TurnScope } from '../turn/protocol.ts';

export type TurnRuntimeIdentity={scope:TurnScope;sessionId:string;turnId:string;dispatchId:string;generation:number};

export function turnRuntimeIdentity(value:unknown):TurnRuntimeIdentity{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw Error('invalid-product-turn-runtime-identity');
  const input=value as Record<string,unknown>,keys=['scope','sessionId','turnId','dispatchId','generation'];
  if(Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))throw Error('invalid-product-turn-runtime-identity');
  const scope=validateScope(input.scope),sessionId=turnId(input.sessionId),turn=turnId(input.turnId),dispatch=turnId(input.dispatchId),generation=input.generation;
  if(!Number.isSafeInteger(generation)||(generation as number)<1||generation!==scope.workspaceGeneration)throw Error('product-turn-runtime-generation-conflict');
  return {scope,sessionId,turnId:turn,dispatchId:dispatch,generation:generation as number};
}
export function sameTurnRuntimeIdentity(a:TurnRuntimeIdentity,b:TurnRuntimeIdentity):boolean{return JSON.stringify(a)===JSON.stringify(b);}
export async function turnRuntimeActorName(value:TurnRuntimeIdentity):Promise<string>{
  const identity=turnRuntimeIdentity(value),digest=await turnDigest({schemaVersion:1,purpose:'product-turn-runtime',...identity});
  return `m2-r-${digest.slice(0,52)}`;
}
