-- Private host routing metadata, never browser credentials or authorization.
CREATE TABLE catalog_preview_routes (
  preview_id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 1),
  host_label TEXT NOT NULL UNIQUE CHECK(length(host_label)=42 AND substr(host_label,1,2)='p-' AND substr(host_label,3) NOT GLOB '*[^a-f0-9]*'),
  expires_at INTEGER NOT NULL CHECK(expires_at > 0),
  FOREIGN KEY(project_id,tenant_id) REFERENCES catalog_projects(id,tenant_id),
  FOREIGN KEY(workspace_id,project_id,tenant_id) REFERENCES catalog_workspaces(id,project_id,tenant_id)
) STRICT;
CREATE TRIGGER catalog_preview_routes_immutable BEFORE UPDATE ON catalog_preview_routes
BEGIN SELECT RAISE(ABORT,'preview-route-immutable'); END;
