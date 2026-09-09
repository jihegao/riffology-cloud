import {validatedPreviewOrigin} from './browser.ts';
import {previewPath,SERVICE_HTTP_ORIGIN} from './http.ts';

/** A detached routing policy derived from an authorized, registered target.
 * This value is not an authorization grant: callers must recheck the active
 * command, binding and Runtime lease before every request and returned result. */
export type ObserverHttpPolicy={origin:string;pagePath:string;statePath:string};
function denied():never{throw Error('observer-http-denied');}
function path(value:unknown):string{
 if(typeof value!=='string'||value.length>256||!/^\/(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/.test(value)||value.split('/').some(p=>p==='.'||p==='..'))denied();
 previewPath(new URL(SERVICE_HTTP_ORIGIN+value));return value;
}
export function observerHttpPolicy(raw:ObserverHttpPolicy):Readonly<ObserverHttpPolicy>{
 if(!raw||Object.getPrototypeOf(raw)!==Object.prototype)denied();
 const keys=['origin','pagePath','statePath'],descriptors=Object.getOwnPropertyDescriptors(raw);
 if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(k=>!descriptors[k]?.enumerable||!Object.hasOwn(descriptors[k]!,'value')))denied();
 const origin=validatedPreviewOrigin(raw.origin),url=new URL(origin);
 // Public registered Preview host shape; arbitrary IPs and control hosts are
 // never valid destinations. Actual registration remains an authority check.
 if(url.port||!/^p-[a-f0-9]{40}\.(?:[a-z0-9-]+\.)+[a-z]+$/.test(url.hostname))denied();
 const pagePath=path(raw.pagePath),statePath=path(raw.statePath);if(pagePath===statePath)denied();
 return Object.freeze({origin,pagePath,statePath});
}
function destination(raw:string,policy:ObserverHttpPolicy,internal=false):string{
 // Validate the original string before WHATWG URL can erase traversal,
 // controls, backslashes, empty query markers or credential components.
 if(typeof raw!=='string'||raw.length>1024||/[\s\\%?#]/u.test(raw))denied();
 let candidate=raw;
 if(internal&&raw.startsWith('/')){if(raw.startsWith('//'))denied();candidate=policy.origin+raw;}
 if(internal&&candidate.startsWith(SERVICE_HTTP_ORIGIN+'/'))candidate=policy.origin+candidate.slice(SERVICE_HTTP_ORIGIN.length);
 if(candidate!==policy.origin+policy.pagePath&&candidate!==policy.origin+policy.statePath)denied();
 const url=new URL(candidate);if(url.origin!==policy.origin||url.username||url.password)denied();return url.pathname;
}
/** Only a fresh, platform generated marker reaches the project. Even forged
 * observer headers from the caller are discarded along with cookies, auth,
 * conditional/range headers and arbitrary browser request metadata. */
export function observerHttpRequest(request:Pick<Request,'url'|'method'|'headers'|'body'>,rawPolicy:ObserverHttpPolicy):Request{
 const policy=observerHttpPolicy(rawPolicy);
 if(!['GET','HEAD'].includes(request.method)||request.body!==null||request.headers.has('upgrade'))denied();
 const selected=destination(request.url,policy);
 return new Request(SERVICE_HTTP_ORIGIN+selected,{method:request.method,headers:{accept:selected===policy.statePath?'application/json':'text/html','x-riff-observer':'read-only'},redirect:'manual'});
}
/** Applies response metadata restrictions only. The executor must separately
 * enforce incremental byte/request budgets, deadlines and ongoing authority.
 * Redirects are returned for a fresh authorized hop, never followed here. */
export function observerHttpResponse(response:Response,rawPolicy:ObserverHttpPolicy):Response{
 const policy=observerHttpPolicy(rawPolicy),headers=new Headers({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
 const contentType=response.headers.get('content-type');if(contentType!==null)headers.set('content-type',contentType);
 const location=response.headers.get('location');if(location!==null)headers.set('location',policy.origin+destination(location,policy,true));
 headers.set('content-security-policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin");
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
