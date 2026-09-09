import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceWebSocketRequest,publicWebSocketRequest,privateWebSocketRequest,readPrivateWebSocketRequest,selectedWebSocketProtocol} from '../../services/preview/websocket-protocol.ts';
const origin='https://p.preview.example.test';
function request(path='/socket?x=1',headers:Record<string,string>={}){return new Request(origin+path,{headers:{upgrade:'websocket',origin,'sec-websocket-version':'13',...headers}});}
test('public/service policy fixes internal destination and strips browser and platform credentials',()=>{
 const clean=publicWebSocketRequest(request('/socket?x=1',{cookie:'private','authorization':'secret','x-riff-ws-input':'secret','sec-websocket-key':'browser-key','sec-websocket-protocol':'alpha, beta'}),'https://app.example.test');
 assert.equal(clean.url,'http://localhost:8080/socket?x=1');assert.deepEqual(Object.fromEntries(clean.headers),{connection:'Upgrade',origin:'http://localhost:8080','sec-websocket-protocol':'alpha, beta','sec-websocket-version':'13',upgrade:'websocket'});
 for(const headers of [{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'},{'sec-websocket-version':'12'},{upgrade:'h2c'}] as Record<string,string>[])assert.throws(()=>publicWebSocketRequest(request('/',headers),'https://app.example.test'));
 assert.throws(()=>publicWebSocketRequest(request(),origin));assert.throws(()=>publicWebSocketRequest(new Request('http://p.preview.example.test/',{headers:{upgrade:'websocket'}}),'https://app.example.test'));
 assert.throws(()=>serviceWebSocketRequest(new Request(origin,{method:'POST',body:'x',headers:{upgrade:'websocket'}})));
});
test('subprotocol offers are bounded unique HTTP tokens; selection must be a single offered token',()=>{
 for(const value of ['', 'a,a','a,,b','a b',Array.from({length:9},(_,i)=>'p'+i).join(','),'a'.repeat(257)])assert.throws(()=>serviceWebSocketRequest(request('/',{'sec-websocket-protocol':value})));
 const req=request('/',{'sec-websocket-protocol':'a, b'});assert.equal(selectedWebSocketProtocol(req,new Response(null,{headers:{'sec-websocket-protocol':'b'}})),'b');assert.equal(selectedWebSocketProtocol(req,new Response()),null);
 for(const value of ['a,b','c',''])assert.throws(()=>selectedWebSocketProtocol(req,new Response(null,{headers:{'sec-websocket-protocol':value}})));
});
test('private envelope round trips detached JSON with fixed endpoint and sanitized inner request',()=>{
 const input={scope:{workspaceId:'fixture'},access:'private-fixture'};
 for(const endpoint of ['workspace','runtime','sandbox'] as const){const wire=privateWebSocketRequest(endpoint,input,request());assert.equal(wire.url,`http://${endpoint}.internal/__riff/ws`);const read=readPrivateWebSocketRequest(wire,endpoint);assert.deepEqual(read.input,input);assert.notEqual(read.input,input);assert.equal(read.request.url,'http://localhost:8080/socket?x=1');assert.equal(read.request.headers.get('x-riff-ws-input'),null);assert.throws(()=>readPrivateWebSocketRequest(wire,endpoint==='workspace'?'runtime':'workspace'));}
 assert.throws(()=>privateWebSocketRequest('workspace',undefined,request()));assert.throws(()=>privateWebSocketRequest('workspace','x'.repeat(65537),request()));const cycle:any={};cycle.self=cycle;assert.throws(()=>privateWebSocketRequest('workspace',cycle,request()));
});
test('private decoding rejects invalid JSON, path rewriting, reserved paths and oversized fields',()=>{
 const wire=privateWebSocketRequest('workspace',{},request());
 for(const target of ['//evil.test/x','/\\evil.test/x','/__riff/ws','/%5f%5friff/ws','/a/../x','/%252e%252e/x','/x#fragment','x','/'+'x'.repeat(8192)]){const headers=new Headers(wire.headers);headers.set('x-riff-ws-path',target);assert.throws(()=>readPrivateWebSocketRequest(new Request(wire.url,{headers}),'workspace'),target);}
 for(const json of ['{','x'.repeat(65537)]){const headers=new Headers(wire.headers);headers.set('x-riff-ws-input',json);assert.throws(()=>readPrivateWebSocketRequest(new Request(wire.url,{headers}),'workspace'));}
 assert.throws(()=>readPrivateWebSocketRequest(new Request(wire.url+'?x=1',{headers:wire.headers}),'workspace'));
});

test('private envelopes round-trip Unicode project paths through HTTP headers',()=>{const input={entrypoint:'app/模型.py',label:'仿真😀'};const encoded=privateWebSocketRequest('runtime',input,request());assert.doesNotMatch(encoded.headers.get('x-riff-ws-input')!,/[^\x20-\x7e]/);assert.deepEqual(readPrivateWebSocketRequest(encoded,'runtime').input,input);});
