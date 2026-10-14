import test from 'node:test';
import assert from 'node:assert/strict';
import {multipartModules,validateEntrypoint} from '../../scripts/m1/riffoid-validation-mime.mjs';
import {cloudflareTransport,sdkReadOnlyFetch} from '../../scripts/m1/riffoid-validation-transport.mjs';
import {hashBytes} from '../../scripts/m1/riffoid-validation-evidence.mjs';
const path='/accounts/'+'a'.repeat(32)+'/workers/scripts/fixture-gateway';
function mime(parts,boundary='offline-boundary',ending='\r\n'){
  return Buffer.concat([...parts.flatMap(({name,bytes,headers,filename})=>[
    Buffer.from(`--${boundary}\r\n${headers??`Content-Disposition: form-data; name="${name}"${filename?`; filename="${name}"`:''}\r\nContent-Type: application/javascript+module`}\r\n\r\n`),bytes,Buffer.from('\r\n')
  ]),Buffer.from(`--${boundary}--${ending}`)]);
}
function input(parts,boundary='offline-boundary'){
  return {status:200,mainModule:'index.js',contentType:`multipart/form-data; boundary=${boundary}`,bytes:mime(parts,boundary)};
}
const expected=parts=>parts.map(p=>({name:p.name,bytes:p.bytes.length}));
const single=()=>[{name:'index.js',bytes:Buffer.from('export default {};\r\n')}];
test('no-filename MIME preserves non-ASCII, combining characters, invalid UTF-8 and exact line endings',()=>{
  const bytes=Buffer.concat([Buffer.from('中文🙂e\u0301\n\r\n'),Buffer.from([0,255,192,128,13,10])]),parts=[{name:'index.js',bytes}];
  const values=multipartModules(input(parts),expected(parts));assert.deepEqual(values[0].bytes,bytes);assert.equal(hashBytes(values[0].bytes),hashBytes(bytes));
  // formData converts this no-filename shape to a string and cannot preserve it.
  assert.notEqual(hashBytes(Buffer.from(bytes.toString('utf8'))),hashBytes(bytes));
});
test('filename and no-filename parts, wire order, empty module and quoted boundaries are supported',()=>{
  const parts=[{name:'helper.js',bytes:Buffer.alloc(0),filename:true},...single()],boundary="test()+_,-./:=?",raw=input(parts,boundary);raw.contentType=`multipart/form-data; boundary="${boundary}"`;
  const order=expected(parts).reverse(),values=multipartModules(raw,order);assert.deepEqual(values.map(v=>v.name),order.map(v=>v.name));assert.deepEqual(values[0].bytes,parts[1].bytes);assert.equal(values[1].bytes.length,0);
});
test('boundary-prefix lookalikes inside payload are bytes; a payload trailing CRLF is retained',()=>{
  const bytes=Buffer.from('first\r\n--offline-boundaryX\r\n--offline-boundary--suffix\nlast\r\n'),parts=[{name:'index.js',bytes}];
  assert.deepEqual(multipartModules(input(parts),expected(parts))[0].bytes,bytes);
  const raw=input(parts);raw.bytes=mime(parts,'offline-boundary','');assert.deepEqual(multipartModules(raw,expected(parts))[0].bytes,bytes);
});
test('missing, combined and duplicate authoritative entrypoints are rejected',()=>{
  for(const main of [undefined,null,'','index.js, index.js','index.js, helper.js',['index.js'],'../index.js'])assert.throws(()=>validateEntrypoint(main));
  const parts=single();for(const mainModule of [undefined,'helper.js','index.js, index.js'])assert.throws(()=>multipartModules({...input(parts),mainModule},expected(parts)));
});
test('missing, duplicate, unexpected modules and duplicate frozen descriptors fail closed',()=>{
  const parts=single(),helper={name:'helper.js',bytes:Buffer.from('helper')};
  assert.throws(()=>multipartModules(input(parts),expected([...parts,helper])),/missing frozen/);
  assert.throws(()=>multipartModules(input([...parts,...parts]),expected(parts)),/duplicate module/);
  assert.throws(()=>multipartModules(input([...parts,helper]),expected(parts)),/unexpected module/);
  assert.throws(()=>multipartModules(input(parts),expected([...parts,...parts])),/duplicate expected/);
});
test('LF-only separators, wrong/duplicate boundary, truncation and epilogues are rejected',()=>{
  const parts=single(),raw=input(parts);
  for(const bytes of [Buffer.from(raw.bytes.toString().replaceAll('\r\n','\n')),raw.bytes.subarray(0,-6),Buffer.concat([raw.bytes,Buffer.from('junk')]),Buffer.from(raw.bytes.toString().replace('--offline-boundary--','--wrong--'))])assert.throws(()=>multipartModules({...raw,bytes},expected(parts)));
  for(const contentType of ['multipart/form-data','multipart/form-data; boundary=offline-boundary; boundary=other','multipart/form-data; boundary=wrong','multipart/form-data; boundary="trailing "'])assert.throws(()=>multipartModules({...raw,contentType},expected(parts)));
});
test('part-length and frozen-length truncations, folded/duplicate headers and ambiguous disposition fail',()=>{
  const parts=single(),p=parts[0];
  for(const headers of [
    `Content-Disposition: form-data; name="index.js"\r\nContent-Length: ${p.bytes.length+1}`,
    'Content-Disposition: form-data; name="index.js"; name="index.js"',
    'Content-Disposition: form-data; name="index.js"\r\nContent-Disposition: form-data; name="index.js"',
    'Content-Disposition: form-data;\r\n name="index.js"',
    'Content-Disposition: form-data; name="index.js"\nBad: header',
    'Content-Disposition: form-data; name="index.js"; filename="other.js"',
    'Content-Disposition: form-data; name="index.js"\r\nContent-Transfer-Encoding: base64',
  ])assert.throws(()=>multipartModules(input([{...p,headers}]),expected(parts)));
  assert.throws(()=>multipartModules(input([{...p,bytes:p.bytes.subarray(0,-1)}]),expected(parts)),/length mismatch/);
});
for(const status of [301,302,303,307,308])test(`manual HTTP ${status} rejects before body read and never dispatches a followup`,async()=>{
  for(const withLocation of [false,true]){
    let calls=0,reads=0;const response=new Response('not read',{status,headers:withLocation?{location:'https://redirect.test'}:{}});response.body.getReader=()=>{reads++;throw Error('must not read redirect');};
    const t=cloudflareTransport({mode:'read-only',authorizedFetch:async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return response;}});
    await assert.rejects(()=>t.request({path}),/redirect forbidden/);assert.equal(calls,1);assert.equal(reads,0);
  }
});
test('already-followed response and 200 Location cannot be accepted as original-origin evidence',async()=>{
  for(const response of [new Response('x',{headers:{location:'https://redirect.test'}}),Object.defineProperty(new Response('x'),'redirected',{value:true})]){
    let calls=0;const t=cloudflareTransport({mode:'read-only',authorizedFetch:async()=>{calls++;return response;}});await assert.rejects(()=>t.request({path}),/redirect/);assert.equal(calls,1);
  }
});
test('missing entrypoint stays missing; combined duplicate HTTP entrypoints are rejected',async()=>{
  const headers=new Headers({'cf-entrypoint':'index.js'});headers.append('cf-entrypoint','index.js');
  await assert.rejects(()=>cloudflareTransport({mode:'read-only',authorizedFetch:async()=>new Response('x',{headers})}).request({path}),/cf-entrypoint/);
  const r=await cloudflareTransport({mode:'read-only',authorizedFetch:async()=>new Response('x')}).request({path});assert.equal(r.mainModule,null);assert.throws(()=>multipartModules(r,expected(single())),/cf-entrypoint/);
});
test('HTTP Content-Length mismatch/truncation and maximum body bound are rejected',async()=>{
  for(const length of ['4','2','3, 3','-1'])await assert.rejects(()=>cloudflareTransport({mode:'read-only',authorizedFetch:async()=>new Response('abc',{headers:{'content-length':length}})}).request({path}));
  const t=cloudflareTransport({mode:'read-only',maxBytes:2,authorizedFetch:async()=>new Response('abc')});await assert.rejects(()=>t.request({path}),/bounded/);
  const r=await cloudflareTransport({mode:'read-only',authorizedFetch:async()=>new Response('abc',{headers:{'content-length':'3'}})}).request({path});assert.equal(r.bytes.length,3);
});
test('SDK raw bridge preserves length checks and rejects redirects, without SDK retries',async()=>{
  let options;const client={get:(p,o)=>{options=o;return {asResponse:async()=>new Response('abc',{headers:{'content-length':'4'}})};}};
  const t=cloudflareTransport({mode:'read-only',authorizedFetch:sdkReadOnlyFetch(client)});await assert.rejects(()=>t.request({path}),/Content-Length mismatch/);assert.equal(options.maxRetries,0);assert.equal(options.fetchOptions.redirect,'manual');
  await assert.rejects(()=>sdkReadOnlyFetch({get:()=>({asResponse:async()=>new Response('',{status:307})})})('https://api.cloudflare.com/client/v4'+path,{method:'GET'}),/redirect/);
});
test('raw adapter blocks unestablished PUT replay policy and paid/non-control requests before dispatch',async()=>{
  let calls=0;const t=cloudflareTransport({mode:'live',authorizedFetch:async()=>{calls++;return new Response('');}});
  await assert.rejects(()=>t.request({method:'PUT',path:path+'?bindings_inherit=strict',body:Buffer.from('offline')}),/PUT replay policy/);
  await assert.rejects(()=>t.request({method:'POST',path}));await assert.rejects(()=>t.request({path:'/experiment/run'}));await assert.rejects(()=>t.request({path,body:Buffer.from('x')}));assert.equal(calls,0);
});
test('hidden bounded host GET retries do not induce an outer loop; network/429/503 failures stay rejected',async()=>{
  let caller=0,hostAttempts=0;const t=cloudflareTransport({mode:'read-only',authorizedFetch:async()=>{caller++;for(let i=0;i<4;i++){hostAttempts++;if(i===3)return new Response('ok');}}});
  const r=await t.request({path});assert.equal(r.bytes.toString(),'ok');assert.equal(caller,1);assert.equal(hostAttempts,4);assert.equal(Object.hasOwn(r,'HTTPAttempts'),false);
  for(const failure of [()=>{throw Error('network offline');},()=>new Response('rate limited',{status:429}),()=>new Response('unavailable',{status:503})]){
    let calls=0;await assert.rejects(()=>cloudflareTransport({mode:'read-only',authorizedFetch:async()=>{calls++;return failure();}}).request({path}));assert.equal(calls,1);
  }
});
test('raw response beyond deadline rejects even if the timeout callback has not run',async()=>{
  const original=Object.getOwnPropertyDescriptor(performance,'now');let clock=0,calls=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>clock});
  try{
    const t=cloudflareTransport({mode:'read-only',authorizedFetch:async()=>{calls++;clock+=16001;return new Response('late');}});
    await assert.rejects(()=>t.request({path}),/late response rejected/);assert.equal(calls,1);
  }finally{if(original)Object.defineProperty(performance,'now',original);else delete performance.now;}
});
