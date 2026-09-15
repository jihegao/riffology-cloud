# G3 local acceptance preparation

2026-09-15. Current scope is preparation and observed diagnostics, not a completed research-loop gate. No deployment or external model call occurs.

## Actual local foundations

`node --experimental-strip-types --test tests/m3/g3-gateway-auth-workerd.test.mjs` passes. It bundles the actual Gateway in Workerd, migrates actual D1, obtains Better Auth signed cookies through its internal auth adapter, then accepts invitations through actual Gateway routes for two distinct tenants. Owner list access is 200; another tenant is 404; missing or tampered cookies are 401. Fixture inserts are limited to authentication identities and invitations. No model, publication, saved revision, preview build, Experiment or Run row is inserted.

`node --experimental-strip-types scripts/m3/g3-sandbox-connectivity.mjs` reaches the actual Sandbox SDK container through Miniflare `containerEngine.localDocker` and the committed proxy image. SDK exec reports system Python 3.11.14 and independent Python 3.14.2 in `riffology-g1-mesa:local`. The probe destroys its own sandbox. Ignored evidence is written to `.local/g3-connectivity/result.json` and associated logs; this is connectivity evidence only.

## Observed execution isolation gap

Workerd outbound rejection is insufficient as the translated project process network fence. Inside the actual SDK container, a controlled UID 10001 CPython child connects to both a controlled root loopback TCP listener and a root Unix socket listener, and both listeners receive `project-arrival`. `g3-network-boundary-probe.py` records the actual child UID, connection outcomes and server arrivals. It intentionally does not install or claim the native project fence.

The unchanged production native fence fails closed in local amd64 translation with seccomp load error -125. Adding its existing translated-platform marker while relying only on Workerd egress would allow the observed root connections and cannot sign G3 isolation. Applying the G1 whole-container deny-all socket policy would also block the root Sandbox SDK server needed by this chain. The current Miniflare Docker schema exposes socket and proxy image configuration but no caller-supplied per-container security policy. A real native execution environment or a verified project-specific kernel policy is required before successful native execution can complete the G3 gate. No fixture runtime will substitute for it.

## Complete driver contract

The final driver will use actual Gateway cookie and ACL handling, Workspace journal session/submit/claim/checkpoint operations, RevisionStore commit and actual R2 bytes for the canonical five-file fixtures. Deterministic fixture production is explicitly separate from ordinary Agent generation. Project initialization must use actual provisioning; it must not seed ready initialization or catalog model rows.

For each canonical Queue/Mesa source, the gate must persist a checkpoint, restart Workerd with no browser page, and observe the shared alarm produce a compatible ready private package. GET package bytes must pass the immutable archive/profile/source identity chain. The production Browser worker must run seed 7 and the fixed G1 parameters; the local window must have no new native/Pi execution, Experiment or Run. Verification must capture the exact old revision/package/input, remain idempotent after a newer save, reject changed input under the same key and reject revoked/cross-tenant access. Actual SimulationHost and native execution must persist Run receipts and bounded artifacts to real R2 and produce an actual Gateway export with real Python replay. HTTP/R2 shims, direct ready-row inserts and fake native receipts do not meet this contract.

Publication review is read-only: `publicationContent` preserves the accepted `model/` and `app/` files with per-file hashes, so the five canonical source paths fit the existing whitelist. Browser runtime assets/profile inventory remain trusted platform assets rather than arbitrary publication source files. Initial copied projects lacking a saved revision are a separately recorded product compatibility gap; the driver will not work around it by inserting a model or manufacturing a saved receipt.
