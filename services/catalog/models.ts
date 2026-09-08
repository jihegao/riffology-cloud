import { statement as sql, type Database } from './database.ts';
import { MODEL_CONTENT_MAX_BYTES, MODEL_CONTENT_MAX_FILES, MODEL_CONTENT_NAMESPACE, modelContentKey, type ModelContentPort, type ModelContentReceipt } from '../runtime/content.ts';
import type { ModelContentUploadPort } from '../runtime/model-upload.ts';
import type { ModelContentRef } from '../workspace/protocol.ts';
import { CatalogError, digest, modelReference, opaqueId, type Principal } from './contracts.ts';

export type ModelStatus = 'draft' | 'validated' | 'published' | 'withdrawn';
export interface ModelVersion {
  id: string; model_id: string; version: string; status: ModelStatus;
  title: string; description: string; starter_version: string;
  content_ref: string; content_sha256: string; created_by: string;
  created_at: number; validated_at: number | null; published_at: number | null; withdrawn_at: number | null;
}
export type ModelMutation = ModelVersion & { replayed: boolean };

const operator = `SELECT 1 FROM catalog_platform_roles r JOIN catalog_users u ON u.id=r.user_id
  WHERE r.user_id=? AND r.role='operator' AND r.status='active'
  AND u.status='active' AND u.auth_version=?`;
const columns = 'id,model_id,version,status,title,description,starter_version,content_ref,content_sha256,created_by,created_at,validated_at,published_at,withdrawn_at';

interface DraftInput {
  modelId: string; version: string; title: string; description: string;
  starterVersion: string; contentRef: string; contentSha256: string;
}
function draftInput(value: unknown): DraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('invalid_input');
  const record = value as Record<string, unknown>;
  const keys = ['modelId', 'version', 'title', 'description', 'starterVersion', 'contentRef', 'contentSha256'];
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) throw new CatalogError('invalid_input');
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.trim().length > 160
    || typeof record.description !== 'string' || !record.description.trim() || record.description.length > 4000
    || typeof record.contentRef !== 'string' || !record.contentRef.trim() || record.contentRef.length > 512
    || typeof record.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentSha256)) throw new CatalogError('invalid_input');
  return {
    modelId: modelReference(record.modelId), version: modelReference(record.version, 64),
    title: record.title.trim(), description: record.description,
    starterVersion: modelReference(record.starterVersion), contentRef: record.contentRef,
    contentSha256: record.contentSha256,
  };
}

function contentReference(row: ModelVersion): ModelContentRef {
  return {modelVersionId: row.id, modelId: row.model_id, version: row.version, contentRef: row.content_ref, contentSha256: row.content_sha256};
}
function checkedReceipt(value: unknown, ref: ModelContentRef): ModelContentReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('not_ready');
  const row = value as Record<string, unknown>;
  const keys = [...Object.keys(ref), 'namespace', 'bytes', 'verifiedSha256', 'fileCount', 'contentBytes'];
  if (Object.keys(row).length !== keys.length || !keys.every(key => Object.hasOwn(row, key))
    || !Object.entries(ref).every(([key, expected]) => row[key] === expected)
    || row.namespace !== MODEL_CONTENT_NAMESPACE || row.verifiedSha256 !== ref.contentSha256
    || !Number.isSafeInteger(row.bytes) || (row.bytes as number) < 1 || (row.bytes as number) > MODEL_CONTENT_MAX_BYTES
    || !Number.isSafeInteger(row.fileCount) || (row.fileCount as number) < 1 || (row.fileCount as number) > MODEL_CONTENT_MAX_FILES
    || !Number.isSafeInteger(row.contentBytes) || (row.contentBytes as number) < 0 || (row.contentBytes as number) > MODEL_CONTENT_MAX_BYTES
    || (row.contentBytes as number) > (row.bytes as number)) throw new CatalogError('not_ready');
  return {...ref, namespace: MODEL_CONTENT_NAMESPACE, bytes: row.bytes as number, verifiedSha256: ref.contentSha256,
    fileCount: row.fileCount as number, contentBytes: row.contentBytes as number};
}

export class ModelCatalog {
  private readonly db: Database;
  private readonly clock: () => number;
  private readonly content?: ModelContentPort;
  private readonly uploader?: ModelContentUploadPort;
  constructor(db: Database, clock: () => number = Date.now, content?: ModelContentPort, uploader?: ModelContentUploadPort) { this.db = db; this.clock = clock; this.content = content; this.uploader = uploader; }

  async published(): Promise<ModelVersion[]> {
    return this.db.query<ModelVersion>(sql(`SELECT ${columns} FROM catalog_model_versions WHERE status='published' ORDER BY model_id,version`));
  }

  async all(principal: Principal): Promise<ModelVersion[]> {
    await this.require(principal);
    return this.db.query<ModelVersion>(sql(`SELECT ${columns} FROM catalog_model_versions
      WHERE EXISTS (${operator}) ORDER BY created_at DESC,id LIMIT 200`, principal.userId, principal.authVersion));
  }

  async getPublished(modelId: string, version: string): Promise<ModelVersion> {
    modelReference(modelId); modelReference(version, 64);
    const rows = await this.db.query<ModelVersion>(sql(`SELECT ${columns} FROM catalog_model_versions
      WHERE model_id=? AND version=? AND status='published'`, modelId, version));
    if (!rows[0]) throw new CatalogError('not_found');
    return rows[0];
  }

  async createDraft(principal: Principal, key: string, value: unknown): Promise<ModelMutation> {
    opaqueId(key);
    const input = draftInput(value);
    await this.require(principal);
    const operation = 'model.create', payloadHash = await digest(JSON.stringify(input));
    const prior = await this.intent(principal, operation, key, payloadHash);
    if (prior) return { ...prior, replayed: true };
    const now = this.clock(), id = crypto.randomUUID(), intentId = crypto.randomUUID();
    const noIntent = `NOT EXISTS (SELECT 1 FROM catalog_model_operator_intents WHERE actor_user_id=? AND operation=? AND idempotency_key=?)`;
    await this.db.batch([
      sql(`INSERT INTO catalog_model_versions(id,model_id,version,status,title,description,starter_version,content_ref,content_sha256,last_transition_id,created_by,created_at)
        SELECT ?,?,?,'draft',?,?,?,?,?,?,?,? WHERE EXISTS (${operator}) AND ${noIntent}`,
        id, input.modelId, input.version, input.title, input.description, input.starterVersion,
        input.contentRef, input.contentSha256, intentId, principal.userId, now,
        principal.userId, principal.authVersion, principal.userId, operation, key),
      sql(`INSERT INTO catalog_model_operator_intents(id,actor_user_id,operation,idempotency_key,payload_hash,model_version_id,created_at)
        SELECT ?,?,?,?, ?,id,? FROM catalog_model_versions WHERE id=? AND status='draft' AND last_transition_id=?`,
        intentId, principal.userId, operation, key, payloadHash, now, id, intentId),
      sql(`INSERT INTO catalog_model_audit_log(id,actor_user_id,action,model_version_id,reason_code,outcome,request_id,created_at)
        SELECT ?,i.actor_user_id,i.operation,i.model_version_id,'model_state','completed',i.id,?
        FROM catalog_model_operator_intents i WHERE i.id=?`, `model:${intentId}`, now, intentId),
    ]);
    const accepted = await this.intent(principal, operation, key, payloadHash);
    if (!accepted) throw new CatalogError('not_found');
    const ownIntent = (await this.db.query(sql(`SELECT 1 FROM catalog_model_operator_intents WHERE id=?`, intentId))).length > 0;
    return { ...accepted, replayed: !ownIntent };
  }

  async upload(principal: Principal, id: string, key: string, readBytes: () => Promise<Uint8Array>): Promise<ModelMutation> {
    opaqueId(id); opaqueId(key);
    await this.require(principal);
    const row = await this.get(id), ref = contentReference(row), operation = 'model.uploaded';
    const payloadHash = await digest(JSON.stringify({id, contentRef: ref.contentRef, contentSha256: ref.contentSha256}));
    const prior = await this.intent(principal, operation, key, payloadHash);
    if (prior) return {...prior, replayed: true};
    if (row.status !== 'draft') throw new CatalogError('not_found');
    if (!this.uploader) throw new CatalogError('not_ready');
    try { modelContentKey(ref); } catch { throw new CatalogError('not_ready'); }
    // Body parsing errors retain the HTTP layer's bounded-body status.
    const bytes = await readBytes();
    try {
      const receipt = await this.uploader.upload(structuredClone(ref), bytes, async () => {
        await this.require(principal);
        const current = await this.get(id);
        if (current.status !== 'draft' || JSON.stringify(contentReference(current)) !== JSON.stringify(ref)
          || current.starter_version !== row.starter_version) throw new CatalogError('not_found');
      });
      checkedReceipt(receipt, ref);
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      throw new CatalogError('not_ready');
    }
    const now = this.clock(), intentId = crypto.randomUUID();
    await this.db.batch([
      sql(`INSERT INTO catalog_model_operator_intents(id,actor_user_id,operation,idempotency_key,payload_hash,model_version_id,created_at)
        SELECT ?,?,?,?,?,id,? FROM catalog_model_versions
        WHERE id=? AND status='draft' AND model_id=? AND version=? AND content_ref=? AND content_sha256=? AND starter_version=?
        AND EXISTS (${operator})
        AND NOT EXISTS (SELECT 1 FROM catalog_model_operator_intents WHERE actor_user_id=? AND operation=? AND idempotency_key=?)`,
        intentId, principal.userId, operation, key, payloadHash, now, id,
        row.model_id, row.version, row.content_ref, row.content_sha256, row.starter_version,
        principal.userId, principal.authVersion, principal.userId, operation, key),
      sql(`INSERT INTO catalog_model_audit_log(id,actor_user_id,action,model_version_id,reason_code,outcome,request_id,created_at)
        SELECT ?,i.actor_user_id,i.operation,i.model_version_id,'model_content','completed',i.id,?
        FROM catalog_model_operator_intents i WHERE i.id=?`, `model:${intentId}`, now, intentId),
    ]);
    const accepted = await this.intent(principal, operation, key, payloadHash);
    if (!accepted) throw new CatalogError('not_found');
    const ownIntent = (await this.db.query(sql('SELECT 1 FROM catalog_model_operator_intents WHERE id=?', intentId))).length > 0;
    return {...accepted, replayed: !ownIntent};
  }

  async transition(principal: Principal, id: string, to: 'validated' | 'published' | 'withdrawn', key: string): Promise<ModelMutation> {
    opaqueId(id); opaqueId(key);
    await this.require(principal);
    const operation = `model.${to}`, payloadHash = await digest(JSON.stringify({ id, to }));
    const prior = await this.intent(principal, operation, key, payloadHash);
    if (prior) return { ...prior, replayed: true };
    const row = await this.get(id), now = this.clock(), intentId = crypto.randomUUID();
    const valid = (row.status === 'draft' && to === 'validated')
      || (row.status === 'validated' && to === 'published')
      || (row.status === 'published' && to === 'withdrawn');
    if (!valid) throw new CatalogError('not_found');
    let receiptJson: string | null = null;
    if (to !== 'withdrawn') {
      const ref = contentReference(row);
      try {
        modelContentKey(ref);
        if (!this.content) throw new CatalogError('not_ready');
        if (to === 'published') {
          const saved = await this.db.query<{receipt_json: string}>(sql('SELECT receipt_json FROM catalog_model_content_checks WHERE model_version_id=?', id));
          if (!saved[0]) throw new CatalogError('not_ready');
          receiptJson = JSON.stringify(checkedReceipt(JSON.parse(saved[0].receipt_json), ref));
        }
        const verified = checkedReceipt((await this.content.resolve(structuredClone(ref))).receipt, ref);
        const fresh = JSON.stringify(verified);
        if (receiptJson !== null && receiptJson !== fresh) throw new CatalogError('not_ready');
        receiptJson = fresh;
      } catch { throw new CatalogError('not_ready'); }
    }
    await this.db.batch([
      sql(`UPDATE catalog_model_versions SET status=?,last_transition_id=?,
        validated_at=CASE WHEN ?='validated' THEN ? ELSE validated_at END,
        published_at=CASE WHEN ?='published' THEN ? ELSE published_at END,
        withdrawn_at=CASE WHEN ?='withdrawn' THEN ? ELSE withdrawn_at END
        WHERE id=? AND status=? AND model_id=? AND version=? AND content_ref=? AND content_sha256=? AND starter_version=?
        AND EXISTS (${operator})
        AND (? != 'published' OR EXISTS (SELECT 1 FROM catalog_model_content_checks c WHERE c.model_version_id=catalog_model_versions.id AND c.receipt_json=?))
        AND NOT EXISTS (SELECT 1 FROM catalog_model_operator_intents WHERE actor_user_id=? AND operation=? AND idempotency_key=?)`,
        to, intentId, to, now, to, now, to, now, id, row.status,
        row.model_id, row.version, row.content_ref, row.content_sha256, row.starter_version,
        principal.userId, principal.authVersion, to, receiptJson, principal.userId, operation, key),
      ...(to === 'validated' ? [sql(`INSERT INTO catalog_model_content_checks(model_version_id,receipt_json,verified_at,verified_by)
        SELECT id,?,?,? FROM catalog_model_versions WHERE id=? AND status='validated' AND last_transition_id=?`,
        receiptJson, now, principal.userId, id, intentId)] : []),
      sql(`INSERT INTO catalog_model_operator_intents(id,actor_user_id,operation,idempotency_key,payload_hash,model_version_id,created_at)
        SELECT ?,?,?,?, ?,id,? FROM catalog_model_versions WHERE id=? AND status=? AND last_transition_id=?`,
        intentId, principal.userId, operation, key, payloadHash, now, id, to, intentId),
      sql(`INSERT INTO catalog_model_audit_log(id,actor_user_id,action,model_version_id,reason_code,outcome,request_id,created_at)
        SELECT ?,i.actor_user_id,i.operation,i.model_version_id,'model_state','completed',i.id,?
        FROM catalog_model_operator_intents i WHERE i.id=?`, `model:${intentId}`, now, intentId),
    ]);
    const accepted = await this.intent(principal, operation, key, payloadHash);
    if (!accepted) throw new CatalogError('not_found');
    const ownIntent = (await this.db.query(sql(`SELECT 1 FROM catalog_model_operator_intents WHERE id=?`, intentId))).length > 0;
    return { ...accepted, replayed: !ownIntent };
  }

  async get(id: string): Promise<ModelVersion> {
    opaqueId(id);
    const rows = await this.db.query<ModelVersion>(sql(`SELECT ${columns} FROM catalog_model_versions WHERE id=?`, id));
    if (!rows[0]) throw new CatalogError('not_found');
    return rows[0];
  }

  private async require(principal: Principal): Promise<void> {
    if (!(await this.db.query(sql(operator, principal.userId, principal.authVersion))).length) throw new CatalogError('not_found');
  }

  private async intent(principal: Principal, operation: string, key: string, payloadHash: string): Promise<ModelVersion | null> {
    const rows = await this.db.query<ModelVersion & { payload_hash: string }>(sql(`SELECT ${columns.split(',').map(column => `m.${column}`).join(',')},i.payload_hash
      FROM catalog_model_operator_intents i JOIN catalog_model_versions m ON m.id=i.model_version_id
      WHERE i.actor_user_id=? AND i.operation=? AND i.idempotency_key=? AND EXISTS (${operator})`,
      principal.userId, operation, key, principal.userId, principal.authVersion));
    if (!rows[0]) return null;
    if (rows[0].payload_hash !== payloadHash) throw new CatalogError('idempotency_conflict');
    const { payload_hash: _, ...model } = rows[0];
    return model;
  }
}
