import { CatalogError } from '../catalog/contracts.ts';
export const JSON_REQUEST_MAX_BYTES = 8192;
export function json(value: unknown, status = 200): Response {
  return Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export function requireOrigin(request: Request, origin: string): void {
  if (request.headers.get('origin')!==origin || request.headers.get('sec-fetch-site')==='cross-site') throw new HttpError('origin_denied',403);
}
export class HttpError extends Error {
  readonly status:number;
  constructor(code:string,status:number){super(code);this.status=status;}
}
export async function readJson(request:Request,maxBytes=JSON_REQUEST_MAX_BYTES):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new HttpError('json_required',415);
  if(Number(request.headers.get('content-length'))>maxBytes)throw new HttpError('body_too_large',413);
  if(!request.body)throw new CatalogError('invalid_input');
  const reader=request.body.getReader();let bytes=0;const parts:Uint8Array[]=[];
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HttpError('request_timeout',408)),5000);});
  try{
    for(let chunks=0;chunks<1024;chunks++){
      const item=await Promise.race([reader.read(),timeout]);if(item.done){
        const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
        try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw new CatalogError('invalid_input');}
      }
      bytes+=item.value.length;if(bytes>maxBytes)throw new HttpError('body_too_large',413);parts.push(item.value);
    }
    throw new HttpError('body_too_large',413);
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
