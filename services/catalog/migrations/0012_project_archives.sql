-- Archival is independent of provisioning/runtime status and never changes identity.
ALTER TABLE catalog_projects ADD COLUMN archived_at INTEGER CHECK(archived_at IS NULL OR archived_at >= created_at);
ALTER TABLE catalog_projects ADD COLUMN archive_epoch INTEGER NOT NULL DEFAULT 0 CHECK(archive_epoch >= 0);
CREATE INDEX catalog_projects_archive_page ON catalog_projects(tenant_id,archived_at,created_at,id);
CREATE TABLE catalog_project_archive_manifests (
 id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
 cutoff_at INTEGER NOT NULL, created_at INTEGER NOT NULL, metadata_schema TEXT NOT NULL CHECK(metadata_schema='archive-items-v1'), total INTEGER NOT NULL
) STRICT;
CREATE TABLE catalog_project_archive_items (
 manifest_id TEXT NOT NULL REFERENCES catalog_project_archive_manifests(id),
 project_id TEXT NOT NULL REFERENCES catalog_projects(id), tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL, generation INTEGER NOT NULL, auth_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(manifest_id,project_id)
) STRICT;
CREATE TABLE catalog_project_archive_receipts (
 id TEXT PRIMARY KEY NOT NULL, actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
 project_id TEXT NOT NULL REFERENCES catalog_projects(id), action TEXT NOT NULL CHECK(action IN ('archive','restore')),
 request_key TEXT NOT NULL, manifest_id TEXT REFERENCES catalog_project_archive_manifests(id),
 archive_epoch INTEGER NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('completed','blocked')),
 reason_code TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(actor_user_id,project_id,action,request_key)
) STRICT;
CREATE TRIGGER catalog_project_archive_items_immutable_update BEFORE UPDATE ON catalog_project_archive_items BEGIN SELECT RAISE(ABORT,'archive-manifest-immutable'); END;
CREATE TRIGGER catalog_project_archive_items_immutable_delete BEFORE DELETE ON catalog_project_archive_items BEGIN SELECT RAISE(ABORT,'archive-manifest-immutable'); END;
CREATE TRIGGER catalog_project_archive_manifests_immutable_update BEFORE UPDATE ON catalog_project_archive_manifests BEGIN SELECT RAISE(ABORT,'archive-manifest-immutable'); END;
CREATE TRIGGER catalog_project_archive_manifests_immutable_delete BEFORE DELETE ON catalog_project_archive_manifests BEGIN SELECT RAISE(ABORT,'archive-manifest-immutable'); END;
CREATE TRIGGER catalog_project_archive_receipts_immutable_update BEFORE UPDATE ON catalog_project_archive_receipts BEGIN SELECT RAISE(ABORT,'archive-receipt-immutable'); END;
CREATE TRIGGER catalog_project_archive_receipts_immutable_delete BEFORE DELETE ON catalog_project_archive_receipts BEGIN SELECT RAISE(ABORT,'archive-receipt-immutable'); END;
CREATE TRIGGER catalog_project_archive_epoch_monotonic BEFORE UPDATE OF archive_epoch ON catalog_projects WHEN NEW.archive_epoch < OLD.archive_epoch BEGIN SELECT RAISE(ABORT,'archive-epoch-regression'); END;
