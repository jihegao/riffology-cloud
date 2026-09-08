-- Idempotency for operator invitation issuance is separate from user project
-- creation. Plaintext invitation tokens are never retained in D1.
CREATE TABLE catalog_operator_intents (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES catalog_users(id),
  operation TEXT NOT NULL DEFAULT 'invitation.issue' CHECK(operation = 'invitation.issue'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  invitation_id TEXT NOT NULL UNIQUE REFERENCES catalog_invitations(id),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  UNIQUE(actor_user_id, operation, idempotency_key)
) STRICT;

CREATE TRIGGER catalog_operator_intents_immutable BEFORE UPDATE ON catalog_operator_intents
BEGIN SELECT RAISE(ABORT, 'catalog-operator-intent-immutable'); END;
CREATE TRIGGER catalog_operator_intents_no_delete BEFORE DELETE ON catalog_operator_intents
BEGIN SELECT RAISE(ABORT, 'catalog-operator-intent-immutable'); END;

