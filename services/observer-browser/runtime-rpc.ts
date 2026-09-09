import {RpcTarget} from 'cloudflare:workers';
import type {ObserverCommand} from '../preview/observer-protocol.ts';
import type {ObserverBrowserPayload} from '../preview/observer-execution.ts';
export interface ObserverBrowserResourcePort{fetch(request:Request):Promise<Response>;cancelled():Promise<boolean>}
export interface ObserverBrowserRuntimeNamespace{
 getByName(name:string):{
  run(command:ObserverCommand,input:{pageUrl:string;timeoutMs:number},resources:ObserverBrowserResourcePort):Promise<{stopped:true;payload:ObserverBrowserPayload}>;
  /** Persistently fence this command and confirm its browser process/context
   * and requests have exited, including delayed starts. */
  fenceAndStop(command:ObserverCommand):Promise<boolean>;
 };
}
/** One execution's resource budget remains in the Executor DO; the browser
 * receives only the ability to request already-authorized bounded resources. */
export class ObserverBrowserResources extends RpcTarget implements ObserverBrowserResourcePort{
 readonly #ports:ObserverBrowserResourcePort;
 constructor(ports:ObserverBrowserResourcePort){super();this.#ports=ports;}
 async fetch(request:Request){return this.#ports.fetch(request);}
 async cancelled(){try{return await this.#ports.cancelled()!==false;}catch{return true;}}
}
