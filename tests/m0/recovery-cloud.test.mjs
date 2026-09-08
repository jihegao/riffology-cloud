import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventDecoder, ORIGIN, assertOrdered, parseArguments, validateDeployment } from '../../scripts/m0/recovery-cloud.mjs';

test('recovery cloud driver requires fresh exact deployment, image and scoped sources', () => {
  const sources = { sha256: 'a'.repeat(64), files: [{ path: 'runtime.ts', sha256: 'b'.repeat(64) }] };
  const imageRef = 'docker.io/jihegao/riffology-m0-trusted-proxy@sha256:' + 'c'.repeat(64), now = 1000000;
  const deployment = { verified: true, mode: 'fixture-only', origin: ORIGIN, accountId: '8b0d70250211aa10d89e20605a1c7e5e',
    scriptName: 'riffology-m0-recovery-staging', versionId: '11111111-1111-4111-8111-111111111111', bundleSha256: 'd'.repeat(64),
    imageRef, executionEnvironment: 'cloudflare-vm', verifiedAtMs: now, sourceSha256: sources.sha256, sourceFiles: sources.files };
  validateDeployment(deployment, sources, imageRef, now);
  for (const patch of [{ origin: 'https://example.com' }, { scriptName: 'other' }, { imageRef: 'latest' },
    { verifiedAtMs: now + 1 }, { verifiedAtMs: now - 900001 }, { sourceFiles: [] }, { executionEnvironment: 'local-docker-workerd' }]) {
    assert.throws(() => validateDeployment({ ...deployment, ...patch }, sources, imageRef, now));
  }
  for (const args of [[], ['--origin', ORIGIN], ['--deployment', 'file', '--run-id', 'arbitrary']]) assert.throws(() => parseArguments(args));
});

test('recovery SSE decoder retains split UTF8/CRLF frames and refuses conflicts or incomplete frames', () => {
  const event = { sequence: 1, generation: 1, kind: 'phase', phase: 'queued', reason: '中文', at: '2026-09-06T00:00:00.000Z' };
  const bytes = new TextEncoder().encode(`: observing\r\n\r\nid: 1\r\nevent: turn\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
  const decoder = new EventDecoder(); for (const byte of bytes) decoder.push(Uint8Array.of(byte)); decoder.push(new Uint8Array(), true);
  assert.deepEqual(decoder.events, [event]); assertOrdered(decoder.events);
  assert.throws(() => decoder.push(new TextEncoder().encode(`id: 1\nevent: turn\ndata: ${JSON.stringify(event)}\n\n`)));
  const incomplete = new EventDecoder(); incomplete.push(new TextEncoder().encode('id: 1\nevent: turn\n'));
  assert.throws(() => incomplete.push(new Uint8Array(), true));
  assert.throws(() => new EventDecoder().push(new Uint8Array(65537)));
});
