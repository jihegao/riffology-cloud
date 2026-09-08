-- Dispatch identity survives response loss. A deadline does not authorize an
-- unknown operation to execute again; WorkspaceAgent owns effect reconciliation.
ALTER TABLE catalog_outbox ADD COLUMN deadline_at INTEGER CHECK(deadline_at IS NULL OR deadline_at >= created_at);
-- New creation batches always supply the original actor version. Pre-migration
-- NULL rows are quarantined: never backfill them from a user's current version.
ALTER TABLE catalog_outbox ADD COLUMN actor_auth_version INTEGER CHECK(actor_auth_version IS NULL OR actor_auth_version >= 1);
ALTER TABLE catalog_outbox ADD COLUMN projection_sequence INTEGER NOT NULL DEFAULT 0 CHECK(projection_sequence >= 0);
ALTER TABLE catalog_outbox ADD COLUMN reason_code TEXT;
ALTER TABLE catalog_projects ADD COLUMN reason_code TEXT;
ALTER TABLE catalog_workspaces ADD COLUMN reason_code TEXT;

CREATE TABLE catalog_provisioning_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  outbox_id TEXT NOT NULL REFERENCES catalog_outbox(id),
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  outcome TEXT NOT NULL CHECK(outcome IN ('ready','failed','stopped','unknown')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(outbox_id, sequence)
) STRICT;

CREATE TRIGGER catalog_outbox_deadline_immutable BEFORE UPDATE OF deadline_at ON catalog_outbox
WHEN OLD.deadline_at IS NOT NULL AND NEW.deadline_at IS NOT OLD.deadline_at
BEGIN SELECT RAISE(ABORT, 'catalog-dispatch-deadline-immutable'); END;
CREATE TRIGGER catalog_outbox_projection_monotonic BEFORE UPDATE OF projection_sequence ON catalog_outbox
WHEN NEW.projection_sequence < OLD.projection_sequence
BEGIN SELECT RAISE(ABORT, 'catalog-projection-sequence-regression'); END;
CREATE TRIGGER catalog_outbox_actor_version_immutable BEFORE UPDATE OF actor_auth_version ON catalog_outbox
WHEN OLD.actor_auth_version IS NOT NULL AND NEW.actor_auth_version IS NOT OLD.actor_auth_version
BEGIN SELECT RAISE(ABORT, 'catalog-dispatch-actor-version-immutable'); END;
CREATE TRIGGER catalog_provisioning_receipts_no_update BEFORE UPDATE ON catalog_provisioning_receipts
BEGIN SELECT RAISE(ABORT, 'catalog-provisioning-receipt-immutable'); END;
CREATE TRIGGER catalog_provisioning_receipts_no_delete BEFORE DELETE ON catalog_provisioning_receipts
BEGIN SELECT RAISE(ABORT, 'catalog-provisioning-receipt-immutable'); END;
CREATE TRIGGER catalog_provisioning_receipts_no_replace BEFORE INSERT ON catalog_provisioning_receipts
WHEN EXISTS (SELECT 1 FROM catalog_provisioning_receipts WHERE receipt_id=NEW.receipt_id OR (outbox_id=NEW.outbox_id AND sequence=NEW.sequence))
BEGIN SELECT RAISE(ABORT, 'catalog-provisioning-receipt-immutable'); END;
