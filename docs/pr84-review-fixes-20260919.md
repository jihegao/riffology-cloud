# PR #84 review fixes

- Retain released Queue/Mesa profiles and exact original host/assets from
  `727c40f` through the ordinary materialization path, including clean CI.
  Delivery tests compare every retained descriptor and asset digest. The real
  browser driver selects the frozen host and assets and exercises cold independent
  pages and refresh for both models.
- G5 billing-only holds accept explicit auth/rate-limit rejection, not generic
  provider failure. Existing HTTP failure evidence retains upstream status and
  source stage. Workerd tests cover request-ID-bearing 502/504 and local deadline,
  conservative reservation retention, restart, and subsequent admission denial.
- Gateway query and submit share Workspace-backed backend selection. Pi remains
  governed by Pi gates even when account Managed testing is disabled/unavailable;
  persisted Managed projects cannot fall back to Pi after config removal.
  Workspace still performs final ownership, policy and execution checks.

Focused tests and type checking passed. Full repository checks and expanded real
browser acceptance are running; their final results and deployment verification
will be recorded in the release follow-up. No provider request is needed for these
regressions. This change does not implement Pi developer mode.
