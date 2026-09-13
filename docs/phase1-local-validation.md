# Phase 1 local validation

Baseline: `98d231909871c2b13909c5e351c746c1aea02d28`.

Local implementation covers admission projection, Model Spec validation, durable finite experiments, native Python execution, immutable metrics and bounded output artifacts, Preview revision pinning, parameter controls, and persisted Pi research context.

`npm run check` passed: M0 350, M1 185, M2 530, M3 526, release-profile/config 4. Six explicitly gated tests were skipped. After the final quota dispatch authorization and RPC-disposal fixes, typecheck and the affected recovery/Gateway suites passed separately (10 recovery tests, 2 Gateway tests). These figures describe the recorded runs, not a claim of remote CI.

Native ARM Linux Docker acceptance passed all five scenarios: success, nonzero exit, cancellation, read-only workspace/outbound-connect isolation, and output Artifact capture. The test uses the same Python runner and isolation helpers as production. The production linux/amd64 image also built successfully; the local build manifest list digest was `sha256:be02d18823ae778f3eb3d73e87772e90549c4f2a5a2e22777067ea5e6775f888`. This local image has not been published to a registry or deployed.

The real Workerd test submits, disposes the environment before the first alarm, reopens persisted SQLite state, and observes automatic completion. A repeated key and a second restart retain exactly one native-start count. Its native execution and R2 publication ports are fixtures; the Docker test separately exercises actual Python execution. Neither is the ordinary-user cloud E2E.

Not yet performed: production Cloudflare deployment, ordinary-user login/Pi/Preview/parameter-run/refresh E2E, final cloud inventory, or paid-provider acceptance. Deployment, opening online admission, and paid acceptance require explicit authorization. Use the release runbook and evidence validator before claiming a user release.

Original untracked evidence directories remain in the original checkout and are excluded from all feature commits.
