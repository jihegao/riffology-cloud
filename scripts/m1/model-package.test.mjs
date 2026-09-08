import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, link, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildModelPackage } from './model-package.mjs';
import { verifyModelContent } from '../../services/runtime/content.ts';

test('builds canonical sorted manifest and protects output', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'model-package-')); await mkdir(path.join(dir, 'model')); await mkdir(path.join(dir, 'docs'));
  await writeFile(path.join(dir, 'docs', 'z.txt'), 'z'); await writeFile(path.join(dir, 'model', 'a.bin'), Buffer.from([0, 1, 255]));
  const out = path.join(dir, '..', `model-${crypto.randomUUID()}.json`); const result = await buildModelPackage(dir, out);
  const parsed = JSON.parse(await readFile(out, 'utf8')); assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'files']);
  assert.deepEqual(parsed.files.map((f) => f.path), ['docs/z.txt', 'model/a.bin']); assert.equal(result.fileCount, 2); assert.equal((await stat(out)).mode & 0o777, 0o600);
  const packageBytes=await readFile(out),verified=await verifyModelContent({modelVersionId:'version-a',modelId:'model-a',version:'1.0.0',contentRef:'models/model-a/1.0.0.json',contentSha256:result.sha256},{size:packageBytes.byteLength,arrayBuffer:async()=>packageBytes.buffer.slice(packageBytes.byteOffset,packageBytes.byteOffset+packageBytes.byteLength)});
  assert.equal(verified.receipt.fileCount,2);assert.deepEqual(verified.manifest.files.map((f)=>f.path),['docs/z.txt','model/a.bin']);
  await assert.rejects(() => buildModelPackage(dir, out), /output exists/);
});

test('rejects symlinks, hardlinks, and invalid roots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'model-package-')); await mkdir(path.join(dir, 'model')); await writeFile(path.join(dir, 'model', 'x'), 'x');
  await symlink(path.join(dir, 'model', 'x'), path.join(dir, 'model', 's')); await assert.rejects(() => buildModelPackage(dir, path.join(dir, '..', `out-${crypto.randomUUID()}.json`)), /unsupported file/);
  const dir2 = await mkdtemp(path.join(os.tmpdir(), 'model-package-')); await mkdir(path.join(dir2, 'model')); await writeFile(path.join(dir2, 'model', 'x'), 'x'); await link(path.join(dir2, 'model', 'x'), path.join(dir2, 'model', 'y')); await assert.rejects(() => buildModelPackage(dir2, path.join(dir2, '..', `out-${crypto.randomUUID()}.json`)), /hardlink/);
});

async function rejectedFixture(t, files, expected) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'model-package-rejected-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), output = path.join(root, 'output.json');
  await mkdir(source);
  for (const [name, contents] of files) {
    const target = path.join(source, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await assert.rejects(buildModelPackage(source, output), expected);
  await assert.rejects(stat(output), { code: 'ENOENT' });
}

test('rejects paths that cannot be represented in the initial USTAR archive', async (t) => {
  await rejectedFixture(t, [[`model/${'a'.repeat(101)}`, 'x']], /invalid-initial-workspace-archive/);
});

test('rejects nested platform control directories before creating an output', async (t) => {
  await rejectedFixture(t, [['model/.riffology/data.json', '{}']], /invalid-initial-workspace-archive/);
});

test('counts implied directories and platform entries toward the archive limit', async (t) => {
  // 2046 files + 2046 distinct parents + 5 public roots + README = 4098.
  // File count alone remains comfortably below the model package limit.
  await rejectedFixture(t, Array.from({ length: 2046 }, (_, i) => [`model/d${i}/x`, '']), /invalid-initial-workspace-archive/);
});

test('rejects JSON and base64 expansion above the private resolver byte limit', async (t) => {
  const content = Buffer.alloc(1024 * 1024, 65);
  await rejectedFixture(t, Array.from({ length: 6 }, (_, i) => [`model/f${i}`, content]), /serialized package too large/);
});
