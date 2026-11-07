import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readCheckedArtifact} from './read-checked-artifact.mjs';

// All ids, times, pages and content here are synthetic. No actual artifact or SDK is read.
const id = 'artifact-' + 'a'.repeat(60), other = 'artifact-' + 'b'.repeat(60);
const opaque = 'c'.repeat(64) + ':' + 'd'.repeat(64) + ':' + other;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture({badPrefix = false, wrongSha = false, missing = false,
  cycle = false, badOffset = false, receiptDrift = false, oversized = false} = {}) {
  const prefix = badPrefix ? 'synthetic-wrong-prefix\n' : 'native-artifact-probe-v1\n';
  const content = prefix + 's'.repeat(17408 - Buffer.byteLength(prefix));
  const envelope = {kind: 'read', path: 'docs/native-artifact-probe.txt', content,
    bytes: 17408, sha256: sha(Buffer.from(content))};
  const body = Buffer.from(JSON.stringify(envelope));
  assert.equal(body.length, 17567);
  assert.notEqual(sha(body), '1f1934a77952256ed99aa9cedcd923bea033cfb6239d81aa141d677faa4ab35a');
  const receipt = {schemaVersion: 1, artifactId: id, operation: 'read',
    mediaType: 'application/json', bytes: body.length,
    sha256: wrongSha ? '0'.repeat(64) : sha(body), createdAt: 1};
  const listCalls = [], readCalls = [];
  const api = {
    async listArtifacts(cursor) {
      listCalls.push(cursor);
      if (cursor === null || cycle) return {items: [{...receipt, artifactId: other}], nextCursor: opaque, version: 'e'.repeat(64)};
      assert.equal(cursor, opaque, 'pass back the server cursor unchanged');
      return {items: missing ? [] : [receipt], nextCursor: null, version: 'e'.repeat(64)};
    },
    async readArtifact(actualId, offset) {
      readCalls.push(offset); assert.equal(actualId, id);
      const end = Math.min(body.length, offset + 16384 + (oversized && offset === 0 ? 1 : 0));
      return {receipt: receiptDrift && offset ? {...receipt, createdAt: 2} : receipt,
        offset: badOffset ? offset + 1 : offset, base64: body.subarray(offset, end).toString('base64'),
        nextOffset: end === body.length ? null : end};
    }
  };
  return {api, body, receipt, listCalls, readCalls};
}

test('synthetic JSON envelope: exact cursor, two offsets, original byte SHA, parsed content prefix', async () => {
  const f = fixture(); const out = await readCheckedArtifact(f.api, id);
  assert.deepEqual(f.listCalls, [null, opaque]); assert.deepEqual(f.readCalls, [0, 16384]);
  assert.equal(f.body[0], 123); // The JSON body begins with {, not the source prefix.
  assert.equal(out.bytes, 17567); assert.equal(out.chunks, 2);
  assert.equal(out.sha256, sha(f.body)); assert.equal(out.receipt.sha256, out.sha256);
  assert.equal(out.contentPrefixVerified, true);
});
test('wrong body SHA fails after exactly the original two chunks', async () => {
  const f = fixture({wrongSha: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-body-sha256/);
  assert.deepEqual(f.readCalls, [0, 16384]);
});
test('missing actual artifact terminates at null cursor without chunk reads', async () => {
  const f = fixture({missing: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-missing/);
  assert.equal(f.listCalls.length, 2); assert.deepEqual(f.readCalls, []);
});
test('wrong original offset fails without retry', async () => {
  const f = fixture({badOffset: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-chunk-binding/);
  assert.deepEqual(f.readCalls, [0]);
});
test('valid hashed JSON with wrong envelope.content prefix fails content check', async () => {
  const f = fixture({badPrefix: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-content/);
  assert.deepEqual(f.readCalls, [0, 16384]);
});
test('changed receipt on the second original chunk fails binding', async () => {
  const f = fixture({receiptDrift: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-chunk-binding/);
  assert.deepEqual(f.readCalls, [0, 16384]);
});
test('opaque cursor cycle is bounded and no artifact read is attempted', async () => {
  const f = fixture({cycle: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-cursor-cycle/);
  assert.equal(f.listCalls.length, 2); assert.deepEqual(f.readCalls, []);
});
test('oversized chunk fails contiguous pinned chunk bound without retry', async () => {
  const f = fixture({oversized: true});
  await assert.rejects(readCheckedArtifact(f.api, id), /artifact-check-chunk-range/);
  assert.deepEqual(f.readCalls, [0]);
});
