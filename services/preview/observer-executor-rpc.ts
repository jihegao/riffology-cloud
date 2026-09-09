import {RpcTarget} from 'cloudflare:workers';
import type {ObserverExecutionTarget} from './observer-execution.ts';
import type {ObserverExecutorCapabilityPort} from './observer-executor-protocol.ts';
export {observerExecutorActorName,type ObserverExecutorNamespace,type ObserverExecutorCapabilityPort} from './observer-executor-protocol.ts';

/** Ephemeral authority for one durably claimed call. The Workspace callbacks
 * bind its identity and revalidate all access; no caller can choose another
 * command. Never persist or expose this object through a public endpoint. */
export class ObserverExecutorCapability extends RpcTarget implements ObserverExecutorCapabilityPort{
 readonly #ports:ObserverExecutorCapabilityPort;
 constructor(ports:ObserverExecutorCapabilityPort){super();this.#ports=ports;}
 async authorize():Promise<ObserverExecutionTarget>{return this.#ports.authorize();}
 async forward(request:Request):Promise<Response>{return this.#ports.forward(request);}
 async cancelled():Promise<boolean>{try{return await this.#ports.cancelled()!==false;}catch{return true;}}
}

export {type ObserverArtifactReadGrant,type ObserverArtifactReadCapabilityPort} from './observer-executor-protocol.ts';
import type {ObserverArtifactReadGrant,ObserverArtifactReadCapabilityPort} from './observer-executor-protocol.ts';
/** Private read authority; never persisted or exposed as a public bearer token. */
export class ObserverArtifactReadCapability extends RpcTarget implements ObserverArtifactReadCapabilityPort{
 readonly #authorize:()=>Promise<ObserverArtifactReadGrant>;
 constructor(authorize:()=>Promise<ObserverArtifactReadGrant>){super();this.#authorize=authorize;}
 async authorize():Promise<ObserverArtifactReadGrant>{return this.#authorize();}
}
