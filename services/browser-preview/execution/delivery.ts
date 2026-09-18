import {browserPreviewStaticIndex} from './assets/static-index.ts';
export type StaticAssetPort={fetch(request:Request):Promise<Response>};
type StaticAsset={url:string;file:string;sha256:string;byteLength:number;contentType:string;kind:'frame'|'app';scriptSha256?:string};
function deny(status:number){return new Response('unavailable',{status,headers:{'Cache-Control':'no-store','Content-Type':'text/plain','X-Content-Type-Options':'nosniff'}});}
export async function checkedStaticAsset(request:Request,port:StaticAssetPort,asset:StaticAsset,headers:Headers):Promise<Response>{
 const source=await port.fetch(new Request(new URL('/'+asset.file,request.url),{method:'GET'}));
 if(source.status!==200||!source.body)return deny(503);
 const reader=source.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>asset.byteLength){await reader.cancel();return deny(503);}chunks.push(value);}}finally{reader.releaseLock();}
 if(size!==asset.byteLength)return deny(503);
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==asset.sha256)return deny(503);
 headers.set('Content-Type',asset.contentType);headers.set('Content-Length',String(size));headers.set('Cache-Control','public, max-age=31536000, immutable');headers.set('ETag','"'+hash+'"');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.delete('Set-Cookie');
 // Let the Workers runtime encode verified bytes for delivery. The browser still
 // validates the original decoded bytes against the frozen asset identity.
 if(asset.kind==='app'&&size>=65536){
  headers.set('Vary','Accept-Encoding');
  const gzip=request.headers.get('accept-encoding')?.split(',').some(value=>/^gzip(?:\s*;\s*q=(?:1(?:\.0+)?|0\.[0-9]*[1-9][0-9]*))?$/i.test(value.trim()));
  if(gzip){headers.set('Content-Encoding','gzip');headers.delete('Content-Length');}
 }
 return new Response(request.method==='HEAD'?null:bytes,{status:200,headers});
}
/** Only platform fixed bytes: no project/package endpoint and no request-header broker. */
export async function serveBrowserPreviewAppAsset(request:Request,port:StaticAssetPort):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/browser-preview-assets/'))return null;
 if(!['GET','HEAD'].includes(request.method)||url.search||url.hash)return deny(404);
 const asset=browserPreviewStaticIndex.assets.find(a=>a.kind==='app'&&a.url===url.pathname);
 if(!asset)return deny(404);
 return checkedStaticAsset(request,port,asset,new Headers({'Cross-Origin-Resource-Policy':'same-origin'}));
}
type DeliveryDescriptor={hostModule:{url:string;sha256:string;byteLength:number};rendererModule:{url:string;sha256:string;byteLength:number};frameDocument:{url:string;sha256:string;byteLength:number;scriptSha256:string};assetBaseUrl:string};
export function selectBrowserPreviewDelivery(index:{delivery:DeliveryDescriptor;versions:Record<string,DeliveryDescriptor>},executionOrigin:string,assetSha256?:string){const delivery=assetSha256===undefined?index.delivery:index.versions[assetSha256];if(!delivery)throw Error('browser-preview-delivery-version-unavailable');return {...delivery,executionOrigin};}
export function browserPreviewDelivery(executionOrigin:string,assetSha256?:string){return selectBrowserPreviewDelivery(browserPreviewStaticIndex,executionOrigin,assetSha256);}
export function findExecutionAsset(path:string){return browserPreviewStaticIndex.assets.find(a=>a.kind!=='app'&&a.url===path)??null;}
