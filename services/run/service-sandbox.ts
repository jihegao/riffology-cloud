import type {ObserverCancellationPort} from '../preview/observer-cancellation.ts';
import {forwardRunningObserver} from './observer-forward.ts';
import type {ObserverHttpPolicy} from '../preview/observer-http.ts';
import {forwardRunningService} from './http-forward.ts';
import {forwardRunningWebSocket} from './websocket-forward.ts';
import {readPrivateWebSocketRequest} from '../preview/websocket-protocol.ts';
import {Sandbox} from '@cloudflare/sandbox';
import type {ServiceSandboxApi} from './native.ts';
/** A dedicated container per immutable runtime. No platform environment or
 * network is forwarded to the project process. Bind only to ServiceRuntime. */
export class ServiceSandbox extends Sandbox implements ServiceSandboxApi{
 override enableInternet=false;
 override allowedHosts:string[]=[];
 override envVars={};
 override sleepAfter='20m';
 override async fetch(request:Request):Promise<Response>{
  try{const incoming=readPrivateWebSocketRequest(request,'sandbox'),input=incoming.input as {deadlineAt:number};if(!input||typeof input!=='object'||Object.keys(input).length!==1||!Object.hasOwn(input,'deadlineAt'))throw Error('service-ws-denied');return await forwardRunningWebSocket(this.ctx.container,incoming.request,input.deadlineAt);}
  catch{return new Response('preview unavailable',{status:403});}
 }
 async forwardHttp(request:Request,deadlineAt:number):Promise<Response>{return forwardRunningService(this.ctx.container,request,deadlineAt);}
 async forwardObserverHttp(request:Request,policy:ObserverHttpPolicy,deadlineAt:number,cancellation:ObserverCancellationPort):Promise<Response>{if(!cancellation||typeof cancellation.cancelled!=='function')throw Error('observer-cancellation-required');return forwardRunningObserver(this.ctx.container,request,policy,deadlineAt,cancellation);}
}
ServiceSandbox.outbound=async()=>new Response('service-egress-denied',{status:403});
