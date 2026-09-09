import {readJson} from '../gateway/http.ts';
export const PREVIEW_ACCESS_COOKIE='__Host-riff_preview';
export const PREVIEW_NONCE_COOKIE='__Host-riff_nonce';
export interface PreviewBrowserPorts{
 exchange(ticket:string,nonce:string):Promise<{access:string;expiresAt:number}>;
}
export type PreviewBrowserConfig={controlOrigin:string;previewOrigin:string};
export function validatedPreviewOrigin(value:string){const url=new URL(value);if(url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.hostname.length>253||url.hostname.split('.').some(label=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw Error('invalid-preview-origin');return value;}
function token(value:unknown):string{if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw Error('invalid-preview-credential');return value;}
function random(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
export function previewCookie(request:Request,name:typeof PREVIEW_ACCESS_COOKIE|typeof PREVIEW_NONCE_COOKIE):string{
 const matches=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 if(matches.length!==1)throw Error('invalid-preview-cookie');return token(matches[0]!.slice(name.length+1));
}
function cookie(name:string,value:string,age:number){return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Strict`;}
function headers(){return new Headers({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-site','origin-agent-cluster':'?1'});}
/** Reserved platform routes only. Project HTTP must never handle this prefix.
 * The host router supplies an authoritative per-instance HTTPS origin. */
export async function previewBrowser(request:Request,config:PreviewBrowserConfig,ports:PreviewBrowserPorts,clock=Date.now):Promise<Response|null>{
 const control=validatedPreviewOrigin(config.controlOrigin),preview=validatedPreviewOrigin(config.previewOrigin);
 if(control===preview)throw Error('invalid-preview-origin');
 const url=new URL(request.url),h=headers();
 if(url.origin!==preview)return new Response(null,{status:403,headers:h});
 if(!url.pathname.startsWith('/__riff/'))return null;
 if(url.search)return new Response(null,{status:400,headers:h});
 if(url.pathname==='/__riff/bootstrap'&&request.method==='GET'){
  const nonce=random(),scriptNonce=random();h.set('set-cookie',cookie(PREVIEW_NONCE_COOKIE,nonce,60));
  h.set('content-type','text/html; charset=utf-8');
  h.set('content-security-policy',`default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; frame-ancestors ${control}; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin`);
  const script=`const control=${JSON.stringify(control)};let busy=false;window.addEventListener('message',async e=>{if(e.origin!==control||e.source!==parent||busy||e.data?.type!=='riffology-preview-ticket'||typeof e.data.ticket!=='string'||!/^[a-f0-9]{64}$/.test(e.data.ticket))return;busy=true;try{const r=await fetch('/__riff/exchange',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({ticket:e.data.ticket})});if(!r.ok)throw Error();location.replace('/');}catch{parent.postMessage({type:'riffology-preview-error'},control);}});parent.postMessage({type:'riffology-preview-ready',nonce:${JSON.stringify(nonce)}},control);`;
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接 Preview</title><body>正在连接预览…<script nonce="${scriptNonce}">${script}</script></body></html>`,{headers:h});
 }
 if(url.pathname==='/__riff/exchange'&&request.method==='POST'){
  if(request.headers.get('origin')!==preview||request.headers.get('sec-fetch-site')==='cross-site')return new Response(null,{status:403,headers:h});
  try{
   const nonce=previewCookie(request,PREVIEW_NONCE_COOKIE),body=await readJson(request);
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'ticket'))throw Error('invalid-preview-ticket');
   const result=await ports.exchange(token((body as {ticket:unknown}).ticket),nonce),now=clock();
   if(!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=now||result.expiresAt>now+300000)throw Error('invalid-preview-access');
   h.append('set-cookie',cookie(PREVIEW_ACCESS_COOKIE,token(result.access),Math.floor((result.expiresAt-now)/1000)));
   h.append('set-cookie',cookie(PREVIEW_NONCE_COOKIE,'',0));
   h.set('content-type','application/json');return new Response('{"ok":true}',{headers:h});
  }catch{return new Response('{"error":"preview_access_denied"}',{status:403,headers:h});}
 }
 return new Response(null,{status:404,headers:h});
}
