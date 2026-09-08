import {MODEL_CONTENT_MAX_BYTES} from '../runtime/content.ts';
import {HttpError} from './http.ts';

/** Raw canonical package bytes; invoked only after operator and draft checks.
 * No JSON parse/stringify may change the digest supplied when creating a draft. */
export async function readModelUpload(request:Request):Promise<Uint8Array>{
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')throw new HttpError('json_required',415);
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))))throw new HttpError('invalid_content_length',400);
  if(length!==null&&Number(length)>MODEL_CONTENT_MAX_BYTES)throw new HttpError('body_too_large',413);
  if(!request.body)throw new HttpError('invalid_input',400);
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new HttpError('request_timeout',408)),30_000);});
  try{
    for(let count=0;count<8192;count++){
      const chunk=await Promise.race([reader.read(),timeout]);
      if(chunk.done){
        if(size===0||(length!==null&&size!==Number(length)))throw new HttpError('invalid_input',400);
        const bytes=new Uint8Array(size);let offset=0;
        for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
      }
      size+=chunk.value.length;if(size>MODEL_CONTENT_MAX_BYTES)throw new HttpError('body_too_large',413);
      parts.push(Uint8Array.from(chunk.value));
    }
    throw new HttpError('body_too_large',413);
  }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
