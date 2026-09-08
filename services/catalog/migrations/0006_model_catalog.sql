-- Immutable official model metadata. Package bytes live outside D1.
CREATE TABLE catalog_model_versions (
  id TEXT PRIMARY KEY NOT NULL,
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 128),
  version TEXT NOT NULL CHECK(length(version) BETWEEN 1 AND 64),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','validated','published','withdrawn')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  description TEXT NOT NULL CHECK(length(description) <= 4000),
  starter_version TEXT NOT NULL CHECK(length(starter_version) BETWEEN 1 AND 128),
  content_ref TEXT NOT NULL CHECK(length(content_ref) BETWEEN 1 AND 512),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  last_transition_id TEXT NOT NULL CHECK(length(last_transition_id) BETWEEN 1 AND 128),
  created_by TEXT NOT NULL REFERENCES catalog_users(id),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  validated_at INTEGER,
  published_at INTEGER,
  withdrawn_at INTEGER,
  CHECK((status='draft' AND validated_at IS NULL AND published_at IS NULL AND withdrawn_at IS NULL)
     OR (status='validated' AND validated_at>=created_at AND published_at IS NULL AND withdrawn_at IS NULL)
     OR (status='published' AND validated_at>=created_at AND published_at>=validated_at AND withdrawn_at IS NULL)
     OR (status='withdrawn' AND validated_at>=created_at AND published_at>=validated_at AND withdrawn_at>=published_at)),
  UNIQUE(model_id, version)
) STRICT;
CREATE INDEX catalog_model_versions_status ON catalog_model_versions(status, model_id, version);
CREATE TABLE catalog_model_operator_intents (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
  operation TEXT NOT NULL CHECK(length(operation) BETWEEN 1 AND 80 AND operation NOT GLOB '*[^a-z0-9._-]*'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  model_version_id TEXT NOT NULL REFERENCES catalog_model_versions(id),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(actor_user_id, operation, idempotency_key)
) STRICT;
ALTER TABLE catalog_projects ADD COLUMN source_model_version_id TEXT REFERENCES catalog_model_versions(id);
ALTER TABLE catalog_projects ADD COLUMN source_model_id TEXT;
ALTER TABLE catalog_projects ADD COLUMN source_model_version TEXT;
ALTER TABLE catalog_projects ADD COLUMN source_digest TEXT CHECK(source_digest IS NULL OR (length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE catalog_outbox ADD COLUMN source_model_version_id TEXT;
ALTER TABLE catalog_outbox ADD COLUMN source_model_id TEXT;
ALTER TABLE catalog_outbox ADD COLUMN source_model_version TEXT;
ALTER TABLE catalog_outbox ADD COLUMN source_content_ref TEXT;
ALTER TABLE catalog_outbox ADD COLUMN source_content_sha256 TEXT CHECK(source_content_sha256 IS NULL OR (length(source_content_sha256)=64 AND source_content_sha256 NOT GLOB '*[^0-9a-f]*'));
CREATE TRIGGER catalog_outbox_model_source_immutable BEFORE UPDATE OF source_model_version_id,source_model_id,source_model_version,source_content_ref,source_content_sha256 ON catalog_outbox
WHEN NEW.source_model_version_id IS NOT OLD.source_model_version_id OR NEW.source_model_id IS NOT OLD.source_model_id OR NEW.source_model_version IS NOT OLD.source_model_version OR NEW.source_content_ref IS NOT OLD.source_content_ref OR NEW.source_content_sha256 IS NOT OLD.source_content_sha256
BEGIN SELECT RAISE(ABORT, 'catalog-outbox-model-source-immutable'); END;
CREATE TRIGGER catalog_project_model_source_immutable BEFORE UPDATE OF source_model_version_id, source_model_id, source_model_version, source_digest ON catalog_projects
WHEN NEW.source_model_version_id IS NOT OLD.source_model_version_id OR NEW.source_model_id IS NOT OLD.source_model_id OR NEW.source_model_version IS NOT OLD.source_model_version OR NEW.source_digest IS NOT OLD.source_digest
BEGIN SELECT RAISE(ABORT, 'catalog-project-model-source-immutable'); END;
CREATE TRIGGER catalog_model_version_identity_immutable BEFORE UPDATE OF id,model_id,version,created_by,created_at ON catalog_model_versions
WHEN NEW.id IS NOT OLD.id OR NEW.model_id IS NOT OLD.model_id OR NEW.version IS NOT OLD.version OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-model-version-identity-immutable'); END;
CREATE TRIGGER catalog_model_version_content_immutable BEFORE UPDATE OF title,description,starter_version,content_ref,content_sha256 ON catalog_model_versions
WHEN OLD.status IN ('published','withdrawn') AND (NEW.title IS NOT OLD.title OR NEW.description IS NOT OLD.description OR NEW.starter_version IS NOT OLD.starter_version OR NEW.content_ref IS NOT OLD.content_ref OR NEW.content_sha256 IS NOT OLD.content_sha256)
BEGIN SELECT RAISE(ABORT, 'catalog-model-version-content-immutable'); END;
CREATE TRIGGER catalog_model_version_status_monotonic BEFORE UPDATE OF status ON catalog_model_versions
WHEN NEW.status IS NOT OLD.status AND NOT (
  (OLD.status='draft' AND NEW.status='validated') OR
  (OLD.status='validated' AND NEW.status='published') OR
  (OLD.status='published' AND NEW.status='withdrawn'))
BEGIN SELECT RAISE(ABORT, 'catalog-model-version-status-transition'); END;
CREATE TRIGGER catalog_model_operator_intent_immutable BEFORE UPDATE ON catalog_model_operator_intents
BEGIN SELECT RAISE(ABORT, 'catalog-model-operator-intent-immutable'); END;
CREATE TRIGGER catalog_model_operator_intent_no_delete BEFORE DELETE ON catalog_model_operator_intents
BEGIN SELECT RAISE(ABORT, 'catalog-model-operator-intent-immutable'); END;
CREATE TRIGGER catalog_project_model_source_consistent BEFORE INSERT ON catalog_projects
WHEN (NEW.source_model_version_id IS NULL OR NEW.source_model_id IS NULL OR NEW.source_model_version IS NULL OR NEW.source_digest IS NULL)
 AND NOT (NEW.source_model_version_id IS NULL AND NEW.source_model_id IS NULL AND NEW.source_model_version IS NULL AND NEW.source_digest IS NULL)
BEGIN SELECT RAISE(ABORT, 'catalog-project-model-source-incomplete'); END;
CREATE TRIGGER catalog_project_model_source_update_consistent BEFORE UPDATE OF source_model_version_id,source_model_id,source_model_version,source_digest ON catalog_projects
WHEN (NEW.source_model_version_id IS NULL OR NEW.source_model_id IS NULL OR NEW.source_model_version IS NULL OR NEW.source_digest IS NULL)
 AND NOT (NEW.source_model_version_id IS NULL AND NEW.source_model_id IS NULL AND NEW.source_model_version IS NULL AND NEW.source_digest IS NULL)
BEGIN SELECT RAISE(ABORT, 'catalog-project-model-source-incomplete'); END;
CREATE TRIGGER catalog_project_model_source_matches_model BEFORE INSERT ON catalog_projects
WHEN NEW.source_model_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog_model_versions m WHERE m.id=NEW.source_model_version_id AND m.model_id=NEW.source_model_id AND m.version=NEW.source_model_version AND m.content_sha256=NEW.source_digest)
BEGIN SELECT RAISE(ABORT, 'catalog-project-model-source-mismatch'); END;

-- Model events use their own append-only table because the deployed base audit
-- taxonomy is immutable and its table is referenced by admission triggers.
CREATE TABLE catalog_model_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES catalog_users(id),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 80 AND action NOT GLOB '*[^a-z0-9._-]*'),
  model_version_id TEXT NOT NULL REFERENCES catalog_model_versions(id),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 80 AND reason_code NOT GLOB '*[^a-z0-9._-]*'),
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','denied','completed','failed','unknown')),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;
CREATE INDEX catalog_model_audit_created ON catalog_model_audit_log(created_at, id);
CREATE TRIGGER catalog_model_audit_no_update BEFORE UPDATE ON catalog_model_audit_log
BEGIN SELECT RAISE(ABORT, 'catalog-model-audit-append-only'); END;
CREATE TRIGGER catalog_model_audit_no_delete BEFORE DELETE ON catalog_model_audit_log
BEGIN SELECT RAISE(ABORT, 'catalog-model-audit-append-only'); END;
CREATE TRIGGER catalog_model_audit_no_replace BEFORE INSERT ON catalog_model_audit_log
WHEN EXISTS (SELECT 1 FROM catalog_model_audit_log WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'catalog-model-audit-append-only'); END;
