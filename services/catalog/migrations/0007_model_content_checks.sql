-- A validation proof is committed only with its successful state transition.
-- Re-publication always resolves original package bytes again in ModelCatalog.
CREATE TABLE catalog_model_content_checks (
  model_version_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_model_versions(id),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
  verified_at INTEGER NOT NULL CHECK(verified_at >= 0),
  verified_by TEXT NOT NULL REFERENCES catalog_users(id),
  CHECK(json_type(receipt_json)='object'),
  CHECK(json_extract(receipt_json,'$.modelVersionId') IS model_version_id),
  CHECK(json_extract(receipt_json,'$.namespace') IS 'model-content'),
  CHECK(json_type(receipt_json,'$.bytes') IS 'integer' AND json_extract(receipt_json,'$.bytes') BETWEEN 1 AND 8388608),
  CHECK(json_type(receipt_json,'$.fileCount') IS 'integer' AND json_extract(receipt_json,'$.fileCount') BETWEEN 1 AND 4096),
  CHECK(json_type(receipt_json,'$.contentBytes') IS 'integer' AND json_extract(receipt_json,'$.contentBytes') BETWEEN 0 AND json_extract(receipt_json,'$.bytes'))
) STRICT;
CREATE TRIGGER catalog_model_content_check_matches BEFORE INSERT ON catalog_model_content_checks
WHEN (SELECT count(*) FROM json_each(NEW.receipt_json)) != 10 OR NOT EXISTS (
  SELECT 1 FROM catalog_model_versions m WHERE m.id=NEW.model_version_id AND m.status='validated'
  AND m.validated_at=NEW.verified_at
  AND json_extract(NEW.receipt_json,'$.modelId') IS m.model_id
  AND json_extract(NEW.receipt_json,'$.version') IS m.version
  AND json_extract(NEW.receipt_json,'$.contentRef') IS m.content_ref
  AND json_extract(NEW.receipt_json,'$.contentSha256') IS m.content_sha256
  AND json_extract(NEW.receipt_json,'$.verifiedSha256') IS m.content_sha256)
BEGIN SELECT RAISE(ABORT, 'catalog-model-content-check-mismatch'); END;
CREATE TRIGGER catalog_model_content_check_no_update BEFORE UPDATE ON catalog_model_content_checks
BEGIN SELECT RAISE(ABORT, 'catalog-model-content-check-immutable'); END;
CREATE TRIGGER catalog_model_content_check_no_delete BEFORE DELETE ON catalog_model_content_checks
BEGIN SELECT RAISE(ABORT, 'catalog-model-content-check-immutable'); END;
CREATE TRIGGER catalog_model_content_check_no_replace BEFORE INSERT ON catalog_model_content_checks
WHEN EXISTS(SELECT 1 FROM catalog_model_content_checks WHERE model_version_id=NEW.model_version_id)
BEGIN SELECT RAISE(ABORT, 'catalog-model-content-check-immutable'); END;
-- A validated version identifies frozen bytes even before publication.
CREATE TRIGGER catalog_model_validated_content_immutable BEFORE UPDATE OF starter_version,content_ref,content_sha256 ON catalog_model_versions
WHEN OLD.status='validated' AND (NEW.starter_version IS NOT OLD.starter_version OR NEW.content_ref IS NOT OLD.content_ref OR NEW.content_sha256 IS NOT OLD.content_sha256)
BEGIN SELECT RAISE(ABORT, 'catalog-model-version-content-immutable'); END;
