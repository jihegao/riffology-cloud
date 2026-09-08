import type { TurnScope } from '../turn/protocol.ts';
import { scope as validateScope, turnDigest, turnId } from '../turn/protocol.ts';

function base32(bytes:Uint8Array):string{const alphabet='abcdefghijklmnopqrstuvwxyz234567';let bits=0,value=0,result='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)result+=alphabet[(value<<(5-bits))&31];return result;}

/** Full SHA-256 material fits within the SDK's 63-character Sandbox ID limit
 * as lowercase base32. Scope and immutable dispatch identity are platform inputs. */
export async function sandboxActorIds(rawScope:TurnScope,rawTurnId:string,rawDispatchId:string):Promise<{trustedPi:string;project:string}>{
  const scope=validateScope(rawScope),turnIdValue=turnId(rawTurnId),dispatchId=turnId(rawDispatchId),hex=await turnDigest({schemaVersion:1,scope,turnId:turnIdValue,dispatchId});
  const bytes=Uint8Array.from(hex.match(/../g)!.map(pair=>Number.parseInt(pair,16))),encoded=base32(bytes);
  return {trustedPi:`m2-t-${encoded}`,project:`m2-p-${encoded}`};
}
