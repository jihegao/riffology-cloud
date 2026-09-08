import {Sandbox} from '@cloudflare/sandbox';
import type {ServiceSandboxApi} from './native.ts';
/** A dedicated container per immutable runtime. No platform environment or
 * network is forwarded to the project process. Bind only to ServiceRuntime. */
export class ServiceSandbox extends Sandbox implements ServiceSandboxApi{
 override enableInternet=false;
 override allowedHosts:string[]=[];
 override envVars={};
 override sleepAfter='20m';
}
ServiceSandbox.outbound=async()=>new Response('service-egress-denied',{status:403});
