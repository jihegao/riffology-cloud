import assert from 'node:assert/strict';
import test from 'node:test';
import {createGoogleOAuthOutboundService} from '../../scripts/m3/google-oauth-egress.mjs';

const capability='c'.repeat(43);
test('Wrangler outbound service proxies only capability-authorized Google and formal model endpoints',async()=>{
  const calls=[],events=[],form=new URLSearchParams({grant_type:'authorization_code',code:'code-a',code_verifier:'verifier-a',redirect_uri:'https://app.example.test/api/auth/callback/google',client_id:'client-a',client_secret:'secret-a'}),handler=createGoogleOAuthOutboundService({capability,googleClientId:'client-a',googleClientSecret:'secret-a',redirectUri:'https://app.example.test/api/auth/callback/google',proxyUrl:'http://127.0.0.1:9',telemetry:event=>events.push(event),fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json({ok:true});}});
  assert.equal((await handler(new Request('https://example.com/'))).status,403);
  assert.equal((await handler(new Request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'grant_type=authorization_code'}))).status,403);
  assert.equal(events[0].event,'google-token-received');assert.equal(events[0].capabilityMatch,false);assert.equal(events[1].event,'outbound-denied');assert.equal(events[1].reason,'capability');
  const token=await handler(new Request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-riffology-oauth-egress':capability},body:form}));
  assert.equal(token.status,200);assert.equal(calls[0].url,'https://oauth2.googleapis.com/token');assert.equal(new Headers(calls[0].init.headers).has('x-riffology-oauth-egress'),false);assert.equal(calls[0].init.redirect,'manual');
  assert.equal(new Headers(calls[0].init.headers).get('content-length'),String(Buffer.byteLength(form.toString())));assert.deepEqual(events[2].fields,['client_id','client_secret','code','code_verifier','grant_type','redirect_uri']);assert.equal(events[2].bodyBytes,Buffer.byteLength(form.toString()));assert.equal(events[2].fieldEvidence.code.count,1);assert.equal(events[2].fieldEvidence.code.values[0].bytes,6);assert.equal(events[3].event,'google-token-request');assert.equal(events[4].status,200);
  const jwks=await handler(new Request('https://www.googleapis.com/oauth2/v3/certs',{headers:{'x-riffology-oauth-egress':capability}}));
  assert.equal(jwks.status,200);assert.equal(calls[1].url,'https://www.googleapis.com/oauth2/v3/certs');
  const model=await handler(new Request('https://opencode.ai/zen/go/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer model-key','x-client-request-id':'request-a','x-opencode-session':`ses_${'a'.repeat(26)}`},body:'{}'}));
  assert.equal(model.status,200);assert.equal(await model.text(),JSON.stringify({ok:true}));assert.equal(calls[2].url,'https://opencode.ai/zen/go/v1/responses');const modelHeaders=new Headers(calls[2].init.headers);assert.equal(modelHeaders.get('authorization'),'Bearer model-key');assert.equal(modelHeaders.get('x-opencode-session'),`ses_${'a'.repeat(26)}`);assert.equal(events.at(-2).event,'opencode-request-received');assert.equal(events.at(-2).sessionHeaderPresent,true);assert.equal(events.at(-1).event,'opencode-upstream-response');assert.equal(events.at(-1).status,200);
});

test('Wrangler outbound service fails closed without proxy or capability',()=>{
  assert.throws(()=>createGoogleOAuthOutboundService({capability:'short',proxyUrl:'http://127.0.0.1:9'}),/capability-required/);
  assert.throws(()=>createGoogleOAuthOutboundService({capability,proxyUrl:''}),/https-proxy-required/);
});
