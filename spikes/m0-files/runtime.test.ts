import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, symlinkSync, writeFileSync, chmodSync, linkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CREATE_AND_MUTATE, EXPECTED_FINAL_FILES, EXPORT_TREE, M0_FILES_ROOT,
  M0_FILES_STAGING_ROOT, M0_RESTORE_INPUT, RESTORE_TREE_AND_VERIFY,
} from './runtime.ts';

interface Entry {
  path: string;
  kind: 'file' | 'directory';
  mode: number;
  bytes_base64?: string;
}
interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
  mode: number;
  size: number;
  sha256?: string;
}
interface Output {
  root_mode: number;
  entries: Entry[];
  tree: TreeEntry[];
  entry_count: number;
  total_bytes: number;
  operation_count: number;
  deleted_paths: string[];
  receipts: Array<{
    index: number;
    operation: string;
    completed: boolean;
    path: string;
    previous_path?: string;
    absent?: boolean;
    source_absent?: boolean;
    sha256?: string;
    size?: number;
  }>;
  restored: boolean;
  write_probe: { completed: boolean; created: boolean; renamed: boolean; deleted: boolean; sha256: string };
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'm0-files-'));
  const root = join(base, 'project');
  const staging = join(base, 'staging');
  const input = join(base, 'restore.json');
  const run = (script: string) => spawnSync('python3', ['-I', '-'], {
    input: script
      .replaceAll(M0_FILES_STAGING_ROOT, staging)
      .replaceAll(M0_FILES_ROOT, root)
      .replaceAll(M0_RESTORE_INPUT, input),
    encoding: 'utf8', timeout: 15_000, maxBuffer: 60 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? '', ENVIRONMENT: 'staging', PROTOCOL_VERSION: 'm0-v1' },
  });
  const success = (script: string): Output => {
    const result = run(script);
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
    return JSON.parse(result.stdout) as Output;
  };
  return { base, root, staging, input, run, success, close: () => rmSync(base, { recursive: true, force: true }) };
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sorted = <T extends { path: string }>(rows: T[]) => rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function expectedEntries(): Entry[] {
  return sorted([
    ...EXPECTED_FINAL_FILES.directories.map(row => ({ ...row, kind: 'directory' as const })),
    ...EXPECTED_FINAL_FILES.files.map(row => ({
      path: row.path, mode: row.mode, kind: 'file' as const,
      bytes_base64: 'content_utf8' in row ? Buffer.from(row.content_utf8).toString('base64') : row.bytes_base64,
    })),
  ]);
}

function expectedTree(entries = expectedEntries()): TreeEntry[] {
  return sorted(entries.map(entry => {
    if (entry.kind === 'directory') return { path: entry.path, kind: entry.kind, mode: entry.mode, size: 0 };
    const bytes = Buffer.from(entry.bytes_base64!, 'base64');
    return { path: entry.path, kind: entry.kind, mode: entry.mode, size: bytes.length, sha256: digest(bytes) };
  }));
}

// Observe actual bytes and metadata using Node, independently of Python's
// reported manifest and SHA256 implementation.
function actualTree(root: string): TreeEntry[] {
  const rows: TreeEntry[] = [];
  function visit(directory: string, prefix: string) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const info = lstatSync(path);
      const relative = `${prefix}${name}`;
      assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) {
        rows.push({ path: relative, kind: 'directory', mode: info.mode & 0o7777, size: 0 });
        visit(path, `${relative}/`);
      } else {
        assert.equal(info.isFile(), true);
        const bytes = readFileSync(path);
        rows.push({ path: relative, kind: 'file', mode: info.mode & 0o7777, size: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  visit(root, '');
  return sorted(rows);
}

test('20 verified filesystem mutations match independently specified bytes, hashes, modes and deleted paths', () => {
  const f = fixture();
  try {
    const created = f.success(CREATE_AND_MUTATE);
    assert.equal(created.operation_count, 20);
    assert.equal(created.receipts.length, 20);
    assert.deepEqual(created.receipts.map(row => row.index), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(created.receipts.reduce<Record<string, number>>((counts, row) => {
      assert.equal(row.completed, true);
      counts[row.operation] = (counts[row.operation] ?? 0) + 1;
      if (row.operation === 'delete') assert.equal(row.absent, true);
      else {
        assert.match(row.sha256!, /^[a-f0-9]{64}$/);
        assert.equal(typeof row.size, 'number');
      }
      if (row.operation === 'rename') assert.equal(row.source_absent, true);
      return counts;
    }, {}), { create: 9, update: 6, rename: 3, delete: 2 });
    assert.equal(created.receipts[0]!.sha256, digest(Buffer.from('# M0 files\nInitial revision.\n')));
    assert.equal(created.receipts[8]!.sha256, digest(Buffer.from(EXPECTED_FINAL_FILES.files[0].content_utf8)));
    assert.notEqual(created.receipts[0]!.sha256, created.receipts[8]!.sha256);
    assert.deepEqual(created.tree, expectedTree());
    assert.deepEqual(actualTree(f.root), expectedTree());
    assert.equal(created.root_mode, 0o755);
    assert.equal(statSync(f.root).mode & 0o7777, 0o755);
    assert.deepEqual(created.deleted_paths, EXPECTED_FINAL_FILES.deleted_paths);
    for (const path of EXPECTED_FINAL_FILES.deleted_paths) assert.equal(existsSync(join(f.root, path)), false);
    assert.deepEqual(readdirSync(join(f.root, 'empty-directory')), []);
    const exported = f.success(EXPORT_TREE);
    assert.deepEqual(exported.entries, expectedEntries());
    assert.deepEqual(exported.tree, expectedTree());
    assert.equal(exported.entry_count, 12);
    assert.equal(exported.total_bytes, expectedTree().reduce((sum, row) => sum + row.size, 0));
    assert.ok(exported.total_bytes < 64 * 1024);
    // Execute the restored executable through its actual mode and shebang.
    const executed = spawnSync(join(f.root, 'src/main.py'), [], { encoding: 'utf8', timeout: 5000 });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, 'm0 files\nrevision 2\n');
  } finally { f.close(); }
});

test('export, real directory destruction, staged restore and post-commit CRUD preserve every byte and mode', () => {
  const f = fixture();
  try {
    f.success(CREATE_AND_MUTATE);
    const exported = f.success(EXPORT_TREE);
    writeFileSync(f.input, JSON.stringify({ entries: exported.entries.toReversed() }));
    rmSync(f.root, { recursive: true });
    assert.equal(existsSync(f.root), false);
    const restored = f.success(RESTORE_TREE_AND_VERIFY);
    assert.equal(restored.restored, true);
    assert.deepEqual(restored.tree, expectedTree());
    assert.deepEqual(actualTree(f.root), expectedTree());
    assert.deepEqual(f.success(EXPORT_TREE), exported);
    assert.deepEqual(restored.write_probe, {
      completed: true, created: true, renamed: true, deleted: true,
      mode: 0o600, size: Buffer.byteLength('M0 restored filesystem is writable.\n'),
      sha256: digest(Buffer.from('M0 restored filesystem is writable.\n')),
    });
    assert.equal(existsSync(f.staging), false);
    for (const path of [...EXPECTED_FINAL_FILES.deleted_paths, '.m0-restored-write-probe', '.m0-restored-write-probe-renamed']) {
      assert.equal(existsSync(join(f.root, path)), false);
    }
  } finally { f.close(); }
});

test('create and restore accept an empty existing root but refuse a nonempty root without mutation', () => {
  const f = fixture();
  try {
    mkdirSync(f.root);
    chmodSync(f.root, 0o700);
    f.success(CREATE_AND_MUTATE);
    const before = actualTree(f.root);
    writeFileSync(f.input, JSON.stringify({ entries: expectedEntries() }));
    for (const script of [CREATE_AND_MUTATE, RESTORE_TREE_AND_VERIFY]) {
      const result = f.run(script);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /root_not_empty/);
      assert.deepEqual(actualTree(f.root), before);
      assert.equal(existsSync(f.staging), false);
    }
    rmSync(f.root, { recursive: true });
    mkdirSync(f.root);
    f.success(RESTORE_TREE_AND_VERIFY);
    assert.deepEqual(actualTree(f.root), expectedTree());
  } finally { f.close(); }
});

test('export refuses root and descendant symlinks, hardlinks, FIFOs and privileged modes', () => {
  for (const kind of ['root-symlink', 'file-symlink', 'directory-symlink', 'hardlink', 'fifo', 'suid', 'sticky-directory']) {
    const f = fixture();
    try {
      const outside = join(f.base, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'canary'), 'outside synthetic canary');
      if (kind === 'root-symlink') symlinkSync(outside, f.root);
      else {
        mkdirSync(f.root, { mode: 0o755 });
        chmodSync(f.root, 0o755);
        const destination = join(f.root, 'entry');
        if (kind === 'file-symlink') symlinkSync(join(outside, 'canary'), destination);
        if (kind === 'directory-symlink') symlinkSync(outside, destination);
        if (kind === 'hardlink') linkSync(join(outside, 'canary'), destination);
        if (kind === 'fifo') {
          const made = spawnSync('python3', ['-I', '-c', 'import os,sys; os.mkfifo(sys.argv[1])', destination]);
          assert.equal(made.status, 0);
        }
        if (kind === 'suid') { writeFileSync(destination, 'synthetic'); chmodSync(destination, 0o4644); }
        if (kind === 'sticky-directory') { mkdirSync(destination); chmodSync(destination, 0o1755); }
      }
      assert.notEqual(f.run(EXPORT_TREE).status, 0, kind);
      assert.equal(readFileSync(join(outside, 'canary'), 'utf8'), 'outside synthetic canary');
    } finally { f.close(); }
  }
});

test('invalid restore JSON is rejected before creating any logical tree or staging directory', () => {
  const file = { path: 'file', kind: 'file', mode: 0o644, bytes_base64: 'eA==' };
  const directory = { path: 'dir', kind: 'directory', mode: 0o755 };
  const cases: Array<[string, unknown]> = [
    ['traversal', { entries: [{ ...file, path: '../escape' }] }],
    ['absolute', { entries: [{ ...file, path: '/escape' }] }],
    ['backslash', { entries: [{ ...file, path: 'dir\\escape' }] }],
    ['dot root', { entries: [{ ...directory, path: '.' }] }],
    ['dot component', { entries: [directory, { ...file, path: 'dir/./file' }] }],
    ['empty component', { entries: [{ ...file, path: 'dir//file' }] }],
    ['nul', { entries: [{ ...file, path: 'bad\0name' }] }],
    ['non-string path', { entries: [{ ...file, path: 4 }] }],
    ['duplicate', { entries: [file, file] }],
    ['missing parent', { entries: [{ ...file, path: 'dir/file' }] }],
    ['file parent', { entries: [file, { ...file, path: 'file/child' }] }],
    ['symlink', { entries: [{ path: 'link', kind: 'symlink', mode: 0o777, target: '/tmp' }] }],
    ['special', { entries: [{ path: 'pipe', kind: 'fifo', mode: 0o644 }] }],
    ['suid', { entries: [{ ...file, mode: 0o4644 }] }],
    ['sticky', { entries: [{ ...directory, mode: 0o1755 }] }],
    ['negative mode', { entries: [{ ...file, mode: -1 }] }],
    ['boolean mode', { entries: [{ ...file, mode: true }] }],
    ['string mode', { entries: [{ ...file, mode: '0644' }] }],
    ['unusable directory', { entries: [{ ...directory, mode: 0o000 }] }],
    ['ownership', { entries: [{ ...file, uid: 0 }] }],
    ['group', { entries: [{ ...file, gid: 0 }] }],
    ['malformed base64', { entries: [{ ...file, bytes_base64: '***' }] }],
    ['base64 whitespace', { entries: [{ ...file, bytes_base64: 'eA==\n' }] }],
    ['base64 padding bits', { entries: [{ ...file, bytes_base64: 'eB==' }] }],
    ['base64 not text', { entries: [{ ...file, bytes_base64: 1 }] }],
    ['base64 non-ascii', { entries: [{ ...file, bytes_base64: '你好' }] }],
    ['directory bytes', { entries: [{ ...directory, bytes_base64: '' }] }],
    ['missing file bytes', { entries: [{ path: 'file', kind: 'file', mode: 0o644 }] }],
    ['entries object', { entries: {} }],
    ['top-level array', []],
    ['caller host path', { entries: [], root: '/tmp/escape' }],
    ['reserved write probe', { entries: [{ ...file, path: '.m0-restored-write-probe' }] }],
    ['reserved write probe directory', { entries: [{ ...directory, path: '.m0-restored-write-probe-renamed' }] }],
    ['entry count', { entries: Array.from({ length: 1001 }, (_, i) => ({ ...file, path: `file-${i}` })) }],
  ];
  for (const [name, document] of cases) {
    const f = fixture();
    try {
      writeFileSync(f.input, JSON.stringify(document));
      const result = f.run(RESTORE_TREE_AND_VERIFY);
      assert.notEqual(result.status, 0, name);
      assert.equal(existsSync(f.root), false, name);
      assert.equal(existsSync(f.staging), false, name);
      assert.deepEqual(readdirSync(f.base), ['restore.json'], name);
    } finally { f.close(); }
  }
  for (const raw of ['{', '{"entries":[],"entries":[]}', '{"entries":[{"path":"a","path":"b","kind":"directory","mode":493}]}']) {
    const f = fixture();
    try {
      writeFileSync(f.input, raw);
      assert.notEqual(f.run(RESTORE_TREE_AND_VERIFY).status, 0);
      assert.equal(existsSync(f.root), false);
      assert.equal(existsSync(f.staging), false);
    } finally { f.close(); }
  }
});

test('restore refuses linked input, linked destination, and preexisting staging without modifying them', () => {
  for (const kind of ['input-symlink', 'input-hardlink', 'root-symlink', 'staging-symlink', 'staging-nonempty']) {
    const f = fixture();
    try {
      const outside = join(f.base, 'outside');
      mkdirSync(outside);
      const source = join(outside, 'input.json');
      writeFileSync(source, JSON.stringify({ entries: expectedEntries() }));
      if (kind === 'input-symlink') symlinkSync(source, f.input);
      else if (kind === 'input-hardlink') linkSync(source, f.input);
      else writeFileSync(f.input, readFileSync(source));
      if (kind === 'root-symlink') symlinkSync(outside, f.root);
      if (kind === 'staging-symlink') symlinkSync(outside, f.staging);
      if (kind === 'staging-nonempty') { mkdirSync(f.staging); writeFileSync(join(f.staging, 'keep'), 'keep'); }
      const result = f.run(RESTORE_TREE_AND_VERIFY);
      assert.notEqual(result.status, 0, kind);
      assert.deepEqual(JSON.parse(readFileSync(source, 'utf8')), { entries: expectedEntries() });
      if (kind !== 'root-symlink') assert.equal(existsSync(f.root), false, kind);
      else assert.equal(lstatSync(f.root).isSymbolicLink(), true);
      if (kind === 'staging-nonempty') assert.equal(readFileSync(join(f.staging, 'keep'), 'utf8'), 'keep');
      if (kind === 'staging-symlink') assert.equal(lstatSync(f.staging).isSymbolicLink(), true);
    } finally { f.close(); }
  }
});

test('export and restore enforce actual 32 MiB byte bounds and export enforces entry bounds', () => {
  const f = fixture();
  try {
    mkdirSync(f.root, { mode: 0o755 });
    chmodSync(f.root, 0o755);
    writeFileSync(join(f.root, 'oversized'), Buffer.alloc(32 * 1024 * 1024 + 1));
    assert.match(f.run(EXPORT_TREE).stderr, /byte_limit/);
    rmSync(join(f.root, 'oversized'));
    for (let i = 0; i < 1001; i++) writeFileSync(join(f.root, `file-${i}`), '');
    assert.match(f.run(EXPORT_TREE).stderr, /entry_limit/);
    rmSync(f.root, { recursive: true });
    const bytes = Buffer.alloc(17 * 1024 * 1024).toString('base64');
    writeFileSync(f.input, JSON.stringify({ entries: ['a', 'b'].map(path => ({ path, kind: 'file', mode: 0o644, bytes_base64: bytes })) }));
    assert.match(f.run(RESTORE_TREE_AND_VERIFY).stderr, /byte_limit/);
    assert.equal(existsSync(f.root), false);
    assert.equal(existsSync(f.staging), false);
  } finally { f.close(); }
});

test('failed atomic switch removes this invocation staging and preserves the existing empty root', () => {
  const f = fixture();
  try {
    mkdirSync(f.root);
    const originalInode = lstatSync(f.root).ino;
    writeFileSync(f.input, JSON.stringify({ entries: expectedEntries() }));
    // All directory creation, writes, reads and fsyncs remain real. Only the
    // final switch raises an injected OS error to exercise transactional cleanup.
    const injected = RESTORE_TREE_AND_VERIFY.replace(
      'validated = load_restore_entries()',
      'def fail_replace(*args):\n    raise OSError("injected_switch_failure")\nos.replace = fail_replace\nvalidated = load_restore_entries()',
    );
    const result = f.run(injected);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /injected_switch_failure/);
    assert.equal(lstatSync(f.root).ino, originalInode);
    assert.deepEqual(readdirSync(f.root), []);
    assert.equal(existsSync(f.staging), false);
  } finally { f.close(); }
});
