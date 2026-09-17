import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sha256Hex} from './sha256.mjs';
for(const bytes of [new Uint8Array(),new TextEncoder().encode('abc'),Uint8Array.from({length:55},(_,i)=>i),Uint8Array.from({length:56},(_,i)=>i),Uint8Array.from({length:5*1024*1024},(_,i)=>i%251)])test(`portable SHA-256 matches Node for ${bytes.length} bytes`,()=>assert.equal(sha256Hex(bytes),createHash('sha256').update(bytes).digest('hex')));
test('portable SHA-256 rejects non-bytes',()=>assert.throws(()=>sha256Hex('abc'),/bytes-required/));
