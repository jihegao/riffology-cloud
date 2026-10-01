import assert from 'node:assert/strict';
import test from 'node:test';
import {BrowserPreviewRuntime} from './host.mjs';
test('execution origin fails closed for same origin, shared site, remote HTTP and invalid deadlines',()=>{
 const previous=globalThis.location;globalThis.location=new URL('https://app.example.com');
 try {
  const frameUrl='/runtime/'+'a'.repeat(64)+'/frame.html';
  for(const executionOrigin of ['https://app.example.com','https://execution.example.com','http://isolated.example.net'])assert.throws(()=>new BrowserPreviewRuntime({executionOrigin,frameUrl,assetLoader(){}}),/origin-invalid|dedicated-site-required/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl,assetLoader(){},timeoutMs:-1}),/timeout-invalid/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl,assetLoader(){},timeoutMs:NaN}),/timeout-invalid/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl:'https://other.example/frame.html',assetLoader(){}}),/frame-url-invalid/);
  assert.throws(()=>new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl,jsFrameUrl:'/runtime/'+'b'.repeat(64)+'/frame.html',assetLoader(){}}),/js-frame-url-invalid/);
  assert.equal(new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl,assetLoader(){}}).executionOrigin,'https://isolated.example.net');
  assert.equal(new BrowserPreviewRuntime({executionOrigin:'https://isolated.example.net',frameUrl,jsFrameUrl:'/runtime/'+'b'.repeat(64)+'/js-frame.html',assetLoader(){}}).jsFrameUrl,'https://isolated.example.net/runtime/'+'b'.repeat(64)+'/js-frame.html');
 }finally{globalThis.location=previous;}
});
