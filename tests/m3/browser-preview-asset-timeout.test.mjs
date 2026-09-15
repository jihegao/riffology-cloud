import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {browserPreviewRequest} from '../../services/web/browser-preview.js';

async function slowBody(t){
 let reads=0,completed=0;const timers=new Set();
 const server=createServer((req,res)=>{reads++;res.writeHead(200,{'content-type':'application/octet-stream'});res.write(Buffer.from([1]));const timer=setTimeout(()=>{timers.delete(timer);res.end(Buffer.from([2,3]));completed++;},200);timers.add(timer);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));});
 const api=async(path,options)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,options);return new Uint8Array(await response.arrayBuffer());};
 return {api,stats:()=>({reads,completed})};
}
const fixed='/browser-preview-assets/'+'a'.repeat(64)+'/packages/matplotlib.whl';
test('immutable fixed asset reads include a slow complete HTTP body beyond metadata budget',async t=>{
 const {api,stats}=await slowBody(t),requests=new Set();
 const bytes=await browserPreviewRequest(api,fixed,{responseType:'bytes'},requests,{requestTimeoutMs:50,assetTimeoutMs:1000});
 assert.deepEqual([...bytes],[1,2,3]);assert.deepEqual(stats(),{reads:1,completed:1});assert.equal(requests.size,0);
 await assert.rejects(browserPreviewRequest(api,'/api/workspaces/work/browser-preview',{responseType:'bytes'},requests,{requestTimeoutMs:50,assetTimeoutMs:1000}),{name:'TimeoutError'});assert.equal(requests.size,0);assert.equal(stats().reads,2,'no automatic retry');
});
test('fixed asset body still times out at its bound and scope cancellation aborts promptly',async t=>{
 const {api,stats}=await slowBody(t),requests=new Set();
 await assert.rejects(browserPreviewRequest(api,fixed,{responseType:'bytes'},requests,{requestTimeoutMs:25,assetTimeoutMs:50}),{name:'TimeoutError'});assert.equal(requests.size,0);assert.equal(stats().reads,1);
 const pending=browserPreviewRequest(api,fixed,{responseType:'bytes'},requests,{requestTimeoutMs:25,assetTimeoutMs:1000});
 for(const controller of requests)controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(requests.size,0);
});
