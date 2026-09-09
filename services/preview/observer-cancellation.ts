import {RpcTarget} from 'cloudflare:workers';
/** Ephemeral cancellation-only RPC capability. It grants no read or execution
 * authority and must never be persisted. Loss of the caller means cancellation. */
export class ObserverCancellation extends RpcTarget{
 readonly #cancelled:()=>Promise<boolean>;
 constructor(cancelled:()=>Promise<boolean>){super();this.#cancelled=cancelled;}
 async cancelled():Promise<boolean>{try{return await this.#cancelled()!==false;}catch{return true;}}
}
export interface ObserverCancellationPort{cancelled():Promise<boolean>}
