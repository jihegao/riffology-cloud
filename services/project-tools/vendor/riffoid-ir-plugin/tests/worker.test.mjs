import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

async function workerContext() {
  const messages = [], context = {self: {postMessage: value => messages.push(value)}, crypto: {}, TextEncoder, Uint8Array, Uint32Array, DataView,
    URL: {createObjectURL() { throw Error('unverified runtime must not execute'); }, revokeObjectURL() {}}};
  const source = await readFile(new URL('../browser/worker.js', import.meta.url), 'utf8');
  runInNewContext(source + '\nglobalThis.fallbackDigest = sha256Hex;', context);
  return {context, messages};
}

test('opaque Worker SHA-256 fallback matches known vectors and independent boundary-length digests', async () => {
  const {context} = await workerContext();
  for (const [source, expected] of [['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad']]) {
    assert.equal(context.fallbackDigest(new TextEncoder().encode(source)), expected);
  }
  for (const size of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 24317]) {
    const bytes = Uint8Array.from({length: size}, (_, i) => (i * 31 + 17) % 256);
    assert.equal(context.fallbackDigest(bytes), createHash('sha256').update(bytes).digest('hex'), String(size));
  }
  const unicode = new TextEncoder().encode('飞机 · 冻结运行时 ✈️');
  assert.equal(context.fallbackDigest(unicode), createHash('sha256').update(unicode).digest('hex'));
});

test('opaque Worker rejects a tampered frozen runtime before creating any executable Blob', async () => {
  const {context, messages} = await workerContext();
  const original = 'export function executePlan(){throw Error("not executed");}';
  await context.self.onmessage({data: {runtimeSource: original + '\n// changed', run: {toolchain: {runtimeSha256: createHash('sha256').update(original).digest('hex')}}}});
  assert.equal(messages.length, 1);
  assert.equal(messages[0].error, 'Saved browser runtime checksum mismatch');
});
