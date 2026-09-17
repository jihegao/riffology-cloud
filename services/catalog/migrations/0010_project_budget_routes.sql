-- Private immutable budget provenance. Existing projects remain on legacy ledgers.
CREATE TABLE catalog_project_budget_routes (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_projects(id),
  tenant_id TEXT NOT NULL REFERENCES catalog_tenants(id),
  route_json TEXT NOT NULL CHECK(json_valid(route_json))
) STRICT;
CREATE TRIGGER catalog_project_budget_routes_immutable
BEFORE UPDATE ON catalog_project_budget_routes BEGIN
  SELECT RAISE(ABORT, 'project-budget-route-immutable');
END;
