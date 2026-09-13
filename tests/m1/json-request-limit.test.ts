import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson,JSON_REQUEST_MAX_BYTES,HttpError} from '../../services/gateway/http.ts';
const bytes=(value:string)=>new TextEncoder().encode(value);
function request(body:string,chunked=false){
 const encoded=bytes(body);
 const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<encoded.length;i+=257)controller.enqueue(encoded.slice(i,i+257));controller.close();}});
 return new Request('https://gateway.test/',{method:'POST',headers:{'content-type':'application/json',...(!chunked?{'content-length':String(encoded.length)}:{})},body:chunked?stream:body,duplex:'half'} as RequestInit);
}
for(const chunked of [false,true])test(`JSON request byte boundary includes envelope, UTF-8 and escaping (${chunked?'streamed':'content length'})`,async()=>{
 const overhead=bytes(JSON.stringify({message:''})).length;
 const exact='a'.repeat(JSON_REQUEST_MAX_BYTES-overhead);
 assert.deepEqual(await readJson(request(JSON.stringify({message:exact}),chunked)),{message:exact});
 for(const message of [exact+'a','界'.repeat(3000),'"'.repeat(5000)]){
  await assert.rejects(readJson(request(JSON.stringify({message}),chunked)),error=>error instanceof HttpError&&error.status===413&&error.message==='body_too_large');
 }
});
