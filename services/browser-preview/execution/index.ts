import {checkedStaticAsset,findExecutionAsset} from './delivery.ts';
function origin(value:string){const url=new URL(value);if(url.href!==url.origin+'/'||url.username||url.password)throw Error('invalid-execution-origin');return url;}
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
   const worker="default-src 'none'; script-src 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
   const frame=`default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'self'; frame-ancestors ${appOrigin}; base-uri 'none'; form-action 'none'`;
   return checkedStaticAsset(request,env.RUNTIME_ASSETS,asset,new Headers({'Content-Security-Policy':asset.kind==='frame'?frame:worker,'Permissions-Policy':'camera=(), microphone=(), geolocation=(), usb=()','Cross-Origin-Resource-Policy':'cross-origin'}));
  }catch{return new Response('execution delivery unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
 }
} satisfies ExportedHandler<BrowserExecutionEnv>;
