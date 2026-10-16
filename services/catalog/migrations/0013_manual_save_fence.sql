-- Durable authorization lease shared by manual publication and invitation revocation.
-- No expiry: unknown writes retain their original lease until journal terminal proof.
CREATE TABLE catalog_manual_save_fences (
 user_id TEXT NOT NULL REFERENCES catalog_users(id), auth_version INTEGER NOT NULL CHECK(auth_version>=1),
 tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_generation INTEGER NOT NULL CHECK(workspace_generation>=1),
 operation_id TEXT NOT NULL, input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 state TEXT NOT NULL CHECK(state IN ('pending','released')),
 terminal_status TEXT CHECK(terminal_status IN ('committed','unchanged','aborted')), revision_id TEXT,
 created_at INTEGER NOT NULL CHECK(created_at>=0), released_at INTEGER,
 PRIMARY KEY(user_id,auth_version,tenant_id,project_id,workspace_id,workspace_generation,operation_id),
 FOREIGN KEY(workspace_id,project_id,tenant_id) REFERENCES catalog_workspaces(id,project_id,tenant_id),
 CHECK((state='pending' AND terminal_status IS NULL AND revision_id IS NULL AND released_at IS NULL)
    OR (state='released' AND terminal_status IS NOT NULL AND released_at>=created_at
        AND ((terminal_status='committed' AND revision_id IS NOT NULL) OR (terminal_status IN ('unchanged','aborted') AND revision_id IS NULL))))
) STRICT;
CREATE UNIQUE INDEX catalog_manual_save_one_pending_workspace ON catalog_manual_save_fences(tenant_id,project_id,workspace_id,workspace_generation) WHERE state='pending';
CREATE INDEX catalog_manual_save_pending_user ON catalog_manual_save_fences(user_id) WHERE state='pending';
CREATE TRIGGER catalog_manual_save_fence_immutable_identity BEFORE UPDATE ON catalog_manual_save_fences
 WHEN OLD.user_id<>NEW.user_id OR OLD.auth_version<>NEW.auth_version OR OLD.tenant_id<>NEW.tenant_id
 OR OLD.project_id<>NEW.project_id OR OLD.workspace_id<>NEW.workspace_id OR OLD.workspace_generation<>NEW.workspace_generation
 OR OLD.operation_id<>NEW.operation_id OR OLD.input_sha256<>NEW.input_sha256 OR OLD.created_at<>NEW.created_at
 OR OLD.state='released'
 BEGIN SELECT RAISE(ABORT,'manual-save-fence-immutable'); END;
CREATE TRIGGER catalog_manual_save_fence_retain BEFORE DELETE ON catalog_manual_save_fences BEGIN SELECT RAISE(ABORT,'manual-save-fence-retained'); END;
-- Enforce at the storage boundary too, including an older revoke handler racing
-- migration installation between its schema probe and conditional UPDATE.
CREATE TRIGGER catalog_manual_save_revoke_fence BEFORE UPDATE OF status,auth_version ON catalog_users
 WHEN (NEW.status<>'active' OR NEW.auth_version<>OLD.auth_version)
 AND EXISTS (SELECT 1 FROM catalog_manual_save_fences f WHERE f.user_id=OLD.id AND f.state='pending')
 BEGIN SELECT RAISE(ABORT,'manual-save-fence-busy'); END;
