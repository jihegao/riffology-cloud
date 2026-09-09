import {observerHttpPolicy,observerHttpRequest,type ObserverHttpPolicy} from './observer-http.ts';
import {SERVICE_HTTP_ORIGIN} from './http.ts';
import {serviceRuntimeInput,type ServiceRuntimeInput} from '../run/runtime-protocol.ts';
export type ObserverRuntimeRequest={purpose:'observer';runtime:ServiceRuntimeInput;policy:ObserverHttpPolicy;deadlineAt:number};
/** Private transport descriptor, never a public bearer credential. Workspace
 * authorizes the current call; Runtime independently checks lease and fence. */
export function observerRuntimeRequest(raw:ObserverRuntimeRequest,clock=Date.now):ObserverRuntimeRequest{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)throw Error('observer-runtime-denied');
 const keys=['purpose','runtime','policy','deadlineAt'],d=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k]!,'value'))||raw.purpose!=='observer')throw Error('observer-runtime-denied');
 const runtime=serviceRuntimeInput(raw.runtime),policy=observerHttpPolicy(raw.policy),paths=runtime.spec.plan.declaration.observation,now=clock();
 if(!paths||paths.pagePath!==policy.pagePath||paths.statePath!==policy.statePath||!Number.isSafeInteger(raw.deadlineAt)||raw.deadlineAt<=now||raw.deadlineAt>now+15000||raw.deadlineAt>runtime.reference.deadlineAt)throw Error('observer-runtime-denied');
 return {purpose:'observer',runtime,policy,deadlineAt:raw.deadlineAt};
}
/** Rebase only an already fixed internal destination for the shared public
 * URL policy checker. Never normalize an arbitrary URL into an allowed one. */
export function observerRuntimePublicRequest(request:Request,rawPolicy:ObserverHttpPolicy):Request{
 const policy=observerHttpPolicy(rawPolicy),path=[policy.pagePath,policy.statePath].find(p=>request.url===SERVICE_HTTP_ORIGIN+p);
 if(path===undefined)throw Error('observer-runtime-denied');
 const clean=observerHttpRequest({url:policy.origin+path,method:request.method,headers:request.headers,body:request.body},policy);
 return new Request(policy.origin+path,{method:clean.method,headers:clean.headers,redirect:'manual',signal:request.signal});
}
