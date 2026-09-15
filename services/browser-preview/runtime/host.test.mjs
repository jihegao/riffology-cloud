import assert from 'node:assert/strict';
import test from 'node:test';
import {BrowserPreviewRuntime} from './host.mjs';
test('execution origin fails closed for same origin, shared site, remote HTTP and invalid deadlines',()=>{
 const previous=globalThis.location;globalThis.location=new URL('https://app.example.com');
 try {
  for(const executionOrigin of ['https://app.example.com','https://execution.example.com','http://isolated.example.net'])assert.throws(()=>new BrowserPreviewRuntime({executionOrigin,assetLoader(){}}),/origin-invalid|dedicated-site-required/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',assetLoader(){},timeoutMs:-1}),/timeout-invalid/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',assetLoader(){},timeoutMs:NaN}),/timeout-invalid/);
  assert.equal(new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',assetLoader(){}}).executionOrigin,'https://isolated.example.net');
 }finally{globalThis.location=previous;}
});
