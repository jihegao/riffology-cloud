import type {TurnActor,TurnScope} from '../turn/protocol.ts';
import type {PreviewRuntime} from '../browser-preview/contract.ts';
import {workspaceAgentName} from '../workspace/protocol.ts';
interface BrowserWorkspace{
 browserPreviewView(input:{scope:TurnScope;actor:TurnActor;revisionId?:string;profileId?:PreviewRuntime['profileId']}):Promise<unknown>;
 browserPreviewPackage(input:{scope:TurnScope;actor:TurnActor;packageIdentity:string}):Promise<{bytes:Uint8Array}>;
 verifyBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}):Promise<unknown>;
 browserPreviewVerification(input:{scope:TurnScope;actor:TurnActor;key:string}):Promise<unknown>;
 browserPreviewRetry(input:{scope:TurnScope;actor:TurnActor;key:string}):Promise<unknown>;
 retryBrowserPreview(input:{scope:TurnScope;actor:TurnActor;body:unknown}):Promise<unknown>;
}
async function data(operation:()=>Promise<unknown>){const raw=await operation();try{return JSON.parse(JSON.stringify(raw));}finally{const dispose=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value:undefined;if(typeof dispose==='function')dispose.call(raw);}}
export function createGatewayBrowserPreviewServices(env:{WORKSPACE_AGENT:{getByName(name:string):BrowserWorkspace}}){
 const ws=(scope:TurnScope)=>env.WORKSPACE_AGENT.getByName(workspaceAgentName(scope.tenantId,scope.workspaceId));
 return {view:(scope:TurnScope,actor:TurnActor,revisionId?:string,profileId?:PreviewRuntime['profileId'])=>data(()=>ws(scope).browserPreviewView({scope,actor,revisionId,profileId})),
 bytes:async(scope:TurnScope,actor:TurnActor,packageIdentity:string)=>{const raw=await ws(scope).browserPreviewPackage({scope,actor,packageIdentity});try{if(!(raw.bytes instanceof Uint8Array))throw Error('browser-preview-source-unavailable');return Uint8Array.from(raw.bytes);}finally{const dispose=Object.getOwnPropertyDescriptor(raw,Symbol.dispose)?.value;if(typeof dispose==='function')dispose.call(raw);}},
 verify:(scope:TurnScope,actor:TurnActor,body:unknown)=>data(()=>ws(scope).verifyBrowserPreview({scope,actor,body})),verification:(scope:TurnScope,actor:TurnActor,key:string)=>data(()=>ws(scope).browserPreviewVerification({scope,actor,key})),retryVerification:(scope:TurnScope,actor:TurnActor,key:string)=>data(()=>ws(scope).browserPreviewRetry({scope,actor,key})),retry:(scope:TurnScope,actor:TurnActor,body:unknown)=>data(()=>ws(scope).retryBrowserPreview({scope,actor,body}))};
}
export type GatewayBrowserPreviews=ReturnType<typeof createGatewayBrowserPreviewServices>;
