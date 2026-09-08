import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyModelContent, type ModelContentPort, type VerifiedModelContent } from '../../services/runtime/content.ts';
import { digest } from '../../services/catalog/contracts.ts';
import { ModelCatalog } from '../../services/catalog/models.ts';
import { ProjectCatalog } from '../../services/catalog/projects.ts';
import { SqliteCatalog } from './sqlite-database.ts';

const operator = { userId: 'operator', authVersion: 1 };
const fileText = 'print(1)\n';
const packageText = JSON.stringify({schemaVersion: 1, files: [{path: 'model/main.py', bytes: new TextEncoder().encode(fileText).length, sha256: await digest(fileText), contentBase64: btoa(fileText)}]});
const packageSha = await digest(packageText);
const draft = { modelId: 'queue', version: '1', title: 'Queue starter', description: 'A queue', starterVersion: 'blank-v1', contentRef: 'queue/1', contentSha256: packageSha };
function fixture() {
  const db = new SqliteCatalog();
  db.seed('owner'); db.seed('other'); db.seed('operator');
  const now = Date.now();
  db.sqlite.prepare("INSERT INTO catalog_platform_roles(user_id,role,status,created_at,updated_at) VALUES (?,'operator','active',?,?)").run('operator', now, now);
  const state = {calls: 0, packageText: packageText as string | null, transform: null as ((value: VerifiedModelContent) => VerifiedModelContent) | null, beforeResolve: null as (() => void) | null};
  const content: ModelContentPort = {async resolve(ref) {
    state.calls++; state.beforeResolve?.();
    if (state.packageText === null) throw new Error('missing');
    const bytes = new TextEncoder().encode(state.packageText);
    const value = await verifyModelContent(ref, {size: bytes.length, async arrayBuffer() {return bytes.buffer;}});
    return state.transform ? state.transform(value) : value;
  }};
  return { db, state, models: new ModelCatalog(db, () => 1_800_000_000_000, content) };
}

test('model lifecycle is operator-only, monotonic, and published reads are filtered', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.models.createDraft({ userId: 'owner', authVersion: 1 }, 'owner-create', draft), { message: 'not_found' });
    const created = await f.models.createDraft(operator, 'create', draft);
    assert.equal(created.status, 'draft'); assert.deepEqual(await f.models.published(), []);
    const validated = await f.models.transition(operator, created.id, 'validated', 'validate'); assert.equal(validated.status, 'validated');
    const published = await f.models.transition(operator, created.id, 'published', 'publish'); assert.equal(published.status, 'published');
    assert.equal((await f.models.getPublished('queue', '1')).id, created.id);
    await assert.rejects(f.models.transition(operator, created.id, 'validated', 'invalid-back'), { message: 'not_found' });
    const withdrawn = await f.models.transition(operator, created.id, 'withdrawn', 'withdraw'); assert.equal(withdrawn.status, 'withdrawn');
    await assert.rejects(f.models.getPublished('queue', '1'), { message: 'not_found' });
  } finally { f.db.sqlite.close(); }
});

test('published model copy binds immutable source and preserves blank starter replay semantics', async () => {
  const f = fixture();
  try {
    const model = await f.models.createDraft(operator, 'create', draft);
    await f.models.transition(operator, model.id, 'validated', 'validate'); await f.models.transition(operator, model.id, 'published', 'publish');
    const projects = new ProjectCatalog(f.db, new Set(['blank-v1']), f.models);
    const copied = await projects.create({ userId: 'owner', authVersion: 1 }, 'tenant-owner', 'copy-1', { title: 'Copied', modelId: 'queue', modelVersion: '1' });
    assert.equal(copied.project.source_model_id, 'queue'); assert.equal(copied.project.source_model_version, '1'); assert.equal(copied.project.source_digest, packageSha);
    const replay = await projects.create({ userId: 'owner', authVersion: 1 }, 'tenant-owner', 'copy-1', { title: 'Copied', modelId: 'queue', modelVersion: '1' });
    assert.equal(replay.replayed, true); assert.equal(replay.project.id, copied.project.id);
    await f.models.transition(operator, model.id, 'withdrawn', 'withdraw');
    await assert.rejects(projects.create({ userId: 'owner', authVersion: 1 }, 'tenant-owner', 'copy-2', { title: 'Nope', modelId: 'queue', modelVersion: '1' }), { message: 'not_found' });
    const blank = await projects.create({ userId: 'owner', authVersion: 1 }, 'tenant-owner', 'blank', { title: 'Blank', starterVersion: 'blank-v1' });
    assert.equal(blank.project.source_model_id, null);
  } finally { f.db.sqlite.close(); }
});

test('model source and identity fields are immutable and foreign tenant copy is rejected', async () => {
  const f = fixture();
  try {
    const model = await f.models.createDraft(operator, 'create', draft);
    await f.models.transition(operator, model.id, 'validated', 'validate'); await f.models.transition(operator, model.id, 'published', 'publish');
    const projects = new ProjectCatalog(f.db, new Set(['blank-v1']), f.models);
    await assert.rejects(projects.create({ userId: 'other', authVersion: 1 }, 'tenant-owner', 'foreign', { title: 'Nope', modelId: 'queue', modelVersion: '1' }), { message: 'not_found' });
    await projects.create({ userId: 'owner', authVersion: 1 }, 'tenant-owner', 'ok', { title: 'Ok', modelId: 'queue', modelVersion: '1' });
    assert.throws(() => f.db.sqlite.exec("UPDATE catalog_projects SET source_digest='b' WHERE source_model_id='queue'"), /model-source-immutable/);
  } finally { f.db.sqlite.close(); }
});

test('concurrent state change records exactly one successful transition and database status cannot regress', async () => {
  const f = fixture();
  try {
    const model = await f.models.createDraft(operator, 'create', { ...draft, version: '2.1.0' });
    const results = await Promise.allSettled([
      f.models.transition(operator, model.id, 'validated', 'validate-a'),
      f.models.transition(operator, model.id, 'validated', 'validate-b'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM catalog_model_audit_log WHERE action='model.validated'").get()!.n, 1);
    await f.models.transition(operator, model.id, 'published', 'publish');
    assert.throws(() => f.db.sqlite.prepare("UPDATE catalog_model_versions SET status='draft',validated_at=NULL,published_at=NULL WHERE id=?").run(model.id), /status-transition/);
    assert.equal((await f.models.getPublished('queue', '2.1.0')).version, '2.1.0');
  } finally { f.db.sqlite.close(); }
});

test('model mutations recover exact intents after response loss and reject changed payloads', async () => {
  const f = fixture();
  try {
    f.db.loseCommitResponse = true;
    await assert.rejects(f.models.createDraft(operator, 'lost-create', draft), /lost committed response/);
    f.db.loseCommitResponse = false;
    const created = await f.models.createDraft(operator, 'lost-create', draft);
    assert.equal(created.replayed, true); assert.equal(f.db.count('catalog_model_versions'), 1);
    await assert.rejects(f.models.createDraft(operator, 'lost-create', { ...draft, title: 'Changed' }), { message: 'idempotency_conflict' });
    await f.models.transition(operator, created.id, 'validated', 'validate');
    f.db.loseCommitResponse = true;
    await assert.rejects(f.models.transition(operator, created.id, 'published', 'lost-publish'), /lost committed response/);
    f.db.loseCommitResponse = false;
    const published = await f.models.transition(operator, created.id, 'published', 'lost-publish');
    assert.equal(published.replayed, true); assert.equal(published.status, 'published');
    assert.equal(f.db.sqlite.prepare("SELECT count(*) AS n FROM catalog_model_audit_log WHERE action='model.published'").get()!.n, 1);
  } finally { f.db.sqlite.close(); }
});

test('draft input is exact and model audit remains append-only', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.models.createDraft(operator, 'bad', { ...draft, unexpected: true }), { message: 'invalid_input' });
    const model = await f.models.createDraft(operator, 'create', draft);
    const audit = f.db.sqlite.prepare('SELECT id FROM catalog_model_audit_log WHERE model_version_id=?').get(model.id)!;
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM catalog_model_audit_log WHERE id=?').run(audit.id), /append-only/);
    assert.throws(() => f.db.sqlite.prepare('DELETE FROM catalog_model_operator_intents WHERE model_version_id=?').run(model.id), /intent-immutable/);
  } finally { f.db.sqlite.close(); }
});

test('validation fails closed without verifier or with missing, corrupt, or mismatched content', async () => {
  const f = fixture();
  try {
    const row = await f.models.createDraft(operator, 'create', draft);
    await assert.rejects(new ModelCatalog(f.db).transition(operator, row.id, 'validated', 'no-port'), /not_ready/);
    for (const text of [null, '{}', packageText + '\n']) {
      f.state.packageText = text;
      await assert.rejects(f.models.transition(operator, row.id, 'validated', 'invalid'), /not_ready/);
      assert.equal((await f.models.get(row.id)).status, 'draft');
      assert.equal(f.db.count('catalog_model_content_checks'), 0);
      assert.equal(f.db.count('catalog_model_audit_log'), 1);
    }
    f.state.packageText = packageText;
    for (const patch of [{modelVersionId:'other'}, {modelId:'other'}, {version:'other'}, {contentRef:'other'}, {contentSha256:'b'.repeat(64)}, {verifiedSha256:'b'.repeat(64)}, {namespace:'other'}, {bytes:0}, {bytes:8388609}, {fileCount:0}, {fileCount:4097}, {contentBytes:-1}, {contentBytes:8388609}, {extra:true}]) {
      f.state.transform = value => ({...value,receipt:{...value.receipt,...patch}} as VerifiedModelContent);
      await assert.rejects(f.models.transition(operator, row.id, 'validated', 'mismatch'), /not_ready/);
      assert.equal(f.db.count('catalog_model_content_checks'), 0);
    }
    f.state.transform = null;
    await f.models.transition(operator, row.id, 'validated', 'valid');
    assert.equal(f.db.count('catalog_model_content_checks'), 1);
  } finally { f.db.sqlite.close(); }
});

test('validation receipt commits atomically and replay after response loss performs no storage reads', async () => {
  const f = fixture();
  try {
    const row = await f.models.createDraft(operator, 'create', draft);
    f.db.failAt = 2;
    await assert.rejects(f.models.transition(operator, row.id, 'validated', 'validate'), /injected SQL/);
    assert.equal((await f.models.get(row.id)).status, 'draft');
    assert.equal(f.db.count('catalog_model_content_checks'), 0);
    assert.equal(f.db.count('catalog_model_audit_log'), 1);
    f.db.failAt = -1; f.db.loseCommitResponse = true;
    await assert.rejects(f.models.transition(operator, row.id, 'validated', 'validate'), /lost committed response/);
    f.db.loseCommitResponse = false; f.state.packageText = null;
    const calls = f.state.calls;
    assert.equal((await f.models.transition(operator, row.id, 'validated', 'validate')).replayed, true);
    assert.equal(f.state.calls, calls); assert.equal(f.db.count('catalog_model_content_checks'), 1);
    assert.throws(() => f.db.sqlite.exec('DELETE FROM catalog_model_content_checks'), /immutable/);
    assert.throws(() => f.db.sqlite.exec("UPDATE catalog_model_content_checks SET receipt_json='{}'"), /immutable/);
  } finally { f.db.sqlite.close(); }
});

test('revocation or draft content replacement during verification prevents state and receipt mutation', async () => {
  for (const revoke of [true, false]) {
    const f = fixture();
    try {
      const row = await f.models.createDraft(operator, 'create', draft);
      f.state.beforeResolve = () => f.db.sqlite.exec(revoke
        ? "UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'"
        : "UPDATE catalog_model_versions SET content_ref='changed' WHERE status='draft'");
      await assert.rejects(f.models.transition(operator, row.id, 'validated', 'validate'), /not_found/);
      assert.equal((await f.models.get(row.id)).status, 'draft');
      assert.equal(f.db.count('catalog_model_content_checks'), 0);
      assert.equal(f.db.count('catalog_model_audit_log'), 1);
    } finally { f.db.sqlite.close(); }
  }
});

test('publication requires saved proof and rechecks original bytes; withdrawal and replay need no verifier', async () => {
  const f = fixture();
  try {
    const row = await f.models.createDraft(operator, 'create', draft);
    await f.models.transition(operator, row.id, 'validated', 'validate');
    assert.throws(() => f.db.sqlite.exec("UPDATE catalog_model_versions SET content_sha256='" + 'b'.repeat(64) + "'"), /immutable/);
    for (const text of [null, '{}']) {
      f.state.packageText = text;
      await assert.rejects(f.models.transition(operator, row.id, 'published', 'publish'), /not_ready/);
      assert.equal((await f.models.get(row.id)).status, 'validated');
      assert.equal(f.db.count('catalog_model_audit_log'), 2);
    }
    f.state.packageText = packageText;
    await f.models.transition(operator, row.id, 'published', 'publish');
    const noPort = new ModelCatalog(f.db, () => 1_800_000_000_000);
    assert.equal((await noPort.transition(operator, row.id, 'published', 'publish')).replayed, true);
    assert.equal((await noPort.transition(operator, row.id, 'withdrawn', 'withdraw')).status, 'withdrawn');
    assert.equal(f.db.count('catalog_model_content_checks'), 1);
  } finally { f.db.sqlite.close(); }
});

test('metadata-only validated rows cannot publish without a matching validation receipt', async () => {
  const f = fixture();
  try {
    const row = await f.models.createDraft(operator, 'create', draft);
    f.db.sqlite.prepare("UPDATE catalog_model_versions SET status='validated',validated_at=created_at WHERE id=?").run(row.id);
    await assert.rejects(f.models.transition(operator, row.id, 'published', 'publish'), /not_ready/);
    assert.equal(f.state.calls, 0);
  } finally {f.db.sqlite.close();}
});

test('publication rejects changed verification metrics and operator revocation during the second resolve', async () => {
  const f = fixture();
  try {
    const row = await f.models.createDraft(operator, 'create', draft);
    await f.models.transition(operator, row.id, 'validated', 'validate');
    f.state.transform = value => ({...value,receipt:{...value.receipt,fileCount:2}});
    await assert.rejects(f.models.transition(operator, row.id, 'published', 'publish'), /not_ready/);
    assert.equal((await f.models.get(row.id)).status, 'validated');
    f.state.transform = null;
    f.state.beforeResolve = () => f.db.sqlite.exec("UPDATE catalog_platform_roles SET status='revoked' WHERE user_id='operator'");
    await assert.rejects(f.models.transition(operator, row.id, 'published', 'publish'), /not_found/);
    assert.equal((await f.models.get(row.id)).status, 'validated');
    assert.equal(f.db.count('catalog_model_content_checks'), 1);
    assert.equal(f.db.count('catalog_model_audit_log'), 2);
  } finally { f.db.sqlite.close(); }
});
