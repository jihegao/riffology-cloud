import assert from 'node:assert/strict';
import test from 'node:test';
import {readModelUpload} from '../../services/gateway/model-upload-body.ts';
import {MODEL_CONTENT_MAX_BYTES} from '../../services/runtime/content.ts';
const request=(body:BodyInit|null,headers:Record<string,string>={})=>new Request('https://example.test/content',{method:'POST',headers:{'content-type':'application/json',...headers},body,...(body instanceof ReadableStream?{duplex:'half' as const}:{})});
test('raw upload reader preserves original bytes and supports bodies beyond metadata JSON limit',async()=>{
 const bytes=new TextEncoder().encode(' '+JSON.stringify({text:'中'.repeat(5000)})+'\n');
 assert.deepEqual(await readModelUpload(request(bytes)),bytes);
});
test('upload reader rejects invalid media, lengths and truncated bodies',async()=>{
 for(const [body,headers,status] of [[null,{},400],['{}',{'content-type':'text/plain'},415],['{}',{'content-length':'-1'},400],['{}',{'content-length':'1'},400],['{}',{'content-length':String(MODEL_CONTENT_MAX_BYTES+1)},413]] as const){
  await assert.rejects(readModelUpload(request(body,headers)),(e:any)=>e.status===status);
 }
});
test('chunked upload limit is enforced while streaming and cancels unread body',async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
 await assert.rejects(readModelUpload(request(stream)),(e:any)=>e.status===413);assert.equal(cancelled,true);
});
