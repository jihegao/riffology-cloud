-- Presentation preference only. This table is deliberately outside Better Auth,
-- project, Workspace and Turn state; a locale update must never change access.
CREATE TABLE catalog_user_locale_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_users(id),
  locale TEXT NOT NULL CHECK(locale IN ('zh-CN','en')),
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
) STRICT;

CREATE TRIGGER catalog_user_locale_preferences_identity_immutable BEFORE UPDATE OF user_id ON catalog_user_locale_preferences
WHEN NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT, 'catalog-user-locale-owner-immutable'); END;
