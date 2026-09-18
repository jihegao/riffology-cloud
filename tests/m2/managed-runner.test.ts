import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {managedRunner} from '../../services/turn-runtime/managed-runner.ts';

test('Managed injected runner is byte-identical to the reviewed native/browser model adapter',async()=>{
 const reviewed=await readFile(new URL('../../services/browser-preview/runtime/fixtures/run.py',import.meta.url));
 assert.deepEqual(Buffer.from(managedRunner,'utf8'),reviewed,'Regenerate the embedded runner from the reviewed adapter before accepting Managed artifacts.');
});
