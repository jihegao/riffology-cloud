import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReuseAcceptanceArgs} from './runtime-reuse-acceptance-contract.mjs';
test('ten Turn fixture profile is explicit and immutable',()=>{const value=parseReuseAcceptanceArgs(['--run-ten-turns']);assert.equal(value.turns,10);assert.equal(value.paidCalls,false);assert.ok(Object.isFrozen(value));});
test('no count, image, native or guard bypass is accepted',()=>{for(const args of [[],['--run-ten-turns','--vertical-project'],['--turns=1'],['--run-ten-turns','--skip-pidfd'],['--run-ten-turns','--guard-ms=0']])assert.throws(()=>parseReuseAcceptanceArgs(args));});
