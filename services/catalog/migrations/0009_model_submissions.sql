-- User-owned immutable candidates feed the existing official model lifecycle.
CREATE TABLE catalog_model_submissions (
 id TEXT PRIMARY KEY NOT NULL,
 tenant_id TEXT NOT NULL REFERENCES catalog_tenants(id),
 project_id TEXT NOT NULL REFERENCES catalog_projects(id),
 workspace_id TEXT NOT NULL,
 workspace_generation INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES catalog_users(id),
 model_id TEXT NOT NULL,
 version TEXT NOT NULL,
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 status TEXT NOT NULL CHECK(status IN ('submitted','changes_requested','rejected','publishing','published')),
 review_note TEXT,
 reviewed_by TEXT REFERENCES catalog_users(id),
 model_version_id TEXT REFERENCES catalog_model_versions(id),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 last_intent_id TEXT NOT NULL
) STRICT;
CREATE INDEX catalog_submission_project ON catalog_model_submissions(project_id,created_at,id);
CREATE INDEX catalog_submission_review ON catalog_model_submissions(status,created_at,id);
CREATE TABLE catalog_submission_intents (
 id TEXT PRIMARY KEY NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
 operation TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 submission_id TEXT NOT NULL REFERENCES catalog_model_submissions(id),
 created_at INTEGER NOT NULL,
 UNIQUE(actor_user_id,operation,idempotency_key)
) STRICT;
CREATE TABLE catalog_submission_reviews (
 id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_submission_intents(id),
 submission_id TEXT NOT NULL REFERENCES catalog_model_submissions(id),
 actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
 decision TEXT NOT NULL CHECK(decision IN ('approve','request-changes','reject')),
 note TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER catalog_submission_identity_immutable BEFORE UPDATE OF id,tenant_id,project_id,workspace_id,workspace_generation,created_by,model_id,version,title,description,snapshot_json,created_at ON catalog_model_submissions
BEGIN SELECT RAISE(ABORT,'submission-snapshot-immutable'); END;
CREATE TRIGGER catalog_submission_state_monotonic BEFORE UPDATE OF status ON catalog_model_submissions
WHEN NEW.status IS NOT OLD.status AND NOT ((OLD.status='submitted' AND NEW.status IN ('changes_requested','rejected','publishing')) OR (OLD.status='publishing' AND NEW.status='published'))
BEGIN SELECT RAISE(ABORT,'submission-state-invalid'); END;
CREATE TRIGGER catalog_submission_model_immutable BEFORE UPDATE OF model_version_id ON catalog_model_submissions
WHEN OLD.model_version_id IS NOT NULL AND NEW.model_version_id IS NOT OLD.model_version_id
BEGIN SELECT RAISE(ABORT,'submission-model-immutable'); END;
CREATE TRIGGER catalog_submission_intent_no_update BEFORE UPDATE ON catalog_submission_intents
BEGIN SELECT RAISE(ABORT,'submission-intent-immutable'); END;
CREATE TRIGGER catalog_submission_intent_no_delete BEFORE DELETE ON catalog_submission_intents
BEGIN SELECT RAISE(ABORT,'submission-intent-immutable'); END;
CREATE TRIGGER catalog_submission_review_no_update BEFORE UPDATE ON catalog_submission_reviews
BEGIN SELECT RAISE(ABORT,'submission-review-immutable'); END;
CREATE TRIGGER catalog_submission_review_no_delete BEFORE DELETE ON catalog_submission_reviews
BEGIN SELECT RAISE(ABORT,'submission-review-immutable'); END;
CREATE TRIGGER catalog_submission_no_replace BEFORE INSERT ON catalog_model_submissions
WHEN EXISTS(SELECT 1 FROM catalog_model_submissions WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'submission-snapshot-immutable'); END;
CREATE TRIGGER catalog_submission_no_delete BEFORE DELETE ON catalog_model_submissions
BEGIN SELECT RAISE(ABORT,'submission-snapshot-immutable'); END;
CREATE TRIGGER catalog_submission_intent_no_replace BEFORE INSERT ON catalog_submission_intents
WHEN EXISTS(SELECT 1 FROM catalog_submission_intents WHERE id=NEW.id OR (actor_user_id=NEW.actor_user_id AND operation=NEW.operation AND idempotency_key=NEW.idempotency_key))
BEGIN SELECT RAISE(ABORT,'submission-intent-immutable'); END;
CREATE TRIGGER catalog_submission_review_no_replace BEFORE INSERT ON catalog_submission_reviews
WHEN EXISTS(SELECT 1 FROM catalog_submission_reviews WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'submission-review-immutable'); END;
