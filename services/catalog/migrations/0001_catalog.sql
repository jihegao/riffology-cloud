-- Platform business metadata only. Authentication-library tables are separate.
-- D1 enforces foreign keys in every query/migration; do not disable them.
-- https://developers.cloudflare.com/d1/sql-api/foreign-keys/
-- All *_at values are integer Unix milliseconds supplied by the platform.

CREATE TABLE catalog_users (
  id TEXT PRIMARY KEY NOT NULL,
  identity_issuer TEXT NOT NULL CHECK(length(identity_issuer) BETWEEN 1 AND 512),
  identity_subject TEXT NOT NULL CHECK(length(identity_subject) BETWEEN 1 AND 512),
  normalized_email TEXT NOT NULL CHECK(length(normalized_email) BETWEEN 3 AND 320 AND normalized_email = lower(trim(normalized_email))),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(identity_issuer, identity_subject)
) STRICT;

CREATE TABLE catalog_tenants (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES catalog_users(id),
  kind TEXT NOT NULL DEFAULT 'personal' CHECK(kind = 'personal'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleting')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  UNIQUE(id, owner_user_id)
) STRICT;

CREATE TABLE catalog_memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role = 'owner'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  PRIMARY KEY(tenant_id, user_id),
  FOREIGN KEY(tenant_id, user_id) REFERENCES catalog_tenants(id, owner_user_id)
) STRICT;

CREATE TABLE catalog_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  normalized_email TEXT NOT NULL CHECK(length(normalized_email) BETWEEN 3 AND 320 AND normalized_email = lower(trim(normalized_email))),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','revoked')),
  issued_by TEXT REFERENCES catalog_users(id),
  accepted_by TEXT REFERENCES catalog_users(id),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  accepted_at INTEGER,
  revoked_at INTEGER,
  CHECK((state = 'pending' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_at IS NULL)
     OR (state = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND accepted_at >= created_at AND accepted_at < expires_at AND revoked_at IS NULL)
     OR (state = 'revoked' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_at IS NOT NULL AND revoked_at >= created_at))
) STRICT;
CREATE INDEX catalog_invitations_email_state ON catalog_invitations(normalized_email, state, expires_at);

-- Reserve the workspace identity here, without a circular FK. The batch inserts
-- the matching workspace row before publishing the project creation intent.
CREATE TABLE catalog_projects (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  starter_version TEXT NOT NULL CHECK(length(starter_version) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK(status IN ('provisioning','ready','failed','deleting')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  FOREIGN KEY(tenant_id, owner_user_id) REFERENCES catalog_tenants(id, owner_user_id),
  UNIQUE(tenant_id, id),
  UNIQUE(id, tenant_id, workspace_id, owner_user_id)
) STRICT;
CREATE INDEX catalog_projects_tenant_created ON catalog_projects(tenant_id, created_at, id);

CREATE TABLE catalog_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK(status IN ('provisioning','ready','failed','deleting')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  FOREIGN KEY(project_id, tenant_id, id, owner_user_id) REFERENCES catalog_projects(id, tenant_id, workspace_id, owner_user_id),
  UNIQUE(id, project_id, tenant_id)
) STRICT;

-- Same key + same normalized payload is a business replay; different payload
-- is HTTP 409 in Catalog. The unique scope preserves the original intent, and
-- the immutable payload hash prevents an upsert from erasing that conflict.
CREATE TABLE catalog_creation_intents (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'project.create' CHECK(operation = 'project.create'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatched','completed','failed')),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  FOREIGN KEY(tenant_id, actor_user_id) REFERENCES catalog_tenants(id, owner_user_id),
  FOREIGN KEY(tenant_id, project_id) REFERENCES catalog_projects(tenant_id, id),
  UNIQUE(actor_user_id, tenant_id, operation, idempotency_key)
) STRICT;

CREATE TABLE catalog_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 1),
  kind TEXT NOT NULL DEFAULT 'workspace.provision' CHECK(kind = 'workspace.provision'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','completed','failed','unknown')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at INTEGER NOT NULL CHECK(available_at >= 0),
  claimed_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  FOREIGN KEY(workspace_id, project_id, tenant_id) REFERENCES catalog_workspaces(id, project_id, tenant_id),
  UNIQUE(workspace_id, generation, kind),
  CHECK(claimed_at IS NULL OR claimed_at >= created_at),
  CHECK(completed_at IS NULL OR completed_at >= created_at)
) STRICT;
CREATE INDEX catalog_outbox_due ON catalog_outbox(state, available_at, id);

-- Operations authorization is separate from project membership. No role here
-- grants a tenant, file, conversation, preview, artifact, or content scope.
CREATE TABLE catalog_platform_roles (
  user_id TEXT NOT NULL REFERENCES catalog_users(id),
  role TEXT NOT NULL CHECK(role = 'operator'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  granted_by TEXT REFERENCES catalog_users(id),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at),
  PRIMARY KEY(user_id, role)
) STRICT;

-- Metadata codes only; no raw request, token, file, log, conversation or result.
-- Runtime authorization still owns insert/read access. Triggers make routine
-- UPDATE/DELETE impossible; they are not a defence against database operators
-- who can change the schema itself.
CREATE TABLE catalog_audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES catalog_users(id),
  tenant_id TEXT REFERENCES catalog_tenants(id),
  action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 80 AND action NOT GLOB '*[^a-z0-9._-]*'),
  target_type TEXT NOT NULL CHECK(target_type IN ('user','tenant','membership','invitation','project','workspace','quota','platform_role','outbox')),
  target_id TEXT NOT NULL CHECK(length(target_id) BETWEEN 1 AND 128),
  reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 80 AND reason_code NOT GLOB '*[^a-z0-9._-]*'),
  outcome TEXT NOT NULL CHECK(outcome IN ('accepted','denied','completed','failed','unknown')),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;
CREATE INDEX catalog_audit_created ON catalog_audit_log(created_at, id);
CREATE INDEX catalog_audit_tenant_created ON catalog_audit_log(tenant_id, created_at, id);

CREATE TRIGGER catalog_users_identity_immutable BEFORE UPDATE OF id, identity_issuer, identity_subject, created_at ON catalog_users
WHEN NEW.id IS NOT OLD.id OR NEW.identity_issuer IS NOT OLD.identity_issuer OR NEW.identity_subject IS NOT OLD.identity_subject OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-user-identity-immutable'); END;
CREATE TRIGGER catalog_tenants_owner_immutable BEFORE UPDATE OF id, owner_user_id, kind, created_at ON catalog_tenants
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-tenant-owner-immutable'); END;
CREATE TRIGGER catalog_memberships_owner_immutable BEFORE UPDATE OF tenant_id, user_id, role, created_at ON catalog_memberships
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.user_id IS NOT OLD.user_id OR NEW.role IS NOT OLD.role OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-membership-owner-immutable'); END;
CREATE TRIGGER catalog_projects_owner_immutable BEFORE UPDATE OF id, tenant_id, owner_user_id, workspace_id, starter_version, created_at ON catalog_projects
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.starter_version IS NOT OLD.starter_version OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-project-owner-immutable'); END;
CREATE TRIGGER catalog_workspaces_owner_immutable BEFORE UPDATE OF id, project_id, tenant_id, owner_user_id, created_at ON catalog_workspaces
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-workspace-owner-immutable'); END;
CREATE TRIGGER catalog_projects_generation_monotonic BEFORE UPDATE OF generation ON catalog_projects
WHEN NEW.generation < OLD.generation
BEGIN SELECT RAISE(ABORT, 'catalog-generation-regression'); END;
CREATE TRIGGER catalog_workspaces_generation_monotonic BEFORE UPDATE OF generation ON catalog_workspaces
WHEN NEW.generation < OLD.generation
BEGIN SELECT RAISE(ABORT, 'catalog-generation-regression'); END;
CREATE TRIGGER catalog_creation_intents_identity_immutable BEFORE UPDATE ON catalog_creation_intents
WHEN NEW.id IS NOT OLD.id OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.operation IS NOT OLD.operation OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.payload_hash IS NOT OLD.payload_hash OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-creation-intent-immutable'); END;
CREATE TRIGGER catalog_outbox_identity_immutable BEFORE UPDATE ON catalog_outbox
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.generation IS NOT OLD.generation OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'catalog-outbox-identity-immutable'); END;
CREATE TRIGGER catalog_invitations_pending_insert BEFORE INSERT ON catalog_invitations
WHEN NEW.state <> 'pending'
BEGIN SELECT RAISE(ABORT, 'catalog-invitation-must-start-pending'); END;
CREATE TRIGGER catalog_invitations_immutable BEFORE UPDATE ON catalog_invitations
WHEN NEW.id IS NOT OLD.id OR NEW.token_hash IS NOT OLD.token_hash OR NEW.normalized_email IS NOT OLD.normalized_email OR NEW.issued_by IS NOT OLD.issued_by OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.state <> 'pending'
BEGIN SELECT RAISE(ABORT, 'catalog-invitation-immutable'); END;
CREATE TRIGGER catalog_invitations_accept_guard BEFORE UPDATE ON catalog_invitations
WHEN NEW.state = 'accepted' AND (
  OLD.state <> 'pending' OR NEW.expires_at <= CAST(strftime('%s','now') AS INTEGER) * 1000
  OR NOT EXISTS (SELECT 1 FROM catalog_users WHERE id = NEW.accepted_by AND normalized_email = NEW.normalized_email AND status = 'active'))
BEGIN SELECT RAISE(ABORT, 'catalog-invitation-admission-denied'); END;
CREATE TRIGGER catalog_audit_no_update BEFORE UPDATE ON catalog_audit_log
BEGIN SELECT RAISE(ABORT, 'catalog-audit-append-only'); END;
CREATE TRIGGER catalog_audit_no_delete BEFORE DELETE ON catalog_audit_log
BEGIN SELECT RAISE(ABORT, 'catalog-audit-append-only'); END;
-- REPLACE can delete without firing DELETE triggers when recursive_triggers is
-- off. Reject an existing audit identity before conflict replacement occurs.
CREATE TRIGGER catalog_audit_no_replace BEFORE INSERT ON catalog_audit_log
WHEN EXISTS (SELECT 1 FROM catalog_audit_log WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'catalog-audit-append-only'); END;
