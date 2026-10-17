# Copied-project context integration on main

This independent candidate reuses the eight business/test files from [PR #226](https://github.com/jihegao/riffology-cloud/pull/226), head `5ca13487d01ca0b308bb48e05424347b6c51c79e`, relative to its base `f625f0193e2964148a990a3af502e7a581ceb688`. It starts at main `1e35391a04a0e5c669fa708971b2456e9a414ca3` and does not include the account-ID work in #231 or rewrite the original #208/#226 branches.

Files returned by the current project's Files API remain visible before a Turn Revision exists and are labelled as initial files. The first supported new schema2 Managed session receives bounded context from its verified initial/workspace base; existing session continuation and original-operation recovery remain in place. Leaving Preview clears retained controls/form/visual/metrics nodes, and an empty project's embedded Preview remains hidden while a copied project's supported Preview is preserved.

The existing `projectResourcesFromArchive` check stays before reservation/dispatch. The copied-source negative checks a mismatched initial files digest produces zero intercepted provider POSTs, then verifies valid-source success and same-key restart behavior. No duplicate standalone digest guard is added. Manual sources, unknown execution and original requests are retained.

## Verification method and evidence

Run related local Managed Workerd, Preview/workspace, initial-content and manual-recovery tests on the final candidate HEAD; then run the complete `npm run check` on that same HEAD. Reuse only the 25 cached public assets after size/hash verification and run all three README asset preparation steps. Do not install/download software or supply ambient credentials, paid/cloud/Docker opt-ins. Provider requests in these fixtures are intercepted with synthetic keys; the checks do not authorize a real provider call.

[Source provenance and hashes](../evidence/releases/initial-context-main-integration-20261017.json) identify the exact patch. The final-HEAD check results and raw-log digests are recorded in the associated Draft PR and [Issue #207](https://github.com/jihegao/riffology-cloud/issues/207) delivery comments; this method document does not turn a planned check into a pass.

The candidate remains unmerged and undeployed. New ordinary-owner/second-identity acceptance, real first-session behavior and resource release are separate pending acceptance, as are any paid operations. No production requests, invitation/authentication changes, admission changes, ledger writes, old-project restoration or purge are part of this integration. Historical Fire diagnosis is not reconstructed by a new fixture.
