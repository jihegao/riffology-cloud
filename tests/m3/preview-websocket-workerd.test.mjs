import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewVerticalFixture} from './preview-vertical-fixture.mjs';
import {PREVIEW_ACCESS_COOKIE,PREVIEW_NONCE_COOKIE} from '../../services/preview/browser.ts';
// Production gateway, Workspace access/session checks and message bridge;
// Runtime is an explicit private fetch echo fixture (no container).
test('Workerd Preview WebSocket transports text/binary and closes idle access after D1 session revocation',{timeout:20000},async t=>{
 const f=await createPreviewVerticalFixture();t.after(()=>f.dispose());const control='https://app.example.test';
 const post=async(url,body,extra={})=>f.mf.dispatchFetch(url,{method:'POST',headers:{origin:control,'content-type':'application/json',...extra},body:JSON.stringify(body)});
 const opened=await post(control+`/api/workspaces/${f.scope.workspaceId}/previews`,{runId:f.runId,expectedPreviewId:null},{'idempotency-key':'ws-preview'});assert.equal(opened.status,200);const preview=await opened.json(),origin=new URL(preview.bootstrapUrl).origin;
 const bootstrap=await f.mf.dispatchFetch(preview.bootstrapUrl);assert.equal(bootstrap.status,200);await bootstrap.text();const nonceCookie=bootstrap.headers.getSetCookie().find(v=>v.startsWith(PREVIEW_NONCE_COOKIE+'=')).split(';')[0],nonce=nonceCookie.split('=')[1];
 const ticketResponse=await post(control+`/api/workspaces/${f.scope.workspaceId}/previews/${preview.previewId}/tickets`,{nonce});assert.equal(ticketResponse.status,200);const {ticket}=await ticketResponse.json();
 const exchanged=await post(origin+'/__riff/exchange',{ticket},{origin,cookie:nonceCookie});assert.equal(exchanged.status,200);await exchanged.text();const cookie=exchanged.headers.getSetCookie().find(v=>v.startsWith(PREVIEW_ACCESS_COOKIE+'=')).split(';')[0];
 const headers={upgrade:'websocket',origin,cookie,'sec-websocket-version':'13','sec-websocket-protocol':'fixture.v1, fixture.v2','sec-fetch-site':'same-origin',authorization:'browser-secret','x-platform-secret':'private','sec-websocket-key':'browser-key'};
 for(const override of [{origin:control},{cookie:''},{'sec-fetch-site':'cross-site'}]){const denied=await f.mf.dispatchFetch(origin+'/socket',{headers:{...headers,...override}});assert.ok(denied.status>=400);await denied.text();}
 assert.equal((await f.diagnostics()).wsForwards.length,0);
 const upgrade=await f.mf.dispatchFetch(origin+'/socket?channel=1',{headers});assert.equal(upgrade.status,101);assert.equal(upgrade.headers.get('sec-websocket-protocol'),'fixture.v1');const ws=upgrade.webSocket;assert.ok(ws);ws.binaryType='arraybuffer';ws.accept();t.after(()=>{try{ws.close();}catch{}});
 const next=type=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebSocket '+type+' timeout')),5000);ws.addEventListener(type,e=>{clearTimeout(timer);resolve(e);},{once:true});});
 let message=next('message');ws.send('hello');assert.equal((await message).data,'hello');message=next('message');ws.send(new Uint8Array([0,1,254,255]).buffer);assert.deepEqual(new Uint8Array((await message).data),new Uint8Array([0,1,254,255]));
 const diagnostic=await f.diagnostics();assert.equal(diagnostic.starts,1);assert.equal(diagnostic.wsForwards.length,1);assert.equal(diagnostic.wsMessages,2);assert.deepEqual(diagnostic.wsForwards[0].headers,{connection:'Upgrade',origin:'http://localhost:8080','sec-websocket-protocol':'fixture.v1, fixture.v2','sec-websocket-version':'13',upgrade:'websocket'});assert.equal(diagnostic.wsForwards[0].url,'http://localhost:8080/socket?channel=1');
 const closed=next('close');await f.revokeSession();assert.equal((await closed).code,1008);try{ws.send('after-revocation');}catch{}
 const denied=await f.mf.dispatchFetch(origin+'/socket',{headers});assert.ok(denied.status>=400);await denied.text();const after=await f.diagnostics();assert.equal(after.wsForwards.length,1);assert.equal(after.wsMessages,2);
});
