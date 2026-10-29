import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, stat, chmod, writeFile} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {privateStore, originalWrite, sha} from '../../scripts/ir-publication/core/io-boundary.mjs';
import {captureWorkerResponse} from '../../scripts/ir-publication/core/worker-response-evidence.mjs';
import {BASE, PUT, WORKER} from '../../scripts/ir-publication/core/fixed-target.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve('.local/jhg46-ir-call-chain-integration-20261028/response-output');
await mkdir(output,{recursive:true});
// Every server payload below is synthetic. None reconstructs the missing 321 B.
const responseBody = Buffer.from(JSON.stringify({success:false, errors:[{
  code:10021, message:'SYNTHETIC 错误 at index.js:7:2 — PRIVATE_MARKER',
  error_chain:[{code:10021,message:'nested synthetic detail'}],
}], messages:[], result:null}) + '\n');
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextStore = async () => privateStore(join(await mkdtemp(join(output, 'case-')), 'private'));
const read = async (s, n) => JSON.parse(await readFile(join(s.directory, n), 'utf8'));
const names = s => readdir(s.directory);
const errorCode = code => error => error.code === code;
function response(body=responseBody, status=400, headers={}) {
  return new Response(body, {status,headers:{'content-type':'application/json', ...headers}});
}
function invoke(s, connection, overrides={}) {
  return originalWrite({connection, store:s, key:'worker-put', method:'PUT',path:PUT,
    body:Buffer.from('SYNTHETIC_REQUEST_SECRET'),contentType:'multipart/form-data; boundary=fixture',
    requestId,deadline:Date.now()+5000,...overrides});
}
async function noAck(s) { assert.equal((await names(s)).some(n=>n.endsWith('-ack.safe.json')),false); }

test('400 keeps exact full bytes, nested error, private correlation headers and intent binding; stops once', async()=>{
  const s=await nextStore(); let calls=0;
  await assert.rejects(invoke(s,{request:async()=>{calls++;return response(responseBody,400,{
    'content-length':String(responseBody.length),'cf-ray':'SYNTHETIC_RAY',
    'set-cookie':'MUST_NOT_CAPTURE','authorization':'MUST_NOT_CAPTURE',
  });}}),errorCode('api-http-rejected'));
  assert.equal(calls,1); await noAck(s);
  const file=join(s.directory,'worker-put-response.private.bin');
  assert.deepEqual(await readFile(file),responseBody); assert.equal((await stat(file)).mode&0o777,0o600);
  const receipt=await read(s,'worker-put-capture.safe.json');
  const intent=await readFile(join(s.directory,'worker-put-intent.safe.json'));
  assert.equal(receipt.originalIntentSha256,sha(intent)); assert.equal(receipt.bodySha256,sha(responseBody));
  assert.equal(receipt.complete,true); assert.equal(receipt.privateReadbackVerified,true);
  assert.equal(receipt.retention,'full-body'); assert.equal(receipt.status,400);
  const context=await read(s,'worker-put-response-context.private.json');
  assert.equal(context.headers['cf-ray'],'SYNTHETIC_RAY');
  assert.equal(Object.hasOwn(context.headers,'set-cookie'),false);
  for(const n of await names(s)) {
    const b=await readFile(join(s.directory,n),'utf8');
    assert.equal(b.includes('SYNTHETIC_REQUEST_SECRET'),false);
    assert.equal(b.includes('MUST_NOT_CAPTURE'),false);
    if(n.endsWith('.safe.json'))assert.equal(b.includes('PRIVATE_MARKER'),false);
  }
});

for(const [title,body,status,code] of [
  ['HTML error',Buffer.from('<html>PRIVATE_MARKER 错误</html>'),502,'api-http-rejected'],
  ['malformed JSON success',Buffer.from('{broken PRIVATE_MARKER'),200,'api-response-json'],
  ['200 success-false envelope',responseBody,200,'api-envelope-not-complete-success'],
  ['empty error body',Buffer.alloc(0),400,'api-http-rejected'],
  ['invalid UTF8 binary',Buffer.from([0xff,0xfe,0,0x80]),400,'api-http-rejected'],
])test(title+' retained before parsing or rejection',async()=>{
  const s=await nextStore(); await assert.rejects(invoke(s,{request:async()=>response(body,status)}),errorCode(code));
  assert.deepEqual(await readFile(join(s.directory,'worker-put-response.private.bin')),body);
  assert.equal((await read(s,'worker-put-capture.safe.json')).complete,true); await noAck(s);
});

test('valid success ACK follows independently verified response capture',async()=>{
  const s=await nextStore(), body=Buffer.from(JSON.stringify({success:true,result:{id:WORKER}}));
  const out=await invoke(s,{request:async()=>response(body,200)});
  assert.equal(out.result.id,WORKER);
  assert.equal((await read(s,'worker-put-ack.safe.json')).responseSha256,sha(body));
  assert.equal((await read(s,'worker-put-capture.safe.json')).privateReadbackVerified,true);
});

test('asset session JWT remains outside artifacts',async()=>{
  const s=await nextStore(), secret='SYNTHETIC_ASSET_CAPABILITY';
  await invoke(s,{request:async()=>response(JSON.stringify({success:true,result:{jwt:secret,buckets:[]}}),200)},
    {key:'asset-session',method:'POST',path:BASE+'/assets-upload-session'});
  for(const n of await names(s))assert.equal((await readFile(join(s.directory,n),'utf8')).includes(secret),false);
  assert.equal((await names(s)).some(n=>n.endsWith('.private.bin')),false);
});

test('stream read failure retains available bytes and records incomplete',async()=>{
  const s=await nextStore(); let count=0;
  const stream=new ReadableStream({pull(c){if(count++===0)c.enqueue(Buffer.from('partial'));else c.error(new Error('PRIVATE_MARKER'));}});
  await assert.rejects(invoke(s,{request:async()=>response(stream)}),errorCode('response-read-failed'));
  const r=await read(s,'worker-put-capture.safe.json');assert.equal(r.complete,false);assert.equal(r.retention,'available-prefix');
  assert.equal((await readFile(join(s.directory,'worker-put-response.private.bin'),'utf8')),'partial');await noAck(s);
});

test('declared size mismatch cannot claim complete response',async()=>{
  const s=await nextStore();await assert.rejects(invoke(s,{request:async()=>response('abc',400,{'content-length':'4'})}),errorCode('response-length-incomplete'));
  assert.equal((await read(s,'worker-put-capture.safe.json')).complete,false);await noAck(s);
});

test('body size bound retains prefix and explicitly refuses full evidence',async()=>{
  const s=await nextStore();await assert.rejects(captureWorkerResponse(response('123456'),{store:s,key:'small',requestId,intentSha256:'a'.repeat(64),maxBytes:4}),errorCode('response-body-limit'));
  const r=await read(s,'small-capture.safe.json');assert.equal(r.complete,false);assert.equal(r.retainedBytes,4);
  assert.equal(await readFile(join(s.directory,'small-response.private.bin'),'utf8'),'1234');
});

for(const fault of ['write-failure','corrupt-file','false-receipt','unsafe-permissions','context-write-failure','context-corruption'])
test('evidence '+fault+' prevents ACK and is not swallowed',async()=>{
  const original=await nextStore(), s={...original,write:async(n,b)=>{
    if(n==='worker-put-response.private.bin'&&fault==='write-failure')throw new Error('disk error');
    if(n==='worker-put-response-context.private.json'&&fault==='context-write-failure')throw new Error('disk error');
    const ref=await original.write(n,b);
    if(n==='worker-put-response-context.private.json'&&fault==='context-corruption')await writeFile(ref.file,Buffer.alloc(b.length,0));
    if(n==='worker-put-response.private.bin') {
      if(fault==='corrupt-file')await writeFile(ref.file,Buffer.alloc(b.length,0));
      if(fault==='false-receipt')ref.sha256='0'.repeat(64);
      if(fault==='unsafe-permissions')await chmod(ref.file,0o644);
    }
    return ref;
  }};
  await assert.rejects(invoke(s,{request:async()=>response(JSON.stringify({success:true,result:{id:WORKER}}),200)}),errorCode('response-evidence-persistence-failed'));
  await noAck(s);assert.equal((await read(s,'worker-put-stopped.safe.json')).code,'response-evidence-persistence-failed');
});

test('same store/key cannot send again after rejection',async()=>{
  const s=await nextStore();let calls=0;const connection={request:async()=>{calls++;return response();}};
  await assert.rejects(invoke(s,connection),errorCode('api-http-rejected'));
  await assert.rejects(invoke(s,connection),errorCode('EEXIST'));assert.equal(calls,1);
});

test('unrelated write rejected before dispatch',async()=>{
  const s=await nextStore();let calls=0;
  await assert.rejects(invoke(s,{request:async()=>{calls++;return response();}},{path:'/unapproved'}),errorCode('fixed-write-allowlist'));
  assert.equal(calls,0);assert.deepEqual(await names(s),[]);
});

test('late response after timeout cannot create ACK or retry',async()=>{
  const s=await nextStore();let resolveResponse,calls=0;
  const promise=invoke(s,{request:()=>{calls++;return new Promise(resolve=>{resolveResponse=resolve;});}},{deadline:Date.now()+80});
  await assert.rejects(promise,errorCode('hard-request-timeout'));
  assert.equal(typeof resolveResponse,'function');resolveResponse(response());
  for(let i=0;i<40&&!((await names(s)).includes('worker-put-late-response.safe.json'));i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await read(s,'worker-put-late-response.safe.json')).resumeOrReplay,false);
  assert.equal(calls,1);await noAck(s);
});
