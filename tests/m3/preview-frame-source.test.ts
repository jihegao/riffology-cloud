import test from 'node:test';
import assert from 'node:assert/strict';
import {previewFrameSource} from '../../services/gateway/preview-services.ts';

test('control frame policy defaults closed and only enables the configured independent HTTPS domain',()=>{
 const env={APP_ORIGIN:'https://app.example.test',M3_PREVIEW_ORIGIN:'https://preview.example.test'};
 assert.equal(previewFrameSource({APP_ORIGIN:env.APP_ORIGIN}),"'none'");
 // A control document opened while execution gates are closed must remain able
 // to frame the configured Preview host after an authorized release enables it.
 assert.equal(previewFrameSource({...env,M3_PREVIEW_ENABLED:'false'}),'https://*.preview.example.test');
 assert.equal(previewFrameSource({...env,M3_PREVIEW_ENABLED:'true'}),'https://*.preview.example.test');
 for(const base of ['http://preview.example.test','https://user@preview.example.test','https://preview.example.test/path','https://example.test','https://app.example.test',"https://preview.example.test;script-src *"]){
  assert.throws(()=>previewFrameSource({...env,M3_PREVIEW_ENABLED:'true',M3_PREVIEW_ORIGIN:base}));
 }
});
