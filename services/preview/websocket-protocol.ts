/** Transport policy only: callers must separately verify current access and lease. */
import {validatedPreviewOrigin} from './browser.ts';
import {previewPath,SERVICE_HTTP_ORIGIN} from './http.ts';
type Endpoint='workspace'|'runtime'|'sandbox';
const token=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const bytes=(value:string)=>new TextEncoder().encode(value).byteLength;
function denied():never{throw Error('preview-websocket-protocol-denied');}
function protocols(headers:Headers):string[]{
 const value=headers.get('sec-websocket-protocol');if(value===null)return [];
 if(bytes(value)>256)denied();const items=value.split(',').map(item=>item.trim());
 if(items.length>8||items.some(item=>!token.test(item))||new Set(items).size!==items.length)denied();return items;
}
function upgrade(request:Request):void{
 if(request.method!=='GET'||request.body!==null||request.headers.get('upgrade')?.toLowerCase()!=='websocket')denied();
}
function path(url:URL):string{
 if(url.username||url.password||url.hash||url.pathname.startsWith('//'))denied();
 const value=previewPath(url);if(bytes(value)>8192)denied();return value;
}
export function serviceWebSocketRequest(request:Request):Request{
 upgrade(request);const target=path(new URL(request.url)),offered=protocols(request.headers);
 const headers=new Headers({upgrade:'websocket',connection:'Upgrade',origin:SERVICE_HTTP_ORIGIN,'sec-websocket-version':'13'});
 if(offered.length)headers.set('sec-websocket-protocol',offered.join(', '));
 return new Request(SERVICE_HTTP_ORIGIN+target,{method:'GET',headers,redirect:'manual'});
}
export function publicWebSocketRequest(request:Request,controlOrigin:string):Request{
 const url=new URL(request.url),origin=validatedPreviewOrigin(url.origin),control=validatedPreviewOrigin(controlOrigin);
 if(origin===control||url.username||url.password||url.hash||request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('sec-websocket-version')!=='13')denied();
 return serviceWebSocketRequest(request);
}
function endpointUrl(endpoint:Endpoint):string{
 if(!['workspace','runtime','sandbox'].includes(endpoint))denied();return `http://${endpoint}.internal/__riff/ws`;
}
export function privateWebSocketRequest(endpoint:Endpoint,input:unknown,request:Request):Request{
 const clean=serviceWebSocketRequest(request);let json:string;
 try{json=JSON.stringify(input);if(typeof json==='string')json=json.replace(/[^\x20-\x7e]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}catch{denied();}
 if(typeof json!=='string'||bytes(json)>65536)denied();
 const headers=new Headers(clean.headers);headers.set('x-riff-ws-input',json);headers.set('x-riff-ws-path',path(new URL(clean.url)));
 return new Request(endpointUrl(endpoint),{method:'GET',headers,redirect:'manual'});
}
export function readPrivateWebSocketRequest(request:Request,endpoint:Endpoint):{input:unknown;request:Request}{
 if(request.url!==endpointUrl(endpoint))denied();upgrade(request);
 const json=request.headers.get('x-riff-ws-input'),target=request.headers.get('x-riff-ws-path');
 if(json===null||bytes(json)>65536||target===null||bytes(target)>8192||!target.startsWith('/')||target.startsWith('//')||target.includes('#'))denied();
 const url=new URL(SERVICE_HTTP_ORIGIN+target);if(url.origin!==SERVICE_HTTP_ORIGIN||path(url)!==target)denied();
 let input:unknown;try{input=JSON.parse(json);}catch{denied();}
 return {input,request:serviceWebSocketRequest(new Request(url,{method:'GET',headers:request.headers}))};
}
export function selectedWebSocketProtocol(request:Request,response:Response):string|null{
 const offered=protocols(request.headers),selected=response.headers.get('sec-websocket-protocol');
 if(selected===null)return null;if(!token.test(selected)||!offered.includes(selected))denied();return selected;
}
