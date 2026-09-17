# Browser Preview deployment and online acceptance — 2026-09-17

## Release identity

PR [#76](https://github.com/jihegao/riffology-cloud/pull/76) merged the Browser Preview isolation fixes with the active G5 production source. The deployed source is `305c38cb88b09aa8586dbf64cf638db7a6eb0426` with tree `be8b9a6749c6501f6e23d46912454da99fbc4bf3`.

The app Worker `riffology-m1-gateway-staging` serves 100% from version `9a113e37-e3e1-439a-918c-b50b8a7969de`. The independent execution Worker `riffology-browser-execution` serves 100% from version `2b9bfc38-4994-495c-ba36-df51b6265ca4`. Both versions carry the exact source tag.

## Passed checks

- Full repository validation and the real Chrome/Pyodide acceptance suite passed before deployment.
- The malicious Python blob-subworker case fails closed, while the required main blob Worker remains functional.
- The retained-v1-ready to current-v2 package migration regression rebuilds instead of remaining stuck.
- The public app root returns 200 with SHA-256 `d70a95d14dc298babd4eb414a38aff3bbe4e04fd4899cdd56a3ead24b521315b`.
- The immutable execution frame returns 200 with SHA-256 `53110ac3f6ebd8c372a048cb122941ffad41543d8c11b4582147e9f350e103e5`, one-year immutable caching, no network connection permission, and the exact app origin as its only frame ancestor.
- Execution root, legacy frame path, and POST-to-frame all return 404.
- The unauthenticated app identity endpoint returns 401 as required.
- The release preserved the production bindings while changing the recorded source SHA. G5 admission, model, Turn, Simulation, service, and Preview WebSocket gates remained closed. No paid or server-side Run was invoked.

## Unfinished acceptance boundary

Authenticated ordinary-user Browser Preview acceptance is not claimed. The saved local browser profiles returned 401, and the remote acceptance host had no discoverable authenticated browser/CDP session. Therefore the deployed signed-in Preview panel, deployed Queue/Mesa runs, refresh persistence, and browser-observed zero server-side Run creation remain unverified.

The remaining action does not require a redeploy: sign in once with an invited Google test account, then rerun the authenticated browser matrix while all paid/server execution gates stay closed.

The sanitized machine-readable record and checksum manifest are in [`docs/evidence/browser-preview-release-20260917/`](evidence/browser-preview-release-20260917/).
