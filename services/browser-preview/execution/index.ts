import {checkedStaticAsset,findExecutionAsset} from './delivery.ts';
function origin(value:string){const url=new URL(value);if(url.href!==url.origin+'/'||url.username||url.password)throw Error('invalid-execution-origin');return url;}
function cspHash(hex:string){return btoa(String.fromCharCode(...hex.match(/../g)!.map(value=>Number.parseInt(value,16))));}
function approved(env:BrowserExecutionEnv,request:Request){
 const app=origin(env.APP_ORIGIN),execution=origin(env.EXECUTION_ORIGIN),url=new URL(request.url);
 const local=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
 const localhost=env.ALLOW_LOCALHOST_HTTP==='true'&&local(app.hostname)&&local(execution.hostname);
 if(app.origin===execution.origin||url.origin!==execution.origin||!localhost&&(app.protocol!=='https:'||execution.protocol!=='https:'||app.hostname.split('.').slice(-2).join('.')===execution.hostname.split('.').slice(-2).join('.')))throw Error('unapproved-execution-site');
 return app.origin;
}
export default {
 async fetch(request:Request,env:BrowserExecutionEnv):Promise<Response>{
  try{
   const appOrigin=approved(env,request),url=new URL(request.url);
   if(!['GET','HEAD'].includes(request.method)||url.search||url.hash||request.headers.has('Authorization')||request.headers.has('Cookie'))return new Response('not found',{status:404});
   const asset=findExecutionAsset(url.pathname);if(!asset)return new Response('not found',{status:404});
   const frameDocument=/^\/runtime\/([a-f0-9]{64})\/frame\.html$/.exec(asset.url)?.[1];if(asset.kind!=='frame'||frameDocument!==asset.sha256||!('scriptSha256' in asset)||!/^[a-f0-9]{64}$/.test(asset.scriptSha256))throw Error('execution-asset-invalid');
   const frame=`default-src 'none'; script-src 'sha256-${cspHash(asset.scriptSha256)}' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src blob:; frame-ancestors ${appOrigin}; base-uri 'none'; form-action 'none'`;
   return checkedStaticAsset(request,env.RUNTIME_ASSETS,asset,new Headers({'Content-Security-Policy':frame,'Permissions-Policy':'camera=(), microphone=(), geolocation=(), usb=(), storage-access=()','Cross-Origin-Resource-Policy':'cross-origin'}));
  }catch{return new Response('execution delivery unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
 }
} satisfies ExportedHandler<BrowserExecutionEnv>;
