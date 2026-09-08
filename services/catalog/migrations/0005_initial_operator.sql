-- One deployment-controlled invitation may establish the first operator.
-- Public application inserts omit purpose and remain ordinary invitations.
ALTER TABLE catalog_invitations ADD COLUMN purpose TEXT NOT NULL DEFAULT 'user'
  CHECK(purpose IN ('user','initial_operator'));

CREATE TABLE catalog_operator_bootstrap (
  id TEXT PRIMARY KEY NOT NULL CHECK(id = 'initial-operator'),
  invitation_id TEXT NOT NULL UNIQUE REFERENCES catalog_invitations(id),
  normalized_email TEXT NOT NULL CHECK(length(normalized_email) BETWEEN 3 AND 320 AND normalized_email = lower(trim(normalized_email))),
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
) STRICT;

CREATE TRIGGER catalog_invitations_purpose_immutable BEFORE UPDATE OF purpose ON catalog_invitations
WHEN NEW.purpose IS NOT OLD.purpose
BEGIN SELECT RAISE(ABORT, 'catalog-invitation-purpose-immutable'); END;

CREATE TRIGGER catalog_initial_operator_invite_guard BEFORE INSERT ON catalog_invitations
WHEN NEW.purpose = 'initial_operator' AND (
  NEW.issued_by IS NOT NULL
  OR EXISTS (SELECT 1 FROM catalog_operator_bootstrap)
  OR EXISTS (SELECT 1 FROM catalog_platform_roles WHERE role='operator' AND status='active')
)
BEGIN SELECT RAISE(ABORT, 'catalog-initial-operator-invite-denied'); END;

CREATE TRIGGER catalog_initial_operator_invite_record AFTER INSERT ON catalog_invitations
WHEN NEW.purpose = 'initial_operator'
BEGIN
  INSERT INTO catalog_operator_bootstrap(id,invitation_id,normalized_email,created_at)
    VALUES ('initial-operator',NEW.id,NEW.normalized_email,NEW.created_at);
  INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
    VALUES ('bootstrap-invite-' || NEW.id,NULL,'operator.bootstrap.invite','invitation',NEW.id,'initial-operator','completed',NEW.id,NEW.created_at);
END;

-- Admission's verified-email guard executes in the same UPDATE statement.
-- A concurrently created operator makes acceptance fail instead of leaving a
-- user admitted without the intended bootstrap role.
CREATE TRIGGER catalog_initial_operator_accept_guard BEFORE UPDATE OF state ON catalog_invitations
WHEN OLD.purpose = 'initial_operator' AND NEW.state = 'accepted' AND (
  EXISTS (SELECT 1 FROM catalog_platform_roles WHERE role='operator' AND status='active')
  OR NOT EXISTS (
    SELECT 1 FROM catalog_operator_bootstrap b JOIN catalog_users u ON u.id=NEW.accepted_by
    WHERE b.invitation_id=NEW.id AND b.normalized_email=NEW.normalized_email
      AND u.normalized_email=NEW.normalized_email AND u.status='active'
  )
)
BEGIN SELECT RAISE(ABORT, 'catalog-initial-operator-accept-denied'); END;

CREATE TRIGGER catalog_initial_operator_grant AFTER UPDATE OF state ON catalog_invitations
WHEN OLD.purpose = 'initial_operator' AND NEW.state = 'accepted'
BEGIN
  INSERT INTO catalog_platform_roles(user_id,role,status,granted_by,created_at,updated_at)
    VALUES (NEW.accepted_by,'operator','active',NULL,NEW.accepted_at,NEW.accepted_at);
  INSERT INTO catalog_audit_log(id,actor_user_id,action,target_type,target_id,reason_code,outcome,request_id,created_at)
    VALUES ('bootstrap-grant-' || NEW.id,NEW.accepted_by,'platform_role.grant','platform_role',NEW.accepted_by,'initial-operator','completed',NEW.id,NEW.accepted_at);
END;

CREATE TRIGGER catalog_operator_bootstrap_no_update BEFORE UPDATE ON catalog_operator_bootstrap
BEGIN SELECT RAISE(ABORT, 'catalog-operator-bootstrap-immutable'); END;
CREATE TRIGGER catalog_operator_bootstrap_no_delete BEFORE DELETE ON catalog_operator_bootstrap
BEGIN SELECT RAISE(ABORT, 'catalog-operator-bootstrap-immutable'); END;
